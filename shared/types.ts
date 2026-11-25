// ---------- Supplier catalogue ----------

/** 'bundle' = hybrid inverter + battery sold together */
export type ProductCategory = 'panel' | 'inverter' | 'battery' | 'bundle';

export interface Product {
  sku: string;
  supplier: string;
  category: ProductCategory;
  brand: string;
  name: string;
  /** Trade cost price, ex VAT, GBP */
  costPrice: number;
  /** Units the supplier reports in stock; null when the supplier doesn't publish stock */
  stock: number | null;
  /** Lead time when out of stock, in days */
  leadTimeDays: number;
  // panel
  watts?: number;
  // inverter
  acKw?: number;
  maxDcKw?: number;
  phase?: 1 | 3;
  hybrid?: boolean;
  // battery / bundle
  capacityKwh?: number;
  /** Caveats shown to the user when this product is chosen */
  notes?: string;
  /** Supplier product page */
  url?: string;
}

export interface Catalog {
  source: string;
  /** true when prices come from a live supplier feed, false for sample data */
  live: boolean;
  fetchedAt: string;
  /** Date the prices were taken, for price sheets (ISO date) */
  priceDate?: string;
  products: Product[];
}

// ---------- Quote input ----------

export type RoofType = 'pitched_tile' | 'pitched_slate' | 'in_roof' | 'flat';
export type Orientation = 'S' | 'SE_SW' | 'E_W' | 'E' | 'W' | 'N';
export type ProjectType = 'developer' | 'residential' | 'commercial';

export interface HouseTypeInput {
  id: string;
  /** e.g. "The Ashford – 3 bed semi" */
  name: string;
  /** Number of plots of this house type */
  plots: number;
  panelSku: string;
  panelCount: number;
  roofType: RoofType;
  orientation: Orientation;
  /** Number of separate arrays (roof faces) the panels are split over */
  arrays: number;
  phase: 1 | 3;
  /** A standalone battery, or an inverter + battery bundle (which replaces the inverter) */
  batterySku: string | null;
  /** Force a specific inverter instead of auto-selecting */
  inverterSku: string | null;
}

export interface ExtraInput {
  id: string;
  description: string;
  /** Cost to us, ex VAT, per unit */
  unitCost: number;
  qty: number;
  /** 'plot' = multiplied by every plot on the site, 'project' = once */
  per: 'plot' | 'project';
}

export interface QuoteInput {
  projectType: ProjectType;
  project: {
    clientName: string;
    siteName: string;
    siteAddress: string;
    reference: string;
  };
  houseTypes: HouseTypeInput[];
  extras: ExtraInput[];
  discount: { type: 'percent' | 'amount'; value: number };
  vatRate: number;
}

// ---------- Settings ----------

export interface Settings {
  /** Markup on cost, percent, by line category */
  markup: Record<LineCategory, number>;
  mounting: Record<RoofType, { perPanel: number; perArray: number }>;
  /** Flat-roof east/west ballasted systems are priced separately */
  flatEastWestPerPanel: number;
  labour: { perPanel: number; perPlot: number; batteryInstall: number };
  perPlotCosts: { description: string; cost: number; roofTypes: RoofType[] }[];
  /** kWh generated per kWp per year */
  specificYield: Record<Orientation, number>;
  /** Max DC:AC ratio when sizing inverters */
  maxDcAcRatio: { default: number; E_W: number };
  /** Single-phase export above this needs a G99 application (UK) */
  g98LimitKw: number;
  g99ApplicationCost: number;
}

// ---------- Result ----------

export type LineCategory = 'panel' | 'inverter' | 'battery' | 'mounting' | 'labour' | 'extras';

export interface Line {
  description: string;
  category: LineCategory;
  qty: number;
  unitCost: number;
  cost: number;
  sell: number;
  sku?: string;
}

export interface HouseTypeResult {
  id: string;
  name: string;
  plots: number;
  kWp: number;
  annualKwhPerPlot: number;
  inverter: Product | null;
  inverterReason: string;
  lines: Line[];
  costPerPlot: number;
  sellPerPlot: number;
  costTotal: number;
  sellTotal: number;
  warnings: string[];
}

export interface AvailabilityRow {
  sku: string;
  name: string;
  required: number;
  stock: number | null;
  leadTimeDays: number;
  status: 'in_stock' | 'partial' | 'out_of_stock' | 'unknown';
}

export interface QuoteResult {
  houseTypes: HouseTypeResult[];
  projectLines: Line[];
  totals: {
    plots: number;
    kWp: number;
    annualKwh: number;
    cost: number;
    subtotal: number;
    discount: number;
    net: number;
    vat: number;
    gross: number;
    margin: number;
    marginPct: number;
  };
  availability: AvailabilityRow[];
  warnings: string[];
}
