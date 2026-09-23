import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildShareUrl,
  computeTotals,
  currencyDigits,
  decodeDoc,
  defaultDoc,
  defaultNumber,
  docLabels,
  dueDateFor,
  encodeDoc,
  formatDecimalInput,
  formatMoney,
  incrementNumber,
  isIsoDate,
  isSafeLogo,
  isSafeUrl,
  newItem,
  parseDecimalInput,
  roundTo,
  sanitizeDoc,
  sanitizeParty,
  SHARE_PARAM,
  shareParamFromHash,
  termsDays,
  termsLabel,
  todayIso,
  validateDoc,
  type Doc,
} from '../../src/lib/invoice';
import { LOCALES } from '../../src/lib/currencies';

function docWith(patch: Partial<Doc>): Doc {
  return { ...defaultDoc('invoice', '2026-01-01'), ...patch };
}

describe('roundTo', () => {
  it('rounds half away from zero, not banker’s rounding', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(2.675, 2)).toBe(2.68);
  });
  it('corrects binary float noise', () => {
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
  });
  it('supports 0 and 3 digit currencies', () => {
    expect(roundTo(1234.5, 0)).toBe(1235);
    expect(roundTo(1.2345, 3)).toBe(1.235);
  });
  it('never returns negative zero', () => {
    expect(Object.is(roundTo(-0.001, 2), -0)).toBe(false);
    expect(roundTo(-0.001, 2)).toBe(0);
  });
  it('returns 0 for non-finite input', () => {
    expect(roundTo(NaN)).toBe(0);
    expect(roundTo(Infinity)).toBe(0);
  });
});

