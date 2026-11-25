import type { Product } from '../../shared/types';

/**
 * Every supplier integration implements this. To add a supplier (API,
 * price-file feed, or portal export), write a new provider with the same
 * shape and register it in suppliers/index.ts.
 */
export interface SupplierProvider {
  name: string;
  live: boolean;
  /** Returns null when this supplier has no data yet (e.g. no sheet uploaded) */
  load(): Promise<{ products: Omit<Product, 'supplier'>[]; priceDate?: string } | null>;
}
