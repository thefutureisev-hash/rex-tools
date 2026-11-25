import { readPrivateJson } from '../storage';
import type { SupplierProvider } from './types';

/**
 * Products that aren't on the supplier's price sheet yet (e.g. small string
 * inverters), kept in PRICE_DATA_DIR/extra-products.json, outside git.
 * Format: { "priceDate": "YYYY-MM-DD", "products": [ Product without "supplier" ] }
 */
export const extraProducts: SupplierProvider = {
  name: 'Additional products',
  live: false,
  async load() {
    return readPrivateJson('extra-products.json');
  },
};
