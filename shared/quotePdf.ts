import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFPage, rgb, type RGB } from 'pdf-lib';

/**
 * Builds the customer quote PDF from REX's Canva "Commercial Solar Quotation"
 * master template. Fixed pages are copied as they are; the cover, scope of works,
 * satellite layout (when an image is given), solar production (residential),
 * costing and notes pages are filled in. The finance page is left out until
 * finance is offered. The template must first be prepared with
 * scripts/prepare-template.mts, which hides its placeholder text.
 *
 * Coordinates are PDF points from the top-left corner of an A4 page.
 */

type Box = [number, number, number, number];

export const TEMPLATE = {
  pages: {
    cover: 0, about: 1, services: 2, solar: 3, scope: 4, layout: 5, production: 6,
    costing: 7, finance: 8, notes: 9, work: 10,
  },
  /** Areas rebuilt from their surroundings by prepare-template, by page index */
  patches: {
    0: { address: [60, 229, 150, 246], prepared: [92, 715, 556, 737] },
    4: { heading: [40, 201, 445, 228], values: [174, 244, 450, 617], footnote: [40, 648, 400, 664] },
    5: { line1: [40, 168, 180, 190], line2: [40, 189, 470, 211], foot: [55, 743, 460, 761] },
    6: { heading: [40, 196, 512, 224], line: [34, 254, 472, 274], body: [34, 292, 550, 424] },
    7: { region: [34, 170, 562, 662] },
    9: { project: [40, 662, 556, 689] },
  } as Record<number, Record<string, Box>>,
};

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  ink: hex('#0b2419'),
  dark: hex('#00281f'),
  lime: hex('#59c923'),
  limeText: hex('#94dc00'),
  green: hex('#1c8a3e'),
  heading: hex('#24784a'),
  value: hex('#263d34'),
  body: hex('#233d33'),
  navy: hex('#243447'),
  faint: hex('#9aa8a1'),
  tint: hex('#f1f8f2'),
  border: hex('#d6e8da'),
  rowLine: hex('#e3efe5'),
  muted: hex('#6b7a72'),
  white: hex('#ffffff'),
};

/** Rows of the "Scope of Works" page, in the template's order */
export const SCOPE_ROWS = ['address', 'roof', 'modules', 'inverter', 'battery', 'included', 'electrical', 'access', 'approvals'] as const;
export type ScopeRow = (typeof SCOPE_ROWS)[number];

export interface QuotePdfData {
  kind: 'developer' | 'residential';
  projectName: string;
  /** Person the quote is for */
  contact: string;
  /** Company or client name */
  clientName: string;
  address: string;
  /** Display date, e.g. "25 November 2026" */
  date: string;
  reference: string;
  scope: {
    heading: string;
    /** Two lines per row */
    rows: Record<ScopeRow, [string, string]>;
    /** Follows "Final design and pricing: " */
    footnote: string;
  };
  layout?: { line1: string; line2: string; image: { bytes: Uint8Array; type: 'png' | 'jpg' } };
  production?: { heading: string; line: string; monthlyKwh: number[]; notes: string[] };
  rows: { description: string; detail?: string; qty: number; unit: number; amount: number }[];
  subtotal: number;
  discount: number;
  vatRate: number;
  vat: number;
  total: number;
  notes: string[];
  payments: { pct: number; label: string; amount: number }[];
  terms: { exclusions: string; vat: string; payment: string };
}

export interface PdfAssets {
  template: Uint8Array;
  regular: Uint8Array;
  medium: Uint8Array;
  bold: Uint8Array;
}

