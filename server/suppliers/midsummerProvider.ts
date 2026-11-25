import { readPrivateJson, writePrivateJson } from '../storage';
import { parseMidsummerSheet, type ParsedSheet } from './midsummer';
import type { SupplierProvider } from './types';

const FILE = 'midsummer.json';

export const midsummerSupplier: SupplierProvider = {
  name: 'Midsummer Wholesale',
  live: false, // price sheet, not an API
  async load() {
    return readPrivateJson<ParsedSheet>(FILE);
  },
};

export async function importMidsummerSheet(data: Buffer) {
  const parsed = await parseMidsummerSheet(data);
  if (!parsed.products.length) throw new Error('No products found. Is this the Midsummer price sheet?');
  await writePrivateJson(FILE, { ...parsed, importedAt: new Date().toISOString() });
  return parsed;
}
