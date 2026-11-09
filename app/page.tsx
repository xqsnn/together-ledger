'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  BookHeart,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Heart,
  ImageIcon,
  JapaneseYen,
  List,
  LoaderCircle,
  Pencil,
  PieChart,
  RefreshCw,
  RotateCcw,
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
  byWhenDesc,
  chinaTime,
  dailyTotals,
  DailyTotal,
  dayOwnerTotals,
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
import { TimePicker } from '@/components/time-picker';
import { Segmented } from '@/components/segmented';
import { SlidingNav } from '@/components/sliding-nav';
import Duo from '@/components/duo';
import LoginScreen, { type AuthSession } from '@/components/login-screen';
import { useIsomorphicLayoutEffect } from '@/hooks/use-isomorphic-layout-effect';
import { useSheetDrag } from '@/components/use-sheet-drag';
import { prefersReducedMotion } from '@/lib/motion';
import PhotoPicker, { type PickedPhoto } from '@/components/photo-picker';
import { MAX_ENTRY_IMAGES, type MediaLimits, type MediaMeta } from '@/lib/media';
import {
  enqueuePhotos,
  getServerSnapshot,
  getSnapshot,
  mergeUploadedMedia,
  onMediaUploaded,
  setUploadLimits,
  subscribe,
} from '@/lib/upload-queue';

type OwnerInfo = { key: OwnerKey; name: string };
type LedgerEntry = Entry & { images: MediaMeta[] };
type Ledger = {
  entries: LedgerEntry[];
  mediaLimits: MediaLimits;
  today: string;
  avatars: Partial<Record<OwnerKey, string>>;
  categories: { expense: string[]; income: string[] };
  owners: OwnerInfo[];
};
type View = 'today' | 'records' | 'analysis' | 'settings';
type EntryFilter = 'all' | Entry['type'];
type ModalKind = 'entry' | 'detail' | 'categories';
type MutationBody =
  | { action: 'avatar'; ownerKey: OwnerKey; data: string }
  | { action: 'category'; op: 'add' | 'rename' | 'delete'; type: Entry['type']; name: string; newName?: string }
  | { action: 'owner'; key: OwnerKey; name: string }
  | { action: 'delete'; id: string; revision: number }
  | { action: 'save'; mode?: 'create' | 'update'; entry: Partial<Entry> & { type: Entry['type']; amount: number; ownerKey: OwnerKey; date: string; time?: string; note: string; category: string } };

