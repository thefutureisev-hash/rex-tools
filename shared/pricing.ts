import type {
  AvailabilityRow,
  RoofType,
  Catalog,
  HouseTypeInput,
  HouseTypeResult,
  Line,
  LineCategory,
  Orientation,
  Product,
  QuoteInput,
  QuoteResult,
  Settings,
} from './types';

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const ROOF_LABELS = {
  pitched_tile: 'Pitched – tile',
  pitched_slate: 'Pitched – slate',
  in_roof: 'In-roof (integrated)',
  flat: 'Flat roof',
  metal: 'Metal (clip / mini-rail)',
} as const;

/** Labour for one system, read from the flat-roof curve and scaled by roof type. */
export function labourFor(panels: number, roofType: RoofType, settings: Settings): number {
  const curve = [...settings.labour.flatCurve].sort((a, b) => a[0] - b[0]);
  if (panels <= 0 || !curve.length) return 0;
  let flat: number;
  const last = curve[curve.length - 1];
  if (panels <= curve[0][0]) flat = curve[0][1];
  else if (panels >= last[0]) flat = last[1] + (panels - last[0]) * settings.labour.beyondPerPanel;
  else {
    const i = curve.findIndex(([n]) => n >= panels);
    const [n0, c0] = curve[i - 1];
    const [n1, c1] = curve[i];
    flat = c0 + ((panels - n0) / (n1 - n0)) * (c1 - c0);
  }
  return round2(flat * (settings.labour.roofFactor[roofType] ?? 1));
}

export const ORIENTATION_LABELS: Record<Orientation, string> = {
  S: 'South',
  SE_SW: 'South-east / South-west',
  E_W: 'East / West split',
  E: 'East',
  W: 'West',
  N: 'North',
};

function line(
  settings: Settings,
  category: LineCategory,
  description: string,
  qty: number,
  unitCost: number,
  sku?: string,
): Line {
  const cost = round2(qty * unitCost);
  const sell = round2(cost * (1 + settings.markup[category] / 100));
  return { description, category, qty, unitCost: round2(unitCost), cost, sell, sku };
}

export const maxRatioFor = (orientation: Orientation, settings: Settings) =>
  orientation === 'E_W' ? settings.maxDcAcRatio.E_W : settings.maxDcAcRatio.default;

/** Does an inverter (or bundle) have enough capacity for the array? */
export const inverterFits = (p: Product, kWp: number, orientation: Orientation, settings: Settings) =>
  (p.acKw ?? 0) * maxRatioFor(orientation, settings) >= kWp && (p.maxDcKw ?? 0) >= kWp;

/**
 * Pick the cheapest inverter that can take the array.
 * Rules: same phase; hybrid if a battery is fitted, and the same brand as the
 * battery where that brand makes one; AC rating × max DC:AC ratio must cover
 * the DC array size; the inverter's max DC input must cover it too.
 */
export function selectInverter(
  products: Product[],
  kWp: number,
  phase: 1 | 3,
  needsHybrid: boolean,
  orientation: Orientation,
  settings: Settings,
  batteryBrand?: string,
): { inverter: Product | null; reason: string } {
  const maxRatio = maxRatioFor(orientation, settings);
  let candidates = products
    .filter((p) => p.category === 'inverter' && p.phase === phase)
    .filter((p) => !needsHybrid || p.hybrid)
    .filter((p) => inverterFits(p, kWp, orientation, settings));

  let brandNote = '';
  if (needsHybrid && batteryBrand) {
    const sameBrand = candidates.filter((p) => p.brand === batteryBrand);
    if (sameBrand.length) candidates = sameBrand;
    else if (candidates.length) brandNote = ` No ${batteryBrand} hybrid fits; check battery compatibility.`;
  }
  candidates.sort((a, b) => a.costPrice - b.costPrice || (a.acKw ?? 0) - (b.acKw ?? 0));

  const inverter = candidates[0] ?? null;
  const kind = `${phase}-phase ${needsHybrid ? `${batteryBrand && !brandNote ? `${batteryBrand} ` : ''}hybrid ` : ''}inverter`;
  if (!inverter) {
    return { inverter: null, reason: `No ${kind} in the price list fits a ${kWp.toFixed(2)} kWp array.` };
  }
  const ratio = kWp / (inverter.acKw ?? 1);
  return {
    inverter,
    reason: `Cheapest ${kind} for ${kWp.toFixed(2)} kWp (DC:AC ${ratio.toFixed(2)}, max ${maxRatio}).${brandNote}`,
  };
}

