import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFPage, rgb, type RGB } from 'pdf-lib';

/**
 * Builds the customer quote PDF from REX's Canva "Solar Quotation Template".
 * Fixed pages are copied as they are; the cover, scope, design (residential only)
 * and costing pages are filled in. The template must first be prepared with
 * scripts/prepare-template.mts, which hides its placeholder text.
 *
 * Coordinates are PDF points from the top-left corner of an A4 page.
 */

export const TEMPLATE = {
  pages: { cover: 0, about: 1, services: 2, solar: 3, scope: 4, design: 5, costing: 6, nextSteps: 7, work: [8, 9, 10] },
  /** Areas on the cover rebuilt from their surroundings (placeholders and a stray text box) */
  coverPatches: {
    pill: [56, 229, 124, 246],
    paragraph: [243, 656, 354, 676],
    prepared: [47, 695, 320, 734],
  } as Record<string, [number, number, number, number]>,
  scope: { clearBox: [50, 360, 260, 382] as number[] },
  costing: { clearBox: [30, 195, 570, 742] as number[] },
  colors: { pageTint: [0xf5 / 255, 0xf7 / 255, 0xf4 / 255] as [number, number, number] },
};

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  ink: hex('#0b2419'),
  dark: hex('#00281f'),
  lime: hex('#59c923'),
  limeText: hex('#94dc00'),
  green: hex('#1c8a3e'),
  tint: hex('#f1f8f2'),
  border: hex('#d6e8da'),
  rowLine: hex('#e3efe5'),
  muted: hex('#6b7a72'),
  white: hex('#ffffff'),
};

export interface QuotePdfData {
  kind: 'developer' | 'residential';
  projectName: string;
  clientName: string;
  address: string;
  /** Display date, e.g. "25 November 2026" */
  date: string;
  reference: string;
  scope: {
    summary: string[];
    /** Optional table (developer house types) */
    table?: { headers: string[]; widths: number[]; align?: ('left' | 'right')[]; rows: string[][] };
    /** Optional label/value pairs (residential system) */
    details?: [string, string][];
    included: string[];
    excluded: string[];
  };
  rows: { description: string; detail?: string; qty: number; unit: number; amount: number }[];
  subtotal: number;
  discount: number;
  vatRate: number;
  vat: number;
  total: number;
  notes: string[];
  payments: { pct: number; label: string; amount: number }[];
  design?: {
    tiles: [string, string][];
    lines: string[];
    image?: { bytes: Uint8Array; type: 'png' | 'jpg' };
  };
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
  if (data.kind === 'residential' && data.design) await drawDesign(await copy(P.design), data, f, doc);
  await drawCosting(data, f, () => copy(P.costing));
  for (const i of [P.nextSteps, ...P.work]) await copy(i);

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
  text(page, d.projectName || 'Solar PV proposal', 60, 232.5, 10, f.medium, C.white, { max: 225 });
  text(page, 'Prepared for', 49.4, 699, 10, f.regular, C.limeText);
  const who = [d.clientName, d.address, d.date].filter(Boolean).join('   |   ');
  text(page, who, 49.4, 717, 10, f.regular, C.white, { max: 495 });
}

