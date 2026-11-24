import { useCallback, useEffect, useState } from 'react';
import type { Catalog, ExtraInput, HouseTypeInput, QuoteInput, QuoteResult } from '../shared/types';
import { calculate, fetchCatalog, uid } from './api';
import { HouseTypeCard } from './components/HouseTypeCard';
import { Results } from './components/Results';

const DRAFT_KEY = 'rex-quote-draft';

const newHouseType = (n: number, panelSku = ''): HouseTypeInput => ({
  id: uid(), name: `House type ${n}`, plots: 1, panelSku, panelCount: 8,
  roofType: 'pitched_tile', orientation: 'S', arrays: 1, phase: 1,
  batterySku: null, inverterSku: null,
});

const blankQuote = (): QuoteInput => ({
  projectType: 'developer',
  project: { clientName: '', siteName: '', siteAddress: '', reference: '' },
  houseTypes: [newHouseType(1)],
  extras: [],
  discount: { type: 'percent', value: 0 },
  vatRate: 0,
});

function loadDraft(): QuoteInput {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return blankQuote();
}

export default function App() {
  const [quote, setQuote] = useState<QuoteInput>(loadDraft);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [error, setError] = useState('');

  const loadCatalog = useCallback(async (refresh = false) => {
    try {
      const c = await fetchCatalog(refresh);
      setCatalog(c);
      // Default the panel on any house type that doesn't have one yet
      const firstPanel = c.products.find((p) => p.category === 'panel')?.sku ?? '';
      setQuote((q) => ({ ...q, houseTypes: q.houseTypes.map((h) => (h.panelSku ? h : { ...h, panelSku: firstPanel })) }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  // Re-price shortly after each change, and keep a draft in the browser
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(quote)); } catch { /* ignore */ }
    if (!catalog) return;
    const t = setTimeout(() => {
      calculate(quote).then((r) => { setResult(r); setError(''); }).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [quote, catalog]);

  const setProject = (k: keyof QuoteInput['project'], v: string) =>
    setQuote((q) => ({ ...q, project: { ...q.project, [k]: v } }));
  const setHouse = (i: number, h: HouseTypeInput) =>
    setQuote((q) => ({ ...q, houseTypes: q.houseTypes.map((x, j) => (j === i ? h : x)) }));
  const setExtra = (i: number, e: ExtraInput) =>
    setQuote((q) => ({ ...q, extras: q.extras.map((x, j) => (j === i ? e : x)) }));

  const products = catalog?.products ?? [];
  const firstPanel = products.find((p) => p.category === 'panel')?.sku ?? '';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Rexperts <span>Quote Builder</span></div>
        <nav className="tabs">
          <button className="active">Solar – Developer</button>
          <button disabled title="Coming next">Solar – Residential</button>
          <button disabled title="Coming next">Solar – Commercial</button>
          <button disabled title="Coming next">EV charging</button>
        </nav>
        <button
          className="link"
          onClick={() => { if (confirm('Clear this quote and start again?')) setQuote({ ...blankQuote(), houseTypes: [newHouseType(1, firstPanel)] }); }}
        >New quote</button>
      </header>

      {error && <p className="error">{error}</p>}

      <main className="layout">
        <div className="form">
          <section className="card">
            <h2>Project</h2>
            <div className="grid">
              <label>Developer / client<input value={quote.project.clientName} onChange={(e) => setProject('clientName', e.target.value)} /></label>
              <label>Our reference<input value={quote.project.reference} onChange={(e) => setProject('reference', e.target.value)} /></label>
              <label>Site / development name<input value={quote.project.siteName} onChange={(e) => setProject('siteName', e.target.value)} /></label>
              <label>Site address<input value={quote.project.siteAddress} onChange={(e) => setProject('siteAddress', e.target.value)} /></label>
            </div>
          </section>

          <h2 className="section-title">House types</h2>
          {quote.houseTypes.map((h, i) => (
            <HouseTypeCard
              key={h.id}
              value={h}
              products={products}
              result={result?.houseTypes.find((r) => r.id === h.id)}
              onChange={(v) => setHouse(i, v)}
              onDuplicate={() => setQuote((q) => {
                const copy = { ...h, id: uid(), name: `${h.name} (copy)` };
                const hs = [...q.houseTypes];
                hs.splice(i + 1, 0, copy);
                return { ...q, houseTypes: hs };
              })}
              onRemove={quote.houseTypes.length > 1
                ? () => setQuote((q) => ({ ...q, houseTypes: q.houseTypes.filter((x) => x.id !== h.id) }))
                : undefined}
            />
          ))}
          <button
            className="add"
            onClick={() => setQuote((q) => ({ ...q, houseTypes: [...q.houseTypes, newHouseType(q.houseTypes.length + 1, firstPanel)] }))}
          >+ Add house type</button>

          <section className="card">
            <h2>Extra costs</h2>
            <p className="muted small">Enter our cost; markup is added automatically. "Per plot" items are multiplied by every plot on the site.</p>
            {quote.extras.map((x, i) => (
              <div className="extra" key={x.id}>
                <input placeholder="Description, e.g. bird mesh" value={x.description} onChange={(e) => setExtra(i, { ...x, description: e.target.value })} />
                <input type="number" min={0} step="0.01" placeholder="Cost £" value={x.unitCost || ''} onChange={(e) => setExtra(i, { ...x, unitCost: +e.target.value })} />
                <input type="number" min={0} value={x.qty} onChange={(e) => setExtra(i, { ...x, qty: +e.target.value })} />
                <select value={x.per} onChange={(e) => setExtra(i, { ...x, per: e.target.value as ExtraInput['per'] })}>
                  <option value="plot">per plot</option>
                  <option value="project">per project</option>
                </select>
                <button className="link danger" onClick={() => setQuote((q) => ({ ...q, extras: q.extras.filter((y) => y.id !== x.id) }))}>✕</button>
              </div>
            ))}
            <div className="chips">
              {['Bird mesh', 'EPS / backup switch', 'Optimisers', 'Additional cable run', 'Site survey', 'Design & SAP support'].map((d) => (
                <button key={d} className="chip" onClick={() => setQuote((q) => ({
                  ...q, extras: [...q.extras, { id: uid(), description: d, unitCost: 0, qty: 1, per: d.startsWith('Site') || d.startsWith('Design') ? 'project' : 'plot' }],
                }))}>+ {d}</button>
              ))}
              <button className="chip" onClick={() => setQuote((q) => ({ ...q, extras: [...q.extras, { id: uid(), description: '', unitCost: 0, qty: 1, per: 'plot' }] }))}>+ Custom</button>
            </div>
          </section>

          <section className="card">
            <h2>Discount &amp; VAT</h2>
            <div className="grid">
              <label>Discount
                <div className="row">
                  <input type="number" min={0} value={quote.discount.value} onChange={(e) => setQuote((q) => ({ ...q, discount: { ...q.discount, value: +e.target.value } }))} />
                  <select value={quote.discount.type} onChange={(e) => setQuote((q) => ({ ...q, discount: { ...q.discount, type: e.target.value as 'percent' | 'amount' } }))}>
                    <option value="percent">%</option>
                    <option value="amount">£</option>
                  </select>
                </div>
              </label>
              <label>VAT rate
                <select value={quote.vatRate} onChange={(e) => setQuote((q) => ({ ...q, vatRate: +e.target.value }))}>
                  <option value={0}>0% (new-build / energy-saving materials)</option>
                  <option value={5}>5%</option>
                  <option value={20}>20% (standard)</option>
                </select>
              </label>
            </div>
          </section>
        </div>

        <Results result={result} catalog={catalog} onRefresh={() => loadCatalog(true)} />
      </main>
    </div>
  );
}
