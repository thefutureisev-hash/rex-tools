import type { Catalog } from '../../shared/types';
import { sampleSupplier } from './sample';
import type { SupplierProvider } from './types';

const providers: SupplierProvider[] = [sampleSupplier];

/** How long supplier prices and stock are cached before re-fetching */
const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; catalog: Catalog } | null = null;

export async function getCatalog(force = false): Promise<Catalog> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.catalog;

  const results = await Promise.all(
    providers.map(async (p) => (await p.fetchProducts()).map((prod) => ({ ...prod, supplier: p.name }))),
  );
  const catalog: Catalog = {
    source: providers.map((p) => p.name).join(', '),
    live: providers.every((p) => p.live),
    fetchedAt: new Date().toISOString(),
    products: results.flat(),
  };
  cache = { at: Date.now(), catalog };
  return catalog;
}
