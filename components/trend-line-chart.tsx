'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

export type TrendPoint = {
  date: string;
  income: number;
  expense: number;
  surplus: number;
  count: number;
};

type Series = 'income' | 'expense';

type PlacedLabel = { x: number; y: number; width: number; height: number };

type Scale = {
  /** 轴顶的金额（分）。 */
  top: number;
  /** 每一格的金额（分）。 */
  step: number;
};

type Props = {
  /** 当月已过去的每一天（含没有记录的日期），金额单位：分。 */
  days: TrendPoint[];
  /** 当前选中的日期，与 days 里的日期一一对应。 */
  selectedDate: string;
  onSelect: (date: string) => void;
  /** 「11月5日」这类日期文案。 */
  formatDate: (date: string) => string;
  /** 分 → 「128.00」这类金额文案。 */
  formatMoney: (cents: number) => string;
  /** 变化时重播入场动画。 */
  animationKey: string;
};

const HEIGHT = 268;
const PAD = { top: 46, right: 22, bottom: 30, left: 48 };
const DUAL_RIGHT = 50;
const LABEL_SIZE = 10.5;
const LABEL_LINE = 13;
const DOT_R = 3.2;
const STEPS = 4;

const SERIES_COLOR: Record<Series, string> = { income: '#b96a60', expense: '#6b9159' };

/**
 * 坐标轴刻度文案：小数点位数由「每一格的金额」决定，
 * 这样 ¥0.04 这种极小的量级也不会被四舍五入成一串 0 或重复的数字。
 */
function axisFormatter(top: number, step: number) {
  // 轴顶超过一万时用「万」，否则用元。
  const unit = top / 100 >= 10000 ? 1000000 : 100;
  const suffix = unit === 1000000 ? '万' : '';
  const stepInUnit = step / unit;
  const digits = stepInUnit >= 1 ? 0 : stepInUnit >= 0.1 ? 1 : 2;
  return (cents: number) => {
    if (cents === 0) return '0';
    const value = cents / unit;
    return `${value.toLocaleString('zh-CN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}${suffix}`;
  };
}

/** 数据点上的金额：整数不带小数点，小数额保留两位。 */
function pointLabel(cents: number) {
  const yuan = cents / 100;
  return `¥${yuan.toLocaleString('zh-CN', { maximumFractionDigits: yuan >= 100 ? 0 : 2 })}`;
}

/** 估算文字像素宽度，用于避让相邻标签。 */
function estimateWidth(text: string, size: number) {
  let width = 0;
  for (const char of text) {
    if (char >= '0' && char <= '9') width += size * 0.6;
    else if (char === '.' || char === ',') width += size * 0.3;
    else if (char === '¥') width += size * 0.66;
    else if (char === '万') width += size;
    else width += size * 0.7;
  }
  return width + 4;
}

/** 让每一格落在 1 / 2 / 5 这类整数上。 */
function niceStep(raw: number) {
  if (raw <= 0) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(raw)));
  const ratio = raw / base;
  const multiplier = ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10;
  return multiplier * base;
}

function buildScale(peak: number): Scale {
  // 步长最细到 1 分：再小就没有可展示的精度了。
  const step = Math.max(niceStep(Math.max(peak, 1) / STEPS), 1);
  return { step, top: step * STEPS };
}