// Regression for the audit's P0 finding: a numeric field used to be a *controlled*
// `type="number"` input whose `onInput` wrote `Number(v) || 0` back into `value` on every
// keystroke. Chromium reports "12" (not "12.") for the in-progress text "12.", so committing
// that straight back corrupted real, key-by-key typing: "12.5" became "512", "0.05" became "5",
// "-2.5" became "-2". `parseDecimalInput` is the fix's core: it must return `null` — meaning
// "leave state alone" — for every incomplete/in-progress string, and only commit once the string
// is a genuinely complete number.
describe('parseDecimalInput', () => {
  it('parses complete decimal numbers', () => {
    expect(parseDecimalInput('12.5')).toBe(12.5);
    expect(parseDecimalInput('0.05')).toBe(0.05);
    expect(parseDecimalInput('-2.5')).toBe(-2.5);
    expect(parseDecimalInput('100')).toBe(100);
    expect(parseDecimalInput('0')).toBe(0);
  });

  it('returns null for incomplete in-progress input instead of corrupting it to 0', () => {
    expect(parseDecimalInput('')).toBeNull();
    expect(parseDecimalInput('-')).toBeNull();
    expect(parseDecimalInput('.')).toBeNull();
    expect(parseDecimalInput('-.')).toBeNull();
    expect(parseDecimalInput('12.')).toBeNull();
    expect(parseDecimalInput('-2.')).toBeNull();
    expect(parseDecimalInput(',')).toBeNull();
  });

  it('replays the exact audit keystroke sequences and lands on the right final value', () => {
    // "12.5" typed one character at a time: 1, 12, 12., 12.5
    const keystrokes = ['1', '12', '12.', '12.5'];
    let committed: number | null = null;
    for (const k of keystrokes) {
      const n = parseDecimalInput(k);
      if (n !== null) committed = n; // only a valid keystroke ever updates the committed value
    }
    expect(committed).toBe(12.5);

    // "0.05" typed one character at a time: 0, 0., 0.0, 0.05
    let committed2: number | null = null;
    for (const k of ['0', '0.', '0.0', '0.05']) {
      const n = parseDecimalInput(k);
      if (n !== null) committed2 = n;
    }
    expect(committed2).toBe(0.05);

    // "-2.5" typed one character at a time: -, -2, -2., -2.5
    let committed3: number | null = null;
    for (const k of ['-', '-2', '-2.', '-2.5']) {
      const n = parseDecimalInput(k);
      if (n !== null) committed3 = n;
    }
    expect(committed3).toBe(-2.5);
  });

  it('uses "," as the decimal separator for a comma-decimal locale (e.g. de-DE)', () => {
    expect(parseDecimalInput('1,5', 'de-DE')).toBe(1.5);
    expect(parseDecimalInput('0,05', 'de-DE')).toBe(0.05);
    expect(parseDecimalInput('-2,5', 'de-DE')).toBe(-2.5);
  });

  it('rejects strings with more than one decimal separator or non-numeric characters', () => {
    expect(parseDecimalInput('1.2.3')).toBeNull();
    expect(parseDecimalInput('1,2,3', 'de-DE')).toBeNull();
    expect(parseDecimalInput('abc')).toBeNull();
    expect(parseDecimalInput('12a')).toBeNull();
  });

  // Regression for audit-3 finding A3-1: a previous version always read a lone "," as the
  // decimal separator, so on the default en-US locale "1,500" — one thousand five hundred,
  // written the standard en-US way — silently became 1.5, and "1,234.56" became 0 on blur. Which
  // character is the decimal point is now decided by locale, never guessed from the string.
  describe('A3-1: locale-aware thousands separators (regression)', () => {
    it('treats "," as a thousands separator, not a decimal point, on the default en-US locale', () => {
      expect(parseDecimalInput('1,500')).toBe(1500);
      expect(parseDecimalInput('1,234.56')).toBe(1234.56);
      expect(parseDecimalInput('$1,500.00')).toBe(1500);
      expect(parseDecimalInput('12,345,678.9')).toBe(12345678.9);
    });

    it('treats "." as a thousands separator, not a decimal point, on a comma-decimal locale', () => {
      expect(parseDecimalInput('1.234,56', 'de-DE')).toBe(1234.56);
      expect(parseDecimalInput('1.500', 'de-DE')).toBe(1500);
    });

    it('treats plain whitespace as thousands grouping regardless of locale', () => {
      expect(parseDecimalInput('1 000')).toBe(1000);
    });

    it('strips a leading "+" instead of rejecting the value outright', () => {
      expect(parseDecimalInput('+5')).toBe(5);
    });
  });

  // Audit-4 finding A4-1(a): es-ES, it-IT and pl-PL have `minimumGroupingDigits: 2` in CLDR, so
  // a 4-digit probe number never produces a `group` part and the old code fell back to ',' —
  // which collided with these locales' own decimal separator (also ','). "12,5" (twelve point
  // five) was then read as "125" (every comma stripped as if it were thousands grouping).
  describe('A4-1(a): comma-decimal locales whose CLDR grouping threshold is 5+ digits', () => {
    it.each(['es-ES', 'it-IT', 'pl-PL'])('parses a plain decimal correctly in %s', (locale) => {
      expect(parseDecimalInput('12,5', locale)).toBe(12.5);
      expect(parseDecimalInput('0,05', locale)).toBe(0.05);
      expect(parseDecimalInput('99,95', locale)).toBe(99.95);
    });

    it('still degroups a real thousands separator once grouping actually kicks in', () => {
      expect(parseDecimalInput('1.234,56', 'es-ES')).toBe(1234.56);
      expect(parseDecimalInput('1 234,56', 'pl-PL')).toBe(1234.56);
    });
  });
});

describe('formatDecimalInput', () => {
  it('formats a committed number back to a clean display string on blur', () => {
    expect(formatDecimalInput(12.5)).toBe('12.5');
    expect(formatDecimalInput(0.05)).toBe('0.05');
    expect(formatDecimalInput(-2.5)).toBe('-2.5');
    expect(formatDecimalInput(7)).toBe('7');
  });
  it('never returns "-0" or a non-finite string', () => {
    expect(formatDecimalInput(-0)).toBe('0');
    expect(formatDecimalInput(NaN)).toBe('0');
    expect(formatDecimalInput(Infinity)).toBe('0');
  });

  // Audit-4 finding A4-1(b): this used to be `String(n)`, always "." decimal regardless of
  // locale, so blur wrote e.g. "12.5" into a de-DE field. The next focus+blur then read that
  // locale's own "." as thousands grouping and stripped it: 12.5 -> 125.
  it('uses the field locale\'s own decimal character, so a second blur is a no-op', () => {
    for (const locale of ['de-DE', 'nl-NL', 'pt-BR', 'es-ES', 'it-IT', 'pl-PL']) {
      const formatted = formatDecimalInput(12.5, locale);
      expect(parseDecimalInput(formatted, locale), `${locale}: ${formatted}`).toBe(12.5);
      // A second round-trip (simulating focus+blur with no edit) must be stable too.
      const again = formatDecimalInput(parseDecimalInput(formatted, locale)!, locale);
      expect(parseDecimalInput(again, locale), `${locale} (2nd pass): ${again}`).toBe(12.5);
    }
  });
});

