import { priceQuote, round2 } from './pricing';
import type { Catalog, Settings } from './types';

/**
 * Residential solar uses REX's fixed selling-price model (from the
 * "Dynamic Residential Solar Price Generator" spreadsheet), not cost-plus.
 * A cost estimate from the developer engine is shown alongside, internally,
 * to check the margin.
 */

export type ResidentialRoof = 'pitched' | 'flat';

export interface ResidentialSystemType {
  id: string;
  label: string;
  /** Added to the solar price, before rounding */
  solarUplift: number;
  batteryPer5kWh: number;
  /** Shown as a warning while the figures are placeholders */
  unconfirmed?: boolean;
}

export interface ResidentialSettings {
  /** [kWp, £] anchor packages for a pitched roof, solar only */
  anchors: [number, number][];
  /** £ per kWp below the first anchor */
  belowPerKwp: number;
  /** £ per kWp above the last anchor */
  abovePerKwp: number;
  flatRoofUplift: number;
  /** Prices round to the nearest £100, minus this (5 → £x,x95) */
  roundingOffset: number;
  /** Deducted when scaffolding isn't needed or the builder provides it */
  scaffoldDeduction: number;
  kwpRange: [number, number];
  systemTypes: ResidentialSystemType[];
  extrasPresets: { description: string; price: number }[];
  paymentSchedule: { pct: number; label: string }[];
  /** Internal cost estimate assumptions (not shown to customers) */
  cost: {
    scaffold: number;
    mcs: number;
    dcCableMetres: number;
    /** Battery supply per 5 kWh, plus the extra for a hybrid inverter, by system type id */
    batteryPer5kWh: Record<string, number>;
    hybridInverterExtra: Record<string, number>;
    /** Extra cost of the system type's inverter etc. over standard, per system */
    systemExtra: Record<string, number>;
  };
}

export interface ResidentialInput {
  client: { name: string; address: string; phone: string; email: string };
  reference: string;
  panelSku: string;
  panelCount: number;
  roof: ResidentialRoof;
  systemTypeId: string;
  batteryKwh: number;
  /** false = scaffolding not needed / provided by the builder */
  scaffoldNeeded: boolean;
  /** Extras at selling price */
  extras: { id: string; description: string; price: number }[];
  discount: { type: 'percent' | 'amount'; value: number };
  vatRate: number;
}

export interface ResidentialLine {
  description: string;
  amount: number;
}

export interface ResidentialResult {
  kWp: number;
  lines: ResidentialLine[];
  subtotal: number;
  discount: number;
  net: number;
  vat: number;
  gross: number;
  payments: { label: string; pct: number; amount: number }[];
  cost: { total: number; breakdown: ResidentialLine[] } | null;
  margin: number | null;
  marginPct: number | null;
  warnings: string[];
}

export const roundPrice = (n: number, offset: number) => Math.round(n / 100) * 100 - offset;

/** Raw solar price for a pitched roof, interpolated between the anchor packages */
export function anchorPrice(kWp: number, s: ResidentialSettings): number {
  const a = [...s.anchors].sort((x, y) => x[0] - y[0]);
  const first = a[0];
  const last = a[a.length - 1];
  if (kWp < first[0]) return first[1] - (first[0] - kWp) * s.belowPerKwp;
  if (kWp > last[0]) return last[1] + (kWp - last[0]) * s.abovePerKwp;
  for (let i = 1; i < a.length; i++) {
    const [k0, p0] = a[i - 1];
    const [k1, p1] = a[i];
    if (kWp <= k1) return p0 + ((kWp - k0) / (k1 - k0)) * (p1 - p0);
  }
  return last[1];
}

/** The solar price as the spreadsheet calculates it: anchors, flat-roof uplift, rounding */
export function solarPrice(kWp: number, roof: ResidentialRoof, s: ResidentialSettings, uplift = 0): number {
  const raw = (anchorPrice(kWp, s) + uplift) * (roof === 'flat' ? 1 + s.flatRoofUplift : 1);
  return roundPrice(raw, s.roundingOffset);
}

