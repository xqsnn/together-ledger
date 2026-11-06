'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock3 } from 'lucide-react';
import { prefersReducedMotion } from '@/lib/motion';

const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const pad = (value: number) => String(value).padStart(2, '0');

// 面板挂在 body 上：弹窗本身带 transform，fixed 定位若留在里面会以弹窗为参照而错位。

/** 把 "HH:mm" 解析成时分；无法解析时返回 null。 */
function parseTime(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

type TimePickerProps = {
  /** 当前时间，格式 HH:mm */
  value: string;
  onChange: (value: string) => void;
  /** 可选的最大时间，格式 HH:mm（只有日期是今天时才传） */
  max?: string;
};

export function TimePicker({ value, onChange, max }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; placement: 'top' | 'bottom' } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parsed = parseTime(value) ?? { hour: 0, minute: 0 };
  const label = `${pad(parsed.hour)}:${pad(parsed.minute)}`;
  const maxParsed = max ? parseTime(max) : null;

  const closePicker = useCallback((immediate = false) => {
    if (immediate || prefersReducedMotion()) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closingRef.current = false;
      setClosing(false);
      setOpen(false);
      return;
    }
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      closingRef.current = false;
      setClosing(false);
      setOpen(false);
    }, 150);
  }, []);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    // 打开后把焦点放到当前选中的那一格，键盘操作更顺手。
    bodyRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target) && !(target instanceof Element && target.closest('.time-popover'))) closePicker();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePicker();
        triggerRef.current?.focus();
      }
    };
    // 面板是固定定位，页面滚动后位置会错开，但面板自身内部的滚动不应关闭它。
    // 打开面板时两列会各自把选中项滚到可视区，这类滚动不应关闭面板；
    // 抛到下一帧再判断，滚动结束后面板已就位，真正的外层滚动仍然会关闭它。
    const close = (event?: Event) => {
      if (event?.target instanceof Node && (rootRef.current?.contains(event.target) || (event.target instanceof Element && event.target.closest('.time-popover')))) return;
      requestAnimationFrame(() => {
        if (rootRef.current?.contains(document.activeElement) || rootRef.current?.matches(':hover')) return;
        closePicker();
      });
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, closePicker]);

  // 面板打开时把两列中选中的时间滚到中间，用户一眼就能看到当前值。
  useLayoutEffect(() => {
    if (!open) return;
    document.querySelectorAll<HTMLButtonElement>('.time-popover button[aria-pressed="true"]').forEach((button) => {
      const list = button.parentElement;
      if (!list) return;
      list.scrollTop = button.offsetTop - list.clientHeight / 2 + button.offsetHeight / 2;
    });
  }, [open]);

  useEffect(() => {
    const dialog = triggerRef.current?.closest('dialog');
    if (!dialog) return;
    const close = () => closePicker(true);
    dialog.addEventListener('close', close);
    return () => dialog.removeEventListener('close', close);
  }, [closePicker]);

  const unavailable = (hour: number, minute: number) =>
    Boolean(maxParsed && (hour > maxParsed.hour || (hour === maxParsed.hour && minute > maxParsed.minute)));

  const hourDisabled = (hour: number) => Boolean(maxParsed && hour > maxParsed.hour);
  const minuteDisabled = (minute: number) => unavailable(parsed.hour, minute);

  function togglePicker() {
    if (closing) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closingRef.current = false;
      setClosing(false);
      return;
    }
    if (open) {
      closePicker();
      return;
    }
    // 弹窗有入场缩放动画，这里用 offsetWidth 等未缩放的布局尺寸量位置更稳。
    const trigger = triggerRef.current;
    const rect = trigger ? {
      left: trigger.getBoundingClientRect().left,
      top: trigger.getBoundingClientRect().top,
      bottom: trigger.getBoundingClientRect().bottom,
      width: trigger.offsetWidth || 300,
    } : null;
    if (rect) {
      const width = Math.max(rect.width, 300);
      // 面板实际高度：两列各 150 + 表头/底部约 90，合计约 250；留点余量做上下判断。
      const height = 260;
      const gap = 8;
      const below = window.innerHeight - rect.bottom - gap;
      const above = rect.top - gap;
      // 下方放不下且上方更宽裕时向上弹；用 translateY(-100%) 让面板底部贴着触发器顶部。
      const placement = below < height && above > below ? 'top' : 'bottom';
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: placement === 'top' ? rect.top - gap : rect.bottom + gap,
        placement,
      });
    }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closingRef.current = false;
    setClosing(false);
    setOpen(true);
  }

  /** 选完时、分立即生效并收起，和日期选择「点一下就好」的手感一致。 */
  function select(hour: number, minute: number) {
    if (unavailable(hour, minute)) return;
    onChange(`${pad(hour)}:${pad(minute)}`);
    closePicker();
    triggerRef.current?.focus();
  }

  function selectNow() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    onChange(parts);
    closePicker();
    triggerRef.current?.focus();
  }

  const previewHour = hourDisabled(parsed.hour) ? (maxParsed?.hour ?? 0) : parsed.hour;
  const previewMinute = minuteDisabled(parsed.minute) ? Math.min(parsed.minute, maxParsed?.minute ?? parsed.minute) : parsed.minute;

  return (
    <div className={`time-select${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="time-select-trigger"
        aria-label={`选择发生时间，当前 ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={togglePicker}
      >
        <Clock3 size={16} aria-hidden="true" />
        <span>{label}</span>
      </button>

      {open && position && createPortal(
        <div
          className={`time-popover ${position.placement}${closing ? ' is-closing' : ''}`}
          role="dialog"
          aria-label="选择时间"
          style={{
            left: position.left,
            top: position.top,
            transform: position.placement === 'top' ? 'translateY(-100%)' : undefined,
          }}
        >
          <div className="time-popover-head">
            <span>选择时间</span>
            <strong aria-live="polite">{pad(previewHour)}:{pad(previewMinute)}</strong>
          </div>

          <div className="time-columns" ref={bodyRef}>
            <div className="time-column" role="group" aria-label="小时">
              <span className="time-column-label">时</span>
              <div className="time-options">
                {HOURS.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    aria-pressed={hour === previewHour}
                    disabled={hourDisabled(hour)}
                    className={hour === previewHour ? 'selected' : ''}
                    onClick={() => select(hour, Math.min(previewMinute, minuteDisabled(previewMinute) ? (maxParsed?.minute ?? previewMinute) : previewMinute))}
                  >
                    {pad(hour)}
                  </button>
                ))}
              </div>
            </div>
            <div className="time-column" role="group" aria-label="分钟">
              <span className="time-column-label">分</span>
              <div className="time-options">
                {MINUTES.map((minute) => (
                  <button
                    key={minute}
                    type="button"
                    aria-pressed={minute === previewMinute}
                    disabled={minuteDisabled(minute)}
                    className={minute === previewMinute ? 'selected' : ''}
                    onClick={() => select(previewHour, minute)}
                  >
                    {pad(minute)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="time-popover-foot">
            <button type="button" onClick={selectNow}>现在</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