// Audit-4's suggested improvement #1: a property-based round trip for every offered locale,
// covering the exact values the audit found corrupted (a plain decimal, a small decimal, and a
// grouped thousands value), plus a two-pass focus/blur simulation for every locale in LOCALES.
describe('A4-1: locale round trip (all offered locales)', () => {
  it.each(LOCALES.map((l) => l.code))('parse(format(x, %s), %s) === x, and is stable across repeated blurs', (locale) => {
    for (const x of [12.5, 0.05, 99.95, 1234.56, 268, 7]) {
      const once = formatDecimalInput(x, locale);
      expect(parseDecimalInput(once, locale), `${locale} pass 1: ${x} -> "${once}"`).toBe(x);
      const twice = formatDecimalInput(parseDecimalInput(once, locale)!, locale);
      expect(parseDecimalInput(twice, locale), `${locale} pass 2: ${x} -> "${once}" -> "${twice}"`).toBe(x);
    }
  });
});

describe('currencyDigits', () => {
  it('knows common minor-unit exceptions', () => {
    expect(currencyDigits('JPY')).toBe(0);
    expect(currencyDigits('KWD')).toBe(3);
    expect(currencyDigits('USD')).toBe(2);
  });
});

describe('computeTotals — exclusive tax', () => {
  it('adds tax on top and sums lines to the printed total', () => {
    const doc = docWith({
      taxMode: 'exclusive',
      items: [
        { id: 'a', description: 'Design', qty: 2, unitPrice: 100, taxRate: 20, discount: 0 },
        { id: 'b', description: 'Hosting', qty: 1, unitPrice: 50, taxRate: 10, discount: 0 },
      ],
    });
    const t = computeTotals(doc);
    expect(t.subtotal).toBe(250); // 2*100 + 50
    expect(t.tax).toBeCloseTo(45, 5); // 200*0.2 + 50*0.1
    expect(t.total).toBeCloseTo(295, 5);
    expect(t.taxGroups.map((g) => g.rate).sort((a, b) => a - b)).toEqual([10, 20]);
    // lines + tax must reconcile to the printed total exactly (no drift)
    const linesSum = t.lines.reduce((s, l) => s + l.net, 0);
    expect(roundTo(linesSum + t.tax, 2)).toBe(t.total);
  });
});

describe('computeTotals — inclusive tax', () => {
  it('backs tax out of the line amount instead of adding it', () => {
    const doc = docWith({
      taxMode: 'inclusive',
      items: [{ id: 'a', description: 'Package', qty: 1, unitPrice: 120, taxRate: 20, discount: 0 }],
    });
    const t = computeTotals(doc);
    expect(t.subtotal).toBe(120);
    expect(t.lines[0].taxable).toBeCloseTo(100, 5);
    expect(t.lines[0].tax).toBeCloseTo(20, 5);
    // inclusive: total should equal subtotal (tax was already inside the price)
    expect(t.total).toBe(120);
  });
});

