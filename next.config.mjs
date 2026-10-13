import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'sw-src.js',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,


  // maplibre-gl is browser-only, exclude from the server bundle
  serverExternalPackages: ['maplibre-gl'],

  // Alias mapbox-gl -> maplibre-gl (Turbopack for dev)
  turbopack: {
    resolveAlias: {
      'mapbox-gl': 'maplibre-gl',
    },
  },

  // Same alias for `next build --webpack`
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      'mapbox-gl': 'maplibre-gl',
    };
    return config;
  },
};

export default withSerwist(nextConfig);
