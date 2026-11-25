import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseAcKw, parseMidsummerSheet, parseOptions, parsePhase } from '../server/suppliers/midsummer';

describe('Midsummer helpers', () => {
  it('reads AC ratings from model names', () => {
    expect(parseAcKw('SolaX X1 G4 3.7D 3.7kW Hybrid Inverter + TP30 Batt Bundle')).toBe(3.7);
    expect(parseAcKw('Growatt MIN 3600 TL-XH 1ph + APX Battery')).toBe(3.6);
    expect(parseAcKw('Growatt MOD 5KTL3-XH + APX HV Battery(s)')).toBe(5);
    expect(parseAcKw('Fox ESS EVO 10-H 5kW with 10kWh Storage 1ph AIO')).toBe(5);
    expect(parseAcKw('Fox ESS CQ7 Battery Bundle 18.96kWh')).toBeNull();
  });

  it('reads phase', () => {
    expect(parsePhase('Growatt MOD 5KTL3-XH')).toBe(3);
    expect(parsePhase('SolaX X3 Hybrid G4 PRO 10kW')).toBe(3);
    expect(parsePhase('SolaX X1 G4 3.7D')).toBe(1);
    expect(parsePhase('Growatt MIN 3600 TL-XH 1ph')).toBe(1);
  });

  it('reads bundle options in each format', () => {
    expect(parseOptions('+ 5kWh APX Batt(£2,100.00)+ 10kWh APX Batt(£3,000.00)')).toEqual([
      { kwh: 5, price: 2100 }, { kwh: 10, price: 3000 },
    ]);
    expect(parseOptions('3kWh(£1,400.00)6kWh(£2,000.50)12kWh(£3100)')).toEqual([
      { kwh: 3, price: 1400 }, { kwh: 6, price: 2000.5 }, { kwh: 12, price: 3100 },
    ]);
    expect(parseOptions('4.6kWh (1 battery)(£2,150.00)9.2kWh (2 batteries)(£3,100.00)')).toEqual([
      { kwh: 4.6, price: 2150 }, { kwh: 9.2, price: 3100 },
    ]);
  });
});

describe('parseMidsummerSheet', () => {
  it('parses a workbook laid out like the Midsummer export', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Notes').addRow(['Midsummer Wholesale trade price sheet - pulled 9 Oct 2026 from the trade account']);
    const panels = wb.addWorksheet('Panels');
    panels.addRow(['Target size', 'Brand', 'Model', 'Midsummer item ref', 'Watts', 'Trade price ex VAT (per panel)', 'Notes']);
    panels.addRow([450, 'Trina', 'Trina Vertex S+ 450W', '6789', 450, 50, null]);
    const inv = wb.addWorksheet('Inverters 8-45kW');
    inv.addRow(['Brand', 'Model', 'Midsummer item ref', 'kW', 'Phase', 'Type', 'Trade price ex VAT', 'Inc VAT', 'Stock status', 'Compatible battery (per page)']);
    inv.addRow(['Fox ESS', 'Fox ESS KH 8kW 1ph Hybrid Inverter', '5987', 8, '1ph', 'Hybrid', 800, 0, '', 'Fox EP/EQ']);
    inv.addRow(['Fox ESS', 'Fox ESS G Series 8kW 1ph String Inverter', '6591', 8, '1ph', 'Hybrid', 500, 0, '', 'String inverter - no battery port']);
    inv.addRow(['SolaX', 'SolaX X3-FIT G4 8kW (3ph AC Coupled Inverter)', '4748', 8, '3ph', 'Hybrid', 900, 0, '', '']);
    const bat = wb.addWorksheet('Batteries');
    bat.addRow(['Brand', 'Type', 'Model', 'Midsummer item ref', 'kWh (as named)', 'Trade price ex VAT (base)', 'Inc VAT', 'Options (price incl. battery)']);
    bat.addRow(['Fox ESS', 'Battery / battery part', 'Fox ESS EP6-H Plus 5.21kWh Battery', '7429', 5.21, 1000, 0, null]);
    bat.addRow(['Fox ESS', 'Battery / battery part', 'Fox ESS EQ2900-S 2.59kWh Slave Battery', '7203', 2.59, 600, 0, null]);
    bat.addRow(['SolaX', 'Inverter+battery bundle', 'SolaX X1 G4 3.7D 3.7kW Hybrid Inverter + TP30 Batt Bundle', '4587', null, 1450, 0, '3kWh(£1,450.00)6kWh(£2,050.00)']);

    const r = await parseMidsummerSheet(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(r.priceDate).toBe('2026-10-09');
    const sku = (s: string) => r.products.find((p) => p.sku === s);
    expect(sku('MS-6789')).toMatchObject({ category: 'panel', brand: 'Trina', name: 'Vertex S+ 450W', watts: 450, costPrice: 50, stock: null });
    expect(sku('MS-5987')).toMatchObject({ category: 'inverter', hybrid: true, phase: 1, acKw: 8 });
    expect(sku('MS-6591')).toMatchObject({ hybrid: false });
    expect(sku('MS-4748')).toBeUndefined(); // AC-coupled
    expect(sku('MS-7429')).toMatchObject({ category: 'battery', capacityKwh: 5.21 });
    expect(sku('MS-7203')).toBeUndefined(); // slave module
    expect(sku('MS-4587-6')).toMatchObject({ category: 'bundle', acKw: 3.7, phase: 1, capacityKwh: 6, costPrice: 2050 });
  });
});