// Regression for the polish-pass verifier finding: the /guide/tax-inclusive-vs-exclusive/ FAQ
// used to claim the total "does not change between the two modes for the same rate," which
// contradicts the engine — the two modes treat the *same entered unit price* differently. These
// pin down the exact numbers quoted in that FAQ's rewritten answer, computed with computeTotals
// (the same function the guide's own worked-example table calls), so the page's prose can never
// drift from what the engine actually produces.
describe('computeTotals — tax-inclusive-vs-exclusive guide FAQ numbers', () => {
  it('same $100 entered price: exclusive adds tax on top (total $120), inclusive backs tax out of it (total stays $100)', () => {
    const base = { items: [{ id: 'a', description: 'Service', qty: 1, unitPrice: 100, taxRate: 20, discount: 0 }] };

    const exclusive = computeTotals(docWith({ ...base, taxMode: 'exclusive' }));
    expect(exclusive.lines[0].taxable).toBe(100);
    expect(exclusive.lines[0].tax).toBe(20);
    expect(exclusive.total).toBe(120);

    const inclusive = computeTotals(docWith({ ...base, taxMode: 'inclusive' }));
    expect(inclusive.lines[0].taxable).toBe(83.33);
    expect(inclusive.lines[0].tax).toBe(16.67);
    expect(inclusive.total).toBe(100);
  });

  it('amounts due only coincide once the price is re-entered for the mode: $120 inclusive matches the $100-exclusive total', () => {
    const doc = docWith({
      taxMode: 'inclusive',
      items: [{ id: 'a', description: 'Service', qty: 1, unitPrice: 120, taxRate: 20, discount: 0 }],
    });
    const t = computeTotals(doc);
    expect(t.lines[0].taxable).toBe(100);
    expect(t.lines[0].tax).toBe(20);
    expect(t.total).toBe(120); // matches the $100-exclusive-at-20% total above
  });
});

describe('computeTotals — discounts', () => {
  it('applies a per-line discount before tax', () => {
    const doc = docWith({
      items: [{ id: 'a', description: 'Item', qty: 1, unitPrice: 100, taxRate: 10, discount: 25 }],
    });
    const t = computeTotals(doc);
    expect(t.lines[0].lineDiscount).toBe(25);
    expect(t.lines[0].net).toBe(75);
    expect(t.lines[0].tax).toBeCloseTo(7.5, 5);
  });

  it('allocates a global percent discount proportionally and taxes the discounted amount', () => {
    const doc = docWith({
      discount: { mode: 'percent', value: 10 },
      items: [
        { id: 'a', description: 'A', qty: 1, unitPrice: 100, taxRate: 20, discount: 0 },
        { id: 'b', description: 'B', qty: 1, unitPrice: 300, taxRate: 20, discount: 0 },
      ],
    });
    const t = computeTotals(doc);
    expect(t.subtotal).toBe(400);
    expect(t.discount).toBe(40); // 10% of 400
    // tax should be computed on the discounted amount: (400-40)*0.2 = 72
    expect(t.tax).toBeCloseTo(72, 5);
    expect(t.total).toBeCloseTo(432, 5); // 400 - 40 + 72
  });

  it('caps a fixed-amount discount at the subtotal so the document cannot go negative', () => {
    const doc = docWith({
      discount: { mode: 'amount', value: 999 },
      items: [{ id: 'a', description: 'A', qty: 1, unitPrice: 50, taxRate: 0, discount: 0 }],
    });
    const t = computeTotals(doc);
    expect(t.discount).toBe(50);
    expect(t.total).toBe(0);
  });

  // Regression for the audit's P2 finding: a global discount was allocated using the full
  // subtotal (which can include negative lines, e.g. a returned item) as the denominator instead
  // of the sum of the positive lines actually being discounted. That could shrink a line's share
  // (undercharging tax) or, when a large negative line was present, push a discount share
  // negative — swelling that line's tax instead of reducing it.
  it('allocates a global discount over the positive lines only when a negative line is present', () => {
    const doc = docWith({
      discount: { mode: 'percent', value: 10 },
      items: [
        { id: 'a', description: 'A', qty: 1, unitPrice: 100, taxRate: 20, discount: 0 },
        { id: 'b', description: 'B', qty: 1, unitPrice: 50, taxRate: 0, discount: 0 },
        { id: 'c', description: 'Return', qty: 1, unitPrice: -30, taxRate: 0, discount: 0 },
      ],
    });
    const t = computeTotals(doc);
    // subtotal = 100 + 50 - 30 = 120; discount = 10% of 120 = 12.
    expect(t.subtotal).toBe(120);
    expect(t.discount).toBe(12);
    // Shared proportionally over the *positive* net (100 + 50 = 150): 8 and 4, not 10 and 2.
    expect(t.lines[0].globalDiscountShare).toBeCloseTo(8, 5);
    expect(t.lines[1].globalDiscountShare).toBeCloseTo(4, 5);
    expect(t.lines[2].globalDiscountShare).toBe(0);
    // Tax is computed on the discounted amount: (100 - 8) * 0.2 = 18.40, not 18.00.
    expect(t.tax).toBeCloseTo(18.4, 5);
    expect(t.total).toBeCloseTo(126.4, 5);
  });

  it('never allocates a negative discount share to a line when a large negative line is present', () => {
    const doc = docWith({
      discount: { mode: 'percent', value: 50 },
      items: [
        { id: 'a', description: 'A', qty: 1, unitPrice: 100, taxRate: 20, discount: 0 },
        { id: 'b', description: 'B', qty: 1, unitPrice: 100, taxRate: 20, discount: 0 },
        { id: 'c', description: 'C', qty: 1, unitPrice: 100, taxRate: 20, discount: 0 },
        { id: 'd', description: 'Return', qty: 1, unitPrice: -250, taxRate: 0, discount: 0 },
      ],
    });
    const t = computeTotals(doc);
    for (const l of t.lines) expect(l.globalDiscountShare).toBeGreaterThanOrEqual(0);
    // Each of the three equal +100 lines should show very close to the same, correctly
    // discounted tax (≈18.33) — the old bug (dividing by the full subtotal, which the large
    // negative line shrinks to 50) inflated the discount share on the first two lines to 50
    // each (tax $10.00) and pushed the third line's share negative (tax $35.00).
    for (const l of t.lines.slice(0, 3)) expect(l.tax).toBeCloseTo(18.33, 1);
  });
});

