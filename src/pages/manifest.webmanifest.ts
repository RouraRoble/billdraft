import type { APIRoute } from 'astro';
import { site } from '../site.config';
import { withBase } from '../lib/url';

export const GET: APIRoute = () => {
  const manifest = {
    name: site.name,
    short_name: site.name.length > 12 ? site.name.split(' ')[0] : site.name,
    description: site.description,
    start_url: withBase('/'),
    scope: withBase('/'),
    display: 'standalone',
    background_color: site.backgroundColor,
    theme_color: site.themeColor,
    lang: site.locale,
    icons: [
      { src: withBase('/icon-192.png'), sizes: '192x192', type: 'image/png' },
      { src: withBase('/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: withBase('/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/manifest+json' } });
};
