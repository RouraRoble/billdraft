/**
 * BillDraft core: document model, totals engine, numbering, due-date terms,
 * currency formatting, validation and the URL serializer.
 *
 * Pure functions only (no DOM) so everything is unit-testable in Node.
 *
 * Rounding rule (documented on /about/): every money amount is rounded to the
 * currency's minor unit (2 dp for most, 0 for JPY, 3 for KWD) as soon as it is
 * produced — per line, per discount share, per tax line — using round-half-away-
 * from-zero on a float-noise-corrected value. Totals are sums of already-rounded
 * parts, so the printed lines always add up to the printed total.
 */
// lz-string ships CJS-only with a dynamic `module.exports = LZString` (no static named exports Node's
// ESM/CJS interop can see reliably in every runtime), so import the namespace and destructure instead.
import LZString from 'lz-string';
const { compressToEncodedURIComponent, decompressFromEncodedURIComponent } = LZString;
import { findCurrency, isKnownCurrency, isKnownLocale } from './currencies';

export type DocType = 'invoice' | 'quote' | 'receipt' | 'credit-note';
export type TaxMode = 'exclusive' | 'inclusive';
export type TemplateId = 'classic' | 'minimal' | 'bold' | 'compact';
export type PaperSize = 'A4' | 'Letter';
export type Terms = 'receipt' | 'net7' | 'net14' | 'net30' | 'net60' | 'custom';
export type DiscountMode = 'percent' | 'amount';

export interface Party {
  name: string;
  address: string;
  email: string;
  phone: string;
  taxId: string;
}

export interface LineItem {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
  /** Percent, 0–100. */
  taxRate: number;
  /** Per-line discount, percent 0–100. */
  discount: number;
}

export interface Discount {
  mode: DiscountMode;
  value: number;
}

export interface Doc {
  v: 1;
  type: DocType;
  number: string;
  reference: string;
  issueDate: string; // YYYY-MM-DD
  terms: Terms;
  dueDate: string; // YYYY-MM-DD or ''
  currency: string;
  locale: string;
  from: Party;
  to: Party;
  items: LineItem[];
  taxMode: TaxMode;
  taxLabel: string;
  discount: Discount;
  shipping: number;
  shippingTaxRate: number;
  deposit: number;
  notes: string;
  payment: string;
  payLink: string;
  paid: boolean;
  template: TemplateId;
  accent: string;
  paper: PaperSize;
  logo: string;
}

export interface LineTotals {
  id: string;
  /** qty × unit price, before any discount. */
  gross: number;
  /** Per-line discount amount. */
  lineDiscount: number;
  /** gross − lineDiscount (this is what the item row shows as "Amount"). */
  net: number;
  /** Share of the global discount allocated to this line. */
  globalDiscountShare: number;
  /** Tax base after all discounts (net of tax in inclusive mode). */
  taxable: number;
  tax: number;
}

export interface TaxGroup {
  rate: number;
  taxable: number;
  tax: number;
}

export interface Totals {
  digits: number;
  lines: LineTotals[];
  /** Sum of line amounts after per-line discounts (tax-inclusive in inclusive mode). */
  subtotal: number;
  /** Global discount amount actually applied (never exceeds subtotal). */
  discount: number;
  /** Total tax base. */
  taxable: number;
  taxGroups: TaxGroup[];
  /** Tax on items + shipping tax. */
  tax: number;
  shipping: number;
  shippingTax: number;
  total: number;
  deposit: number;
  balanceDue: number;
}

export const DOC_TYPES: DocType[] = ['invoice', 'quote', 'receipt', 'credit-note'];
export const TEMPLATES: TemplateId[] = ['classic', 'minimal', 'bold', 'compact'];
export const PAPER_SIZES: PaperSize[] = ['A4', 'Letter'];
export const TERMS: Terms[] = ['receipt', 'net7', 'net14', 'net30', 'net60', 'custom'];

export const LIMITS = {
  items: 100,
  shortText: 120,
  text: 600,
  longText: 2000,
  number: 40,
  qty: 1_000_000,
  price: 1_000_000_000,
  amount: 1_000_000_000,
  logoBytes: 400_000,
  /** Logos above this size are dropped from share links (they stay in local storage). */
  logoShareBytes: 20 * 1024,
  url: 500,
} as const;

