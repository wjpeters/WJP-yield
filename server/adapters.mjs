import { okxAdapter } from "./okx.mjs";
import { alpacaAdapter } from "./alpaca.mjs";
import { intervals, normalizeCandles } from "./domain.mjs";
import { candleSource } from "./timeframes.mjs";
const num = (v) => (v == null || v === "" ? null : Number(v));
function twelveError(status) {
  const error = new Error(
    status === 401
      ? "API-sleutel ongeldig"
      : status === 429
        ? "Rate limit bereikt"
        : status === 404
          ? "Instrument niet gevonden bij Twelve Data; controleer symbool en beurs"
          : status === 403
            ? "Twelve Data: abonnement geeft geen toegang tot deze data"
            : status === 400
              ? "Twelve Data: ongeldige aanvraagparameters"
              : `Twelve Data antwoordt met HTTP ${status}`,
  );
  error.status = status;
  if (status === 404) error.scope = "instrument";
  return error;
}
export async function json(url, provider) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(9000),
    headers: { "User-Agent": "WJP-yield/0.1" },
  });
  if (!response.ok) {
    if (provider === "twelve") throw twelveError(response.status);
    const error = new Error(
      response.status === 429
        ? "Rate limit bereikt"
        : `Bron antwoordt met HTTP ${response.status}`,
    );
    error.status = response.status;
    throw error;
  }
  return response.json();
}
export const adapters = {
  alpaca: alpacaAdapter,
  okx: okxAdapter,
  kraken: {
    async quote(i) {
      const d = await json(
        `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(i.mappings.krakenRest ?? i.mappings.kraken.replace("BTC", "XBT").replace("/", ""))}`,
      );
      if (d.error?.length)
        throw new Error("Kraken kan dit instrument niet leveren");
      const q = Object.values(d.result)[0];
      return {
        price: num(q.c[0]),
        bid: num(q.b[0]),
        ask: num(q.a[0]),
        high: num(q.h[1]),
        low: num(q.l[1]),
        volume: num(q.v[1]),
        changePct: null,
        sourceAt: null,
        venue: "Kraken",
        timeliness: "received",
      };
    },
    async candles(i, interval) {
      const source = candleSource("kraken", interval);
      const d = await json(
        `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(i.mappings.krakenRest ?? i.mappings.kraken.replace("BTC", "XBT").replace("/", ""))}&interval=${intervals[source] / 60}`,
      );
      if (d.error?.length) throw new Error("Kraken-historie niet beschikbaar");
      return normalizeCandles(
        Object.entries(d.result)
          .find(([k]) => k !== "last")?.[1]
          .map((r) => ({
            time: +r[0],
            open: +r[1],
            high: +r[2],
            low: +r[3],
            close: +r[4],
            volume: +r[6],
          })) ?? [],
        source === interval ? 500 : Infinity,
      );
    },
  },
  coinbase: {
    async quote(i) {
      const q = await json(
        `https://api.exchange.coinbase.com/products/${encodeURIComponent(i.mappings.coinbase)}/ticker`,
      );
      return {
        price: num(q.price),
        bid: num(q.bid),
        ask: num(q.ask),
        volume: num(q.volume),
        high: null,
        low: null,
        changePct: null,
        sourceAt: Date.parse(q.time),
        venue: "Coinbase",
        timeliness: "realtime",
      };
    },
    async candles(i, interval) {
      const source = candleSource("coinbase", interval);
      const d = await json(
        `https://api.exchange.coinbase.com/products/${encodeURIComponent(i.mappings.coinbase)}/candles?granularity=${intervals[source]}`,
      );
      if (!Array.isArray(d))
        throw new Error("Coinbase-historie niet beschikbaar");
      return normalizeCandles(
        d.map((r) => ({
          time: +r[0],
          low: +r[1],
          high: +r[2],
          open: +r[3],
          close: +r[4],
          volume: +r[5],
        })),
      );
    },
  },
  twelve: {
    async quote(i, _interval, key) {
      const params = new URLSearchParams({
        symbol: i.mappings.twelve,
        apikey: key,
        timezone: "UTC",
        ...(i.exchange !== "OTC" ? { exchange: i.exchange } : {}),
      });
      const q = await json(
        `https://api.twelvedata.com/quote?${params}`,
        "twelve",
      );
      if (q.status === "error") throw twelveError(Number(q.code));
      if (
        q.symbol &&
        q.symbol.toUpperCase() !== i.mappings.twelve.toUpperCase()
      )
        throw new Error("Symbool wijkt af van instrument");
      if (
        q.exchange &&
        i.exchange !== "OTC" &&
        q.exchange.toUpperCase() !== i.exchange.toUpperCase()
      )
        throw new Error("Beurs wijkt af van instrument");
      if (q.currency && q.currency !== i.currency)
        throw new Error("Quotevaluta wijkt af van instrument");
      return {
        price: num(q.close),
        bid: null,
        ask: null,
        high: num(q.high),
        low: num(q.low),
        volume: num(q.volume),
        changePct: num(q.percent_change),
        sourceAt: q.last_quote_at ? Number(q.last_quote_at) * 1000 : null,
        barStartAt: q.timestamp ? Number(q.timestamp) * 1000 : null,
        venue: q.exchange || i.exchange,
        timeliness: "entitlement",
        marketOpen: q.is_market_open,
      };
    },
    async candles(i, interval, key) {
      const source = candleSource("twelve", interval);
      const names = {
        "1m": "1min",
        "5m": "5min",
        "15m": "15min",
        "1h": "1h",
        "30m": "30min",
        "2h": "2h",
        "4h": "4h",
        "1d": "1day",
        "1w": "1week",
        "1mo": "1month",
      };
      const params = new URLSearchParams({
        symbol: i.mappings.twelve,
        interval: names[source],
        outputsize: "250",
        timezone: "UTC",
        apikey: key,
        ...(i.exchange !== "OTC" ? { exchange: i.exchange } : {}),
      });
      const d = await json(
        `https://api.twelvedata.com/time_series?${params}`,
        "twelve",
      );
      if (d.status === "error") throw twelveError(Number(d.code));
      if (
        d.meta?.symbol &&
        d.meta.symbol.toUpperCase() !== i.mappings.twelve.toUpperCase()
      )
        throw new Error("Historie-symbool wijkt af van instrument");
      if (
        d.meta?.exchange &&
        i.exchange !== "OTC" &&
        d.meta.exchange.toUpperCase() !== i.exchange.toUpperCase()
      )
        throw new Error("Historiebeurs wijkt af van instrument");
      if (d.meta?.currency && d.meta.currency !== i.currency)
        throw new Error("Historievaluta wijkt af van instrument");
      return normalizeCandles(
        (d.values ?? []).map((r) => ({
          time:
            Date.parse(
              r.datetime.length === 10
                ? r.datetime + "T00:00:00Z"
                : r.datetime.replace(" ", "T") + "Z",
            ) / 1000,
          open: +r.open,
          high: +r.high,
          low: +r.low,
          close: +r.close,
          volume: r.volume == null ? null : +r.volume,
        })),
      );
    },
  },
};
export function streamQuote(type, d) {
  if (type === "kraken")
    return {
      symbol: d.symbol,
      price: +d.last,
      bid: num(d.bid),
      ask: num(d.ask),
      high: num(d.high),
      low: num(d.low),
      volume: num(d.volume),
      changePct: num(d.change_pct),
      sourceAt: d.timestamp ? Date.parse(d.timestamp) : null,
      venue: "Kraken",
      timeliness: "realtime",
    };
  return {
    symbol: d.product_id.replace("-", "/"),
    price: +d.price,
    bid: num(d.best_bid),
    ask: num(d.best_ask),
    high: num(d.high_24h),
    low: num(d.low_24h),
    volume: num(d.volume_24h),
    changePct: +d.open_24h > 0 ? (+d.price / +d.open_24h - 1) * 100 : null,
    sourceAt: d.time ? Date.parse(d.time) : null,
    venue: "Coinbase",
    timeliness: "realtime",
  };
}

export function supportsInstrument(i, p) {
  const source = i.catalogSources?.[p.id];
  if (
    i.catalogSources &&
    (!source || source.type !== p.type || source.feed !== (p.feed ?? ""))
  )
    return false;
  return !!i.mappings[p.type] && (adapters[p.type]?.supports?.(i, p) ?? true);
}
