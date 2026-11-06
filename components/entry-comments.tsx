'use client';

import { useMemo, useRef, useState } from 'react';
import { Heart, ImagePlus, LoaderCircle, Send, Trash2, X } from 'lucide-react';
import PhotoGrid from './photo-grid';
import type { CommentRecord, MediaMeta } from '@/lib/media';
import type { OwnerKey } from '@/lib/ledger';

export type UploadTask = {
  key: string;
  mediaId: string;
  entryId: string;
  commentId?: string;
  file: File;
  preview: string;
  status: 'pending' | 'preparing' | 'uploading' | 'error' | 'done';
  progress: number;
  error?: string;
};

type Props = {
  entryId: string;
  /** 记账人：给 TA 的评论标「作者」，和小红书一样。 */
  authorKey: OwnerKey;
  comments: CommentRecord[];
  avatars: Partial<Record<OwnerKey, string>>;
  ownerNames: Record<string, string>;
  maxImages: number;
  uploads: UploadTask[];
  onAdd: (input: { id: string; entryId: string; parentId?: string; body: string }, files: File[]) => Promise<void>;
  onLike: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenPhoto: (photos: MediaMeta[], index: number) => void;
  notify: (message: string) => void;
};

const ownerClass = (key: string) => (key === 'qing' ? 'qing' : key === 'hua' ? 'hua' : 'together');

function relativeTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const diff = Date.now() - time;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(time));
}

function Avatar({ ownerKey, avatars, size = 'normal' }: { ownerKey: string; avatars: Partial<Record<OwnerKey, string>>; size?: 'normal' | 'small' }) {
  const photo = avatars[ownerKey as OwnerKey];
  return (
    <span className={`comment-avatar ${ownerClass(ownerKey)} ${size === 'small' ? 'small' : ''}`} style={photo ? { backgroundImage: `url(${photo})` } : undefined} aria-hidden="true">
      {photo ? null : ownerKey === 'together' ? '共' : (ownerKey === 'qing' ? '青' : ownerKey === 'hua' ? '华' : ownerKey.slice(0, 1))}
    </span>
  );
}