export function priceResidential(
  input: ResidentialInput,
  catalog: Catalog,
  settings: Settings,
): ResidentialResult {
  const s = settings.residential;
  const warnings: string[] = [];
  const panel = catalog.products.find((p) => p.sku === input.panelSku);
  const kWp = round2(((panel?.watts ?? 0) * input.panelCount) / 1000);
  const system = s.systemTypes.find((t) => t.id === input.systemTypeId) ?? s.systemTypes[0];

  if (!panel) warnings.push('Choose a panel.');
  if (kWp > 0 && (kWp < s.kwpRange[0] || kWp > s.kwpRange[1])) {
    warnings.push(`${kWp} kWp is outside the residential model's range (${s.kwpRange[0]}–${s.kwpRange[1]} kWp); check the price.`);
  }
  if (system.unconfirmed) warnings.push(`${system.label} prices are placeholders until confirmed.`);

  const lines: ResidentialLine[] = [];
  if (kWp > 0) {
    lines.push({
      description: `${kWp} kWp solar PV, ${input.panelCount} × ${panel?.watts ?? ''}W panels, ${input.roof} roof${system.solarUplift ? `, ${system.label}` : ''}`,
      amount: solarPrice(kWp, input.roof, s, system.solarUplift),
    });
  }
  if (input.batteryKwh > 0) {
    lines.push({
      description: `${input.batteryKwh} kWh battery storage${system.id !== s.systemTypes[0].id ? ` (${system.label})` : ''}`,
      amount: round2((input.batteryKwh / 5) * system.batteryPer5kWh),
    });
  }
  if (!input.scaffoldNeeded && kWp > 0) {
    lines.push({ description: 'Scaffolding not required', amount: -s.scaffoldDeduction });
  }
  for (const x of input.extras) {
    if (x.description || x.price) lines.push({ description: x.description || 'Extra', amount: round2(x.price) });
  }

  const subtotal = round2(lines.reduce((t, l) => t + l.amount, 0));
  const discount = round2(Math.min(
    subtotal,
    input.discount.type === 'percent' ? (subtotal * input.discount.value) / 100 : input.discount.value,
  ));
  const net = round2(subtotal - discount);
  const vat = round2((net * input.vatRate) / 100);
  const gross = round2(net + vat);
  const payments = s.paymentSchedule.map((p) => ({ ...p, amount: round2((gross * p.pct) / 100) }));

  // Internal cost estimate, using the developer engine for one plot
  let cost: ResidentialResult['cost'] = null;
  if (panel && input.panelCount > 0) {
    const dev = priceQuote({
      projectType: 'residential',
      project: { clientName: '', siteName: '', siteAddress: '', reference: '' },
      houseTypes: [{
        id: 'r', name: '', plots: 1, panelSku: input.panelSku, panelCount: input.panelCount,
        roofType: input.roof === 'flat' ? 'flat' : 'pitched_tile', orientation: 'S', arrays: 1, phase: 1,
        batterySku: null, inverterSku: null, dcCableMetres: s.cost.dcCableMetres,
        scaffoldPerPlot: input.scaffoldNeeded ? s.cost.scaffold : 0,
      }],
      extras: [], discount: { type: 'percent', value: 0 }, vatRate: 0, labourDiscountPct: 0,
    }, catalog, settings);
    const breakdown: ResidentialLine[] = [
      { description: 'Solar kit, mounting, electrical, labour' + (input.scaffoldNeeded ? ', scaffolding' : ''), amount: dev.totals.cost },
      { description: 'MCS certification', amount: s.cost.mcs },
    ];
    if (input.batteryKwh > 0) {
      breakdown.push({
        description: `Battery ${input.batteryKwh} kWh, hybrid inverter extra, battery installation`,
        amount: round2((input.batteryKwh / 5) * (s.cost.batteryPer5kWh[system.id] ?? 0)
          + (s.cost.hybridInverterExtra[system.id] ?? 0) + settings.labour.batteryInstall),
      });
    }
    if (s.cost.systemExtra[system.id]) breakdown.push({ description: `${system.label} equipment extra`, amount: s.cost.systemExtra[system.id] });
    const extrasNote = input.extras.some((x) => x.price) ? ' Extras are not costed.' : '';
    if (dev.houseTypes[0].inverter && (dev.houseTypes[0].inverter.acKw ?? 0) > kWp * 1.6) {
      warnings.push(`Cost estimate uses a ${dev.houseTypes[0].inverter.acKw} kW inverter (the smallest in the price list), so it is overstated.${extrasNote}`);
    } else if (extrasNote) warnings.push(extrasNote.trim());
    cost = { total: round2(breakdown.reduce((t, l) => t + l.amount, 0)), breakdown };
  }

  const margin = cost ? round2(net - cost.total) : null;
  return {
    kWp, lines, subtotal, discount, net, vat, gross, payments, cost, margin,
    marginPct: cost && net > 0 ? round2(((net - cost.total) / net) * 100) : null,
    warnings,
  };
}
