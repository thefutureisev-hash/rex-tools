import { useCallback, useEffect, useState } from 'react';
import type { Catalog, ExtraInput, Product, Settings, HouseTypeInput, QuoteInput, QuoteResult } from '../shared/types';
import { calculate, fetchCatalog, fetchSettings, uid, uploadMidsummer } from './api';
import { HouseTypeCard } from './components/HouseTypeCard';
import { ResidentialQuote } from './components/ResidentialQuote';
import { Results } from './components/Results';

const DRAFT_KEY = 'rex-quote-draft';

/**
 * Best-value panel (lowest £/W) of a domestic size, without a caveat such as
 * "only sold with mounting". 500W+ panels are too large for most house roofs.
 */
export const defaultPanel = (products: Product[]) => {
  const all = products.filter((p) => p.category === 'panel' && p.watts);
  const domestic = all.filter((p) => p.watts! <= 500);
  const panels = domestic.length ? domestic : all;
  const pool = panels.filter((p) => !p.notes).length ? panels.filter((p) => !p.notes) : panels;
  return pool.sort((a, b) => a.costPrice / a.watts! - b.costPrice / b.watts!)[0]?.sku ?? '';
};

const newHouseType = (n: number, panelSku = ''): HouseTypeInput => ({
  id: uid(), name: `House type ${n}`, plots: 1, panelSku, panelCount: 8,
  roofType: 'pitched_tile', orientation: 'S', arrays: 1, phase: 1,
  batterySku: null, inverterSku: null, dcCableMetres: 0, scaffoldPerPlot: 0,
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
    if (raw) {
      const q = JSON.parse(raw) as QuoteInput;
      // Fill in fields added since the draft was saved
      q.houseTypes = q.houseTypes.map((h) => ({ ...h, dcCableMetres: h.dcCableMetres ?? 0, scaffoldPerPlot: h.scaffoldPerPlot ?? 0 }));
      return q;
    }
  } catch { /* ignore */ }
  return blankQuote();
}

export default function App() {
  const [quote, setQuote] = useState<QuoteInput>(loadDraft);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<'developer' | 'residential'>(() => {
    try { return localStorage.getItem('rex-tab') === 'residential' ? 'residential' : 'developer'; } catch { return 'developer'; }
  });
  useEffect(() => { try { localStorage.setItem('rex-tab', tab); } catch { /* ignore */ } }, [tab]);

  const loadCatalog = useCallback(async (refresh = false) => {
    try {
      const c = await fetchCatalog(refresh);
      setCatalog(c);
      // Default the panel, and clear any choices the new price list no longer has
      const skus = new Set(c.products.map((p) => p.sku));
      const firstPanel = defaultPanel(c.products);
      setQuote((q) => ({
        ...q,
        houseTypes: q.houseTypes.map((h) => ({
          ...h,
          panelSku: skus.has(h.panelSku) ? h.panelSku : firstPanel,
          batterySku: h.batterySku && skus.has(h.batterySku) ? h.batterySku : null,
          inverterSku: h.inverterSku && skus.has(h.inverterSku) ? h.inverterSku : null,
        })),
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => { fetchSettings().then(setSettings).catch(() => {}); }, []);

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
  const firstPanel = defaultPanel(products);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Rexperts <span>Quote Builder</span></div>
        <nav className="tabs">
          <button className={tab === 'developer' ? 'active' : ''} onClick={() => setTab('developer')}>Solar – Developer</button>
          <button className={tab === 'residential' ? 'active' : ''} onClick={() => setTab('residential')}>Solar – Residential</button>
          <button disabled title="Coming next">Solar – Commercial</button>
          <button disabled title="Coming next">EV charging</button>
        </nav>
        {tab === 'developer' && (
          <button
            className="link"
            onClick={() => { if (confirm('Clear this quote and start again?')) setQuote({ ...blankQuote(), houseTypes: [newHouseType(1, firstPanel)] }); }}
          >New quote</button>
        )}
      </header>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice" onClick={() => setNotice('')}>{notice}</p>}

      {tab === 'residential' && <ResidentialQuote catalog={catalog} settings={settings} />}

      {tab === 'developer' && (
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
              {(settings?.optionalExtras ?? []).map((x) => (
                <button key={x.description} className="chip" onClick={() => setQuote((q) => ({
                  ...q, extras: [...q.extras, { id: uid(), description: x.description, unitCost: x.cost, qty: 1, per: x.per }],
                }))}>+ {x.description}{x.cost ? ` (£${x.cost}${x.per === 'plot' ? '/plot' : ''})` : ''}</button>
              ))}
              <button className="chip" onClick={() => setQuote((q) => ({ ...q, extras: [...q.extras, { id: uid(), description: '', unitCost: 0, qty: 1, per: 'plot' }] }))}>+ Custom</button>
            </div>
          </section>

          <section className="card">
            <h2>Discount &amp; VAT</h2>
            <div className="grid">
              <label>Multi-plot labour discount
                <div className="row">
                  <input
                    type="number" min={0} max={100}
                    value={quote.labourDiscountPct ?? ''}
                    placeholder={`Auto: ${result?.totals.labourDiscountPct ?? 0}%`}
                    onChange={(e) => setQuote((q) => ({ ...q, labourDiscountPct: e.target.value === '' ? null : +e.target.value }))}
                  />
                  <span className="unit">%</span>
                </div>
              </label>
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

        <Results
          result={result}
          catalog={catalog}
          onRefresh={() => loadCatalog(true)}
          uploading={uploading}
          onUpload={async (file) => {
            setUploading(true);
            try {
              const s = await uploadMidsummer(file);
              setNotice(`Midsummer prices${s.priceDate ? ` dated ${s.priceDate}` : ''} loaded: ${s.panels} panels, ${s.inverters} inverters, ${s.batteries} batteries, ${s.bundles} inverter + battery bundle options.`);
              setError('');
              await loadCatalog(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setUploading(false);
            }
          }}
        />
      </main>
      )}
    </div>
  );
}