function drawScope(page: PDFPage, d: QuotePdfData, f: Fonts) {
  const s = d.scope;
  // Summary inside the "Proposed installation scope" box
  let y = 240;
  for (const line of s.summary.slice(0, 4)) {
    text(page, line, 55, y, 10, f.regular, C.ink, { max: 485 });
    y += 14;
  }

  y = 330;
  if (s.table) {
    const t = s.table;
    const x0 = 42;
    const x1 = 553;
    roundRect(page, x0, y, x1, y + 22, { fill: C.dark, r: 6 });
    let x = x0 + 8;
    const cols = t.widths.map((w) => { const start = x; x += w; return start; });
    const right = (i: number) => (t.align?.[i] === 'right');
    // Left-aligned text after a right-aligned column gets a gap so the two don't run together
    const at = (i: number) => (right(i) ? cols[i] + t.widths[i] - 6 : cols[i] + (i > 0 && right(i - 1) ? 8 : 0));
    t.headers.forEach((h, i) => {
      text(page, h === 'kWp' ? h : h.toUpperCase(), at(i), y + 7.5, 7, f.bold, C.white, { align: right(i) ? 'right' : 'left' });
    });
    y += 22;
    t.rows.forEach((row, ri) => {
      if (y > 700) return;
      if (ri % 2 === 1) page.drawRectangle({ x: x0, y: pageTop(page) - y - 22, width: x1 - x0, height: 22, color: C.tint });
      row.forEach((cell, i) => {
        text(page, cell, at(i), y + 7, 8.5, i === 0 ? f.medium : f.regular, C.ink, {
          align: right(i) ? 'right' : 'left', max: t.widths[i] - 12,
        });
      });
      y += 22;
      hline(page, x0, x1, y, C.rowLine);
    });
    y += 18;
  }

  if (s.details) {
    for (const [label, value] of s.details) {
      if (y > 690) break;
      text(page, label, 55, y, 8.5, f.regular, C.muted);
      const lines = wrap(value, f.medium, 9.5, 330);
      lines.forEach((l, i) => text(page, l, 200, y + i * 12, 9.5, f.medium, C.ink));
      y += Math.max(1, lines.length) * 12 + 6;
      hline(page, 55, 540, y - 3, C.rowLine);
    }
    y += 12;
  }

  // Included / not included, side by side
  const top = Math.min(y, 640);
  const col = (title: string, items: string[], x: number) => {
    text(page, title, x, top, 10, f.bold, C.green);
    accentBar(page, x, top + 15);
    let yy = top + 26;
    for (const it of items) {
      const lines = wrap(it, f.regular, 8.5, 225);
      if (yy + lines.length * 11 > 790) break;
      page.drawCircle({ x: x + 2, y: pageTop(page) - yy - 4, size: 1.6, color: C.lime });
      lines.forEach((l, i) => text(page, l, x + 9, yy + i * 11, 8.5, f.regular, C.ink));
      yy += lines.length * 11 + 4;
    }
  };
  col('Included', s.included, 55);
  col('Not included', s.excluded, 310);
}

async function drawDesign(page: PDFPage, d: QuotePdfData, f: Fonts, doc: PDFDocument) {
  const g = d.design!;
  let y = 170;
  if (g.image) {
    const img = g.image.type === 'png' ? await doc.embedPng(g.image.bytes) : await doc.embedJpg(g.image.bytes);
    const maxW = 511;
    const maxH = 330;
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: 42 + (maxW - w) / 2, y: pageTop(page) - y - h, width: w, height: h });
    y += h + 24;
  }
  // Tiles in the brochure's dark style
  const n = g.tiles.length;
  const gap = 10;
  const w = (511 - gap * (n - 1)) / n;
  g.tiles.forEach(([value, label], i) => {
    const x = 42 + i * (w + gap);
    roundRect(page, x, y, x + w, y + 62, { fill: C.dark, r: 8 });
    text(page, value, x + 12, y + 14, 16, f.medium, C.limeText, { max: w - 20 });
    text(page, label, x + 12, y + 40, 8, f.regular, C.white, { max: w - 20 });
  });
  y += 84;
  for (const line of g.lines) {
    for (const l of wrap(line, f.regular, 9, 500)) {
      text(page, l, 42, y, 9, f.regular, C.muted);
      y += 13;
    }
    y += 5;
  }
}

async function drawCosting(d: QuotePdfData, f: Fonts, newPage: () => Promise<PDFPage>) {
  const X0 = 42;
  const X1 = 553;
  const BOTTOM = 742;
  const col = { item: 50, desc: 76, qty: 372, unit: 456, amount: 545 };

  let page = await newPage();
  let y = 205;

  // Project box
  roundRect(page, X0, y, X1, y + 58, { fill: C.tint, border: C.border, r: 10 });
  text(page, 'PROJECT', 58, y + 11, 7, f.medium, C.muted);
  text(page, d.projectName || '—', 58, y + 23, 12, f.bold, C.ink, { max: 280 });
  text(page, [d.clientName, d.address].filter(Boolean).join(' · '), 58, y + 41, 8.5, f.regular, C.muted, { max: 290 });
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
      y = 205;
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
    y = 205;
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
