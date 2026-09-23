/**
 * BillDraft editor island: the whole product lives here.
 * Client-only state; nothing is sent to a server. See src/lib/invoice.ts for the pure logic.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  DOC_TYPES,
  TEMPLATES,
  PAPER_SIZES,
  TERMS,
  computeTotals,
  decodeDoc,
  defaultDoc,
  defaultNumber,
  docLabels,
  buildShareUrl,
  formatDecimalInput,
  formatMoney,
  isSafeLogo,
  isSafeUrl,
  LIMITS,
  newItem,
  NUMBER_PREFIX,
  parseDecimalInput,
  sanitizeDoc,
  sanitizeParty,
  shareParamFromHash,
  termsLabel,
  todayIso,
  validateDoc,
  type Doc,
  type DocType,
  type LineItem,
  type Party,
} from '../lib/invoice';
import { CURRENCIES, LOCALES } from '../lib/currencies';
import { findTemplate, templateEditorDoc } from '../lib/templates';
import InvoicePreview from './InvoicePreview';
import '../styles/editor.css';

interface Props {
  /** Which document type this page's tool starts on (home = invoice, /quote/, /receipt/, /credit-note/). */
  initialType?: DocType;
}

interface SavedDoc {
  id: string;
  updatedAt: string;
  doc: Doc;
}

interface SavedClient {
  id: string;
  name: string;
  party: Party;
}

// Draft storage is per document type (billdraft:draft:v1:invoice, :quote, ...) so that opening
// /quote/ or /receipt/ never shows whatever type was last edited on a different page — see the
// audit note on variant pages silently displaying an Invoice.
const DRAFT_KEY_PREFIX = 'billdraft:draft:v1';
const SAVED_KEY = 'billdraft:saved:v1';
const SEQ_KEY = 'billdraft:seq:v1';
const CLIENTS_KEY = 'billdraft:clients:v1';

function draftKey(type: DocType): string {
  return `${DRAFT_KEY_PREFIX}:${type}`;
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — the tool keeps working in-memory */
  }
}

/** Read-modify-write helper: always reads the current value from storage first, so a save
 * never overwrites data this component's in-memory state hasn't caught up with yet (the P0
 * cause: state that was never loaded got written back over a full library). */
function updateStoredList<T>(key: string, fallback: T[], updater: (current: T[]) => T[]): T[] {
  const current = readJSON<T[]>(key, fallback);
  const next = updater(current);
  writeJSON(key, next);
  return next;
}

function nextNumber(type: DocType): string {
  const seq = readJSON<Record<string, number>>(SEQ_KEY, {});
  const n = (seq[type] ?? 0) + 1;
  seq[type] = n;
  writeJSON(SEQ_KEY, seq);
  return defaultNumber(type, n);
}

let uid = 0;
function localId(): string {
  uid += 1;
  return `c${Date.now().toString(36)}${uid}`;
}

/**
 * A numeric field rendered as `type="text" inputmode="decimal"` (not `type="number"`), keeping
 * the raw string the user is typing in local component state and rendering that string back —
 * never a value re-derived from `doc` — while the field has focus. This is what fixes the audit's
 * P0 finding: a *controlled* `type="number"` input whose `onInput` wrote a parsed number straight
 * back into `value` on every keystroke caused Chromium to normalise "12." to "12" the instant the
 * "." was typed (its number-input value getter drops an incomplete decimal), silently turning
 * "12.5" into "512" as the next digit landed. Keeping the literal typed string as the source of
 * truth for what's rendered removes that rewrite entirely.
 *
 * `onCommit` fires on every keystroke that parses to a complete number (see `parseDecimalInput`)
 * so the totals engine stays live while typing, and again on blur so leaving the field empty
 * ("", "-") still settles to 0. Blur also reformats the field to the canonical string for the
 * committed number (`formatDecimalInput`).
 *
 * `locale` picks which character `parseDecimalInput` treats as the decimal point vs. the
 * thousands separator (see audit-3 finding A3-1) — pass the document's own `doc.locale`.
 *
 * Audit-3 finding A3-3: blur used to fall back to a hardcoded 0 whenever `parseDecimalInput`
 * returned `null`, which included "12." (a complete value — 12 — with nothing typed after the
 * decimal point yet, not actually incomplete). That silently zeroed out a real amount just for
 * being left with a trailing separator. Blur now (a) commits the value with the dangling
 * separator dropped when that's the only problem, and (b) for any other unparseable text, keeps
 * the last-committed `value` instead of discarding it — only a field that was genuinely left
 * empty (or just "-") settles to 0.
 */
