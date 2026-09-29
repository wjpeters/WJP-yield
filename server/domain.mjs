export const intervals = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "1d": 86400,
};
export const catalog = [
  ...[
    ["BTC", "Bitcoin"],
    ["ETH", "Ethereum"],
    ["SOL", "Solana"],
    ["XRP", "XRP"],
    ["ADA", "Cardano"],
    ["DOGE", "Dogecoin"],
    ["LINK", "Chainlink"],
    ["AVAX", "Avalanche"],
    ["LTC", "Litecoin"],
  ].map(([base, name]) => ({
    id: `crypto:${base}:USD`,
    symbol: `${base}/USD`,
    name,
    assetClass: "crypto",
    exchange: "MULTI",
    currency: "USD",
    base,
    mappings: { kraken: `${base}/USD`, coinbase: `${base}-USD` },
  })),
  ...[
    ["AAPL", "Apple", "NASDAQ"],
    ["MSFT", "Microsoft", "NASDAQ"],
    ["NVDA", "NVIDIA", "NASDAQ"],
    ["AMZN", "Amazon", "NASDAQ"],
    ["GOOGL", "Alphabet", "NASDAQ"],
    ["TSLA", "Tesla", "NASDAQ"],
    ["ASML", "ASML", "NASDAQ"],
    ["SPY", "S&P 500 ETF", "NYSE"],
    ["QQQ", "Nasdaq 100 ETF", "NASDAQ"],
  ].map(([symbol, name, exchange]) => ({
    id: `stock:${exchange}:${symbol}:USD`,
    symbol,
    name,
    assetClass: symbol === "SPY" || symbol === "QQQ" ? "etf" : "stock",
    exchange,
    currency: "USD",
    mappings: { twelve: symbol },
  })),
  ...[
    ["EUR/USD", "Euro / US Dollar", "forex"],
    ["GBP/USD", "Pound / US Dollar", "forex"],
    ["USD/JPY", "US Dollar / Yen", "forex"],
    ["XAU/USD", "Gold / US Dollar", "commodity"],
    ["XAG/USD", "Silver / US Dollar", "commodity"],
  ].map(([symbol, name, assetClass]) => ({
    id: `${assetClass}:${symbol}`,
    symbol,
    name,
    assetClass,
    exchange: "OTC",
    currency: symbol.split("/")[1],
    mappings: { twelve: symbol },
  })),
];
export function validQuote(q) {
  return (
    Number.isFinite(q.price) &&
    q.price > 0 &&
    Number.isFinite(q.receivedAt) &&
    (q.sourceAt == null ||
      (Number.isFinite(q.sourceAt) && q.sourceAt <= q.receivedAt + 30000)) &&
    [q.bid, q.ask, q.high, q.low, q.volume].every(
      (x) => x == null || (Number.isFinite(x) && x >= 0),
    )
  );
}
export function quoteAge(q, now = Date.now()) {
  return Math.max(0, now - (q.sourceAt ?? q.receivedAt));
}
export function isFresh(q, now = Date.now()) {
  return (
    quoteAge(q, now) <=
    (q.transport === "WebSocket"
      ? 45000
      : q.assetClass === "crypto"
        ? 60000
        : 120000)
  );
}
export function selectQuote(providers, quotes, now = Date.now()) {
  const available = providers
    .filter((p) => p.enabled)
    .sort((a, b) => a.priority - b.priority)
    .map((p) => quotes.get(p.id))
    .filter(Boolean);
  const fresh = available.find((q) => isFresh(q, now));
  return fresh
    ? { ...fresh, stale: false }
    : available.length
      ? {
          ...available.sort(
            (a, b) =>
              (b.sourceAt ?? b.receivedAt) - (a.sourceAt ?? a.receivedAt),
          )[0],
          stale: true,
        }
      : null;
}
export function normalizeCandles(rows) {
  const out = new Map();
  for (const c of rows) {
    if (
      ![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) ||
      c.time <= 0 ||
      Math.min(c.open, c.high, c.low, c.close) <= 0 ||
      c.low > Math.min(c.open, c.close) ||
      c.high < Math.max(c.open, c.close) ||
      c.high < c.low ||
      c.time > Date.now() / 1000 + 60 ||
      (c.volume != null && (!Number.isFinite(c.volume) || c.volume < 0))
    )
      continue;
    out.set(c.time, c);
  }
  return [...out.values()].sort((a, b) => a.time - b.time).slice(-500);
}
export const adaptersInfo = [
  {
    type: "kraken",
    name: "Kraken",
    description: "Crypto spot · publieke WebSocket + REST",
    classes: ["crypto"],
    keyRequired: false,
    website: "https://www.kraken.com",
  },
  {
    type: "coinbase",
    name: "Coinbase",
    description: "Crypto spot · onafhankelijke vergelijkingsbron",
    classes: ["crypto"],
    keyRequired: false,
    website: "https://www.coinbase.com",
  },
  {
    type: "twelve",
    name: "Twelve Data",
    description:
      "Aandelen, ETF’s, forex & metalen · REST · dekking per abonnement",
    classes: ["stock", "etf", "forex", "commodity"],
    keyRequired: true,
    website: "https://twelvedata.com",
  },
];
