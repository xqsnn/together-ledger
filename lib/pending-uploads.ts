'use client';

/**
 * 新建记录时选好的图片，先把 File 暂存在内存里，等详情页挂载后再上传。
 * 同一 SPA 会话内有效（客户端路由跳转不会丢）；整页刷新会丢，图片需要重新添加。
 */
const pending = new Map<string, File[]>();

export function stashPendingPhotos(entryId: string, files: File[]): void {
  if (!files.length) return;
  pending.set(entryId, files);
}

export function takePendingPhotos(entryId: string): File[] {
  const files = pending.get(entryId) ?? [];
  pending.delete(entryId);
  return files;
}
