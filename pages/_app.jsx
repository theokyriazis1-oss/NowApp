/**
 * pages/_app.jsx
 *
 * Root Next.js App component.
 * (The MapLibre worker URL is configured in components/TransitMap.jsx,
 * which only ever loads in the browser.)
 */

import '../styles/globals.css';
import Head from 'next/head';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="application-name" content="Now" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Now" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#15181d" />
        <meta name="description" content="Live buses, trams and trains in the Netherlands" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-192x192.png" />
        <link rel="icon" href="/icons/icon-96x96.png" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
