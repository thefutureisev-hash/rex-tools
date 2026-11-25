import express from 'express';
import { existsSync } from 'node:fs';
import { priceQuote } from '../shared/pricing';
import { priceResidential, type ResidentialInput } from '../shared/residential';
import type { QuoteInput } from '../shared/types';
import {
  addUser, listUsers, login, logout, me, removeUser, requireAdmin, requireUser, setPassword, setup,
} from './auth';
import { DIST_DIR } from './paths';
import { getSettings } from './settings';
import { readPrivateFile, writePrivateFile, writePrivateJson } from './storage';
import { clearCatalogCache, getCatalog } from './suppliers';
import { importMidsummerSheet } from './suppliers/midsummerProvider';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Hostinger's proxy: real client IPs and HTTPS
app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// ---------- sign-in (open) ----------
app.get('/api/auth/me', me);
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.post('/api/auth/setup', setup);

// ---------- everything else needs a login ----------
app.use('/api', requireUser);

app.post('/api/auth/password', setPassword);

app.get('/api/catalog', async (req, res) => {
  res.json(await getCatalog(req.query.refresh === '1'));
});

app.get('/api/settings', async (_req, res) => {
  res.json(await getSettings());
});

app.get('/api/template/solar', async (_req, res) => {
  const pdf = await readPrivateFile('templates/solar-quote-template.pdf');
  if (!pdf) {
    res.status(404).json({ error: 'The quotation template has not been uploaded yet (admin page).' });
    return;
  }
  res.type('application/pdf').send(pdf);
});

app.post('/api/residential/calculate', async (req, res) => {
  const input = req.body as ResidentialInput;
  if (!input || typeof input.panelCount !== 'number') {
    res.status(400).json({ error: 'Invalid quote input' });
    return;
  }
  const [catalog, settings] = await Promise.all([getCatalog(), getSettings()]);
  res.json(priceResidential(input, catalog, settings));
});

app.post('/api/quote/calculate', async (req, res) => {
  const input = req.body as QuoteInput;
  if (!input || !Array.isArray(input.houseTypes)) {
    res.status(400).json({ error: 'Invalid quote input' });
    return;
  }
  const [catalog, settings] = await Promise.all([getCatalog(), getSettings()]);
  res.json(priceQuote(input, catalog, settings));
});

// ---------- admin only ----------
const raw = express.raw({ type: () => true, limit: '25mb' });

app.get('/api/users', requireAdmin, listUsers);
app.post('/api/users', requireAdmin, addUser);
app.delete('/api/users/:id', requireAdmin, removeUser);
app.post('/api/users/:id/password', requireAdmin, setPassword);

// Midsummer trade price sheet (.xlsx)
app.post('/api/suppliers/midsummer/upload', requireAdmin, raw, async (req, res) => {
  try {
    const parsed = await importMidsummerSheet(req.body as Buffer);
    clearCatalogCache();
    const count = (c: string) => parsed.products.filter((p) => p.category === c).length;
    res.json({
      priceDate: parsed.priceDate,
      panels: count('panel'), inverters: count('inverter'),
      batteries: count('battery'), bundles: count('bundle'),
      skipped: parsed.skipped.length,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Prepared quotation template (PDF from scripts/prepare-template.mts)
app.post('/api/admin/template', requireAdmin, raw, async (req, res) => {
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.subarray(0, 5).toString() !== '%PDF-') {
    res.status(400).json({ error: 'That is not a PDF file.' });
    return;
  }
  await writePrivateFile('templates/solar-quote-template.pdf', body);
  res.json({ ok: true, bytes: body.length });
});

// Products missing from the supplier sheet ({ priceDate, products: [...] })
app.post('/api/admin/extra-products', requireAdmin, raw, async (req, res) => {
  try {
    const data = JSON.parse((req.body as Buffer).toString('utf8'));
    if (!Array.isArray(data?.products)) throw new Error('Expected { "products": [...] }');
    await writePrivateJson('extra-products.json', data);
    clearCatalogCache();
    res.json({ ok: true, products: data.products.length });
  } catch (e) {
    res.status(400).json({ error: `Could not read that file: ${(e as Error).message}` });
  }
});

// ---------- the app itself ----------
if (process.env.NODE_ENV === 'production' || existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile('index.html', { root: DIST_DIR }));
}

