'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { prefersReducedMotion } from '@/lib/motion';

const MIN_YEAR = 1900;
const months = Array.from({ length: 12 }, (_, index) => index + 1);
const pad = (value: number) => String(value).padStart(2, '0');

type MonthPickerProps = {
  /** 当前月份，格式 YYYY-MM */
  value: string;
  /** 可选的最大月份，格式 YYYY-MM（通常是本月） */
  max: string;
  onChange: (value: string) => void;
};

export function MonthPicker({ value, max, onChange }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [page, setPage] = useState<{ key: number; dir: 'next' | 'prev' }>({ key: 0, dir: 'next' });
  const [viewYear, setViewYear] = useState(Number(value.slice(0, 4)));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedYear = Number(value.slice(0, 4));
  const selectedMonth = Number(value.slice(5));
  const currentYear = Number(max.slice(0, 4));
  const currentMonth = Number(max.slice(5));
  const label = `${selectedYear} 年 ${selectedMonth} 月`;

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
    gridRef.current
      ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
      ?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        closePicker();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePicker();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, closePicker]);

  function select(month: number) {
    const next = `${viewYear}-${pad(month)}`;
    if (next > max) return;
    onChange(next);
    closePicker();
    triggerRef.current?.focus();
  }

  function changeYear(diff: number) {
    setViewYear((year) => Math.min(Math.max(year + diff, MIN_YEAR), currentYear));
    setPage((current) => ({ key: current.key + 1, dir: diff > 0 ? 'next' : 'prev' }));
  }

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
    setViewYear(selectedYear);
    setPage({ key: 0, dir: 'next' });
    openPicker();
  }

  return (
    <div className="month-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="month-select-trigger"
        aria-label={`选择月份，当前 ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={togglePicker}
      >
        <CalendarDays size={16} aria-hidden="true" />
        <span>{label}</span>
      </button>

      {open && (
        <div className={`month-popover${closing ? ' is-closing' : ''}`} role="dialog" aria-label="选择月份">
          <div className="month-popover-head">
            <button
              type="button"
              aria-label="上一年"
              disabled={viewYear <= MIN_YEAR}
              onClick={() => changeYear(-1)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <strong>{viewYear} 年</strong>
            <button
              type="button"
              aria-label="下一年"
              disabled={viewYear >= currentYear}
              onClick={() => changeYear(1)}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          <div className={`month-grid-page${page.key ? ` ${page.dir}` : ''}`} key={page.key}>
            <div className="month-popover-grid" ref={gridRef}>
              {months.map((month) => {
                const option = `${viewYear}-${pad(month)}`;
                const disabled = option > max;
                const selected = option === value;
                const isCurrent = option === max;
                return (
                  <button
                    key={month}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${viewYear} 年 ${month} 月${isCurrent ? '，本月' : ''}`}
                    className={isCurrent ? 'is-current' : undefined}
                    disabled={disabled}
                    onClick={() => select(month)}
                  >
                    {month} 月
                  </button>
                );
              })}
            </div>
          </div>

          <div className="month-popover-foot">
            <span>
              {currentYear} 年 {currentMonth} 月为最新月份
            </span>
            <button
              type="button"
              disabled={value === max}
              onClick={() => {
                onChange(max);
                closePicker();
                triggerRef.current?.focus();
              }}
            >
              回到本月
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
