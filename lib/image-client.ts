'use client';

import type { MediaLimits, MediaMeta } from './media';

export type PreparedImage = { full: Blob; thumb: Blob; width: number; height: number };

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

type Decoded = { source: ImageBitmap | HTMLImageElement; width: number; height: number; release: () => void };

/** 优先 createImageBitmap（自带 EXIF 方向），失败再退回 Image，覆盖部分 iOS 的 HEIC 解码。 */
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // 继续尝试 <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('这张图片无法处理，请改用 JPG / PNG / WebP'));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function toJpeg(source: ImageBitmap | HTMLImageElement, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('图片处理失败'));
  // 重绘去掉 EXIF/GPS，同时给 PNG 透明区域填白底。
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片处理失败'))), 'image/jpeg', quality);
  });
}

async function compress(
  source: ImageBitmap | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number,
  maxBytes: number,
  qualities: number[],
  rounds: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  let scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  for (let round = 0; round < rounds; round += 1) {
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    for (const quality of qualities) {
      const blob = await toJpeg(source, width, height, quality);
      if (blob.size <= maxBytes) return { blob, width, height };
    }
    scale *= 0.8;
  }
  throw new Error('图片压缩后仍然太大，请换一张');
}

export async function prepareImage(file: File, limits: Pick<MediaLimits, 'maxBytes' | 'maxThumbBytes'>): Promise<PreparedImage> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error('图片超过 25MB，请先压缩或换一张');
  const decoded = await decode(file);
  try {
    if (!decoded.width || !decoded.height) throw new Error('这张图片无法处理，请改用 JPG / PNG / WebP');
    const full = await compress(decoded.source, decoded.width, decoded.height, 1600, limits.maxBytes, [0.82, 0.74, 0.66, 0.6], 4);
    const thumb = await compress(decoded.source, decoded.width, decoded.height, 480, limits.maxThumbBytes, [0.75, 0.68, 0.6, 0.52], 4);
    return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
  } finally {
    decoded.release();
  }
}

export function uploadMedia(
  input: { id: string; targetId: string; full: Blob; thumb: Blob; width: number; height: number },
  onProgress?: (percent: number) => void,
): Promise<MediaMeta> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('id', input.id);
    form.append('target', 'entry');
    form.append('targetId', input.targetId);
    form.append('width', String(input.width));
    form.append('height', String(input.height));
    form.append('file', input.full, 'image.jpg');
    form.append('thumb', input.thumb, 'thumb.jpg');

    const request = new XMLHttpRequest();
    request.open('POST', '/api/media');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error('网络异常，图片上传失败'));
    request.onabort = () => reject(new Error('图片上传已取消'));
    request.onload = () => {
      let payload: { media?: MediaMeta; error?: string } = {};
      try {
        payload = JSON.parse(request.responseText) as { media?: MediaMeta; error?: string };
      } catch {
        // 非 JSON 响应按失败处理。
      }
      if (request.status >= 200 && request.status < 300 && payload.media) {
        onProgress?.(100);
        resolve(payload.media);
      } else {
        reject(new Error(payload.error || `图片上传失败（${request.status}）`));
      }
    };
    request.send(form);
  });
}
