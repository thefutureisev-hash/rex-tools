/**
 * Writes the current catalogue and settings to src/static-data.json, for the
 * self-contained test build (npm run build:static). The file holds trade
 * prices, so it is git-ignored.
 */
import { writeFile } from 'node:fs/promises';
import { getSettings } from '../server/settings';
import { readPrivateFile } from '../server/storage';
import { getCatalog } from '../server/suppliers';

const [catalog, settings] = await Promise.all([getCatalog(true), getSettings()]);
await writeFile(new URL('../src/static-data.json', import.meta.url), JSON.stringify({ catalog, settings }));
console.log(`Wrote ${catalog.products.length} products from ${catalog.source}`);
const template = await readPrivateFile('templates/solar-quote-template.pdf');
if (template) {
  await writeFile(new URL('../src/static-template.json', import.meta.url), JSON.stringify({ b64: template.toString('base64') }));
  console.log('Included the quotation template');
}
