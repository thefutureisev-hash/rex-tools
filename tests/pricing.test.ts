import { describe, expect, it } from 'vitest';
import catalogProducts from '../data/sample-catalog.json';
import settingsJson from '../data/settings.json';
import { priceQuote, selectInverter } from '../shared/pricing';
import type { Catalog, HouseTypeInput, Product, QuoteInput, Settings } from '../shared/types';

const settings = settingsJson as Settings;
const products = (catalogProducts as Omit<Product, 'supplier'>[]).map((p) => ({ ...p, supplier: 'test' })) as Product[];
const catalog: Catalog = { source: 'test', live: true, fetchedAt: '', products };

const house = (o: Partial<HouseTypeInput> = {}): HouseTypeInput => ({
  id: 'h1', name: 'Type A', plots: 10, panelSku: 'PNL-HX430', panelCount: 8,
  roofType: 'pitched_tile', orientation: 'S', arrays: 1, phase: 1,
  batterySku: null, inverterSku: null, ...o,
});

const quote = (houseTypes: HouseTypeInput[], o: Partial<QuoteInput> = {}): QuoteInput => ({
  projectType: 'developer',
  project: { clientName: '', siteName: '', siteAddress: '', reference: '' },
  houseTypes, extras: [], discount: { type: 'percent', value: 0 }, vatRate: 0, ...o,
});

describe('selectInverter', () => {
  it('picks the cheapest single-phase string inverter that fits', () => {
    // 8 × 430 W = 3.44 kWp → 3.0 kW × 1.3 = 3.9 ≥ 3.44
    const { inverter } = selectInverter(products, 3.44, 1, false, 'S', settings);
    expect(inverter?.sku).toBe('INV-VE3.0-1');
  });

  it('steps up when the array outgrows the smaller inverter', () => {
    const { inverter } = selectInverter(products, 5.16, 1, false, 'S', settings); // needs ≥ 3.97 kW AC
    expect(inverter?.sku).toBe('INV-VE5.0-1');
  });

  it('allows a higher DC:AC ratio for east/west arrays', () => {
    const { inverter } = selectInverter(products, 4.3, 1, false, 'E_W', settings); // 3.0 × 1.5 = 4.5
    expect(inverter?.sku).toBe('INV-VE3.0-1');
  });

  it('only uses hybrid inverters when a battery is fitted', () => {
    const { inverter } = selectInverter(products, 3.44, 1, true, 'S', settings);
    expect(inverter?.hybrid).toBe(true);
  });

  it('matches phase', () => {
    const { inverter } = selectInverter(products, 3.44, 3, false, 'S', settings);
    expect(inverter?.phase).toBe(3);
  });

  it('returns null when nothing fits', () => {
    const { inverter } = selectInverter(products, 30, 1, false, 'S', settings);
    expect(inverter).toBeNull();
  });
});

