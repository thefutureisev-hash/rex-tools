import { useEffect, useState } from 'react';
import { solarPrice, type ResidentialInput, type ResidentialResult } from '../../shared/residential';
import type { Catalog, Settings } from '../../shared/types';
import { calculateResidential, money, num, uid } from '../api';
import { defaultPanel } from '../App';
import { ConfirmButton } from './ConfirmButton';

const DRAFT_KEY = 'rex-residential-draft';

const blank = (panelSku = ''): ResidentialInput => ({
  client: { name: '', address: '', phone: '', email: '' },
  reference: '',
  panelSku,
  panelCount: 8,
  roof: 'pitched',
  systemTypeId: 'standard',
  batteryKwh: 0,
  scaffoldNeeded: true,
  extras: [],
  discount: { type: 'percent', value: 0 },
  vatRate: 0,
});

function loadDraft(): ResidentialInput {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...blank(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return blank();
}

export function ResidentialQuote({ catalog, settings }: { catalog: Catalog | null; settings: Settings | null }) {
  const [q, setQ] = useState<ResidentialInput>(loadDraft);
  const [result, setResult] = useState<ResidentialResult | null>(null);
  const [error, setError] = useState('');
  const [internal, setInternal] = useState(true);

  const products = catalog?.products ?? [];
  const panels = products.filter((p) => p.category === 'panel').sort((a, b) => (a.watts ?? 0) - (b.watts ?? 0) || a.costPrice - b.costPrice);
  const rs = settings?.residential;

  // Default or repair the panel when the catalogue loads
  useEffect(() => {
    if (!catalog) return;
    if (!catalog.products.some((p) => p.sku === q.panelSku)) setQ((x) => ({ ...x, panelSku: defaultPanel(catalog.products) }));
  }, [catalog]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(q)); } catch { /* ignore */ }
    if (!catalog) return;
    const t = setTimeout(() => {
      calculateResidential(q).then((r) => { setResult(r); setError(''); }).catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, catalog]);

  const set = <K extends keyof ResidentialInput>(k: K, v: ResidentialInput[K]) => setQ((x) => ({ ...x, [k]: v }));
  const setClient = (k: keyof ResidentialInput['client'], v: string) => setQ((x) => ({ ...x, client: { ...x.client, [k]: v } }));
  const panel = products.find((p) => p.sku === q.panelSku);
  const kWp = ((panel?.watts ?? 0) * q.panelCount) / 1000;

  return (
    <main className="layout">
      <div className="form">
        {error && <p className="error">{error}</p>}
        <section className="card">
          <div className="card-head">
            <h2>Client</h2>
            <ConfirmButton label="New quote" confirmLabel="Click again to clear" onConfirm={() => setQ(blank(defaultPanel(products)))} />
          </div>
          <div className="grid">
            <label>Name<input value={q.client.name} onChange={(e) => setClient('name', e.target.value)} /></label>
            <label>Phone<input value={q.client.phone} onChange={(e) => setClient('phone', e.target.value)} /></label>
            <label className="span2">Site address<input value={q.client.address} onChange={(e) => setClient('address', e.target.value)} /></label>
            <label>Email<input value={q.client.email} onChange={(e) => setClient('email', e.target.value)} /></label>
            <label>Our reference<input value={q.reference} onChange={(e) => set('reference', e.target.value)} /></label>
          </div>
        </section>

        <section className="card">
          <h2>System</h2>
          <div className="grid">
            <label className="span2">Panel
              <select value={q.panelSku} onChange={(e) => set('panelSku', e.target.value)}>
                {panels.map((p) => <option key={p.sku} value={p.sku}>{p.brand} {p.name}</option>)}
              </select>
            </label>
            <label>Number of panels
              <input type="number" min={0} value={q.panelCount} onChange={(e) => set('panelCount', +e.target.value)} />
            </label>
            <label>System size
              <input value={`${num(kWp, 2)} kWp`} readOnly tabIndex={-1} />
            </label>
            <label>Roof
              <div className="seg">
                {(['pitched', 'flat'] as const).map((r) => (
                  <button key={r} type="button" className={q.roof === r ? 'on' : ''} onClick={() => set('roof', r)}>
                    {r === 'pitched' ? 'Pitched' : `Flat (+${Math.round((rs?.flatRoofUplift ?? 0) * 100)}%)`}
                  </button>
                ))}
              </div>
            </label>
            <label>Scaffolding
              <div className="seg">
                <button type="button" className={q.scaffoldNeeded ? 'on' : ''} onClick={() => set('scaffoldNeeded', true)}>Needed</button>
                <button type="button" className={!q.scaffoldNeeded ? 'on' : ''} onClick={() => set('scaffoldNeeded', false)}>
                  Not needed (−£{num(rs?.scaffoldDeduction ?? 0)})
                </button>
              </div>
            </label>
            <label className="span2">System type
              <select value={q.systemTypeId} onChange={(e) => set('systemTypeId', e.target.value)}>
                {(rs?.systemTypes ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}{t.solarUplift ? ` (+£${num(t.solarUplift)} solar)` : ''} · battery £{num(t.batteryPer5kWh)} per 5 kWh{t.unconfirmed ? ' · prices TBC' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>Battery
              <select value={q.batteryKwh} onChange={(e) => set('batteryKwh', +e.target.value)}>
                {[0, 5, 10, 15, 20].map((k) => <option key={k} value={k}>{k ? `${k} kWh` : 'No battery'}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="card">
          <h2>Extras</h2>
          <p className="muted small">Enter the price to the customer. Use these for non-standard works.</p>
          {q.extras.map((x, i) => (
            <div className="extra res" key={x.id}>
              <input placeholder="Description" value={x.description}
                onChange={(e) => set('extras', q.extras.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
              <input type="number" min={0} placeholder="Price £" value={x.price || ''}
                onChange={(e) => set('extras', q.extras.map((y, j) => (j === i ? { ...y, price: +e.target.value } : y)))} />
              <button className="link danger" onClick={() => set('extras', q.extras.filter((y) => y.id !== x.id))}>✕</button>
            </div>
          ))}
          <div className="chips">
            {(rs?.extrasPresets ?? []).map((x) => (
              <button key={x.description} className="chip"
                onClick={() => set('extras', [...q.extras, { id: uid(), description: x.description, price: x.price }])}>
                + {x.description}{x.price ? ` (£${num(x.price)})` : ''}
              </button>
            ))}
            <button className="chip" onClick={() => set('extras', [...q.extras, { id: uid(), description: '', price: 0 }])}>+ Custom</button>
          </div>
        </section>

        <section className="card">
          <h2>Discount &amp; VAT</h2>
          <div className="grid">
            <label>Discount
              <div className="row">
                <input type="number" min={0} value={q.discount.value} onChange={(e) => set('discount', { ...q.discount, value: +e.target.value })} />
                <select value={q.discount.type} onChange={(e) => set('discount', { ...q.discount, type: e.target.value as 'percent' | 'amount' })}>
                  <option value="percent">%</option>
                  <option value="amount">£</option>
                </select>
              </div>
            </label>
            <label>VAT rate
              <select value={q.vatRate} onChange={(e) => set('vatRate', +e.target.value)}>
                <option value={0}>0% (residential solar &amp; batteries)</option>
                <option value={20}>20% (standard)</option>
              </select>
            </label>
          </div>
        </section>

        {rs && (
          <section className="card">
            <h2>Price guide</h2>
            <p className="muted small">Solar only, from the residential model. Battery adds £{num(rs.systemTypes[0].batteryPer5kWh)} per 5 kWh.</p>
            <div className="scroll-x">
            <table className="lines guide">
              <thead><tr><th>kWp</th><th className="n">Pitched</th><th className="n">Flat</th><th className="n">Pitched + 5 kWh</th><th className="n">Pitched + 10 kWh</th></tr></thead>
              <tbody>
                {[2, 3, 4, 5, 6, 7, 8, 10].map((k) => {
                  const p = solarPrice(k, 'pitched', rs);
                  const b = rs.systemTypes[0].batteryPer5kWh;
                  return (
                    <tr key={k} className={Math.abs(k - kWp) < 0.5 ? 'hl' : ''}>
                      <td>{k}</td><td className="n">{money(p)}</td><td className="n">{money(solarPrice(k, 'flat', rs))}</td>
                      <td className="n">{money(p + b)}</td><td className="n">{money(p + 2 * b)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </section>
        )}
      </div>

      <aside className="results">
        <div className="results-head">
          <h2>Quote</h2>
          <label className="toggle">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Show cost &amp; margin
          </label>
        </div>
        {!result ? <p className="muted">Calculating…</p> : (
          <>
            <div className="kpis two">
              <div><b>{num(result.kWp, 2)} kWp</b><span>Solar</span></div>
              <div><b>{q.batteryKwh ? `${q.batteryKwh} kWh` : 'None'}</b><span>Battery</span></div>
            </div>
            <table className="lines">
              <tbody>
                {result.lines.map((l, i) => (
                  <tr key={i}><td>{l.description}</td><td className="n">{money(l.amount)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="totals">
              {result.discount > 0 && <div><span>Subtotal</span><span>{money(result.subtotal)}</span></div>}
              {result.discount > 0 && <div className="good"><span>Discount</span><span>−{money(result.discount)}</span></div>}
              <div><span>Net</span><span>{money(result.net)}</span></div>
              <div><span>VAT</span><span>{money(result.vat)}</span></div>
              <div className="grand"><span>Total</span><span>{money(result.gross)}</span></div>
              {internal && result.cost && (
                <div className="internal">
                  {result.cost.breakdown.map((c) => (
                    <div key={c.description} className="small muted"><span>{c.description}</span><span>{money(c.amount)}</span></div>
                  ))}
                  <div><span>Estimated cost</span><span>{money(result.cost.total)}</span></div>
                  <div><span>Margin</span><span>{money(result.margin ?? 0)} ({num(result.marginPct ?? 0, 1)}%)</span></div>
                </div>
              )}
            </div>

            <h3>Payment schedule</h3>
            <table className="lines">
              <tbody>
                {result.payments.map((p) => (
                  <tr key={p.label}><td>{p.pct}% · {p.label}</td><td className="n">{money(p.amount)}</td></tr>
                ))}
              </tbody>
            </table>
            {result.warnings.map((w) => <p key={w} className="warn">{w}</p>)}
          </>
        )}
      </aside>
    </main>
  );
}
