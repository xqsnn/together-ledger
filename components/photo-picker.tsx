'use client';

import { useRef } from 'react';
import { ImagePlus, RotateCcw, X } from 'lucide-react';

export type PickedPhoto = {
  key: string;
  file: File;
  preview: string;
  status?: 'pending' | 'uploading' | 'done' | 'error';
  progress?: number;
  error?: string;
  retry?: () => void;
};

type Props = {
  photos: PickedPhoto[];
  onChange: (photos: PickedPhoto[]) => void;
  max?: number;
  disabled?: boolean;
  onReject?: (message: string) => void;
};

export default function PhotoPicker({ photos, onChange, max = 9, disabled = false, onReject }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list?.length) return;
    const next: PickedPhoto[] = [];
    for (const file of Array.from(list)) {
      if (photos.length + next.length >= max) {
        onReject?.(`最多选择 ${max} 张图片`);
        break;
      }
      if (!file.type.startsWith('image/')) {
        onReject?.('请选择图片文件');
        continue;
      }
      next.push({ key: crypto.randomUUID(), file, preview: URL.createObjectURL(file) });
    }
    if (next.length) onChange([...photos, ...next]);
  };

  const remove = (key: string) => {
    const target = photos.find((photo) => photo.key === key);
    if (target) URL.revokeObjectURL(target.preview);
    onChange(photos.filter((photo) => photo.key !== key));
  };

  return (
    <div className="photo-picker">
      <div className="photo-grid">
        {photos.map((photo) => (
          <div className={`photo-tile${photo.status === 'uploading' ? ' is-uploading' : ''}${photo.status === 'error' ? ' is-error' : ''}`} key={photo.key}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.preview} alt="" draggable={false} />
            {photo.status === 'uploading' && (
              <span className="photo-progress" aria-label={`上传中 ${photo.progress ?? 0}%`}>
                <i style={{ width: `${photo.progress ?? 0}%` }} />
              </span>
            )}
            {photo.status === 'error' && (
              <button type="button" className="photo-retry" onClick={photo.retry} aria-label={photo.error || '重试上传'}>
                <RotateCcw size={16} />
              </button>
            )}
            {!disabled && photo.status !== 'uploading' && (
              <button type="button" className="photo-remove" aria-label="移除图片" onClick={() => remove(photo.key)}>
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        {photos.length < max && (
          <button type="button" className="photo-add" disabled={disabled} onClick={() => inputRef.current?.click()}>
            <ImagePlus size={20} aria-hidden="true" />
            <span>{photos.length}/{max}</span>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        hidden
        disabled={disabled}
        onChange={(event) => {
          add(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
