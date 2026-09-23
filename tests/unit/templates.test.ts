import { describe, expect, it } from 'vitest';
import { findTemplate, templateDoc, templateEditorDoc, TEMPLATES } from '../../src/lib/templates';
import { sanitizeDoc } from '../../src/lib/invoice';

describe('templateEditorDoc', () => {
  it('gets a real, non-"-SAMPLE" number and today\'s date, not the fixed build date', () => {
    const t = findTemplate('freelance')!;
    const doc = templateEditorDoc(t, '2026-09-23', 'INV-0042');
    expect(doc.number).toBe('INV-0042');
    expect(doc.number).not.toMatch(/SAMPLE/);
    expect(doc.issueDate).toBe('2026-09-23');
  });

  it('preloads only the template\'s real document wording (invoiceNotes) into the Notes field', () => {
    const t = findTemplate('eu-reverse-charge')!;
    const doc = templateEditorDoc(t, '2026-09-23', 'INV-0001');
    expect(doc.notes.length).toBeGreaterThan(0);
    expect(doc.notes).toMatch(/reverse charge/i);
    expect(doc.notes).toBe(t.invoiceNotes);
  });

  // Regression for the audit's P1 finding N2: `notes[]` holds guidance *to the author*
  // ("state your payment terms", "add your GSTIN") which used to be joined straight into the
  // client-facing Notes field and printed on the document. It must never end up there — only
  // `invoiceNotes` (real document wording, e.g. the reverse-charge statement) may.
  it('never leaks author-facing guidance (notes[]) into the printed Notes field', () => {
    for (const t of TEMPLATES) {
      const doc = templateEditorDoc(t, '2026-09-23', 'INV-0001');
      expect(doc.notes).toBe(t.invoiceNotes || '');
      for (const guidance of t.notes) {
        expect(doc.notes).not.toContain(guidance);
      }
    }
  });

  it('leaves Notes blank for templates with no mandatory document wording', () => {
    const t = findTemplate('freelance')!;
    expect(t.invoiceNotes).toBe('');
    const doc = templateEditorDoc(t, '2026-09-23', 'INV-0001');
    expect(doc.notes).toBe('');
  });

  it('produces a document that survives sanitizeDoc unchanged (round-trips through the share/localStorage path)', () => {
    for (const t of TEMPLATES) {
      const doc = templateEditorDoc(t, '2026-09-23', 'INV-0001');
      const clean = sanitizeDoc(doc, '2026-09-23');
      expect(clean.items.length).toBe(doc.items.length);
      expect(clean.notes).toBe(doc.notes);
    }
  });

  // Regression for the polish-pass verifier finding: /guide/tax-inclusive-vs-exclusive/ used to
  // claim jurisdiction templates (citing vat-uk, eu-reverse-charge) default to different tax
  // modes, but no template in templates.json sets `taxMode`, so every one silently inherits
  // defaultDoc's 'exclusive'. The guide was rewritten to say "every template starts exclusive";
  // this pins that claim down for all 14 templates and both doc-building paths (the static
  // sample table on each /invoice-template/{slug}/ page, and the editor's #t= entry point), so
  // it fails loudly if a future change makes the claim false again.
  it('every template starts in tax-exclusive mode (backs the "which mode do the templates use" guide claim)', () => {
    expect(TEMPLATES.length).toBe(14);
    for (const t of TEMPLATES) {
      expect(templateDoc(t, '2026-09-23').taxMode).toBe('exclusive');
      expect(templateEditorDoc(t, '2026-09-23', 'INV-0001').taxMode).toBe('exclusive');
    }
  });
});