/* ------------------------------------------------------------------ rounding */

/** Round half away from zero to `digits` decimals, after removing binary float noise. */
export function roundTo(x: number, digits = 2): number {
  if (!Number.isFinite(x)) return 0;
  const f = 10 ** digits;
  const scaled = Number((Math.abs(x) * f).toFixed(6));
  const r = Math.round(scaled) / f;
  const out = x < 0 ? -r : r;
  return Object.is(out, -0) ? 0 : out;
}

/** Minor-unit digits for a currency (falls back to Intl, then 2). */
export function currencyDigits(code: string): number {
  const known = findCurrency(code);
  if (known) return known.digits;
  try {
    const d = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
    return typeof d === 'number' ? d : 2;
  } catch {
    return 2;
  }
}

/* ------------------------------------------------------------------ totals */

function clampNum(n: unknown, min: number, max: number, fallback = 0): number {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(min, x));
}

/**
 * Compute every figure shown on the document. See file header for the rounding rule.
 * Global discounts are allocated to lines proportionally to their net amount (last
 * non-zero line absorbs the rounding remainder) so tax is computed on discounted values.
 */
export function computeTotals(doc: Doc): Totals {
  const digits = currencyDigits(doc.currency);
  const r = (x: number) => roundTo(x, digits);
  const inclusive = doc.taxMode === 'inclusive';

  const lines: LineTotals[] = doc.items.map((it) => {
    const qty = clampNum(it.qty, 0, LIMITS.qty);
    const price = clampNum(it.unitPrice, -LIMITS.price, LIMITS.price);
    const disc = clampNum(it.discount, 0, 100);
    const gross = r(qty * price);
    const lineDiscount = r(gross * (disc / 100));
    const net = r(gross - lineDiscount);
    return { id: it.id, gross, lineDiscount, net, globalDiscountShare: 0, taxable: 0, tax: 0 };
  });

  const subtotal = r(lines.reduce((s, l) => s + l.net, 0));

  // Global discount, capped at the subtotal so a document can never go negative.
  let discount = 0;
  const dv = clampNum(doc.discount?.value, 0, LIMITS.amount);
  if (doc.discount?.mode === 'percent') discount = r(subtotal * (Math.min(dv, 100) / 100));
  else discount = r(Math.min(dv, Math.max(subtotal, 0)));
  if (subtotal <= 0) discount = 0;

  // Allocate the discount across lines proportionally to the positive lines only; the last
  // positive line absorbs the rounding remainder. Dividing by `subtotal` (which can include
  // negative lines, e.g. a returned item) would shrink or invert some shares — a negative line
  // must not "soak up" part of a discount that only ever applies to what is actually being sold.
  if (discount > 0) {
    let allocated = 0;
    const positive = lines.filter((l) => l.net > 0);
    const positiveBase = r(positive.reduce((s, l) => s + l.net, 0));
    positive.forEach((l, i) => {
      const share = i === positive.length - 1 ? r(discount - allocated) : r((discount * l.net) / positiveBase);
      l.globalDiscountShare = share;
      allocated = r(allocated + share);
    });
  }

  for (const l of lines) {
    const rate = clampNum(doc.items.find((it) => it.id === l.id)?.taxRate, 0, 100);
    const amount = r(l.net - l.globalDiscountShare);
    if (inclusive) {
      l.taxable = r(amount / (1 + rate / 100));
      l.tax = r(amount - l.taxable);
    } else {
      l.taxable = amount;
      l.tax = r(amount * (rate / 100));
    }
  }

  const shipping = r(clampNum(doc.shipping, 0, LIMITS.amount));
  const shipRate = clampNum(doc.shippingTaxRate, 0, 100);
  let shippingTax = 0;
  let shippingTaxable = shipping;
  if (shipping > 0 && shipRate > 0) {
    if (inclusive) {
      shippingTaxable = r(shipping / (1 + shipRate / 100));
      shippingTax = r(shipping - shippingTaxable);
    } else {
      shippingTax = r(shipping * (shipRate / 100));
    }
  }

  // Tax groups by rate (items + shipping), sorted ascending by rate.
  const groups = new Map<number, TaxGroup>();
  const addGroup = (rate: number, taxable: number, tax: number) => {
    const g = groups.get(rate) ?? { rate, taxable: 0, tax: 0 };
    g.taxable = r(g.taxable + taxable);
    g.tax = r(g.tax + tax);
    groups.set(rate, g);
  };
  doc.items.forEach((it, i) => {
    const l = lines[i];
    if (l.taxable !== 0 || l.tax !== 0) addGroup(clampNum(it.taxRate, 0, 100), l.taxable, l.tax);
  });
  if (shipping > 0) addGroup(shipRate, shippingTaxable, shippingTax);
  const taxGroups = [...groups.values()].sort((a, b) => a.rate - b.rate);

  const itemsTax = r(lines.reduce((s, l) => s + l.tax, 0));
  const tax = r(itemsTax + shippingTax);
  const taxable = r(lines.reduce((s, l) => s + l.taxable, 0) + shippingTaxable);

  const total = inclusive ? r(subtotal - discount + shipping) : r(subtotal - discount + tax + shipping);
  const deposit = r(clampNum(doc.deposit, 0, LIMITS.amount));
  // "Mark as fully paid" used to only add a visual stamp — the printed balance/total were
  // unchanged, so a paid invoice could still show an outstanding balance due (audit P3 finding).
  const balanceDue = doc.paid ? 0 : r(Math.max(0, total - deposit));

  return { digits, lines, subtotal, discount, taxable, taxGroups, tax, shipping, shippingTax, total, deposit, balanceDue };
}