describe('computeTotals — shipping and deposit', () => {
  it('taxes shipping separately and reduces the balance by the deposit', () => {
    const doc = docWith({
      items: [{ id: 'a', description: 'A', qty: 1, unitPrice: 100, taxRate: 0, discount: 0 }],
      shipping: 20,
      shippingTaxRate: 10,
      deposit: 50,
    });
    const t = computeTotals(doc);
    expect(t.shipping).toBe(20);
    expect(t.shippingTax).toBeCloseTo(2, 5);
    expect(t.total).toBeCloseTo(122, 5); // 100 + 20 + 2
    expect(t.balanceDue).toBeCloseTo(72, 5);
  });

  it('never lets the balance due go negative when the deposit exceeds the total', () => {
    const doc = docWith({ items: [{ id: 'a', description: 'A', qty: 1, unitPrice: 10, taxRate: 0, discount: 0 }], deposit: 999 });
    const t = computeTotals(doc);
    expect(t.balanceDue).toBe(0);
  });

  it('"mark as fully paid" zeroes the balance due even without recording a matching deposit', () => {
    // Previously `paid` only added a visual stamp; the printed balance was unaffected, so a
    // paid invoice could still show an outstanding balance (audit P3 finding).
    const doc = docWith({ items: [{ id: 'a', description: 'A', qty: 1, unitPrice: 100, taxRate: 0, discount: 0 }], paid: true });
    const t = computeTotals(doc);
    expect(t.total).toBe(100);
    expect(t.balanceDue).toBe(0);
  });
});

describe('computeTotals — JPY (0-digit currency)', () => {
  it('rounds to whole units', () => {
    const doc = docWith({ currency: 'JPY', items: [{ id: 'a', description: 'A', qty: 3, unitPrice: 333.33, taxRate: 0, discount: 0 }] });
    const t = computeTotals(doc);
    expect(Number.isInteger(t.total)).toBe(true);
  });
});

describe('formatMoney / formatDate', () => {
  it('formats with the currency’s minor unit', () => {
    expect(formatMoney(1234.5, 'USD', 'en-US')).toMatch(/\$1,234\.50/);
    expect(formatMoney(1234, 'JPY', 'en-US')).not.toContain('.');
  });
});

describe('dates & terms', () => {
  it('validates ISO dates strictly, rejecting invalid calendar dates', () => {
    expect(isIsoDate('2026-02-29')).toBe(false); // 2026 is not a leap year
    expect(isIsoDate('2024-02-29')).toBe(true); // 2024 is
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('not-a-date')).toBe(false);
  });
  it('adds calendar days across month/year boundaries', () => {
    expect(addDays('2026-01-25', 10)).toBe('2026-02-04');
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
  });
  it('maps terms to day counts and due dates', () => {
    expect(termsDays('net30')).toBe(30);
    expect(termsDays('receipt')).toBe(0);
    expect(termsDays('custom')).toBeNull();
    expect(dueDateFor('2026-01-01', 'net30')).toBe('2026-01-31');
    expect(dueDateFor('2026-01-01', 'custom', '2026-06-01')).toBe('2026-06-01');
    expect(termsLabel('net14')).toBe('Net 14');
  });
});