/** 单调三次样条：既顺滑，又不会在波峰波谷处冒出负值或额外的尖角。 */
function smoothPath(points: { x: number; y: number }[]) {
  const round = (value: number) => Math.round(value * 100) / 100;
  if (points.length === 0) return '';
  if (points.length === 1) return `M${round(points[0].x)},${round(points[0].y)}`;
  if (points.length === 2) {
    return `M${round(points[0].x)},${round(points[0].y)}L${round(points[1].x)},${round(points[1].y)}`;
  }

  const count = points.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    dx[index] = points[index + 1].x - points[index].x;
    slope[index] = (points[index + 1].y - points[index].y) / (dx[index] || 1);
  }

  const tangent: number[] = new Array(count);
  tangent[0] = slope[0];
  tangent[count - 1] = slope[count - 2];
  for (let index = 1; index < count - 1; index += 1) {
    const prev = slope[index - 1];
    const next = slope[index];
    tangent[index] = prev * next <= 0 ? 0 : (prev + next) / 2;
  }
  for (let index = 0; index < count - 1; index += 1) {
    if (slope[index] === 0) {
      tangent[index] = 0;
      tangent[index + 1] = 0;
      continue;
    }
    const a = tangent[index] / slope[index];
    const b = tangent[index + 1] / slope[index];
    const length = Math.hypot(a, b);
    if (length > 3) {
      const scale = 3 / length;
      tangent[index] = scale * a * slope[index];
      tangent[index + 1] = scale * b * slope[index];
    }
  }

  let path = `M${round(points[0].x)},${round(points[0].y)}`;
  for (let index = 0; index < count - 1; index += 1) {
    const third = dx[index] / 3;
    path += `C${round(points[index].x + third)},${round(points[index].y + tangent[index] * third)} `
      + `${round(points[index + 1].x - third)},${round(points[index + 1].y - tangent[index + 1] * third)} `
      + `${round(points[index + 1].x)},${round(points[index + 1].y)}`;
  }
  return path;
}

