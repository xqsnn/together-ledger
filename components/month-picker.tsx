'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

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
  const [viewYear, setViewYear] = useState(Number(value.slice(0, 4)));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const selectedYear = Number(value.slice(0, 4));
  const selectedMonth = Number(value.slice(5));
  const currentYear = Number(max.slice(0, 4));
  const currentMonth = Number(max.slice(5));
  const label = `${selectedYear} 年 ${selectedMonth} 月`;

  useEffect(() => {
    if (!open) return;
    gridRef.current
      ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
      ?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function select(month: number) {
    const next = `${viewYear}-${pad(month)}`;
    if (next > max) return;
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
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
        onClick={() => {
          if (!open) setViewYear(selectedYear);
          setOpen((isOpen) => !isOpen);
        }}
      >
        <CalendarDays size={16} aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown className="month-select-chevron" size={14} aria-hidden="true" />
      </button>

      {open && (
        <div className="month-popover" role="dialog" aria-label="选择月份">
          <div className="month-popover-head">
            <button
              type="button"
              aria-label="上一年"
              disabled={viewYear <= MIN_YEAR}
              onClick={() => setViewYear((year) => Math.max(year - 1, MIN_YEAR))}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <strong>{viewYear} 年</strong>
            <button
              type="button"
              aria-label="下一年"
              disabled={viewYear >= currentYear}
              onClick={() => setViewYear((year) => Math.min(year + 1, currentYear))}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

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

          <div className="month-popover-foot">
            <span>
              {currentYear} 年 {currentMonth} 月为最新月份
            </span>
            <button
              type="button"
              disabled={value === max}
              onClick={() => {
                onChange(max);
                setOpen(false);
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
