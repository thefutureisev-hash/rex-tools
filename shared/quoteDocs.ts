import { ORIENTATION_LABELS, ROOF_LABELS } from './pricing';
import type { QuotePdfData } from './quotePdf';
import type { ResidentialInput, ResidentialResult } from './residential';
import type { Catalog, QuoteInput, QuoteResult, Settings } from './types';

/** Turns priced quotes into the content of the customer PDF. */

export const longDate = (d = new Date()) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const num = (n: number, dp = 0) => n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });

function commonNotes(vatRate: number, settings: Settings, date: Date, extra: string[]) {
  const until = new Date(date.getTime() + settings.pdf.validityDays * 86_400_000);
  return [
    settings.pdf.vatNotes[String(vatRate)] ?? `VAT charged at ${vatRate}%.`,
    `Quotation valid for ${settings.pdf.validityDays} days, until ${longDate(until)}.`,
    ...extra,
  ];
}

export function developerPdfData(
  input: QuoteInput, result: QuoteResult, settings: Settings, catalog: Catalog, date = new Date(),
): QuotePdfData {
  const bySku = new Map(catalog.products.map((p) => [p.sku, p]));
  const t = result.totals;

  const rows: QuotePdfData['rows'] = result.houseTypes
    .filter((h) => h.plots > 0)
    .map((h) => {
      const ht = input.houseTypes.find((x) => x.id === h.id)!;
      const panel = bySku.get(ht.panelSku);
      const battery = ht.batterySku ? bySku.get(ht.batterySku) : null;
      const detail = [
        `${ht.panelCount} × ${panel?.watts ?? ''}W panels (${num(h.kWp, 2)} kWp)`,
        ROOF_LABELS[ht.roofType],
        h.inverter ? `${h.inverter.brand} ${h.inverter.name}` : '',
        battery ? `${battery.capacityKwh ?? ''} kWh battery` : '',
        ht.scaffoldPerPlot ? 'scaffolding' : '',
      ].filter(Boolean).join(', ');
      return { description: `${h.name || 'House type'} – solar PV system`, detail, qty: h.plots, unit: h.sellPerPlot, amount: h.sellTotal };
    });
  for (const l of result.projectLines) {
    rows.push({ description: l.description, qty: l.qty, unit: l.qty ? Math.round((l.sell / l.qty) * 100) / 100 : l.sell, amount: l.sell });
  }

  const houseTypes = result.houseTypes.filter((h) => h.plots > 0);
  return {
    kind: 'developer',
    projectName: input.project.siteName || input.project.clientName,
    clientName: input.project.clientName,
    address: input.project.siteAddress,
    date: longDate(date),
    reference: input.project.reference,
    scope: {
      summary: [
        `Solar PV for ${t.plots} unit${t.plots === 1 ? '' : 's'} across ${houseTypes.length} house type${houseTypes.length === 1 ? '' : 's'}.`,
        `Total system size ${num(t.kWp, 2)} kWp, with an estimated ${num(t.annualKwh)} kWh generated per year.`,
        'Each unit has its own string inverter, isolators and generation meter, finishing at the AC isolator.',
      ],
      table: {
        headers: ['House type', 'Units', 'Panels', 'kWp', 'Roof', 'Inverter'],
        widths: [118, 40, 46, 46, 92, 153],
        align: ['left', 'right', 'right', 'right', 'left', 'left'],
        rows: houseTypes.map((h) => {
          const ht = input.houseTypes.find((x) => x.id === h.id)!;
          return [
            h.name || 'House type', String(h.plots), String(ht.panelCount), num(h.kWp, 2),
            ROOF_LABELS[ht.roofType], h.inverter ? `${h.inverter.brand} ${h.inverter.name}` : '—',
          ];
        }),
      },
      included: settings.pdf.developer.included,
      excluded: settings.pdf.developer.excluded,
    },
    rows,
    subtotal: t.subtotal,
    discount: t.discount,
    vatRate: input.vatRate,
    vat: t.vat,
    total: t.gross,
    notes: commonNotes(input.vatRate, settings, date, settings.pdf.developer.notes),
    payments: result.payments,
  };
}

export function residentialPdfData(
  input: ResidentialInput, result: ResidentialResult, settings: Settings, catalog: Catalog,
  image?: { bytes: Uint8Array; type: 'png' | 'jpg' }, date = new Date(),
): QuotePdfData {
  const panel = catalog.products.find((p) => p.sku === input.panelSku);
  const system = settings.residential.systemTypes.find((t) => t.id === input.systemTypeId);
  const orientation = input.orientation ?? 'S';
  const roof = input.roof === 'flat' ? 'Flat roof' : 'Pitched roof';
  const yieldPerKwp = settings.specificYield[orientation];

  return {
    kind: 'residential',
    projectName: input.client.address || input.client.name,
    clientName: input.client.name,
    address: input.client.address,
    date: longDate(date),
    reference: input.reference,
    scope: {
      summary: [
        `${num(result.kWp, 2)} kWp solar PV system: ${input.panelCount} × ${panel?.watts ?? ''}W panels on a ${roof.toLowerCase()}.`,
        input.batteryKwh ? `With ${input.batteryKwh} kWh of battery storage.` : 'Solar only (battery can be added later).',
        `Estimated generation ${num(result.annualKwh)} kWh per year.`,
      ],
      details: [
        ['Panels', `${input.panelCount} × ${panel ? `${panel.brand} ${panel.name}` : ''}`],
        ['System size', `${num(result.kWp, 2)} kWp`],
        ['Roof', `${roof}, ${ORIENTATION_LABELS[orientation].toLowerCase()} facing`],
        ['System', system?.label ?? ''],
        ['Battery', input.batteryKwh ? `${input.batteryKwh} kWh` : 'None'],
        ['Scaffolding', input.scaffoldNeeded ? 'Included' : 'Not required'],
        ...input.extras.filter((x) => x.description).map((x): [string, string] => ['Additional works', x.description]),
      ],
      included: settings.pdf.residential.included,
      excluded: settings.pdf.residential.excluded,
    },
    rows: result.lines.map((l) => ({ description: l.description, qty: 1, unit: l.amount, amount: l.amount })),
    subtotal: result.subtotal,
    discount: result.discount,
    vatRate: input.vatRate,
    vat: result.vat,
    total: result.gross,
    notes: commonNotes(input.vatRate, settings, date, settings.pdf.residential.notes),
    payments: result.payments,
    design: {
      tiles: [
        [`${num(result.kWp, 2)} kWp`, 'System size'],
        [`${num(result.annualKwh)} kWh`, 'Estimated generation / year'],
        [String(input.panelCount), 'Solar panels'],
        [input.batteryKwh ? `${input.batteryKwh} kWh` : 'None', 'Battery storage'],
      ],
      lines: [
        `Estimated annual generation uses ${num(yieldPerKwp)} kWh per kWp for a ${ORIENTATION_LABELS[orientation].toLowerCase()}-facing array in the UK, before any shading. Actual output varies with weather, roof pitch and shading.`,
        'A final design, panel layout and shading check will be confirmed at survey.',
      ],
      image,
    },
  };
}
