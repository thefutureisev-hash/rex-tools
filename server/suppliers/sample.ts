import { readFile } from 'node:fs/promises';
import type { SupplierProvider } from './types';

/** Sample price list used until a real supplier feed is connected. */
export const sampleSupplier: SupplierProvider = {
  name: 'Sample price list',
  live: false,
  async fetchProducts() {
    const url = new URL('../../data/sample-catalog.json', import.meta.url);
    return JSON.parse(await readFile(url, 'utf8'));
  },
};
