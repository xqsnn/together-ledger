/**
 * 服务端会话读取：只在这里接触 D1 与 `cloudflare:workers`。
 * 纯逻辑（哈希、Cookie 格式）放在 lib/auth.ts，便于在 Node 里回归测试。
 */
import { env } from 'cloudflare:workers';
import type { OwnerKey } from './ledger';
import {
  SESSION_COOKIE,
  isSecureRequest,
  isSessionExpired,
  randomHex,
  readCookie,
  sessionCookie,
  sessionExpiry,
  sessionNeedsRenewal,
  sha256Hex,
  type PasswordRecord,
} from './auth';

export const DEFAULT_OWNER_NAMES: Record<string, string> = { qing: '青', hua: '华', together: '共同' };
/** 只有这两个身份能登录，「共同」是归属标签，不是账号。 */
export const LOGIN_OWNER_KEYS: OwnerKey[] = ['qing', 'hua'];

export type AccountRecord = PasswordRecord & {
  ownerKey: string;
  failedAttempts: number;
  lockedUntil: string | null;
};

export type SessionRecord = { ownerKey: OwnerKey; name: string; tokenHash: string; cookie: string | null };

export function database(): D1Database {
  if (!env.DB) throw new Error('账本暂时无法连接，请稍后重试');
  return env.DB;
}

export async function readOwnerNames(db: D1Database): Promise<Map<string, string>> {
  const names = new Map<string, string>(Object.entries(DEFAULT_OWNER_NAMES));
  try {
    const rows = await db.prepare('SELECT key, name FROM owners ORDER BY position').all();
    (rows.results as { key: string; name: string }[]).forEach((row) => {
      if (row.key && row.name) names.set(row.key, row.name);
    });
  } catch {
    // owners 表还没建好时退回默认名字，不影响登录。
  }
  return names;
}

export async function readAccount(ownerKey: string): Promise<AccountRecord | null> {
  const row = await database()
    .prepare('SELECT owner_key, password_hash, password_salt, iterations, failed_attempts, locked_until FROM accounts WHERE owner_key = ?')
    .bind(ownerKey)
    .first<{ owner_key: string; password_hash: string; password_salt: string; iterations: number; failed_attempts: number; locked_until: string | null }>();
  if (!row) return null;
  return {
    ownerKey: row.owner_key,
    hash: row.password_hash,
    salt: row.password_salt,
    iterations: Number(row.iterations) || 0,
    failedAttempts: Number(row.failed_attempts) || 0,
    lockedUntil: row.locked_until,
  };
}

export async function createSession(ownerKey: OwnerKey): Promise<{ token: string; expiresAt: string }> {
  const db = database();
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expiresAt = sessionExpiry(now);
  await db
    .prepare('INSERT INTO sessions (id, owner_key, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?)')
    .bind(tokenHash, ownerKey, now.toISOString(), now.toISOString(), expiresAt)
    .run();
  // 顺手清理过期会话，省一个定时任务。
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now.toISOString()).run().catch(() => undefined);
  return { token, expiresAt };
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await database().prepare('DELETE FROM sessions WHERE id = ?').bind(tokenHash).run();
}

/** 改密码后踢掉其它设备，保留当前这台。 */
export async function deleteOwnerSessions(ownerKey: OwnerKey, exceptTokenHash?: string): Promise<void> {
  const db = database();
  if (exceptTokenHash) {
    await db.prepare('DELETE FROM sessions WHERE owner_key = ? AND id != ?').bind(ownerKey, exceptTokenHash).run();
  } else {
    await db.prepare('DELETE FROM sessions WHERE owner_key = ?').bind(ownerKey).run();
  }
}

/**
 * 读取当前登录态：
 * 1. 从 Cookie 取 token，只存它的 SHA-256，数据库泄露也拿不到可用令牌；
 * 2. 过期就删掉并视为未登录；
 * 3. 剩余不足 150 天时滑动续期，长期使用不会被迫重新登录。
 */
export async function readSession(request: Request): Promise<SessionRecord | null> {
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  if (!token) return null;
  const db = database();
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare('SELECT owner_key, expires_at FROM sessions WHERE id = ?')
    .bind(tokenHash)
    .first<{ owner_key: string; expires_at: string }>();
  if (!row) return null;
  if (isSessionExpired(row.expires_at)) {
    await deleteSession(tokenHash);
    return null;
  }
  // 滑动续期：同时续数据库记录和浏览器 Cookie，两者必须一起续，否则浏览器会先丢掉 Cookie。
  let cookie: string | null = null;
  if (sessionNeedsRenewal(row.expires_at)) {
    await db
      .prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?')
      .bind(sessionExpiry(), new Date().toISOString(), tokenHash)
      .run();
    cookie = sessionCookie(token, { secure: isSecureRequest(request) });
  }
  const names = await readOwnerNames(db);
  const ownerKey = row.owner_key as OwnerKey;
  return { ownerKey, name: names.get(ownerKey) ?? DEFAULT_OWNER_NAMES[ownerKey] ?? ownerKey, tokenHash, cookie };
}
