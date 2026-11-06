'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Trash2, X } from 'lucide-react';
import type { MediaMeta } from '@/lib/media';

type Props = { photos: MediaMeta[]; index: number; onClose: () => void; onDelete?: (photo: MediaMeta) => Promise<void> | void };

export default function PhotoViewer({ photos, index, onClose, onDelete }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(index);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const stage = stageRef.current;
    if (stage) stage.scrollLeft = stage.clientWidth * Math.min(index, photos.length - 1);
    return () => {
      if (dialog.open) dialog.close();
    };
    // 只在挂载时打开；后续滑动由容器自身处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = photos[Math.max(0, Math.min(photos.length - 1, current))];

  async function remove() {
    if (!active || !onDelete || busy) return;
    setBusy(true);
    try {
      await onDelete(active);
      onClose();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="photo-viewer"
      aria-label="查看大图"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="photo-viewer-tools">
        {onDelete && (
          <button type="button" className="photo-viewer-tool" aria-label="删除这张图片" onClick={() => setConfirming((open) => !open)}>
            <Trash2 size={19} />
          </button>
        )}
        <button type="button" className="photo-viewer-tool" aria-label="关闭" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      <div
        className="photo-viewer-stage"
        ref={stageRef}
        onScroll={(event) => {
          const stage = event.currentTarget;
          if (!stage.clientWidth) return;
          setCurrent(Math.max(0, Math.min(photos.length - 1, Math.round(stage.scrollLeft / stage.clientWidth))));
        }}
      >
        {photos.map((photo, position) => (
          <div className="photo-viewer-slide" key={photo.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/media?id=${encodeURIComponent(photo.id)}&v=full`} alt={`图片 ${position + 1}`} draggable={false} />
          </div>
        ))}
      </div>
      {photos.length > 1 && !confirming && <span className="photo-viewer-count">{current + 1} / {photos.length}</span>}
      {confirming && (
        <div className="photo-viewer-confirm" role="alertdialog" aria-label="删除图片">
          <span>删除这张图片？</span>
          <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>
            {busy ? <LoaderCircle className="spin" size={14} /> : '删除'}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}>取消</button>
        </div>
      )}
    </dialog>
  );
}
