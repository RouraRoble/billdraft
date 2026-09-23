import { site } from '../site.config';
import { absoluteUrl } from './url';

export type JsonLd = Record<string, unknown>;

export function organizationLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.name,
    url: absoluteUrl('/'),
    logo: absoluteUrl('/icon-512.png'),
    ...(site.contactEmail ? { email: site.contactEmail } : {}),
  };
}

export function websiteLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.name,
    url: absoluteUrl('/'),
    description: site.description,
    inLanguage: site.locale,
    publisher: { '@type': 'Organization', name: site.name, url: absoluteUrl('/') },
  };
}

export function webAppLd(
  opts: { name?: string; description?: string; url?: string; category?: string; features?: string[] } = {},
): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: opts.name ?? site.name,
    url: absoluteUrl(opts.url ?? '/'),
    description: opts.description ?? site.description,
    applicationCategory: opts.category ?? site.category,
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    ...(opts.features?.length ? { featureList: opts.features } : {}),
    publisher: { '@type': 'Organization', name: site.name, url: absoluteUrl('/') },
  };
}

export function breadcrumbLd(items: { name: string; url: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: absoluteUrl(it.url),
    })),
  };
}

export function faqLd(faqs: { q: string; a: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function articleLd(opts: {
  headline: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified?: string;
  image?: string;
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: opts.headline,
    description: opts.description,
    url: absoluteUrl(opts.url),
    mainEntityOfPage: absoluteUrl(opts.url),
    datePublished: opts.datePublished,
    dateModified: opts.dateModified ?? opts.datePublished,
    ...(opts.image ? { image: absoluteUrl(opts.image) } : {}),
    author: { '@type': 'Organization', name: site.name, url: absoluteUrl('/') },
    publisher: {
      '@type': 'Organization',
      name: site.name,
      url: absoluteUrl('/'),
      logo: { '@type': 'ImageObject', url: absoluteUrl('/icon-512.png') },
    },
  };
}

export function howToLd(opts: { name: string; description: string; steps: { name: string; text: string }[] }): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: opts.name,
    description: opts.description,
    step: opts.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.name, text: s.text })),
  };
}

/** Safe JSON for <script type="application/ld+json"> (prevents </script> injection). */
export function ldJson(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** Clamp a description to a sensible meta length without cutting words. */
export function clampDescription(text: string, max = 158): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 80)).trim() + '…';
}
