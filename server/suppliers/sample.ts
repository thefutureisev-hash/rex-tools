import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../paths';
import type { SupplierProvider } from './types';

/** Fictional sample price list, used only when no real supplier data is loaded. */
export const sampleSupplier: SupplierProvider = {
  name: 'Sample price list',
  live: false,
  async load() {
    return { products: JSON.parse(await readFile(path.join(DATA_DIR, 'sample-catalog.json'), 'utf8')) };
  },
};
