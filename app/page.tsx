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
  JapaneseYen,
  Link as LinkIcon,
  List,
  LoaderCircle,
  Pencil,
  PieChart,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { MoneyBagIcon } from '@/components/money-bag-icon';
import {
  dailyTotals,
  DailyTotal,
  Entry,
  expenseCategories,
  incomeCategories,
  OwnerKey,
  ownerKeys,
  owners,
  chinaToday,
  toCents,
  totals,
} from '@/lib/ledger';
import { MonthPicker } from '@/components/month-picker';
import { DatePicker } from '@/components/date-picker';
import { Segmented } from '@/components/segmented';
import { SlidingNav } from '@/components/sliding-nav';
import { useIsomorphicLayoutEffect } from '@/hooks/use-isomorphic-layout-effect';

type OwnerInfo = { key: OwnerKey; name: string };
type Ledger = {
  entries: Entry[];
  today: string;
  avatars: Partial<Record<OwnerKey, string>>;
  categories: { expense: string[]; income: string[] };
  owners: OwnerInfo[];
};
type View = 'today' | 'records' | 'analysis' | 'settings';
type EntryFilter = 'all' | Entry['type'];

type MutationBody =
  | { action: 'avatar'; ownerKey: OwnerKey; data: string }
  | { action: 'category'; op: 'add' | 'rename' | 'delete'; type: Entry['type']; name: string; newName?: string }
  | { action: 'owner'; key: OwnerKey; name: string }
  | { action: 'delete'; id: string; revision: number }
  | { action: 'save'; entry: Partial<Entry> & { type: Entry['type']; amount: number; ownerKey: OwnerKey; date: string; note: string; category: string } };

