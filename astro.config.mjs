// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import preact from '@astrojs/preact';

// SITE and BASE are injected by CI (see .github/workflows/deploy.yml).
// Locally they default to a root deployment so `npm run dev` works without env.
const SITE = process.env.SITE || 'https://rouraroble.github.io';
const BASE = '/' + (process.env.BASE || '').replace(/^[\/]+|[\/]+$/g, '');
// Third-party origins are only allowed when the corresponding feature is enabled at build time (repo variables).
const ADSENSE = Boolean(process.env.PUBLIC_ADSENSE_CLIENT);
const PLAUSIBLE = Boolean(process.env.PUBLIC_PLAUSIBLE_DOMAIN);
const extraScript = [
  ...(ADSENSE ? ['https://pagead2.googlesyndication.com', 'https://*.googlesyndication.com', 'https://*.doubleclick.net', 'https://*.google.com', 'https://*.adtrafficquality.google'] : []),
  ...(PLAUSIBLE ? ['https://plausible.io'] : []),
];
const extraFrame = ADSENSE ? ['https://*.googlesyndication.com', 'https://*.doubleclick.net', 'https://*.google.com'] : [];

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'always',
  compressHTML: true,
  build: { format: 'directory', inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [
    preact(),
    sitemap({
      filter: (page) => !/\/404\/?$/.test(page),
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self' https:",
        ...(extraFrame.length ? [`frame-src ${extraFrame.join(' ')}`] : ["frame-src 'none'"]),
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        'upgrade-insecure-requests',
      ],
      styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
      scriptDirective: { resources: ["'self'", ...extraScript] },
    },
  },
  vite: { build: { cssMinify: true } },
});
