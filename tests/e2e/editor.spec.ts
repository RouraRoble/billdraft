import { test, expect } from '@playwright/test';

const BASE = ('/' + (process.env.BASE || '').replace(/^[\/]+|[\/]+$/g, '')).replace(/\/$/, '');

test.describe('invoice editor — primary flow', () => {
  test('add two lines with tax, share link reproduces the same total, print button exists', async ({ page }) => {
    await page.goto(BASE + '/');
    const rows = page.locator('.editor__items tbody tr');
    await expect(rows).toHaveCount(1);

    // First line: 2 × 100 @ 20% tax = 240
    await rows.nth(0).locator('input').nth(0).fill('Design work');
    await rows.nth(0).locator('input').nth(1).fill('2');
    await rows.nth(0).locator('input').nth(2).fill('100');
    await rows.nth(0).locator('input').nth(4).fill('20');

    await page.getByRole('button', { name: '+ Add line' }).click();
    await expect(rows).toHaveCount(2);

    // Second line: 1 × 50 @ 10% tax = 55
    await rows.nth(1).locator('input').nth(0).fill('Hosting');
    await rows.nth(1).locator('input').nth(1).fill('1');
    await rows.nth(1).locator('input').nth(2).fill('50');
    await rows.nth(1).locator('input').nth(4).fill('10');

    // Total should be (200 + 40) + (50 + 5) = 295.00
    const total = page.getByTestId('total').first();
    await expect(total).toContainText('295.00');

    // Print button exists (cannot assert the native dialog itself).
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();

    // Share link reproduces the same total in read-only view mode — opened the way a recipient
    // actually would, in a fresh browser tab (a same-tab, same-path, hash-only navigation is a
    // same-document navigation in real browsers and would not exercise a fresh load).
    const shareInput = page.getByTestId('share-url');
    await expect(shareInput).toHaveValue(/#d=/);
    const shareUrl = await shareInput.inputValue();

    const recipient = await page.context().newPage();
    await recipient.goto(shareUrl);
    await expect(recipient.getByText('View mode.')).toBeVisible();
    await expect(recipient.getByTestId('total').first()).toContainText('295.00');
    await expect(recipient.getByRole('button', { name: 'Print / Save as PDF' })).toBeVisible();
    await expect(recipient.getByRole('button', { name: 'Duplicate to edit' })).toBeVisible();
    await recipient.close();

    // Opening the same link while already sitting on that exact page (hash-only change, no
    // reload) must also switch to view mode — this is what the hashchange listener is for.
    await page.evaluate((url) => {
      location.hash = new URL(url).hash;
    }, shareUrl);
    await expect(page.getByText('View mode.')).toBeVisible();
    await expect(page.getByTestId('total').first()).toContainText('295.00');
  });

  test('document type tabs switch wording and preset terms', async ({ page }) => {
    await page.goto(BASE + '/');
    await expect(page.locator('.paper__doctitle')).toContainText('Invoice');
    await page.getByRole('tab', { name: 'Quote' }).click();
    await expect(page.locator('.paper__doctitle')).toContainText('Quote');
  });

  test('quote page starts on the quote type', async ({ page }) => {
    await page.goto(BASE + '/quote/');
    await expect(page.locator('.paper__doctitle')).toContainText('Quote');
  });

  test('invoice template page prefills the editor via "Use this template", in edit mode', async ({ page }) => {
    await page.goto(BASE + '/invoice-template/freelance/');
    const cta = page.getByRole('link', { name: /Use this template/i });
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute('href');
    // A template link opens `#t=<slug>` and edit mode directly — not `#d=<hash>`, which is the
    // read-only "shared link" format and used to make templates confusingly uneditable, with no
    // indication the user was even looking at a template (audit P1 finding).
    expect(href).toMatch(/#t=freelance/);
    await page.goto(href!);
    await expect(page.getByTestId('preview')).toContainText('Discovery call');
    await expect(page.getByText('View mode.')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Save document' })).toBeVisible();
    // Regression for audit finding N2: author-facing guidance ("add a numbering scheme…") must
    // never print on the client-facing document — the freelance template has no mandatory legal
    // wording, so its Notes field opens blank. The guidance instead appears only in the editor's
    // separate, non-printed hint box.
    await expect(page.getByTestId('preview')).not.toContainText(/unique sequential number/i);
    await expect(page.locator('#f-notes')).toHaveValue('');
    await expect(page.locator('.editor__hint')).toContainText(/unique sequential number/i);
  });

  test('EU reverse-charge template preloads the real "Reverse charge" statement into Notes (prints); author advice stays out of it', async ({ page }) => {
    await page.goto(BASE + '/invoice-template/eu-reverse-charge/');
    const href = await page.getByRole('link', { name: /Use this template/i }).getAttribute('href');
    await page.goto(href!);
    // Regression for audit finding N2: the EU template used to preload only meta-advice
    // ("the invoice must carry the wording…") without ever adding the actual statement. Now the
    // required document wording itself is real Notes content and prints on the invoice.
    await expect(page.locator('#f-notes')).toHaveValue(/reverse charge/i);
    await expect(page.getByTestId('preview')).toContainText(/reverse charge/i);
    // It really is editable, not a read-only shared-link view.
    await expect(page.locator('#f-notes')).toBeVisible();
    // Author-only advice (e.g. about the EC Sales List / recapitulative statement) is guidance,
    // not document wording — it must stay out of the printed Notes field and appear only in the
    // non-printed hint box.
    await expect(page.locator('#f-notes')).not.toHaveValue(/EC Sales List/i);
    await expect(page.getByTestId('preview')).not.toContainText(/EC Sales List/i);
    await expect(page.locator('.editor__hint')).toContainText(/EC Sales List/i);
  });

  test('opening a shared link, then a template, then saving does not wipe the saved-document library (P0 regression)', async ({ page }) => {
    await page.goto(BASE + '/');
    const rows = page.locator('.editor__items tbody tr');

    // Save three documents with distinct client names.
    for (const name of ['Alpha Ltd', 'Beta GmbH', 'Gamma SA']) {
      await page.locator('#to-name').fill(name);
      await page.locator('#from-name').fill('My Business');
      await rows.nth(0).locator('input').nth(0).fill('Work');
      await page.getByRole('button', { name: 'Save document' }).click();
      await page.getByRole('button', { name: 'Editor' }).click();
      await page.getByRole('button', { name: /New invoice/ }).click();
    }
    await page.getByRole('button', { name: 'Saved (3)' }).click();
    await expect(page.locator('.editor__doclist li')).toHaveCount(3);

    // Open a template (a stand-in for "opening a shared link"), duplicate it into edit mode,
    // and save — this exact sequence used to reset the whole library to 1 entry.
    await page.goto(BASE + '/invoice-template/freelance/');
    const href = await page.getByRole('link', { name: /Use this template/i }).getAttribute('href');
    await page.goto(href!);
    await page.locator('#from-name').fill('My Business');
    await page.getByRole('button', { name: 'Save document' }).click();
    await page.getByRole('button', { name: /Saved \(4\)/ }).click();
    await expect(page.locator('.editor__doclist li')).toHaveCount(4);
  });

  test('a one-line invoice prints as a single page, at the selected paper size', async ({ page }) => {
    await page.goto(BASE + '/');
    const rows = page.locator('.editor__items tbody tr');
    await page.locator('#from-name').fill('My Business');
    await page.locator('#to-name').fill('Client');
    await rows.nth(0).locator('input').nth(0).fill('One line of work');
    await rows.nth(0).locator('input').nth(2).fill('100');

    function mediaBoxSize(pdf: Buffer): [number, number] {
      const m = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
      if (!m) throw new Error('no /MediaBox found in PDF');
      return [Number(m[1]), Number(m[2])];
    }
    function pageCount(pdf: Buffer): number {
      return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    }

    await page.emulateMedia({ media: 'print' });
    const pdfA4 = await page.pdf({ preferCSSPageSize: true });
    // A4 at 72dpi is ~595 x 842pt; allow a couple of points either way for renderer rounding.
    const [wA4, hA4] = mediaBoxSize(pdfA4);
    expect(wA4).toBeGreaterThan(590);
    expect(wA4).toBeLessThan(600);
    expect(hA4).toBeGreaterThan(835);
    expect(hA4).toBeLessThan(848);
    // Previously a short invoice produced 3 pages (invoice + 2 trailing blanks) because hidden
    // chrome (header, hero, FAQ, footer…) still occupied layout height under
    // `visibility: hidden` alone (audit P1 finding) — it must now be exactly one page.
    expect(pageCount(pdfA4)).toBe(1);

    // The paper-size <select> lives in `.editor__form`, which is `.no-print` — switch back to
    // screen media to interact with it, then re-emulate print for the next PDF capture.
    await page.emulateMedia({ media: 'screen' });
    await page.locator('#f-paper').selectOption('Letter');
    // The selector's `onChange` drives `doc.paper` through Preact state into a `useEffect` that
    // rewrites the injected `#billdraft-page-size` <style> tag — an async React commit that
    // `selectOption` itself does not wait for. Wait for the style tag to actually say "letter"
    // before capturing the PDF, or this occasionally raced and captured the still-A4 stylesheet.
    await expect
      .poll(() => page.evaluate(() => document.getElementById('billdraft-page-size')?.textContent || ''))
      .toContain('letter');
    await page.emulateMedia({ media: 'print' });
    const pdfLetter = await page.pdf({ preferCSSPageSize: true });
    // Letter at 72dpi is 612 x 792pt — and must actually differ from A4's width, proving the
    // paper-size selector has an effect (it previously did nothing; @page was hardcoded to
    // `size: auto`, so the browser/OS default was used regardless of the selection).
    const [wLetter, hLetter] = mediaBoxSize(pdfLetter);
    expect(wLetter).toBeGreaterThan(605);
    expect(wLetter).toBeLessThan(618);
    expect(hLetter).toBeGreaterThan(785);
    expect(hLetter).toBeLessThan(798);
    expect(wLetter).not.toBeCloseTo(wA4, 0);
    expect(pageCount(pdfLetter)).toBe(1);
  });

  test('typing a negative unit price keeps the negative sign', async ({ page }) => {
    await page.goto(BASE + '/');
    const priceInput = page.locator('.editor__items tbody tr').nth(0).locator('input').nth(2);
    await priceInput.fill('');
    await priceInput.pressSequentially('-5');
    await expect(priceInput).toHaveValue('-5');
    await priceInput.blur();
    await expect(priceInput).toHaveValue('-5');
  });

  // Regression for the audit's P0 finding N1: real, key-by-key typing (not `fill()`, which sets
  // the whole string in one shot and never exercised the bug) into a numeric field used to
  // corrupt decimals: "12.5" landed as "512", "0.05" as "5", "-2.5" as "-2". `fill()`-only tests
  // stayed green throughout because they bypass per-keystroke `input` events entirely.
  test('keyboard-typing a decimal into the unit price field does not corrupt it, and totals reflect it', async ({ page }) => {
    await page.goto(BASE + '/');
    const rows = page.locator('.editor__items tbody tr');
    await rows.nth(0).locator('input').nth(0).fill('Item');
    const priceInput = rows.nth(0).locator('input').nth(2);
    const total = page.getByTestId('total').first();

    // "12.5" — the exact audit repro. Real key events, one at a time.
    await priceInput.click();
    await priceInput.fill('');
    await page.keyboard.type('12.5');
    await expect(priceInput).toHaveValue('12.5');
    await expect(total).toContainText('12.50');

    // "0.05"
    await priceInput.fill('');
    await page.keyboard.type('0.05');
    await expect(priceInput).toHaveValue('0.05');
    await expect(total).toContainText('0.05');

    // "-2.5" — negatives are allowed on unit price (e.g. a refund/credit line).
    await priceInput.fill('');
    await page.keyboard.type('-2.5');
    await expect(priceInput).toHaveValue('-2.5');
    await expect(total).toContainText('2.50');
    await expect(total).toContainText('-');

    // Blur normalises the field's own display to a canonical form (e.g. drops a leading zero).
    await priceInput.fill('');
    await page.keyboard.type('007.5');
    await priceInput.blur();
    await expect(priceInput).toHaveValue('7.5');
  });

  // Regression for audit-3 finding A3-1: a previous version of `parseDecimalInput` always read a
  // lone "," as the decimal separator, so on the page's default en-US locale, typing "1,500" (one
  // thousand five hundred, written the standard en-US way) silently billed $1.50 — a 1000x
  // under-bill — and "1,234.56" reformatted to "0" the moment the field lost focus. Real,
  // key-by-key typing, per the audit's method.
  test('keyboard-typing a comma-grouped thousands amount into unit price does not corrupt it (A3-1)', async ({ page }) => {
    await page.goto(BASE + '/');
    const rows = page.locator('.editor__items tbody tr');
    await rows.nth(0).locator('input').nth(0).fill('Item');
    const priceInput = rows.nth(0).locator('input').nth(2);
    const total = page.getByTestId('total').first();

    await priceInput.click();
    await priceInput.fill('');
    await page.keyboard.type('1,500');
    await expect(priceInput).toHaveValue('1,500');
    await expect(total).toContainText('1,500.00');
    await priceInput.blur();
    await expect(priceInput).toHaveValue('1500');
    await expect(total).toContainText('1,500.00');

    await priceInput.click();
    await priceInput.fill('');
    await page.keyboard.type('1,234.56');
    await expect(total).toContainText('1,234.56');
    await priceInput.blur();
    await expect(priceInput).toHaveValue('1234.56');
    await expect(total).toContainText('1,234.56');
  });

  // Regression for audit-4 finding A4-1: two distinct root causes both silently multiplied a
  // typed decimal amount by 10 or 100 in comma-decimal locales.
  //
  // Cause (a): `localeSeparators()` probed with a 4-digit number, and es-ES/it-IT/pl-PL don't
  // group 4-digit numbers (CLDR `minimumGroupingDigits: 2`), so it fell back to "," as the group
  // separator — the same character as their decimal separator. "12,5" was then read as "125".
  //
  // Cause (b): `formatDecimalInput` used `String(n)`, always a "." decimal, regardless of locale.
  // In de-DE (where "." is the *grouping* character), blur wrote "12.5" back into the field; a
  // second, edit-free focus+blur then re-read that "." as thousands grouping: 12.5 -> 125.
  test('typing a decimal in a comma-decimal locale is not corrupted (A4-1a, es-ES)', async ({ page }) => {
    await page.goto(BASE + '/');
    await page.selectOption('#f-locale', 'es-ES');
    const rows = page.locator('.editor__items tbody tr');
    await rows.nth(0).locator('input').nth(0).fill('Item');
    const priceInput = rows.nth(0).locator('input').nth(2);
    const total = page.getByTestId('total').first();

    await priceInput.click();
    await priceInput.fill('');
    await page.keyboard.type('12,5');
    await expect(priceInput).toHaveValue('12,5');
    await expect(total).toContainText('12,50');
    await priceInput.blur();
    await expect(priceInput).toHaveValue('12,5');
    await expect(total).toContainText('12,50');

    await priceInput.click();
    await priceInput.fill('');
    await page.keyboard.type('0,05');
    await expect(total).toContainText('0,05');
  });

  test('a value survives repeated focus and blur with no edit, in a "." grouping locale (A4-1b, de-DE)', async ({ page }) => {
    await page.goto(BASE + '/');
    await page.selectOption('#f-locale', 'de-DE');
    const rows = page.locator('.editor__items tbody tr');
    await rows.nth(0).locator('input').nth(0).fill('Item');
    const priceInput = rows.nth(0).locator('input').nth(2);
    const total = page.getByTestId('total').first();

    await priceInput.click();
    await priceInput.fill('');
    await page.keyboard.type('12,5');
    await priceInput.blur();
    await expect(priceInput).toHaveValue('12,5');
    await expect(total).toContainText('12,50');

    // Focus and blur again with no edit — must be a no-op.
    await priceInput.click();
    await priceInput.blur();
    await expect(priceInput).toHaveValue('12,5');
    await expect(total).toContainText('12,50');
    await priceInput.click();
    await priceInput.blur();
    await expect(priceInput).toHaveValue('12,5');
    await expect(total).toContainText('12,50');
  });

  // Regression for audit-3 finding A3-3: blur used to fall back to a hardcoded 0 whenever the
  // typed text didn't parse as a *complete* number, which included "12." — a complete value (12)
  // with nothing typed after the decimal point yet, not actually incomplete. That silently zeroed
  // out a real amount just for being left with a trailing ".".
  test('leaving a numeric field with a trailing "." commits the value typed so far, not 0 (A3-3)', async ({ page }) => {
    await page.goto(BASE + '/');
    const rows = page.locator('.editor__items tbody tr');
    await rows.nth(0).locator('input').nth(0).fill('Item');
    const priceInput = rows.nth(0).locator('input').nth(2);
    const total = page.getByTestId('total').first();

    await priceInput.click();
    await priceInput.fill('');
    await page.keyboard.type('12.');
    await expect(total).toContainText('12.00');
    await priceInput.blur();
    await expect(priceInput).toHaveValue('12');
    await expect(total).toContainText('12.00');
  });

  test('keyboard-typing decimals into quantity, discount % and tax % also commits correctly', async ({ page }) => {
    await page.goto(BASE + '/');
    const rows = page.locator('.editor__items tbody tr');
    await rows.nth(0).locator('input').nth(0).fill('Hours worked');
    const qtyInput = rows.nth(0).locator('input').nth(1);
    const priceInput = rows.nth(0).locator('input').nth(2);
    const discInput = rows.nth(0).locator('input').nth(3);
    const total = page.getByTestId('total').first();

    await priceInput.click();
    await priceInput.fill('');
    await page.keyboard.type('100');

    // 12.5 hours @ 100 = 1250.00
    await qtyInput.click();
    await qtyInput.fill('');
    await page.keyboard.type('12.5');
    await expect(qtyInput).toHaveValue('12.5');
    await expect(total).toContainText('1,250.00');

    // A 0.5% discount is a real, sub-integer percentage some businesses use.
    await discInput.click();
    await discInput.fill('');
    await page.keyboard.type('0.5');
    await expect(discInput).toHaveValue('0.5');
    // 1250 - 0.5% (6.25) = 1243.75
    await expect(total).toContainText('1,243.75');
  });

  test('/quote/, /receipt/ and /credit-note/ each start on their own type, independent of a draft on another type', async ({ page }) => {
    // Leave a draft on the home page (invoice).
    await page.goto(BASE + '/');
    await page.locator('#from-name').fill('My Business');
    await expect(page.locator('.paper__doctitle')).toContainText('Invoice');

    // Each variant page must show its own type, not the invoice draft (audit P1 finding).
    await page.goto(BASE + '/quote/');
    await expect(page.locator('.paper__doctitle')).toContainText('Quote');
    await page.goto(BASE + '/receipt/');
    await expect(page.locator('.paper__doctitle')).toContainText('Receipt');
    await page.goto(BASE + '/credit-note/');
    await expect(page.locator('.paper__doctitle')).toContainText('Credit note');

    // The invoice draft itself is unaffected.
    await page.goto(BASE + '/');
    await expect(page.locator('.paper__doctitle')).toContainText('Invoice');
    await expect(page.locator('#from-name')).toHaveValue('My Business');
  });

  // Regression for the deferred N4 finding (audit 2 + audit 3): `decodeURIComponent` on a
  // malformed `#t=` fragment throws an uncaught `URIError`, which used to abort the mount effect
  // before `setReady(true)` ran — the editor stuck forever on its loading skeleton instead of
  // just treating the fragment as an unrecognised template.
  test('a malformed "#t=" link does not crash the editor — it still renders normally (N4)', async ({ page }) => {
    for (const badHash of ['#t=%', '#t=%E0%A4%A']) {
      await page.goto(BASE + '/' + badHash);
      await expect(page.locator('.editor__items tbody tr').first().locator('input').first()).toBeVisible();
      await expect(page.locator('.editor--loading')).toHaveCount(0);
    }
  });

  test('"New invoice" keeps the business profile but clears the client and items', async ({ page }) => {
    await page.goto(BASE + '/');
    await page.locator('#from-name').fill('My Business');
    await page.locator('#from-address').fill('1 Main St');
    await page.locator('#to-name').fill('Old Client');
    await page.getByRole('button', { name: /New invoice/ }).click();
    await expect(page.locator('#from-name')).toHaveValue('My Business');
    await expect(page.locator('#from-address')).toHaveValue('1 Main St');
    await expect(page.locator('#to-name')).toHaveValue('');
  });
});
