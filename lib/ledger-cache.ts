'use client';

/**
 * 账本快照缓存：内存为主、localStorage 持久兜底。
 *
 * 首页和详情页是两个路由，各自挂载自己的组件，路由一跳 state 就没了。
 * 以前从详情页返回首页要重新走一遍「校验登录 → 拉全量账目」，
 * 屏幕上先闪一段「正在翻开账本…」；进详情页也一样。
 *
 * 这里把上一次成功拿到的账目和登录态留在内存里，同时落一份 localStorage：
 * - 内存命中：路由切换间的新页面挂载先用它同步渲染（还没画到屏幕上），再在后台静默刷新。
 * - localStorage 命中：iOS PWA 冷启动（划掉重开）也能第 1 帧渲染上次的内容，
 *   不再盯着加载转圈等网络——这对「添加到主屏幕」的独立 App 形态是体验的关键。
 *
 * 私密性边界：登录 Cookie 本来就在设备上保留 180 天（见 lib/auth.ts），
 * 快照里不再内嵌几百 KB 的 base64 头像（只存版本号），体积可控；
 * 退出登录、登录失效（401）时会立刻清掉快照，不留痕迹。
 * 隐私模式 / 配额超限时写入静默失败，只退化为「不持久化」。
 */

import { byWhenDesc, type Entry, type OwnerKey } from './ledger';
import type { MediaLimits, MediaMeta } from './media';

const STORE_KEY = 'ledger:snapshot:v1';

export type CachedEntry = Entry & { images: MediaMeta[] };
export type CachedLedger = {
  entries: CachedEntry[];
  mediaLimits: MediaLimits;
  today: string;
  avatars: Partial<Record<OwnerKey, string>>;
  categories: { expense: string[]; income: string[] };
  owners: { key: OwnerKey; name: string }[];
};
export type CachedSession = { ownerKey: OwnerKey; name: string };
export type LedgerSnapshot = { ledger: CachedLedger; session: CachedSession; savedAt: number };

let snapshot: LedgerSnapshot | null = null;
/** localStorage 只在第一次真正需要读时解析一次，之后以内存为准。 */
let restored = false;

function restoreFromStorage() {
  if (restored || typeof window === 'undefined') return;
  restored = true;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as LedgerSnapshot;
    if (parsed?.ledger?.entries?.length >= 0 && parsed?.session?.ownerKey) snapshot = parsed;
  } catch {
    // 解析失败（版本更迭 / 手工改动）就当没有缓存。
  }
}

function persist() {
  if (typeof window === 'undefined') return;
  try {
    if (snapshot) window.localStorage.setItem(STORE_KEY, JSON.stringify(snapshot));
    else window.localStorage.removeItem(STORE_KEY);
  } catch {
    // 配额满或隐私模式：只退化为不持久化，不影响内存缓存。
  }
}

/** 读缓存的最后一份快照；没有（或已退出登录）时返回 null。 */
export function readLedgerSnapshot(): LedgerSnapshot | null {
  restoreFromStorage();
  return snapshot;
}

/** 整份覆盖：拉全量账目、改密码、登录成功之后都用它。 */
export function writeLedgerSnapshot(ledger: CachedLedger, session: CachedSession | null) {
  if (!session) {
    clearLedgerSnapshot();
    return;
  }
  snapshot = { ledger, session, savedAt: Date.now() };
  persist();
}

export function clearLedgerSnapshot() {
  snapshot = null;
  restored = true;
  persist();
}

/**
 * 把一份「局部」账本（详情页只拉了单条记录）并回缓存：
 * 单条记录按 id 覆盖，归属 / 分类 / 头像 / 额度这类元信息整块更新。
 * 没有缓存时不落库——只存一条记录会让首页先渲染出「只剩一笔」的假象。
 * 返回合并后的完整账本，调用方可以直接拿去当页面 state。
 */
export function mergeLedgerSnapshot(incoming: CachedLedger): CachedLedger | null {
  restoreFromStorage();
  if (!snapshot) return null;
  const byId = new Map(snapshot.ledger.entries.map((entry) => [entry.id, entry]));
  incoming.entries.forEach((entry) => byId.set(entry.id, entry));
  const merged: CachedLedger = {
    ...incoming,
    entries: Array.from(byId.values()).sort(byWhenDesc),
  };
  snapshot = { ...snapshot, ledger: merged, savedAt: Date.now() };
  persist();
  return merged;
}

/** 删除单张图片后同步缓存，详情页返回首页时不会又「长」回来。 */
export function updateCachedImages(entryId: string, images: MediaMeta[]) {
  restoreFromStorage();
  if (!snapshot) return;
  snapshot = {
    ...snapshot,
    ledger: {
      ...snapshot.ledger,
      entries: snapshot.ledger.entries.map((entry) => (entry.id === entryId ? { ...entry, images } : entry)),
    },
    savedAt: Date.now(),
  };
  persist();
}

/** 删除记录后同步缓存，返回首页时不会还留着已经删掉的那一笔。 */
export function removeCachedEntry(entryId: string) {
  restoreFromStorage();
  if (!snapshot) return;
  snapshot = {
    ...snapshot,
    ledger: {
      ...snapshot.ledger,
      entries: snapshot.ledger.entries.filter((entry) => entry.id !== entryId),
    },
    savedAt: Date.now(),
  };
  persist();
}