describe('numbering', () => {
  it('produces a padded default number per type', () => {
    expect(defaultNumber('invoice', 7)).toBe('INV-0007');
    expect(defaultNumber('quote', 1)).toBe('QUO-0001');
  });
  it('increments the trailing digit run and preserves padding', () => {
    expect(incrementNumber('INV-0007')).toBe('INV-0008');
    expect(incrementNumber('2026-099')).toBe('2026-100');
    expect(incrementNumber('ACME-9')).toBe('ACME-10');
  });
  it('handles numbers with no digits gracefully', () => {
    expect(incrementNumber('INVOICE')).toBe('INVOICE-1');
    expect(incrementNumber('')).toBe('1');
  });
});

describe('docLabels', () => {
  it('gives each document type its own wording', () => {
    expect(docLabels('quote').dueLabel).toBe('Valid until');
    expect(docLabels('receipt').dueLabel).toBeNull();
    expect(docLabels('invoice').totalLabel).toBe('Total');
  });
});

describe('sanitizeDoc — never trusts input', () => {
  it('falls back to safe defaults for garbage input', () => {
    const doc = sanitizeDoc({ type: 'nope', items: 'not-an-array', discount: 'nope', currency: 'XXX' }, '2026-01-01');
    expect(doc.type).toBe('invoice');
    expect(doc.items.length).toBe(1);
    expect(doc.currency).toBe('USD');
  });
  it('clamps numeric fields and caps item count', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ id: String(i), description: 'x', qty: -5, unitPrice: 1e12, taxRate: 500, discount: -20 }));
    const doc = sanitizeDoc({ items }, '2026-01-01');
    expect(doc.items.length).toBeLessThanOrEqual(100);
    expect(doc.items[0].qty).toBeGreaterThanOrEqual(0);
    expect(doc.items[0].taxRate).toBeLessThanOrEqual(100);
  });
  it('strips unsafe logo and url values', () => {
    const doc = sanitizeDoc({ logo: 'javascript:alert(1)', payLink: 'javascript:alert(1)' });
    expect(doc.logo).toBe('');
    expect(doc.payLink).toBe('');
  });
  it('accepts a well-formed https pay link', () => {
    const doc = sanitizeDoc({ payLink: 'https://example.com/pay' });
    expect(doc.payLink).toBe('https://example.com/pay');
  });
});

// Regression for the audit's P2 finding: a saved client (or one from a JSON import) with a
// malformed `party` — e.g. `null`, from a crafted or pre-fix backup — used to be stored as-is
// and only crash later, the moment it was loaded into a document and validateDoc's `.trim()`
// calls ran on it, freezing the editor until reload.
describe('sanitizeParty', () => {
  it('never throws and always returns trimmable string fields, even for garbage input', () => {
    for (const input of [null, undefined, 'not-an-object', 42, { name: null, address: 123 }]) {
      const p = sanitizeParty(input);
      expect(() => p.name.trim()).not.toThrow();
      expect(() => p.address.trim()).not.toThrow();
      expect(p.name).toBe('');
    }
  });
  it('keeps well-formed values', () => {
    const p = sanitizeParty({ name: 'Acme', address: '1 Main St', email: 'a@acme.test', phone: '555', taxId: 'TX1' });
    expect(p).toEqual({ name: 'Acme', address: '1 Main St', email: 'a@acme.test', phone: '555', taxId: 'TX1' });
  });
});

