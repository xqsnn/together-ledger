'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export type SlidingThumb = { left: number; top: number; width: number; height: number };

/**
 * 测量容器内当前选中按钮的位置，供滑动高亮层使用。
 * active 变化时重新测量；输入框打字等无关渲染不会触发。
 */
export function useSlidingThumb<T extends HTMLElement>(active: string, selector: string) {
  const rootRef = useRef<T>(null);
  const [thumb, setThumb] = useState<SlidingThumb | null>(null);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(selector);
    if (!target) {
      setThumb(null);
      return;
    }
    const next: SlidingThumb = {
      left: target.offsetLeft,
      top: target.offsetTop,
      width: target.offsetWidth,
      height: target.offsetHeight,
    };
    setThumb((previous) =>
      previous &&
      previous.left === next.left &&
      previous.top === next.top &&
      previous.width === next.width &&
      previous.height === next.height
        ? previous
        : next,
    );
  }, [selector]);

  useIsomorphicLayoutEffect(() => {
    measure();
    const root = rootRef.current;
    if (!root) return;

    const observer = new ResizeObserver(measure);
    observer.observe(root);
    Array.from(root.children).forEach((child) => {
      if (child instanceof HTMLElement && child.getAttribute('aria-hidden') !== 'true') {
        observer.observe(child);
      }
    });
    window.addEventListener('resize', measure);
    // 弹层中的控件首次渲染时可能还是 display:none，下一帧补测一次。
    const frame = window.requestAnimationFrame(measure);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [measure, active]);

  return { rootRef, thumb };
}
