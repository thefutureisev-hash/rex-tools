import { describe, expect, it } from 'vitest';
import catalogProducts from '../data/sample-catalog.json';
import settingsJson from '../data/settings.json';
import { priceResidential, solarPrice, type ResidentialInput } from '../shared/residential';
import type { Catalog, Product, Settings } from '../shared/types';

const settings = settingsJson as unknown as Settings;
const s = settings.residential;
const products = (catalogProducts as Omit<Product, 'supplier'>[]).map((p) => ({ ...p, supplier: 'test' })) as Product[];
const catalog: Catalog = { source: 'test', live: true, fetchedAt: '', products };

describe('solarPrice matches the residential spreadsheet', () => {
  it('pitched roof guide prices', () => {
    const expected: [number, number][] = [
      [2, 5895], [2.5, 6095], [3, 6395], [3.5, 6695], [4, 6895], [4.5, 7195], [5, 7495],
      [6, 8195], [7, 8795], [8, 9395], [9, 10095], [10, 10695],
    ];
    for (const [kWp, price] of expected) expect(solarPrice(kWp, 'pitched', s)).toBe(price);
  });

  it('flat roof adds 10% before rounding (as the enquiry sheet does)', () => {
    expect(solarPrice(5.5, 'flat', s)).toBe(8595);
    expect(solarPrice(3.24, 'flat', s)).toBe(7195);
    expect(solarPrice(5.4, 'flat', s)).toBe(8595);
    expect(solarPrice(8.1, 'flat', s)).toBe(10495);
  });

  it('extends beyond 6 kWp at £625 per kWp', () => {
    expect(solarPrice(44, 'pitched', s)).toBe(31895);
  });
});

const input = (o: Partial<ResidentialInput> = {}): ResidentialInput => ({
  client: { name: '', address: '', phone: '', email: '' }, reference: '',
  panelSku: 'PNL-HX450', panelCount: 8, roof: 'pitched', systemTypeId: 'standard',
  batteryKwh: 0, scaffoldNeeded: true, extras: [], discount: { type: 'percent', value: 0 }, vatRate: 0, ...o,
});

describe('priceResidential', () => {
  it('prices solar from panels × watts', () => {
    const r = priceResidential(input(), catalog, settings); // 8 × 450 W = 3.6 kWp
    expect(r.kWp).toBe(3.6);
    expect(r.lines[0].amount).toBe(solarPrice(3.6, 'pitched', s));
    expect(r.net).toBe(r.lines[0].amount);
  });

  it('adds battery at £1,500 per 5 kWh', () => {
    const r = priceResidential(input({ batteryKwh: 10 }), catalog, settings);
    expect(r.lines.find((l) => l.description.includes('battery'))?.amount).toBe(3000);
  });

  it('deducts scaffolding when not needed', () => {
    const r = priceResidential(input({ scaffoldNeeded: false }), catalog, settings);
    expect(r.lines.find((l) => l.description.includes('Scaffolding'))?.amount).toBe(-s.scaffoldDeduction);
  });

  it('adds extras at selling price, then discount and VAT', () => {
    const r = priceResidential(input({
      extras: [{ id: 'x', description: 'Nicholson Rooftrak fixings', price: 1600 }],
      discount: { type: 'amount', value: 500 }, vatRate: 20,
    }), catalog, settings);
    const solar = solarPrice(3.6, 'pitched', s);
    expect(r.subtotal).toBe(solar + 1600);
    expect(r.net).toBe(solar + 1100);
    expect(r.gross).toBeCloseTo((solar + 1100) * 1.2, 2);
  });

  it('applies the Sigenergy uplift and warns while unconfirmed', () => {
    const std = priceResidential(input({ batteryKwh: 10 }), catalog, settings);
    const sig = priceResidential(input({ batteryKwh: 10, systemTypeId: 'sigenergy' }), catalog, settings);
    expect(sig.net).toBeGreaterThan(std.net);
    expect(sig.warnings.some((w) => w.includes('placeholders'))).toBe(true);
  });

  it('splits the payment schedule 20/50/25/5', () => {
    const r = priceResidential(input(), catalog, settings);
    expect(r.payments.map((p) => p.pct)).toEqual([20, 50, 25, 5]);
    expect(r.payments.reduce((t, p) => t + p.amount, 0)).toBeCloseTo(r.gross, 2);
  });

  it('estimates cost and margin internally', () => {
    const r = priceResidential(input(), catalog, settings);
    expect(r.cost?.total).toBeGreaterThan(0);
    expect(r.margin).toBeCloseTo(r.net - r.cost!.total, 2);
  });

  it('warns outside the 2–10 kWp range', () => {
    const r = priceResidential(input({ panelCount: 30 }), catalog, settings);
    expect(r.warnings.some((w) => w.includes('outside'))).toBe(true);
  });
});
