/**
 * Loader + typings for src/data/templates.json (the ~14 /invoice-template/{slug}/ pages).
 * Also builds a pre-filled share-link hash so "Use this template" opens the editor populated
 * with the template's real sample data — reusing the same lz-string encoding as document sharing.
 */
import raw from '../data/templates.json';
import { defaultDoc, encodeDoc, sanitizeDoc, type Doc, type DocType, type Terms } from './invoice';

export interface TemplateSampleItem {
  description: string;
  qty: number;
  unitPrice: number;
  taxRate: number;
  discount: number;
}

export interface TemplateSource {
  label: string;
  url: string;
}

export interface InvoiceTemplate {
  slug: string;
  name: string;
  audience: string;
  docType: DocType;
  currency: string;
  locale: string;
  taxLabel: string;
  terms: Terms;
  sampleItems: TemplateSampleItem[];
  /** Guidance *to the person filling in the form* — shown on the template's landing page and as
   * a dismissible, non-printed hint in the editor. Never preloaded into the document itself. */
  notes: string[];
  /** Client-facing document wording this template's context legally requires or strongly
   * benefits from (e.g. the EU reverse-charge statement, the proforma disclaimer) — preloaded
   * into the editable Notes field, which prints on the document. Empty when nothing is required. */
  invoiceNotes: string;
  sources: TemplateSource[];
  faqs: { q: string; a: string }[];
}

export const TEMPLATES: InvoiceTemplate[] = raw as InvoiceTemplate[];

export function findTemplate(slug: string): InvoiceTemplate | undefined {
  return TEMPLATES.find((t) => t.slug === slug);
}

/** Sample totals shown in the page's data table (uses the real totals engine, not invented numbers). */
export function templateDoc(t: InvoiceTemplate, today: string): Doc {
  const base = defaultDoc(t.docType, today);
  return sanitizeDoc(
    {
      ...base,
      number: `${base.number}-SAMPLE`,
      currency: t.currency,
      locale: t.locale,
      taxLabel: t.taxLabel,
      terms: t.terms,
      items: t.sampleItems.map((it, i) => ({ id: `sample-${i}`, ...it })),
    },
    today,
  );
}

/** Hash fragment (`#d=...`) that opens the editor pre-filled with this template's sample data. */
export function templateShareHash(t: InvoiceTemplate, today: string): string {
  return encodeDoc(templateDoc(t, today));
}

/**
 * Doc used when "Use this template in the editor" opens the tool directly (via `#t=<slug>`,
 * see Editor.tsx). Unlike `templateDoc` (used only for the static sample table on the template
 * page, which needs a fixed "-SAMPLE" number and the build date so the page is reproducible),
 * this gets a real next document number and today's date, and preloads only `invoiceNotes` —
 * the template's must-have *document* wording (e.g. the EU reverse-charge statement) — into the
 * Notes field, which prints on the document.
 *
 * `notes` (the author-facing guidance — "add your GSTIN", "state your payment terms", etc.) is
 * deliberately NOT put here: it used to be joined straight into Notes, so a user who printed
 * without reading sent the client an invoice that coached them on how to write invoices, while
 * the actual required wording (e.g. "Reverse charge") never made it onto the document at all
 * (audit P1 finding). Callers that want to show that guidance in the editor as a non-printed
 * hint should read `t.notes` separately.
 */
export function templateEditorDoc(t: InvoiceTemplate, today: string, number: string): Doc {
  const base = defaultDoc(t.docType, today);
  return sanitizeDoc(
    {
      ...base,
      number,
      currency: t.currency,
      locale: t.locale,
      taxLabel: t.taxLabel,
      terms: t.terms,
      items: t.sampleItems.map((it, i) => ({ id: `t-${i}`, ...it })),
      notes: t.invoiceNotes || '',
    },
    today,
  );
}
