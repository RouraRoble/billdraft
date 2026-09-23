/**
 * The printable "paper" — pure presentation, no state of its own.
 * Shared by the live editor preview and the read-only shared-link view.
 * Layout differs per `doc.template` (classic / minimal / bold / compact), all via CSS classes.
 */
import { computeTotals, docLabels, formatDate, formatMoney, type Doc } from '../lib/invoice';

interface Props {
  doc: Doc;
  qrDataUrl?: string;
}

export default function InvoicePreview({ doc, qrDataUrl }: Props) {
  const totals = computeTotals(doc);
  const labels = docLabels(doc.type);
  const style = { '--doc-accent': doc.accent } as Record<string, string>;

  return (
    <div
      class={`paper paper--${doc.template} paper--${doc.paper.toLowerCase()}`}
      style={style}
      data-testid="preview"
    >
      {doc.paid && <div class="paper__stamp" aria-hidden="true">Paid</div>}
      <header class="paper__head">
        <div class="paper__brand">
          {doc.logo ? <img src={doc.logo} alt="" class="paper__logo" /> : null}
          <div>
            <p class="paper__doctitle">{labels.title}</p>
            <p class="paper__number">{doc.number || '—'}</p>
          </div>
        </div>
        <div class="paper__meta">
          <dl>
            <div>
              <dt>{labels.dateLabel}</dt>
              <dd>{formatDate(doc.issueDate, doc.locale) || '—'}</dd>
            </div>
            {labels.dueLabel && doc.dueDate ? (
              <div>
                <dt>{labels.dueLabel}</dt>
                <dd>{formatDate(doc.dueDate, doc.locale)}</dd>
              </div>
            ) : null}
            {doc.reference ? (
              <div>
                <dt>Reference</dt>
                <dd>{doc.reference}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </header>

      <section class="paper__parties">
        <div>
          <p class="paper__label">{labels.partyFrom}</p>
          <p class="paper__party-name">{doc.from.name || '—'}</p>
          {doc.from.address && <p class="paper__party-line">{doc.from.address}</p>}
          {doc.from.email && <p class="paper__party-line">{doc.from.email}</p>}
          {doc.from.phone && <p class="paper__party-line">{doc.from.phone}</p>}
          {doc.from.taxId && <p class="paper__party-line">Tax ID: {doc.from.taxId}</p>}
        </div>
        <div>
          <p class="paper__label">{labels.partyTo}</p>
          <p class="paper__party-name">{doc.to.name || '—'}</p>
          {doc.to.address && <p class="paper__party-line">{doc.to.address}</p>}
          {doc.to.email && <p class="paper__party-line">{doc.to.email}</p>}
          {doc.to.phone && <p class="paper__party-line">{doc.to.phone}</p>}
          {doc.to.taxId && <p class="paper__party-line">Tax ID: {doc.to.taxId}</p>}
        </div>
      </section>

      <div class="table-wrap">
        <table class="paper__items">
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col" class="num">Qty</th>
              <th scope="col" class="num">Unit price</th>
              {doc.items.some((i) => i.discount > 0) && <th scope="col" class="num">Discount</th>}
              {doc.items.some((i) => i.taxRate > 0) && <th scope="col" class="num">{doc.taxLabel || 'Tax'}</th>}
              <th scope="col" class="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {totals.lines.map((l, i) => {
              const it = doc.items[i];
              if (!it) return null;
              return (
                <tr key={l.id}>
                  <td>{it.description || '—'}</td>
                  <td class="num">{it.qty}</td>
                  <td class="num">{formatMoney(it.unitPrice, doc.currency, doc.locale)}</td>
                  {doc.items.some((i2) => i2.discount > 0) && <td class="num">{it.discount ? `${it.discount}%` : '—'}</td>}
                  {doc.items.some((i2) => i2.taxRate > 0) && <td class="num">{it.taxRate ? `${it.taxRate}%` : '—'}</td>}
                  <td class="num">{formatMoney(l.net, doc.currency, doc.locale)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section class="paper__totals">
        <dl>
          <div>
            <dt>Subtotal</dt>
            <dd>{formatMoney(totals.subtotal, doc.currency, doc.locale)}</dd>
          </div>
          {totals.discount > 0 && (
            <div>
              <dt>Discount</dt>
              <dd>−{formatMoney(totals.discount, doc.currency, doc.locale)}</dd>
            </div>
          )}
          {/* A rate-0 group with no tax (an untaxed line, or shipping with no shipping tax) adds
              a "Tax (0%) $0.00" row that looks amateurish on the common case of a plain,
              entirely untaxed invoice — hide it when it's the *only* group (nothing to give it
              context). Keep it when it sits alongside a genuinely taxed group, since then it's
              informative (e.g. "which line is the exempt one"). */}
          {totals.taxGroups
            .filter((g) => g.rate > 0 || g.tax !== 0 || totals.taxGroups.length > 1)
            .map((g) => (
            <div key={g.rate}>
              <dt>
                {doc.taxLabel || 'Tax'} ({g.rate}%){doc.taxMode === 'inclusive' ? ' incl.' : ''}
              </dt>
              <dd>{formatMoney(g.tax, doc.currency, doc.locale)}</dd>
            </div>
          ))}
          {totals.shipping > 0 && (
            <div>
              <dt>Shipping</dt>
              <dd>{formatMoney(totals.shipping, doc.currency, doc.locale)}</dd>
            </div>
          )}
          <div class="paper__total-row" aria-live="polite">
            <dt>{labels.totalLabel}</dt>
            <dd data-testid="total">{formatMoney(totals.total, doc.currency, doc.locale)}</dd>
          </div>
          {totals.deposit > 0 && (
            <>
              <div>
                <dt>Deposit paid</dt>
                <dd>−{formatMoney(totals.deposit, doc.currency, doc.locale)}</dd>
              </div>
              <div class="paper__balance-row">
                <dt>{labels.balanceLabel}</dt>
                <dd>{formatMoney(totals.balanceDue, doc.currency, doc.locale)}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      {(doc.notes || doc.payment || qrDataUrl) && (
        <section class="paper__footer">
          {doc.notes && (
            <div>
              <p class="paper__label">Notes</p>
              <p class="paper__pre">{doc.notes}</p>
            </div>
          )}
          {(doc.payment || qrDataUrl) && (
            <div class="paper__payment">
              {doc.payment && (
                <div>
                  <p class="paper__label">Payment instructions</p>
                  <p class="paper__pre">{doc.payment}</p>
                </div>
              )}
              {qrDataUrl && (
                <div class="paper__qr">
                  <img src={qrDataUrl} alt="QR code to the payment link" width="96" height="96" />
                  <p class="small muted">Scan to pay</p>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
