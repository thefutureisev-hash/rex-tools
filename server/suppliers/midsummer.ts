import ExcelJS from 'exceljs';
import type { Product } from '../../shared/types';

/**
 * Parses the Midsummer Wholesale trade price sheet (.xlsx) into products.
 *
 * Expected sheets: "Notes", "Panels", "Inverters ..." (one or more) and "Batteries".
 * Columns are found by header text, so column order can change between pulls.
 * Midsummer does not publish stock levels, so stock is always null (unknown).
 */

export interface ParsedSheet {
  products: Omit<Product, 'supplier'>[];
  priceDate?: string;
  /** Rows that were skipped, with the reason (for the upload summary) */
  skipped: string[];
}

type Row = Record<string, unknown>;

const MAX_DOMESTIC_KWH = 30;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === 'object') {
    if ('result' in v) return v.result; // formula
    if ('text' in v) return v.text; // hyperlink
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
  }
  return v;
}

function readSheet(ws: ExcelJS.Worksheet): Row[] {
  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => String(cellValue(v) ?? '').trim());
  const rows: Row[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const r: Row = {};
    (row.values as ExcelJS.CellValue[]).forEach((v, i) => { if (header[i]) r[header[i]] = cellValue(v); });
    rows.push(r);
  });
  return rows;
}

