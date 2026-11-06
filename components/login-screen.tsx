'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Check, LoaderCircle, Lock, UserRound } from 'lucide-react';
import Duo from '@/components/duo';
import type { OwnerKey } from '@/lib/ledger';

export type AuthSession = { ownerKey: OwnerKey; name: string };
type AuthOwner = { key: OwnerKey; name: string; claimed: boolean };
type AuthInfo = { session: AuthSession | null; owners: AuthOwner[]; bootstrap: boolean };

const ownerClass = (key: string) => (key === 'qing' ? 'qing' : key === 'hua' ? 'hua' : 'together');

/**
 * 登录门禁：两个身份各有一个密码。
 * 「共同」不是账号，所以这里只出现青和华。
 */
export default function LoginScreen({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
  const [info, setInfo] = useState<AuthInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<OwnerKey | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [reloadKey, setReloadKey] = useState(0);

  // 与页面其它数据加载保持一致：用 .then 链，避免在 effect 内同步 setState。
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const result = (await response.json()) as AuthInfo & { error?: string };
        if (!response.ok) throw new Error(result.error || '登录服务不可用');
        if (controller.signal.aborted) return;
        setLoadError('');
        setInfo(result);
        if (result.session) onAuthenticated(result.session);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(caught instanceof Error ? caught.message : '登录服务不可用');
      });
    return () => controller.abort();
  }, [reloadKey, onAuthenticated]);

  const target = info?.owners.find((owner) => owner.key === selected) ?? null;
  const setupMode = Boolean(target && !target.claimed);

  function reset() {
    setSelected(null);
    setPassword('');
    setConfirm('');
    setCode('');
    setError('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!target || busy) return;
    setError('');
    if (setupMode && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          setupMode
            ? { action: 'setup', ownerKey: target.key, password, code }
            : { action: 'login', ownerKey: target.key, password },
        ),
      });
      const result = (await response.json()) as { session?: AuthSession; error?: string };
      if (!response.ok || !result.session) throw new Error(result.error || '登录失败');
      onAuthenticated(result.session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登录失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <Duo />
          <h1>两人账本</h1>
          <p>{selected ? (setupMode ? '给这个身份设置一个登录密码。' : '输入密码，回到你们的账本。') : '先确认是你，再一起记账。'}</p>
        </div>

        {loadError ? (
          <div className="login-error" role="alert">
            <p>{loadError}</p>
            <button className="outline-button" onClick={() => setReloadKey((key) => key + 1)}>重新连接</button>
          </div>
        ) : !info ? (
          <div className="login-loading" role="status"><LoaderCircle className="spin" size={22} />正在连接账本…</div>
        ) : !selected ? (
          <>
            <div className="login-owners" role="group" aria-label="选择身份">
              {info.owners.map((owner) => (
                <button
                  key={owner.key}
                  type="button"
                  className={`login-owner ${ownerClass(owner.key)}`}
                  onClick={() => { setSelected(owner.key); setError(''); setPassword(''); setConfirm(''); setCode(''); }}
                >
                  <span className={`login-owner-avatar ${ownerClass(owner.key)}`}><UserRound size={20} aria-hidden="true" /></span>
                  <span className="login-owner-name">{owner.name}</span>
                  <span className="login-owner-state">{owner.claimed ? '输入密码' : '首次设置'}</span>
                </button>
              ))}
            </div>
            <p className="login-hint">「共同」是记账的归属，不是登录身份，谁记都可以选它。</p>
          </>
        ) : (
          <form className="login-form" onSubmit={submit}>
            <div className="login-target">
              <span className={`login-owner-avatar small ${ownerClass(target!.key)}`}><UserRound size={16} aria-hidden="true" /></span>
              <strong>{target!.name}</strong>
              {setupMode && <em>首次设置</em>}
            </div>

            <label className="login-field">
              <span>{setupMode ? '设置密码' : '密码'}</span>
              <input
                type="password"
                autoFocus
                required
                autoComplete={setupMode ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={setupMode ? '至少 6 位' : '请输入密码'}
              />
            </label>

            {setupMode && (
              <label className="login-field">
                <span>确认密码</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="再输入一次"
                />
              </label>
            )}

            {setupMode && !info.bootstrap && (
              <label className="login-field">
                <span>邀请码</span>
                <input
                  inputMode="text"
                  maxLength={12}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="对方在设置里生成"
                />
                <small>第一次设置需要另一位已登录的成员为你生成邀请码。</small>
              </label>
            )}

            {setupMode && info.bootstrap && (
              <p className="login-note"><Lock size={14} aria-hidden="true" />这是账本的第一个账号，设置好之后，另一位需要在设置页里拿到邀请码才能设置。</p>
            )}

            {error && <p className="login-error-text" role="alert">{error}</p>}

            <div className="login-actions">
              <button type="button" className="login-back" onClick={reset} disabled={busy}>
                <ArrowLeft size={16} />换一个身份
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}
                {busy ? '请稍候…' : setupMode ? '设置并登录' : '登录'}
              </button>
            </div>
          </form>
        )}

        <p className="login-foot">登录状态会保留 180 天，常用设备不用反复登录。</p>
      </section>
    </div>
  );
}
