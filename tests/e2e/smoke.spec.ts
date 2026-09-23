import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, existsSync } from 'node:fs';

// Routes to smoke-test. Products may add more in tests/routes.json (array of app-relative paths).
const BASE = ('/' + (process.env.BASE || '').replace(/^[\/]+|[\/]+$/g, '')).replace(/\/$/, '');
const extra = existsSync('tests/routes.json') ? (JSON.parse(readFileSync('tests/routes.json', 'utf8')) as string[]) : [];
const routes = Array.from(new Set(['/', '/about/', '/contact/', '/privacy/', '/terms/', ...extra]));
const viewports = [320, 375, 390, 414, 768, 1280, 1920];

async function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

for (const route of routes) {
  test.describe(route, () => {
    test('loads without errors, has h1, title and canonical', async ({ page }) => {
      const errors = await collectErrors(page);
      const res = await page.goto(BASE + route);
      expect(res?.status(), 'status').toBeLessThan(400);
      await expect(page.locator('h1').first()).toBeVisible();
      await expect(page).toHaveTitle(/.+/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https?:\/\//);
      expect(errors, errors.join('\n')).toEqual([]);
    });

    for (const scheme of ['light', 'dark'] as const) {
      test(`has no serious accessibility violations (${scheme} mode)`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(BASE + route);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`), 'axe violations').toEqual([]);
      });
    }

    test('does not overflow horizontally at any viewport', async ({ page }) => {
      await page.goto(BASE + route);
      for (const w of viewports) {
        await page.setViewportSize({ width: w, height: 800 });
        await page.waitForTimeout(50);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `overflow at ${w}px`).toBeLessThanOrEqual(0);
      }
    });
  });
}

test('404 page is served', async ({ page }) => {
  const res = await page.goto(BASE + '/this-page-does-not-exist/');
  expect(res?.status()).toBe(404);
  await expect(page.locator('h1')).toContainText(/not found/i);
});

test('robots, sitemap, manifest and og image exist', async ({ request }) => {
  for (const p of ['/robots.txt', '/sitemap-index.xml', '/manifest.webmanifest', '/og/default.png', '/favicon.svg']) {
    const r = await request.get(BASE + p);
    expect(r.status(), p).toBe(200);
  }
});
