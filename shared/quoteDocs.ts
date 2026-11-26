import { ORIENTATION_LABELS, ROOF_LABELS } from './pricing';
import type { QuotePdfData, ScopeRow } from './quotePdf';
import type { ResidentialInput, ResidentialResult } from './residential';
import type { Catalog, Orientation, PaymentStage, Product, QuoteInput, QuoteResult, RoofType, Settings } from './types';

/** Turns priced quotes into the content of the customer PDF. */

type Image = { bytes: Uint8Array; type: 'png' | 'jpg' };

export const longDate = (d = new Date()) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const num = (n: number, dp = 0) => n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const range = (xs: number[], unit: string, dp = 0) => {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return lo === hi ? `${num(lo, dp)}${unit}` : `${num(lo, dp)}–${num(hi, dp)}${unit}`;
};
const name = (p?: Product | null) => (p ? `${p.brand} ${p.name}` : '');

/** Mounting system we price for each roof (see data/settings.json mounting rates) */
function mountingSystem(roof: RoofType, orientation: Orientation): string {
  if (roof === 'flat') return orientation === 'E_W' ? 'East/west ballasted flat-roof frames' : 'South-facing ballasted flat-roof frames with windbreakers';
  if (roof === 'in_roof') return 'In-roof (integrated) mounting kit';
  if (roof === 'metal') return 'Mini-rail mounting for metal roofs';
  if (roof === 'pitched_slate') return 'Rail system with slate hooks';
  return 'Rail system with tile roof hooks';
}

const vatBasis = (rate: number) =>
  rate === 0 ? '0% (zero-rated: new-build / energy-saving materials)' : rate === 5 ? '5% (reduced rate)' : `${rate}% (standard rate)`;
/** Short enough for one line on the Notes page; long schedules point to the costing page */
const paymentTerms = (ps: { pct: number; label: string }[] | PaymentStage[]) => {
  const full = ps.map((p) => `${p.pct}% ${p.label.charAt(0).toLowerCase()}${p.label.slice(1)}`).join('; ');
  return full.length <= 70 ? full : `${ps.map((p) => p.pct).join('/')}%, as set out in the payment schedule with the project costing`;
};

function commonNotes(vatRate: number, settings: Settings, date: Date, extra: string[]) {
  const until = new Date(date.getTime() + settings.pdf.validityDays * 86_400_000);
  return [
    settings.pdf.vatNotes[String(vatRate)] ?? `VAT charged at ${vatRate}%.`,
    `Quotation valid for ${settings.pdf.validityDays} days, until ${longDate(until)}.`,
    ...extra,
  ];
}

const approvals = (g99: boolean): [string, string] => [
  g99 ? 'G99 application to the DNO by REX' : 'G98 notification to the DNO by REX',
  'Planning and landlord permissions by the client, where needed',
];

