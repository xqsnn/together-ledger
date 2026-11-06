'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { MediaMeta } from '@/lib/media';

type Props = { photos: MediaMeta[]; onOpen: (index: number) => void; onRemove?: (photo: MediaMeta) => void; children?: ReactNode };

export default function PhotoGrid({ photos, onOpen, onRemove, children }: Props) {
  if (!photos.length && !children) return null;
  return (
    <div className="photo-grid">
      {photos.map((photo, index) => (
        <div className="photo-tile" key={photo.id}>
          <button type="button" className="photo-tile-open" onClick={() => onOpen(index)} aria-label={`查看第 ${index + 1} 张图片`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/media?id=${encodeURIComponent(photo.id)}&v=thumb`} alt="" loading="lazy" draggable={false} />
          </button>
          {onRemove && (
            <button type="button" className="photo-remove" aria-label="删除图片" onClick={() => onRemove(photo)}>
              <X size={13} />
            </button>
          )}
        </div>
      ))}
      {children}
    </div>
  );
}
