'use client';

import type { ComponentProps } from 'react';
import { useSlidingThumb } from '@/components/use-sliding-thumb';

type SlidingNavProps = ComponentProps<'nav'> & {
  /** 当前页面标识，用于在选中变化后重新测量高亮层位置。 */
  active: string;
};

/**
 * 主导航：高亮胶囊会在「今天 / 分析 / 账本设置」之间滑动，
 * 桌面端纵向、移动端横向都复用同一套测量逻辑。
 */
export function SlidingNav({ className = '', children, active, ...props }: SlidingNavProps) {
  const { rootRef, thumb } = useSlidingThumb<HTMLElement>(active, ':scope > button[aria-current="page"]');

  return (
    <nav ref={rootRef} className={`sliding-nav${className ? ` ${className}` : ''}`} {...props}>
      {thumb && thumb.width > 0 && (
        <span
          className="nav-thumb"
          aria-hidden="true"
          style={{
            width: thumb.width,
            height: thumb.height,
            transform: `translate3d(${thumb.left}px, ${thumb.top}px, 0)`,
          }}
        />
      )}
      {children}
    </nav>
  );
}
