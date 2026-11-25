import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import catalogProducts from '../data/sample-catalog.json';
import settingsJson from '../data/settings.json';
import { priceQuote } from '../shared/pricing';
import { developerPdfData, residentialPdfData } from '../shared/quoteDocs';
import { buildQuotePdf, type PdfAssets } from '../shared/quotePdf';
import { priceResidential, type ResidentialInput } from '../shared/residential';
import type { Catalog, HouseTypeInput, Product, QuoteInput, Settings } from '../shared/types';

const settings = settingsJson as unknown as Settings;
const products = (catalogProducts as Omit<Product, 'supplier'>[]).map((p) => ({ ...p, supplier: 'test' })) as Product[];
const catalog: Catalog = { source: 'test', live: true, fetchedAt: '', products };

async function assets(): Promise<PdfAssets> {
  // An 11-page stand-in for the Canva template
  const tpl = await PDFDocument.create();
  for (let i = 0; i < 11; i++) tpl.addPage([595.5, 842.25]);
  const font = (w: string) => readFile(`node_modules/roboto-fontface/fonts/roboto/Roboto-${w}.woff`);
  return { template: await tpl.save(), regular: await font('Regular'), medium: await font('Medium'), bold: await font('Bold') };
}

const house = (o: Partial<HouseTypeInput> = {}): HouseTypeInput => ({
  id: 'h1', name: 'Type A', plots: 8, panelSku: 'PNL-HX430', panelCount: 4, roofType: 'flat', orientation: 'S',
  arrays: 1, phase: 1, batterySku: null, inverterSku: null, dcCableMetres: 30, scaffoldPerPlot: 0, ...o,
});
const devQuote = (houseTypes: HouseTypeInput[]): QuoteInput => ({
  projectType: 'developer',
  project: { clientName: 'Example Homes Ltd', siteName: 'Example Court', siteAddress: '1 Example Road', reference: 'Q-001' },
  houseTypes, extras: [{ id: 'm', description: 'MCS certification', unitCost: 400, unitPrice: 500, qty: 1, per: 'plot' }],
  discount: { type: 'percent', value: 0 }, vatRate: 0,
});

describe('quote PDF', () => {
  it('builds a developer quote without the design page, with a 60/40 schedule', async () => {
    const q = devQuote([house()]);
    const r = priceQuote(q, catalog, settings);
    expect(r.payments.map((p) => p.pct)).toEqual([60, 40]);
    const data = developerPdfData(q, r, settings, catalog);
    expect(data.rows[0]).toMatchObject({ qty: 8, unit: 3300, amount: 26400 });
    const pdf = await PDFDocument.load(await buildQuotePdf(data, await assets()));
    expect(pdf.getPageCount()).toBe(10);
  });

  it('adds costing pages when there are many lines', async () => {
    const many = Array.from({ length: 30 }, (_, i) => house({ id: `h${i}`, name: `Type ${i}` }));
    const q = devQuote(many);
    const r = priceQuote(q, catalog, settings);
    const pdf = await PDFDocument.load(await buildQuotePdf(developerPdfData(q, r, settings, catalog), await assets()));
    expect(pdf.getPageCount()).toBeGreaterThan(10);
  });

  it('builds a residential quote with the design page and estimated generation', async () => {
    const input: ResidentialInput = {
      client: { name: 'Example Client', address: '1 Example Street', phone: '', email: '' }, reference: 'R-001',
      panelSku: 'PNL-HX450', panelCount: 10, roof: 'pitched', orientation: 'S', systemTypeId: 'standard',
      batteryKwh: 10, scaffoldNeeded: true, extras: [], discount: { type: 'percent', value: 0 }, vatRate: 0,
    };
    const r = priceResidential(input, catalog, settings);
    expect(r.annualKwh).toBe(Math.round(4.5 * settings.specificYield.S));
    const data = residentialPdfData(input, r, settings, catalog);
    expect(data.payments.map((p) => p.pct)).toEqual([20, 50, 25, 5]);
    const pdf = await PDFDocument.load(await buildQuotePdf(data, await assets()));
    expect(pdf.getPageCount()).toBe(11);
  });

  it('uses a custom payment schedule when agreed', () => {
    const q = { ...devQuote([house()]), paymentSchedule: [{ pct: 100, label: 'On completion' }] };
    const r = priceQuote(q, catalog, settings);
    expect(r.payments).toEqual([{ pct: 100, label: 'On completion', amount: r.totals.gross }]);
  });
});
