'use client';

/**
 * 记录配图的上传队列。
 *
 * 放在模块级而不是组件 state 里，是因为「新建记录后停在首页」意味着上传要在
 * 首页进行，而用户随时可能点进详情页——组件会被路由卸载，队列必须活得比页面久。
 *
 * 约束：队列在内存里。整页刷新/关标签页时未传完的图会丢，所以有任务时挂
 * beforeunload 拦一下。记录本身早就落库了，丢的只是图。
 */

import { prepareImage, uploadMedia } from './image-client';
import { IMAGE_LIMITS, MAX_ENTRY_IMAGES, type MediaLimits, type MediaMeta } from './media';

export type UploadTask = {
  key: string;
  mediaId: string;
  entryId: string;
  file: File;
  preview: string;
  status: 'pending' | 'preparing' | 'uploading' | 'error';
  progress: number;
  error?: string;
};

const DEFAULT_LIMITS: MediaLimits = {
  mode: 'd1',
  maxBytes: IMAGE_LIMITS.d1.maxBytes,
  maxThumbBytes: IMAGE_LIMITS.d1.maxThumbBytes,
  maxPerEntry: MAX_ENTRY_IMAGES,
};

let tasks: UploadTask[] = [];
const EMPTY: UploadTask[] = [];
let running = false;
let limits: MediaLimits = DEFAULT_LIMITS;
let beforeUnloadBound = false;

const listeners = new Set<() => void>();
const mediaListeners = new Set<(entryId: string, media: MediaMeta) => void>();
/** 已上传但可能还没出现在轮询结果里的图片，刷新账目时用它补齐，避免图片「闪没」。 */
const uploadedByEntry = new Map<string, MediaMeta[]>();

function emit() {
  // useSyncExternalStore 靠引用变化判断更新，所以每次都换一个新数组。
  tasks = [...tasks];
  listeners.forEach((listener) => listener());
}

function patch(key: string, changes: Partial<UploadTask>) {
  const index = tasks.findIndex((task) => task.key === key);
  if (index < 0) return;
  tasks[index] = { ...tasks[index], ...changes };
  emit();
}

function drop(key: string) {
  const target = tasks.find((task) => task.key === key);
  if (!target) return;
  URL.revokeObjectURL(target.preview);
  tasks = tasks.filter((task) => task.key !== key);
  emit();
}

function syncBeforeUnload() {
  if (typeof window === 'undefined') return;
  const needed = tasks.length > 0;
  if (needed && !beforeUnloadBound) {
    window.addEventListener('beforeunload', blockWhileUploading);
    beforeUnloadBound = true;
  } else if (!needed && beforeUnloadBound) {
    window.removeEventListener('beforeunload', blockWhileUploading);
    beforeUnloadBound = false;
  }
}

function blockWhileUploading(event: BeforeUnloadEvent) {
  event.preventDefault();
  // 部分浏览器仍需要 returnValue 才会弹确认框。
  event.returnValue = '';
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getSnapshot(): UploadTask[] {
  return tasks;
}

export function getServerSnapshot(): UploadTask[] {
  return EMPTY;
}

/** 详情页拉到的媒体上限（R2 / D1 兜底不同）同步给队列。 */
export function setUploadLimits(next: MediaLimits | undefined) {
  if (next) limits = next;
}

/** 注册「某张图传好了」的回调，页面用它把图片并进自己那份 ledger 状态。 */
export function onMediaUploaded(listener: (entryId: string, media: MediaMeta) => void): () => void {
  mediaListeners.add(listener);
  return () => { mediaListeners.delete(listener); };
}

/** 轮询刷新后补齐还没回到响应里的图片。 */
export function mergeUploadedMedia<T extends { id: string; images: MediaMeta[] }>(entryId: string, entry: T): T {
  const pending = uploadedByEntry.get(entryId);
  if (!pending?.length) return entry;
  const missing = pending.filter((media) => !entry.images.some((item) => item.id === media.id));
  if (!missing.length) {
    uploadedByEntry.delete(entryId);
    return entry;
  }
  return { ...entry, images: [...entry.images, ...missing] };
}

export function taskStats(entryId: string) {
  const mine = tasks.filter((task) => task.entryId === entryId);
  return {
    total: mine.length,
    done: 0,
    failed: mine.filter((task) => task.status === 'error').length,
    active: mine.filter((task) => task.status !== 'error').length,
  };
}

/** 把选好的文件排进队列；返回真正入队的数量。 */
export function enqueuePhotos(entryId: string, files: File[], currentCount: number, onReject?: (message: string) => void): number {
  const pending = tasks.filter((task) => task.entryId === entryId && task.status !== 'error').length;
  const room = Math.max(0, limits.maxPerEntry - currentCount - pending);
  if (!room) {
    onReject?.(`每条记录最多 ${limits.maxPerEntry} 张图片`);
    return 0;
  }
  if (files.length > room) onReject?.(`每条记录最多 ${limits.maxPerEntry} 张图片`);
  const added: UploadTask[] = files.slice(0, room).map((file) => ({
    key: crypto.randomUUID(),
    mediaId: crypto.randomUUID(),
    entryId,
    file,
    preview: URL.createObjectURL(file),
    status: 'pending',
    progress: 0,
  }));
  if (!added.length) return 0;
  tasks = [...tasks, ...added];
  emit();
  syncBeforeUnload();
  void runQueue();
  return added.length;
}

export function retryTask(key: string) {
  patch(key, { status: 'pending', progress: 0, error: undefined });
  void runQueue();
}

export function dismissTask(key: string) {
  drop(key);
  syncBeforeUnload();
}

async function processTask(task: UploadTask) {
  patch(task.key, { status: 'preparing', progress: 2 });
  try {
    const prepared = await prepareImage(task.file, limits);
    patch(task.key, { status: 'uploading', progress: 5 });
    const media = await uploadMedia(
      {
        id: task.mediaId,
        targetId: task.entryId,
        full: prepared.full,
        thumb: prepared.thumb,
        width: prepared.width,
        height: prepared.height,
      },
      (progress) => patch(task.key, { progress: Math.max(5, progress) }),
    );
    const pending = uploadedByEntry.get(task.entryId) ?? [];
    if (!pending.some((item) => item.id === media.id)) pending.push(media);
    uploadedByEntry.set(task.entryId, pending);
    mediaListeners.forEach((listener) => listener(task.entryId, media));
    drop(task.key);
  } catch (caught) {
    patch(task.key, { status: 'error', error: caught instanceof Error ? caught.message : '上传失败' });
  } finally {
    syncBeforeUnload();
  }
}

async function runQueue() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = tasks.find((task) => task.status === 'pending');
      if (!next) break;
      await processTask(next);
    }
  } finally {
    running = false;
  }
}
