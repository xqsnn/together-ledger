'use client';

/**
 * 账本快照缓存：活在模块作用域，跟着整页 JS 生命周期走。
 *
 * 首页和详情页是两个路由，各自挂载自己的组件，路由一跳 state 就没了。
 * 以前从详情页返回首页要重新走一遍「校验登录 → 拉全量账目」，
 * 屏幕上先闪一段「正在翻开账本…」；进详情页也一样。
 *
 * 这里把上一次成功拿到的账目和登录态留在内存里：
 * 新页面挂载时先用它同步渲染（还没画到屏幕上），再在后台静默刷新。
 *
 * 只放内存、不落 localStorage：账目和登录态都是私密数据，关掉页面就该消失。
 * 也因此不需要失效时间——每次挂载都会真的请求一次接口。
 */

import { byWhenDesc, type Entry, type OwnerKey } from './ledger';
import type { MediaLimits, MediaMeta } from './media';

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

/** 读缓存的最后一份快照；没有（或已退出登录）时返回 null。 */
export function readLedgerSnapshot(): LedgerSnapshot | null {
  return snapshot;
}

/** 整份覆盖：拉全量账目、改密码、登录成功之后都用它。 */
export function writeLedgerSnapshot(ledger: CachedLedger, session: CachedSession | null) {
  if (!session) {
    snapshot = null;
    return;
  }
  snapshot = { ledger, session, savedAt: Date.now() };
}

export function clearLedgerSnapshot() {
  snapshot = null;
}

/**
 * 把一份「局部」账本（详情页只拉了单条记录）并回缓存：
 * 单条记录按 id 覆盖，归属 / 分类 / 头像 / 额度这类元信息整块更新。
 * 没有缓存时不落库——只存一条记录会让首页先渲染出「只剩一笔」的假象。
 * 返回合并后的完整账本，调用方可以直接拿去当页面 state。
 */
export function mergeLedgerSnapshot(incoming: CachedLedger): CachedLedger | null {
  if (!snapshot) return null;
  const byId = new Map(snapshot.ledger.entries.map((entry) => [entry.id, entry]));
  incoming.entries.forEach((entry) => byId.set(entry.id, entry));
  const merged: CachedLedger = {
    ...incoming,
    entries: Array.from(byId.values()).sort(byWhenDesc),
  };
  snapshot = { ...snapshot, ledger: merged, savedAt: Date.now() };
  return merged;
}

/** 删除单张图片后同步缓存，详情页返回首页时不会又「长」回来。 */
export function updateCachedImages(entryId: string, images: MediaMeta[]) {
  if (!snapshot) return;
  snapshot = {
    ...snapshot,
    ledger: {
      ...snapshot.ledger,
      entries: snapshot.ledger.entries.map((entry) => (entry.id === entryId ? { ...entry, images } : entry)),
    },
    savedAt: Date.now(),
  };
}

/** 删除记录后同步缓存，返回首页时不会还留着已经删掉的那一笔。 */
export function removeCachedEntry(entryId: string) {
  if (!snapshot) return;
  snapshot = {
    ...snapshot,
    ledger: {
      ...snapshot.ledger,
      entries: snapshot.ledger.entries.filter((entry) => entry.id !== entryId),
    },
    savedAt: Date.now(),
  };
}
