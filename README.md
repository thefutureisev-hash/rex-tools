# Rexperts Quote Builder

Internal tool for pricing EV and solar projects. Current scope: **Solar – Developer** pricing.

## Run locally

```bash
npm install
npm run dev        # API on :3001, app on http://localhost:5173
npm test           # pricing engine tests
```

Production: `npm run build && npm start` (serves the app and API on `PORT`, default 3001).

## How pricing works

- Each **house type** has plots, panel model/count, roof type, orientation, number of arrays, supply phase and an optional battery.
- **Inverter** is auto-selected: the cheapest inverter of the right phase (hybrid if there's a battery) whose AC rating × max DC:AC ratio covers the array (1.3, or 1.5 for east/west).
- **Mounting** is priced per panel by roof type, plus a charge per extra array. Flat-roof east/west uses ballasted per-panel pricing.
- **Labour** (install, testing, commissioning) is read per system from a curve fitted to REX's historical
  flat-roof jobs (`labour.flatCurve`, [panels, £] points, interpolated), then multiplied by a roof-type
  factor. Battery installation is added on top.
- **Electrical**: DC cable (metres per plot × £/100 m) plus a fixed per-plot amount for the DC isolator,
  generation meter and AC isolator with cabling. Work beyond the AC isolator is entered as an extra.
- **Scaffolding** is entered per house type (often not needed), or as a whole-site extra.
- Single-phase inverters over 3.68 kW trigger a **G99 application** line.
- Markup is applied per category; the app shows cost, sell price and margin.
- **Availability** is checked against total quantities across all plots.

All rates, markups and yields live in `data/settings.json`.

## Suppliers

Suppliers plug in via `server/suppliers/` (see `types.ts`).

**Midsummer Wholesale** is loaded from their trade price sheet (.xlsx). Use
**Upload Midsummer price sheet** in the app (bottom of the Pricing panel). The sheet is
parsed on the server and saved to `PRICE_DATA_DIR` (default `data/private/`), which is
**not committed**: this repo is public and trade prices must stay out of it.

What the importer does:
- Panels, inverters and batteries are read by column name, so column order can change.
- AC-coupled inverters (SolaX FIT) are skipped: they can't run a PV array.
- Battery modules that can't be used alone (slaves, bases, BMS/BMU boxes) are skipped;
  batteries that need one get a note telling the user to add it as an extra.
- Inverter + battery bundles become one product per battery size (up to 30 kWh).
- Max DC input isn't in the sheet, so it's assumed to be 150% of the AC rating.
- Midsummer doesn't publish stock, so availability shows "Confirm".

Until a sheet is uploaded, the app falls back to a fictional sample list (`data/sample-catalog.json`).
