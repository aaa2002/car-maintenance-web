import type { MetadataRoute } from 'next';

// Icons are exported from brand/svg by brand/source/export.js.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vehix',
    short_name: 'Vehix',
    description: 'Fleet maintenance, trip, cost and compliance tracking.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f1f2f4',
    theme_color: '#1f55d6',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
