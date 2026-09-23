# BillDraft

Free invoice, quote, receipt and credit-note generator that runs entirely in the browser: no sign-up, no watermark, no server. Documents, clients and per-type numbering counters live in `localStorage`; a finished document can be shared as a read-only link with the data compressed into the URL fragment.

Live at `https://rouraroble.github.io/billdraft/` once deployed.

## What it is

- **Core tool (`/`, `/quote/`, `/receipt/`, `/credit-note/`)**: one Preact island (`src/components/Editor.tsx`) editing a single document model (`src/lib/invoice.ts`). Business ("From") and client ("To") details, logo (data URL, kept out of the share link unless < 20 KB), auto-incrementing document number per type, issue date, due terms (Net 7/14/30/60 or custom), currency (ISO 4217 list, `Intl.NumberFormat` formatting), line items (qty, unit price, per-line tax %, per-line discount), global discount (% or amount), tax mode (exclusive/inclusive), shipping, deposit paid, notes, payment instructions, optional pay-link QR (`qrcode`, MIT). Four print templates (Classic/Minimal/Bold/Compact) with an accent colour.
- **Output**: "Download PDF" via a print-only CSS layout (`@page { size: A4 | Letter; margin: 14mm }`) and `window.print()`; no server round-trip. PNG export is not implemented (documented as a known limit on `/about/`).
- **Share loop**: the whole document is serialized and compressed with `lz-string` (MIT) into the URL hash (`#d=…`). Opening that link renders a read-only "view" mode with Print/Duplicate. Saved documents, clients and a JSON export/import backup live in `localStorage` (`src/components/Editor.tsx` "Saved" panel).
- **Programmatic pages** (`/invoice-template/{slug}/`, 14 pages, `src/data/templates.json`): each preloads sample line items and wording for a real invoicing context (freelance, consulting, web-design, photography, cleaning, construction, plumbing, hourly, proforma, commercial invoice, GST India, VAT UK, EU reverse charge, USD→EUR client) with jurisdiction-specific notes and links to primary sources (gov.uk, IRS, EU VAT Directive). No invented statistics — every claim on those pages is either a formula documented on `/about/` or backed by the linked official source.
- **Guides** (`/guide/how-to-write-an-invoice/`, `/guide/invoice-numbering/`, `/guide/net-30-payment-terms/`): answer-first Article/HowTo pages with FAQ schema.
- **Standard pages**: `/about/` (methodology: rounding rule, tax-mode formulas, due-date/numbering logic, what is stored and where, known limits, licensing, last-updated date), `/contact/`, `/privacy/`, `/terms/`, `/404`, `robots.txt`, `sitemap-index.xml`, `manifest.webmanifest`, per-page OG images (`satori` + `sharp`, MIT/Apache-2.0, build-time only).

## Data sources & licences

- `src/data/templates.json` — original content (sample line items, checklist notes) written for this product; each entry cites primary sources (IRS, UK gov.uk, EU VAT Directive) for the legal claims it makes rather than reproducing their text. No scraped or copyrighted data. Retrieval/authoring date: 2026-09-23.
- Libraries: Astro (MIT), Preact (MIT), `lz-string` (MIT), `qrcode` (MIT), `satori` (MIT), `sharp` (Apache-2.0), `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` (OFL-1.1, self-hosted).
- No network calls at build or runtime beyond the optional, env-gated analytics beacon/Plausible script (off by default).

## Formulas (see `/about/` for the user-facing explanation, `src/lib/invoice.ts` for the implementation)

- Money is rounded to the currency's minor unit (2 dp default, 0 for JPY/KRW-style, 3 for KWD/BHD-style, per ISO 4217) at the point each amount is produced — round-half-away-from-zero on a float-noise-corrected value — so printed lines always sum to the printed total.
- Exclusive tax: `tax = amount × rate`. Inclusive tax: `taxable = amount ÷ (1 + rate)`, `tax = amount − taxable`.
- A global discount is allocated across lines in proportion to each line's net amount before tax, so tax is never charged on a discounted-away amount.
- "Net N" adds N calendar days to the issue date; document numbers auto-increment the trailing digit run of the last number used per type, preserving zero-padding.

## Identity

Warm paper/ledger visual language: `IBM Plex Sans` (UI) + `IBM Plex Mono` (numbers/totals), off-white paper background, near-black ink, emerald (`#0f766e`) accent, custom document-with-ledger-lines favicon mark. Full dark-mode token set under `prefers-color-scheme: dark`. No template placeholders remain (see `src/site.config.ts`, `public/favicon.svg`, `src/styles/tokens.css`).

## Monetization hooks (not wired to real partners yet)

- `<Affiliate>` block ("Get paid faster": Wise Business, Stripe Invoicing, Wave) rendered below the editor on `/`, `/quote/`, `/receipt/`, `/credit-note/` — `rel="sponsored noopener"`, URLs are `#` placeholders until a partner programme is joined, clearly labelled "Sponsored".
- `<AdSlot>` placeholders on guide and template pages only (never over the editor); render nothing unless `PUBLIC_ADSENSE_CLIENT` is set at build time.
- Pro stub (future, not built): recurring invoices, cloud backup/sync, custom template upload, team seats.

## Known limits

- "Download as image (PNG)" is not implemented; "Download PDF" (print-to-PDF) is the supported export path.
- No cloud backup — the editor's "Export JSON backup" is the recommended manual backup path.
- Content on `/invoice-template/*` is general guidance, not tax/legal advice; each page links to an official source and tells the reader to confirm current rates/thresholds there.
- Share links contain the full document in the URL fragment (never sent to a server, but readable by anyone holding the link) — the editor and `/about/` both warn about this before a link is copied.

## Future ideas

1. PNG export (canvas rasterization of the print layout) to close the one documented gap.
2. More jurisdiction template pages (Canada GST/HST, Australia GST, Ireland VAT) once sourced against primary tax-authority pages.
3. Recurring invoice reminders (local notification/email-mailto prefill) as a Pro-stub proof of concept.
4. Multi-page invoice support for very long item lists (current layout assumes a single print page).
5. Client-side invoice import (CSV/JSON) to prefill line items in bulk.
