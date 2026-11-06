/**
 * 媒体对象存储：R2 为主，未绑定 BUCKET 时落 D1。
 * 这里是唯一接触 cloudflare:workers / D1 / R2 的媒体文件，纯逻辑留在 lib/media.ts。
 */
import { env } from 'cloudflare:workers';
import {
  mediaError,
  mediaObjectKey,
  type MediaStorage,
  type MediaVariant,
} from './media';

type DeletionRow = {
  media_id: string;
  variant: string;
  storage: string;
  attempts: number;
  next_attempt_at: string;
};

export function storageMode(): MediaStorage {
  return env.BUCKET ? 'r2' : 'd1';
}

function database(): D1Database {
  if (!env.DB) throw new Error('账本暂时无法连接，请稍后重试');
  return env.DB;
}

export async function putObject(storage: MediaStorage, id: string, variant: MediaVariant, bytes: ArrayBuffer, mime: string): Promise<void> {
  if (storage === 'r2') {
    if (!env.BUCKET) throw mediaError('MEDIA_UNAVAILABLE', '图片存储暂时不可用');
    await env.BUCKET.put(mediaObjectKey(id, variant), bytes, { httpMetadata: { contentType: mime } });
    return;
  }
  await database()
    .prepare('INSERT OR REPLACE INTO media_blobs (media_id, variant, data) VALUES (?,?,?)')
    .bind(id, variant, bytes)
    .run();
}

export async function getObject(storage: MediaStorage, id: string, variant: MediaVariant): Promise<{ body: ReadableStream | ArrayBuffer; size: number } | null> {
  if (storage === 'r2') {
    if (!env.BUCKET) throw mediaError('MEDIA_UNAVAILABLE', '图片存储暂时不可用');
    const object = await env.BUCKET.get(mediaObjectKey(id, variant));
    if (!object) return null;
    return { body: object.body, size: object.size };
  }
  const row = await database()
    .prepare('SELECT data FROM media_blobs WHERE media_id=? AND variant=?')
    .bind(id, variant)
    .first<{ data: unknown }>();
  if (!row?.data) return null;
  // D1 的 BLOB 在不同运行时里可能返回 ArrayBuffer / TypedArray / number[]，统一成 ArrayBuffer。
  const raw = row.data as ArrayBuffer | ArrayBufferView | number[];
  let data: ArrayBuffer;
  if (raw instanceof ArrayBuffer) {
    data = raw;
  } else if (ArrayBuffer.isView(raw)) {
    data = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  } else if (Array.isArray(raw)) {
    data = new Uint8Array(raw).buffer;
  } else {
    throw new Error('图片数据格式异常');
  }
  return { body: data, size: data.byteLength };
}

export async function deleteObjectNow(storage: MediaStorage, id: string, variant: MediaVariant): Promise<void> {
  if (storage === 'r2') {
    if (!env.BUCKET) throw mediaError('MEDIA_UNAVAILABLE', '图片存储暂时不可用');
    await env.BUCKET.delete(mediaObjectKey(id, variant));
    return;
  }
  await database()
    .prepare('DELETE FROM media_blobs WHERE media_id=? AND variant=?')
    .bind(id, variant)
    .run();
}

/** 与删除 media 行放在同一个 batch 里调用，避免「行删了、队列没写」。 */
export function queueObjectDeletion(db: D1Database, rows: { mediaId: string; storage: string }[]): D1PreparedStatement[] {
  const now = new Date().toISOString();
  return rows.flatMap((row) => (['full', 'thumb'] as MediaVariant[]).map((variant) =>
    db.prepare('INSERT OR IGNORE INTO media_deletions (media_id, variant, storage, created_at, attempts, next_attempt_at) VALUES (?,?,?,?,0,?)')
      .bind(row.mediaId, variant, row.storage, now, now)));
}

const RETRY_DELAYS = [60_000, 300_000, 1_800_000, 7_200_000];

/** 失败按 1min / 5min / 30min / 2h 退避；对象已不存在视为删除成功。 */
export async function drainDeletions(db: D1Database, limit = 20): Promise<void> {
  const now = new Date().toISOString();
  const rows = await db
    .prepare('SELECT media_id, variant, storage, attempts, next_attempt_at FROM media_deletions WHERE next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?')
    .bind(now, limit)
    .all<DeletionRow>();
  for (const row of rows.results) {
    // 同 id 被重新上传：新对象不能被旧队列删掉，直接出队。
    const alive = await db.prepare('SELECT 1 AS found FROM media WHERE id=?').bind(row.media_id).first<{ found: number }>();
    if (alive) {
      await db.prepare('DELETE FROM media_deletions WHERE media_id=? AND variant=?').bind(row.media_id, row.variant).run();
      continue;
    }
    try {
      await deleteObjectNow(row.storage as MediaStorage, row.media_id, row.variant as MediaVariant);
      await db.prepare('DELETE FROM media_deletions WHERE media_id=? AND variant=?').bind(row.media_id, row.variant).run();
    } catch (error) {
      const attempts = Number(row.attempts) || 0;
      const delay = RETRY_DELAYS[Math.min(attempts, RETRY_DELAYS.length - 1)];
      console.error('media deletion failed', row.media_id, row.variant, error);
      await db
        .prepare('UPDATE media_deletions SET attempts=?, next_attempt_at=? WHERE media_id=? AND variant=?')
        .bind(attempts + 1, new Date(Date.now() + delay).toISOString(), row.media_id, row.variant)
        .run();
    }
  }
}

/** 最多每 5 分钟跑一次：GET /api/ledger 与写请求末尾都会调用。 */
export async function drainDeletionsThrottled(db: D1Database): Promise<void> {
  const now = Date.now();
  const state = await db.prepare('SELECT last_drain_at FROM media_state WHERE id=?').bind('drain').first<{ last_drain_at: string }>();
  if (state) {
    const last = Date.parse(state.last_drain_at);
    if (Number.isFinite(last) && now - last < 300_000) return;
  }
  await drainDeletions(db);
  await db
    .prepare('INSERT OR REPLACE INTO media_state (id, last_drain_at) VALUES (?,?)')
    .bind('drain', new Date(now).toISOString())
    .run();
}