describe('share link encode/decode round trip', () => {
  it('reproduces an equivalent document after encode → decode', () => {
    const original = docWith({
      to: { name: 'Acme Ltd', address: '1 Main St', email: 'a@acme.test', phone: '', taxId: '' },
      items: [
        { id: 'a', description: 'Consulting', qty: 3, unitPrice: 150.5, taxRate: 20, discount: 5 },
        { id: 'b', description: 'Travel', qty: 1, unitPrice: 42, taxRate: 0, discount: 0 },
      ],
      shipping: 10,
    });
    const encoded = encodeDoc(original);
    const decoded = decodeDoc(encoded, '2026-01-01');
    expect(decoded).not.toBeNull();
    expect(computeTotals(decoded!).total).toBe(computeTotals(original).total);
    expect(decoded!.to.name).toBe('Acme Ltd');
    expect(decoded!.items).toHaveLength(2);
  });

  it('returns null for garbage or empty input instead of throwing', () => {
    expect(decodeDoc('')).toBeNull();
    expect(decodeDoc('not-valid-lz-string!!')).toBeNull();
  });

  it('extracts the share param from a hash that may carry other params', () => {
    expect(shareParamFromHash('#d=abc123')).toBe('abc123');
    expect(shareParamFromHash('#other=1&d=abc123')).toBe('abc123');
    expect(shareParamFromHash('')).toBeNull();
  });

  it('preserves a literal "+" in the payload instead of turning it into a space (lz-string’s URI-safe alphabet uses "+")', () => {
    // A regression test: URLSearchParams-based parsing would corrupt this.
    expect(shareParamFromHash('#d=a+b+c')).toBe('a+b+c');
  });

  it('round-trips a document whose encoded form happens to contain a "+"', () => {
    // Build documents until encodeDoc happens to produce a '+' (lz-string output is
    // deterministic per input, so vary the description slightly until one does).
    let doc = docWith({ to: { ...defaultDoc('invoice').to, name: 'Client' } });
    let encoded = encodeDoc(doc);
    let i = 0;
    while (!encoded.includes('+') && i < 200) {
      i += 1;
      doc = docWith({ to: { ...defaultDoc('invoice').to, name: `Client ${i}` } });
      encoded = encodeDoc(doc);
    }
    expect(encoded).toContain('+');
    const hash = `#${SHARE_PARAM}=${encoded}`;
    const extracted = shareParamFromHash(hash);
    expect(extracted).toBe(encoded);
    expect(decodeDoc(extracted!)).not.toBeNull();
  });

  it('builds a share URL anchored on the page URL, stripping any existing hash', () => {
    const doc = docWith({});
    const url = buildShareUrl('https://example.com/page#old', doc);
    expect(url.startsWith('https://example.com/page#d=')).toBe(true);
  });

  it('omits a logo above the share-size limit but keeps it small logos', () => {
    const bigLogo = `data:image/png;base64,${'A'.repeat(30_000)}`;
    const doc = docWith({ logo: bigLogo });
    const decoded = decodeDoc(encodeDoc(doc))!;
    expect(decoded.logo).toBe('');
  });
});

describe('validateDoc', () => {
  it('flags missing required fields as errors', () => {
    const doc = docWith({ from: { ...defaultDoc('invoice').from, name: '' }, to: { ...defaultDoc('invoice').to, name: '' } });
    const issues = validateDoc(doc);
    expect(issues.some((i) => i.field === 'from.name' && i.level === 'error')).toBe(true);
    expect(issues.some((i) => i.field === 'to.name' && i.level === 'error')).toBe(true);
  });
  it('passes a fully filled-in document with no errors', () => {
    const doc = docWith({
      from: { ...defaultDoc('invoice').from, name: 'Me' },
      to: { ...defaultDoc('invoice').to, name: 'Client' },
      items: [newItem({ description: 'Work', qty: 1, unitPrice: 10 })],
    });
    const issues = validateDoc(doc);
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });
  it('warns when the deposit exceeds the total', () => {
    const doc = docWith({
      from: { ...defaultDoc('invoice').from, name: 'Me' },
      to: { ...defaultDoc('invoice').to, name: 'Client' },
      items: [newItem({ description: 'Work', qty: 1, unitPrice: 10 })],
      deposit: 50,
    });
    const issues = validateDoc(doc);
    expect(issues.some((i) => i.field === 'deposit' && i.level === 'warning')).toBe(true);
  });
});

describe('safety guards', () => {
  it('isSafeLogo only accepts small, well-formed data URLs', () => {
    expect(isSafeLogo('data:image/png;base64,AAAA')).toBe(true);
    expect(isSafeLogo('data:text/html;base64,AAAA')).toBe(false);
    expect(isSafeLogo('not-a-data-url')).toBe(false);
  });
  it('isSafeUrl only accepts http(s)', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('ftp://example.com')).toBe(false);
  });
  it('todayIso returns a valid ISO date', () => {
    expect(isIsoDate(todayIso())).toBe(true);
  });
});