export function developerPdfData(
  input: QuoteInput, result: QuoteResult, settings: Settings, catalog: Catalog, layoutImage?: Image, date = new Date(),
): QuotePdfData {
  const bySku = new Map(catalog.products.map((p) => [p.sku, p]));
  const t = result.totals;
  const houseTypes = result.houseTypes.filter((h) => h.plots > 0);
  const inputs = houseTypes.map((h) => input.houseTypes.find((x) => x.id === h.id)!);

  const rows: QuotePdfData['rows'] = houseTypes.map((h, i) => {
    const ht = inputs[i];
    const panel = bySku.get(ht.panelSku);
    const battery = ht.batterySku ? bySku.get(ht.batterySku) : null;
    const detail = [
      `${ht.panelCount} × ${panel?.watts ?? ''}W panels (${num(h.kWp, 2)} kWp)`,
      ROOF_LABELS[ht.roofType],
      name(h.inverter),
      battery ? `${battery.capacityKwh ?? ''} kWh battery` : '',
      ht.scaffoldPerPlot ? 'scaffolding' : '',
    ].filter(Boolean).join(', ');
    return { description: `${h.name || 'House type'} – solar PV system`, detail, qty: h.plots, unit: h.sellPerPlot, amount: h.sellTotal };
  });
  for (const l of result.projectLines) {
    rows.push({ description: l.description, qty: l.qty, unit: l.qty ? Math.round((l.sell / l.qty) * 100) / 100 : l.sell, amount: l.sell });
  }

  const panels = inputs.map((ht) => bySku.get(ht.panelSku));
  const watts = uniq(panels.map((p) => p?.watts ?? 0));
  const kwps = houseTypes.map((h) => h.kWp);
  const single = houseTypes.length === 1;
  const batteries = inputs.map((ht) => (ht.batterySku ? bySku.get(ht.batterySku) : null)).filter(Boolean) as Product[];
  const phases = uniq(inputs.map((ht) => ht.phase));
  const scaffold = inputs.some((ht) => ht.scaffoldPerPlot > 0) || result.projectLines.some((l) => /scaffold/i.test(l.description));
  const mcs = result.projectLines.some((l) => /mcs/i.test(l.description));
  const g99 = result.projectLines.some((l) => /g99/i.test(l.description));
  const address = input.project.siteAddress;

  const scopeRows: Record<ScopeRow, [string, string]> = {
    address: [address || input.project.siteName || '—', input.project.siteName && address ? input.project.siteName : ''],
    roof: [
      uniq(inputs.map((ht) => ROOF_LABELS[ht.roofType])).join(', '),
      uniq(inputs.map((ht) => mountingSystem(ht.roofType, ht.orientation))).join('; '),
    ],
    modules: [
      `${range(inputs.map((ht) => ht.panelCount), '')} × ${uniq(panels.map(name)).join(' / ')} ${watts.join('/')}W`,
      `${range(kwps, ' kWp', 2)} DC per system (${num(t.kWp, 2)} kWp in total)`,
    ],
    inverter: [
      `One per unit: ${uniq(houseTypes.map((h) => name(h.inverter))).filter(Boolean).join(' / ') || '—'}`,
      `${range(houseTypes.map((h) => h.inverter?.acKw ?? 0), ' kW', 1)}, ${phases.map((p) => (p === 3 ? 'three' : 'single')).join('/')} phase`,
    ],
    battery: batteries.length
      ? [uniq(batteries.map(name)).join(' / '), `${uniq(batteries.map((b) => b.capacityKwh ?? 0)).join('/')} kWh capacity`]
      : ['Not included', ''],
    included: [
      'PV equipment, mounting, DC cabling, isolators and generation meter',
      `Installation, testing, commissioning and handover${mcs ? ', MCS certification' : ''}`,
    ],
    electrical: ['Connection at the AC isolator for each unit', 'Work beyond the AC isolator excluded unless itemised'],
    access: scaffold ? ['Scaffolding included as priced', 'Roof access by REX'] : ['Scaffolding / roof access provided by the client', ''],
    approvals: approvals(g99),
  };

  const totalPanels = inputs.reduce((s, ht, i) => s + ht.panelCount * houseTypes[i].plots, 0);
  return {
    kind: 'developer',
    projectName: input.project.siteName || input.project.clientName,
    contact: input.project.contactName ?? '',
    clientName: input.project.clientName,
    address: address || input.project.siteName,
    date: longDate(date),
    reference: input.project.reference,
    scope: {
      heading: single
        ? `${num(houseTypes[0]?.kWp ?? 0, 2)} kWp Solar PV system × ${houseTypes[0]?.plots ?? 0}`
        : `Solar PV for ${t.plots} units (${num(t.kWp, 2)} kWp in total)`,
      rows: scopeRows,
      footnote: 'subject to site survey, roof condition, final layout and DNO acceptance.',
    },
    layout: layoutImage
      ? {
          line1: address || input.project.siteName,
          line2: `${num(totalPanels)} × ${watts.join('/')} W panels | ${num(t.kWp, 2)} kWp`,
          image: layoutImage,
        }
      : undefined,
    rows,
    subtotal: t.subtotal,
    discount: t.discount,
    vatRate: input.vatRate,
    vat: t.vat,
    total: t.gross,
    notes: commonNotes(input.vatRate, settings, date, settings.pdf.developer.notes),
    payments: result.payments,
    terms: {
      exclusions: 'None beyond the standard exclusions above.',
      vat: vatBasis(input.vatRate),
      payment: paymentTerms(result.payments),
    },
  };
}