const blank: Ledger = {
  entries: [],
  today: chinaToday(),
  avatars: {},
  categories: { expense: [...expenseCategories], income: [...incomeCategories] },
  owners: ownerKeys.map((key, index) => ({ key, name: owners[index] })),
};
const money = (n: number) =>
  (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ownerClass = (key: string) => (key === 'qing' ? 'qing' : key === 'hua' ? 'hua' : 'together');
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
  const [analysisMonth, setAnalysisMonth] = useState<string | null>(null);
  const [trendDay, setTrendDay] = useState<string | null>(null);
  const [analysisOwner, setAnalysisOwner] = useState<OwnerKey | '全部'>('全部');
  const [hasLoaded, setHasLoaded] = useState(false);
  const [owner, setOwner] = useState<OwnerKey | '全部'>('全部');
  const [type, setType] = useState<EntryFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('全部');
  const [modal, setModal] = useState<'entry' | 'share' | 'categories' | null>(null);
  const [categoryType, setCategoryType] = useState<Entry['type']>('expense');
  const [categoryDraft, setCategoryDraft] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [editingOwner, setEditingOwner] = useState<OwnerKey | null>(null);
  const [ownerNameDraft, setOwnerNameDraft] = useState('');
  const [ownerBusy, setOwnerBusy] = useState<OwnerKey | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [entryType, setEntryType] = useState<Entry['type']>('expense');
  const [entryCategory, setEntryCategory] = useState<string>(expenseCategories[0]);
  const [amount, setAmount] = useState('');
  const [selectedOwner, setSelectedOwner] = useState<OwnerKey | null>(null);
  const [date, setDate] = useState(chinaToday());
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState<OwnerKey | null>(null);
  const [toast, setToast] = useState('');
  const [toastLeaving, setToastLeaving] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const deleteRef = useRef<HTMLDialogElement>(null);
  const trendScrollRef = useRef<HTMLDivElement>(null);
  const selectedDayRef = useRef<HTMLElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastOutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = (text: string) => {
    setToast(text);
    setToastLeaving(false);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (toastOutTimer.current) clearTimeout(toastOutTimer.current);
    toastTimer.current = setTimeout(() => {
      setToastLeaving(true);
      toastOutTimer.current = setTimeout(() => {
        setToast('');
        setToastLeaving(false);
      }, 220);
    }, 3200);
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

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (toastOutTimer.current) clearTimeout(toastOutTimer.current);
  }, []);

  useEffect(() => {
    if (modal) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [modal]);

  useEffect(() => {
    if (deleting) deleteRef.current?.showModal();
    else deleteRef.current?.close();
  }, [deleting]);

  const data = ledger;
  const ownerNames = data.owners.map((item) => item.name);
  const ownerKeyByName = new Map(data.owners.map((item) => [item.name, item.key]));
  const ownerNameByKey = new Map(data.owners.map((item) => [item.key, item.name]));
  const photoForOwner = (key: OwnerKey) => data.avatars?.[key] ?? (key === 'hua' ? '/huang.jpg' : '');
  const currentMonth = data.today.slice(0, 7);
  const month = view === 'analysis' ? (analysisMonth ?? currentMonth) : (calendarSelection?.month ?? currentMonth);
  const selectedDay = calendarSelection?.day ?? data.today;
  const dataReady = hasLoaded;
  const monthLabel = `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月`;
  const isCurrent = month === currentMonth;
  const monthStats = totals(data.entries.filter((entry) => analysisOwner === '全部' || entry.ownerKey === analysisOwner), month, 0, ownerNames);
  const analysisEntries = data.entries.filter((entry) => entry.date.startsWith(month) && (analysisOwner === '全部' || entry.ownerKey === analysisOwner));
  const analysisOwnerName = analysisOwner === '全部' ? null : ownerNameByKey.get(analysisOwner);
  // 历史盈余：截至所选月份结束时的累计盈余（含当月），随归属筛选变化。
  const historySurplus = data.entries
    .filter((entry) => entry.date.slice(0, 7) <= month && (analysisOwner === '全部' || entry.ownerKey === analysisOwner))
    .reduce((sum, entry) => sum + (entry.type === 'income' ? entry.amount : -entry.amount), 0);
  const categoryBreakdown = (entryType: Entry['type'], categories: readonly string[]) =>
    categories
      .map((category) => ({
        category,
        amount: analysisEntries.filter((entry) => entry.type === entryType && entry.category === category).reduce((sum, entry) => sum + entry.amount, 0),
      }))
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  const expenseBreakdown = categoryBreakdown('expense', data.categories.expense);
  const incomeBreakdown = categoryBreakdown('income', data.categories.income);
  const balance = totals(data.entries, currentMonth, 0, ownerNames).balance;
  const filteredEntries = data.entries
    .filter(
      (entry) =>
        entry.date.startsWith(month) &&
        (owner === '全部' || entry.ownerKey === owner) &&
        (type === 'all' || entry.type === type) &&
        (categoryFilter === '全部' || entry.category === categoryFilter),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  // 筛选只在明细视图生效，日历视图始终展示完整账目。
  const daily = dailyTotals(
    data.entries,
    month,
    recordMode === 'list' ? { type, ownerKey: owner, category: categoryFilter } : { type: 'all', ownerKey: '全部', category: '全部' },
  );
  const dailyMap = new Map(daily.map((item) => [item.date, item]));
  const selectedEntries = data.entries
    .filter(
      (entry) =>
        entry.date === selectedDay &&
        (recordMode === 'calendar' || (
          (owner === '全部' || entry.ownerKey === owner) &&
          (type === 'all' || entry.type === type) &&
          (categoryFilter === '全部' || entry.category === categoryFilter)
        )),
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
  const analysisDays = dailyTotals(data.entries, month, { ownerKey: analysisOwner });
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
  const hasRecordFilters = type !== 'all' || owner !== '全部' || categoryFilter !== '全部';
  const filterCategories = type === 'all' ? Array.from(new Set([...data.categories.expense, ...data.categories.income])) : data.categories[type];

  // 趋势图默认定位到最近的日期，避免最新几天被横向滚动藏在右侧。
  useIsomorphicLayoutEffect(() => {
    if (view !== 'analysis') return;
    const container = trendScrollRef.current;
    if (!container) return;
    container.scrollLeft = container.scrollWidth;
  }, [view, month, analysisOwner, recordedDays]);

  function selectDay(value: string) {
    if (value < '1900-01-01' || value > data.today) return;
    setCalendarSelection(value === data.today ? null : { month: value.slice(0, 7), day: value });
  }

  function pickCalendarDay(value: string) {
    selectDay(value);
    requestAnimationFrame(() => {
      const panel = selectedDayRef.current;
      if (!panel) return;
      if (panel.getBoundingClientRect().top < window.innerHeight - 120) return;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
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

  function openEntry(entry?: Entry, presetDate = data.today, presetType: Entry['type'] = 'expense') {
    if (!dataReady || (!entry && presetDate > data.today)) return;
    const nextType = entry?.type ?? presetType;
    const nextCategories = data.categories[nextType] ?? [];
    setEditing(entry ?? null);
    setEntryType(nextType);
    setEntryCategory(entry?.category && nextCategories.includes(entry.category) ? entry.category : nextCategories[0] ?? '');
    setAmount(entry ? (entry.amount / 100).toFixed(2) : '');
    setSelectedOwner(entry?.ownerKey ?? null);
    setDate(entry?.date ?? presetDate);
    setNote(entry?.note ?? '');
    setFormError('');
    setModal('entry');
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

  function makeAvatar(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const size = 160;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) {
          URL.revokeObjectURL(url);
          reject(new Error('图片处理失败'));
          return;
        }
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('无法读取图片'));
      };
      image.src = url;
    });
  }

  async function chooseAvatar(event: React.ChangeEvent<HTMLInputElement>, ownerKey: OwnerKey) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify('请选择图片文件');
      return;
    }
    setAvatarBusy(ownerKey);
    try {
      const data = await makeAvatar(file);
      await mutate({ action: 'avatar', ownerKey, data });
      notify(`${ownerNameByKey.get(ownerKey) ?? ownerKey}的头像已更新`);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '头像上传失败');
    } finally {
      setAvatarBusy(null);
    }
  }

  function syncCategorySelections(result: Ledger, renamed?: { type: Entry['type']; from: string; to: string }) {
    if (renamed && renamed.type === entryType && entryCategory === renamed.from) {
      setEntryCategory(renamed.to);
    } else if (!result.categories[entryType].includes(entryCategory)) {
      setEntryCategory(result.categories[entryType][0] ?? '');
    }
    const nextFilter = type === 'all' ? Array.from(new Set([...result.categories.expense, ...result.categories.income])) : result.categories[type];
    if (categoryFilter !== '全部' && !nextFilter.includes(categoryFilter)) setCategoryFilter('全部');
  }

  function openCategories() {
    setCategoryType('expense');
    setCategoryDraft('');
    setEditingCategory(null);
    setDeletingCategory(null);
    setModal('categories');
  }

  function startEditOwner(item: OwnerInfo) {
    setEditingOwner(item.key);
    setOwnerNameDraft(item.name);
  }

  async function saveOwnerName(key: OwnerKey) {
    const name = ownerNameDraft.trim();
    if (!name) {
      notify('名字不能为空');
      return;
    }
    setOwnerBusy(key);
    try {
      await mutate({ action: 'owner', key, name });
      setEditingOwner(null);
      notify('名字已更新');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setOwnerBusy(null);
    }
  }

  async function addCategory() {
    const name = categoryDraft.trim();
    if (!name) {
      notify('请输入分类名称');
      return;
    }
    setCategoryBusy(true);
    try {
      const result = await mutate({ action: 'category', op: 'add', type: categoryType, name });
      setCategoryDraft('');
      syncCategorySelections(result);
      notify('分类已添加');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '添加失败');
    } finally {
      setCategoryBusy(false);
    }
  }

  async function renameCategory(name: string) {
    const newName = editingCategoryName.trim();
    if (!newName) {
      notify('请输入分类名称');
      return;
    }
    setCategoryBusy(true);
    try {
      const result = await mutate({ action: 'category', op: 'rename', type: categoryType, name, newName });
      setEditingCategory(null);
      syncCategorySelections(result, { type: categoryType, from: name, to: newName });
      notify('分类已更新');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setCategoryBusy(false);
    }
  }

  async function removeCategory(name: string) {
    setCategoryBusy(true);
    try {
      const result = await mutate({ action: 'category', op: 'delete', type: categoryType, name });
      setDeletingCategory(null);
      syncCategorySelections(result);
      notify('分类已删除');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '删除失败');
    } finally {
      setCategoryBusy(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');
    setBusy(true);
    try {
      if (!selectedOwner) throw new Error('请选择这笔账的归属');
      await mutate({
        action: 'save',
        entry: {
          id: editing?.id,
          revision: editing?.revision,
          type: entryType,
          amount: toCents(amount),
          ownerKey: selectedOwner,
          date,
          note,
          category: entryCategory,
        },
      });
      selectDay(date);
      setOwner('全部');
      setType('all');
      if (date !== data.today || view !== 'today') { goTo('records'); setRecordMode('calendar'); }
      notify(editing ? '记录已更新' : '记下了，又是生活的一笔');
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
    setCategoryFilter('全部');
    setCalendarSelection(null);
  }

  function goTo(viewName: View) {
    if (viewName !== view) window.scrollTo({ top: 0 });
    setView(viewName);
    if (viewName === 'today') resetFilters();
  }

  function entryRows(entries: Entry[], isToday = false, applyFilters = true) {
    if (!entries.length) {
      const isFiltered = !isToday && applyFilters && hasRecordFilters;
      return (
        <div className="empty small-empty">
          <Clock3 size={24} aria-hidden="true" />
          <h3>{isFiltered ? '这一天没有符合筛选的记录' : isToday ? '今天还没有记录' : '这一天还没有记录'}</h3>
          {isFiltered && <><p>可以清除筛选，查看这一天的全部账目。</p><button className="text-button" onClick={() => { setType('all'); setOwner('全部'); setCategoryFilter('全部'); }}>清除筛选 <X size={15} /></button></>}
        </div>
      );
    }
    return entries.map((entry, index) => {
      const photo = photoForOwner(entry.ownerKey);
      return (
        <button className="entry-row" key={entry.id} style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }} onClick={() => openEntry(entry)}>
          <span className={`entry-icon ${entry.type === 'income' ? 'income-bg' : 'expense-bg'}`} aria-hidden="true">
            {entry.type === 'income' ? <ArrowDownLeft size={19} /> : entry.ownerKey === 'together' ? <Heart size={18} /> : <ArrowUpRight size={19} />}
          </span>
          <span className="entry-desc">
            <strong>{entry.note || (entry.type === 'income' ? '一笔收入' : '一笔支出')}</strong>
            <span>{entry.date === data.today ? '今天' : `${dateLabel(entry.date)} · 星期${dayOfWeek(entry.date)}`}<i />{entry.type === 'income' ? '收入' : '支出'}<i />{entry.category}</span>
          </span>
          <span className={`tag ${ownerClass(entry.ownerKey)}`}>
            <i className="tag-avatar" style={photo ? { backgroundImage: `url(${photo})` } : undefined} aria-hidden="true">{photo ? null : entry.ownerKey === 'together' ? <Users size={12} /> : <UserRound size={12} />}</i>
            {entry.owner}
          </span>
          <strong className={`entry-amount ${entry.type === 'income' ? 'income' : 'expense'}`}>
            {entry.type === 'income' ? '+' : '−'} {money(entry.amount)}
          </strong>
          <ChevronRight className="entry-arrow" size={14} aria-hidden="true" />
        </button>
      );
    });
  }

  function renderToday() {
    return (
      <>
        <section className="today-hero">
          <div>
            <h1>今天，也记一笔。</h1>
          </div>
          <div className="today-actions">
            <button className="quick-action expense-action" onClick={() => openEntry(undefined, data.today, 'expense')}>
              <span className="quick-action-icon"><JapaneseYen size={20} strokeWidth={2} aria-hidden="true" /></span><span className="quick-action-label">记支出</span>
            </button>
            <button className="quick-action income-action" onClick={() => openEntry(undefined, data.today, 'income')}>
              <span className="quick-action-icon"><MoneyBagIcon size={20} aria-hidden="true" /></span><span className="quick-action-label">记收入</span>
            </button>
          </div>
        </section>
        <section className="today-summary-grid" aria-label="今日已记录收支">
          <div className="today-summary-card"><span>今日支出</span><strong className="expense">¥ {money(todaySummary.expense)}</strong><small>{todayEntries.filter((entry) => entry.type === 'expense').length} 笔记录</small></div>
          <div className="today-summary-card"><span>今日收入</span><strong className="income">¥ {money(todaySummary.income)}</strong><small>{todayEntries.filter((entry) => entry.type === 'income').length} 笔记录</small></div>
        </section>
        <section className="today-records panel">
          <div className="section-head"><div><h2>今天的记录 <span>{todayEntries.length} 笔</span></h2></div><button className="text-button" onClick={() => { goTo('records'); setRecordMode('calendar'); resetFilters(); }}>查看日历 <CalendarDays size={16} /></button></div>
          <div className="entry-list">{entryRows(todayEntries, true)}</div>
        </section>
      </>
    );
  }

  function renderFilters(analysis = false) {
    const activeOwner = analysis ? analysisOwner : owner;
    const ownerOptions: { key: OwnerKey | '全部'; name: string }[] = [
      { key: '全部', name: '全部归属' },
      ...data.owners.map((item) => ({ key: item.key, name: item.name })),
    ];
    return (
      <div className="records-filters">
        <div className="filter-label"><Filter size={16} />{analysis ? '记账归属' : '筛选账目'}</div>
        {!analysis && <Segmented className="type-filter" active={type} role="group" aria-label="收支类型">
          {(['all', 'income', 'expense'] as EntryFilter[]).map((item) => (
            <button key={item} aria-pressed={type === item} className={type === item ? 'selected' : ''} onClick={() => { setType(item); const next = item === 'all' ? [...new Set([...data.categories.expense, ...data.categories.income])] : data.categories[item]; if (categoryFilter !== '全部' && !next.includes(categoryFilter)) setCategoryFilter('全部'); }}>
              {item === 'all' ? '全部收支' : item === 'income' ? '收入' : '支出'}
            </button>
          ))}
        </Segmented>}
        {!analysis && <label className="category-filter">
          <select aria-label="按分类筛选" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="全部">全部分类</option>
            {filterCategories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>}
        <div className="owner-filter" role="group" aria-label="记账归属">{ownerOptions.map((item) => {
          const photo = item.key === '全部' ? '' : photoForOwner(item.key);
          const tone = item.key === '全部' ? 'all' : ownerClass(item.key);
          return <button key={item.key} aria-pressed={activeOwner === item.key} className={`${tone}${activeOwner === item.key ? ' selected' : ''}`} onClick={() => analysis ? setAnalysisOwner(item.key) : setOwner(item.key)}>
            <span className={`owner-filter-avatar ${tone}`} style={photo ? { backgroundImage: `url(${photo})` } : undefined} aria-hidden="true">
              {photo ? null : item.key === '全部' ? '全' : item.key === 'together' ? <Users size={12} /> : <UserRound size={12} />}
            </span>
            <span>{item.name}</span>
          </button>;
        })}</div>
      </div>
    );
  }

  function renderMonthToolbar() {
    return (
      <div className="month-toolbar">
        <div className="month-picker">
          <button aria-label="上个月" disabled={month <= '1900-01'} onClick={() => changeMonth(-1)}><ChevronLeft size={19} /></button>
          <MonthPicker value={month} max={currentMonth} onChange={setDisplayedMonth} />
          <button aria-label="下个月" disabled={month >= currentMonth} onClick={() => changeMonth(1)}><ChevronRight size={19} /></button>
          {!isCurrent && <button className="back-month" onClick={() => setDisplayedMonth(currentMonth)}>回到本月</button>}
        </div>
      </div>
    );
  }

  function renderCalendar() {
    return (
      <>
        <section className="calendar-panel panel" aria-label={`${monthLabel}收支日历`}>
          <div className="calendar-weekdays" aria-hidden="true">{weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
          <div className="calendar-grid">
            {calendarCells.map((dateValue, index) => {
              if (!dateValue) return <span className="calendar-empty" key={`empty-${index}`} aria-hidden="true" />;
              const total = dailyMap.get(dateValue);
              const selected = selectedDay === dateValue;
              const today = data.today === dateValue;
              const future = dateValue > data.today;
              const dayLabel = `${dateValue}，星期${dayOfWeek(dateValue)}${today ? '，今天' : ''}，${future ? '尚未到来' : total ? `${total.count}笔，收入${money(total.income)}元，支出${money(total.expense)}元` : '暂无记录'}`;
              return (
                <button key={dateValue} aria-label={dayLabel} aria-pressed={selected} aria-current={today ? 'date' : undefined} disabled={future} className={`calendar-day ${selected ? 'selected' : ''} ${today ? 'today' : ''} ${future ? 'calendar-future' : ''}`} onClick={() => pickCalendarDay(dateValue)}>
                  <span className="calendar-day-number">{Number(dateValue.slice(8))}</span>
                  <span className="calendar-day-dots" aria-hidden="true">{total?.income ? <i className="income" /> : null}{total?.expense ? <i className="expense" /> : null}</span>
                </button>
              );
            })}
          </div>
          <p className="calendar-legend"><span><i className="legend-income" />有收入</span><span><i className="legend-expense" />有支出</span></p>
        </section>
        {renderSelectedDay()}
      </>
    );
  }

  function renderSelectedDay() {
    return (
      <section className="selected-day-panel panel" key={`selected-day-${selectedDay}`} ref={selectedDayRef} aria-label="当天收支明细">
        <div className="day-summary" aria-label="当天收支汇总">
          <div><span>收入</span><strong className="income">¥ {money(selectedSummary.income)}</strong></div>
          <div><span>支出</span><strong className="expense">¥ {money(selectedSummary.expense)}</strong></div>
          <div><span>结余</span><strong className={selectedSummary.surplus >= 0 ? 'income' : 'expense'}>¥ {money(selectedSummary.surplus)}</strong></div>
        </div>
        <div className="day-entry-list">{entryRows(selectedEntries, false, false)}</div>
      </section>
    );
  }

  function renderList() {
    const grouped = new Map<string, Entry[]>();
    filteredEntries.forEach((entry) => grouped.set(entry.date, [...(grouped.get(entry.date) ?? []), entry]));
    return (
      <div className="records-list-layout">
      <section className="records panel records-list-panel">
        <div className="section-head"><div><h2>当月明细 <span>{filteredEntries.length} 笔</span></h2></div></div>
        <div className="grouped-records">
          {grouped.size ? Array.from(grouped.entries()).map(([dateValue, entries]) => {
            const summary = dailyMap.get(dateValue)!;
            return <div className="record-day-group" key={dateValue}><div className="record-day-label"><strong>{dateLabel(dateValue)}</strong><span>星期{dayOfWeek(dateValue)}</span><span>{type !== 'expense' && `收入 ¥${money(summary.income)}`}{type === 'all' && ' · '}{type !== 'income' && `支出 ¥${money(summary.expense)}`}</span></div><div className="entry-list">{entryRows(entries)}</div></div>;
          }) : <div className="empty"><BookHeart size={30} /><h3>当月没有符合条件的记录</h3><p>{hasRecordFilters ? '清除筛选后查看当月全部账目。' : '可以在「今天」页记录新的收支。'}</p><button className="text-button" onClick={() => { if (hasRecordFilters) { setOwner('全部'); setType('all'); setCategoryFilter('全部'); } else setRecordMode('calendar'); }}>{hasRecordFilters ? '清除筛选' : '查看日历'}<ArrowRight size={15} /></button></div>}
        </div>
      </section>
      </div>
    );
  }

  function renderRecords() {
    return (
      <>
        {renderMonthToolbar()}
        <Segmented className="record-view-tabs" active={recordMode} role="group" aria-label="账目视图"><button aria-pressed={recordMode === 'calendar'} className={recordMode === 'calendar' ? 'selected' : ''} onClick={() => setRecordMode('calendar')}><CalendarDays size={17} />日历</button><button aria-pressed={recordMode === 'list'} className={recordMode === 'list' ? 'selected' : ''} onClick={() => setRecordMode('list')}><List size={17} />明细</button></Segmented>
        {recordMode === 'list' && renderFilters()}
        {recordMode === 'calendar' ? <div className="record-view" key="calendar">{renderCalendar()}</div> : <div className="record-view" key="list">{renderList()}</div>}
      </>
    );
  }

  function renderAnalysis() {
    return (
      <>
        <section className="analysis-monthly" aria-labelledby="analysis-monthly-title">
        <h2 id="analysis-monthly-title">月度收支</h2>
        {renderMonthToolbar()}
        {renderFilters(true)}
        <section className="analysis-summary-grid" aria-label="所选月份和归属的收支汇总">
          <div className="analysis-card"><span>当月收入</span><strong className="income">¥ {money(monthStats.income)}</strong><small>{analysisDays.filter((item) => item.income > 0).length} 天有收入记录</small></div>
          <div className="analysis-card"><span>当月支出</span><strong className="expense">¥ {money(monthStats.expense)}</strong><small>日均 ¥ {money(averageExpense)} · 按 {elapsedDays} 天</small></div>
          <div className="analysis-card"><span>当月盈余</span><strong className={monthStats.surplus >= 0 ? 'income' : 'expense'}>¥ {money(monthStats.surplus)}</strong><small>{recordedDays} 天有记录 · {analysisDays.reduce((sum, item) => sum + item.count, 0)} 笔</small></div>
          <div className="analysis-card"><span>历史盈余</span><strong className={historySurplus >= 0 ? 'income' : 'expense'}>¥ {money(historySurplus)}</strong><small>截至 {monthLabel}</small></div>
        </section>
        <div className="analysis-highlight"><span>支出最高日</span><strong>{maxExpenseDay ? `¥ ${money(maxExpenseDay.expense)}` : '—'}</strong><small>{maxExpenseDay ? `${dateLabel(maxExpenseDay.date)} · 星期${dayOfWeek(maxExpenseDay.date)}` : '当月尚无支出记录'}</small></div>
        <div className="analysis-grid">
          <section className="analysis-owner panel"><div className="section-head"><div><h2>按归属看收支</h2></div><Users size={20} aria-hidden="true" /></div><div className="owner-analysis-list">{monthStats.byOwner.filter((item) => analysisOwnerName === null || item.owner === analysisOwnerName).map((item) => { const ownerKey = ownerKeyByName.get(item.owner) ?? 'together'; const photo = photoForOwner(ownerKey); return <div className="owner-analysis-row" key={ownerKey}><div className={`owner-avatar ${ownerClass(ownerKey)}${photo ? ' has-photo' : ''}`} style={photo ? { backgroundImage: `url(${photo})` } : undefined}>{photo ? null : ownerKey === 'together' ? <Users size={17} /> : <UserRound size={17} />}</div><span>{item.owner}</span><div className="owner-analysis-values"><strong>收入 ¥ {money(item.income)}</strong><strong>支出 ¥ {money(item.expense)}</strong><small>占当月支出 {monthStats.expense ? Math.round(item.expense / monthStats.expense * 100) : 0}%</small></div></div>; })}</div></section>
          <section className="analysis-categories panel">
            <div className="section-head"><div><h2>分类占比</h2></div><PieChart size={20} aria-hidden="true" /></div>
            <div className="category-breakdown">
              <div className="category-block">
                <h3>支出</h3>
                {expenseBreakdown.length ? expenseBreakdown.map((item) => (
                  <div className="category-row" key={item.category}>
                    <span className="category-name">{item.category}</span>
                    <span className="category-track"><i style={{ width: `${monthStats.expense ? item.amount / monthStats.expense * 100 : 0}%` }} /></span>
                    <strong>¥ {money(item.amount)}</strong>
                    <small>{monthStats.expense ? Math.round(item.amount / monthStats.expense * 100) : 0}%</small>
                  </div>
                )) : <p className="category-empty">当月暂无支出</p>}
              </div>
              <div className="category-block">
                <h3>收入</h3>
                {incomeBreakdown.length ? incomeBreakdown.map((item) => (
                  <div className="category-row" key={item.category}>
                    <span className="category-name">{item.category}</span>
                    <span className="category-track"><i style={{ width: `${monthStats.income ? item.amount / monthStats.income * 100 : 0}%` }} /></span>
                    <strong>¥ {money(item.amount)}</strong>
                    <small>{monthStats.income ? Math.round(item.amount / monthStats.income * 100) : 0}%</small>
                  </div>
                )) : <p className="category-empty">当月暂无收入</p>}
              </div>
            </div>
          </section>
        </div>
        <section className="analysis-trend panel">
          <div className="section-head"><div><h2>每天的收支趋势</h2></div><TrendingUp size={20} aria-hidden="true" /></div>
          {recordedDays ? <><div className="trend-scroll" ref={trendScrollRef} tabIndex={0} role="region" aria-label="每日收支柱状图，可横向滚动"><div className="trend-chart">{trendDays.map((item, index) => <button className="trend-column" key={item.date} aria-pressed={trendSelection.date === item.date} aria-label={`${item.date}，${item.count ? `收入${money(item.income)}元，支出${money(item.expense)}元` : '尚无记录'}`} title={`${dateLabel(item.date)}：收入 ¥${money(item.income)} / 支出 ¥${money(item.expense)}`} onClick={() => setTrendDay(item.date)}><span className="trend-bars" aria-hidden="true"><span className="trend-bar income" style={{ height: `${item.income / maxDailyAmount * 100}%`, animationDelay: `${Math.min(index, 24) * 16}ms` }} /><span className="trend-bar expense" style={{ height: `${item.expense / maxDailyAmount * 100}%`, animationDelay: `${Math.min(index, 24) * 16}ms` }} /></span><small>{Number(item.date.slice(8))}</small></button>)}</div></div><div className="trend-readout" aria-live="polite"><strong>{dateLabel(trendSelection.date)}</strong><span>{trendSelection.count ? `收入 ¥${money(trendSelection.income)} · 支出 ¥${money(trendSelection.expense)}` : '尚无记录'}</span><button className="text-button" onClick={() => { selectDay(trendSelection.date); setOwner(analysisOwner); setType('all'); setRecordMode('calendar'); goTo('records'); }}>查看当天<ArrowRight size={15} /></button></div></> : <div className="empty"><BarChart3 size={28} /><h3>当月还没有记录</h3><p>记录收入和支出后，即可查看每天的变化。</p></div>}
          <div className="trend-legend"><span><i className="legend-income" />收入</span><span><i className="legend-expense" />支出</span><span>共 {elapsedDays} 天</span></div>
          {recordedDays > 0 && <details className="analysis-table"><summary>查看每日数据</summary><div className="table-scroll"><table><caption>{monthLabel} · {analysisOwnerName ?? '全部归属'}</caption><thead><tr><th scope="col">日期</th><th scope="col">收入</th><th scope="col">支出</th><th scope="col">结余</th><th scope="col">记录</th></tr></thead><tbody>{trendDays.map((item) => <tr key={item.date}><th scope="row">{dateLabel(item.date)}</th><td>{item.count ? money(item.income) : '—'}</td><td>{item.count ? money(item.expense) : '—'}</td><td>{item.count ? money(item.surplus) : '—'}</td><td>{item.count ? `${item.count} 笔` : '未记录'}</td></tr>)}</tbody></table></div></details>}
        </section>
        </section>
      </>
    );
  }

  /* eslint-disable react-hooks/refs -- 分类操作只在点击后执行，不会在渲染期间读取 ref */
  function renderCategoryManager() {
    const list = data.categories[categoryType];
    return <div className="category-manager">
      <Segmented className="type-tabs" active={categoryType} role="group" aria-label="分类类型">
        <button type="button" aria-pressed={categoryType === 'expense'} className={categoryType === 'expense' ? 'selected' : ''} onClick={() => { setCategoryType('expense'); setEditingCategory(null); setDeletingCategory(null); }}>支出分类</button>
        <button type="button" aria-pressed={categoryType === 'income'} className={categoryType === 'income' ? 'selected income-tab' : ''} onClick={() => { setCategoryType('income'); setEditingCategory(null); setDeletingCategory(null); }}>收入分类</button>
      </Segmented>
      <div className="category-manage-list">{list.map((name) => {
        const count = data.entries.filter((entry) => entry.type === categoryType && entry.category === name).length;
        if (editingCategory === name) {
          return <div className="category-manage-row editing" key={name}>
            <input value={editingCategoryName} maxLength={12} autoFocus onChange={(event) => setEditingCategoryName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void renameCategory(name); } else if (event.key === 'Escape') setEditingCategory(null); }} />
            <button type="button" className="category-icon-button" aria-label="保存" disabled={categoryBusy} onClick={() => void renameCategory(name)}><Check size={15} /></button>
            <button type="button" className="category-icon-button" aria-label="取消" onClick={() => setEditingCategory(null)}><X size={15} /></button>
            {count > 0 && <small className="category-warning">有 {count} 笔记录，改名后同步更新</small>}
          </div>;
        }
        if (deletingCategory === name) {
          const remaining = list.filter((item) => item !== name);
          const fallback = remaining.includes('其他') ? '其他' : remaining[0];
          return <div className="category-manage-row deleting" key={name}>
            <p>{count > 0 ? `「${name}」下有 ${count} 笔记录，删除后将归入「${fallback}」。` : `确定删除「${name}」？`}</p>
            <div className="category-confirm-actions">
              <button type="button" className="danger-button" disabled={categoryBusy} onClick={() => void removeCategory(name)}>确认删除</button>
              <button type="button" onClick={() => setDeletingCategory(null)}>取消</button>
            </div>
          </div>;
        }
        return <div className="category-manage-row" key={name}>
          <span className="category-manage-name">{name}</span>
          <small>{count} 笔</small>
          <button type="button" className="category-icon-button" aria-label={`编辑${name}`} onClick={() => { setEditingCategory(name); setEditingCategoryName(name); }}><Pencil size={14} /></button>
          <button type="button" className="category-icon-button" aria-label={`删除${name}`} disabled={list.length <= 1} onClick={() => setDeletingCategory(name)}><Trash2 size={14} /></button>
        </div>;
      })}</div>
      <div className="category-add">
        <input value={categoryDraft} maxLength={12} placeholder={`新增${categoryType === 'expense' ? '支出' : '收入'}分类`} onChange={(event) => setCategoryDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addCategory(); } }} />
        <button type="button" className="primary" disabled={categoryBusy} onClick={() => void addCategory()}>添加</button>
      </div>
    </div>;
  }
  /* eslint-enable react-hooks/refs */

  /* eslint-disable react-hooks/refs -- 上传回调只在选择文件后执行，不会在渲染期间读取 ref */
  function renderSettings() {
    return <div className="settings-panel panel">
      <div className="section-head"><h2>账本设置</h2><BookHeart size={20} /></div>
      <div className="setting-row owner-setting">
        <div className="setting-copy"><h3>记账归属</h3></div>
        <div className="owner-avatars">{data.owners.map((item) => {
          const photo = photoForOwner(item.key);
          return <div className="owner-avatar-item" key={item.key}>
            <label className={`owner-avatar-upload ${ownerClass(item.key)}`} aria-label={`上传${item.name}的头像`} aria-busy={avatarBusy === item.key}>
              {photo ? <span className="owner-avatar-image" style={{ backgroundImage: `url(${photo})` }} /> : <UserRound size={22} />}
              <span className="owner-avatar-hint">{avatarBusy === item.key ? '上传中' : photo ? '更换' : '上传'}</span>
              <input type="file" accept="image/*" className="avatar-input" disabled={avatarBusy === item.key} onChange={(event) => chooseAvatar(event, item.key)} />
            </label>
            {editingOwner === item.key ? <div className="owner-name-editor"><input value={ownerNameDraft} maxLength={8} autoFocus onChange={(event) => setOwnerNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveOwnerName(item.key); } else if (event.key === 'Escape') setEditingOwner(null); }} /><button type="button" aria-label="保存名字" disabled={ownerBusy === item.key} onClick={() => void saveOwnerName(item.key)}><Check size={13} /></button><button type="button" aria-label="取消" onClick={() => setEditingOwner(null)}><X size={13} /></button></div> : <button type="button" className="owner-name-button" aria-label={`编辑${item.name}的名字`} onClick={() => startEditOwner(item)}><span className="owner-avatar-name">{item.name}</span></button>}
          </div>;
        })}</div>
      </div>
      <div className="setting-row"><div className="setting-copy"><h3>分类管理</h3></div><button className="outline-button" onClick={openCategories}>编辑分类</button></div>
      <div className="setting-row"><div className="setting-copy"><h3>共享账本</h3></div><button className="outline-button share-button" onClick={() => setModal('share')}><LinkIcon size={15} />账本链接</button></div>
    </div>;
  }
  /* eslint-enable react-hooks/refs */

  const viewLabel: Record<View, string> = { today: '今天', records: '账目', analysis: '分析', settings: '账本设置' };
  const heading: Record<View, string> = {
    today: '把每天，记在一起。',
    records: '每一天，都有迹可循。',
    analysis: '月底，一起看清楚。',
    settings: '我们的小账本。',
  };

  return (
    <div className="app-shell">
      <aside className="sidebar"><NextLink className="brand" href="/" onClick={() => goTo('today')} aria-label="两人账本首页"><span className="brand-icon"><BookHeart size={23} /></span><span>两人账本</span></NextLink><SlidingNav active={view} aria-label="主导航"><button aria-current={view === 'today' ? 'page' : undefined} className={view === 'today' ? 'active' : ''} onClick={() => goTo('today')}><Wallet size={19} />今天<span className="nav-dot" /></button><button aria-current={view === 'analysis' ? 'page' : undefined} className={view === 'analysis' ? 'active' : ''} onClick={() => goTo('analysis')}><BarChart3 size={19} />分析<span className="nav-dot" /></button><button aria-current={view === 'settings' ? 'page' : undefined} className={view === 'settings' ? 'active' : ''} onClick={() => goTo('settings')}><SlidersHorizontal size={19} />账本设置<span className="nav-dot" /></button></SlidingNav><div className="sidebar-bottom"><div className="sidebar-note"><Duo small /><p>生活的小事，<br />我们一起慢慢记。</p><span>EVERY LITTLE THING, TOGETHER.</span></div><button className="share-nav" onClick={() => setModal('share')}><Users size={18} />共享账本<ArrowUpRight size={15} /></button><div className="sidebar-foot"><span className="online-dot" />云端账本<span>人民币 CNY</span></div></div></aside>
      <main className="main"><header className="topbar"><div className="breadcrumb"><strong key={view} className="breadcrumb-title">{viewLabel[view]}</strong></div><div className="topbar-meta"><span className="topbar-date">{dateLabel(data.today)}<em> · 星期{dayOfWeek(data.today)}</em></span><span className="topbar-savings" aria-label={`当前共同存款 ${money(balance)} 元`}><b className={balance >= 0 ? 'income' : 'expense'}>¥ {money(balance)}</b></span></div></header>
        <div className="content">{error && <div className="error-banner" role="alert">{hasLoaded ? `${error}，当前显示上次同步的账目。` : error}<button onClick={() => { setLoading(true); void refresh(); }}><RefreshCw size={14} />重试</button></div>}
          {view !== 'today' && <section className="page-heading page-heading-in" key={`heading-${view}`}><div><h1>{heading[view]}</h1></div></section>}
          {!dataReady ? <section className="panel empty" role="status">{loading ? <><LoaderCircle className="spin" size={26} /><h2>正在翻开账本…</h2></> : <><BookHeart size={30} /><h2>账目暂时无法加载</h2><p>请检查网络后重试。</p><button className="outline-button" onClick={() => { setLoading(true); void refresh(); }}>重新加载</button></>}</section> : (
            <div className="view-stage" key={view}>
              {view === 'today' ? renderToday() : view === 'records' ? renderRecords() : view === 'analysis' ? renderAnalysis() : renderSettings()}
            </div>
          )}
          <footer className="footer"><span><Heart size={12} />两个人的日子，一起好好过。</span><span>两人账本<span className="footer-dot">·</span>始于生活，记于日常</span></footer>
        </div>
      </main>

      <dialog ref={dialogRef} aria-labelledby="entry-dialog-title" className="modal" onCancel={(event) => { event.preventDefault(); if (!busy) setModal(null); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) setModal(null); }}><div className="modal-inner"><div className="modal-head"><div><h2 id="entry-dialog-title">{modal === 'entry' ? (editing ? '这一笔生活' : '记下这一笔') : modal === 'categories' ? '分类管理' : '两个人，一本账'}</h2></div><button className="icon-button" aria-label="关闭" disabled={busy} onClick={() => setModal(null)}><X size={21} /></button></div>{modal === 'share' ? <div className="share-content"><Duo /><h3>把生活，放在同一本账里</h3><p>通过网站的分享设置邀请另一半。获准访问后，你们看到和编辑的是同一份账目。</p><div className="share-link"><span>{typeof window !== 'undefined' ? window.location.origin : '账本链接'}</span><button className="outline-button" onClick={async () => { try { await navigator.clipboard.writeText(window.location.origin); notify('账本链接已复制'); } catch { notify('复制失败，请从浏览器地址栏复制链接'); } }}><LinkIcon size={15} />复制</button></div><p className="share-tip">网站当前为私有。复制链接不会自动授予访问权限。</p></div> : modal === 'categories' ? renderCategoryManager() : <form onSubmit={save}><>{modal === 'entry' && <Segmented className="type-tabs" active={entryType} role="group" aria-label="记账类型"><button type="button" aria-pressed={entryType === 'expense'} className={entryType === 'expense' ? 'selected' : ''} onClick={() => { setEntryType('expense'); if (!data.categories.expense.includes(entryCategory)) setEntryCategory(data.categories.expense[0] ?? ''); }}><ArrowUpRight size={17} />支出</button><button type="button" aria-pressed={entryType === 'income'} className={entryType === 'income' ? 'selected income-tab' : ''} onClick={() => { setEntryType('income'); if (!data.categories.income.includes(entryCategory)) setEntryCategory(data.categories.income[0] ?? ''); }}><ArrowDownLeft size={17} />收入</button></Segmented>}<label className="amount-field"><span>金额</span><div><b>¥</b><input aria-label="金额" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={12} required autoComplete="off" /></div></label><><label className="field-label">记在谁的名下 <span>*</span></label><div className="owner-choices">{data.owners.map((item) => {
              const photo = photoForOwner(item.key);
              return <button key={item.key} type="button" aria-pressed={selectedOwner === item.key} className={`${ownerClass(item.key)}${selectedOwner === item.key ? ' selected' : ''}`} onClick={() => setSelectedOwner(item.key)}>
                <span className={`owner-choice-avatar ${ownerClass(item.key)}${photo ? ' has-photo' : ''}`}>
                  {photo ? <span className="owner-choice-photo" style={{ backgroundImage: `url(${photo})` }} aria-hidden="true" /> : item.key === 'together' ? <Users size={19} aria-hidden="true" /> : <span className="owner-choice-initial">{item.name.slice(0, 1)}</span>}
                  <span className="owner-choice-check" aria-hidden="true"><Check size={10} strokeWidth={3} /></span>
                </span>
                <span className="owner-choice-name">{item.name}</span>
              </button>;
            })}</div><label className="field-label">分类 <span>*</span></label><div className="category-choices" role="group" aria-label="记账分类">{data.categories[entryType].map((item) => <button key={item} type="button" aria-pressed={entryCategory === item} className={entryCategory === item ? 'selected' : ''} onClick={() => setEntryCategory(item)}>{item}</button>)}</div><div className="form-field"><span>发生日期</span><DatePicker value={date} max={ledger.today} onChange={setDate} /></div><label className="form-field">备注<span className="optional">选填</span><input maxLength={100} placeholder="这一笔，是生活里的什么？" value={note} onChange={(event) => setNote(event.target.value)} /></label></>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="modal-actions">{editing && <button type="button" className="delete-button" disabled={busy} onClick={() => { setFormError(''); setDeleting(editing); }}><Trash2 size={17} />删除</button>}<button className="primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />} {busy ? '保存中…' : editing ? '保存修改' : '保存'}</button></div></></form>}</div></dialog>
      <dialog aria-labelledby="delete-dialog-title" className="modal confirm-modal" ref={deleteRef} onCancel={(event) => { event.preventDefault(); if (!busy) setDeleting(null); }}><div className="modal-inner"><div className="delete-illustration"><Trash2 size={25} /></div><h2 id="delete-dialog-title">删除这笔记录？</h2><p>“{deleting?.note || '这笔记录'}”将从共享账本删除，余额和月度汇总会同步更新。</p>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="confirm-actions"><button className="outline-button" disabled={busy} onClick={() => setDeleting(null)}>再想想</button><button className="danger-button" disabled={busy} onClick={remove}>{busy ? '删除中…' : '确认删除'}</button></div></div></dialog>
      {toast && <div className={`toast${toastLeaving ? ' leaving' : ''}`} role="status"><Check size={17} />{toast}</div>}
    </div>
  );
}
