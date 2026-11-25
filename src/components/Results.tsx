import { useState } from 'react';
import type { Catalog, Line, QuoteResult } from '../../shared/types';
import { IS_STATIC, money, num } from '../api';

function LineTable({ lines, internal, multiplier }: { lines: Line[]; internal: boolean; multiplier?: number }) {
  return (
    <table className="lines">
      <thead>
        <tr>
          <th>Item</th>
          <th className="n">Qty</th>
          {internal && <th className="n">Cost</th>}
          <th className="n">Price{multiplier ? ' / plot' : ''}</th>
        </tr>
      </thead>
      <tbody>
        {lines.filter((l) => internal || l.sell !== 0).map((l, i) => (
          <tr key={i} className={l.category === 'package' ? 'pkg' : l.sell === 0 ? 'component' : ''}>
            <td>{l.description}</td>
            <td className="n">{num(l.qty)}</td>
            {internal && <td className="n muted">{l.category === 'package' ? '' : money(l.cost)}</td>}
            <td className="n">{l.sell === 0 && l.cost > 0 ? 'incl.' : money(l.sell)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Props {
  result: QuoteResult | null;
  catalog: Catalog | null;
  onRefresh: () => void;
  onUpload: (file: File) => void;
  uploading: boolean;
}

export function Results({ result, catalog, onRefresh, onUpload, uploading }: Props) {
  const [internal, setInternal] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  if (!result) return <aside className="results"><p className="muted">Calculating…</p></aside>;
  const t = result.totals;

  return (
    <aside className="results">
      <div className="results-head">
        <h2>Pricing</h2>
        <label className="toggle">
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Show costs &amp; margin
        </label>
      </div>

      <div className="kpis">
        <div><b>{num(t.plots)}</b><span>Plots</span></div>
        <div><b>{num(t.kWp, 1)}</b><span>kWp total</span></div>
        <div><b>{num(t.annualKwh / 1000, 0)} MWh</b><span>per year</span></div>
      </div>

      {result.houseTypes.map((h) => (
        <div key={h.id} className="ht">
          <button type="button" className="ht-row" onClick={() => setOpen(open === h.id ? null : h.id)}>
            <span>{open === h.id ? '▾' : '▸'} {h.name || 'Untitled'} <span className="muted">× {h.plots}</span></span>
            <span>{money(h.sellPerPlot)} <span className="muted">/ plot</span></span>
          </button>
          {open === h.id && (
            <>
              <LineTable lines={h.lines} internal={internal} multiplier={h.plots} />
              {internal && <p className="muted small">{h.inverterReason}</p>}
            </>
          )}
          <div className="ht-total"><span>{h.plots} plots</span><span>{money(h.sellTotal)}</span></div>
        </div>
      ))}

      {result.projectLines.length > 0 && (
        <div className="ht">
          <div className="ht-row static"><span>Project extras</span></div>
          <LineTable lines={result.projectLines} internal={internal} />
        </div>
      )}

      <div className="totals">
        <div><span>Subtotal</span><span>{money(t.subtotal)}</span></div>
        {t.discount > 0 && <div className="good"><span>Discount</span><span>−{money(t.discount)}</span></div>}
        <div><span>Net</span><span>{money(t.net)}</span></div>
        <div><span>VAT</span><span>{money(t.vat)}</span></div>
        <div className="grand"><span>Total</span><span>{money(t.gross)}</span></div>
        {internal && (
          <div className="internal">
            <div><span>Our cost</span><span>{money(t.cost)}</span></div>
            <div><span>Margin</span><span>{money(t.margin)} ({num(t.marginPct, 1)}%)</span></div>
          </div>
        )}
      </div>

      <h3>Supplier availability</h3>
      <table className="lines">
        <thead><tr><th>Item</th><th className="n">Need</th><th className="n">Stock</th><th></th></tr></thead>
        <tbody>
          {result.availability.map((a) => (
            <tr key={a.sku}>
              <td>{a.name}</td>
              <td className="n">{num(a.required)}</td>
              <td className="n">{a.stock === null ? '–' : num(a.stock)}</td>
              <td className={`status ${a.status}`}>
                {a.status === 'unknown' ? 'Confirm'
                  : a.status === 'in_stock' ? 'In stock'
                  : a.status === 'partial' ? `Short, ${a.leadTimeDays || '?'}d`
                  : `${a.leadTimeDays}d lead`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {catalog && (
        <div className="supplier">
          <div>
            <strong>{catalog.source}</strong>
            <span className="muted small">
              {catalog.priceDate
                ? ` · prices dated ${new Date(catalog.priceDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                : ` · loaded ${new Date(catalog.fetchedAt).toLocaleTimeString('en-GB')}`}
            </span>
          </div>
          <div className="supplier-actions">
            {!IS_STATIC && <label className="link upload">
              {uploading ? 'Uploading…' : 'Upload Midsummer price sheet'}
              <input
                type="file"
                accept=".xlsx"
                disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
              />
            </label>}
            {IS_STATIC ? <span className="muted small">Test version: prices are built in</span>
              : <button type="button" className="link" onClick={onRefresh}>Reload</button>}
          </div>
        </div>
      )}
      {result.warnings.map((w) => <p key={w} className="warn">{w}</p>)}
    </aside>
  );
}
