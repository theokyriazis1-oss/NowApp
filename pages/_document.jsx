/**
 * pages/_document.jsx
 *
 * Custom Document for Next.js — adds lang, charset, and any
 * extra <head> tags that can't go in _app.
 */

import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="utf-8" />
        {/* Preconnect to map tile CDN for faster initial load */}
        <link rel="preconnect" href="https://basemaps.cartocdn.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossOrigin="anonymous" />
      </Head>
      <body className="bg-dark-bg">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