const money = (n: number) =>
  `${n < 0 ? '−' : ''}£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Fonts { regular: PDFFont; medium: PDFFont; bold: PDFFont }

export async function buildQuotePdf(data: QuotePdfData, assets: PdfAssets): Promise<Uint8Array> {
  const tpl = await PDFDocument.load(assets.template);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f: Fonts = {
    regular: await doc.embedFont(assets.regular, { subset: true }),
    medium: await doc.embedFont(assets.medium, { subset: true }),
    bold: await doc.embedFont(assets.bold, { subset: true }),
  };
  doc.setTitle(`${data.projectName || 'Quotation'} – REX quotation`);
  doc.setAuthor('REX Renewable Energy Experts');
  doc.setCreationDate(new Date());

  const P = TEMPLATE.pages;
  const copy = async (i: number) => {
    const [p] = await doc.copyPages(tpl, [i]);
    return doc.addPage(p);
  };

  drawCover(await copy(P.cover), data, f);
  for (const i of [P.about, P.services, P.solar]) await copy(i);
  drawScope(await copy(P.scope), data, f);
  if (data.layout) await drawLayout(await copy(P.layout), data.layout, f, doc);
  if (data.production) drawProduction(await copy(P.production), data.production, f);
  await drawCosting(data, f, () => copy(P.costing));
  drawNotes(await copy(P.notes), data, f);
  await copy(P.work);

  return doc.save();
}

// ---------- drawing helpers (top-left coordinates) ----------

/** Top edge of the page in PDF units (Canva pages' media box doesn't start at 0) */
export const pageTop = (page: PDFPage) => page.getMediaBox().y + page.getHeight();

function fit(s: string, font: PDFFont, size: number, max?: number) {
  if (!max || font.widthOfTextAtSize(s, size) <= max) return s;
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function text(
  page: PDFPage, s: string, x: number, top: number, size: number, font: PDFFont, color: RGB,
  o: { align?: 'left' | 'right' | 'center'; max?: number } = {},
) {
  const str = fit(s, font, size, o.max);
  const w = font.widthOfTextAtSize(str, size);
  const dx = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
  page.drawText(str, { x: dx, y: pageTop(page) - top - size * 0.8, size, font, color });
}

function wrap(s: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

function roundRect(
  page: PDFPage, x0: number, y0: number, x1: number, y1: number,
  o: { fill?: RGB; border?: RGB; r?: number; borderWidth?: number },
) {
  const w = x1 - x0;
  const h = y1 - y0;
  const r = Math.min(o.r ?? 0, w / 2, h / 2);
  const path = r
    ? `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`
    : `M 0 0 H ${w} V ${h} H 0 Z`;
  page.drawSvgPath(path, {
    x: x0, y: pageTop(page) - y0,
    color: o.fill, borderColor: o.border, borderWidth: o.border ? (o.borderWidth ?? 0.75) : 0,
  });
}

function hline(page: PDFPage, x0: number, x1: number, y: number, color: RGB, thickness = 0.6) {
  const H = pageTop(page);
  page.drawLine({ start: { x: x0, y: H - y }, end: { x: x1, y: H - y }, thickness, color });
}

function accentBar(page: PDFPage, x: number, top: number) {
  roundRect(page, x, top, x + 42, top + 4, { fill: C.lime, r: 2 });
}

// ---------- pages ----------

function drawCover(page: PDFPage, d: QuotePdfData, f: Fonts) {
  text(page, d.address || d.projectName || 'Solar PV proposal', 63, 233.5, 8.5, f.medium, C.white, { max: 215 });
  const who = [d.contact, d.clientName, d.date].filter(Boolean).join('   |   ');
  text(page, who, 95.9, 720, 10.5, f.regular, C.white, { max: 450 });
}

function drawScope(page: PDFPage, d: QuotePdfData, f: Fonts) {
  text(page, d.scope.heading, 42, 205.5, 16, f.bold, C.heading, { max: 505 });
  const tops = [246.2, 289.0, 331.7, 374.5, 417.3, 460.0, 502.8, 545.6, 588.3];
  SCOPE_ROWS.forEach((key, i) => {
    const [a, b] = d.scope.rows[key];
    text(page, a, 176.3, tops[i] + 1, 9.5, f.regular, C.value, { max: 375 });
    if (b) text(page, b, 176.3, tops[i] + 15.3, 9.5, f.regular, C.value, { max: 375 });
  });
  const foot = wrap(`Final design and pricing: ${d.scope.footnote}`, f.regular, 8, 505);
  foot.slice(0, 2).forEach((l, i) => text(page, l, 42, 652 + i * 11, 8, f.regular, C.faint));
}

async function drawLayout(page: PDFPage, l: NonNullable<QuotePdfData['layout']>, f: Fonts, doc: PDFDocument) {
  text(page, l.line1, 42, 171.5, 13, f.regular, C.body, { max: 505 });
  text(page, l.line2, 42, 192.5, 13, f.regular, C.body, { max: 505 });
  const img = l.image.type === 'png' ? await doc.embedPng(l.image.bytes) : await doc.embedJpg(l.image.bytes);
  const [x0, y0, x1, y1] = [42, 228, 553, 732];
  const scale = Math.min((x1 - x0) / img.width, (y1 - y0) / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, { x: x0 + (x1 - x0 - w) / 2, y: pageTop(page) - y0 - h, width: w, height: h });
  text(page, 'Indicative panel layout – final setting-out subject to site checks.', 57.8, 747, 9.5, f.regular, C.body, { max: 495 });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function drawProduction(page: PDFPage, p: NonNullable<QuotePdfData['production']>, f: Fonts) {
  text(page, p.heading, 42, 200.5, 16, f.bold, C.heading, { max: 505 });
  text(page, p.line, 36.3, 257.5, 10.5, f.regular, C.body, { max: 510 });

  // Monthly production chart: bars with kWh labels
  const x0 = 50;
  const x1 = 545;
  const top = 300;
  const base = 500;
  const max = Math.max(...p.monthlyKwh, 1);
  const step = (x1 - x0) / 12;
  const bw = step * 0.62;
  text(page, 'Estimated monthly generation (kWh/month)', 36.3, 285, 9, f.medium, C.body);
  hline(page, x0 - 6, x1, base, C.border, 0.8);
  p.monthlyKwh.forEach((v, i) => {
    const h = (v / max) * (base - top - 16);
    const bx = x0 + i * step + (step - bw) / 2;
    roundRect(page, bx, base - h, bx + bw, base, { fill: i >= 3 && i <= 8 ? C.lime : C.heading, r: 2 });
    text(page, Math.round(v).toLocaleString('en-GB'), bx + bw / 2, base - h - 12, 7.5, f.medium, C.body, { align: 'center' });
    text(page, MONTHS[i], bx + bw / 2, base + 6, 8, f.regular, C.muted, { align: 'center' });
  });

  let y = 540;
  for (const n of p.notes) {
    for (const l of wrap(n, f.regular, 9.5, 505)) {
      text(page, l, 36.3, y, 9.5, f.regular, C.body);
      y += 14;
    }
    y += 6;
  }
}

function drawNotes(page: PDFPage, d: QuotePdfData, f: Fonts) {
  const line1 = `PROJECT-SPECIFIC EXCLUSIONS / DEPARTURES: ${d.terms.exclusions}`;
  const line2 = `VAT: ${d.terms.vat}   |   Payment terms: ${d.terms.payment}`;
  text(page, line1, 42, 665, 8.5, f.regular, C.navy, { max: 510 });
  text(page, line2, 42, 677, 8.5, f.regular, C.navy, { max: 510 });
}

async function drawCosting(d: QuotePdfData, f: Fonts, newPage: () => Promise<PDFPage>) {
  const X0 = 42;
  const X1 = 553;
  const BOTTOM = 725;
  const col = { item: 50, desc: 76, qty: 372, unit: 456, amount: 545 };

  let page = await newPage();
  let y = 176;

  // Project box
  roundRect(page, X0, y, X1, y + 58, { fill: C.tint, border: C.border, r: 10 });
  text(page, 'PROJECT', 58, y + 11, 7, f.medium, C.muted);
  text(page, d.projectName || '—', 58, y + 23, 12, f.bold, C.ink, { max: 280 });
  text(page, [d.contact, d.clientName, d.address].filter(Boolean).join(' · '), 58, y + 41, 8.5, f.regular, C.muted, { max: 290 });
  text(page, 'REFERENCE', 365, y + 11, 7, f.medium, C.muted);
  text(page, d.reference || '—', 365, y + 25, 9.5, f.medium, C.ink, { max: 95 });
  text(page, 'DATE', 465, y + 11, 7, f.medium, C.muted);
  text(page, d.date, 465, y + 25, 9.5, f.medium, C.ink, { max: 85 });
  y += 78;

  text(page, 'Cost summary', X0, y, 20, f.regular, C.ink);
  accentBar(page, X0, y + 30);
  y += 44;

  const header = () => {
    roundRect(page, X0, y, X1, y + 22, { fill: C.dark, r: 6 });
    text(page, 'ITEM', col.item, y + 7.5, 7, f.bold, C.white);
    text(page, 'DESCRIPTION', col.desc, y + 7.5, 7, f.bold, C.white);
    text(page, 'QTY', col.qty, y + 7.5, 7, f.bold, C.white, { align: 'right' });
    text(page, 'UNIT PRICE', col.unit, y + 7.5, 7, f.bold, C.white, { align: 'right' });
    text(page, 'AMOUNT EX VAT', col.amount, y + 7.5, 7, f.bold, C.white, { align: 'right' });
    y += 22;
  };
  header();

  // Rows (continue on further costing pages if needed)
  for (const [i, r] of d.rows.entries()) {
    const detail = r.detail ? wrap(r.detail, f.regular, 8, 270) : [];
    const h = 22 + detail.length * 10;
    if (y + h > BOTTOM) {
      page = await newPage();
      y = 176;
      header();
    }
    if (i % 2 === 1) page.drawRectangle({ x: X0, y: pageTop(page) - y - h, width: X1 - X0, height: h, color: C.tint });
    text(page, String(i + 1), col.item, y + 7, 8.5, f.regular, C.muted);
    text(page, r.description, col.desc, y + 7, 9, f.medium, C.ink, { max: 270 });
    detail.forEach((l, j) => text(page, l, col.desc, y + 19 + j * 10, 8, f.regular, C.muted));
    text(page, String(r.qty), col.qty, y + 7, 9, f.regular, C.ink, { align: 'right' });
    text(page, money(r.unit), col.unit, y + 7, 9, f.regular, C.ink, { align: 'right' });
    text(page, money(r.amount), col.amount, y + 7, 9, f.medium, C.ink, { align: 'right' });
    y += h;
    hline(page, X0, X1, y, C.rowLine);
  }

  // Notes + totals block, then payment schedule
  const notes = d.notes.flatMap((n) => wrap(n, f.regular, 8, 255));
  const totals: [string, number][] = [['Subtotal ex VAT', d.subtotal]];
  if (d.discount) totals.push(['Discount', -d.discount]);
  totals.push([`VAT (${d.vatRate}%)`, d.vat]);
  const notesH = 44 + notes.length * 11;
  const totalsH = totals.length * 24 + 34;
  const payH = d.payments.length ? 34 + d.payments.length * 18 : 0;
  const blockH = Math.max(notesH, totalsH) + 16 + payH;
  if (y + 16 + blockH > BOTTOM) {
    page = await newPage();
    y = 176;
  } else y += 16;

  // Pricing notes
  roundRect(page, X0, y, 335, y + notesH, { fill: C.white, border: C.border, r: 10 });
  text(page, 'Pricing notes', 56, y + 12, 11, f.bold, C.ink);
  accentBar(page, 56, y + 29);
  notes.forEach((l, i) => text(page, l, 56, y + 40 + i * 11, 8, f.regular, C.ink));

  // Totals
  const tx0 = 350;
  roundRect(page, tx0, y, X1, y + totalsH, { fill: C.tint, border: C.border, r: 10 });
  totals.forEach(([label, v], i) => {
    const ty = y + 9 + i * 24;
    text(page, label, tx0 + 14, ty, 8.5, f.regular, C.ink);
    text(page, money(v), X1 - 14, ty, 8.5, f.medium, C.ink, { align: 'right' });
    hline(page, tx0 + 12, X1 - 12, ty + 17, C.border);
  });
  const by = y + totals.length * 24 + 2;
  roundRect(page, tx0, by, X1, by + 32, { fill: C.dark, r: 8 });
  text(page, 'TOTAL INC. VAT', tx0 + 14, by + 11, 9, f.bold, C.white);
  text(page, money(d.total), X1 - 14, by + 10, 11, f.bold, C.limeText, { align: 'right' });
  y += Math.max(notesH, totalsH) + 16;

  // Payment schedule
  if (d.payments.length) {
    text(page, 'Payment schedule', X0, y, 11, f.bold, C.ink);
    y += 18;
    for (const p of d.payments) {
      text(page, `${p.pct}%`, X0, y, 9, f.bold, C.green);
      text(page, p.label, X0 + 36, y, 9, f.regular, C.ink, { max: 400 });
      text(page, money(p.amount), X1, y, 9, f.medium, C.ink, { align: 'right' });
      y += 14;
      hline(page, X0, X1, y - 2, C.rowLine);
      y += 4;
    }
  }
}
