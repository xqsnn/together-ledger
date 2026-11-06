'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Check, ImagePlus, LoaderCircle, MoreHorizontal, Pencil, Trash2, UserRound, Users } from 'lucide-react';
import { MoneyBagIcon } from '@/components/money-bag-icon';
import PhotoCarousel from '@/components/photo-carousel';
import PhotoViewer from '@/components/photo-viewer';
import EntryComments, { type UploadTask } from '@/components/entry-comments';
import LoginScreen, { type AuthSession } from '@/components/login-screen';
import { prepareImage, uploadMedia } from '@/lib/image-client';
import { takePendingPhotos } from '@/lib/pending-uploads';
import type { CommentRecord, MediaLimits, MediaMeta } from '@/lib/media';
import type { Entry, OwnerKey } from '@/lib/ledger';

type LedgerEntry = Entry & { images: MediaMeta[] };
type Ledger = {
  entries: LedgerEntry[];
  comments: CommentRecord[];
  mediaLimits: MediaLimits;
  today: string;
  avatars: Partial<Record<OwnerKey, string>>;
  owners: { key: OwnerKey; name: string }[];
};

const DEFAULT_LIMITS: MediaLimits = { mode: 'd1', maxBytes: 700000, maxThumbBytes: 120000, maxPerEntry: 9, maxPerComment: 3 };
const money = (n: number) => (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ownerClass = (key: string) => (key === 'qing' ? 'qing' : key === 'hua' ? 'hua' : 'together');
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

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
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toast, setToast] = useState('');
  const uploadsRef = useRef<UploadTask[]>([]);
  const uploadRunning = useRef(false);
  const limitsRef = useRef<MediaLimits>(DEFAULT_LIMITS);
  const photoInput = useRef<HTMLInputElement>(null);
  const deleteRef = useRef<HTMLDialogElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);

  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

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
    setError('');
    limitsRef.current = result.mediaLimits ?? DEFAULT_LIMITS;
  }, []);

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
          setError('账本暂时无法加载，请重试');
        }
      }
    })();
    return () => controller.abort();
  }, [load]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    uploadsRef.current.forEach((item) => URL.revokeObjectURL(item.preview));
  }, []);

  const entry = ledger?.entries.find((item) => item.id === entryId) ?? null;
  const comments = ledger ? ledger.comments.filter((comment) => comment.entryId === entryId) : [];

  function updateUploads(updater: (items: UploadTask[]) => UploadTask[]) {
    const next = updater(uploadsRef.current);
    uploadsRef.current = next;
    setUploads(next);
  }

  function patchUpload(key: string, patch: Partial<UploadTask>) {
    updateUploads((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function mergeMedia(target: { entryId: string; commentId?: string }, media: MediaMeta) {
    setLedger((current) => {
      if (!current) return current;
      if (target.commentId) {
        return {
          ...current,
          comments: current.comments.map((comment) => comment.id === target.commentId && !comment.images.some((item) => item.id === media.id)
            ? { ...comment, images: [...comment.images, media] }
            : comment),
        };
      }
      return {
        ...current,
        entries: current.entries.map((item) => item.id === target.entryId && !item.images.some((photo) => photo.id === media.id)
          ? { ...item, images: [...item.images, media] }
          : item),
      };
    });
  }

  async function processUpload(item: UploadTask) {
    patchUpload(item.key, { status: 'preparing', progress: 2 });
    try {
      const prepared = await prepareImage(item.file, limitsRef.current);
      patchUpload(item.key, { status: 'uploading', progress: 4 });
      const media = await uploadMedia({
        id: item.mediaId,
        target: item.commentId ? 'comment' : 'entry',
        targetId: item.commentId ?? item.entryId,
        full: prepared.full,
        thumb: prepared.thumb,
        width: prepared.width,
        height: prepared.height,
      }, (progress) => patchUpload(item.key, { progress: Math.max(4, progress) }));
      mergeMedia({ entryId: item.entryId, commentId: item.commentId }, media);
      patchUpload(item.key, { status: 'done', progress: 100 });
      setTimeout(() => {
        updateUploads((items) => items.filter((current) => current.key !== item.key));
        URL.revokeObjectURL(item.preview);
      }, 500);
    } catch (caught) {
      patchUpload(item.key, { status: 'error', error: caught instanceof Error ? caught.message : '上传失败' });
    }
  }

  async function runQueue() {
    if (uploadRunning.current) return;
    uploadRunning.current = true;
    try {
      for (;;) {
        const pending = uploadsRef.current.filter((item) => item.status === 'pending');
        if (!pending.length) break;
        await processUpload(pending[0]);
      }
    } finally {
      uploadRunning.current = false;
    }
  }

  function enqueueEntryPhotos(files: File[]) {
    if (!files.length) return;
    const pending = uploadsRef.current.filter((item) => !item.commentId && item.status !== 'error').length;
    const room = Math.max(0, limitsRef.current.maxPerEntry - (entry?.images.length ?? 0) - pending);
    if (files.length > room) notify(`每条记录最多 ${limitsRef.current.maxPerEntry} 张图片`);
    if (!room) return;
    const added: UploadTask[] = files.slice(0, room).map((file) => ({
      key: crypto.randomUUID(),
      mediaId: crypto.randomUUID(),
      entryId,
      file,
      preview: URL.createObjectURL(file),
      status: 'pending',
      progress: 0,
    }));
    updateUploads((items) => [...items, ...added]);
    void runQueue();
  }

  // 新建记录时暂存的图片，进入详情页后自动续传。
  useEffect(() => {
    if (!entry || startedRef.current) return;
    startedRef.current = true;
    const files = takePendingPhotos(entry.id);
    if (files.length) enqueueEntryPhotos(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  async function mutate(body: Record<string, unknown>) {
    const response = await fetch('/api/ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as Ledger & { error?: string };
    if (!response.ok) throw new Error(result.error || '操作失败');
    setLedger(result);
    limitsRef.current = result.mediaLimits ?? DEFAULT_LIMITS;
    return result;
  }

  async function addComment(input: { id: string; entryId: string; parentId?: string; body: string }, files: File[]) {
    await mutate({ action: 'comment-add', comment: input });
    if (files.length) {
      const added: UploadTask[] = files.map((file) => ({
        key: crypto.randomUUID(),
        mediaId: crypto.randomUUID(),
        entryId,
        commentId: input.id,
        file,
        preview: URL.createObjectURL(file),
        status: 'pending',
        progress: 0,
      }));
      updateUploads((items) => [...items, ...added]);
      void runQueue();
    }
  }

  async function likeComment(id: string) {
    await mutate({ action: 'comment-like', id });
  }

  async function deleteComment(id: string) {
    await mutate({ action: 'comment-delete', id });
  }

  async function deletePhoto(mediaId: string) {
    const response = await fetch(`/api/media?id=${encodeURIComponent(mediaId)}`, { method: 'DELETE' });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error || '删除图片失败');
    setLedger((current) => current ? {
      ...current,
      entries: current.entries.map((item) => ({ ...item, images: item.images.filter((photo) => photo.id !== mediaId) })),
    } : current);
  }

  async function removeEntry() {
    if (!entry || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await mutate({ action: 'delete', id: entry.id, revision: entry.revision });
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
  const authorKey = (entry?.createdBy ?? entry?.ownerKey ?? 'together') as OwnerKey;
  const entryUploads = uploads.filter((item) => !item.commentId && item.status !== 'done');
  const pendingEntry = entryUploads.filter((item) => item.status !== 'error').length;
  const remaining = Math.max(0, (ledger?.mediaLimits ?? DEFAULT_LIMITS).maxPerEntry - (entry?.images.length ?? 0) - pendingEntry);

  return (
    <div className="entry-page">
      <header className="entry-page-bar">
        <button type="button" className="entry-back" aria-label="返回" onClick={goBack}><ArrowLeft size={20} /></button>
        <h1>记录详情</h1>
        <div className="entry-page-actions entry-menu-wrap">
          <button type="button" className="entry-more" aria-label="更多操作" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            <MoreHorizontal size={19} />
          </button>
          {menuOpen && (
            <>
              <button type="button" className="entry-menu-backdrop" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} />
              <div className="entry-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); router.push(`/entries/${entryId}/edit`); }}>
                  <Pencil size={15} />编辑
                </button>
                <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); setDeleting(true); }}>
                  <Trash2 size={15} />删除
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {!entry ? (
        <main className="entry-page-main">
          <div className="empty panel">
            <h2>{error || '记录不存在'}</h2>
            <p>它可能已经被删除了。</p>
            <button type="button" className="outline-button" onClick={() => router.push('/')}>回到账本</button>
          </div>
        </main>
      ) : (
        <main className="entry-page-main">
          <section className="entry-gallery" aria-label="记录图片">
            <input
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                enqueueEntryPhotos(files);
              }}
            />
            {entry.images.length > 0 ? (
              <PhotoCarousel photos={entry.images} onOpen={(index) => setViewer({ photos: entry.images, index })} />
            ) : (
              <button type="button" className="gallery-empty" onClick={() => photoInput.current?.click()} disabled={remaining <= 0}>
                <ImagePlus size={22} aria-hidden="true" />
                <span>{remaining > 0 ? '添加照片' : '图片已达上限'}</span>
              </button>
            )}
            {entryUploads.length > 0 && (
              <div className="gallery-uploads">
                {entryUploads.map((item) => (
                  <div className={`gallery-upload${item.status === 'error' ? ' is-error' : ''}`} key={item.key}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.preview} alt="" draggable={false} />
                    <span className="gallery-upload-label">
                      {item.status === 'error' ? '失败' : <><LoaderCircle className="spin" size={11} />{item.progress}%</>}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {entry.images.length > 0 && (
              <div className="gallery-bar">
                <span>{entry.images.length} 张图片</span>
                {remaining > 0 && (
                  <button type="button" className="text-button" onClick={() => photoInput.current?.click()}>
                    <ImagePlus size={15} />添加照片
                  </button>
                )}
              </div>
            )}
          </section>

          <section className={`entry-hero ${entry.type === 'income' ? 'income-bg' : 'expense-bg'}`} aria-label="这一笔的金额和备注">
            <span className="entry-hero-icon" aria-hidden="true">
              {entry.type === 'income' ? <MoneyBagIcon size={22} /> : <span className="entry-hero-yen">¥</span>}
            </span>
            <div className="entry-hero-copy">
              <span className="entry-hero-type">{entry.type === 'income' ? '收入' : '支出'} · {entry.category}</span>
              <strong className={entry.type === 'income' ? 'income' : 'expense'}>{entry.type === 'income' ? '+' : '−'} ¥ {money(entry.amount)}</strong>
              <p>{entry.note || (entry.type === 'income' ? '一笔收入' : '一笔支出')}</p>
            </div>
            <span className={`tag ${ownerClass(entry.ownerKey)}`}>
              <i className="tag-avatar" style={ledger?.avatars?.[entry.ownerKey] ? { backgroundImage: `url(${ledger.avatars[entry.ownerKey]})` } : undefined} aria-hidden="true">
                {ledger?.avatars?.[entry.ownerKey] ? null : entry.ownerKey === 'together' ? <Users size={12} /> : <UserRound size={12} />}
              </i>
              {entry.owner}
            </span>
          </section>

          <dl className="entry-meta">
            <div><dt>发生日期</dt><dd>{dateLabel(entry.date)} · 星期{dayOfWeek(entry.date)}{entry.time ? ` · ${entry.time}` : ''}</dd></div>
            <div><dt>归属</dt><dd>{entry.owner}</dd></div>
            <div><dt>分类</dt><dd>{entry.category}</dd></div>
            <div><dt>记录人</dt><dd>{entry.createdBy ? ownerNames[entry.createdBy] ?? entry.createdBy : '共同'}</dd></div>
          </dl>

          <EntryComments
            entryId={entryId}
            authorKey={authorKey}
            comments={comments}
            avatars={ledger?.avatars ?? {}}
            ownerNames={ownerNames}
            maxImages={ledger?.mediaLimits?.maxPerComment ?? 3}
            uploads={uploads}
            onAdd={addComment}
            onLike={likeComment}
            onDelete={deleteComment}
            onOpenPhoto={(photos, index) => setViewer({ photos, index })}
            notify={notify}
          />
        </main>
      )}

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
          <p>“{entry?.note || '这笔记录'}”将从共享账本删除，图片和评论也会一起消失。</p>
          <div className="confirm-actions">
            <button type="button" className="outline-button" disabled={deleteBusy} onClick={() => setDeleting(false)}>再想想</button>
            <button type="button" className="danger-button" disabled={deleteBusy} onClick={() => void removeEntry()}>{deleteBusy ? '删除中…' : '确认删除'}</button>
          </div>
        </div>
      </dialog>

      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
      {error && <div className="toast" role="alert">{error}<button type="button" onClick={() => { setError(''); void load(); }}>重试</button></div>}
    </div>
  );
}
