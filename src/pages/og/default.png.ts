import type { APIRoute } from 'astro';
import { renderOg } from '../../lib/og';
import { site } from '../../site.config';

export const GET: APIRoute = async () => {
  const png = await renderOg({ title: site.name, subtitle: site.tagline, eyebrow: 'Free online tool' });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
