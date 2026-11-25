import { ORIENTATION_LABELS, ROOF_LABELS } from '../../shared/pricing';
import type { HouseTypeInput, HouseTypeResult, Orientation, Product, RoofType } from '../../shared/types';
import { num } from '../api';

interface Props {
  value: HouseTypeInput;
  products: Product[];
  result?: HouseTypeResult;
  onChange: (v: HouseTypeInput) => void;
  onRemove?: () => void;
  onDuplicate: () => void;
}

const gbp = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const stockLabel = (p: Product) =>
  p.stock === null ? '' : p.stock > 0 ? `, ${p.stock} in stock` : `, out of stock ${p.leadTimeDays}d`;
const by = <T,>(f: (x: T) => number) => (a: T, b: T) => f(a) - f(b);

export function HouseTypeCard({ value, products, result, onChange, onRemove, onDuplicate }: Props) {
  const set = <K extends keyof HouseTypeInput>(k: K, v: HouseTypeInput[K]) => onChange({ ...value, [k]: v });
  const panels = products.filter((p) => p.category === 'panel').sort(by((p) => (p.watts ?? 0) * 1e4 + p.costPrice));
  const inverters = products.filter((p) => p.category === 'inverter').sort(by((p) => (p.acKw ?? 0) * 1e4 + p.costPrice));
  const batteries = products.filter((p) => p.category === 'battery').sort(by((p) => (p.capacityKwh ?? 0) * 1e4 + p.costPrice));
  // Only offer bundles on the right phase, to keep the list manageable
  const bundles = products
    .filter((p) => p.category === 'bundle' && (p.phase === value.phase || p.sku === value.batterySku))
    .sort(by((p) => (p.acKw ?? 0) * 1e4 + (p.capacityKwh ?? 0)));

  return (
    <section className="card">
      <div className="card-head">
        <input
          className="title-input"
          value={value.name}
          placeholder="House type name"
          onChange={(e) => set('name', e.target.value)}
        />
        <div className="card-actions">
          <button type="button" className="link" onClick={onDuplicate}>Duplicate</button>
          {onRemove && <button type="button" className="link danger" onClick={onRemove}>Remove</button>}
        </div>
      </div>

      <div className="grid">
        <label>Number of plots
          <input type="number" min={0} value={value.plots} onChange={(e) => set('plots', +e.target.value)} />
        </label>
        <label>Supply
          <select value={value.phase} onChange={(e) => set('phase', +e.target.value as 1 | 3)}>
            <option value={1}>Single phase</option>
            <option value={3}>Three phase</option>
          </select>
        </label>

        <label className="span2">Panel
          <select value={value.panelSku} onChange={(e) => set('panelSku', e.target.value)}>
            {panels.map((p) => (
              <option key={p.sku} value={p.sku}>{p.brand} {p.name} ({gbp(p.costPrice)}{stockLabel(p)})</option>
            ))}
          </select>
        </label>
        <label>Panels per plot
          <input type="number" min={0} value={value.panelCount} onChange={(e) => set('panelCount', +e.target.value)} />
        </label>
        <label>Arrays (roof faces)
          <input type="number" min={1} value={value.arrays} onChange={(e) => set('arrays', Math.max(1, +e.target.value))} />
        </label>

        <label>Roof type
          <select value={value.roofType} onChange={(e) => set('roofType', e.target.value as RoofType)}>
            {Object.entries(ROOF_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>Orientation
          <select value={value.orientation} onChange={(e) => set('orientation', e.target.value as Orientation)}>
            {Object.entries(ORIENTATION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>

        <label className="span2">Battery
          <select value={value.batterySku ?? ''} onChange={(e) => set('batterySku', e.target.value || null)}>
            <option value="">No battery</option>
            {batteries.length > 0 && (
              <optgroup label="Battery only (matching hybrid inverter auto-selected)">
                {batteries.map((p) => <option key={p.sku} value={p.sku}>{p.brand} {p.name} ({gbp(p.costPrice)}{stockLabel(p)})</option>)}
              </optgroup>
            )}
            {bundles.length > 0 && (
              <optgroup label={`Inverter + battery bundles (${value.phase}-phase)`}>
                {bundles.map((p) => <option key={p.sku} value={p.sku}>{p.brand} {p.name} ({gbp(p.costPrice)})</option>)}
              </optgroup>
            )}
          </select>
        </label>
        <label className="span2">Inverter
          <select
            value={value.inverterSku ?? ''}
            disabled={products.find((p) => p.sku === value.batterySku)?.category === 'bundle'}
            onChange={(e) => set('inverterSku', e.target.value || null)}
          >
            <option value="">Auto-select</option>
            {inverters.map((p) => <option key={p.sku} value={p.sku}>{p.brand} {p.name} ({gbp(p.costPrice)})</option>)}
          </select>
        </label>
      </div>

      {result && (
        <div className="card-foot">
          <span><strong>{num(result.kWp, 2)} kWp</strong> per plot</span>
          <span>{num(result.annualKwhPerPlot)} kWh/yr</span>
          <span className="muted">
            {result.inverter
              ? `${result.inverter.category === 'bundle' ? 'Bundle: ' : value.inverterSku ? '' : 'Auto: '}${result.inverter.brand} ${result.inverter.name}`
              : 'No inverter'}
          </span>
        </div>
      )}
      {result?.warnings.map((w) => <p key={w} className="warn">{w}</p>)}
    </section>
  );
}
