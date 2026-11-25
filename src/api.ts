import type { Catalog, QuoteInput, QuoteResult } from '../shared/types';

export async function fetchCatalog(refresh = false): Promise<Catalog> {
  const r = await fetch(`/api/catalog${refresh ? '?refresh=1' : ''}`);
  if (!r.ok) throw new Error('Could not load supplier catalogue');
  return r.json();
}

export async function calculate(input: QuoteInput): Promise<QuoteResult> {
  const r = await fetch('/api/quote/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error('Pricing failed');
  return r.json();
}

export interface UploadSummary {
  priceDate?: string;
  panels: number;
  inverters: number;
  batteries: number;
  bundles: number;
  skipped: number;
}

export async function uploadMidsummer(file: File): Promise<UploadSummary> {
  const r = await fetch('/api/suppliers/midsummer/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? 'Upload failed');
  return body;
}

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
export const money = (n: number) => gbp.format(n);
export const num = (n: number, dp = 0) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const uid = () => Math.random().toString(36).slice(2, 10);
