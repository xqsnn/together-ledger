import { env } from 'cloudflare:workers';
import { readSession } from '@/lib/auth-server';
import {
  IMAGE_LIMITS,
  MAX_ENTRY_IMAGES,
  MAX_IMAGE_DIMENSION,
  MediaError,
  isThumbJpeg,
  isValidId,
  mediaError,
  sniffImageMime,
  type MediaStorage,
  type MediaVariant,
} from '@/lib/media';
import { deleteObjectNow, drainDeletionsThrottled, getObject, putObject, queueObjectDeletion, storageMode } from '@/lib/media-store';

export const dynamic = 'force-dynamic';

type MediaRow = {
  id: string;
  entry_id: string | null;
  comment_id: string | null;
  storage: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  thumb_mime: string | null;
  thumb_bytes: number;
};

const JSON_HEADERS = { 'Cache-Control': 'no-store' };

function database(): D1Database {
  if (!env.DB) throw new Error('账本暂时无法连接，请稍后重试');
  return env.DB;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: JSON_HEADERS });
}

function failure(error: unknown) {
  if (error instanceof MediaError) return json({ error: error.message, code: error.code }, error.status);
  console.error(error);
  return json({ error: '图片处理失败，请重试', code: 'SERVER_ERROR' }, 500);
}

function mediaMeta(row: MediaRow) {
  return { id: row.id, width: Number(row.width), height: Number(row.height), bytes: Number(row.bytes), thumbBytes: Number(row.thumb_bytes) };
}

/** 图片只归属记录；comment_id 列仍保留但不再写入。 */
function sameTarget(row: MediaRow, targetId: string) {
  return row.entry_id === targetId && row.comment_id === null;
}

async function cleanupObjects(storage: MediaStorage, id: string, hasThumb: boolean) {
  await deleteObjectNow(storage, id, 'full').catch(() => undefined);
  if (hasThumb) await deleteObjectNow(storage, id, 'thumb').catch(() => undefined);
}

function isForeignKeyError(error: unknown) {
  return /FOREIGN KEY constraint failed/i.test(error instanceof Error ? error.message : String(error));
}