function DecimalField({
  id,
  value,
  onCommit,
  locale = 'en-US',
  'aria-label': ariaLabel,
}: {
  id?: string;
  value: number;
  onCommit: (n: number) => void;
  locale?: string;
  'aria-label'?: string;
}) {
  const [raw, setRaw] = useState(() => formatDecimalInput(value, locale));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setRaw(formatDecimalInput(value, locale));
  }, [value, locale]);

  return (
    <input
      id={id}
      type="text"
      inputmode="decimal"
      autocomplete="off"
      aria-label={ariaLabel}
      value={raw}
      onFocus={() => {
        focused.current = true;
      }}
      onInput={(e) => {
        const text = e.currentTarget.value;
        setRaw(text);
        const n = parseDecimalInput(text, locale);
        if (n !== null) onCommit(n);
      }}
      onBlur={(e) => {
        focused.current = false;
        const text = e.currentTarget.value;
        const trimmed = text.trim();
        let n = parseDecimalInput(text, locale);
        if (n === null && /[.,]$/.test(trimmed)) {
          // "12.", "-2,": a complete value with a dangling separator, not an incomplete one.
          n = parseDecimalInput(trimmed.slice(0, -1), locale);
        }
        if (n === null && trimmed !== '' && trimmed !== '-') {
          // Genuinely unparseable text (a bad paste, stray letters) must not wipe out whatever
          // was already committed.
          n = value;
        }
        const committed = n ?? 0;
        onCommit(committed);
        setRaw(formatDecimalInput(committed, locale));
      }}
    />
  );
}