export function residentialPdfData(
  input: ResidentialInput, result: ResidentialResult, settings: Settings, catalog: Catalog,
  layoutImage?: Image, date = new Date(),
): QuotePdfData {
  const panel = catalog.products.find((p) => p.sku === input.panelSku);
  const system = settings.residential.systemTypes.find((t) => t.id === input.systemTypeId);
  const orientation = input.orientation ?? 'S';
  const roof: RoofType = input.roof === 'flat' ? 'flat' : 'pitched_tile';
  const yieldPerKwp = settings.specificYield[orientation];
  const extras = input.extras.filter((x) => x.description).map((x) => x.description);

  return {
    kind: 'residential',
    projectName: input.client.address || input.client.name,
    contact: input.client.name,
    clientName: '',
    address: input.client.address,
    date: longDate(date),
    reference: input.reference,
    scope: {
      heading: `${num(result.kWp, 2)} kWp Solar PV system × 1`,
      rows: {
        address: [input.client.address || '—', ''],
        roof: [`${input.roof === 'flat' ? 'Flat' : 'Pitched'} roof, ${ORIENTATION_LABELS[orientation].toLowerCase()} facing`, mountingSystem(roof, orientation)],
        modules: [`${input.panelCount} × ${name(panel)} ${panel?.watts ?? ''}W`, `${num(result.kWp, 2)} kWp DC`],
        inverter: [result.inverterName ? `${system?.label ?? ''} system` : system?.label ?? '', 'Single phase, sized to the array'],
        battery: input.batteryKwh ? [`${system?.label ?? 'Battery'} storage`, `${input.batteryKwh} kWh capacity`] : ['Not included', 'Can be added later'],
        included: [
          'PV equipment, mounting, DC and AC cabling, isolators and generation meter',
          'Installation, testing, commissioning, monitoring app and handover',
        ],
        electrical: ['Connection to the existing consumer unit', extras.length ? `Also: ${extras.join(', ')}` : 'Consumer unit upgrades excluded unless itemised'],
        access: input.scaffoldNeeded ? ['Scaffolding included', 'Roof access by REX'] : ['Scaffolding not required', ''],
        approvals: ['G98 notification to the DNO and MCS certification by REX', 'Planning permission is not normally needed for home solar'],
      },
      footnote: 'subject to site survey, roof condition, final layout and DNO acceptance.',
    },
    layout: layoutImage
      ? { line1: input.client.address, line2: `${input.panelCount} × ${panel?.watts ?? ''} W panels | ${num(result.kWp, 2)} kWp`, image: layoutImage }
      : undefined,
    production: {
      heading: `${num(result.annualKwh)} kWh estimated annual generation`,
      line: `${num(result.kWp, 2)} kWp DC array | ${num(yieldPerKwp)} kWh per kWp per year, ${ORIENTATION_LABELS[orientation].toLowerCase()} facing, before shading`,
      monthlyKwh: settings.monthlyShare.map((s) => result.annualKwh * s),
      notes: [
        'Monthly figures follow a typical UK solar profile and are shown in kWh per month.',
        'Estimates are subject to final system design, site conditions, shading, roof orientation and verified modelling assumptions.',
      ],
    },
    rows: result.lines.map((l) => ({ description: l.description, qty: 1, unit: l.amount, amount: l.amount })),
    subtotal: result.subtotal,
    discount: result.discount,
    vatRate: input.vatRate,
    vat: result.vat,
    total: result.gross,
    notes: commonNotes(input.vatRate, settings, date, settings.pdf.residential.notes),
    payments: result.payments,
    terms: {
      exclusions: extras.length ? `Additional works included: ${extras.join(', ')}.` : 'None beyond the standard exclusions above.',
      vat: vatBasis(input.vatRate),
      payment: paymentTerms(result.payments),
    },
  };
}
