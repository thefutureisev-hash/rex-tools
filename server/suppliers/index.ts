import type { Catalog } from '../../shared/types';
import { extraProducts } from './extraProducts';
import { midsummerSupplier } from './midsummerProvider';
import { sampleSupplier } from './sample';
import type { SupplierProvider } from './types';

const providers: SupplierProvider[] = [midsummerSupplier, extraProducts];

/** How long supplier prices are cached before re-loading */
const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; catalog: Catalog } | null = null;

export function clearCatalogCache() {
  cache = null;
}

export async function getCatalog(force = false): Promise<Catalog> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.catalog;

  const loaded = (await Promise.all(providers.map(async (p) => ({ p, data: await p.load() }))))
    .filter((x) => x.data && x.data.products.length);
  // Fall back to the fictional sample list until a supplier has data
  const sources = loaded.length ? loaded : [{ p: sampleSupplier, data: await sampleSupplier.load() }];

  const dates = sources.map((s) => s.data!.priceDate).filter(Boolean).sort() as string[];
  const catalog: Catalog = {
    source: sources.map((s) => s.p.name).join(', '),
    live: sources.every((s) => s.p.live),
    fetchedAt: new Date().toISOString(),
    priceDate: dates[0], // oldest, so staleness warnings are conservative
    products: sources.flatMap((s) => s.data!.products.map((prod) => ({ ...prod, supplier: s.p.name }))),
  };
  cache = { at: Date.now(), catalog };
  return catalog;
}
