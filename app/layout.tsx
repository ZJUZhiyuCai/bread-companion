import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: '面包 · 今晚，先说说',
  description: '收到面试拒信的那个晚上，可以说说、留个记号，或者在你愿意时复盘一道题。',
  icons: { icon: '/favicon.svg' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F8F4EC' },
    { media: '(prefers-color-scheme: dark)', color: '#16181D' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" data-text-size="m">
      <body>{children}</body>
    </html>
  );
}
