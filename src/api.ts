import { priceQuote } from '../shared/pricing';
import { priceResidential, type ResidentialInput, type ResidentialResult } from '../shared/residential';
import type { Catalog, QuoteInput, QuoteResult, Settings } from '../shared/types';

// In the self-contained build the data is compiled in and prices are worked out in the browser.
// The glob is empty in normal builds, so the JSON is only bundled when it exists.
const staticFiles = import.meta.glob<{ catalog: Catalog; settings: Settings }>('./static-data.json', { eager: true, import: 'default' });
const staticData = __STATIC__ ? Object.values(staticFiles)[0] : undefined;
export const IS_STATIC = !!staticData;

/** Fired when the server says the session has ended, so the app can show the sign-in screen. */
export const authEvents = new EventTarget();

/** fetch for the API: JSON in and out, readable errors, and sign-out on 401. */
async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const r = await fetch(path, {
    credentials: 'same-origin',
    ...rest,
    ...(json !== undefined ? { method: rest.method ?? 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) } : {}),
  });
  if (r.status === 401 && !path.startsWith('/api/auth/')) authEvents.dispatchEvent(new Event('unauthorized'));
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`);
  return body as T;
}

// ---------- sign-in and team ----------

export interface User { id: string; email: string; name: string; role: 'admin' | 'staff'; createdAt: string }

export const getMe = () => api<{ user: User | null; setupNeeded: boolean }>('/api/auth/me');
export const signIn = (email: string, password: string) => api<{ user: User }>('/api/auth/login', { json: { email, password } });
export const signOut = () => api('/api/auth/logout', { method: 'POST' });
export const runSetup = (d: { code: string; name: string; email: string; password: string }) => api<{ user: User }>('/api/auth/setup', { json: d });
export const changeOwnPassword = (current: string, password: string) => api('/api/auth/password', { json: { current, password } });
export const listUsers = () => api<User[]>('/api/users');
export const addUser = (d: { name: string; email: string; role: User['role']; password: string }) => api<User>('/api/users', { json: d });
export const removeUser = (id: string) => api(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const resetPassword = (id: string, password: string) => api(`/api/users/${encodeURIComponent(id)}/password`, { json: { password } });

// ---------- pricing ----------

export async function fetchCatalog(refresh = false): Promise<Catalog> {
  if (staticData) return staticData.catalog;
  return api<Catalog>(`/api/catalog${refresh ? '?refresh=1' : ''}`);
}

export async function calculateResidential(input: ResidentialInput): Promise<ResidentialResult> {
  if (staticData) return priceResidential(input, staticData.catalog, staticData.settings);
  return api<ResidentialResult>('/api/residential/calculate', { json: input });
}

export async function fetchSettings(): Promise<Settings> {
  if (staticData) return staticData.settings;
  return api<Settings>('/api/settings');
}

export async function calculate(input: QuoteInput): Promise<QuoteResult> {
  if (staticData) return priceQuote(input, staticData.catalog, staticData.settings);
  return api<QuoteResult>('/api/quote/calculate', { json: input });
}

// ---------- admin uploads ----------

export interface UploadSummary {
  priceDate?: string;
  panels: number;
  inverters: number;
  batteries: number;
  bundles: number;
  skipped: number;
}

const upload = <T,>(path: string, file: File) =>
  api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });

export interface DataStatus {
  midsummer: { priceDate: string | null; products: number; updatedAt?: string } | null;
  template: { bytes: number; updatedAt: string } | null;
  extraProducts: { products: number; updatedAt?: string } | null;
}
export const getDataStatus = () => api<DataStatus>('/api/admin/data-status');

export const uploadMidsummer = (file: File) => upload<UploadSummary>('/api/suppliers/midsummer/upload', file);
export const uploadTemplate = (file: File) => upload<{ bytes: number }>('/api/admin/template', file);
export const uploadExtraProducts = (file: File) => upload<{ products: number }>('/api/admin/extra-products', file);

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
export const money = (n: number) => gbp.format(n);
export const num = (n: number, dp = 0) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const uid = () => Math.random().toString(36).slice(2, 10);
