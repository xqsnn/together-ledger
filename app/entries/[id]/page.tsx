'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Check, ImagePlus, LoaderCircle, Pencil, RotateCcw, Trash2, UserRound, Users, X } from 'lucide-react';
import { MoneyBagIcon } from '@/components/money-bag-icon';
import PhotoGrid from '@/components/photo-grid';
import PhotoViewer from '@/components/photo-viewer';
import LoginScreen, { type AuthSession } from '@/components/login-screen';
import { DatePicker } from '@/components/date-picker';
import { TimePicker } from '@/components/time-picker';
import { Segmented } from '@/components/segmented';
import {
  dismissTask,
  enqueuePhotos,
  getServerSnapshot,
  getSnapshot,
  mergeUploadedMedia,
  onMediaUploaded,
  retryTask,
  setUploadLimits,
  subscribe,
  type UploadTask,
} from '@/lib/upload-queue';
import { chinaTime, toCents, type Entry, type OwnerKey } from '@/lib/ledger';
import {
  clearLedgerSnapshot,
  mergeLedgerSnapshot,
  readLedgerSnapshot,
  removeCachedEntry,
  updateCachedImages,
  writeLedgerSnapshot,
} from '@/lib/ledger-cache';
import { useIsomorphicLayoutEffect } from '@/hooks/use-isomorphic-layout-effect';
import type { MediaLimits, MediaMeta } from '@/lib/media';

type LedgerEntry = Entry & { images: MediaMeta[] };
type Ledger = {
  entries: LedgerEntry[];
  mediaLimits: MediaLimits;
  today: string;
  avatars: Partial<Record<OwnerKey, string>>;
  categories: { expense: string[]; income: string[] };
  owners: { key: OwnerKey; name: string }[];
  /** 首屏请求合并：账本接口直接带回登录态。 */
  session: AuthSession | null;
};

