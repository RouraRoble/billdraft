# Product template (Astro, static, GitHub Pages)

Shared foundation for all mission products. Copy it, then customise.

## Customise (in this order)
1. `src/site.config.ts` — name, slug, tagline, description, colours, category, contact.
2. `public/favicon.svg` — the brand mark (PNG icons are generated from it at build).
3. `src/styles/tokens.css` — override `--accent`, fonts, radii to give the product its own identity.
4. `src/pages/index.astro` — the product. Put interactive parts in a Preact island (`client:load`/`client:visible`) or a plain `<script>`.
5. `src/pages/about.astro` — replace the methodology section with the real one (formulas, datasets, sources, dates).
6. Programmatic pages: `src/pages/<dir>/[slug].astro` with `getStaticPaths()` over a JSON dataset in `src/data/`.
7. `tests/routes.json` — add representative routes for the E2E smoke tests.

## Rules baked in
- Every page: title, description, canonical, OG/Twitter, JSON-LD, single h1, `lang`, viewport.
- `Base.astro` injects WebSite + Organization schema on the home page only; pass `jsonLd` for page-specific schema (WebApplication, FAQPage, BreadcrumbList, Article, HowTo helpers in `src/lib/seo.ts`).
- Links: always `withBase('/path/')` (trailing slash). Absolute: `absoluteUrl()`.
- Share bar: `<Share url={absoluteUrl(...)} text="..." />`.
- OG images: `renderOg()` in `src/lib/og.ts`; add `src/pages/og/[slug].png.ts` endpoints for per-page cards.
- Security: strict CSP meta (hashes computed by Astro). Do not add inline event handlers; external scripts must be added to `scriptDirective.resources` in `astro.config.mjs`.
- Ads/analytics only activate when `PUBLIC_ADSENSE_CLIENT` / `PUBLIC_BEACON_URL` / `PUBLIC_PLAUSIBLE_DOMAIN` are set (GitHub repo variables).

## Commands
- `npm run dev` · `npm run build` (runs icons + SEO audit) · `npm test` (unit) · `npm run test:e2e` (Playwright + axe, viewports 320→1920)
- Build for a project site locally: `SITE=https://rouraroble.github.io BASE=/slug npm run build`

## Deploy
Push to `main` of the product's GitHub repo; `.github/workflows/deploy.yml` builds and publishes to GitHub Pages. The mission `scripts/deploy.mjs <slug>` script does this from the monorepo.
