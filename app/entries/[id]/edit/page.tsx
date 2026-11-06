'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Check, JapaneseYen, LoaderCircle, UserRound, Users } from 'lucide-react';
import { MoneyBagIcon } from '@/components/money-bag-icon';
import { DatePicker } from '@/components/date-picker';
import { TimePicker } from '@/components/time-picker';
import { Segmented } from '@/components/segmented';
import LoginScreen, { type AuthSession } from '@/components/login-screen';
import { chinaTime, chinaToday, toCents, type Entry, type OwnerKey } from '@/lib/ledger';

type LedgerEntry = Entry & { images: { id: string }[] };
type Ledger = {
  entries: LedgerEntry[];
  today: string;
  avatars: Partial<Record<OwnerKey, string>>;
  categories: { expense: string[]; income: string[] };
  owners: { key: OwnerKey; name: string }[];
};

const ownerClass = (key: string) => (key === 'qing' ? 'qing' : key === 'hua' ? 'hua' : 'together');

export default function EditEntryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const entryId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';

  const [session, setSession] = useState<AuthSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [entryType, setEntryType] = useState<Entry['type']>('expense');
  const [entryCategory, setEntryCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedOwner, setSelectedOwner] = useState<OwnerKey | null>(null);
  const [date, setDate] = useState(chinaToday());
  const [entryTime, setEntryTime] = useState(chinaTime());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/ledger', { cache: 'no-store', signal });
    if (response.status === 401) {
      setSession(null);
      setChecked(true);
      return;
    }
    const result = (await response.json()) as Ledger & { error?: string };
    if (!response.ok) throw new Error(result.error || '加载失败');
    if (signal?.aborted) return;
    setLedger(result);
    const target = result.entries.find((item) => item.id === entryId);
    if (target) {
      setEntryType(target.type);
      setEntryCategory(target.category);
      setAmount((target.amount / 100).toFixed(2));
      setSelectedOwner(target.ownerKey);
      setDate(target.date);
      setEntryTime(target.time || '12:00');
      setNote(target.note);
      setReady(true);
    }
  }, [entryId]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch('/api/auth', { cache: 'no-store', signal: controller.signal });
        const info = response.ok ? (await response.json()) as { session: AuthSession | null } : { session: null };
        if (controller.signal.aborted) return;
        setSession(info.session ?? null);
        setChecked(true);
        if (info.session) await load(controller.signal);
      } catch {
        if (!controller.signal.aborted) {
          setChecked(true);
          setError('账本暂时无法加载');
        }
      }
    })();
    return () => controller.abort();
  }, [load]);

  const entry = ledger?.entries.find((item) => item.id === entryId) ?? null;
  const categoryList = ledger ? ledger.categories[entryType] : [];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!entry || busy) return;
    setError('');
    setBusy(true);
    try {
      if (!selectedOwner) throw new Error('请选择这笔账的归属');
      const response = await fetch('/api/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          mode: 'update',
          entry: {
            id: entry.id,
            revision: entry.revision,
            type: entryType,
            amount: toCents(amount),
            ownerKey: selectedOwner,
            date,
            time: entryTime,
            note,
            category: entryCategory,
          },
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || '保存失败');
      router.replace(`/entries/${entry.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    const state = window.history.state as { idx?: number } | null;
    if (typeof state?.idx === 'number' && state.idx > 0) router.back();
    else router.push(`/entries/${entryId}`);
  }

  if (!checked) {
    return <div className="entry-page entry-page-center"><div className="login-loading" role="status"><LoaderCircle className="spin" size={22} aria-hidden="true" />正在翻开账本…</div></div>;
  }
  if (!session) return <LoginScreen onAuthenticated={(next) => { setSession(next); void load(); }} />;

  return (
    <div className="entry-page">
      <header className="entry-page-bar">
        <button type="button" className="entry-back" aria-label="返回" onClick={goBack}><ArrowLeft size={20} /></button>
        <h1>编辑记录</h1>
        <span className="entry-page-actions" />
      </header>

      <main className="entry-page-main entry-edit-main">
        {!ready || !entry ? (
          <div className="empty panel">
            <h2>{error || '记录不存在'}</h2>
            <p>它可能已经被删除了。</p>
            <button type="button" className="outline-button" onClick={() => router.push('/')}>回到账本</button>
          </div>
        ) : (
          <form className="entry-edit-form panel" onSubmit={save}>
            <Segmented className="type-tabs" active={entryType} role="group" aria-label="记账类型">
              <button type="button" aria-pressed={entryType === 'expense'} className={entryType === 'expense' ? 'selected' : ''} onClick={() => { setEntryType('expense'); if (!ledger?.categories.expense.includes(entryCategory)) setEntryCategory(ledger?.categories.expense[0] ?? ''); }}><JapaneseYen size={17} strokeWidth={2} />支出</button>
              <button type="button" aria-pressed={entryType === 'income'} className={entryType === 'income' ? 'selected income-tab' : ''} onClick={() => { setEntryType('income'); if (!ledger?.categories.income.includes(entryCategory)) setEntryCategory(ledger?.categories.income[0] ?? ''); }}><MoneyBagIcon size={17} />收入</button>
            </Segmented>

            <label className="amount-field">
              <span>金额</span>
              <div><b>¥</b><input aria-label="金额" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={12} required autoComplete="off" /></div>
            </label>

            <span className="field-label">记在谁的名下 <span>*</span></span>
            <div className="owner-choices">
              {(ledger?.owners ?? []).map((item) => {
                const photo = ledger?.avatars?.[item.key] ?? (item.key === 'hua' ? '/huang.jpg' : '');
                return (
                  <button key={item.key} type="button" aria-pressed={selectedOwner === item.key} className={`${ownerClass(item.key)}${selectedOwner === item.key ? ' selected' : ''}`} onClick={() => setSelectedOwner(item.key)}>
                    <span className={`owner-choice-avatar ${ownerClass(item.key)}${photo ? ' has-photo' : ''}`}>
                      {photo ? <span className="owner-choice-photo" style={{ backgroundImage: `url(${photo})` }} aria-hidden="true" /> : item.key === 'together' ? <Users size={19} aria-hidden="true" /> : <UserRound size={19} aria-hidden="true" />}
                      <span className="owner-choice-check" aria-hidden="true"><Check size={10} strokeWidth={3} /></span>
                    </span>
                    <span className="owner-choice-name">{item.name}</span>
                  </button>
                );
              })}
            </div>

            <span className="field-label">分类 <span>*</span></span>
            <div className="category-choices" role="group" aria-label="记账分类">
              {categoryList.map((item) => <button key={item} type="button" aria-pressed={entryCategory === item} className={entryCategory === item ? 'selected' : ''} onClick={() => setEntryCategory(item)}>{item}</button>)}
            </div>

            <div className="form-field"><span>发生日期</span><DatePicker value={date} max={ledger?.today ?? chinaToday()} onChange={setDate} /></div>
            <div className="form-field"><span>发生时间</span><TimePicker value={entryTime} max={date === (ledger?.today ?? chinaToday()) ? chinaTime() : undefined} onChange={setEntryTime} /></div>
            <label className="form-field">备注<span className="optional">选填</span><input maxLength={100} placeholder="这一笔，是生活里的什么？" value={note} onChange={(event) => setNote(event.target.value)} /></label>

            {error && <p className="form-error" role="alert">{error}</p>}

            <div className="entry-edit-actions">
              <button type="button" className="outline-button" disabled={busy} onClick={goBack}>取消</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{busy ? '保存中…' : '保存修改'}</button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