/** Labour discount for sites with several plots, from the settings tiers */
export function multiPlotDiscount(plots: number, settings: Settings): number {
  let pct = 0;
  for (const [minPlots, p] of [...settings.labour.multiPlotDiscount].sort((a, b) => a[0] - b[0])) {
    if (plots >= minPlots) pct = p;
  }
  return pct;
}

function priceHouseType(
  ht: HouseTypeInput,
  catalog: Catalog,
  settings: Settings,
  labourDiscountPct: number,
): { result: HouseTypeResult; needsG99: boolean } {
  const bySku = new Map(catalog.products.map((p) => [p.sku, p]));
  const warnings: string[] = [];
  const lines: Line[] = [];

  const panel = bySku.get(ht.panelSku);
  const watts = panel?.watts ?? 0;
  if (!panel) warnings.push('Choose a panel.');
  const kWp = round2((ht.panelCount * watts) / 1000);

  if (panel && ht.panelCount > 0) {
    lines.push(line(settings, 'panel', `${panel.brand} ${panel.name}`, ht.panelCount, panel.costPrice, panel.sku));
  }

  // Inverter and battery. A bundle supplies both.
  const battery = ht.batterySku ? bySku.get(ht.batterySku) ?? null : null;
  const bundle = battery?.category === 'bundle' ? battery : null;
  let inverter: Product | null = null;
  let inverterReason = '';
  let autoSelected = false;

  if (bundle) {
    inverter = bundle;
    inverterReason = 'Inverter is included in the battery bundle.';
    if (ht.inverterSku) warnings.push('Inverter choice ignored: the battery bundle includes its own inverter.');
    if (kWp > 0 && !inverterFits(bundle, kWp, ht.orientation, settings)) {
      warnings.push(`The bundle's ${bundle.acKw} kW inverter is too small for ${kWp.toFixed(2)} kWp; pick a larger bundle.`);
    }
    if (bundle.phase !== ht.phase) warnings.push('The bundle inverter does not match the supply phase.');
    lines.push(line(settings, 'battery', `${bundle.brand} ${bundle.name}`, 1, bundle.costPrice, bundle.sku));
  } else {
    if (ht.inverterSku) {
      inverter = bySku.get(ht.inverterSku) ?? null;
      inverterReason = 'Chosen manually.';
      if (inverter && battery && !inverter.hybrid) warnings.push('A battery is fitted but the chosen inverter is not hybrid.');
      if (inverter && inverter.phase !== ht.phase) warnings.push('The chosen inverter does not match the supply phase.');
      if (inverter && kWp > 0 && !inverterFits(inverter, kWp, ht.orientation, settings)) {
        warnings.push(`The chosen ${inverter.acKw} kW inverter is too small for ${kWp.toFixed(2)} kWp.`);
      }
    } else if (kWp > 0) {
      ({ inverter, reason: inverterReason } = selectInverter(
        catalog.products, kWp, ht.phase, !!battery, ht.orientation, settings, battery?.brand,
      ));
      autoSelected = true;
    }
    if (inverter) {
      lines.push(line(settings, 'inverter', `${inverter.brand} ${inverter.name}`, 1, inverter.costPrice, inverter.sku));
    } else if (kWp > 0) {
      warnings.push(inverterReason);
    }
    if (battery) {
      lines.push(line(settings, 'battery', `${battery.brand} ${battery.name}`, 1, battery.costPrice, battery.sku));
    }
  }

  if (autoSelected && inverter && (inverter.acKw ?? 0) > kWp * 1.6) {
    warnings.push(
      `The smallest suitable inverter in the price list is ${inverter.acKw} kW, oversized for ${kWp.toFixed(2)} kWp. Add smaller inverters to the supplier price list.`,
    );
  }
  for (const p of new Set([panel, inverter, battery])) {
    if (p?.notes && !warnings.includes(p.notes)) warnings.push(`${p.brand} ${p.name}: ${p.notes}`);
  }

  // Mounting: kit per panel by roof type. Flat roofs also need ballast; east/west
  // back-to-back frames share parts and need less ballast than south-facing rows.
  if (ht.panelCount > 0) {
    const flatEW = ht.roofType === 'flat' && ht.orientation === 'E_W';
    if (flatEW) {
      lines.push(line(settings, 'mounting', 'Flat-roof east/west mounting (back-to-back)', ht.panelCount, settings.flatEastWestPerPanel));
    } else {
      const m = settings.mounting[ht.roofType];
      const desc = ht.roofType === 'flat'
        ? 'Flat-roof south-facing mounting (incl. windbreakers)'
        : `Mounting kit – ${ROOF_LABELS[ht.roofType].toLowerCase()}`;
      lines.push(line(settings, 'mounting', desc, ht.panelCount, m.perPanel));
      if (ht.arrays > 1) {
        lines.push(line(settings, 'mounting', 'Additional array (rail offcuts, end clamps, caps)', ht.arrays - 1, m.perArray));
      }
    }
    if (ht.roofType === 'flat') {
      const b = settings.ballast;
      const blocks = Math.ceil(ht.panelCount * (flatEW ? b.blocksPerPanelEW : b.blocksPerPanelSouth));
      lines.push(line(settings, 'mounting', 'Ballast blocks', blocks, b.blockCost));
    }
  }

  // Electrical (to the AC isolator; anything further is entered as an extra)
  if (ht.panelCount > 0) {
    const cable = Math.max(0, ht.dcCableMetres || 0);
    if (cable > 0) {
      lines.push(line(settings, 'electrical', 'DC solar cable (m)', cable, settings.electrical.dcCablePer100m / 100));
    } else {
      warnings.push('Enter the estimated DC cable length per plot.');
    }
    lines.push(line(settings, 'electrical', 'DC isolator, generation meter, AC isolator & cabling', 1, settings.electrical.fixedPerPlot));
  }

  // Labour, from the labour curve, less any multi-plot discount
  if (ht.panelCount > 0) {
    const factor = settings.labour.roofFactor[ht.roofType] ?? 1;
    const notes = [
      factor !== 1 ? `×${factor} roof` : '',
      labourDiscountPct > 0 ? `−${labourDiscountPct}% multi-plot` : '',
    ].filter(Boolean).join(', ');
    lines.push(line(
      settings, 'labour',
      `Installation, testing & commissioning – ${ht.panelCount} panels${notes ? ` (${notes})` : ''}`,
      1, round2(labourFor(ht.panelCount, ht.roofType, settings) * (1 - labourDiscountPct / 100)),
    ));
  }
  if (battery) lines.push(line(settings, 'labour', 'Battery installation', 1, settings.labour.batteryInstall));
  if (ht.panelCount > 0) {
    for (const c of settings.perPlotCosts) lines.push(line(settings, 'labour', c.description, 1, c.cost));
  }

  // Scaffolding / access: entered per project, since it isn't always needed
  if (ht.panelCount > 0 && (ht.scaffoldPerPlot || 0) > 0) {
    lines.push(line(settings, 'access', 'Scaffolding / access', 1, ht.scaffoldPerPlot));
  }

  // Checks
  if (ht.orientation === 'N') warnings.push('North-facing arrays generate much less; check the customer understands.');
  const needsG99 = !!inverter && ht.phase === 1 && (inverter.acKw ?? 0) > settings.g98LimitKw;
  if (needsG99) warnings.push(`Inverter is over ${settings.g98LimitKw} kW single-phase; a G99 application is needed.`);
  if (ht.roofType !== 'flat' && ht.orientation === 'E_W' && ht.arrays < 2) {
    warnings.push('East/west on a pitched roof is normally two roof faces; set arrays to 2.');
  }
  if (ht.roofType === 'flat' && ht.arrays > 1 && ht.orientation === 'E_W') {
    warnings.push('Flat-roof E/W systems are priced per panel; additional arrays are not added.');
  }

  // Selling price: the solar system is sold as a package at a fixed price per unit
  // plus a price per panel. Its component lines keep their cost (shown internally)
  // but carry no separate price. Battery, scaffolding and extras are priced on top.
  const dp = settings.developerPricing;
  if (dp && ht.panelCount > 0) {
    const packaged = new Set<LineCategory>(['panel', 'inverter', 'mounting', 'electrical', 'labour']);
    for (const l of lines) if (packaged.has(l.category) && l.description !== 'Battery installation') l.sell = 0;
    const perPanel = dp.perPanel + (dp.roofAdjustmentPerPanel[ht.roofType] ?? 0);
    lines.unshift({
      description: `Solar PV system – ${ht.panelCount} panels`,
      category: 'package', qty: 1, unitCost: 0, cost: 0,
      sell: round2(dp.perUnit + perPanel * ht.panelCount),
    });
  }

  const costPerPlot = round2(lines.reduce((s, l) => s + l.cost, 0));
  const sellPerPlot = round2(lines.reduce((s, l) => s + l.sell, 0));
  const plots = Math.max(0, ht.plots);

  return {
    needsG99,
    result: {
      id: ht.id,
      name: ht.name,
      plots,
      kWp,
      annualKwhPerPlot: Math.round(kWp * settings.specificYield[ht.orientation]),
      inverter,
      inverterReason,
      lines,
      costPerPlot,
      sellPerPlot,
      costTotal: round2(costPerPlot * plots),
      sellTotal: round2(sellPerPlot * plots),
      warnings,
    },
  };
}

