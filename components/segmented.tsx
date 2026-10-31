'use client';

import type { ComponentProps } from 'react';
import { useSlidingThumb } from '@/components/use-sliding-thumb';

type SegmentedProps = ComponentProps<'div'> & {
  /** 当前选中项的稳定标识，用于在选中变化后重新测量滑块位置。 */
  active?: string;
};

/**
 * 分段控件：在按钮之间放一枚会滑动的白色胶囊，
 * 让收支 / 归属 / 视图这类切换有 iOS 分段控件的连续感。
 * 按钮本身继续保留 aria-pressed，选中态由滑块承担背景。
 */
export function Segmented({ className = '', children, active = '', ...props }: SegmentedProps) {
  const { rootRef, thumb } = useSlidingThumb<HTMLDivElement>(active, ':scope > button[aria-pressed="true"]');

  return (
    <div ref={rootRef} className={`segmented${className ? ` ${className}` : ''}`} {...props}>
      {thumb && thumb.width > 0 && (
        <span
          className="segmented-thumb"
          aria-hidden="true"
          style={{
            width: thumb.width,
            height: thumb.height,
            transform: `translate3d(${thumb.left}px, ${thumb.top}px, 0)`,
          }}
        />
      )}
      {children}
    </div>
  );
}
