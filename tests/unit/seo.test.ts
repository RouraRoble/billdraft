import { describe, expect, it } from 'vitest';
import { clampDescription, faqLd, ldJson, breadcrumbLd } from '../../src/lib/seo';
import { withBase, absoluteUrl, stripBase } from '../../src/lib/url';

describe('url helpers', () => {
  it('prefixes app paths with base', () => {
    expect(withBase('/about/')).toMatch(/\/about\/$/);
    expect(withBase('about/')).toMatch(/\/about\/$/);
    expect(withBase('https://x.test/y')).toBe('https://x.test/y');
    expect(withBase('mailto:a@b.c')).toBe('mailto:a@b.c');
  });
  it('builds absolute urls', () => {
    expect(absoluteUrl('/')).toMatch(/^https?:\/\/[^/]+\/.*$/);
    expect(absoluteUrl('https://x.test/')).toBe('https://x.test/');
  });
  it('strips base', () => {
    expect(stripBase(withBase('/x/'))).toBe('/x/');
  });
});

describe('seo helpers', () => {
  it('clamps descriptions on word boundaries', () => {
    const long = 'word '.repeat(60).trim();
    const out = clampDescription(long, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith('…')).toBe(true);
    expect(clampDescription('short')).toBe('short');
  });
  it('escapes closing script tags in JSON-LD', () => {
    const s = ldJson({ a: '</script><script>alert(1)</script>' });
    expect(s).not.toContain('</script>');
    expect(JSON.parse(s).a).toContain('</script>');
  });
  it('produces valid FAQ and breadcrumb schema', () => {
    const faq = faqLd([{ q: 'Q?', a: 'A.' }]) as any;
    expect(faq['@type']).toBe('FAQPage');
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe('A.');
    const bc = breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'About', url: '/about/' }]) as any;
    expect(bc.itemListElement[1].position).toBe(2);
    expect(bc.itemListElement[1].item).toMatch(/\/about\/$/);
  });
});
