/* 两人账本 · Service Worker
 *
 * 目标：让「添加到主屏幕」后启动接近原生——外壳秒开、断网也能先看到界面。
 * 红线：/api/* 一律不缓存，账目、登录态永远走网络，避免看到别人的或过期的数据。
 */
const VERSION = 'v6';
const SHELL_CACHE = `ledger-shell-${VERSION}`;
const ASSET_CACHE = `ledger-assets-${VERSION}`;
const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 单个资源失败不应该让整个安装失败。
    await Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // 账目接口不缓存。
  if (url.pathname.startsWith('/api/')) return;

  // 页面导航分两类：
  // 1) 首页「/」：缓存秒回（Stale-While-Revalidate），点图标瞬间出外壳，
  //    数据由页面脚本用本地快照 + 后台请求填充；同一时间后台拉新 HTML 供下次启动。
  // 2) 其它路径（详情页等）：先网络，断网时回退到缓存的首页外壳。
  if (request.mode === 'navigate') {
    if (url.pathname === '/') {
      event.respondWith((async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match('/');
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put('/', response.clone()).catch(() => {});
            return response;
          })
          .catch(() => null);
        if (cached) {
          event.waitUntil(network);
          return cached;
        }
        const response = await network;
        return response || Response.error();
      })());
      return;
    }
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('/')) || Response.error();
      }
    })());
    return;
  }

  // 静态资源：先给缓存（秒开），同时后台拉新，下次生效。
  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(request);
    const network = fetch(request)
      .then((response) => {
        if (response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
      })
      .catch(() => null);
    const response = cached || (await network);
    return response || Response.error();
  })());
});