export function priceQuote(input: QuoteInput, catalog: Catalog, settings: Settings): QuoteResult {
  const plots = input.houseTypes.reduce((s, h) => s + Math.max(0, h.plots), 0);
  const labourDiscountPct = input.labourDiscountPct ?? multiPlotDiscount(plots, settings);
  const priced = input.houseTypes.map((ht) => priceHouseType(ht, catalog, settings, labourDiscountPct));
  const houseTypes = priced.map((p) => p.result);

  // Project-level lines (once per project, or multiplied across every plot)
  const projectLines: Line[] = [];
  for (const e of input.extras) {
    if (!e.description && !e.unitCost) continue;
    const qty = e.per === 'plot' ? e.qty * plots : e.qty;
    const l = line(settings, 'extras', e.description || 'Extra', qty, e.unitCost);
    // A fixed selling price per unit overrides the markup
    if (e.unitPrice != null) l.sell = round2(qty * e.unitPrice);
    projectLines.push(l);
  }
  if (priced.some((p) => p.needsG99 && p.result.plots > 0)) {
    projectLines.push(line(settings, 'extras', 'DNO G99 application', 1, settings.g99ApplicationCost));
  }

  const cost = round2(houseTypes.reduce((s, h) => s + h.costTotal, 0) + projectLines.reduce((s, l) => s + l.cost, 0));
  const subtotal = round2(houseTypes.reduce((s, h) => s + h.sellTotal, 0) + projectLines.reduce((s, l) => s + l.sell, 0));
  const discount = round2(
    Math.min(subtotal, input.discount.type === 'percent' ? (subtotal * input.discount.value) / 100 : input.discount.value),
  );
  const net = round2(subtotal - discount);
  const vat = round2((net * input.vatRate) / 100);
  const margin = round2(net - cost);

  // Stock check across all plots
  const need = new Map<string, number>();
  for (const h of houseTypes) {
    for (const l of h.lines) {
      if (l.sku) need.set(l.sku, (need.get(l.sku) ?? 0) + l.qty * h.plots);
    }
  }
  const bySku = new Map(catalog.products.map((p) => [p.sku, p]));
  const availability: AvailabilityRow[] = [...need.entries()]
    .filter(([, required]) => required > 0)
    .map(([sku, required]) => {
      const p = bySku.get(sku)!;
      const status: AvailabilityRow['status'] =
        p.stock === null ? 'unknown' : p.stock >= required ? 'in_stock' : p.stock > 0 ? 'partial' : 'out_of_stock';
      return { sku, name: `${p.brand} ${p.name}`, required, stock: p.stock, leadTimeDays: p.leadTimeDays, status };
    });

  const warnings: string[] = [];
  if (!catalog.live) {
    if (catalog.priceDate) {
      const days = Math.floor((Date.now() - Date.parse(catalog.priceDate)) / 86_400_000);
      warnings.push(`Prices come from a price sheet dated ${catalog.priceDate} (${days} days old), not a live feed.`);
    } else {
      warnings.push(`Prices are sample data from "${catalog.source}", not a live supplier feed.`);
    }
  }
  if (availability.some((a) => a.status === 'partial' || a.status === 'out_of_stock')) {
    warnings.push('Some items are short of stock; check lead times.');
  }
  if (availability.some((a) => a.status === 'unknown')) {
    warnings.push('The supplier does not publish stock levels; confirm availability before ordering.');
  }

  return {
    houseTypes,
    projectLines,
    totals: {
      plots,
      kWp: round2(houseTypes.reduce((s, h) => s + h.kWp * h.plots, 0)),
      annualKwh: houseTypes.reduce((s, h) => s + h.annualKwhPerPlot * h.plots, 0),
      cost,
      subtotal,
      discount,
      net,
      vat,
      gross: round2(net + vat),
      margin,
      marginPct: net > 0 ? round2((margin / net) * 100) : 0,
      labourDiscountPct,
    },
    availability,
    warnings,
  };
}
