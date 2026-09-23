// Post-build SEO/AEO audit over dist/. Fails the build on hard errors, prints warnings otherwise.
// Checks: title, description, canonical, lang, viewport, single h1, OG/Twitter, JSON-LD validity,
// image alt, internal link targets exist, sitemap/robots present, noindex only on 404.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { parse } from 'node-html-parser';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const strict = process.env.SEO_STRICT !== '0';
const errors = [];
const warnings = [];

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

if (!existsSync(dist)) {
  console.error('[seo] dist/ not found — run astro build first');
  process.exit(1);
}
const files = await walk(dist);
const routes = new Set(
  files.map((f) => {
    const rel = relative(dist, f).split(sep).join('/');
    return '/' + rel.replace(/index\.html$/, '').replace(/\.html$/, '/');
  }),
);
let siteOrigin = '';
let base = '';
// Pre-pass: derive the deployment base from the home page canonical so link checks work regardless of file order.
{
  const home = join(dist, 'index.html');
  if (existsSync(home)) {
    const c = parse(await readFile(home, 'utf8')).querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (c && /^https?:\/\//.test(c)) {
      const u = new URL(c);
      siteOrigin = u.origin;
      base = u.pathname.replace(/\/$/, '');
    }
  }
}

for (const file of files) {
  const rel = relative(dist, file).split(sep).join('/');
  const html = await readFile(file, 'utf8');
  const root = parse(html);
  const is404 = /(^|\/)404\.html$/.test(rel);
  const ctx = `dist/${rel}`;
  const err = (m) => errors.push(`${ctx}: ${m}`);
  const warn = (m) => warnings.push(`${ctx}: ${m}`);

  const htmlEl = root.querySelector('html');
  if (!htmlEl?.getAttribute('lang')) err('missing <html lang>');
  const title = root.querySelector('title')?.text?.trim() ?? '';
  if (!title) err('missing <title>');
  else if (title.length > 70) warn(`title is ${title.length} chars (>70): "${title}"`);
  else if (title.length < 12) warn(`title is short (${title.length} chars)`);
  const desc = root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '';
  if (!desc) err('missing meta description');
  else if (desc.length > 170) warn(`description is ${desc.length} chars (>170)`);
  else if (desc.length < 50) warn(`description is short (${desc.length} chars)`);
  if (!root.querySelector('meta[name="viewport"]')) err('missing viewport meta');

  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '';
  if (!canonical) err('missing canonical');
  else if (!/^https?:\/\//.test(canonical)) err(`canonical not absolute: ${canonical}`);
  else {
    const u = new URL(canonical);
    siteOrigin ||= u.origin;
    if (!is404 && !u.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(u.pathname)) warn(`canonical lacks trailing slash: ${canonical}`);
    const expected = '/' + rel.replace(/index\.html$/, '');
    if (!is404 && !u.pathname.endsWith(expected)) {
      // A canonical pointing at ANOTHER page of this site is intentional canonicalisation (duplicate/alias page): warn only.
      const target = base && u.pathname.startsWith(base) ? u.pathname.slice(base.length) || '/' : u.pathname;
      const targetNorm = target.endsWith('/') ? target : target + '/';
      if (routes.has(targetNorm)) warn(`canonicalised to ${u.pathname} (alias page)`);
      else err(`canonical path ${u.pathname} does not end with ${expected} and is not a page of this site`);
    }
    if (!base && expected !== '/' && u.pathname.endsWith(expected)) base = u.pathname.slice(0, u.pathname.length - expected.length);
  }

  const robots = root.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '';
  if (/noindex/i.test(robots) && !is404) warn('page is noindex');
  if (!/noindex/i.test(robots) && is404) warn('404 page should be noindex');

  const h1s = root.querySelectorAll('h1');
  if (h1s.length === 0) err('no <h1>');
  if (h1s.length > 1) warn(`${h1s.length} <h1> elements`);

  for (const p of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type']) {
    if (!root.querySelector(`meta[property="${p}"]`)) err(`missing ${p}`);
  }
  if (!root.querySelector('meta[name="twitter:card"]')) warn('missing twitter:card');

  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.text);
      const types = [].concat(data).map((d) => d['@type']).filter(Boolean);
      if (!types.length) warn('JSON-LD without @type');
    } catch (e) {
      err(`invalid JSON-LD: ${e.message}`);
    }
  }

  for (const img of root.querySelectorAll('img')) {
    if (img.getAttribute('alt') == null) err(`<img> without alt: ${img.getAttribute('src')}`);
  }

  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href || /^(https?:|mailto:|tel:|#|javascript:)/.test(href)) continue;
    const path = href.split('#')[0].split('?')[0];
    if (!path) continue;
    let appPath = path;
    if (base && (appPath === base || appPath.startsWith(base + '/'))) appPath = appPath.slice(base.length) || '/';
    else if (base && appPath.startsWith('/')) {
      // Deployed under a base path: a root-relative link that does not carry the base escapes the site (404 or wrong site).
      err(`internal link missing base path ${base}: ${href} (use withBase())`);
      continue;
    }
    if (!appPath.startsWith('/')) continue; // relative links: skip
    if (/\.[a-z0-9]+$/i.test(appPath)) {
      const asset = join(dist, appPath);
      if (!existsSync(asset)) warn(`link to missing asset ${href}`);
      continue;
    }
    const norm = appPath.endsWith('/') ? appPath : appPath + '/';
    if (!routes.has(norm)) err(`internal link to missing route ${href}`);
    if (!appPath.endsWith('/')) warn(`internal link without trailing slash: ${href}`);
  }
}

if (!existsSync(join(dist, 'sitemap-index.xml'))) errors.push('sitemap-index.xml missing');
if (!existsSync(join(dist, 'robots.txt'))) errors.push('robots.txt missing');
else {
  const robots = await readFile(join(dist, 'robots.txt'), 'utf8');
  if (!/Sitemap:\s*https?:\/\//.test(robots)) errors.push('robots.txt lacks absolute Sitemap line');
}
if (!existsSync(join(dist, 'og', 'default.png'))) warnings.push('og/default.png missing');
if (!existsSync(join(dist, 'manifest.webmanifest'))) warnings.push('manifest.webmanifest missing');

const pageCount = files.length;
console.log(`[seo] audited ${pageCount} pages · ${errors.length} errors · ${warnings.length} warnings`);
for (const w of warnings.slice(0, 60)) console.log('  warn  ' + w);
if (warnings.length > 60) console.log(`  … ${warnings.length - 60} more warnings`);
for (const e of errors.slice(0, 100)) console.log('  ERROR ' + e);
if (errors.length && strict) process.exit(1);
