/**
 * Product-level configuration. Every product edits this file.
 * Keep values honest: they end up in metadata, structured data and legal pages.
 */
export const site = {
  name: 'BillDraft',
  slug: 'billdraft',
  tagline: 'Free invoice, quote and receipt generator that runs entirely in your browser.',
  description:
    'Create a clean, watermark-free invoice, quote, receipt or credit note in your browser. No sign-up, multi-currency tax and discounts, print to PDF, share as a link.',
  locale: 'en',
  ogLocale: 'en_US',
  themeColor: '#1c1917',
  backgroundColor: '#f7f6f2',
  accent: '#0f766e',
  author: { name: 'RouraRoble', url: 'https://github.com/RouraRoble' },
  contactEmail: 'roura.roble@gmail.com',
  launched: '2026-09-23',
  updated: '2026-09-23',
  category: 'BusinessApplication', // schema.org SoftwareApplication applicationCategory
  keywords: [
    'invoice generator',
    'free invoice generator',
    'invoice maker',
    'invoice template',
    'quote generator',
    'receipt generator',
    'credit note',
    'how to write an invoice',
  ] as string[],
  social: { twitter: '' },
  // Monetization / analytics hooks (all optional, env-driven at build time)
  adsenseClient: import.meta.env.PUBLIC_ADSENSE_CLIENT || '',
  beaconUrl: import.meta.env.PUBLIC_BEACON_URL || '',
  plausibleDomain: import.meta.env.PUBLIC_PLAUSIBLE_DOMAIN || '',
  /**
   * Affiliate / partner block (rendered by <Affiliate />). URLs stay '#' until a partner programme is joined;
   * see PRODUCT.md "Monetization". Links render with rel="sponsored noopener" and a visible "Sponsored" label.
   */
  affiliate: {
    enabled: true,
    heading: 'Get paid faster',
    disclosure: 'Sponsored links. If you sign up through them we may earn a commission at no cost to you.',
    partners: [
      { name: 'Wise Business', blurb: 'Receive international payments with local account details in 9+ currencies.', url: '#' },
      { name: 'Stripe Invoicing', blurb: 'Send invoices your clients can pay by card or bank transfer.', url: '#' },
      { name: 'Wave', blurb: 'Free accounting for invoices you want to track alongside expenses.', url: '#' },
    ] as { name: string; blurb: string; url: string }[],
  },
};
export type SiteConfig = typeof site;