const money = (n: number) => (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ownerClass = (key: string) => (key === 'qing' ? 'qing' : key === 'hua' ? 'hua' : 'together');
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

/** 头像按版本号走 /api/avatars 强缓存；没有头像时回退默认图。 */
function avatarUrlFor(avatars: Partial<Record<OwnerKey, string>> | undefined, key: OwnerKey | undefined) {
  if (!key) return '';
  const version = avatars?.[key];
  if (version) return `/api/avatars?owner=${key}&v=${encodeURIComponent(version)}`;
  return key === 'hua' ? '/huang.jpg' : '';
}

function dateLabel(value: string) {
  const [, month, day] = value.split('-').map(Number);
  return `${month} 月 ${day} 日`;
}

function dayOfWeek(value: string) {
  return weekdays[(new Date(`${value}T00:00:00Z`).getUTCDay() + 6) % 7];
}

export default function EntryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const entryId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';

  const [session, setSession] = useState<AuthSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState<{ photos: MediaMeta[]; index: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const deleteRef = useRef<HTMLDialogElement>(null);

  // 编辑态（原来独立的 /entries/[id]/edit 页，现在并在这一页里）
  const [editing, setEditing] = useState(false);
  const [editType, setEditType] = useState<Entry['type']>('expense');
  const [editCategory, setEditCategory] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editOwner, setEditOwner] = useState<OwnerKey | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  const uploads = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

  // 只取这一条记录：详情页要的归属 / 分类 / 头像 / 额度一并返回，
  // 但不用为了看一笔账把整本账都拉下来。
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/ledger?entry=${encodeURIComponent(entryId)}`, { cache: 'no-store', signal });
    if (response.status === 401) {
      clearLedgerSnapshot();
      setSession(null);
      setChecked(true);
      return;
    }
    const result = (await response.json()) as Ledger & { error?: string };
    if (!response.ok) throw new Error(result.error || '加载失败');
    if (signal?.aborted) return;
    // 服务端登录态比缓存更新时（例如另一台设备刚改过名字）以服务端为准。
    if (result.session) setSession(result.session);
    setUploadLimits(result.mediaLimits);
    // 上传完成可能比这次响应更早：把刚传好的图补回来，避免图片「闪没」。
    const next = { ...result, entries: result.entries.map((entry) => mergeUploadedMedia(entry.id, entry)) };
    // 页面自己只留这一条；缓存里是整本账，用这条覆盖对应项后仍然完整。
    mergeLedgerSnapshot(next);
    setLedger(next);
    setError('');
  }, [entryId]);

  // 从首页点进来时，账目已经在模块缓存里：先把这一笔画出来，再去后台核对。
  useIsomorphicLayoutEffect(() => {
    const cached = readLedgerSnapshot();
    if (!cached) return;
    setLedger({ ...cached.ledger, session: cached.session });
    setSession(cached.session);
    setChecked(true);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        await load(controller.signal);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setChecked(true);
          setError(caught instanceof Error ? caught.message : '账本暂时无法加载，请重试');
        }
      }
    })();
    return () => controller.abort();
  }, [load]);

  // 上传完成 → 并进当前这份 ledger（否则要等下一次轮询才看得到）。
  useEffect(() => onMediaUploaded((targetId, media) => {
    setLedger((current) => current ? {
      ...current,
      entries: current.entries.map((item) => item.id === targetId && !item.images.some((photo) => photo.id === media.id)
        ? { ...item, images: [...item.images, media] }
        : item),
    } : current);
  }), []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const entry = ledger?.entries.find((item) => item.id === entryId) ?? null;
  const entryUploads = uploads.filter((item) => item.entryId === entryId);

  const startEditing = () => {
    if (!entry) return;
    setEditType(entry.type);
    setEditCategory(entry.category);
    setEditAmount((entry.amount / 100).toFixed(2));
    setEditOwner(entry.ownerKey);
    setEditDate(entry.date);
    setEditTime(entry.time || (entry.date === ledger?.today ? chinaTime() : '12:00'));
    setEditNote(entry.note);
    setEditError('');
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditError('');
  };

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!entry || editBusy) return;
    setEditError('');
    setEditBusy(true);
    try {
      if (!editOwner) throw new Error('请选择这笔账的归属');
      const response = await fetch('/api/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          mode: 'update',
          entry: {
            id: entry.id,
            revision: entry.revision,
            type: editType,
            amount: toCents(editAmount),
            ownerKey: editOwner,
            date: editDate,
            time: editTime,
            note: editNote,
            category: editCategory,
          },
        }),
      });
      const result = (await response.json()) as Ledger & { error?: string };
      if (!response.ok) throw new Error(result.error || '保存失败');
      setLedger(result);
      setUploadLimits(result.mediaLimits);
      // 编辑返回的是整本账，顺手刷新缓存，返回首页看到的就是改完的样子。
      writeLedgerSnapshot(result, session);
      setEditing(false);
      notify('已更新');
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setEditBusy(false);
    }
  }

  async function deletePhoto(mediaId: string) {
    const response = await fetch(`/api/media?id=${encodeURIComponent(mediaId)}`, { method: 'DELETE' });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error || '删除图片失败');
    if (!ledger) return;
    const entries = ledger.entries.map((item) => ({ ...item, images: item.images.filter((photo) => photo.id !== mediaId) }));
    const target = entries.find((item) => item.id === entryId);
    if (target) updateCachedImages(entryId, target.images);
    setLedger({ ...ledger, entries });
  }

  async function removeEntry() {
    if (!entry || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const response = await fetch('/api/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: entry.id, revision: entry.revision }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || '删除失败');
      removeCachedEntry(entry.id);
      router.replace('/');
    } catch (caught) {
      setDeleteBusy(false);
      setDeleting(false);
      notify(caught instanceof Error ? caught.message : '删除失败');
    }
  }

  useEffect(() => {
    const dialog = deleteRef.current;
    if (!dialog) return;
    if (deleting && !dialog.open) dialog.showModal();
    else if (!deleting && dialog.open) dialog.close();
  }, [deleting]);

  function goBack() {
    const state = window.history.state as { idx?: number } | null;
    if (typeof state?.idx === 'number' && state.idx > 0) router.back();
    else router.push('/');
  }

  if (!checked) {
    return <div className="entry-page entry-page-center"><div className="login-loading" role="status"><LoaderCircle className="spin" size={22} aria-hidden="true" />正在翻开账本…</div></div>;
  }
  if (!session) {
    return <LoginScreen onAuthenticated={(next) => { setSession(next); void load(); }} />;
  }

  const ownerNames: Record<string, string> = Object.fromEntries((ledger?.owners ?? []).map((item) => [item.key, item.name]));
  const avatar = avatarUrlFor(ledger?.avatars, entry?.ownerKey);
  const categoryList = ledger?.categories[editType] ?? [];
  const remaining = Math.max(0, (ledger?.mediaLimits?.maxPerEntry ?? 9) - (entry?.images.length ?? 0) - entryUploads.filter((task) => task.status !== 'error').length);
  // 代记：只有「谁记的」和「记在谁名下」不是同一人时才值得显示。
  const proxyAuthor = entry?.createdBy && entry.createdBy !== entry.ownerKey ? ownerNames[entry.createdBy] ?? entry.createdBy : '';

  return (
    <div className="entry-page">
      <header className="entry-page-bar">
        <button type="button" className="entry-back" aria-label="返回" onClick={goBack}><ArrowLeft size={20} /></button>
        <h1>{editing ? '编辑这一笔' : '这一笔'}</h1>
        <div className="entry-page-actions">
          {entry && !editing && (
            <>
              <button type="button" aria-label="编辑" onClick={startEditing}><Pencil size={18} /></button>
              <button type="button" aria-label="删除" onClick={() => setDeleting(true)}><Trash2 size={18} /></button>
            </>
          )}
        </div>
      </header>

      <main className="entry-page-main">
        {!ledger ? (
          <div className="empty panel" role="status">
            <LoaderCircle className="spin" size={24} />
            <h2>{error || '正在加载这一笔…'}</h2>
            {error && <button type="button" className="outline-button" onClick={() => { setError(''); void load(); }}>重试</button>}
          </div>
        ) : !entry ? (
          <div className="empty panel">
            <h2>{error || '记录不存在'}</h2>
            <p>它可能已经被删除了。</p>
            <button type="button" className="outline-button" onClick={() => router.push('/')}>回到账本</button>
          </div>
        ) : editing ? (
          <form className="entry-edit-form panel" onSubmit={saveEdit}>
            <Segmented className="type-tabs" active={editType} role="group" aria-label="记账类型">
              <button type="button" aria-pressed={editType === 'expense'} className={editType === 'expense' ? 'selected' : ''} onClick={() => { setEditType('expense'); if (!(ledger.categories.expense.includes(editCategory))) setEditCategory(ledger.categories.expense[0] ?? ''); }}>支出</button>
              <button type="button" aria-pressed={editType === 'income'} className={editType === 'income' ? 'selected income-tab' : ''} onClick={() => { setEditType('income'); if (!(ledger.categories.income.includes(editCategory))) setEditCategory(ledger.categories.income[0] ?? ''); }}>收入</button>
            </Segmented>

            <label className="amount-field">
              <span>金额</span>
              <div><b>¥</b><input aria-label="金额" inputMode="decimal" placeholder="0.00" value={editAmount} onChange={(event) => setEditAmount(event.target.value)} maxLength={12} required autoComplete="off" /></div>
            </label>

            <label className="form-field">备注<span className="optional">选填</span><input maxLength={100} placeholder="这一笔，是生活里的什么？" value={editNote} onChange={(event) => setEditNote(event.target.value)} /></label>

            <span className="field-label">分类</span>
            <div className="category-choices" role="group" aria-label="记账分类">
              {categoryList.map((item) => <button key={item} type="button" aria-pressed={editCategory === item} className={editCategory === item ? 'selected' : ''} onClick={() => setEditCategory(item)}>{item}</button>)}
            </div>

            <span className="field-label">记在谁的名下</span>
            <div className="owner-choices">
              {ledger.owners.map((item) => {
                const photo = avatarUrlFor(ledger.avatars, item.key);
                return (
                  <button key={item.key} type="button" aria-pressed={editOwner === item.key} className={`${ownerClass(item.key)}${editOwner === item.key ? ' selected' : ''}`} onClick={() => setEditOwner(item.key)}>
                    <span className={`owner-choice-avatar ${ownerClass(item.key)}${photo ? ' has-photo' : ''}`}>
                      {photo ? <span className="owner-choice-photo" style={{ backgroundImage: `url(${photo})` }} aria-hidden="true" /> : item.key === 'together' ? <Users size={19} aria-hidden="true" /> : <span className="owner-choice-initial">{item.name.slice(0, 1)}</span>}
                      <span className="owner-choice-check" aria-hidden="true"><Check size={10} strokeWidth={3} /></span>
                    </span>
                    <span className="owner-choice-name">{item.name}</span>
                  </button>
                );
              })}
            </div>

            <div className="form-field"><span>发生日期</span><DatePicker value={editDate} max={ledger.today} onChange={setEditDate} /></div>
            <div className="form-field"><span>发生时间</span><TimePicker value={editTime} max={editDate === ledger.today ? chinaTime() : undefined} onChange={setEditTime} /></div>

            {editError && <p className="form-error" role="alert">{editError}</p>}

            <div className="entry-edit-actions">
              <button type="button" className="outline-button" disabled={editBusy} onClick={cancelEditing}>取消</button>
              <button type="submit" className="primary" disabled={editBusy}>{editBusy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{editBusy ? '保存中…' : '保存修改'}</button>
            </div>
          </form>
        ) : (
          <>
            <section className={`entry-hero ${entry.type === 'income' ? 'income-bg' : 'expense-bg'}`} aria-label="这一笔的金额和备注">
              <span className="entry-hero-icon" aria-hidden="true">
                {entry.type === 'income' ? <MoneyBagIcon size={22} /> : <span className="entry-hero-yen">¥</span>}
              </span>
              <div className="entry-hero-copy">
                <span className="entry-hero-type">{entry.type === 'income' ? '收入' : '支出'} · {entry.category}</span>
                <strong className={entry.type === 'income' ? 'income' : 'expense'}>{entry.type === 'income' ? '+' : '−'} ¥ {money(entry.amount)}</strong>
                {entry.note && <p>{entry.note}</p>}
              </div>
              <span className={`tag ${ownerClass(entry.ownerKey)}`}>
                <i className="tag-avatar" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined} aria-hidden="true">
                  {avatar ? null : entry.ownerKey === 'together' ? <Users size={12} /> : <UserRound size={12} />}
                </i>
                {entry.owner}
              </span>
            </section>

            <p className="entry-when">
              {dateLabel(entry.date)} · 星期{dayOfWeek(entry.date)}
              {entry.time ? ` · ${entry.time}` : ''}
              {proxyAuthor ? ` · 代记为${proxyAuthor}` : ''}
            </p>

            <section className="entry-photos" aria-label="这一笔的图片">
              <input
                ref={photoInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                multiple
                hidden
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (files.length) enqueuePhotos(entryId, files, entry.images.length, notify);
                }}
              />
              <PhotoGrid photos={entry.images} onOpen={(index) => setViewer({ photos: entry.images, index })}>
                {entryUploads.map((task) => (
                  <UploadTile key={task.key} task={task} />
                ))}
                {remaining > 0 && (
                  <button type="button" className="photo-add" onClick={() => photoInput.current?.click()} aria-label="添加图片">
                    <ImagePlus size={20} aria-hidden="true" />
                    <span>{entry.images.length}/{ledger.mediaLimits?.maxPerEntry ?? 9}</span>
                  </button>
                )}
              </PhotoGrid>
            </section>
          </>
        )}
      </main>

      {viewer && <PhotoViewer photos={viewer.photos} index={viewer.index} onClose={() => setViewer(null)} onDelete={async (photo) => { await deletePhoto(photo.id).catch((caught: unknown) => notify(caught instanceof Error ? caught.message : '删除图片失败')); }} />}

      <dialog
        ref={deleteRef}
        className="modal confirm-modal"
        aria-labelledby="entry-delete-title"
        onCancel={(event) => { event.preventDefault(); if (!deleteBusy) setDeleting(false); }}
        onClick={(event) => { if (event.target === event.currentTarget && !deleteBusy) setDeleting(false); }}
      >
        <div className="modal-inner">
          <h2 id="entry-delete-title">删除这笔记录？</h2>
          <p>“{entry?.note || '这笔记录'}”将从共享账本删除，它的图片也会一起消失。</p>
          <div className="confirm-actions">
            <button type="button" className="outline-button" disabled={deleteBusy} onClick={() => setDeleting(false)}>再想想</button>
            <button type="button" className="danger-button" disabled={deleteBusy} onClick={() => void removeEntry()}>{deleteBusy ? '删除中…' : '确认删除'}</button>
          </div>
        </div>
      </dialog>

      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    </div>
  );
}

/** 正在上传/失败的图片瓦片：失败可以单张重试或移除。 */
function UploadTile({ task }: { task: UploadTask }) {
  return (
    <div className={`photo-tile${task.status === 'error' ? ' is-error' : ' is-uploading'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={task.preview} alt="" draggable={false} />
      {task.status === 'error' ? (
        <>
          <button type="button" className="photo-retry" onClick={() => retryTask(task.key)} aria-label={task.error || '重试上传'}>
            <RotateCcw size={16} />
          </button>
          <button type="button" className="photo-remove" onClick={() => dismissTask(task.key)} aria-label="移除这张图片">
            <X size={13} />
          </button>
        </>
      ) : (
        <span className="photo-progress" aria-label={`上传中 ${task.progress}%`}>
          <i style={{ width: `${task.progress}%` }} />
        </span>
      )}
    </div>
  );
}