export default function TrendLineChart({ days, selectedDate, onSelect, formatDate, formatMoney, animationKey }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const incomeFill = `trend-income-${uid}`;
  const expenseFill = `trend-expense-${uid}`;

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const handleEnter = useCallback((date: string) => setActiveDate(date), []);
  const handleLeave = useCallback(() => setActiveDate(null), []);

  const recorded = days
    .map((day, index) => ({ day, index }))
    .filter((item) => item.day.count > 0);
  const maxIncome = recorded.reduce((max, item) => Math.max(max, item.day.income), 0);
  const maxExpense = recorded.reduce((max, item) => Math.max(max, item.day.expense), 0);
  const hasIncome = maxIncome > 0;
  const hasExpense = maxExpense > 0;
  // 收入往往是「一个月一两笔大额」，和每天的支出差着一两个数量级；
  // 共用一根轴会把支出压成一条直线，所以两边各自一根轴，颜色一一对应。
  // 只有一种数据时退回单轴：这时候这根轴必须跟着有数据的那一边走。
  const dual = hasIncome && hasExpense;
  const singleScale = buildScale(Math.max(hasExpense ? maxExpense : maxIncome, 1));
  const expenseScale = dual ? buildScale(maxExpense) : singleScale;
  const incomeScale = dual ? buildScale(maxIncome) : singleScale;

  const expenseFormat = axisFormatter(expenseScale.top, expenseScale.step);
  const incomeFormat = axisFormatter(incomeScale.top, incomeScale.step);

  const pad = { ...PAD, right: dual ? DUAL_RIGHT : PAD.right };
  const innerWidth = Math.max(width - pad.left - pad.right, 40);
  const innerHeight = HEIGHT - pad.top - pad.bottom;
  const step = innerWidth / Math.max(days.length, 1);

  const xOf = (index: number) => pad.left + step * (index + 0.5);
  const yOf = (value: number, scale: Scale) => pad.top + innerHeight - (value / scale.top) * innerHeight;
  const yOfExpense = (value: number) => yOf(value, expenseScale);
  const yOfIncome = (value: number) => yOf(value, incomeScale);

  const seriesPoints = (series: Series) => recorded.map((item) => ({
    x: xOf(item.index),
    y: series === 'income' ? yOfIncome(item.day.income) : yOfExpense(item.day.expense),
  }));

  const linePath = (series: Series) => smoothPath(seriesPoints(series));

  const areaPath = (series: Series) => {
    const points = seriesPoints(series);
    if (points.length < 2) return '';
    const bottom = pad.top + innerHeight;
    const first = points[0];
    const last = points[points.length - 1];
    return `${smoothPath(points)}L${Math.round(last.x * 100) / 100},${bottom}L${Math.round(first.x * 100) / 100},${bottom}Z`;
  };

  // 标签从「更重要」的开始摆：选中的那天 > 金额更大的那天，摆不下就跳过，避免糊成一团。
  const candidates = recorded
    .flatMap(({ day, index }) => (['income', 'expense'] as Series[])
      .filter((series) => day[series] > 0)
      .map((series) => ({
        date: day.date,
        series,
        x: xOf(index),
        pointY: series === 'income' ? yOfIncome(day[series]) : yOfExpense(day[series]),
        text: pointLabel(day[series]),
        priority: day.date === selectedDate ? Number.MAX_SAFE_INTEGER : day[series],
      })))
    .sort((a, b) => b.priority - a.priority);

  const placed: PlacedLabel[] = [];
  const labels: { key: string; x: number; y: number; text: string; series: Series; selected: boolean }[] = [];
  for (const item of candidates) {
    const labelWidth = estimateWidth(item.text, LABEL_SIZE);
    const labelHeight = LABEL_SIZE + 2;
    // 先往上放；贴近顶部就翻到点下面，再不行就再错开一行。
    const anchors = [
      item.pointY - DOT_R - 8,
      item.pointY + DOT_R + 8 + labelHeight,
      item.pointY - DOT_R - 8 - LABEL_LINE,
      item.pointY + DOT_R + 8 + labelHeight + LABEL_LINE,
    ];
    let placedY: number | null = null;
    for (const anchor of anchors) {
      const rect = {
        x: item.x - labelWidth / 2,
        y: anchor - labelHeight,
        width: labelWidth,
        height: labelHeight,
      };
      if (rect.y < 2 || rect.y + rect.height > pad.top + innerHeight) continue;
      if (rect.x < 2 || rect.x + rect.width > width - 2) continue;
      const collides = placed.some((other) => (
        rect.x < other.x + other.width + 3
        && rect.x + rect.width + 3 > other.x
        && rect.y < other.y + other.height + 1
        && rect.y + rect.height + 1 > other.y
      ));
      if (collides) continue;
      placed.push(rect);
      placedY = anchor;
      break;
    }
    if (placedY === null) continue;
    labels.push({
      key: `${item.date}-${item.series}`,
      x: item.x,
      y: placedY,
      text: item.text,
      series: item.series,
      selected: item.date === selectedDate,
    });
  }

  const selectedIndex = days.findIndex((day) => day.date === selectedDate);
  const activeIndex = activeDate ? days.findIndex((day) => day.date === activeDate) : -1;
  const activeDay = activeIndex >= 0 ? days[activeIndex] : null;
  const guideIndex = activeIndex >= 0 ? activeIndex : selectedIndex;

  const tipHalf = 68;
  const tipIndex = activeIndex >= 0 ? activeIndex : selectedIndex;
  const tipLeft = tipIndex >= 0
    ? Math.min(Math.max(xOf(tipIndex), tipHalf + 4), Math.max(width - tipHalf - 4, tipHalf + 4))
    : 0;

  const dayTickEvery = step < 22 ? 2 : 1;
  const gridLines = Array.from({ length: STEPS + 1 }, (_, index) => index);

  return (
    <div className="trend-plot" ref={wrapRef}>
      {width > 0 && (
        <>
          <svg
            key={animationKey}
            className="trend-svg"
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <linearGradient id={incomeFill} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES_COLOR.income} stopOpacity="0.2" />
                <stop offset="72%" stopColor={SERIES_COLOR.income} stopOpacity="0.02" />
                <stop offset="100%" stopColor={SERIES_COLOR.income} stopOpacity="0" />
              </linearGradient>
              <linearGradient id={expenseFill} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES_COLOR.expense} stopOpacity="0.22" />
                <stop offset="72%" stopColor={SERIES_COLOR.expense} stopOpacity="0.03" />
                <stop offset="100%" stopColor={SERIES_COLOR.expense} stopOpacity="0" />
              </linearGradient>
            </defs>

            {gridLines.map((index) => {
              const y = pad.top + (innerHeight / STEPS) * index;
              return (
                <g key={index}>
                  <line className="trend-grid" x1={pad.left} x2={width - pad.right} y1={y} y2={y} />
                  <text className={`trend-axis${dual ? ' expense' : ''}`} x={pad.left - 10} y={y + 3.6} textAnchor="end">
                    {expenseFormat(expenseScale.top * (STEPS - index) / STEPS)}
                  </text>
                  {dual && index > 0 && (
                    <text className="trend-axis income" x={width - pad.right + 10} y={y + 3.6} textAnchor="start">
                      {incomeFormat(incomeScale.top * (STEPS - index) / STEPS)}
                    </text>
                  )}
                </g>
              );
            })}

            {selectedIndex >= 0 && (
              <rect
                className="trend-band"
                x={xOf(selectedIndex) - Math.min(step / 2, 16)}
                y={pad.top - 10}
                width={Math.min(step, 32)}
                height={innerHeight + 10}
                rx="9"
              />
            )}

            {hasIncome && <path className="trend-area" d={areaPath('income')} fill={`url(#${incomeFill})`} />}
            {hasExpense && <path className="trend-area" d={areaPath('expense')} fill={`url(#${expenseFill})`} />}

            {hasIncome && <path className="trend-line income" d={linePath('income')} pathLength={1} />}
            {hasExpense && <path className="trend-line expense" d={linePath('expense')} pathLength={1} />}

            {recorded.map(({ day, index }) => (
              <g key={day.date}>
                {day.income > 0 && (
                  <circle
                    className={`trend-dot income${day.date === selectedDate ? ' selected' : ''}${day.date === activeDate ? ' active' : ''}`}
                    cx={xOf(index)}
                    cy={yOfIncome(day.income)}
                    r={day.date === selectedDate ? 4.6 : DOT_R}
                  />
                )}
                {day.expense > 0 && (
                  <circle
                    className={`trend-dot expense${day.date === selectedDate ? ' selected' : ''}${day.date === activeDate ? ' active' : ''}`}
                    cx={xOf(index)}
                    cy={yOfExpense(day.expense)}
                    r={day.date === selectedDate ? 4.6 : DOT_R}
                  />
                )}
              </g>
            ))}

            {guideIndex >= 0 && (
              <line
                className={activeIndex >= 0 ? 'trend-guide active' : 'trend-guide'}
                x1={xOf(guideIndex)}
                x2={xOf(guideIndex)}
                y1={pad.top - 8}
                y2={pad.top + innerHeight}
              />
            )}
            {labels.map((label) => (
              <text
                key={label.key}
                className={`trend-value${label.series === 'income' ? ' income' : ' expense'}${label.selected ? ' selected' : ''}`}
                x={label.x}
                y={label.y}
                textAnchor="middle"
              >
                {label.text}
              </text>
            ))}

            {days.map((day, index) => {
              if (index % dayTickEvery !== 0 && day.date !== selectedDate && day.date !== activeDate) return null;
              return (
                <text
                  key={day.date}
                  className={`trend-day${day.date === selectedDate ? ' selected' : ''}${day.count === 0 ? ' empty' : ''}`}
                  x={xOf(index)}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                >
                  {Number(day.date.slice(8))}
                </text>
              );
            })}
          </svg>

          <div
            className="trend-hotspots"
            style={{ left: pad.left, right: pad.right, top: pad.top - 12, bottom: PAD.bottom - 2 }}
          >
            {days.map((day) => (
              <button
                key={day.date}
                type="button"
                className="trend-hotspot"
                aria-pressed={day.date === selectedDate}
                aria-label={day.count
                  ? `${formatDate(day.date)}，收入 ${formatMoney(day.income)} 元，支出 ${formatMoney(day.expense)} 元`
                  : `${formatDate(day.date)}，尚无记录`}
                onMouseEnter={() => handleEnter(day.date)}
                onMouseLeave={handleLeave}
                onFocus={() => handleEnter(day.date)}
                onBlur={handleLeave}
                onClick={() => onSelect(day.date)}
              />
            ))}
          </div>

          {activeDay && (
            <div className="trend-tip" style={{ left: tipLeft }}>
              <strong>{formatDate(activeDay.date)}</strong>
              {activeDay.count ? (
                <>
                  <span><i className="tip-dot income" />收入 <b>¥{formatMoney(activeDay.income)}</b></span>
                  <span><i className="tip-dot expense" />支出 <b>¥{formatMoney(activeDay.expense)}</b></span>
                </>
              ) : <span className="tip-empty">尚无记录</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