export default function Editor({ initialType = 'invoice' }: Props) {
  const [mode, setMode] = useState<'edit' | 'view'>('edit');
  const [doc, setDoc] = useState<Doc>(() => defaultDoc(initialType));
  const [ready, setReady] = useState(false);
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([]);
  const [clients, setClients] = useState<SavedClient[]>([]);
  const [search, setSearch] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [showQr, setShowQr] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [logoStatus, setLogoStatus] = useState('');
  const [panel, setPanel] = useState<'edit' | 'library'>('edit');
  const [shareLinkInvalid, setShareLinkInvalid] = useState(false);
  // Author-facing guidance for the template this document was opened from (e.g. "add your
  // GSTIN", "state your payment terms") — shown as a dismissible, non-printed hint in the
  // editor, never in the document's own Notes field (see the audit P1 finding on N2: mixing
  // this into Notes meant the client received the author's own how-to-invoice coaching).
  const [templateHint, setTemplateHint] = useState<{ name: string; notes: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  // Load state once we're actually in the browser (avoids SSR/hydration touching localStorage).
  // Tries the URL hash first: `#d=...` (a shared document) always wins and puts the page in
  // read-only view mode; `#t=<slug>` (a template's "Use this template" link) opens straight into
  // edit mode, pre-filled with that template's sample items and required wording.
  function tryLoadFromHash(): boolean {
    const hash = location.hash;
    if (!hash) return false;
    const h = hash.startsWith('#') ? hash.slice(1) : hash;
    for (const part of h.split('&')) {
      const eq = part.indexOf('=');
      const key = eq === -1 ? part : part.slice(0, eq);
      if (key !== 't') continue;
      // A malformed percent-encoding (e.g. "#t=%" or "#t=%E0%A4%A") throws a `URIError` out of
      // `decodeURIComponent` — uncaught, that aborts this whole function before the "no hash"
      // fallback below ever runs, so the mount effect never calls `setReady(true)` and the editor
      // is stuck on its loading skeleton forever (audit-2/3 finding N4). Treat a bad encoding the
      // same as an unknown slug: fall through and let the rest of `tryLoadFromHash` handle it.
      let slug = '';
      try {
        slug = eq === -1 ? '' : decodeURIComponent(part.slice(eq + 1));
      } catch {
        break;
      }
      const tpl = findTemplate(slug);
      if (!tpl) break;
      let next = templateEditorDoc(tpl, todayIso(), nextNumber(tpl.docType));
      // N3: opening a template used to silently overwrite whatever the visitor already had —
      // most damagingly, their own business ("From") details, which they'd typed once and
      // expect to persist across every document type. Read that type's own draft straight from
      // storage (React state for `doc` hasn't loaded it yet at this point in the mount effect)
      // and carry the same fields `startNew()` keeps — the person, not the template's sample —
      // over the template's jurisdiction-specific currency/locale/tax, which must stay intact.
      const draft = readJSON<Doc | null>(draftKey(tpl.docType), null);
      const hasProfile = draft && (draft.from?.name?.trim() || draft.from?.email?.trim() || draft.from?.address?.trim());
      if (hasProfile) {
        next = { ...next, from: draft.from, payment: draft.payment, payLink: draft.payLink, logo: draft.logo };
      }
      setDoc(next);
      setMode('edit');
      setReady(true);
      setTemplateHint(tpl.notes.length > 0 ? { name: tpl.name, notes: tpl.notes } : null);
      history.replaceState(null, '', location.pathname);
      return true;
    }
    const shared = shareParamFromHash(hash);
    if (!shared) return false;
    const decoded = decodeDoc(shared);
    if (!decoded) {
      setShareLinkInvalid(true);
      return false;
    }
    setDoc(decoded);
    setMode('view');
    setReady(true);
    return true;
  }

  useEffect(() => {
    // Always load the saved-document library and the client list first, regardless of which
    // branch below runs. Previously this happened only on the "no hash, no draft" path, so
    // opening a share link or a template and then saving would write the empty in-memory state
    // (`[]`) straight back over a non-empty library — permanently deleting every saved document
    // and client. See the audit's P0 finding.
    setSavedDocs(readJSON<SavedDoc[]>(SAVED_KEY, []));
    setClients(readJSON<SavedClient[]>(CLIENTS_KEY, []));
    if (tryLoadFromHash()) return;
    const draft = readJSON<Doc | null>(draftKey(initialType), null);
    if (draft) {
      // Continue whatever document was last being edited *for this page's type*. Draft storage
      // is per type (see draftKey) so a stored invoice draft can no longer leak onto /quote/,
      // /receipt/ or /credit-note/ and show the wrong document type there.
      setDoc(sanitizeDoc(draft));
    } else {
      setDoc({ ...defaultDoc(initialType), number: nextNumber(initialType) });
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A share link or template link opened while already sitting on that exact page (pathname
  // unchanged, only the hash differs) is a same-document navigation in the browser — it won't
  // remount this component, so pick it up here too.
  useEffect(() => {
    const onHashChange = () => {
      tryLoadFromHash();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save the working draft (edit mode only — a shared link stays read-only), keyed by the
  // document's own type so switching type tabs never clobbers another type's draft.
  useEffect(() => {
    if (!ready || mode !== 'edit') return;
    writeJSON(draftKey(doc.type), doc);
  }, [doc, ready, mode]);

  // Print A4 vs Letter: `@page` cannot read a CSS custom property or a data attribute, so the
  // only way to make the paper-size selector actually change the printed page size is to inject
  // a `<style>` element built from `doc.paper` directly. It is appended after the imported
  // stylesheets, so for the same `@page` selector it wins the cascade over editor.css's default.
  useEffect(() => {
    let styleEl = document.getElementById('billdraft-page-size') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'billdraft-page-size';
      document.head.appendChild(styleEl);
    }
    const size = doc.paper === 'Letter' ? 'letter' : 'A4';
    styleEl.textContent = `@media print { @page { size: ${size}; margin: 14mm; } }`;
  }, [doc.paper]);

  const totals = useMemo(() => computeTotals(doc), [doc]);
  const labels = useMemo(() => docLabels(doc.type), [doc.type]);
  const issues = useMemo(() => validateDoc(doc, totals), [doc, totals]);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  const shareUrl = useMemo(() => {
    if (!ready || typeof location === 'undefined') return '';
    return buildShareUrl(location.origin + location.pathname, doc);
  }, [doc, ready]);

  // QR code for the pay link — generated on demand, lazy-loaded so the base bundle stays small.
  useEffect(() => {
    let cancelled = false;
    const wantsQr = showQr || mode === 'view';
    if (!wantsQr || !isSafeUrl(doc.payLink)) {
      setQrDataUrl('');
      return;
    }
    import('qrcode').then((mod) => {
      const QRCode = mod.default ?? mod;
      // @ts-expect-error - qrcode's CJS/ESM interop shape varies by bundler
      QRCode.toDataURL(doc.payLink, { margin: 1, width: 192 }).then((url: string) => {
        if (!cancelled) setQrDataUrl(url);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [showQr, mode, doc.payLink]);

  function set<K extends keyof Doc>(key: K, value: Doc[K]) {
    setDoc((d) => ({ ...d, [key]: value }));
  }

  function setType(type: DocType) {
    setDoc((d) => {
      // Only regenerate the number if it still looks auto-assigned (unchanged prefix for its old type).
      const looksAuto = !d.number.trim() || d.number.startsWith(NUMBER_PREFIX[d.type]);
      const terms = type === 'receipt' ? 'receipt' : d.terms === 'receipt' ? 'net30' : d.terms;
      return { ...d, type, terms, number: looksAuto ? nextNumber(type) : d.number };
    });
  }

  function setParty(which: 'from' | 'to', key: keyof Party, value: string) {
    setDoc((d) => ({ ...d, [which]: { ...d[which], [key]: value } }));
  }

  function setDiscount(patch: Partial<Doc['discount']>) {
    setDoc((d) => ({ ...d, discount: { ...d.discount, ...patch } }));
  }

  function setIssueDate(value: string) {
    setDoc((d) => {
      const dueDate = d.terms === 'custom' ? d.dueDate : value; // recomputed by parent effect below via terms change too
      return { ...d, issueDate: value, dueDate };
    });
  }

  function setTerms(value: Doc['terms']) {
    setDoc((d) => ({ ...d, terms: value }));
  }

  // Keep dueDate consistent with issueDate + terms (custom terms keep their own date).
  useEffect(() => {
    if (doc.terms === 'custom') return;
    const days = { receipt: 0, net7: 7, net14: 14, net30: 30, net60: 60 }[doc.terms as 'receipt' | 'net7' | 'net14' | 'net30' | 'net60'];
    if (days === undefined) return;
    const [y, m, d] = doc.issueDate.split('-').map(Number);
    if (!y) return;
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    const computed = dt.toISOString().slice(0, 10);
    if (computed !== doc.dueDate) setDoc((cur) => ({ ...cur, dueDate: computed }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.issueDate, doc.terms]);

  function updateItem(id: string, patch: Partial<LineItem>) {
    setDoc((d) => ({ ...d, items: d.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }));
  }

  function addItem() {
    if (doc.items.length >= LIMITS.items) return;
    setDoc((d) => ({ ...d, items: [...d.items, newItem()] }));
  }

  function removeItem(id: string) {
    setDoc((d) => ({ ...d, items: d.items.length > 1 ? d.items.filter((it) => it.id !== id) : d.items }));
  }

  function duplicateFromView() {
    const copy: Doc = { ...doc, number: nextNumber(doc.type), issueDate: todayIso(), paid: false };
    setDoc(copy);
    setMode('edit');
    setTemplateHint(null);
    history.replaceState(null, '', location.pathname);
  }

  function startNew() {
    // Keep the business ("From") profile, payment instructions, look and paper size — only the
    // document itself (number, client, items, dates, notes) resets. Previously "New invoice"
    // wiped the user's own business details too, so every document had to be retyped from
    // scratch (audit P1 finding).
    setDoc((d) => ({
      ...defaultDoc(d.type),
      number: nextNumber(d.type),
      from: d.from,
      payment: d.payment,
      payLink: d.payLink,
      logo: d.logo,
      currency: d.currency,
      locale: d.locale,
      taxLabel: d.taxLabel,
      template: d.template,
      accent: d.accent,
      paper: d.paper,
    }));
    setTemplateHint(null);
  }

  function saveDocument() {
    const id = localId();
    const entry: SavedDoc = { id, updatedAt: new Date().toISOString(), doc };
    // Read-modify-write straight from storage rather than trusting `savedDocs` state, so a save
    // can never overwrite a library this component's state hasn't (or hadn't) fully loaded.
    const next = updateStoredList<SavedDoc>(SAVED_KEY, [], (current) => [entry, ...current].slice(0, 200));
    setSavedDocs(next);
    setPanel('library');
  }

  function loadDocument(entry: SavedDoc) {
    setDoc(sanitizeDoc(entry.doc));
    setMode('edit');
    setPanel('edit');
    setTemplateHint(null);
    history.replaceState(null, '', location.pathname);
  }

  function deleteDocument(id: string) {
    const next = updateStoredList<SavedDoc>(SAVED_KEY, [], (current) => current.filter((d) => d.id !== id));
    setSavedDocs(next);
  }

  function saveClient() {
    if (!doc.to.name.trim()) return;
    const id = localId();
    const entry: SavedClient = { id, name: doc.to.name.trim(), party: doc.to };
    const next = updateStoredList<SavedClient>(CLIENTS_KEY, [], (current) =>
      [entry, ...current.filter((c) => c.name.toLowerCase() !== entry.name.toLowerCase())].slice(0, 100),
    );
    setClients(next);
  }

  function loadClient(entry: SavedClient) {
    // Re-sanitised defensively: a client saved before this fix, or one that arrived via an
    // older/crafted JSON import, may have a malformed `party` (e.g. `null`) that would otherwise
    // crash validateDoc's `.trim()` calls and freeze the editor until reload (audit P2 finding).
    setDoc((d) => ({ ...d, to: sanitizeParty(entry.party) }));
  }

  function exportBackup() {
    const payload = { v: 1, exportedAt: new Date().toISOString(), documents: savedDocs, clients };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'billdraft-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

  function importBackup(file: File) {
    if (file.size > MAX_IMPORT_BYTES) {
      setImportStatus(`That file is too large to be a BillDraft backup (max ${MAX_IMPORT_BYTES / (1024 * 1024)} MB).`);
      return;
    }
    file
      .text()
      .then((text) => {
        const parsed = JSON.parse(text);
        const docs: SavedDoc[] = Array.isArray(parsed?.documents)
          ? parsed.documents
              .filter((e: unknown) => e && typeof e === 'object')
              .map((e: any) => ({ id: String(e.id || localId()), updatedAt: String(e.updatedAt || new Date().toISOString()), doc: sanitizeDoc(e.doc) }))
          : [];
        // Sanitise imported clients' `party` the same way sanitizeDoc sanitises a document's —
        // an untrusted or old backup can carry `party: null` or a malformed object, which used
        // to be stored as-is and only crash later (validateDoc's `.trim()` calls) the moment
        // someone picked that client from "Load saved client…" (audit P2 finding).
        const importedClients: SavedClient[] = Array.isArray(parsed?.clients)
          ? parsed.clients
              .filter((e: unknown) => e && typeof e === 'object')
              .map((e: any) => ({ id: String(e.id || localId()), name: String(e.name || '').slice(0, 120), party: sanitizeParty(e.party) }))
          : [];
        // Read-modify-write straight from storage — see saveDocument/saveClient for why.
        const nextDocs = updateStoredList<SavedDoc>(SAVED_KEY, [], (current) => [...docs, ...current].slice(0, 200));
        const nextClients = updateStoredList<SavedClient>(CLIENTS_KEY, [], (current) => [...importedClients, ...current].slice(0, 100));
        setSavedDocs(nextDocs);
        setClients(nextClients);
        setImportStatus(`Imported ${docs.length} document(s) and ${importedClients.length} client(s).`);
      })
      .catch(() => setImportStatus('That file could not be read as a BillDraft backup.'));
  }

  function onLogoFile(file: File | undefined) {
    if (!file) return;
    if (file.size > LIMITS.logoBytes) {
      setLogoStatus(`Logo is too large (max ${Math.round(LIMITS.logoBytes / 1024)} KB).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      if (isSafeLogo(result)) {
        set('logo', result);
        setLogoStatus('');
      } else {
        // The file.size check above only catches the raw file; base64 encoding adds ~33%, and an
        // unsupported format also fails `isSafeLogo`. Previously this branch did nothing, so a
        // borderline-sized or wrong-format logo silently never appeared with no explanation.
        setLogoStatus('That image could not be used as a logo — try a smaller PNG, JPG, WEBP, GIF or SVG.');
      }
    };
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    set('logo', '');
    setLogoStatus('');
    if (logoRef.current) logoRef.current.value = '';
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyStatus('Link copied — remember it contains this document’s data.');
    } catch {
      setCopyStatus('Select and copy the link below.');
    }
    window.setTimeout(() => setCopyStatus(''), 4000);
  }

  const filteredSaved = savedDocs.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.doc.number.toLowerCase().includes(q) || s.doc.to.name.toLowerCase().includes(q) || s.doc.type.includes(q);
  });

  if (!ready) {
    return (
      <div class="editor editor--loading" aria-busy="true">
        <div class="skeleton" style="height:420px;border-radius:12px" />
      </div>
    );
  }

  if (mode === 'view') {
    return (
      <div class="editor editor--view">
        <div class="editor__viewbar no-print">
          <p>
            <strong>View mode.</strong> This {labels.title.toLowerCase()} was opened from a shared link. Nothing here is
            editable until you duplicate it.
          </p>
          <div class="editor__viewactions">
            <button type="button" class="btn" onClick={() => window.print()}>
              Print / Save as PDF
            </button>
            <button type="button" class="btn btn--secondary" onClick={duplicateFromView}>
              Duplicate to edit
            </button>
          </div>
        </div>
        <InvoicePreview doc={doc} qrDataUrl={qrDataUrl} />
      </div>
    );
  }

  return (
    <div class="editor">
      <div class="editor__tabs no-print" role="tablist" aria-label="Document type">
        {DOC_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={doc.type === t}
            class={`editor__tab ${doc.type === t ? 'is-active' : ''}`}
            onClick={() => setType(t)}
          >
            {docLabels(t).title}
          </button>
        ))}
      </div>

      <div class="editor__layout">
        <div class="editor__form no-print">
          <div class="editor__formtabs">
            <button type="button" class={panel === 'edit' ? 'is-active' : ''} onClick={() => setPanel('edit')}>
              Editor
            </button>
            <button type="button" class={panel === 'library' ? 'is-active' : ''} onClick={() => setPanel('library')}>
              Saved ({savedDocs.length})
            </button>
          </div>

          {templateHint && (
            <div class="editor__hint" role="note">
              <div class="editor__hintbar">
                <strong>Notes for you (not printed) — {templateHint.name}</strong>
                {/* Audit-3 A3-2: `.btn--ghost` colors its text with --danger, tuned for a
                    destructive action's contrast against --bg-elevated (e.g. "Remove line"), not
                    against this box's --accent-soft background — in dark mode that combination
                    fell to 3.42:1. Dismiss isn't destructive, so it gets the neutral button style
                    instead, which paints its own opaque background and always passes AA. */}
                <button type="button" class="btn btn--secondary btn--sm" onClick={() => setTemplateHint(null)} aria-label="Dismiss template guidance">
                  Dismiss
                </button>
              </div>
              <ul>
                {templateHint.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <p class="small muted">
                This guidance is for you, the person filling this in — it never appears on the printed or shared document. Any
                wording the document itself needs (e.g. a required legal statement) has already been placed in "Notes" below.
              </p>
            </div>
          )}

          {panel === 'library' ? (
            <div class="editor__library">
              <div class="field">
                <label for="doc-search">Search saved documents</label>
                <input id="doc-search" type="search" value={search} onInput={(e) => setSearch(e.currentTarget.value)} placeholder="Number or client name" />
              </div>
              <ul class="editor__doclist">
                {filteredSaved.length === 0 && <li class="muted small">Nothing saved yet. Use "Save document" below the editor.</li>}
                {filteredSaved.map((s) => (
                  <li key={s.id}>
                    <div>
                      <strong>{s.doc.number}</strong> <span class="muted small">{docLabels(s.doc.type).title}</span>
                      <div class="muted small">{s.doc.to.name || 'No client name'} · {formatMoney(computeTotals(s.doc).total, s.doc.currency, s.doc.locale)}</div>
                    </div>
                    <div class="editor__docactions">
                      <button type="button" class="btn btn--secondary btn--sm" onClick={() => loadDocument(s)}>
                        Open
                      </button>
                      <button type="button" class="btn btn--ghost btn--sm" onClick={() => deleteDocument(s.id)} aria-label={`Delete ${s.doc.number}`}>
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div class="editor__backup">
                <button type="button" class="btn btn--secondary btn--sm" onClick={exportBackup}>
                  Export JSON backup
                </button>
                <button type="button" class="btn btn--secondary btn--sm" onClick={() => fileRef.current?.click()}>
                  Import JSON backup
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json"
                  hidden
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) importBackup(f);
                    e.currentTarget.value = '';
                  }}
                />
                {importStatus && <p class="small muted" role="status">{importStatus}</p>}
              </div>
            </div>
          ) : (
            <form class="editor__fields" onSubmit={(e) => e.preventDefault()}>
              <fieldset>
                <legend>Details</legend>
                <div class="field-row">
                  <div class="field">
                    <label for="f-number">{labels.numberLabel}</label>
                    <input id="f-number" value={doc.number} maxLength={LIMITS.number} onInput={(e) => set('number', e.currentTarget.value)} />
                  </div>
                  <div class="field">
                    <label for="f-reference">Reference (optional)</label>
                    <input id="f-reference" value={doc.reference} maxLength={LIMITS.shortText} onInput={(e) => set('reference', e.currentTarget.value)} />
                  </div>
                </div>
                <div class="field-row">
                  <div class="field">
                    <label for="f-issue">{labels.dateLabel}</label>
                    <input id="f-issue" type="date" value={doc.issueDate} onInput={(e) => setIssueDate(e.currentTarget.value)} />
                  </div>
                  <div class="field">
                    <label for="f-terms">{doc.type === 'quote' ? 'Valid for' : 'Terms'}</label>
                    <select id="f-terms" value={doc.terms} onChange={(e) => setTerms(e.currentTarget.value as Doc['terms'])}>
                      {TERMS.map((t) => (
                        <option value={t} key={t}>
                          {termsLabel(t)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {doc.terms === 'custom' && (
                    <div class="field">
                      <label for="f-due">{labels.dueLabel ?? 'Due date'}</label>
                      <input id="f-due" type="date" value={doc.dueDate} onInput={(e) => set('dueDate', e.currentTarget.value)} />
                    </div>
                  )}
                </div>
                <div class="field-row">
                  <div class="field">
                    <label for="f-currency">Currency</label>
                    <select id="f-currency" value={doc.currency} onChange={(e) => set('currency', e.currentTarget.value)}>
                      {CURRENCIES.map((c) => (
                        <option value={c.code} key={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div class="field">
                    <label for="f-locale">Number format</label>
                    <select id="f-locale" value={doc.locale} onChange={(e) => set('locale', e.currentTarget.value)}>
                      {LOCALES.map((l) => (
                        <option value={l.code} key={l.code}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </fieldset>

              <fieldset>
                <legend>{labels.partyFrom}</legend>
                <PartyFields id="from" party={doc.from} onChange={(k, v) => setParty('from', k, v)} />
              </fieldset>

              <fieldset>
                <legend>{labels.partyTo}</legend>
                <PartyFields id="to" party={doc.to} onChange={(k, v) => setParty('to', k, v)} />
                <div class="editor__clientrow">
                  {clients.length > 0 && (
                    <select
                      aria-label="Load a saved client"
                      onChange={(e) => {
                        const c = clients.find((x) => x.id === e.currentTarget.value);
                        if (c) loadClient(c);
                        e.currentTarget.value = '';
                      }}
                    >
                      <option value="">Load saved client…</option>
                      {clients.map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" class="btn btn--secondary btn--sm" onClick={saveClient} disabled={!doc.to.name.trim()}>
                    Save client
                  </button>
                </div>
              </fieldset>

              <fieldset>
                <legend>Line items</legend>
                <div class="table-wrap">
                  <table class="editor__items">
                    <thead>
                      <tr>
                        <th scope="col">Description</th>
                        <th scope="col">Qty</th>
                        <th scope="col">Unit price</th>
                        <th scope="col">Disc. %</th>
                        <th scope="col">{doc.taxLabel || 'Tax'} %</th>
                        <th scope="col"><span class="visually-hidden">Remove</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.items.map((it, idx) => (
                        <tr key={it.id}>
                          <td>
                            <label class="visually-hidden" for={`item-desc-${it.id}`}>
                              Description, line {idx + 1}
                            </label>
                            <input
                              id={`item-desc-${it.id}`}
                              value={it.description}
                              maxLength={LIMITS.text}
                              placeholder="Description"
                              onInput={(e) => updateItem(it.id, { description: e.currentTarget.value })}
                            />
                          </td>
                          <td>
                            <label class="visually-hidden" for={`item-qty-${it.id}`}>
                              Quantity, line {idx + 1}
                            </label>
                            <DecimalField
                              id={`item-qty-${it.id}`}
                              value={it.qty}
                              locale={doc.locale}
                              onCommit={(n) => updateItem(it.id, { qty: n })}
                            />
                          </td>
                          <td>
                            <label class="visually-hidden" for={`item-price-${it.id}`}>
                              Unit price, line {idx + 1}
                            </label>
                            <DecimalField
                              id={`item-price-${it.id}`}
                              value={it.unitPrice}
                              locale={doc.locale}
                              onCommit={(n) => updateItem(it.id, { unitPrice: n })}
                            />
                          </td>
                          <td>
                            <label class="visually-hidden" for={`item-disc-${it.id}`}>
                              Discount percent, line {idx + 1}
                            </label>
                            <DecimalField
                              id={`item-disc-${it.id}`}
                              value={it.discount}
                              locale={doc.locale}
                              onCommit={(n) => updateItem(it.id, { discount: n })}
                            />
                          </td>
                          <td>
                            <label class="visually-hidden" for={`item-tax-${it.id}`}>
                              Tax percent, line {idx + 1}
                            </label>
                            <DecimalField
                              id={`item-tax-${it.id}`}
                              value={it.taxRate}
                              locale={doc.locale}
                              onCommit={(n) => updateItem(it.id, { taxRate: n })}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              class="btn btn--ghost btn--sm"
                              onClick={() => removeItem(it.id)}
                              disabled={doc.items.length <= 1}
                              aria-label={`Remove line ${idx + 1}`}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" class="btn btn--secondary btn--sm" onClick={addItem} disabled={doc.items.length >= LIMITS.items}>
                  + Add line
                </button>
              </fieldset>

              <fieldset>
                <legend>Tax, discount &amp; shipping</legend>
                <div class="field-row">
                  <div class="field">
                    <label for="f-taxmode">Tax is</label>
                    <select id="f-taxmode" value={doc.taxMode} onChange={(e) => set('taxMode', e.currentTarget.value as Doc['taxMode'])}>
                      <option value="exclusive">Added on top (exclusive)</option>
                      <option value="inclusive">Included in the price (inclusive)</option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="f-taxlabel">Tax label</label>
                    <input id="f-taxlabel" value={doc.taxLabel} maxLength={24} onInput={(e) => set('taxLabel', e.currentTarget.value)} placeholder="Tax, VAT, GST…" />
                  </div>
                </div>
                <div class="field-row">
                  <div class="field">
                    <label for="f-discmode">Global discount</label>
                    <div class="field-inline">
                      <select id="f-discmode" value={doc.discount.mode} onChange={(e) => setDiscount({ mode: e.currentTarget.value as 'percent' | 'amount' })}>
                        <option value="percent">%</option>
                        <option value="amount">{doc.currency}</option>
                      </select>
                      <DecimalField
                        id="f-discvalue"
                        aria-label="Global discount value"
                        value={doc.discount.value}
                        locale={doc.locale}
                        onCommit={(n) => setDiscount({ value: n })}
                      />
                    </div>
                  </div>
                  <div class="field">
                    <label for="f-shipping">Shipping</label>
                    <DecimalField id="f-shipping" value={doc.shipping} locale={doc.locale} onCommit={(n) => set('shipping', n)} />
                  </div>
                  <div class="field">
                    <label for="f-shiptax">Shipping tax %</label>
                    <DecimalField id="f-shiptax" value={doc.shippingTaxRate} locale={doc.locale} onCommit={(n) => set('shippingTaxRate', n)} />
                  </div>
                </div>
                <div class="field-row">
                  <div class="field">
                    <label for="f-deposit">Deposit already paid</label>
                    <DecimalField id="f-deposit" value={doc.deposit} locale={doc.locale} onCommit={(n) => set('deposit', n)} />
                  </div>
                  <div class="field field--checkbox">
                    <label>
                      <input type="checkbox" checked={doc.paid} onChange={(e) => set('paid', e.currentTarget.checked)} /> Mark as fully paid (adds a "Paid" stamp)
                    </label>
                  </div>
                </div>
              </fieldset>

              <fieldset>
                <legend>Notes &amp; payment</legend>
                <div class="field">
                  <label for="f-notes">Notes</label>
                  <textarea id="f-notes" rows={2} maxLength={LIMITS.longText} value={doc.notes} onInput={(e) => set('notes', e.currentTarget.value)} />
                </div>
                <div class="field">
                  <label for="f-payment">Payment instructions (bank details, PayPal, etc.)</label>
                  <textarea id="f-payment" rows={3} maxLength={LIMITS.longText} value={doc.payment} onInput={(e) => set('payment', e.currentTarget.value)} />
                </div>
                <div class="field-row">
                  <div class="field">
                    <label for="f-paylink">Pay link (optional)</label>
                    <input id="f-paylink" type="url" placeholder="https://…" value={doc.payLink} onInput={(e) => set('payLink', e.currentTarget.value)} />
                  </div>
                  <div class="field field--checkbox">
                    <label>
                      <input type="checkbox" checked={showQr} disabled={!isSafeUrl(doc.payLink)} onChange={(e) => setShowQr(e.currentTarget.checked)} /> Show a QR code for
                      the pay link
                    </label>
                  </div>
                </div>
              </fieldset>

              <fieldset>
                <legend>Look</legend>
                <div class="field">
                  <span class="field-legend">Template</span>
                  <div class="editor__templates">
                    {TEMPLATES.map((t) => (
                      <button key={t} type="button" class={`editor__swatch ${doc.template === t ? 'is-active' : ''}`} onClick={() => set('template', t)}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div class="field-row">
                  <div class="field">
                    <label for="f-accent">Accent colour</label>
                    <input id="f-accent" type="color" value={doc.accent} onInput={(e) => set('accent', e.currentTarget.value)} />
                  </div>
                  <div class="field">
                    <label for="f-paper">Paper size</label>
                    <select id="f-paper" value={doc.paper} onChange={(e) => set('paper', e.currentTarget.value as Doc['paper'])}>
                      {PAPER_SIZES.map((p) => (
                        <option value={p} key={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div class="field">
                    <label for="f-logo">Logo (optional, stays on this device)</label>
                    <input
                      id="f-logo"
                      ref={logoRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                      onChange={(e) => onLogoFile(e.currentTarget.files?.[0])}
                    />
                    {doc.logo && (
                      <button type="button" class="btn btn--secondary btn--sm" onClick={removeLogo}>
                        Remove logo
                      </button>
                    )}
                    {logoStatus && <p class="small muted" role="status">{logoStatus}</p>}
                  </div>
                </div>
              </fieldset>
            </form>
          )}
        </div>

        <div class="editor__preview">
          <div class="editor__previewbar no-print">
            {errors.length > 0 && (
              <div role="status">
                <ul class="editor__issues">
                  {errors.map((i) => (
                    <li key={i.field}>{i.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {warnings.length > 0 && (
              <div role="status">
                <ul class="editor__issues editor__issues--warning">
                  {warnings.map((i) => (
                    <li key={i.field}>{i.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {shareLinkInvalid && (
              <p class="small editor__linkwarning" role="status">
                This shared link is incomplete or damaged, so it opened a blank document instead.
              </p>
            )}
            <div class="editor__actions">
              <button type="button" class="btn" onClick={() => window.print()}>
                Download PDF
              </button>
              <button type="button" class="btn btn--secondary" onClick={saveDocument}>
                Save document
              </button>
              <button type="button" class="btn btn--secondary" onClick={startNew}>
                New {labels.title.toLowerCase()}
              </button>
            </div>
            <div class="editor__share">
              <label for="share-url">Share this {labels.title.toLowerCase()} as a link</label>
              <div class="field-inline">
                <input id="share-url" data-testid="share-url" readonly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" class="btn btn--secondary btn--sm" onClick={copyShareLink}>
                  Copy
                </button>
              </div>
              <p class="small muted">The link encodes this document's data. Anyone with it can view it — only share it with people who should see it.</p>
              {copyStatus && <p class="small" role="status">{copyStatus}</p>}
            </div>
          </div>
          <InvoicePreview doc={doc} qrDataUrl={qrDataUrl} />
        </div>
      </div>
    </div>
  );
}

function PartyFields({ id, party, onChange }: { id: string; party: Party; onChange: (k: keyof Party, v: string) => void }) {
  return (
    <>
      <div class="field-row">
        <div class="field">
          <label for={`${id}-name`}>Name</label>
          <input id={`${id}-name`} value={party.name} maxLength={LIMITS.shortText} onInput={(e) => onChange('name', e.currentTarget.value)} />
        </div>
        <div class="field">
          <label for={`${id}-taxid`}>Tax ID (optional)</label>
          <input id={`${id}-taxid`} value={party.taxId} maxLength={LIMITS.shortText} onInput={(e) => onChange('taxId', e.currentTarget.value)} />
        </div>
      </div>
      <div class="field">
        <label for={`${id}-address`}>Address</label>
        <textarea id={`${id}-address`} rows={2} maxLength={LIMITS.text} value={party.address} onInput={(e) => onChange('address', e.currentTarget.value)} />
      </div>
      <div class="field-row">
        <div class="field">
          <label for={`${id}-email`}>Email</label>
          <input id={`${id}-email`} type="email" value={party.email} maxLength={LIMITS.shortText} onInput={(e) => onChange('email', e.currentTarget.value)} />
        </div>
        <div class="field">
          <label for={`${id}-phone`}>Phone</label>
          <input id={`${id}-phone`} type="tel" value={party.phone} maxLength={LIMITS.shortText} onInput={(e) => onChange('phone', e.currentTarget.value)} />
        </div>
      </div>
    </>
  );
}