/** Find a column by the start of its header, e.g. "Trade price ex VAT" */
function col(r: Row, prefix: string): unknown {
  const key = Object.keys(r).find((k) => k.toLowerCase().startsWith(prefix.toLowerCase()));
  return key ? r[key] : undefined;
}
const str = (v: unknown) => (v == null ? '' : String(v).trim());
const numOrNull = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(str(v).replace(/[£,]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const stripBrand = (model: string, brand: string) =>
  model.toLowerCase().startsWith(brand.toLowerCase()) ? model.slice(brand.length).trim() : model;

/** AC rating from a model name: "5kW", "3.7D 3.7kW", "MIN 3600 TL-XH", "MOD 5KTL3", "MID 15KTL3" */
export function parseAcKw(model: string): number | null {
  const kw = model.match(/(\d+(?:\.\d+)?)\s*kW(?!h)/i);
  if (kw) return parseFloat(kw[1]);
  const ktl = model.match(/(\d+(?:\.\d+)?)\s*KTL/i);
  if (ktl) return parseFloat(ktl[1]);
  const min = model.match(/\bMIN\s+(\d{4,5})\b/i);
  if (min) return parseInt(min[1], 10) / 1000;
  return null;
}

export function parsePhase(text: string): 1 | 3 {
  return /3ph|\bX3\b|X3-|\bMOD\b|\bMID\b|\bH3\b|KTL3/i.test(text) ? 3 : 1;
}

/** Bundle options like "+ 5kWh APX Batt(£2,132.64)" or "4.6kWh (1 battery)(£2,177.51)" */
export function parseOptions(text: string): { kwh: number; price: number }[] {
  const out: { kwh: number; price: number }[] = [];
  for (const m of text.matchAll(/([\d.]+)\s*kWh[^£]*?\(£([\d,]+(?:\.\d+)?)\)/gi)) {
    out.push({ kwh: parseFloat(m[1]), price: parseFloat(m[2].replace(/,/g, '')) });
  }
  return out;
}

function batteryNotes(brand: string, model: string): string | undefined {
  if (/solax/i.test(brand) && /TP-HS|TP30/i.test(model)) return 'Needs a SolaX BMU; add it as an extra.';
  if (/growatt/i.test(brand) && /APX/i.test(model)) return 'Needs an APX BMS power module and base; add them as extras.';
  if (/CQ16/i.test(model)) return 'Needs a CQ16 BMS control box and base; add them as extras.';
  if (/pylon/i.test(brand)) return 'Low-voltage battery; check it is compatible with the inverter.';
  return undefined;
}

function priceDateFromNotes(rows: unknown[][]): string | undefined {
  for (const r of rows) {
    const m = str(r.find((c) => c)).match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (m) {
      const month = MONTHS.indexOf(m[2].toLowerCase());
      if (month >= 0) return new Date(Date.UTC(+m[3], month, +m[1])).toISOString().slice(0, 10);
    }
  }
  return undefined;
}

export async function parseMidsummerSheet(data: ArrayBuffer | Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  const products: Omit<Product, 'supplier'>[] = [];
  const skipped: string[] = [];
  const base = { stock: null, leadTimeDays: 0 } as const;

  let priceDate: string | undefined;
  const notes = wb.worksheets.find((w) => /notes/i.test(w.name));
  if (notes) {
    const rows: unknown[][] = [];
    notes.eachRow((row) => rows.push((row.values as ExcelJS.CellValue[]).map(cellValue)));
    priceDate = priceDateFromNotes(rows);
  }

  for (const ws of wb.worksheets) {
    const name = ws.name.toLowerCase();

    if (name.startsWith('panels')) {
      for (const r of readSheet(ws)) {
        const ref = str(col(r, 'Midsummer item ref'));
        const watts = numOrNull(col(r, 'Watts'));
        const price = numOrNull(col(r, 'Trade price ex VAT'));
        if (!ref || !watts || !price) continue;
        const brand = str(col(r, 'Brand'));
        products.push({
          ...base, sku: `MS-${ref}`, category: 'panel', brand,
          name: stripBrand(str(col(r, 'Model')), brand), watts, costPrice: price,
          notes: str(col(r, 'Notes')) || undefined, url: str(col(r, 'Page')) || undefined,
        });
      }
    }

    if (name.startsWith('inverters')) {
      for (const r of readSheet(ws)) {
        const ref = str(col(r, 'Midsummer item ref'));
        const model = str(col(r, 'Model'));
        const acKw = numOrNull(col(r, 'kW'));
        const price = numOrNull(col(r, 'Trade price ex VAT'));
        if (!ref || !acKw || !price) continue;
        // AC-coupled battery inverters don't take PV, so they can't be the array inverter
        if (/AC Coupled|-FIT\b/i.test(model)) { skipped.push(`${model}: AC-coupled, not a PV inverter`); continue; }
        const brand = str(col(r, 'Brand'));
        products.push({
          ...base, sku: `MS-${ref}`, category: 'inverter', brand, name: stripBrand(model, brand),
          acKw, phase: str(col(r, 'Phase')).startsWith('3') ? 3 : 1,
          hybrid: /hybrid/i.test(model) && !/no battery port/i.test(str(col(r, 'Compatible battery'))),
          // Max DC input isn't in the sheet; 150% of AC is typical for these ranges
          maxDcKw: acKw * 1.5,
          costPrice: price, url: str(col(r, 'Page')) || undefined,
        });
      }
    }

    if (name.startsWith('batteries')) {
      for (const r of readSheet(ws)) {
        const ref = str(col(r, 'Midsummer item ref'));
        const model = str(col(r, 'Model'));
        const brand = str(col(r, 'Brand'));
        const type = str(col(r, 'Type'));
        const kwh = numOrNull(col(r, 'kWh'));
        const price = numOrNull(col(r, 'Trade price ex VAT'));
        const options = parseOptions(str(col(r, 'Options')));
        const url = str(col(r, 'Page')) || undefined;
        if (!ref || !price) continue;
        const shortName = stripBrand(model, brand);

        const isBundle = /bundle/i.test(type) && parseAcKw(model) !== null && !/battery bundle \d/i.test(model);
        if (isBundle) {
          if (/-FIT\b/i.test(model)) { skipped.push(`${model}: AC-coupled bundle`); continue; }
          const acKw = parseAcKw(model)!;
          const opts = options.length ? options : kwh ? [{ kwh, price }] : [];
          // Residential/developer range only; larger stacks are for commercial quotes
          for (const o of opts.filter((x) => x.kwh <= MAX_DOMESTIC_KWH)) {
            products.push({
              ...base, sku: `MS-${ref}-${o.kwh}`, category: 'bundle', brand,
              name: `${shortName.replace(/\s*\+.*$|\s+with\s+.*$/i, '')} + ${o.kwh} kWh battery`,
              acKw, maxDcKw: acKw * 1.5, phase: parsePhase(model), hybrid: true,
              capacityKwh: o.kwh, costPrice: o.price, url,
              notes: 'Bundle price from the supplier sheet; check what is included.',
            });
          }
          continue;
        }

        // Standalone batteries: skip parts (bases, BMS boxes, slaves), and commercial cabinets
        if (!kwh) continue;
        if (/slave|\bbase\b|BMS|BMU|kit/i.test(model)) continue;
        if (kwh > MAX_DOMESTIC_KWH) { skipped.push(`${model}: over ${MAX_DOMESTIC_KWH} kWh`); continue; }
        products.push({
          ...base, sku: `MS-${ref}`, category: 'battery', brand, name: shortName,
          capacityKwh: kwh, costPrice: price, url, notes: batteryNotes(brand, model),
        });
      }
    }
  }

  return { products, priceDate, skipped };
}
