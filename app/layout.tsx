import type { Metadata, Viewport } from 'next';
import './globals.css';
import ServiceWorkerRegistrar from '@/components/service-worker-registrar';

export const metadata: Metadata = {
  title: '两人账本 · 把日子记在一起',
  description: '两个人，一本账。一起记录收支，慢慢积攒生活。',
  applicationName: '两人账本',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.svg',
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  // 从主屏幕启动时全屏运行、没有地址栏；default 状态栏让 iOS 自己让出安全区。
  appleWebApp: { capable: true, title: '两人账本', statusBarStyle: 'default' },
  formatDetection: { telephone: false, date: false, email: false, address: false },
};

// viewport-fit=cover 让 env(safe-area-inset-*) 真正生效；
// resizes-content 让软键盘弹出时压缩布局，而不是盖住正在输入的输入框。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#eef2e8',
  interactiveWidget: 'resizes-content',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