/* ------------------------------------------------------------------ formatting */

export function formatMoney(amount: number, currency: string, locale = 'en-US'): string {
  const digits = currencyDigits(currency);
  const value = roundTo(amount, digits);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(digits)}`;
  }
}

export function formatNumber(n: number, locale = 'en-US', maxDigits = 4): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: maxDigits }).format(n);
  } catch {
    return String(n);
  }
}

export function formatPercent(n: number, locale = 'en-US'): string {
  return `${formatNumber(n, locale, 3)}%`;
}

/** Format an ISO date (YYYY-MM-DD) for humans; returns '' for invalid input. */
export function formatDate(iso: string, locale = 'en-US'): string {
  if (!isIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(y, m - 1, d)),
    );
  } catch {
    return iso;
  }
}

/* ------------------------------------------------------------------ decimal input parsing */

/** A curated set of currency symbols a pasted/typed amount might carry (e.g. "$1,500.00").
 * Deliberately narrow — plain letters are never stripped, so garbage like "12a" or "abc" still
 * fails to parse instead of being silently reinterpreted. */
const CURRENCY_SYMBOLS = /[$€£¥₹₩₽¢₺₴₪]/g;

/** The decimal and thousands-grouping characters a locale's number formatting actually uses
 * (e.g. en-US: "." decimal / "," group; de-DE: "," decimal / "." group; fr-FR: "," decimal /
 * " " group). Falls back to en-US's separators for an unknown or unsupported locale.
 *
 * Fix for audit-4 finding A4-1(a): this used to probe with `formatToParts(1234.5)`, a 4-digit
 * number. Several locales (es-ES, it-IT, pl-PL, pt-PT, …) have `minimumGroupingDigits: 2` in
 * CLDR, meaning they don't insert a grouping separator until there are *5+* digits before the
 * decimal point — so `formatToParts(1234.5)` never produced a `group` part for them, and the
 * code fell back to `','`, which collided with their actual decimal separator (also `','`).
 * `parseDecimalInput` then stripped every comma as if it were thousands grouping, so "12,5"
 * (twelve point five) became 125. Probing with a 7-digit number (`1234567.5`) always crosses
 * every locale's grouping threshold, so the real group character is found. As a second, belt-
 * and-suspenders guard, a group separator that still turns out to equal the decimal separator
 * (or is missing) is treated as "no grouping" rather than silently colliding with it. */
function localeSeparators(locale: string): { decimal: string; group: string } {
  try {
    const parts = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, useGrouping: true }).formatToParts(
      1234567.5,
    );
    const decimal = parts.find((p) => p.type === 'decimal')?.value || '.';
    let group = parts.find((p) => p.type === 'group')?.value || '';
    if (!group || group === decimal) group = '';
    return { decimal, group };
  } catch {
    return { decimal: '.', group: ',' };
  }
}

function escapeForCharClass(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

/**
 * Parses a numeric field's raw *typed* string into a number, or `null` when the string is not
 * (yet) a complete, valid number: empty, a lone "-", a trailing "." / "," with nothing after it
 * (the caller should leave its state untouched in that case rather than committing anything), or
 * text that doesn't parse as a number at all.
 *
 * Which character is the decimal point and which is the thousands separator is decided by
 * `locale` (the document's own "Number format" setting, e.g. `doc.locale`) — never guessed from
 * the string alone. This is the fix for audit-3 finding A3-1: a previous version always read a
 * lone "," as the decimal separator, so on the default en-US locale "1,500" (one thousand five
 * hundred, written the standard en-US way) silently became 1.5, and "1,234.56" became 0 on blur.
 * Now, for a given locale, the *other* character (the locale's thousands-grouping separator, and
 * a plain space, and a small set of currency symbols) is stripped as formatting before parsing,
 * so "1,500" → 1500 and "$1,500.00" → 1500 in en-US, while "1.234,56" → 1234.56 in de-DE.
 *
 * This also replaced reading `e.currentTarget.value` off a *controlled* `type="number"` input and
 * writing `Number(v) || 0` straight back into its `value` prop on every keystroke. That pattern
 * was the P0 bug in audit 2: Chromium's number input reports "12" (not "12.") for the in-progress
 * text "12." the instant the "." is typed, so committing that back into the DOM value silently
 * dropped the decimal point and moved the caret — real, key-by-key typing of "12.5" produced
 * "512", not 12.5, even though `fill()`-based tests never showed it. The fix is to keep the raw
 * string the user actually typed in local component state (rendered on a `type="text"` field)
 * and only ever parse it — never write a re-derived value back into the field while it has focus.
 */
export function parseDecimalInput(raw: string, locale = 'en-US'): number | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (s === '') return null;

  const { decimal, group } = localeSeparators(locale);

  // Currency symbols, a leading "+", and any whitespace (plain-space thousands grouping, or a
  // locale's non-breaking-space grouping typed as an ordinary space) are formatting, not digits.
  s = s.replace(CURRENCY_SYMBOLS, '').replace(/^\+/, '').replace(/\s+/g, '');
  if (s === '' || s === '-') return null;

  const negative = s.startsWith('-');
  const body = negative ? s.slice(1) : s;
  if (body === '') return null;

  // Strip the locale's own grouping character wherever it appears — a real thousands separator
  // is never a digit the user meant to enter.
  const degrouped = group ? body.split(group).join('') : body;
  if (!/\d/.test(degrouped)) return null;

  // Anything left over that isn't a digit or a single occurrence of the locale's decimal
  // separator is unparseable: stray letters ("12a", "abc"), or more than one decimal point
  // ("1.2.3", or "1,234.5" misparsed under a locale where "," is also the decimal separator).
  const decimalClass = escapeForCharClass(decimal);
  if (!new RegExp(`^\\d*(?:[${decimalClass}]\\d*)?$`).test(degrouped)) return null;

  const parts = degrouped.split(decimal);
  // A trailing separator with nothing after it yet ("12.", "-2,") is still mid-keystroke —
  // committing it as a whole number is exactly the premature-commit bug from audit 2 (P0 N1).
  if (parts.length === 2 && parts[1] === '') return null;

  const numStr = (negative ? '-' : '') + (parts.length === 2 ? `${parts[0] || '0'}.${parts[1]}` : parts[0]);
  const n = Number(numStr);
  return Number.isFinite(n) ? n : null;
}

/** Canonical display string for a numeric field once editing is done (on blur), e.g. "007" → "7",
 * "1,5" (parsed to 1.5, in de-DE) → "1,5", "-0" → "0". Non-finite input falls back to "0".
 *
 * Fix for audit-4 finding A4-1(b): this used to be `String(n)`, which always produces a "."
 * decimal regardless of `locale` — so in de-DE (and nl-NL, pt-BR, …, where "." is the *grouping*
 * character), blur wrote "12.5" back into the field. That string round-trips fine while the user
 * keeps typing, but the moment the field is focused and blurred *again* with no edit at all,
 * `parseDecimalInput` reads that same locale's own "." as thousands grouping and strips it,
 * turning 12.5 into 125. The same corruption hit every value loaded from a saved draft, library
 * document, template or share link, since they're all rendered through this function. Formatting
 * with the field's own locale (no grouping, so the string stays a clean round-trip for
 * `parseDecimalInput`) keeps the displayed character consistent with what parsing expects. */
export function formatDecimalInput(n: number, locale = 'en-US'): string {
  if (!Number.isFinite(n)) return '0';
  const value = Object.is(n, -0) ? 0 : n;
  try {
    return new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 20 }).format(value);
  } catch {
    return String(value);
  }
}

/* ------------------------------------------------------------------ dates & terms */

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  if (!isIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Math.trunc(days)));
  return dt.toISOString().slice(0, 10);
}

export function termsDays(terms: Terms): number | null {
  switch (terms) {
    case 'receipt':
      return 0;
    case 'net7':
      return 7;
    case 'net14':
      return 14;
    case 'net30':
      return 30;
    case 'net60':
      return 60;
    default:
      return null;
  }
}

export function termsLabel(terms: Terms): string {
  switch (terms) {
    case 'receipt':
      return 'Due on receipt';
    case 'net7':
      return 'Net 7';
    case 'net14':
      return 'Net 14';
    case 'net30':
      return 'Net 30';
    case 'net60':
      return 'Net 60';
    default:
      return 'Custom date';
  }
}

/** Due date for an issue date and terms; custom terms keep the supplied date. */
export function dueDateFor(issueDate: string, terms: Terms, customDue = ''): string {
  const days = termsDays(terms);
  if (days === null) return isIsoDate(customDue) ? customDue : '';
  return addDays(issueDate, days);
}

/* ------------------------------------------------------------------ numbering */

export const NUMBER_PREFIX: Record<DocType, string> = {
  invoice: 'INV-',
  quote: 'QUO-',
  receipt: 'REC-',
  'credit-note': 'CN-',
};

export function defaultNumber(type: DocType, seq = 1): string {
  return `${NUMBER_PREFIX[type]}${String(seq).padStart(4, '0')}`;
}

/** Increment the trailing digit run, preserving zero padding: INV-0007 → INV-0008, 2026-099 → 2026-100. */
export function incrementNumber(n: string): string {
  const m = /^(.*?)(\d+)$/.exec(n.trim());
  if (!m) return n.trim() ? `${n.trim()}-1` : '1';
  const [, prefix, digits] = m;
  const next = String(BigInt(digits) + 1n);
  return prefix + next.padStart(digits.length, '0');
}

/* ------------------------------------------------------------------ labels */

export interface DocLabels {
  title: string;
  numberLabel: string;
  dateLabel: string;
  dueLabel: string | null;
  totalLabel: string;
  balanceLabel: string;
  partyFrom: string;
  partyTo: string;
  ctaVerb: string;
}

export function docLabels(type: DocType): DocLabels {
  switch (type) {
    case 'quote':
      return {
        title: 'Quote',
        numberLabel: 'Quote no.',
        dateLabel: 'Quote date',
        dueLabel: 'Valid until',
        totalLabel: 'Quote total',
        balanceLabel: 'Amount due on acceptance',
        partyFrom: 'From',
        partyTo: 'Prepared for',
        ctaVerb: 'quote',
      };
    case 'receipt':
      return {
        title: 'Receipt',
        numberLabel: 'Receipt no.',
        dateLabel: 'Payment date',
        dueLabel: null,
        totalLabel: 'Total paid',
        balanceLabel: 'Balance outstanding',
        partyFrom: 'Received by',
        partyTo: 'Received from',
        ctaVerb: 'receipt',
      };
    case 'credit-note':
      return {
        title: 'Credit note',
        numberLabel: 'Credit note no.',
        dateLabel: 'Issue date',
        dueLabel: null,
        totalLabel: 'Total credit',
        balanceLabel: 'Credit remaining',
        partyFrom: 'From',
        partyTo: 'Credit to',
        ctaVerb: 'credit note',
      };
    default:
      return {
        title: 'Invoice',
        numberLabel: 'Invoice no.',
        dateLabel: 'Invoice date',
        dueLabel: 'Due date',
        totalLabel: 'Total',
        balanceLabel: 'Balance due',
        partyFrom: 'From',
        partyTo: 'Bill to',
        ctaVerb: 'invoice',
      };
  }
}

/* ------------------------------------------------------------------ factories */

export function emptyParty(): Party {
  return { name: '', address: '', email: '', phone: '', taxId: '' };
}

let idCounter = 0;
export function newId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function newItem(partial: Partial<LineItem> = {}): LineItem {
  return { id: newId(), description: '', qty: 1, unitPrice: 0, taxRate: 0, discount: 0, ...partial };
}

export function defaultDoc(type: DocType = 'invoice', today = todayIso()): Doc {
  const terms: Terms = type === 'invoice' ? 'net30' : type === 'quote' ? 'net30' : 'receipt';
  return {
    v: 1,
    type,
    number: defaultNumber(type),
    reference: '',
    issueDate: today,
    terms,
    dueDate: dueDateFor(today, terms),
    currency: 'USD',
    locale: 'en-US',
    from: emptyParty(),
    to: emptyParty(),
    items: [newItem()],
    taxMode: 'exclusive',
    taxLabel: 'Tax',
    discount: { mode: 'percent', value: 0 },
    shipping: 0,
    shippingTaxRate: 0,
    deposit: 0,
    notes: '',
    payment: '',
    payLink: '',
    paid: false,
    template: 'classic',
    accent: '#0f766e',
    paper: 'A4',
    logo: '',
  };
}

/* ------------------------------------------------------------------ sanitising */

function str(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // Strip control characters except newline/tab; cap length.
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
}

/** Build a valid Party from untrusted input (JSON import, localStorage). Never throws. */
export function sanitizeParty(v: unknown): Party {
  const p = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    name: str(p.name, LIMITS.shortText),
    address: str(p.address, LIMITS.text),
    email: str(p.email, LIMITS.shortText),
    phone: str(p.phone, LIMITS.shortText),
    taxId: str(p.taxId, LIMITS.shortText),
  };
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function isSafeLogo(v: unknown): v is string {
  return typeof v === 'string' && /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= LIMITS.logoBytes;
}

export function isSafeUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > LIMITS.url) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Build a valid Doc from untrusted input (URL hash, localStorage, JSON import). Never throws. */
export function sanitizeDoc(input: unknown, today = todayIso()): Doc {
  const d = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const type = oneOf(d.type, DOC_TYPES, 'invoice');
  const base = defaultDoc(type, today);
  const issueDate = isIsoDate(d.issueDate) ? d.issueDate : today;
  const terms = oneOf(d.terms, TERMS, base.terms);
  const rawItems = Array.isArray(d.items) ? d.items.slice(0, LIMITS.items) : [];
  const items: LineItem[] = rawItems.map((raw) => {
    const it = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      id: str(it.id, 24) || newId(),
      description: str(it.description, LIMITS.text),
      qty: clampNum(it.qty, 0, LIMITS.qty, 1),
      unitPrice: clampNum(it.unitPrice, -LIMITS.price, LIMITS.price),
      taxRate: clampNum(it.taxRate, 0, 100),
      discount: clampNum(it.discount, 0, 100),
    };
  });
  const disc = (d.discount && typeof d.discount === 'object' ? d.discount : {}) as Record<string, unknown>;
  const currency = typeof d.currency === 'string' && isKnownCurrency(d.currency) ? d.currency.toUpperCase() : base.currency;
  const locale = typeof d.locale === 'string' && isKnownLocale(d.locale) ? d.locale : base.locale;
  return {
    v: 1,
    type,
    number: str(d.number, LIMITS.number) || base.number,
    reference: str(d.reference, LIMITS.shortText),
    issueDate,
    terms,
    dueDate: dueDateFor(issueDate, terms, isIsoDate(d.dueDate) ? d.dueDate : ''),
    currency,
    locale,
    from: sanitizeParty(d.from),
    to: sanitizeParty(d.to),
    items: items.length ? items : [newItem()],
    taxMode: oneOf(d.taxMode, ['exclusive', 'inclusive'] as const, 'exclusive'),
    taxLabel: str(d.taxLabel, 24) || 'Tax',
    discount: {
      mode: oneOf(disc.mode, ['percent', 'amount'] as const, 'percent'),
      value: clampNum(disc.value, 0, LIMITS.amount),
    },
    shipping: clampNum(d.shipping, 0, LIMITS.amount),
    shippingTaxRate: clampNum(d.shippingTaxRate, 0, 100),
    deposit: clampNum(d.deposit, 0, LIMITS.amount),
    notes: str(d.notes, LIMITS.longText),
    payment: str(d.payment, LIMITS.longText),
    payLink: isSafeUrl(d.payLink) ? d.payLink : '',
    paid: d.paid === true,
    template: oneOf(d.template, TEMPLATES, 'classic'),
    accent: typeof d.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.accent) ? d.accent.toLowerCase() : base.accent,
    paper: oneOf(d.paper, PAPER_SIZES, 'A4'),
    logo: isSafeLogo(d.logo) ? d.logo : '',
  };
}

/* ------------------------------------------------------------------ validation */

export interface Issue {
  field: string;
  message: string;
  level: 'error' | 'warning';
}

export function validateDoc(doc: Doc, totals: Totals = computeTotals(doc)): Issue[] {
  const issues: Issue[] = [];
  const labels = docLabels(doc.type);
  if (!doc.from.name.trim()) issues.push({ field: 'from.name', message: 'Add your business or personal name.', level: 'error' });
  if (!doc.to.name.trim()) issues.push({ field: 'to.name', message: `Add the client name under "${labels.partyTo}".`, level: 'error' });
  if (!doc.number.trim()) issues.push({ field: 'number', message: `${labels.title} number is required.`, level: 'error' });
  if (!doc.items.some((it) => it.description.trim())) issues.push({ field: 'items', message: 'Add at least one line item with a description.', level: 'error' });
  if (doc.items.some((it) => it.description.trim() && it.qty <= 0)) issues.push({ field: 'items', message: 'A line item has a quantity of 0.', level: 'warning' });
  if (doc.dueDate && doc.dueDate < doc.issueDate) issues.push({ field: 'dueDate', message: 'Due date is before the issue date.', level: 'warning' });
  if (doc.deposit > totals.total) issues.push({ field: 'deposit', message: 'Deposit is larger than the total; balance shows 0.', level: 'warning' });
  if (doc.discount.mode === 'amount' && doc.discount.value > totals.subtotal && totals.subtotal > 0)
    issues.push({ field: 'discount', message: 'Discount exceeds the subtotal and was capped.', level: 'warning' });
  if (doc.to.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(doc.to.email)) issues.push({ field: 'to.email', message: 'Client email looks invalid.', level: 'warning' });
  if (doc.from.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(doc.from.email)) issues.push({ field: 'from.email', message: 'Your email looks invalid.', level: 'warning' });
  return issues;
}

/* ------------------------------------------------------------------ serializer */

export const SHARE_PARAM = 'd';

/** Encode a document for the URL hash (`#d=…`). Logos above LIMITS.logoShareBytes are omitted. */
export function encodeDoc(doc: Doc): string {
  const copy: Doc = { ...doc, logo: doc.logo && doc.logo.length <= LIMITS.logoShareBytes ? doc.logo : '' };
  return compressToEncodedURIComponent(JSON.stringify(copy));
}

