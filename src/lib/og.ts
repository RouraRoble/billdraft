/**
 * Build-time Open Graph image generation (1200x630 PNG) with satori + sharp.
 * Usage in an endpoint: `return new Response(await renderOg({ title, subtitle }), { headers: { 'Content-Type': 'image/png' } })`
 */
import satori from 'satori';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { site } from '../site.config';

const require = createRequire(import.meta.url);
let fontCache: { bold: Buffer; regular: Buffer } | null = null;

async function fonts() {
  if (!fontCache) {
    const bold = await readFile(require.resolve('@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff'));
    const regular = await readFile(require.resolve('@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff'));
    fontCache = { bold, regular };
  }
  return fontCache;
}

export interface OgOptions {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  accent?: string;
  bg?: string;
  fg?: string;
}

// satori accepts React-like element objects; we build them without JSX.
const h = (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({
  type,
  props: { ...props, children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children },
});

export async function renderOg(opts: OgOptions): Promise<Buffer> {
  const { bold, regular } = await fonts();
  const accent = opts.accent ?? site.accent;
  const bg = opts.bg ?? '#0b1220';
  const fg = opts.fg ?? '#ffffff';
  const title = opts.title.length > 90 ? opts.title.slice(0, 87) + '…' : opts.title;
  const titleSize = title.length > 60 ? 52 : title.length > 36 ? 64 : 76;

  const tree = h(
    'div',
    {
      style: {
        width: '1200px',
        height: '630px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        background: `linear-gradient(135deg, ${bg} 0%, ${bg} 55%, ${accent} 160%)`,
        color: fg,
        fontFamily: 'IBM Plex Sans',
      },
    },
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '20px' } },
      h('div', { style: { fontSize: 26, fontWeight: 400, opacity: 0.85, letterSpacing: 2, textTransform: 'uppercase' } }, opts.eyebrow ?? site.name),
      h('div', { style: { fontSize: titleSize, fontWeight: 800, lineHeight: 1.08, letterSpacing: -2, maxWidth: '1000px' } }, title),
      opts.subtitle ? h('div', { style: { fontSize: 30, fontWeight: 400, opacity: 0.85, lineHeight: 1.35, maxWidth: '980px' } }, opts.subtitle) : '',
    ),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 26 } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '14px', fontWeight: 800 } },
        h('div', { style: { width: 22, height: 22, borderRadius: 6, background: accent } }),
        h('div', { style: { display: 'flex' } }, site.name),
      ),
      h('div', { style: { display: 'flex', opacity: 0.7 } }, 'Free · No sign-up'),
    ),
  );

  const svg = await satori(tree as never, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'IBM Plex Sans', data: bold, weight: 700, style: 'normal' },
      { name: 'IBM Plex Sans', data: regular, weight: 400, style: 'normal' },
    ],
  });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