export async function POST(request: Request) {
  try {
    const session = await readSession(request);
    if (!session) return json({ error: '请先登录', code: 'UNAUTHORIZED' }, 401);
    if (!request.headers.get('content-type')?.includes('multipart/form-data')) {
      throw mediaError('IMAGE_INVALID', '请求格式无效');
    }
    const form = await request.formData();
    const id = form.get('id');
    const target = form.get('target');
    const targetId = form.get('targetId');
    const file = form.get('file');
    const thumb = form.get('thumb');
    if (!isValidId(id) || target !== 'entry' || !isValidId(targetId) || !(file instanceof File)) {
      throw mediaError('IMAGE_INVALID', '图片参数无效');
    }
    const width = Number(form.get('width'));
    const height = Number(form.get('height'));
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      throw mediaError('IMAGE_INVALID', '图片尺寸无效');
    }
    const thumbFile = thumb instanceof File ? thumb : null;
    const bytes = await file.arrayBuffer();
    const data = new Uint8Array(bytes);
    const mode = storageMode();
    const limits = IMAGE_LIMITS[mode];
    const db = database();

    const existing = await db
      .prepare('SELECT id, entry_id, comment_id, storage, mime, width, height, bytes, thumb_mime, thumb_bytes FROM media WHERE id=?')
      .bind(id)
      .first<MediaRow>();
    if (existing) {
      if (sameTarget(existing, targetId) && Number(existing.bytes) === data.byteLength) {
        return json({ media: mediaMeta(existing) }, 200);
      }
      throw mediaError('IMAGE_CONFLICT', '这张图片已被占用，请重新选择');
    }

    const targetExists = await db.prepare('SELECT 1 AS found FROM entries WHERE id=?').bind(targetId).first<{ found: number }>();
    if (!targetExists) throw mediaError('TARGET_NOT_FOUND', '记录不存在或已删除');

    const mime = sniffImageMime(data);
    if (!mime) throw mediaError('IMAGE_UNSUPPORTED', '只支持 JPG / PNG / WebP 图片');
    if (data.byteLength < 1) throw mediaError('IMAGE_INVALID', '图片内容为空');
    if (data.byteLength > limits.maxBytes) throw mediaError('IMAGE_TOO_LARGE', `图片过大（上限 ${Math.floor(limits.maxBytes / 1000)} KB）`);

    let thumbBytes = 0;
    let thumbBuffer: ArrayBuffer | null = null;
    if (thumbFile) {
      thumbBuffer = await thumbFile.arrayBuffer();
      thumbBytes = thumbBuffer.byteLength;
      if (!isThumbJpeg(new Uint8Array(thumbBuffer))) throw mediaError('IMAGE_INVALID', '缩略图格式无效');
      if (thumbBytes > limits.maxThumbBytes) throw mediaError('IMAGE_TOO_LARGE', '缩略图过大');
    }

    try {
      await putObject(mode, id, 'full', bytes, mime);
      if (thumbBuffer) await putObject(mode, id, 'thumb', thumbBuffer, 'image/jpeg');
    } catch (error) {
      await cleanupObjects(mode, id, Boolean(thumbBuffer));
      throw error;
    }

    const createdAt = new Date().toISOString();
    const thumbMime = thumbBuffer ? 'image/jpeg' : null;
    const insert = db.prepare(
      `INSERT INTO media (id, entry_id, comment_id, storage, mime, width, height, bytes, thumb_mime, thumb_bytes, created_by, created_at)
       SELECT ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM media WHERE entry_id = ?) < ?
       ON CONFLICT(id) DO NOTHING`,
    ).bind(id, targetId, mode, mime, width, height, data.byteLength, thumbMime, thumbBytes, session.ownerKey, createdAt, targetId, MAX_ENTRY_IMAGES);

    let changes = 0;
    try {
      const result = await insert.run();
      changes = Number(result.meta.changes) || 0;
    } catch (error) {
      await cleanupObjects(mode, id, Boolean(thumbBuffer));
      if (isForeignKeyError(error)) throw mediaError('TARGET_NOT_FOUND', '记录刚被删除，请刷新后重试');
      throw error;
    }

    if (changes > 0) {
      await drainDeletionsThrottled(db).catch(() => undefined);
      return json({ media: { id, width, height, bytes: data.byteLength, thumbBytes } }, 201);
    }

    const again = await db
      .prepare('SELECT id, entry_id, comment_id, storage, mime, width, height, bytes, thumb_mime, thumb_bytes FROM media WHERE id=?')
      .bind(id)
      .first<MediaRow>();
    if (again) {
      // 并发同 id：对象 key 由 id 决定，可能正是对方那一行的对象，不能删。
      if (sameTarget(again, targetId) && Number(again.bytes) === data.byteLength) return json({ media: mediaMeta(again) }, 200);
      throw mediaError('IMAGE_CONFLICT', '这张图片已被占用，请重新选择');
    }
    await cleanupObjects(mode, id, Boolean(thumbBuffer));
    throw mediaError('IMAGE_LIMIT', `每条记录最多 ${MAX_ENTRY_IMAGES} 张图片`);
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: Request) {
  try {
    const session = await readSession(request);
    if (!session) return json({ error: '请先登录', code: 'UNAUTHORIZED' }, 401);
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const variant = url.searchParams.get('v');
    if (!isValidId(id) || (variant !== 'thumb' && variant !== 'full')) throw mediaError('IMAGE_INVALID', '图片参数无效');
    const row = await database()
      .prepare('SELECT id, entry_id, comment_id, storage, mime, width, height, bytes, thumb_mime, thumb_bytes FROM media WHERE id=?')
      .bind(id)
      .first<MediaRow>();
    if (!row) throw mediaError('TARGET_NOT_FOUND', '图片不存在或已删除');
    // 没有缩略图（历史/异常数据）时回退原图，避免列表出现破图。
    const serve = variant === 'thumb' && Number(row.thumb_bytes) ? 'thumb' : 'full';

    const object = await getObject(row.storage as MediaStorage, id, serve as MediaVariant);
    if (!object) throw mediaError('TARGET_NOT_FOUND', '图片不存在或已删除');

    const bytes = Number(serve === 'thumb' ? row.thumb_bytes : row.bytes);
    const headers: Record<string, string> = {
      'Content-Type': serve === 'thumb' ? (row.thumb_mime || row.mime) : row.mime,
      ETag: `"${id}-${serve}-${bytes}"`,
      // 图片按 id 寻址、内容不可变（换图 = 换 id），手机看过的图永久本地缓存，
      // 详情页二次打开不再逐张向服务器验证。
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Content-Disposition': 'inline',
    };
    if (request.headers.get('if-none-match') === headers.ETag) return new Response(null, { status: 304, headers });
    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await readSession(request);
    if (!session) return json({ error: '请先登录', code: 'UNAUTHORIZED' }, 401);
    const id = new URL(request.url).searchParams.get('id');
    if (!isValidId(id)) throw mediaError('IMAGE_INVALID', '图片参数无效');
    const db = database();
    const row = await db.prepare('SELECT id, storage FROM media WHERE id=?').bind(id).first<{ id: string; storage: string }>();
    if (!row) throw mediaError('TARGET_NOT_FOUND', '图片不存在或已删除');
    const storage = row.storage as MediaStorage;
    const statements = [db.prepare('DELETE FROM media WHERE id=?').bind(id)];
    if (storage === 'd1') statements.push(db.prepare('DELETE FROM media_blobs WHERE media_id=?').bind(id));
    else statements.push(...queueObjectDeletion(db, [{ mediaId: id, storage }]));
    await db.batch(statements);
    await drainDeletionsThrottled(db).catch(() => undefined);
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
