'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

const DISMISS_DISTANCE = 110;
const FLICK_VELOCITY = 0.55;

/**
 * 移动端底部弹层的下拉关闭手势。
 * 从弹层顶部的抓手向下拖动：拖动时弹层跟手，松手后按距离或速度
 * 决定是弹回原位还是关闭，接近 iOS 的 sheet 手感。
 */
export function useSheetDrag(onDismiss: () => void) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; time: number } | null>(null);
  const settle = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (settle.current !== null) window.cancelAnimationFrame(settle.current);
    },
    [],
  );

  const enabled = useCallback(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 760px)').matches &&
      !prefersReducedMotion(),
    [],
  );

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (!enabled() || event.button !== 0) return;
    if (settle.current !== null) {
      window.cancelAnimationFrame(settle.current);
      settle.current = null;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { y: event.clientY, time: performance.now() };
    setDragging(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const from = start.current;
    if (!from) return;
    setOffset(Math.max(0, event.clientY - from.y));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const from = start.current;
    if (!from) return;
    start.current = null;
    const distance = Math.max(0, event.clientY - from.y);
    const velocity = distance / Math.max(1, performance.now() - from.time);
    const dismiss = distance > DISMISS_DISTANCE || (distance > 28 && velocity > FLICK_VELOCITY);

    setDragging(false);
    if (dismiss) {
      setOffset(0);
      onDismiss();
      return;
    }
    // 先保留当前位移，让 CSS 过渡从手指位置弹回 0。
    settle.current = window.requestAnimationFrame(() => {
      settle.current = window.requestAnimationFrame(() => {
        settle.current = null;
        setOffset(0);
      });
    });
  }

  const style: CSSProperties | undefined = dragging
    ? { transform: `translate3d(0, ${offset}px, 0)`, transition: 'none' }
    : offset
      ? { transform: `translate3d(0, ${offset}px, 0)` }
      : undefined;

  return {
    style,
    dragging,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
