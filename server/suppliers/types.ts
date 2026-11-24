import type { Product } from '../../shared/types';

/**
 * Every supplier integration implements this. To add a real supplier
 * (API, CSV/price-file feed, or portal export), write a new class with
 * the same shape and register it in suppliers/index.ts.
 */
export interface SupplierProvider {
  name: string;
  live: boolean;
  fetchProducts(): Promise<Omit<Product, 'supplier'>[]>;
}
