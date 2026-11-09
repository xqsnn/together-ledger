'use client';

import { useEffect } from 'react';

/**
 * 只在生产环境注册 Service Worker：
 * 开发时 Vite 的模块 URL 每次都变，缓存优先反而会拿到旧代码。
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* 注册失败不影响正常使用，静默忽略 */
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
