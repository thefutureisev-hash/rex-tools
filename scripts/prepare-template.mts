/**
 * Prepares REX's Canva quotation template for quote generation by hiding its
 * placeholder text, then saves it to PRICE_DATA_DIR/templates/solar-quote-template.pdf
 * (and prints where it went). Upload that file on the Team & data page.
 *
 *   PRICE_DATA_DIR=... npx tsx scripts/prepare-template.mts <template.pdf>
 *
 * Each area in TEMPLATE.patches (shared/quotePdf.ts) is rebuilt from the pixels just
 * left of it, which keeps flat backgrounds and horizontal edges intact.
 * Needs pdftoppm (poppler) and python3 with Pillow. Re-run when the Canva template
 * changes; if its layout changes, update TEMPLATE in shared/quotePdf.ts.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { PRIVATE_DIR, writePrivateFile } from '../server/storage';
import { pageTop, TEMPLATE } from '../shared/quotePdf';

const src = process.argv[2];
if (!src) throw new Error('Usage: prepare-template.mts <template.pdf>');
const work = await mkdtemp(path.join(tmpdir(), 'rex-template-'));
const here = path.dirname(fileURLToPath(import.meta.url));

const doc = await PDFDocument.load(await readFile(src));
const pages = doc.getPages();
if (pages.length !== 11) console.warn(`Expected 11 pages, found ${pages.length}: check TEMPLATE.pages.`);

for (const [index, boxes] of Object.entries(TEMPLATE.patches)) {
  const i = Number(index);
  const png = path.join(work, `page-${i}`);
  execFileSync('pdftoppm', ['-r', '300', '-png', '-f', String(i + 1), '-l', String(i + 1), '-singlefile', src, png]);
  const regions = Object.entries(boxes).map(([name, box]) => ({ name: `p${i}-${name}`, box }));
  await writeFile(path.join(work, `regions-${i}.json`), JSON.stringify(regions));
  execFileSync('python3', ['-I', path.join(here, 'template_patches.py'), `${png}.png`, work, path.join(work, `regions-${i}.json`)], { stdio: 'inherit' });

  const page = pages[i];
  const H = pageTop(page);
  for (const { name, box: [x0, y0, x1, y1] } of regions) {
    const img = await doc.embedPng(await readFile(path.join(work, `${name}.png`)));
    page.drawImage(img, { x: x0, y: H - y1, width: x1 - x0, height: y1 - y0 });
  }
}

await writePrivateFile('templates/solar-quote-template.pdf', await doc.save());
console.log(`Saved ${path.join(PRIVATE_DIR, 'templates/solar-quote-template.pdf')}`);
