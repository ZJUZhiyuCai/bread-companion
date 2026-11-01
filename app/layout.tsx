import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../public/design/fonts/fonts.css';
import './globals.css';

export const metadata: Metadata = {
  title: '面包 · 先在这儿待一会儿',
  description: '收到面试拒信的那个晚上，先在这儿待一会儿。想开口时，可以打字或给面包打个电话；想整理时，再一起留个记号、看一段回答或练一题。',
  icons: { icon: '/favicon.svg' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    // the page's --bg in each scheme, so the browser chrome is the same paper
    { media: '(prefers-color-scheme: light)', color: '#F9F4EB' },
    { media: '(prefers-color-scheme: dark)', color: '#17150F' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" data-text-size="m">
      <head>
        <link rel="preload" href="/design/fonts/bread-voice-core-835e939dbc07.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/companion/3d/bread-phone-rest.webp" as="image" type="image/webp" />
      </head>
      <body>{children}</body>
    </html>
  );
}