export default function EntryComments({ entryId, authorKey, comments, avatars, ownerNames, maxImages, uploads, onAdd, onLike, onDelete, onOpenPhoto, notify }: Props) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<{ key: string; file: File; preview: string }[]>([]);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [sort, setSort] = useState<'latest' | 'hot'>('latest');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [liking, setLiking] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const nameOf = (key: string | null | undefined) => (key ? ownerNames[key] ?? key : '');

  const { roots, repliesByParent } = useMemo(() => {
    const tops = comments.filter((comment) => !comment.parentId);
    const sorted = [...tops].sort((a, b) => (sort === 'hot'
      ? b.likeCount - a.likeCount || b.createdAt.localeCompare(a.createdAt)
      : b.createdAt.localeCompare(a.createdAt)));
    const map = new Map<string, CommentRecord[]>();
    comments
      .filter((comment) => comment.parentId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .forEach((comment) => {
        const list = map.get(comment.parentId!) ?? [];
        list.push(comment);
        map.set(comment.parentId!, list);
      });
    return { roots: sorted, repliesByParent: map };
  }, [comments, sort]);

  function pickImages(list: FileList | null) {
    if (!list?.length) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= maxImages) {
        notify(`每条评论最多 ${maxImages} 张图片`);
        break;
      }
      if (!file.type.startsWith('image/')) {
        notify('请选择图片文件');
        continue;
      }
      next.push({ key: crypto.randomUUID(), file, preview: URL.createObjectURL(file) });
    }
    setFiles(next);
  }

  function removeFile(key: string) {
    const target = files.find((item) => item.key === key);
    if (target) URL.revokeObjectURL(target.preview);
    setFiles(files.filter((item) => item.key !== key));
  }

  function startReply(comment: CommentRecord) {
    setReplyTo({ id: comment.id, name: nameOf(comment.createdBy) });
    setError('');
    textRef.current?.focus();
  }

  async function submit() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    const selected = files.map((item) => item.file);
    try {
      await onAdd({ id: crypto.randomUUID(), entryId, parentId: replyTo?.id, body: text }, selected);
      files.forEach((item) => URL.revokeObjectURL(item.preview));
      setFiles([]);
      setBody('');
      setReplyTo(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '评论发送失败');
    } finally {
      setSending(false);
    }
  }

  async function like(id: string) {
    if (liking) return;
    setLiking(id);
    try {
      await onLike(id);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setLiking(null);
    }
  }

  async function remove(id: string) {
    setRemoving(id);
    try {
      await onDelete(id);
      setConfirming(null);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '删除评论失败');
    } finally {
      setRemoving(null);
    }
  }

  function renderComment(comment: CommentRecord, isReply = false) {
    const name = nameOf(comment.createdBy);
    const commentUploads = uploads.filter((item) => item.commentId === comment.id && item.status !== 'done');
    return (
      <article className={`comment-item${isReply ? ' is-reply' : ''}`} key={comment.id}>
        <Avatar ownerKey={comment.createdBy} avatars={avatars} size={isReply ? 'small' : 'normal'} />
        <div className="comment-main">
          <div className="comment-top">
            <span className="comment-name">{name}</span>
            {comment.createdBy === authorKey && <span className="comment-badge">作者</span>}
            <time dateTime={comment.createdAt}>{relativeTime(comment.createdAt)}</time>
          </div>
          <p className="comment-text">
            {comment.replyToOwner && <span className="comment-reply-to">回复 @{nameOf(comment.replyToOwner)}：</span>}
            {comment.body}
          </p>
          {comment.images.length > 0 && (
            <div className="comment-photos">
              <PhotoGrid photos={comment.images} onOpen={(index) => onOpenPhoto(comment.images, index)} />
            </div>
          )}
          {commentUploads.length > 0 && (
            <div className="comment-photos">
              <div className="comment-uploading">
                {commentUploads.map((item) => (
                  <span className="comment-upload-tile" key={item.key}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.preview} alt="" />
                    <i className="upload-shade">{item.status === 'error' ? '失败' : `${item.progress}%`}</i>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="comment-actions">
            <button type="button" className={`comment-action${comment.likedByMe ? ' is-liked' : ''}`} aria-pressed={comment.likedByMe} disabled={liking === comment.id} onClick={() => void like(comment.id)}>
              <Heart size={15} fill={comment.likedByMe ? 'currentColor' : 'none'} aria-hidden="true" />
              {comment.likeCount > 0 ? comment.likeCount : '赞'}
            </button>
            <button type="button" className="comment-action" onClick={() => startReply(comment)}>回复</button>
            {confirming === comment.id ? (
              <span className="comment-confirm">
                <button type="button" className="danger" disabled={removing === comment.id} onClick={() => void remove(comment.id)}>{removing === comment.id ? '删除中…' : '确认删除'}</button>
                <button type="button" onClick={() => setConfirming(null)}>取消</button>
              </span>
            ) : (
              <button type="button" className="comment-delete" aria-label="删除评论" onClick={() => setConfirming(comment.id)}><Trash2 size={13} /></button>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <>
      <section className="comments" aria-label="评论">
        <header className="comments-head">
          <h2>共 {comments.length} 条评论</h2>
          <div className="comments-sort" role="group" aria-label="评论排序">
            <button type="button" aria-pressed={sort === 'latest'} className={sort === 'latest' ? 'active' : ''} onClick={() => setSort('latest')}>最新</button>
            <button type="button" aria-pressed={sort === 'hot'} className={sort === 'hot' ? 'active' : ''} onClick={() => setSort('hot')}>最热</button>
          </div>
        </header>
        {roots.length ? roots.map((comment) => (
          <div className="comment-thread-item" key={comment.id}>
            {renderComment(comment)}
            {(repliesByParent.get(comment.id) ?? []).map((reply) => renderComment(reply, true))}
          </div>
        )) : (
          <p className="comments-empty">还没有评论，来说点什么吧。</p>
        )}
      </section>

      <div className={`comment-composer${replyTo ? ' is-replying' : ''}`}>
        {replyTo && (
          <div className="composer-reply">
            <span>回复 @{replyTo.name}</span>
            <button type="button" aria-label="取消回复" onClick={() => setReplyTo(null)}><X size={13} /></button>
          </div>
        )}
        {files.length > 0 && (
          <div className="composer-files">
            {files.map((item) => (
              <span className="composer-file" key={item.key}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.preview} alt="" />
                <button type="button" aria-label="移除图片" onClick={() => removeFile(item.key)}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="composer-row">
          <textarea
            ref={textRef}
            rows={1}
            maxLength={300}
            value={body}
            placeholder={replyTo ? `回复 @${replyTo.name}…` : '说点什么…'}
            aria-label="写评论"
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <button type="button" className="composer-icon" aria-label="添加图片" disabled={sending || files.length >= maxImages} onClick={() => inputRef.current?.click()}>
            <ImagePlus size={19} />
          </button>
          <button type="button" className="composer-send" disabled={!body.trim() || sending} onClick={() => void submit()}>
            {sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
            <span>{sending ? '发送中' : '发送'}</span>
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          hidden
          onChange={(event) => {
            pickImages(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
    </>
  );
}
