'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import NextLink from 'next/link';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookHeart,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Heart,
  Leaf,
  Link as LinkIcon,
  List,
  LoaderCircle,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  dailyTotals,
  DailyTotal,
  Entry,
  Owner,
  owners,
  chinaToday,
  toCents,
  totals,
} from '@/lib/ledger';
import { MonthPicker } from '@/components/month-picker';

type Ledger = {
  entries: Entry[];
  opening: number;
  settingsRevision: number;
  today: string;
};
type View = 'today' | 'records' | 'analysis' | 'settings';
type EntryFilter = 'all' | Entry['type'];

type MutationBody =
  | { action: 'opening'; opening: number; revision: number }
  | { action: 'delete'; id: string; revision: number }
  | { action: 'save'; entry: Partial<Entry> & { type: Entry['type']; amount: number; owner: Owner; date: string; note: string } };

const blank: Ledger = { entries: [], opening: 0, settingsRevision: 0, today: chinaToday() };
const money = (n: number) =>
  (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ownerClass = (owner: string) => (owner === '青' ? 'qing' : owner === '伊' ? 'yi' : 'together');
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

function Duo({ small = false }: { small?: boolean }) {
  return (
    <div className={`duo ${small ? 'small' : ''}`} aria-hidden="true">
      <div className="duo-one"><i /><i /><b /></div>
      <div className="duo-two"><i /><i /><b /></div>
      <Heart className="duo-heart" size={small ? 13 : 22} fill="currentColor" />
    </div>
  );
}

function dateLabel(date: string) {
  const [, month, day] = date.split('-').map(Number);
  return `${month}月${day}日`;
}

function dayOfWeek(date: string) {
  return weekdays[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
}

export default function Home() {
  const [ledger, setLedger] = useState<Ledger>(blank);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('today');
  const [recordMode, setRecordMode] = useState<'calendar' | 'list'>('calendar');
  const [calendarSelection, setCalendarSelection] = useState<{ month: string; day: string } | null>(null);
  const [hoverDay, setHoverDay] = useState<{ date: string; x: number; y: number; placement: 'top' | 'bottom' } | null>(null);
  const [analysisMonth, setAnalysisMonth] = useState<string | null>(null);
  const [trendDay, setTrendDay] = useState<string | null>(null);
  const [analysisOwner, setAnalysisOwner] = useState<Owner | '全部'>('全部');
  const [hasLoaded, setHasLoaded] = useState(false);
  const [owner, setOwner] = useState<Owner | '全部'>('全部');
  const [type, setType] = useState<EntryFilter>('all');
  const [modal, setModal] = useState<'entry' | 'opening' | 'share' | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [entryType, setEntryType] = useState<Entry['type']>('expense');
  const [amount, setAmount] = useState('');
  const [selectedOwner, setSelectedOwner] = useState<Owner | null>(null);
  const [date, setDate] = useState(chinaToday());
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const deleteRef = useRef<HTMLDialogElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = (text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  };

  const refresh = useCallback((signal?: AbortSignal) => {
    return fetch('/api/ledger', { cache: 'no-store', signal })
      .then(async (response) => {
        const result = (await response.json()) as Ledger & { error?: string };
        if (!response.ok) throw new Error(result.error || '加载失败');
        if (signal?.aborted) return;
        setLedger(result);
        setHasLoaded(true);
        setError('');
      })
      .catch((caught: unknown) => {
        if (!signal?.aborted) setError(caught instanceof Error ? caught.message : '加载失败');
      })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), 20000);
    const focus = () => void refresh(controller.signal);
    window.addEventListener('focus', focus);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    if (modal) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [modal]);

  useEffect(() => {
    if (deleting) deleteRef.current?.showModal();
    else deleteRef.current?.close();
  }, [deleting]);

  useEffect(() => {
    if (!hoverDay) return;
    const hide = () => setHoverDay(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [hoverDay]);

  const data = ledger;
  const currentMonth = data.today.slice(0, 7);
  const month = view === 'analysis' ? (analysisMonth ?? currentMonth) : (calendarSelection?.month ?? currentMonth);
  const selectedDay = calendarSelection?.day ?? data.today;
  const dataReady = hasLoaded;
  const monthLabel = `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月`;
  const isCurrent = month === currentMonth;
  const monthStats = totals(data.entries.filter((entry) => analysisOwner === '全部' || entry.owner === analysisOwner), month);
  const balance = totals(data.entries, currentMonth, data.opening).balance;
  const filteredEntries = data.entries
    .filter(
      (entry) =>
        entry.date.startsWith(month) &&
        (owner === '全部' || entry.owner === owner) &&
        (type === 'all' || entry.type === type),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const daily = dailyTotals(data.entries, month, { type, owner });
  const dailyMap = new Map(daily.map((item) => [item.date, item]));
  const hoverEntries = hoverDay
    ? data.entries
        .filter(
          (entry) =>
            entry.date === hoverDay.date &&
            (owner === '全部' || entry.owner === owner) &&
            (type === 'all' || entry.type === type),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const hoverTotal = hoverDay ? dailyMap.get(hoverDay.date) : undefined;
  const selectedEntries = data.entries
    .filter(
      (entry) =>
        entry.date === selectedDay &&
        (owner === '全部' || entry.owner === owner) &&
        (type === 'all' || entry.type === type),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selectedSummary = dailyMap.get(selectedDay) ?? {
    date: selectedDay,
    income: 0,
    expense: 0,
    surplus: 0,
    count: 0,
  };
  const todayEntries = data.entries
    .filter((entry) => entry.date === data.today)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const todaySummary = {
    income: todayEntries.filter((entry) => entry.type === 'income').reduce((sum, entry) => sum + entry.amount, 0),
    expense: todayEntries.filter((entry) => entry.type === 'expense').reduce((sum, entry) => sum + entry.amount, 0),
  };
  const analysisDays = dailyTotals(data.entries, month, { owner: analysisOwner });
  const analysisMap = new Map(analysisDays.map((item) => [item.date, item]));
  const maxExpenseDay = analysisDays.reduce<DailyTotal | null>(
    (best, item) => item.expense > (best?.expense ?? 0) ? item : best, null,
  );
  const recordedDays = analysisDays.length;
  const monthDays = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  const elapsedDays = isCurrent ? Number(data.today.slice(8)) : monthDays;
  const averageExpense = Math.round(monthStats.expense / elapsedDays);
  const trendDays = Array.from({ length: elapsedDays }, (_, index) => {
    const dateValue = `${month}-${String(index + 1).padStart(2, '0')}`;
    return analysisMap.get(dateValue) ?? { date: dateValue, income: 0, expense: 0, surplus: 0, count: 0 };
  });
  const maxDailyAmount = Math.max(...analysisDays.map((item) => Math.max(item.income, item.expense)), 1);
  const trendSelection = trendDays.find((item) => item.date === trendDay) ?? trendDays[trendDays.length - 1];
  const firstWeekday = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const calendarCells = Array.from({ length: Math.ceil((firstWeekday + monthDays) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day < 1 || day > monthDays ? null : `${month}-${String(day).padStart(2, '0')}`;
  });
  const hasRecordFilters = type !== 'all' || owner !== '全部';
  const typeLabel = type === 'all' ? '全部收支' : type === 'income' ? '收入' : '支出';

  function selectDay(value: string) {
    if (value < '1900-01-01' || value > data.today) return;
    setCalendarSelection(value === data.today ? null : { month: value.slice(0, 7), day: value });
  }

  function showDayCard(dateValue: string, element: HTMLElement) {
    if (dateValue > data.today) return;
    const rect = element.getBoundingClientRect();
    const width = 252;
    const height = 190;
    const gap = 10;
    const placement = rect.bottom + height + gap > window.innerHeight && rect.top > height + gap ? 'top' : 'bottom';
    const x = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
    setHoverDay({
      date: dateValue,
      x,
      y: placement === 'top' ? rect.top - gap : rect.bottom + gap,
      placement,
    });
  }

  function setDisplayedMonth(value: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || value < '1900-01' || value > currentMonth) return;
    if (view === 'analysis') {
      setAnalysisMonth(value === currentMonth ? null : value);
      setTrendDay(null);
    } else {
      setCalendarSelection(value === currentMonth ? null : { month: value, day: `${value}-01` });
    }
  }

  function changeMonth(diff: number) {
    const dateValue = new Date(`${month}-01T00:00:00Z`);
    dateValue.setUTCMonth(dateValue.getUTCMonth() + diff);
    setDisplayedMonth(dateValue.toISOString().slice(0, 7));
  }

  function shiftDay(diff: number) {
    const value = new Date(`${selectedDay}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + diff);
    selectDay(value.toISOString().slice(0, 10));
  }

  function openEntry(entry?: Entry, presetDate = data.today, presetType: Entry['type'] = 'expense') {
    if (!dataReady || (!entry && presetDate > data.today)) return;
    setEditing(entry ?? null);
    setEntryType(entry?.type ?? presetType);
    setAmount(entry ? (entry.amount / 100).toFixed(2) : '');
    setSelectedOwner(entry?.owner ?? null);
    setDate(entry?.date ?? presetDate);
    setNote(entry?.note ?? '');
    setFormError('');
    setModal('entry');
  }

  function openOpening() {
    setEditing(null);
    setAmount((data.opening / 100).toFixed(2));
    setFormError('');
    setModal('opening');
  }

  async function mutate(body: MutationBody) {
    const response = await fetch('/api/ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as Ledger & { error?: string };
    if (!response.ok) {
      if (response.status === 409) void refresh();
      throw new Error(result.error || '保存失败');
    }
    setLedger(result);
    setHasLoaded(true);
    return result;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');
    setBusy(true);
    try {
      if (modal === 'opening') {
        await mutate({ action: 'opening', opening: toCents(amount, true), revision: ledger.settingsRevision });
        notify('期初存款已更新');
      } else {
        if (!selectedOwner) throw new Error('请选择这笔账的归属');
        await mutate({
          action: 'save',
          entry: {
            id: editing?.id,
            revision: editing?.revision,
            type: entryType,
            amount: toCents(amount),
            owner: selectedOwner,
            date,
            note,
          },
        });
        selectDay(date);
        setOwner('全部');
        setType('all');
        if (date !== data.today || view !== 'today') { setView('records'); setRecordMode('calendar'); }
        notify(editing ? '记录已更新' : '记下了，又是生活的一笔');
      }
      setModal(null);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setFormError('');
    try {
      await mutate({ action: 'delete', id: deleting.id, revision: deleting.revision });
      setDeleting(null);
      setModal(null);
      notify('记录已删除');
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  function resetFilters() {
    setOwner('全部');
    setType('all');
    setCalendarSelection(null);
  }

  function goTo(viewName: View) {
    setView(viewName);
    if (viewName === 'today') resetFilters();
  }

  function entryRows(entries: Entry[], isToday = false) {
    if (!entries.length) {
      const isFiltered = !isToday && hasRecordFilters;
      return (
        <div className="empty small-empty">
          <Clock3 size={24} aria-hidden="true" />
          <h3>{isFiltered ? '这一天没有符合筛选的记录' : isToday ? '今天还没有记录' : '这一天还没有记录'}</h3>
          <p>{isFiltered ? '可以清除筛选，查看这一天的全部账目。' : '尚未记录，不代表当天没有收支。'}</p>
          {isFiltered ? <button className="text-button" onClick={() => { setType('all'); setOwner('全部'); }}>清除筛选 <X size={15} /></button> :
            <button className="text-button" onClick={() => openEntry(undefined, isToday ? data.today : selectedDay)}>
              {isToday ? '记下今天的第一笔' : '补记这一天'} <ArrowRight size={15} />
            </button>}
        </div>
      );
    }
    return entries.map((entry) => (
      <button className="entry-row" key={entry.id} onClick={() => openEntry(entry)}>
        <span className={`entry-icon ${entry.type === 'income' ? 'income-bg' : 'neutral-bg'}`} aria-hidden="true">
          {entry.type === 'income' ? <ArrowDownLeft size={19} /> : entry.owner === '共同' ? <Heart size={18} /> : <ArrowUpRight size={19} />}
        </span>
        <span className="entry-desc">
          <strong>{entry.note || (entry.type === 'income' ? '一笔收入' : '一笔支出')}</strong>
          <span>{entry.date === data.today ? '今天' : `${dateLabel(entry.date)} · 星期${dayOfWeek(entry.date)}`}<i />{entry.type === 'income' ? '收入' : '支出'}</span>
        </span>
        <span className={`tag ${ownerClass(entry.owner)}`}>{entry.owner}</span>
        <strong className={`entry-amount ${entry.type === 'income' ? 'income' : ''}`}>
          {entry.type === 'income' ? '+' : '−'} {money(entry.amount)}
        </strong>
        <ChevronRight className="entry-arrow" size={14} aria-hidden="true" />
      </button>
    ));
  }

  function renderToday() {
    return (
      <>
        <div className="today-context">
          <span>{dateLabel(data.today)} · 星期{dayOfWeek(data.today)}</span>
          <div className="today-savings" aria-label={`存款 ${money(balance)} 元`}><span>存款</span><span className="today-savings-value">¥ {money(balance)}</span></div>
        </div>
        <section className="today-hero">
          <div>
            <h1>今天，也记一笔。</h1>
            <p>把当天的收入和支出记下来，月底一起看清楚。</p>
          </div>
          <div className="today-actions">
            <button className="quick-action expense-action" onClick={() => openEntry(undefined, data.today, 'expense')}>
              <ArrowUpRight size={20} aria-hidden="true" /><span>记支出</span><small>今天花了什么？</small>
            </button>
            <button className="quick-action income-action" onClick={() => openEntry(undefined, data.today, 'income')}>
              <ArrowDownLeft size={20} aria-hidden="true" /><span>记收入</span><small>今天收到什么？</small>
            </button>
          </div>
        </section>
        <section className="today-summary-grid" aria-label="今日已记录收支">
          <div className="today-summary-card"><span>今日收入</span><strong className="income">¥ {money(todaySummary.income)}</strong><small>{todayEntries.filter((entry) => entry.type === 'income').length} 笔记录</small></div>
          <div className="today-summary-card"><span>今日支出</span><strong>¥ {money(todaySummary.expense)}</strong><small>{todayEntries.filter((entry) => entry.type === 'expense').length} 笔记录</small></div>
          <div className="today-summary-card"><span>今日结余</span><strong className={todaySummary.income - todaySummary.expense >= 0 ? 'income' : 'negative'}>¥ {money(todaySummary.income - todaySummary.expense)}</strong><small>已记录收入 − 支出</small></div>
        </section>
        <section className="today-records panel">
          <div className="section-head"><div><h2>今天的记录 <span>{todayEntries.length} 笔</span></h2><p className="section-subtitle">查看或修改今天已经记下的账目。</p></div><button className="text-button" onClick={() => { setView('records'); setRecordMode('calendar'); resetFilters(); }}>查看日历 <CalendarDays size={16} /></button></div>
          <div className="entry-list">{entryRows(todayEntries, true)}</div>
        </section>
      </>
    );
  }

  function renderFilters(analysis = false) {
    const activeOwner = analysis ? analysisOwner : owner;
    return (
      <div className="records-filters">
        <div className="filter-label"><Filter size={16} />{analysis ? '记账归属' : '筛选账目'}</div>
        {!analysis && <div className="type-filter" role="group" aria-label="收支类型">
          {(['all', 'income', 'expense'] as EntryFilter[]).map((item) => (
            <button key={item} aria-pressed={type === item} className={type === item ? 'selected' : ''} onClick={() => setType(item)}>
              {item === 'all' ? '全部收支' : item === 'income' ? '收入' : '支出'}
            </button>
          ))}
        </div>}
        <div className="owner-filter" role="group" aria-label="记账归属">{(['全部', ...owners] as const).map((item) => <button key={item} aria-pressed={activeOwner === item} className={activeOwner === item ? 'selected' : ''} onClick={() => analysis ? setAnalysisOwner(item) : setOwner(item)}>{item === '全部' ? '全部归属' : item}</button>)}</div>
      </div>
    );
  }

  function renderMonthToolbar(analysis = false) {
    return (
      <div className="month-toolbar">
        <div className="month-picker">
          <button aria-label="上个月" disabled={month <= '1900-01'} onClick={() => changeMonth(-1)}><ChevronLeft size={19} /></button>
          <MonthPicker value={month} max={currentMonth} onChange={setDisplayedMonth} />
          <button aria-label="下个月" disabled={month >= currentMonth} onClick={() => changeMonth(1)}><ChevronRight size={19} /></button>
          {!isCurrent && <button className="back-month" onClick={() => setDisplayedMonth(currentMonth)}>回到本月</button>}
        </div>
        <span className="date-caption">{analysis ? '月度分析' : '月度账目'}</span>
      </div>
    );
  }

  function renderCalendar() {
    return (
      <div className="calendar-layout">
        <section className="calendar-panel panel" aria-label={`${monthLabel}收支日历`}>
          <div className="calendar-weekdays" aria-hidden="true">{weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
          <div className="calendar-grid">
            {calendarCells.map((dateValue, index) => {
              if (!dateValue) return <span className="calendar-empty" key={`empty-${index}`} aria-hidden="true" />;
              const total = dailyMap.get(dateValue);
              const selected = selectedDay === dateValue;
              const today = data.today === dateValue;
              const future = dateValue > data.today;
              const dayLabel = `${dateValue}，星期${dayOfWeek(dateValue)}${today ? '，今天' : ''}，${future ? '尚未到来' : total ? `${total.count}笔，收入${money(total.income)}元，支出${money(total.expense)}元` : hasRecordFilters ? '无符合筛选的记录' : '暂无记录'}`;
              return (
                <button key={dateValue} aria-label={dayLabel} aria-pressed={selected} aria-current={today ? 'date' : undefined} disabled={future} className={`calendar-day ${selected ? 'selected' : ''} ${today ? 'today' : ''} ${future ? 'calendar-future' : ''}`} onClick={() => selectDay(dateValue)} onMouseEnter={(event) => showDayCard(dateValue, event.currentTarget)} onMouseLeave={() => setHoverDay(null)} onFocus={(event) => showDayCard(dateValue, event.currentTarget)} onBlur={() => setHoverDay(null)}>
                  <span className="calendar-day-number">{Number(dateValue.slice(8))}</span>
                  <span className="calendar-day-dots" aria-hidden="true">{total?.income ? <i className="income" /> : null}{total?.expense ? <i className="expense" /> : null}</span>
                </button>
              );
            })}
          </div>
          <p className="calendar-legend"><span><i className="legend-income" />有收入</span><span><i className="legend-expense" />有支出</span><span>点选日期，在右侧查看完整金额</span></p>
          <p className="daily-note">圆点仅标记当天有记录；尚无记录不代表当天没有收支。</p>
        </section>
        {hoverDay && (
          <div className="day-card" aria-hidden="true" style={{ left: hoverDay.x, top: hoverDay.y, transform: hoverDay.placement === 'top' ? 'translateY(-100%)' : undefined }}>
            <div className="day-card-head">
              <strong>{dateLabel(hoverDay.date)}</strong>
              <em>星期{dayOfWeek(hoverDay.date)}{hoverDay.date === data.today ? ' · 今天' : ''}</em>
            </div>
            {hoverTotal ? (
              <>
                <div className="day-card-totals">
                  <span className="income">收入 ¥{money(hoverTotal.income)}</span>
                  <span className="expense">支出 ¥{money(hoverTotal.expense)}</span>
                </div>
                <div className="day-card-meta">
                  <span className={hoverTotal.surplus >= 0 ? 'income' : 'negative'}>结余 ¥{money(hoverTotal.surplus)}</span>
                  <span>{hoverTotal.count} 笔</span>
                </div>
                <div className="day-card-list">
                  {hoverEntries.slice(0, 3).map((entry) => (
                    <div key={entry.id}>
                      <span>{entry.note || '未填写备注'}</span>
                      <b className={entry.type === 'income' ? 'income' : 'expense'}>{entry.type === 'income' ? '+' : '−'}{money(entry.amount)}</b>
                    </div>
                  ))}
                  {hoverEntries.length > 3 && <div><span>还有 {hoverEntries.length - 3} 笔</span></div>}
                </div>
              </>
            ) : (
              <p className="day-card-empty">{hasRecordFilters ? '没有符合筛选的记录' : '当天暂无记录'}，点击可补记一笔。</p>
            )}
          </div>
        )}
        <section className="selected-day-panel panel" aria-labelledby="selected-day-title">
          <div className="selected-day-heading"><div><h2 id="selected-day-title">{dateLabel(selectedDay)} · 星期{dayOfWeek(selectedDay)}</h2><p className="section-subtitle">{owner === '全部' ? '全部归属' : owner} · {typeLabel} · {selectedEntries.length} 笔</p></div><button className="primary small-primary" onClick={() => openEntry(undefined, selectedDay, type === 'income' ? 'income' : 'expense')}><Plus size={17} />记一笔</button></div>
          <div className="day-navigation"><button className="text-button" disabled={selectedDay <= '1900-01-01'} onClick={() => shiftDay(-1)}><ChevronLeft size={16} />前一天</button>{selectedDay !== data.today && <button className="text-button" onClick={() => selectDay(data.today)}>回到今天</button>}<button className="text-button" disabled={selectedDay >= data.today} onClick={() => shiftDay(1)}>后一天<ChevronRight size={16} /></button></div>
          <div className="day-summary" aria-label="当前筛选汇总">
            {type !== 'expense' && <div><span>收入</span><strong className="income">¥ {money(selectedSummary.income)}</strong></div>}
            {type !== 'income' && <div><span>支出</span><strong>¥ {money(selectedSummary.expense)}</strong></div>}
            {type === 'all' ? <div><span>结余</span><strong className={selectedSummary.surplus >= 0 ? 'income' : 'negative'}>¥ {money(selectedSummary.surplus)}</strong></div> : <div><span>匹配记录</span><strong>{selectedSummary.count} 笔</strong></div>}
          </div>
          <div className="day-entry-list">{entryRows(selectedEntries)}</div>
        </section>
      </div>
    );
  }

  function renderList() {
    const grouped = new Map<string, Entry[]>();
    filteredEntries.forEach((entry) => grouped.set(entry.date, [...(grouped.get(entry.date) ?? []), entry]));
    return (
      <section className="records panel records-list-panel">
        <div className="section-head"><div><h2>当月明细 <span>{filteredEntries.length} 笔</span></h2><p className="section-subtitle">{owner === '全部' ? '全部归属' : owner} · {typeLabel}</p></div></div>
        <div className="grouped-records">
          {grouped.size ? Array.from(grouped.entries()).map(([dateValue, entries]) => {
            const summary = dailyMap.get(dateValue)!;
            return <div className="record-day-group" key={dateValue}><div className="record-day-label"><button className="text-button" onClick={() => { selectDay(dateValue); setRecordMode('calendar'); }}><strong>{dateLabel(dateValue)}</strong><span>星期{dayOfWeek(dateValue)}</span><ChevronRight size={15} /></button><span>{type !== 'expense' && `收入 ¥${money(summary.income)}`}{type === 'all' && ' · '}{type !== 'income' && `支出 ¥${money(summary.expense)}`}</span></div><div className="entry-list">{entryRows(entries)}</div></div>;
          }) : <div className="empty"><BookHeart size={30} /><h3>当月没有符合条件的记录</h3><p>{hasRecordFilters ? '清除筛选后查看当月全部账目。' : '可以在日历中选择日期，补记当天收支。'}</p><button className="text-button" onClick={() => { if (hasRecordFilters) { setOwner('全部'); setType('all'); } else setRecordMode('calendar'); }}>{hasRecordFilters ? '清除筛选' : '查看日历'}<ArrowRight size={15} /></button></div>}
        </div>
      </section>
    );
  }

  function renderRecords() {
    return (
      <>
        {renderMonthToolbar()}
        {renderFilters()}
        <div className="record-view-tabs" role="group" aria-label="账目视图"><button aria-pressed={recordMode === 'calendar'} className={recordMode === 'calendar' ? 'selected' : ''} onClick={() => setRecordMode('calendar')}><CalendarDays size={17} />日历</button><button aria-pressed={recordMode === 'list'} className={recordMode === 'list' ? 'selected' : ''} onClick={() => setRecordMode('list')}><List size={17} />明细</button></div>
        {recordMode === 'calendar' ? renderCalendar() : renderList()}
      </>
    );
  }

  function renderAnalysis() {
    return (
      <>
        <section className="analysis-savings" aria-labelledby="analysis-savings-title">
          <div className="analysis-savings-amount"><h2 id="analysis-savings-title">存款</h2><strong>¥ {money(balance)}</strong></div>
          <div className="analysis-savings-note"><p>截至今天 · 全部归属</p><p>期初存款 + 全部收入 − 全部支出</p></div>
        </section>
        <section className="analysis-monthly" aria-labelledby="analysis-monthly-title">
        <h2 id="analysis-monthly-title">月度收支</h2>
        {renderMonthToolbar(true)}
        {renderFilters(true)}
        <section className="analysis-summary-grid" aria-label="所选月份和归属的收支汇总">
          <div className="analysis-card"><span>当月收入</span><strong className="income">¥ {money(monthStats.income)}</strong><small>{analysisDays.filter((item) => item.income > 0).length} 天有收入记录</small></div>
          <div className="analysis-card"><span>当月支出</span><strong>¥ {money(monthStats.expense)}</strong><small>日均 ¥ {money(averageExpense)} · 按 {elapsedDays} 天</small></div>
          <div className="analysis-card"><span>当月盈余</span><strong className={monthStats.surplus >= 0 ? 'income' : 'negative'}>¥ {money(monthStats.surplus)}</strong><small>{recordedDays} 天有记录 · {analysisDays.reduce((sum, item) => sum + item.count, 0)} 笔</small></div>
        </section>
        <div className="analysis-highlight"><span>支出最高日</span><strong>{maxExpenseDay ? `¥ ${money(maxExpenseDay.expense)}` : '—'}</strong><small>{maxExpenseDay ? `${dateLabel(maxExpenseDay.date)} · 星期${dayOfWeek(maxExpenseDay.date)}` : '当月尚无支出记录'}</small></div>
        <p className="daily-note">仅统计已录入账目。日均支出按{isCurrent ? `当月已过的 ${elapsedDays} 天` : `当月 ${elapsedDays} 个自然日`}计算；未记账日期不等于零收支。</p>
        <div className="analysis-grid">
          <section className="analysis-trend panel">
            <div className="section-head"><div><h2>每天的收支趋势</h2><p className="section-subtitle">点选日期查看金额，也可以展开每日数据。</p></div><TrendingUp size={20} aria-hidden="true" /></div>
            {recordedDays ? <><div className="trend-scroll" tabIndex={0} role="region" aria-label="每日收支柱状图，可横向滚动"><div className="trend-chart">{trendDays.map((item) => <button className="trend-column" key={item.date} aria-pressed={trendSelection.date === item.date} aria-label={`${item.date}，${item.count ? `收入${money(item.income)}元，支出${money(item.expense)}元` : '尚无记录'}`} title={`${dateLabel(item.date)}：收入 ¥${money(item.income)} / 支出 ¥${money(item.expense)}`} onClick={() => setTrendDay(item.date)}><span className="trend-bars" aria-hidden="true"><span className="trend-bar income" style={{ height: `${item.income / maxDailyAmount * 100}%` }} /><span className="trend-bar expense" style={{ height: `${item.expense / maxDailyAmount * 100}%` }} /></span><small>{Number(item.date.slice(8))}</small></button>)}</div></div><div className="trend-readout" aria-live="polite"><strong>{dateLabel(trendSelection.date)}</strong><span>{trendSelection.count ? `收入 ¥${money(trendSelection.income)} · 支出 ¥${money(trendSelection.expense)}` : '尚无记录'}</span><button className="text-button" onClick={() => { selectDay(trendSelection.date); setOwner(analysisOwner); setType('all'); setRecordMode('calendar'); setView('records'); }}>查看当天<ArrowRight size={15} /></button></div></> : <div className="empty"><BarChart3 size={28} /><h3>当月还没有记录</h3><p>记录收入和支出后，即可查看每天的变化。</p></div>}
            <div className="trend-legend"><span><i className="legend-income" />收入</span><span><i className="legend-expense" />支出</span><span>共 {elapsedDays} 天</span></div>
            {recordedDays > 0 && <details className="analysis-table"><summary>查看每日数据</summary><div className="table-scroll"><table><caption>{monthLabel} · {analysisOwner === '全部' ? '全部归属' : analysisOwner}</caption><thead><tr><th scope="col">日期</th><th scope="col">收入</th><th scope="col">支出</th><th scope="col">结余</th><th scope="col">记录</th></tr></thead><tbody>{trendDays.map((item) => <tr key={item.date}><th scope="row">{dateLabel(item.date)}</th><td>{item.count ? money(item.income) : '—'}</td><td>{item.count ? money(item.expense) : '—'}</td><td>{item.count ? money(item.surplus) : '—'}</td><td>{item.count ? `${item.count} 笔` : '未记录'}</td></tr>)}</tbody></table></div></details>}
          </section>
          <section className="analysis-owner panel"><div className="section-head"><div><h2>按归属看收支</h2><p className="section-subtitle">{analysisOwner === '全部' ? '各自的收支与共同的部分。' : `当前查看：${analysisOwner}`}</p></div><Users size={20} aria-hidden="true" /></div><div className="owner-analysis-list">{monthStats.byOwner.filter((item) => analysisOwner === '全部' || item.owner === analysisOwner).map((item) => <div className="owner-analysis-row" key={item.owner}><div className={`owner-avatar ${ownerClass(item.owner)}`}>{item.owner === '共同' ? <Users size={17} /> : <UserRound size={17} />}</div><span>{item.owner}</span><div className="owner-analysis-values"><strong>收入 ¥ {money(item.income)}</strong><strong>支出 ¥ {money(item.expense)}</strong><small>占当月支出 {monthStats.expense ? Math.round(item.expense / monthStats.expense * 100) : 0}%</small></div></div>)}</div><div className="analysis-note"><Leaf size={16} />共同账目只计算一次，期初存款不计入收入。</div></section>
        </div>
        </section>
      </>
    );
  }

  function renderSettings() {
    return <div className="settings-panel panel"><div className="section-head"><h2>账本设置</h2><BookHeart size={20} /></div><div className="setting-row"><div><h3>期初存款</h3><p>最早一笔记录发生之前的存款</p></div><strong>¥ {money(data.opening)}</strong><button className="outline-button" onClick={openOpening}>修改</button></div><div className="setting-row"><div><h3>记账归属</h3><p>每笔手动选择，所有记录共享展示</p></div><div className="owner-tags">{owners.map((item) => <span className={`tag ${ownerClass(item)}`} key={item}>{item}</span>)}</div></div><div className="setting-row"><div><h3>共享账本</h3><p>获准访问此网站的人使用同一份账目</p></div><button className="outline-button" onClick={() => setModal('share')}><LinkIcon size={15} />账本链接</button></div></div>;
  }

  const viewLabel: Record<View, string> = { today: '今天', records: '账目', analysis: '分析', settings: '账本设置' };
  const heading: Record<View, [string, string]> = {
    today: ['把每天，记在一起。', '每天记一笔，月底一起看清楚。'],
    records: ['每一天，都有迹可循。', '按日历回看每天的收入和支出。'],
    analysis: ['月底，一起看清楚。', '从每天的记录里，看见我们的生活。'],
    settings: ['我们的小账本。', '从一个起点，开始积攒。'],
  };

  return (
    <div className="app-shell">
      <aside className="sidebar"><NextLink className="brand" href="/" onClick={() => goTo('today')} aria-label="两人账本首页"><span className="brand-icon"><BookHeart size={23} /></span><span>两人账本</span></NextLink><nav aria-label="主导航"><button aria-current={view === 'today' ? 'page' : undefined} className={view === 'today' ? 'active' : ''} onClick={() => goTo('today')}><Wallet size={19} />今天<span className="nav-dot" /></button><button aria-current={view === 'records' ? 'page' : undefined} className={view === 'records' ? 'active' : ''} onClick={() => goTo('records')}><CalendarDays size={19} />账目<span className="nav-dot" /></button><button aria-current={view === 'analysis' ? 'page' : undefined} className={view === 'analysis' ? 'active' : ''} onClick={() => goTo('analysis')}><BarChart3 size={19} />分析<span className="nav-dot" /></button><button aria-current={view === 'settings' ? 'page' : undefined} className={view === 'settings' ? 'active' : ''} onClick={() => goTo('settings')}><SlidersHorizontal size={19} />账本设置<span className="nav-dot" /></button></nav><div className="sidebar-bottom"><div className="sidebar-note"><Duo small /><p>生活的小事，<br />我们一起慢慢记。</p><span>EVERY LITTLE THING, TOGETHER.</span></div><button className="share-nav" onClick={() => setModal('share')}><Users size={18} />共享账本<ArrowUpRight size={15} /></button><div className="sidebar-foot"><span className="online-dot" />云端账本<span>人民币 CNY</span></div></div></aside>
      <main className="main"><header className="topbar"><div className="breadcrumb">我们的生活账本<span>/</span><strong>{viewLabel[view]}</strong></div><div className="top-actions"><div className="avatars"><span>你</span><span>TA</span></div></div></header>
        <div className="content">{error && <div className="error-banner" role="alert">{hasLoaded ? `${error}，当前显示上次同步的账目。` : error}<button onClick={() => { setLoading(true); void refresh(); }}><RefreshCw size={14} />重试</button></div>}
          {view !== 'today' && <section className="page-heading"><div><h1>{heading[view][0]}</h1><p>{heading[view][1]}</p></div>{view !== 'settings' && <button className="primary add-button" onClick={() => openEntry(undefined, view === 'records' ? selectedDay : data.today, view === 'records' && type === 'income' ? 'income' : 'expense')} disabled={!dataReady}><Plus size={19} />记一笔</button>}</section>}
          {!dataReady ? <section className="panel empty" role="status">{loading ? <><LoaderCircle className="spin" size={26} /><h2>正在翻开账本…</h2></> : <><BookHeart size={30} /><h2>账目暂时无法加载</h2><p>请检查网络后重试。</p><button className="outline-button" onClick={() => { setLoading(true); void refresh(); }}>重新加载</button></>}</section> : view === 'today' ? renderToday() : view === 'records' ? renderRecords() : view === 'analysis' ? renderAnalysis() : renderSettings()}
          <footer className="footer"><span><Heart size={12} />两个人的日子，一起好好过。</span><span>两人账本<span className="footer-dot">·</span>始于生活，记于日常</span></footer>
        </div>
      </main>

      <dialog ref={dialogRef} aria-labelledby="entry-dialog-title" className="modal" onCancel={(event) => { event.preventDefault(); if (!busy) setModal(null); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) setModal(null); }}><div className="modal-inner"><div className="modal-head"><div><h2 id="entry-dialog-title">{modal === 'entry' ? (editing ? '这一笔生活' : '记下这一笔') : modal === 'opening' ? '从这里开始积攒' : '两个人，一本账'}</h2></div><button className="icon-button" aria-label="关闭" disabled={busy} onClick={() => setModal(null)}><X size={21} /></button></div>{modal === 'share' ? <div className="share-content"><Duo /><h3>把生活，放在同一本账里</h3><p>通过网站的分享设置邀请另一半。获准访问后，你们看到和编辑的是同一份账目。</p><div className="share-link"><span>{typeof window !== 'undefined' ? window.location.origin : '账本链接'}</span><button className="outline-button" onClick={async () => { try { await navigator.clipboard.writeText(window.location.origin); notify('账本链接已复制'); } catch { notify('复制失败，请从浏览器地址栏复制链接'); } }}><LinkIcon size={15} />复制</button></div><p className="share-tip">网站当前为私有。复制链接不会自动授予访问权限。</p></div> : <form onSubmit={save}><>{modal === 'entry' && <div className="type-tabs" role="group" aria-label="记账类型"><button type="button" aria-pressed={entryType === 'expense'} className={entryType === 'expense' ? 'selected' : ''} onClick={() => setEntryType('expense')}><ArrowUpRight size={17} />支出</button><button type="button" aria-pressed={entryType === 'income'} className={entryType === 'income' ? 'selected income-tab' : ''} onClick={() => setEntryType('income')}><ArrowDownLeft size={17} />收入</button></div>}<label className="amount-field"><span>{modal === 'opening' ? '期初存款' : '金额'}</span><div><b>¥</b><input autoFocus aria-label="金额" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={12} required autoComplete="off" /></div></label>{modal === 'entry' ? <><label className="field-label">记在谁的名下 <span>*</span></label><div className="owner-choices">{owners.map((item, index) => <button key={item} type="button" aria-pressed={selectedOwner === item} className={`${ownerClass(item)}${selectedOwner === item ? ' selected' : ''}`} onClick={() => setSelectedOwner(item)}>{index === 2 ? <Users size={20} /> : <UserRound size={20} />}<span>{item}</span>{selectedOwner === item && <Check size={14} />}</button>)}</div><label className="form-field">发生日期<input type="date" min="1900-01-01" max={ledger.today} value={date} onChange={(event) => setDate(event.target.value)} required /></label><label className="form-field">备注<span className="optional">选填</span><input maxLength={100} placeholder="这一笔，是生活里的什么？" value={note} onChange={(event) => setNote(event.target.value)} /></label></> : <div className="opening-help"><Leaf size={18} /><p>填写最早一笔记录发生之前的存款。期初存款不算收入，请不要重复记入。补记更早的收支时，请检查期初金额是否已包含这些收支。</p></div>}{formError && <p className="form-error" role="alert">{formError}</p>}<div className="modal-actions">{editing && <button type="button" className="delete-button" disabled={busy} onClick={() => { setFormError(''); setDeleting(editing); }}><Trash2 size={17} />删除</button>}<button className="primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />} {busy ? '保存中…' : editing ? '保存修改' : '保存'}</button></div></></form>}</div></dialog>
      <dialog aria-labelledby="delete-dialog-title" className="modal confirm-modal" ref={deleteRef} onCancel={(event) => { event.preventDefault(); if (!busy) setDeleting(null); }}><div className="modal-inner"><div className="delete-illustration"><Trash2 size={25} /></div><h2 id="delete-dialog-title">删除这笔记录？</h2><p>“{deleting?.note || '这笔记录'}”将从共享账本删除，余额和月度汇总会同步更新。</p>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="confirm-actions"><button className="outline-button" disabled={busy} onClick={() => setDeleting(null)}>再想想</button><button className="danger-button" disabled={busy} onClick={remove}>{busy ? '删除中…' : '确认删除'}</button></div></div></dialog>
      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    </div>
  );
}
