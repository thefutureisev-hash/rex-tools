import express from 'express';
import { fileURLToPath } from 'node:url';
import { priceQuote } from '../shared/pricing';
import type { QuoteInput } from '../shared/types';
import { getSettings } from './settings';
import { getCatalog } from './suppliers';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/catalog', async (req, res) => {
  res.json(await getCatalog(req.query.refresh === '1'));
});

app.get('/api/settings', async (_req, res) => {
  res.json(await getSettings());
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
