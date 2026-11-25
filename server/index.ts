import express from 'express';
import { fileURLToPath } from 'node:url';
import { priceQuote } from '../shared/pricing';
import { priceResidential, type ResidentialInput } from '../shared/residential';
import type { QuoteInput } from '../shared/types';
import { getSettings } from './settings';
import { readPrivateFile } from './storage';
import { clearCatalogCache, getCatalog } from './suppliers';
import { importMidsummerSheet } from './suppliers/midsummerProvider';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/catalog', async (req, res) => {
  res.json(await getCatalog(req.query.refresh === '1'));
});

// Upload a new Midsummer price sheet (.xlsx). Stored on the server, not in git.
app.post(
  '/api/suppliers/midsummer/upload',
  express.raw({ type: () => true, limit: '20mb' }),
  async (req, res) => {
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
  },
);

// The prepared Canva quotation template (kept outside git)
app.get('/api/template/solar', async (_req, res) => {
  const pdf = await readPrivateFile('templates/solar-quote-template.pdf');
  if (!pdf) {
    res.status(404).json({ error: 'The quotation template has not been set up on the server yet.' });
    return;
  }
  res.type('application/pdf').send(pdf);
});

app.get('/api/settings', async (_req, res) => {
  res.json(await getSettings());
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

if (process.env.NODE_ENV === 'production') {
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile('index.html', { root: dist }));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`Quote builder API on http://localhost:${port}`));