describe('priceQuote', () => {
  it('prices a plot and multiplies by plots', () => {
    const r = priceQuote(quote([house()]), catalog, settings);
    const h = r.houseTypes[0];
    expect(h.kWp).toBe(3.44);
    // panels 8×78 + inverter 395 + mounting 8×35 + labour 8×40 + 350 + scaffold 450 + MCS 60
    expect(h.costPerPlot).toBe(624 + 395 + 280 + 320 + 350 + 450 + 60);
    expect(h.costTotal).toBe(h.costPerPlot * 10);
    expect(r.totals.cost).toBe(h.costTotal);
    expect(r.totals.plots).toBe(10);
  });

  it('applies markup per category', () => {
    const r = priceQuote(quote([house()]), catalog, settings);
    const panels = r.houseTypes[0].lines.find((l) => l.category === 'panel')!;
    expect(panels.sell).toBe(Math.round(624 * 1.25 * 100) / 100);
  });

  it('uses flat east/west ballast pricing and edge protection', () => {
    const r = priceQuote(quote([house({ roofType: 'flat', orientation: 'E_W', arrays: 2 })]), catalog, settings);
    const descs = r.houseTypes[0].lines.map((l) => l.description);
    expect(descs).toContain('Flat-roof east/west ballasted mounting');
    expect(descs).toContain('Edge protection');
    expect(descs).not.toContain('Scaffolding');
  });

  it('charges additional arrays on pitched roofs', () => {
    const r = priceQuote(quote([house({ arrays: 3 })]), catalog, settings);
    const extra = r.houseTypes[0].lines.find((l) => l.description.startsWith('Additional array'));
    expect(extra?.qty).toBe(2);
  });

  it('adds a battery, hybrid inverter and battery install', () => {
    const r = priceQuote(quote([house({ batterySku: 'BAT-CL5' })]), catalog, settings);
    const h = r.houseTypes[0];
    expect(h.inverter?.hybrid).toBe(true);
    expect(h.lines.some((l) => l.description === 'Battery installation')).toBe(true);
  });

  it('adds a G99 application once for large single-phase systems', () => {
    const big = house({ panelCount: 12 }); // 5.16 kWp → 5 kW inverter
    const r = priceQuote(quote([big, { ...big, id: 'h2' }]), catalog, settings);
    expect(r.projectLines.filter((l) => l.description === 'DNO G99 application')).toHaveLength(1);
  });

  it('multiplies per-plot extras by total plots', () => {
    const r = priceQuote(
      quote([house({ plots: 4 }), house({ id: 'h2', plots: 6 })], {
        extras: [
          { id: 'e1', description: 'Bird mesh', unitCost: 80, qty: 1, per: 'plot' },
          { id: 'e2', description: 'Site survey', unitCost: 300, qty: 1, per: 'project' },
        ],
      }),
      catalog, settings,
    );
    expect(r.projectLines.find((l) => l.description === 'Bird mesh')?.qty).toBe(10);
    expect(r.projectLines.find((l) => l.description === 'Site survey')?.qty).toBe(1);
  });

  it('applies discount then VAT', () => {
    const r = priceQuote(quote([house()], { discount: { type: 'percent', value: 10 }, vatRate: 20 }), catalog, settings);
    expect(r.totals.discount).toBeCloseTo(r.totals.subtotal * 0.1, 2);
    expect(r.totals.vat).toBeCloseTo(r.totals.net * 0.2, 2);
    expect(r.totals.gross).toBeCloseTo(r.totals.net * 1.2, 2);
  });

  it('flags stock shortfalls across all plots', () => {
    const r = priceQuote(quote([house({ plots: 50, panelSku: 'PNL-HX450' })]), catalog, settings);
    const panels = r.availability.find((a) => a.sku === 'PNL-HX450')!;
    expect(panels.required).toBe(400);
    expect(panels.status).toBe('partial'); // 340 in stock
    expect(r.warnings.some((w) => w.includes('short of stock'))).toBe(true);
  });

  it('uses a bundle in place of the inverter', () => {
    const bundle: Product = {
      sku: 'BUN-1', supplier: 'test', category: 'bundle', brand: 'Cellora', name: '3.6 kW hybrid + 5 kWh',
      acKw: 3.6, maxDcKw: 5.4, phase: 1, hybrid: true, capacityKwh: 5, costPrice: 1500, stock: null, leadTimeDays: 0,
    };
    const cat = { ...catalog, products: [...products, bundle] };
    const r = priceQuote(quote([house({ batterySku: 'BUN-1', inverterSku: 'INV-VE5.0-1' })]), cat, settings);
    const h = r.houseTypes[0];
    expect(h.inverter?.sku).toBe('BUN-1');
    expect(h.lines.filter((l) => l.category === 'inverter')).toHaveLength(0);
    expect(h.warnings.some((w) => w.includes('ignored'))).toBe(true);
    expect(r.availability.find((a) => a.sku === 'BUN-1')?.status).toBe('unknown');
    expect(r.warnings.some((w) => w.includes('stock levels'))).toBe(true);
  });

  it('warns when a bundle inverter is too small', () => {
    const bundle: Product = {
      sku: 'BUN-2', supplier: 'test', category: 'bundle', brand: 'X', name: '3 kW + 5 kWh',
      acKw: 3, maxDcKw: 4.5, phase: 1, hybrid: true, capacityKwh: 5, costPrice: 1400, stock: null, leadTimeDays: 0,
    };
    const r = priceQuote(quote([house({ panelCount: 14, batterySku: 'BUN-2' })]), { ...catalog, products: [...products, bundle] }, settings);
    expect(r.houseTypes[0].warnings.some((w) => w.includes('too small'))).toBe(true);
  });

  it('flags an oversized auto-selected inverter', () => {
    const only8: Product[] = products.filter((p) => p.category !== 'inverter').concat({
      sku: 'BIG', supplier: 't', category: 'inverter', brand: 'B', name: '8 kW', acKw: 8, maxDcKw: 12, phase: 1,
      hybrid: false, costPrice: 600, stock: null, leadTimeDays: 0,
    });
    const r = priceQuote(quote([house()]), { ...catalog, products: only8 }, settings);
    expect(r.houseTypes[0].warnings.some((w) => w.includes('oversized'))).toBe(true);
  });

  it('notes the price sheet date', () => {
    const r = priceQuote(quote([house()]), { ...catalog, live: false, priceDate: '2026-10-09' }, settings);
    expect(r.warnings.some((w) => w.includes('dated 2026-10-09'))).toBe(true);
  });
});

describe('selectInverter brand matching', () => {
  it('prefers a hybrid of the battery brand', () => {
    const other: Product = {
      sku: 'OTHER-HB', supplier: 't', category: 'inverter', brand: 'Cheapo', name: '5 kW hybrid', acKw: 5, maxDcKw: 7.5,
      phase: 1, hybrid: true, costPrice: 100, stock: 5, leadTimeDays: 0,
    };
    const { inverter } = selectInverter([...products, other], 3.44, 1, true, 'S', settings, 'VoltEdge');
    expect(inverter?.brand).toBe('VoltEdge');
  });
});
