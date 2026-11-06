/**
 * 登录相关的纯函数：密码派生、会话令牌、Cookie 序列化。
 *
 * 这里刻意不 import `cloudflare:workers`，所有函数只依赖 Web Crypto，
 * 这样 scripts/verify-ledger.mjs 可以在 Node 里直接跑回归测试。
 */

export const SESSION_COOKIE = 'tl_session';
/** 登录态有效期：180 天。 */
export const SESSION_TTL_DAYS = 180;
/** 剩余有效期不足 150 天时自动续期，等于「一直在用就不会掉线」。 */
export const SESSION_RENEW_DAYS = 150;
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 64;
/**
 * PBKDF2-SHA256 迭代次数。Workers 有 CPU 时间限制，100000 次约几十毫秒，
 * 登录是低频操作，足够；若部署环境 CPU 限制很紧，可通过环境变量下调。
 */
export const DEFAULT_PBKDF2_ITERATIONS = 100_000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const INVITE_TTL_HOURS = 24;
export const INVITE_MAX_ATTEMPTS = 10;
export const INVITE_CODE_LENGTH = 6;

const DAY_MS = 86_400_000;
const encoder = new TextEncoder();
/** 去掉 0/O/1/I 这类容易念错、抄错的字符。 */
const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export type PasswordRecord = { hash: string; salt: string; iterations: number };

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error('无效的十六进制字符串');
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function randomHex(byteLength = 16): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

/** 用 PBKDF2-SHA256 派生密码哈希（十六进制）。 */
export async function hashPassword(
  password: string,
  salt: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
): Promise<string> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(salt), iterations },
    material,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function createPasswordRecord(
  password: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
): Promise<PasswordRecord> {
  const salt = randomHex(16);
  return { hash: await hashPassword(password, salt, iterations), salt, iterations };
}

/** 定时安全比较，避免按字符提前返回泄露哈希前缀。 */
export function constantTimeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const hash = await hashPassword(password, record.salt, record.iterations);
  return constantTimeEqualHex(hash, record.hash);
}

/** 返回密码不合规的原因，合规时返回 null。 */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || !password) return '请输入密码';
  if (password.length < PASSWORD_MIN_LENGTH) return `密码至少 ${PASSWORD_MIN_LENGTH} 位`;
  if (password.length > PASSWORD_MAX_LENGTH) return `密码最多 ${PASSWORD_MAX_LENGTH} 位`;
  return null;
}

export function sessionExpiry(now = new Date()): string {
  return new Date(now.getTime() + SESSION_TTL_DAYS * DAY_MS).toISOString();
}

export function isSessionExpired(expiresAt: string, now = new Date()): boolean {
  const expires = Date.parse(expiresAt);
  return !Number.isFinite(expires) || expires <= now.getTime();
}

export function sessionNeedsRenewal(expiresAt: string, now = new Date()): boolean {
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return false;
  return expires - now.getTime() < SESSION_RENEW_DAYS * DAY_MS;
}

export function createInviteCode(length = INVITE_CODE_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]).join('');
}

export function normalizeInviteCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function inviteExpiry(now = new Date()): string {
  return new Date(now.getTime() + INVITE_TTL_HOURS * 3_600_000).toISOString();
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * 长期登录态：HttpOnly 防止脚本读取，SameSite=Lax 防跨站携带，
 * Max-Age 让浏览器持久保存，关掉浏览器也不会丢。
 */
export function sessionCookie(token: string, options: { secure: boolean; maxAge?: number }): string {
  const maxAge = options.maxAge ?? SESSION_TTL_DAYS * 24 * 60 * 60;
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    options.secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  return sessionCookie('', { secure, maxAge: 0 });
}

/**
 * 会话需要续期时返回要重新下发的 Cookie，否则返回 null。
 *
 * 只更新数据库里的 expires_at 是不够的：浏览器按 Cookie 自己的 Max-Age 丢弃它。
 * 所以续期必须同时重发一次 Set-Cookie，把 Max-Age 重新计满，
 * 这样「一直在用」才真的不会掉线。
 */
export function renewalCookie(
  expiresAt: string,
  token: string,
  secure: boolean,
  now = new Date(),
): string | null {
  return sessionNeedsRenewal(expiresAt, now) ? sessionCookie(token, { secure }) : null;
}

/** 本地 http 开发时不加 Secure，否则浏览器会拒收 Cookie。 */
export function isSecureRequest(request: Request): boolean {
  try {
    if (new URL(request.url).protocol === 'https:') return true;
  } catch {
    // 忽略：退化为按请求头判断
  }
  return (request.headers.get('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https';
}