const blank: Ledger = {
  entries: [],
  mediaLimits: { mode: 'd1', maxBytes: 700000, maxThumbBytes: 120000, maxPerEntry: MAX_ENTRY_IMAGES },
  today: chinaToday(),
  avatars: {},
  categories: { expense: [...expenseCategories], income: [...incomeCategories] },
  owners: ownerKeys.map((key, index) => ({ key, name: owners[index] })),
};
// 手机竖屏断点：与样式里的 560px 保持一致，用于决定归属胶囊是否显示名字。
const NARROW_QUERY = '(max-width: 560px)';
const money = (n: number) =>
  (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ownerClass = (key: string) => (key === 'qing' ? 'qing' : key === 'hua' ? 'hua' : 'together');
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

function dateLabel(date: string) {
  const [, month, day] = date.split('-').map(Number);
  return `${month}月${day}日`;
}

function dayOfWeek(date: string) {
  return weekdays[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
}

export default function Home() {
  const router = useRouter();
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
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [modalClosing, setModalClosing] = useState(false);
  const [categoryType, setCategoryType] = useState<Entry['type']>('expense');
  const [categoryDraft, setCategoryDraft] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [editingOwner, setEditingOwner] = useState<OwnerKey | null>(null);
  const [ownerNameDraft, setOwnerNameDraft] = useState('');
  const [ownerBusy, setOwnerBusy] = useState<OwnerKey | null>(null);
  const [entryPhotos, setEntryPhotos] = useState<PickedPhoto[]>([]);
  const [entryType, setEntryType] = useState<Entry['type']>('expense');
  const [entryCategory, setEntryCategory] = useState<string>(expenseCategories[0]);
  const [amount, setAmount] = useState('');
  const [selectedOwner, setSelectedOwner] = useState<OwnerKey | null>(null);
  const [date, setDate] = useState(chinaToday());
  const [entryTime, setEntryTime] = useState(chinaTime());
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState<OwnerKey | null>(null);
  // 登录态：session 为空时整页只渲染登录门禁。
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const sessionRef = useRef<AuthSession | null>(null);
  // 设置页的账号操作
  const [accountOpen, setAccountOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [toastLeaving, setToastLeaving] = useState(false);
  // 记录配图的上传队列放在路由之上的模块里，点进详情页也不会丢进度。
  const uploads = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // 卡片宽度不足以并排显示三个归属方金额时收起明细（首次渲染先按视口估算，挂载后再精确测量）。
  // 手机竖屏下收支卡片较窄，归属胶囊放不下名字和头像时只保留头像。
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const trendScrollRef = useRef<HTMLDivElement>(null);
  const selectedDayRef = useRef<HTMLElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastOutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  /** 打开弹层：如果上一次关闭动画还没结束，先取消它。 */
  function openModal(next: ModalKind) {
    if (modalCloseTimer.current) clearTimeout(modalCloseTimer.current);
    setModalClosing(false);
    setModal(next);
  }

  /** 先播放退场动画，再真正关闭原生 dialog。 */
  function closeModal() {
    if (!modal || modalClosing) return;
    if (modal === 'entry') {
      entryPhotos.forEach((photo) => URL.revokeObjectURL(photo.preview));
      setEntryPhotos([]);
    }
    if (prefersReducedMotion()) {
      if (modalCloseTimer.current) clearTimeout(modalCloseTimer.current);
      dialogRef.current?.close();
      setModal(null);
      setModalClosing(false);
      return;
    }
    setModalClosing(true);
    if (modalCloseTimer.current) clearTimeout(modalCloseTimer.current);
    modalCloseTimer.current = setTimeout(() => {
      dialogRef.current?.close();
      setModal(null);
      setModalClosing(false);
    }, 260);
  }

  // 移动端底部弹层：从顶部抓手向下拖动即可关闭。
  const entrySheet = useSheetDrag(closeModal);

  const refresh = useCallback((signal?: AbortSignal) => {
    return fetch('/api/ledger', { cache: 'no-store', signal })
      .then(async (response) => {
        if (response.status === 401) {
          // 登录态失效（过期或被改密踢下线）：退回登录页。
          sessionRef.current = null;
          setSession(null);
          return;
        }
        const result = (await response.json()) as Ledger & { error?: string };
        if (!response.ok) throw new Error(result.error || '加载失败');
        if (signal?.aborted) return;
        setUploadLimits(result.mediaLimits);
        // 轮询响应可能比上传完成更早发出：把刚传好的图补回来，避免图片「闪没」。
        setLedger({ ...result, entries: result.entries.map((entry) => mergeUploadedMedia(entry.id, entry)) });
        setHasLoaded(true);
        setError('');
      })
      .catch((caught: unknown) => {
        if (!signal?.aborted) setError(caught instanceof Error ? caught.message : '加载失败');
      })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, []);

  // 先确认登录态，再拉账目；未登录时不请求账本接口。
  const checkSession = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/auth', { cache: 'no-store', signal });
      if (!response.ok) return false;
      const result = (await response.json()) as { session: AuthSession | null };
      sessionRef.current = result.session ?? null;
      setSession(result.session ?? null);
      return Boolean(result.session);
    } catch {
      return false;
    }
  }, []);

  const handleAuthenticated = useCallback((next: AuthSession) => {
    sessionRef.current = next;
    setSession(next);
    setAuthChecked(true);
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = async () => {
      const signedIn = await checkSession(controller.signal);
      if (controller.signal.aborted) return;
      setAuthChecked(true);
      if (!signedIn) {
        setLoading(false);
        return;
      }
      await refresh(controller.signal);
      if (controller.signal.aborted) return;
      timer = setInterval(() => void refresh(controller.signal), 20000);
    };
    void start();
    const focus = () => { if (sessionRef.current) void refresh(controller.signal); };
    window.addEventListener('focus', focus);
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [checkSession, refresh]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (toastOutTimer.current) clearTimeout(toastOutTimer.current);
    if (modalCloseTimer.current) clearTimeout(modalCloseTimer.current);
  }, []);

  // 图片传好后立刻并进当前列表，不用等 20 秒轮询。
  useEffect(() => onMediaUploaded((entryId, media) => {
    setLedger((current) => ({
      ...current,
      entries: current.entries.map((entry) => entry.id === entryId && !entry.images.some((photo) => photo.id === media.id)
        ? { ...entry, images: [...entry.images, media] }
        : entry),
    }));
  }), []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (modal && !dialog.open) dialog.showModal();
    else if (!modal && dialog.open) dialog.close();
    if (modal) dialog.scrollTop = 0;
  }, [modal]);

  // 跟随断点变化，决定归属胶囊是否保留名字（CSS 只做主尺寸，文字取舍交给渲染）。
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => setIsNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);


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
    .sort(byWhenDesc);
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
    .sort(byWhenDesc);
  const selectedSummary = dailyMap.get(selectedDay) ?? {
    date: selectedDay,
    income: 0,
    expense: 0,
    surplus: 0,
    count: 0,
  };
  const todayEntries = data.entries
    .filter((entry) => entry.date === data.today)
    .sort(byWhenDesc);
  const todayIncomeEntries = todayEntries.filter((entry) => entry.type === 'income');
  const todayExpenseEntries = todayEntries.filter((entry) => entry.type === 'expense');
  const todaySummary = {
    income: todayIncomeEntries.reduce((sum, entry) => sum + entry.amount, 0),
    expense: todayExpenseEntries.reduce((sum, entry) => sum + entry.amount, 0),
  };
  const todayOwnerTotals = dayOwnerTotals(data.entries, data.today, (key) => ownerNameByKey.get(key) ?? '', data.owners.map((item) => item.key));
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

  /** 选日期时同步时间：选到今天用当前时刻，选到过去日期用 12:00，避免把“现在”安到别的日子上。 */
  function pickEntryDate(next: string) {
    const wasToday = date === data.today;
    setDate(next);
    if (next === data.today) {
      if (!wasToday) setEntryTime(chinaTime());
    } else if (wasToday) {
      setEntryTime('12:00');
    }
  }

  function openCreate(presetType: Entry['type'] = 'expense', presetDate = data.today) {
    if (!dataReady || presetDate > data.today) return;
    entryPhotos.forEach((photo) => URL.revokeObjectURL(photo.preview));
    setEntryPhotos([]);
    const nextCategories = data.categories[presetType] ?? [];
    setEntryType(presetType);
    setEntryCategory(nextCategories[0] ?? '');
    setAmount('');
    setSelectedOwner(sessionRef.current?.ownerKey ?? null);
    setDate(presetDate);
    setEntryTime(presetDate === data.today ? chinaTime() : '12:00');
    setNote('');
    setFormError('');
    document.querySelector<HTMLDialogElement>('.modal[aria-labelledby="entry-dialog-title"]')?.scrollTo({ top: 0 });
    openModal('entry');
    setFormError('');
    document.querySelector<HTMLDialogElement>('.modal[aria-labelledby="entry-dialog-title"]')?.scrollTo({ top: 0 });
    openModal('entry');
  }

  function openDetail(entry: LedgerEntry) {
    if (!dataReady) return;
    router.push(`/entries/${entry.id}`);
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
    setUploadLimits(result.mediaLimits);
    setLedger({ ...result, entries: result.entries.map((entry) => mergeUploadedMedia(entry.id, entry)) });
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
    openModal('categories');
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
      // 新建：记录先落库，图片进模块级队列，避免「记录改了、图没对上」的中间态。
      const entryId = crypto.randomUUID();
      const files = entryPhotos.map((photo) => photo.file);
      await mutate({
        action: 'save',
        mode: 'create',
        entry: {
          id: entryId,
          type: entryType,
          amount: toCents(amount),
          ownerKey: selectedOwner,
          date,
          time: entryTime,
          note,
          category: entryCategory,
        },
      });
      entryPhotos.forEach((photo) => URL.revokeObjectURL(photo.preview));
      setEntryPhotos([]);
      closeModal();
      // 图片交给模块级队列在首页后台传，不再跳详情页。
      if (files.length) enqueuePhotos(entryId, files, 0, notify);
      setOwner('全部');
      setType('all');
      setCategoryFilter('全部');
      if (date === data.today) {
        selectDay(data.today);
        notify('记下了，又是生活的一笔');
      } else {
        // 补记历史日期时首页看不到这一笔，切到账目并选到那一天。
        selectDay(date);
        goTo('records');
        setRecordMode('list');
        notify(`已记到 ${dateLabel(date)}`);
      }
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function callAuth(body: Record<string, unknown>) {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(result.error || '操作失败');
    return result;
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (accountBusy) return;
    setAccountBusy(true);
    try {
      await callAuth({ action: 'password', current: currentPassword, next: nextPassword });
      setAccountOpen(false);
      setCurrentPassword('');
      setNextPassword('');
      notify('密码已更新，其它设备需要重新登录');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '修改失败');
    } finally {
      setAccountBusy(false);
    }
  }

  async function signOut() {
    try {
      await callAuth({ action: 'logout' });
    } catch {
      // 网络失败也本地退出，避免卡在半登录状态。
    }
    sessionRef.current = null;
    setSession(null);
    setHasLoaded(false);
    setLedger(blank);
    setAccountOpen(false);
    setModal(null);
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

  // 每笔记录的上传进度：行内只用一个计数徽标，不塞可点击按钮（整行本身是 button）。
  const uploadsByEntry = new Map<string, { active: number; failed: number }>();
  uploads.forEach((task) => {
    const state = uploadsByEntry.get(task.entryId) ?? { active: 0, failed: 0 };
    if (task.status === 'error') state.failed += 1; else state.active += 1;
    uploadsByEntry.set(task.entryId, state);
  });

  function entryRows(entries: LedgerEntry[], isToday = false, applyFilters = true) {
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
        <button className="entry-row" key={entry.id} style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }} onClick={() => openDetail(entry)}>
          <span className={`entry-icon ${entry.type === 'income' ? 'income-bg' : 'expense-bg'}`} aria-hidden="true">
            {entry.type === 'income' ? <MoneyBagIcon size={18} /> : <JapaneseYen size={18} strokeWidth={2} />}
          </span>
          <span className="entry-desc">
            <strong>{entry.note || entry.category}</strong>
            <span>{entry.date === data.today ? '今天' : `${dateLabel(entry.date)} · 星期${dayOfWeek(entry.date)}`}<i />{entry.category}{entry.createdBy && entry.createdBy !== entry.ownerKey ? <><i />{ownerNameByKey.get(entry.createdBy)}记的</> : null}{entry.images.length > 0 && <span className="badge-media"><ImageIcon size={12} aria-hidden="true" />{entry.images.length}</span>}{(uploadsByEntry.get(entry.id)?.active ?? 0) > 0 && <span className="badge-media"><LoaderCircle className="spin" size={12} aria-hidden="true" />{uploadsByEntry.get(entry.id)!.active}</span>}{(uploadsByEntry.get(entry.id)?.failed ?? 0) > 0 && <span className="badge-media badge-warn"><RotateCcw size={12} aria-hidden="true" />{uploadsByEntry.get(entry.id)!.failed}</span>}</span>
          </span>
          {/* 有发生时间才占一格；历史记录不显示占位的 --:--。 */}
          {entry.time && <time className="entry-time" dateTime={`${entry.date}T${entry.time}`} aria-label={`发生时间 ${entry.time}`}>{entry.time}</time>}
          <span className={`entry-owner ${ownerClass(entry.ownerKey)}`} title={entry.owner} aria-label={`归属 ${entry.owner}`} role="img">
            <i className="entry-owner-avatar" style={photo ? { backgroundImage: `url(${photo})` } : undefined} aria-hidden="true">{photo ? null : entry.ownerKey === 'together' ? <Users size={12} /> : <UserRound size={12} />}</i>
          </span>
          <strong className={`entry-amount ${entry.type === 'income' ? 'income' : 'expense'}`}>
            {entry.type === 'income' ? '+' : '−'} {money(entry.amount)}
          </strong>
          <ChevronRight className="entry-arrow" size={14} aria-hidden="true" />
        </button>
      );
    });
  }

  function renderTodayOwnerSplit(type: Entry['type']) {
    return (
      <div className={`today-owner-split ${type}`} role="group" aria-label={`今日各归属${type === 'expense' ? '支出' : '收入'}`}>
        {todayOwnerTotals.map((item) => {
          const amount = item[type];
          const photo = photoForOwner(item.key);
          const tone = ownerClass(item.key);
          return (
            <span key={item.key} className={`today-owner-entry ${tone}`}>
              {/* 归属只用小头像表示，名字通过悬停提示和无障碍标签给出。 */}
              <i
                className={`today-owner-avatar ${tone}${photo ? ' has-photo' : ''}`}
                style={photo ? { backgroundImage: `url(${photo})` } : undefined}
                title={item.owner}
                aria-label={`${item.owner}${type === 'expense' ? '支出' : '收入'} ${money(amount)} 元`}
                role="img"
              >
                {photo ? null : item.key === 'together' ? <Users size={11} /> : <span className="today-owner-initial">{item.owner.slice(0, 1)}</span>}
              </i>
              <strong className={`today-owner-amount ${amount > 0 ? type : 'zero'}`}>
                {isNarrow ? `¥${money(amount)}` : money(amount)}
              </strong>
            </span>
          );
        })}
      </div>
    );
  }

  function renderToday() {
    return (
      <>
        <section className="today-hero">
          <div>
            <h1>今天，也记一笔。</h1>
          </div>
          <div className="today-actions">
            <button className="quick-action expense-action" onClick={() => openCreate('expense', data.today)}>
              <span className="quick-action-icon"><JapaneseYen size={20} strokeWidth={2} aria-hidden="true" /></span><span className="quick-action-label">记支出</span>
            </button>
            <button className="quick-action income-action" onClick={() => openCreate('income', data.today)}>
              <span className="quick-action-icon"><MoneyBagIcon size={20} aria-hidden="true" /></span><span className="quick-action-label">记收入</span>
            </button>
          </div>
        </section>
        <section className="today-summary-grid" aria-label="今日已记录收支">
          <div className="today-summary-card">
            <span>今日支出</span>
            <strong className="expense">¥ {money(todaySummary.expense)}</strong>
            <small>全天 {todayExpenseEntries.length} 笔</small>
            {renderTodayOwnerSplit('expense')}
          </div>
          <div className="today-summary-card">
            <span>今日收入</span>
            <strong className="income">¥ {money(todaySummary.income)}</strong>
            <small>全天 {todayIncomeEntries.length} 笔</small>
            {renderTodayOwnerSplit('income')}
          </div>
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
    const grouped = new Map<string, LedgerEntry[]>();
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
        <section className="analysis-monthly" aria-label="月度收支">
        {renderMonthToolbar()}
        {renderFilters(true)}
        <section className="analysis-summary-grid" aria-label="所选月份和归属的收支汇总">
          <div className="analysis-card"><span>当月收入</span><strong className="income">¥ {money(monthStats.income)}</strong><small>{analysisDays.filter((item) => item.income > 0).length} 天有收入记录</small></div>
          <div className="analysis-card"><span>当月支出</span><strong className="expense">¥ {money(monthStats.expense)}</strong><small>日均 ¥ {money(averageExpense)} · {elapsedDays} 天</small></div>
          <div className="analysis-card"><span>当月盈余</span><strong className={monthStats.surplus >= 0 ? 'income' : 'expense'}>¥ {money(monthStats.surplus)}</strong><small>{recordedDays} 天有记录 · {analysisDays.reduce((sum, item) => sum + item.count, 0)} 笔</small></div>
          <div className="analysis-card"><span>历史盈余</span><strong className={historySurplus >= 0 ? 'income' : 'expense'}>¥ {money(historySurplus)}</strong><small>截至 {monthLabel}</small></div>
        </section>
        <div className="analysis-highlight">
          <span className="analysis-highlight-badge"><CalendarDays size={16} aria-hidden="true" /></span>
          <div className="analysis-highlight-copy">
            <span>支出最高日</span>
            <small>{maxExpenseDay ? `${dateLabel(maxExpenseDay.date)} · 星期${dayOfWeek(maxExpenseDay.date)} · ${maxExpenseDay.count} 笔记录` : '当月尚无支出记录'}</small>
          </div>
          <div className="analysis-highlight-value">
            <strong>{maxExpenseDay ? `¥ ${money(maxExpenseDay.expense)}` : '—'}</strong>
            {maxExpenseDay && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  selectDay(maxExpenseDay.date);
                  setOwner(analysisOwner);
                  setType('all');
                  setRecordMode('calendar');
                  goTo('records');
                }}
              >
                查看当天 <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="analysis-grid">
          <section className="analysis-owner panel"><div className="section-head"><div><h2>按归属看收支</h2></div><Users size={20} aria-hidden="true" /></div><div className="owner-analysis-list">{monthStats.byOwner.filter((item) => analysisOwnerName === null || item.owner === analysisOwnerName).map((item) => { const ownerKey = ownerKeyByName.get(item.owner) ?? 'together'; const photo = photoForOwner(ownerKey); return <div className="owner-analysis-row" key={ownerKey}><div className={`owner-avatar ${ownerClass(ownerKey)}${photo ? ' has-photo' : ''}`} style={photo ? { backgroundImage: `url(${photo})` } : undefined}>{photo ? null : ownerKey === 'together' ? <Users size={17} /> : <UserRound size={17} />}</div><span>{item.owner}</span><div className="owner-analysis-values"><strong className="income">收入 ¥ {money(item.income)}</strong><strong className="expense">支出 ¥ {money(item.expense)}</strong><small>占当月支出 {monthStats.expense ? Math.round(item.expense / monthStats.expense * 100) : 0}%</small></div></div>; })}</div></section>
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
          {recordedDays ? <><div className="trend-scroll" ref={trendScrollRef} tabIndex={0} role="region" aria-label="每日收支柱状图，可横向滚动"><div className="trend-chart">{trendDays.map((item, index) => <button className="trend-column" key={item.date} aria-pressed={trendSelection.date === item.date} aria-label={`${item.date}，${item.count ? `收入${money(item.income)}元，支出${money(item.expense)}元` : '尚无记录'}`} title={`${dateLabel(item.date)}：收入 ¥${money(item.income)} / 支出 ¥${money(item.expense)}`} onClick={() => setTrendDay(item.date)}><span className="trend-bars" aria-hidden="true"><span className="trend-bar income" style={{ height: `${item.income / maxDailyAmount * 100}%`, animationDelay: `${Math.min(index, 24) * 16}ms` }} /><span className="trend-bar expense" style={{ height: `${item.expense / maxDailyAmount * 100}%`, animationDelay: `${Math.min(index, 24) * 16}ms` }} /></span><small>{Number(item.date.slice(8))}</small></button>)}</div></div><div className="trend-readout" aria-live="polite"><strong>{dateLabel(trendSelection.date)}</strong><span>{trendSelection.count ? `收入 ¥${money(trendSelection.income)} · 支出 ¥${money(trendSelection.expense)}` : '尚无记录'}</span><button className="text-button" onClick={() => { selectDay(trendSelection.date); setOwner(analysisOwner); setType('all'); setRecordMode('calendar'); goTo('records'); }}>查看当天<ArrowRight size={15} /></button></div></> : <div className="empty"><BarChart3 size={28} /><h3>当月还没有记录</h3></div>}
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
    if (!session) return null;
    const me = session;
    return <div className="settings-panel panel">
      <div className="section-head"><h2>账本设置</h2><BookHeart size={20} /></div>
      <div className="setting-row account-row">
        <div className="setting-copy"><h3>登录账号</h3><p>当前以「{ownerNameByKey.get(me.ownerKey) ?? me.name}」登录</p></div>
        <div className="account-actions">
          <button className="outline-button" onClick={() => setAccountOpen((open) => !open)}>{accountOpen ? '收起' : '修改密码'}</button>
          <button className="outline-button" onClick={() => void signOut()}>退出登录</button>
        </div>
        {accountOpen && <form className="account-form" onSubmit={changePassword}>
          <label className="form-field">当前密码<input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label className="form-field">新密码<input type="password" autoComplete="new-password" minLength={6} required value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} placeholder="至少 6 位" /></label>
          <div className="account-actions"><button type="submit" className="primary" disabled={accountBusy}>{accountBusy ? '保存中…' : '保存新密码'}</button></div>
        </form>}
      </div>
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
    </div>;
  }
  /* eslint-enable react-hooks/refs */

  // 未确认登录态前不渲染主界面；未登录时只显示登录门禁。
  if (!authChecked) {
    return <div className="login-shell"><section className="login-card"><div className="login-loading" role="status"><LoaderCircle className="spin" size={22} aria-hidden="true" />正在连接账本…</div></section></div>;
  }
  if (!session) return <LoginScreen onAuthenticated={handleAuthenticated} />;

  const heading: Record<View, string> = {
    today: '把每天，记在一起。',
    records: '每一天，都有迹可循。',
    analysis: '月底，一起看清楚。',
    settings: '我们的小账本。',
  };

  return (
    <div className="app-shell">
      <aside className="sidebar"><NextLink className="brand" href="/" onClick={() => goTo('today')} aria-label="两人账本首页"><span className="brand-icon"><BookHeart size={23} /></span><span>两人账本</span></NextLink><SlidingNav active={view} aria-label="主导航"><button aria-current={view === 'today' ? 'page' : undefined} className={view === 'today' ? 'active' : ''} onClick={() => goTo('today')}><Wallet size={19} />今天<span className="nav-dot" /></button><button aria-current={view === 'analysis' ? 'page' : undefined} className={view === 'analysis' ? 'active' : ''} onClick={() => goTo('analysis')}><BarChart3 size={19} />分析<span className="nav-dot" /></button><button aria-current={view === 'settings' ? 'page' : undefined} className={view === 'settings' ? 'active' : ''} onClick={() => goTo('settings')}><SlidersHorizontal size={19} />账本设置<span className="nav-dot" /></button></SlidingNav><div className="sidebar-bottom"><div className="sidebar-note"><Duo small /><p>生活的小事，<br />我们一起慢慢记。</p><span>EVERY LITTLE THING, TOGETHER.</span></div><div className="sidebar-foot"><span className="online-dot" />云端账本<span>人民币 CNY</span></div></div></aside>
      <main className="main"><header className="topbar"><span className="topbar-logo" role="img" aria-label="利通" title="利通"><Duo logo /></span><div className="topbar-meta"><span className="topbar-date">{dateLabel(data.today)}<em> · 星期{dayOfWeek(data.today)}</em></span><span className="topbar-savings" aria-label={`当前共同存款 ${money(balance)} 元`}><b className={balance >= 0 ? 'income' : 'expense'}>¥ {money(balance)}</b></span></div></header>
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

      <dialog ref={dialogRef} aria-labelledby="entry-dialog-title" className={`modal${modalClosing ? ' is-closing' : ''}${entrySheet.dragging ? ' is-dragging' : ''}`} style={entrySheet.style} onCancel={(event) => { event.preventDefault(); if (!busy) closeModal(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) closeModal(); }}>
        <div className="modal-inner">
          <span className="modal-grabber" aria-hidden="true" {...entrySheet.handleProps} />
          <div className="modal-head">
            <div><h2 id="entry-dialog-title" className={modal === 'categories' ? 'visually-hidden' : undefined}>{modal === 'categories' ? '分类管理' : '记下这一笔'}</h2></div>
            <button className="icon-button" aria-label="关闭" disabled={busy} onClick={closeModal}><X size={21} /></button>
          </div>
          {modal === 'categories' ? renderCategoryManager() : (
            <form onSubmit={save}>
              <Segmented className="type-tabs" active={entryType} role="group" aria-label="记账类型">
                <button type="button" aria-pressed={entryType === 'expense'} className={entryType === 'expense' ? 'selected' : ''} onClick={() => { setEntryType('expense'); if (!data.categories.expense.includes(entryCategory)) setEntryCategory(data.categories.expense[0] ?? ''); }}><JapaneseYen size={17} strokeWidth={2} />支出</button>
                <button type="button" aria-pressed={entryType === 'income'} className={entryType === 'income' ? 'selected income-tab' : ''} onClick={() => { setEntryType('income'); if (!data.categories.income.includes(entryCategory)) setEntryCategory(data.categories.income[0] ?? ''); }}><MoneyBagIcon size={17} />收入</button>
              </Segmented>

              <label className="amount-field"><span>金额</span><div><b>¥</b><input aria-label="金额" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={12} required autoComplete="off" /></div></label>

              <span className="field-label">分类</span>
              <div className="category-choices" role="group" aria-label="记账分类">{data.categories[entryType].map((item) => <button key={item} type="button" aria-pressed={entryCategory === item} className={entryCategory === item ? 'selected' : ''} onClick={() => setEntryCategory(item)}>{item}</button>)}</div>

              <label className="form-field">备注<span className="optional">选填</span><input maxLength={100} placeholder="这一笔，是生活里的什么？" value={note} onChange={(event) => setNote(event.target.value)} /></label>

              <span className="field-label">记在谁的名下</span>
            <div className="owner-choices">{data.owners.map((item) => {
              const photo = photoForOwner(item.key);
              return <button key={item.key} type="button" aria-pressed={selectedOwner === item.key} className={`${ownerClass(item.key)}${selectedOwner === item.key ? ' selected' : ''}`} onClick={() => setSelectedOwner(item.key)}>
                <span className={`owner-choice-avatar ${ownerClass(item.key)}${photo ? ' has-photo' : ''}`}>
                  {photo ? <span className="owner-choice-photo" style={{ backgroundImage: `url(${photo})` }} aria-hidden="true" /> : item.key === 'together' ? <Users size={19} aria-hidden="true" /> : <span className="owner-choice-initial">{item.name.slice(0, 1)}</span>}
                  <span className="owner-choice-check" aria-hidden="true"><Check size={10} strokeWidth={3} /></span>
                </span>
                <span className="owner-choice-name">{item.name}</span>
              </button>;
            })}</div>

              <div className="form-field"><span>发生日期</span><DatePicker value={date} max={ledger.today} onChange={pickEntryDate} /></div>
              <div className="form-field"><span>发生时间</span><TimePicker value={entryTime} max={date === ledger.today ? chinaTime() : undefined} onChange={setEntryTime} /></div>

              <div className="form-field entry-photo-field"><span>照片<span className="optional">选填，最多 {MAX_ENTRY_IMAGES} 张</span></span><PhotoPicker photos={entryPhotos} onChange={setEntryPhotos} max={MAX_ENTRY_IMAGES} disabled={busy} onReject={notify} /></div>

              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-actions"><button className="primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />} {busy ? '保存中…' : '保存'}</button></div>
            </form>
          )}
        </div>
      </dialog>

      {toast && <div className={`toast${toastLeaving ? ' leaving' : ''}`} role="status"><Check size={17} />{toast}</div>}
    </div>
  );
}
