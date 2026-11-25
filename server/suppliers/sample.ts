import { readFile } from 'node:fs/promises';
import type { SupplierProvider } from './types';

/** Fictional sample price list, used only when no real supplier data is loaded. */
export const sampleSupplier: SupplierProvider = {
  name: 'Sample price list',
  live: false,
  async load() {
    const url = new URL('../../data/sample-catalog.json', import.meta.url);
    return { products: JSON.parse(await readFile(url, 'utf8')) };
  },
};
