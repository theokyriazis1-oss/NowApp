/**
 * sw-src.js — service worker source (compiled by @serwist/next to public/sw.js)
 */
import { Serwist, CacheFirst, NetworkFirst, StaleWhileRevalidate, ExpirationPlugin } from 'serwist';

const DAY = 24 * 60 * 60;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Map tile images (offline support underground)
    {
      matcher: ({ url }) => /\.(png|jpe?g|svg|gif|webp)$/i.test(url.pathname) && url.protocol === 'https:',
      handler: new CacheFirst({
        cacheName: 'map-tiles-cache',
        plugins: [new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 7 * DAY })],
      }),
    },
    // Map style JSON
    {
      matcher: ({ url }) => /\/style\.json$/i.test(url.pathname),
      handler: new StaleWhileRevalidate({
        cacheName: 'map-styles-cache',
        plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: DAY })],
      }),
    },
    // Live API / socket polling must stay fresh: never serve stale vehicle data from cache
    {
      matcher: ({ url }) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/'),
      handler: new NetworkFirst({ cacheName: 'api-cache', networkTimeoutSeconds: 5 }),
    },
    // Everything else same-origin
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.protocol.startsWith('http'),
      handler: new NetworkFirst({
        cacheName: 'transit-map-cache',
        networkTimeoutSeconds: 10,
        plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: DAY })],
      }),
    },
  ],
});

serwist.addEventListeners();
