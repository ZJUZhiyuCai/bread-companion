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
    // the top of the set's wall in each scheme, so the browser chrome continues the same light
    { media: '(prefers-color-scheme: light)', color: '#FBF7F0' },
    { media: '(prefers-color-scheme: dark)', color: '#211D18' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" data-text-size="m">
      <head>
        {/* 面包 first. Its photo is only named inside inline SVG, which the preload scanner never reads,
            so without this it was requested late and arrived after the phone. */}
        <link rel="preload" href="/companion/bread-plush.webp" as="image" type="image/webp" fetchPriority="high" />
        <link rel="preload" href="/design/fonts/bread-voice-core-835e939dbc07.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/companion/3d/bread-phone-rest.webp" as="image" type="image/webp" />
        <link rel="preload" href="/design/soft-expression/felt-flower.svg" as="image" type="image/svg+xml" />
      </head>
      <body>{children}</body>
    </html>
  );
}
