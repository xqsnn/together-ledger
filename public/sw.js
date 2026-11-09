/* 两人账本 · Service Worker
 *
 * 目标：让「添加到主屏幕」后启动接近原生——外壳秒开、断网也能先看到界面。
 * 红线：/api/* 一律不缓存，账目、登录态永远走网络，避免看到别人的或过期的数据。
 */
const VERSION = 'v3';
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

  // 页面导航：先网络，断网时回退到上次缓存的首页外壳。
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && url.pathname === '/') {
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/', response.clone()).catch(() => {});
        }
        return response;
      } catch {
        const cached = await caches.match('/');
        return cached || Response.error();
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
