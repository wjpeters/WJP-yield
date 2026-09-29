export type Instrument = {
  id: string;
  symbol: string;
  name: string;
  assetClass: string;
  exchange: string;
  currency: string;
  base?: string;
  mappings: Record<string, string>;
};
export type Quote = {
  instrumentId: string;
  providerId: string;
  provider: string;
  price: number;
  bid: number | null;
  ask: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  changePct: number | null;
  sourceAt: number | null;
  receivedAt: number;
  currency: string;
  venue: string;
  transport: string;
  timeliness: string;
  stale: boolean;
  marketOpen?: boolean;
};
export type Provider = {
  id: string;
  type: string;
  name: string;
  priority: number;
  enabled: boolean;
  rpm: number;
  hasKey: boolean;
  health: {
    status: string;
    lastReceived: number | null;
    latencyMs: number | null;
    failures: number;
    openUntil: number;
    error: string | null;
    usedThisMinute: number;
  };
};
export type Watchlist = { id: string; name: string; instruments: string[] };
export type AdapterInfo = {
  type: string;
  name: string;
  description: string;
  classes: string[];
  keyRequired: boolean;
  website: string;
};
export type State = {
  adapters: AdapterInfo[];
  at: number;
  instruments: Instrument[];
  watchlists: Watchlist[];
  quotes: Record<string, Quote | null>;
  comparisons: Record<string, Quote[]>;
  providers: Provider[];
  events: {
    at: number;
    instrument: string;
    from: string;
    to: string;
    reason: string;
  }[];
};
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};
export type History = {
  candles: Candle[];
  provider: string;
  providerId: string;
  venue: string;
  interval: string;
  fetchedAt: number;
  cached: boolean;
  failures: { provider: string; error: string }[];
};
export const classNames: Record<string, string> = {
  crypto: "Crypto",
  stock: "Aandelen",
  etf: "ETF’s",
  forex: "Valuta",
  commodity: "Grondstoffen",
  index: "Indices",
  bond: "Obligaties",
  future: "Futures",
};