/** Decode a share string; returns null for garbage. Output is always sanitised. */
export function decodeDoc(encoded: string, today = todayIso()): Doc | null {
  if (!encoded || encoded.length > 200_000) return null;
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    return sanitizeDoc(parsed, today);
  } catch {
    return null;
  }
}

/**
 * Extract the encoded document from a URL hash like `#d=...` (tolerates other params).
 * Deliberately does NOT use URLSearchParams: lz-string's URI-safe alphabet includes `+`,
 * and URLSearchParams/form-urlencoded parsing turns every `+` into a space, silently
 * corrupting the payload so it fails to decompress.
 */
export function shareParamFromHash(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!h) return null;
  for (const part of h.split('&')) {
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    if (key === SHARE_PARAM) return eq === -1 ? '' : part.slice(eq + 1);
  }
  return null;
}

export function buildShareUrl(pageUrl: string, doc: Doc): string {
  const base = pageUrl.split('#')[0];
  return `${base}#${SHARE_PARAM}=${encodeDoc(doc)}`;
}

/** Human summary used in share text and document lists. */
export function docSummary(doc: Doc, totals: Totals = computeTotals(doc)): string {
  const l = docLabels(doc.type);
  const who = doc.to.name.trim() ? ` for ${doc.to.name.trim()}` : '';
  return `${l.title} ${doc.number}${who}: ${formatMoney(totals.total, doc.currency, doc.locale)}`;
}
