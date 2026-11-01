'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { prefersReducedMotion } from '@/lib/motion';

const MIN_MONTH = '1900-01';
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const pad = (value: number) => String(value).padStart(2, '0');

function daysInMonth(month: string) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
}

function firstWeekday(month: string) {
  return (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
}

function shiftMonth(month: string, diff: number) {
  const value = new Date(`${month}-01T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + diff);
  return value.toISOString().slice(0, 7);
}

type DatePickerProps = {
  /** 当前日期，格式 YYYY-MM-DD */
  value: string;
  /** 可选的最大日期，格式 YYYY-MM-DD（通常是今天） */
  max: string;
  onChange: (value: string) => void;
};

export function DatePicker({ value, max, onChange }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [page, setPage] = useState<{ key: number; dir: 'next' | 'prev' }>({ key: 0, dir: 'next' });
  const [viewMonth, setViewMonth] = useState(value.slice(0, 7));
  const [position, setPosition] = useState<{ left: number; top: number; width: number; placement: 'top' | 'bottom' } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const label = `${Number(value.slice(0, 4))} 年 ${Number(value.slice(5, 7))} 月 ${Number(value.slice(8, 10))} 日`;
  const maxMonth = max.slice(0, 7);
  const days = daysInMonth(viewMonth);
  const leading = firstWeekday(viewMonth);
  const cells = Array.from({ length: Math.ceil((leading + days) / 7) * 7 }, (_, index) => {
    const day = index - leading + 1;
    return day >= 1 && day <= days ? `${viewMonth}-${pad(day)}` : null;
  });

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

  const openPicker = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closingRef.current = false;
    setClosing(false);
    setOpen(true);
  }, []);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    gridRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) closePicker();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePicker();
        triggerRef.current?.focus();
      }
    };
    const close = () => closePicker();

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

  useEffect(() => {
    const dialog = triggerRef.current?.closest('dialog');
    if (!dialog) return;
    const close = () => closePicker(true);
    dialog.addEventListener('close', close);
    return () => dialog.removeEventListener('close', close);
  }, [closePicker]);

  function togglePicker() {
    if (closing) {
      // 关闭动画进行中再次点击：取消关闭，保持打开。
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closingRef.current = false;
      setClosing(false);
      return;
    }
    if (open) {
      closePicker();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    setViewMonth(value.slice(0, 7));
    setPage({ key: 0, dir: 'next' });
    if (!rect) {
      openPicker();
      return;
    }
    const width = Math.max(rect.width, 288);
    const height = 330;
    const gap = 8;
    const placement = rect.bottom + height + gap > window.innerHeight && rect.top > height + gap ? 'top' : 'bottom';
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    setPosition({
      left,
      top: placement === 'top' ? rect.top - gap : rect.bottom + gap,
      width,
      placement,
    });
    openPicker();
  }

  function select(dateValue: string) {
    if (dateValue > max) return;
    onChange(dateValue);
    closePicker();
    triggerRef.current?.focus();
  }

  function changeMonth(diff: number) {
    const next = shiftMonth(viewMonth, diff);
    if (next < MIN_MONTH || next > maxMonth) return;
    setPage((current) => ({ key: current.key + 1, dir: diff > 0 ? 'next' : 'prev' }));
    setViewMonth(next);
  }

  return (
    <div className="date-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="date-select-trigger"
        aria-label={`选择日期，当前 ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={togglePicker}
      >
        <CalendarDays size={16} aria-hidden="true" />
        <span>{label}</span>
      </button>

      {open && position && (
        <div
          className={`date-popover ${position.placement}${closing ? ' is-closing' : ''}`}
          role="dialog"
          aria-label="选择日期"
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            transform: position.placement === 'top' ? 'translateY(-100%)' : undefined,
          }}
        >
          <div className="date-popover-head">
            <button type="button" aria-label="上个月" disabled={viewMonth <= MIN_MONTH} onClick={() => changeMonth(-1)}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <strong>{Number(viewMonth.slice(0, 4))} 年 {Number(viewMonth.slice(5))} 月</strong>
            <button type="button" aria-label="下个月" disabled={viewMonth >= maxMonth} onClick={() => changeMonth(1)}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="date-weekdays" aria-hidden="true">
            {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>

          <div className={`date-grid-page${page.key ? ` ${page.dir}` : ''}`} key={page.key}>
            <div className="date-grid" ref={gridRef}>
              {cells.map((dateValue, index) => {
                if (!dateValue) return <span className="date-day-empty" key={`empty-${index}`} aria-hidden="true" />;
                const selected = dateValue === value;
                const isToday = dateValue === max;
                return (
                  <button
                    key={dateValue}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${dateValue}，星期${weekdays[(new Date(`${dateValue}T00:00:00Z`).getUTCDay() + 6) % 7]}${isToday ? '，今天' : ''}`}
                    className={`date-day ${selected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                    disabled={dateValue > max}
                    onClick={() => select(dateValue)}
                  >
                    {Number(dateValue.slice(8))}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="date-popover-foot">
            <button type="button" disabled={value === max} onClick={() => select(max)}>今天</button>
          </div>
        </div>
      )}
    </div>
  );
}
