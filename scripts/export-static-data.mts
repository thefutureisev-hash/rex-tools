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
// The test page fetches the template from a file published next to it
const template = await readPrivateFile('templates/solar-quote-template.pdf');
if (template) {
  await writeFile(new URL('../dist-static/solar-quote-template.pdf', import.meta.url), template).catch(async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(new URL('../dist-static/', import.meta.url), { recursive: true });
    await writeFile(new URL('../dist-static/solar-quote-template.pdf', import.meta.url), template);
  });
  console.log('Copied the quotation template to dist-static/');
}
