'use client';

import { useRef, useState } from 'react';
import type { MediaMeta } from '@/lib/media';

type Props = {
  photos: MediaMeta[];
  onOpen: (index: number) => void;
};

/** 小红书式横滑图集：整屏吸附、右下角计数、点开看大图。 */
export default function PhotoCarousel({ photos, onOpen }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  return (
    <div className="photo-carousel">
      <div
        className="photo-carousel-track"
        ref={trackRef}
        onScroll={(event) => {
          const track = event.currentTarget;
          if (!track.clientWidth) return;
          const next = Math.round(track.scrollLeft / track.clientWidth);
          if (next !== index) setIndex(Math.max(0, Math.min(photos.length - 1, next)));
        }}
      >
        {photos.map((photo, position) => (
          <button
            type="button"
            className={`photo-carousel-slide${photo.height > photo.width ? ' is-portrait' : ''}`}
            key={photo.id}
            onClick={() => onOpen(position)}
            aria-label={`查看第 ${position + 1} 张图片`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/media?id=${encodeURIComponent(photo.id)}&v=full`}
              alt=""
              decoding="async"
              draggable={false}
            />
          </button>
        ))}
      </div>
      {photos.length > 1 && <span className="photo-carousel-count">{index + 1} / {photos.length}</span>}
    </div>
  );
}
