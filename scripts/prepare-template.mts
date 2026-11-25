/**
 * Prepares the Canva "Solar Quotation Template" for quote generation by hiding
 * its placeholder text, then saves it to PRICE_DATA_DIR/templates/solar-quote-template.pdf
 * (outside git: it is REX's brochure).
 *
 *   PRICE_DATA_DIR=... npx tsx scripts/prepare-template.mts <template.pdf>
 *
 * Needs pdftoppm (poppler) and python3 with Pillow. Re-run when the Canva template changes.
 * If the template's layout changes, update the boxes below and in shared/quotePdf.ts.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb } from 'pdf-lib';
import { writePrivateFile } from '../server/storage';
import { pageTop, TEMPLATE } from '../shared/quotePdf';

const src = process.argv[2];
if (!src) throw new Error('Usage: prepare-template.mts <template.pdf>');
const work = await mkdtemp(path.join(tmpdir(), 'rex-template-'));
const here = path.dirname(fileURLToPath(import.meta.url));

// 1. Cover: rebuild the areas behind the placeholders from their surroundings
execFileSync('pdftoppm', ['-r', '300', '-png', '-f', '1', '-l', '1', '-singlefile', src, path.join(work, 'cover')]);
const regions = Object.entries(TEMPLATE.coverPatches).map(([name, box]) => ({ name, box }));
await writeFile(path.join(work, 'regions.json'), JSON.stringify(regions));
execFileSync('python3', ['-I', path.join(here, 'template_patches.py'), path.join(work, 'cover.png'), work, path.join(work, 'regions.json')], { stdio: 'inherit' });

const doc = await PDFDocument.load(await readFile(src));
const pages = doc.getPages();
const H = pageTop(pages[0]);
const box = (page: (typeof pages)[number], [x0, y0, x1, y1]: number[], color: [number, number, number]) =>
  page.drawRectangle({ x: x0, y: H - y1, width: x1 - x0, height: y1 - y0, color: rgb(...color) });

for (const { name, box: [x0, y0, x1, y1] } of regions) {
  const png = await doc.embedPng(await readFile(path.join(work, `${name}.png`)));
  pages[TEMPLATE.pages.cover].drawImage(png, { x: x0, y: H - y1, width: x1 - x0, height: y1 - y0 });
}

// 2. Scope page: remove the "Project Detail" placeholder
box(pages[TEMPLATE.pages.scope], TEMPLATE.scope.clearBox, TEMPLATE.colors.pageTint);

// 3. Costing page: clear the placeholder table, notes and totals
box(pages[TEMPLATE.pages.costing], TEMPLATE.costing.clearBox, [1, 1, 1]);

await writePrivateFile('templates/solar-quote-template.pdf', await doc.save());
console.log('Saved templates/solar-quote-template.pdf');
