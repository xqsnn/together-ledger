import {
  DEFAULT_OWNER_NAMES,
  LOGIN_OWNER_KEYS,
  createSession,
  database,
  deleteOwnerSessions,
  deleteSession,
  readAccount,
  readOwnerNames,
  readSession,
} from '@/lib/auth-server';
import {
  LOCK_MINUTES,
  MAX_FAILED_ATTEMPTS,
  clearSessionCookie,
  createPasswordRecord,
  isSecureRequest,
  passwordProblem,
  sessionCookie,
  verifyPassword,
} from '@/lib/auth';
import type { OwnerKey } from '@/lib/ledger';

export const dynamic = 'force-dynamic';

type Body = Record<string, unknown>;

function reply(data: unknown, status = 200, cookie?: string) {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return Response.json(data, { status, headers });
}

function loginKey(value: unknown): OwnerKey | null {
  return LOGIN_OWNER_KEYS.includes(value as OwnerKey) ? (value as OwnerKey) : null;
}

function displayName(names: Map<string, string>, key: string) {
  return names.get(key) ?? DEFAULT_OWNER_NAMES[key] ?? key;
}

/** 登录页需要知道：当前有没有登录态、两个身份各自有没有设置过密码。 */
export async function GET(request: Request) {
  try {
    const db = database();
    const [session, accounts, names] = await Promise.all([
      readSession(request).catch(() => null),
      db.prepare('SELECT owner_key FROM accounts').all().catch(() => ({ results: [] as { owner_key: string }[] })),
      readOwnerNames(db),
    ]);
    const claimed = new Set((accounts.results as { owner_key: string }[]).map((row) => row.owner_key));
    const owners = LOGIN_OWNER_KEYS.map((key) => ({
      key,
      name: displayName(names, key),
      claimed: claimed.has(key),
    }));
    return reply(
      {
        session: session ? { ownerKey: session.ownerKey, name: session.name } : null,
        owners,
      },
      200,
      session?.cookie ?? undefined,
    );
  } catch (caught) {
    console.error(caught);
    return reply({ error: '登录服务暂时不可用，请稍后重试' }, 503);
  }
}

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return reply({ error: '请求格式无效' }, 415);
  }
  try {
    const body = (await request.json()) as Body;
    const db = database();
    const secure = isSecureRequest(request);

    if (body.action === 'login') {
      const ownerKey = loginKey(body.ownerKey);
      if (!ownerKey) return reply({ error: '请选择要登录的身份' }, 400);
      const problem = passwordProblem(body.password);
      if (problem) return reply({ error: problem }, 400);

      const account = await readAccount(ownerKey);
      if (!account) return reply({ error: '这个身份还没有设置登录密码' }, 400);

      const now = new Date();
      if (account.lockedUntil && Date.parse(account.lockedUntil) > now.getTime()) {
        const minutes = Math.max(1, Math.ceil((Date.parse(account.lockedUntil) - now.getTime()) / 60_000));
        return reply({ error: `尝试次数过多，请 ${minutes} 分钟后再试` }, 429);
      }

      if (!(await verifyPassword(String(body.password), account))) {
        const attempts = account.failedAttempts + 1;
        const locked = attempts >= MAX_FAILED_ATTEMPTS;
        await db
          .prepare('UPDATE accounts SET failed_attempts = ?, locked_until = ? WHERE owner_key = ?')
          .bind(locked ? 0 : attempts, locked ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null, ownerKey)
          .run();
        return reply(
          {
            error: locked
              ? `密码错误次数过多，请 ${LOCK_MINUTES} 分钟后再试`
              : `密码不正确，还可以再试 ${MAX_FAILED_ATTEMPTS - attempts} 次`,
          },
          401,
        );
      }

      await db.prepare('UPDATE accounts SET failed_attempts = 0, locked_until = NULL WHERE owner_key = ?').bind(ownerKey).run();
      const { token } = await createSession(ownerKey);
      const names = await readOwnerNames(db);
      return reply(
        { session: { ownerKey, name: displayName(names, ownerKey) } },
        200,
        sessionCookie(token, { secure }),
      );
    }

    if (body.action === 'setup') {
      const ownerKey = loginKey(body.ownerKey);
      if (!ownerKey) return reply({ error: '请选择要设置的身份' }, 400);
      const problem = passwordProblem(body.password);
      if (problem) return reply({ error: problem }, 400);

      if (await readAccount(ownerKey)) return reply({ error: '这个身份已经设置过密码，请直接登录' }, 409);

      // 只有两个人用的私人账本：第二位成员直接设置自己的密码即可，不再要求邀请码。
      // 代价是未认领的身份可能被先到先得，但这比每次都要人工传码省事。
      const record = await createPasswordRecord(String(body.password));
      const now = new Date().toISOString();
      await db
        .prepare('INSERT INTO accounts (owner_key, password_hash, password_salt, iterations, failed_attempts, locked_until, created_at, updated_at) VALUES (?,?,?,?,0,NULL,?,?)')
        .bind(ownerKey, record.hash, record.salt, record.iterations, now, now)
        .run();
      const { token } = await createSession(ownerKey);
      const names = await readOwnerNames(db);
      return reply(
        { session: { ownerKey, name: displayName(names, ownerKey) } },
        200,
        sessionCookie(token, { secure }),
      );
    }

    if (body.action === 'logout') {
      const session = await readSession(request).catch(() => null);
      if (session) await deleteSession(session.tokenHash);
      return reply({ ok: true }, 200, clearSessionCookie(secure));
    }

    if (body.action === 'password') {
      const session = await readSession(request);
      if (!session) return reply({ error: '请先登录' }, 401);
      const account = await readAccount(session.ownerKey);
      if (!account) return reply({ error: '账号状态异常，请重新登录' }, 400);
      if (typeof body.current !== 'string' || !(await verifyPassword(body.current, account))) {
        return reply({ error: '当前密码不正确' }, 401);
      }
      const problem = passwordProblem(body.next);
      if (problem) return reply({ error: problem }, 400);
      if (body.current === body.next) return reply({ error: '新密码不能和当前密码相同' }, 400);

      const record = await createPasswordRecord(String(body.next));
      await db
        .prepare('UPDATE accounts SET password_hash = ?, password_salt = ?, iterations = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE owner_key = ?')
        .bind(record.hash, record.salt, record.iterations, new Date().toISOString(), session.ownerKey)
        .run();
      // 其它设备上的登录态全部作废，只保留当前这台。
      await deleteOwnerSessions(session.ownerKey, session.tokenHash);
      return reply({ ok: true });
    }

    return reply({ error: '不支持的操作' }, 400);
  } catch (caught) {
    if (caught instanceof SyntaxError) return reply({ error: '请求格式无效' }, 400);
    console.error(caught);
    return reply({ error: caught instanceof Error ? caught.message : '操作失败，请重试' }, 400);
  }
}
