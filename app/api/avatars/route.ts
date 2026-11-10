import { env } from 'cloudflare:workers';
import { readSession } from '@/lib/auth-server';
import { ownerKeys } from '@/lib/ledger';

export const dynamic = 'force-dynamic';

/**
 * 头像下发：账本 JSON 里只带版本号（updated_at），字节从这里按 URL 强缓存取。
 *
 * 头像内容只在「上传新头像」时变化，而那时版本号一定变——所以响应可以
 * `max-age=31536000, immutable`：换过一次之后，手机永远本地秒出，不再随
 * 每次拉账本下载几百 KB 的 base64。
 */
export async function GET(request: Request) {
  const session = await readSession(request);
  const jsonHeaders = { 'Cache-Control': 'no-store' };
  if (!session) return Response.json({ error: '请先登录', code: 'UNAUTHORIZED' }, { status: 401, headers: jsonHeaders });
  const owner = new URL(request.url).searchParams.get('owner') ?? '';
  if (!(ownerKeys as readonly string[]).includes(owner)) {
    return Response.json({ error: '归属无效', code: 'OWNER_INVALID' }, { status: 400, headers: jsonHeaders });
  }
  try {
    if (!env.DB) throw new Error('账本暂时无法连接，请稍后重试');
    const row = await env.DB
      .prepare('SELECT data, updated_at FROM avatars WHERE owner = ?')
      .bind(owner)
      .first<{ data: string; updated_at: string }>();
    if (!row?.data.startsWith('data:image/')) {
      return Response.json({ error: '头像不存在', code: 'AVATAR_NOT_FOUND' }, { status: 404, headers: jsonHeaders });
    }
    const commaIndex = row.data.indexOf(',');
    const meta = row.data.slice(5, commaIndex); // 形如 image/jpeg;base64
    const mime = meta.split(';')[0] || 'image/jpeg';
    const bytes = Uint8Array.from(atob(row.data.slice(commaIndex + 1)), (char) => char.charCodeAt(0));
    const headers: Record<string, string> = {
      'Content-Type': mime,
      ETag: `"av-${owner}-${row.updated_at}-${row.data.length}"`,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Content-Disposition': 'inline',
    };
    if (request.headers.get('if-none-match') === headers.ETag) return new Response(null, { status: 304, headers });
    return new Response(bytes.buffer as ArrayBuffer, { status: 200, headers });
  } catch (error) {
    console.error(error);
    return Response.json({ error: '头像暂时无法加载', code: 'SERVER_ERROR' }, { status: 503, headers: jsonHeaders });
  }
}
