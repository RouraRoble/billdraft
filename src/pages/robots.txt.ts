import type { APIRoute } from 'astro';
import { absoluteUrl } from '../lib/url';

// Allow all crawlers, including AI search bots (we want to be cited), and point to the sitemap.
export const GET: APIRoute = () => {
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${absoluteUrl('/sitemap-index.xml')}`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
