import WebSocket from "ws";
import { normalizeCandles } from "./domain.mjs";
const apiRoot = "https://data.alpaca.markets";
import { periodStart } from "./timeframes.mjs";
const frames = {
  "1m": "1Min",
  "5m": "5Min",
  "15m": "15Min",
  "1h": "1Hour",
  "30m": "30Min",
  "2h": "2Hour",
  "4h": "4Hour",
  "6h": "6Hour",
  "12h": "12Hour",
  "1d": "1Day",
  "1w": "1Week",
  "1mo": "1Month",
  "3mo": "3Month",
  "1y": "12Month",
};
const lookbackDays = {
  "1m": 7,
  "5m": 14,
  "15m": 30,
  "30m": 60,
  "1h": 90,
  "2h": 180,
  "4h": 365,
  "6h": 365,
  "12h": 730,
  "1d": 730,
  "1w": 3653,
  "1mo": 7305,
  "3mo": 7305,
  "1y": 7305,
};
const number = (v) => (v == null || v === "" ? null : Number(v));
const positive = (v) =>
  Number.isFinite(number(v)) && number(v) > 0 ? number(v) : null;
export function alpacaFeed(p) {
  return p.feed ?? "iex";
}
export function alpacaVenue(p) {
  return alpacaFeed(p) === "crypto_us"
    ? "Alpaca US"
    : alpacaFeed(p) === "sip"
      ? "US consolidated · SIP"
      : "IEX";
}
export function alpacaSupports(i, p) {
  return (
    !!i.mappings.alpaca &&
    i.currency === "USD" &&
    (alpacaFeed(p) === "crypto_us"
      ? i.assetClass === "crypto"
      : ["stock", "etf"].includes(i.assetClass) &&
        ["NASDAQ", "NYSE", "NYSEARCA", "AMEX", "ARCA", "BATS"].includes(
          i.exchange.toUpperCase(),
        ))
  );
}
export function alpacaCredentials(secret) {
  try {
    const data = JSON.parse(secret);
    if (
      typeof data.key !== "string" ||
      !data.key ||
      typeof data.secret !== "string" ||
      !data.secret
    )
      throw new Error();
    return data;
  } catch {
    throw new Error("Voeg zowel de Alpaca API Key ID als Secret Key toe");
  }
}
async function request(path, params, secret) {
  const credentials = alpacaCredentials(secret);
  let response;
  try {
    response = await fetch(`${apiRoot}${path}?${params}`, {
      signal: AbortSignal.timeout(9000),
      headers: {
        "APCA-API-KEY-ID": credentials.key,
        "APCA-API-SECRET-KEY": credentials.secret,
        "User-Agent": "WJP-yield/0.1",
      },
    });
  } catch {
    throw new Error("Alpaca is tijdelijk niet bereikbaar");
  }
  if (!response.ok) {
    // Inspect only a known error category; never forward provider text or credentials.
    const body =
      response.status === 400 ? await response.json().catch(() => ({})) : {};
    const invalidSymbol =
      response.status === 400 &&
      typeof body.message === "string" &&
      /\binvalid symbol\b/i.test(body.message);
    const e = new Error(
      invalidSymbol
        ? "Instrument niet gevonden bij Alpaca; controleer symbool en beurs"
        : response.status === 400
          ? "Alpaca: ongeldige aanvraagparameters"
          : response.status === 401
            ? "Alpaca-sleutels ontbreken of zijn ongeldig"
            : response.status === 403
              ? "Alpaca: geen toegang tot deze feed; controleer je datarechten"
              : response.status === 429
                ? "Alpaca-aanvraaglimiet bereikt"
                : `Alpaca antwoordt met HTTP ${response.status}`,
    );
    e.status = response.status;
    if (invalidSymbol) e.scope = "instrument";
    throw e;
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Ongeldig Alpaca-antwoord");
  }
}
const timestamp = (t) => (typeof t === "string" ? Date.parse(t) : NaN);
const baseQuote = (p) => ({
  bid: null,
  ask: null,
  high: null,
  low: null,
  volume: null,
  changePct: null,
  venue: alpacaVenue(p),
  feed: alpacaFeed(p),
  timeliness: "realtime",
});
export function alpacaSnapshot(snapshot, p) {
  const trade = snapshot?.latestTrade;
  const sourceAt = timestamp(trade?.t);
  if (!positive(trade?.p) || !Number.isFinite(sourceAt))
    throw new Error(
      "Alpaca heeft geen geldige laatste transactie voor dit instrument",
    );
  const quote = snapshot.latestQuote;
  const quoteAt = timestamp(quote?.t);
  const daily = snapshot.dailyBar,
    previous = snapshot.prevDailyBar;
  // Keep last-trade time distinct from quote and daily-bar timestamps.
  return {
    ...baseQuote(p),
    price: +trade.p,
    sourceAt,
    tradeId: trade.i ?? null,
    tradeVenue: trade.x ?? null,
    bid: Number.isFinite(quoteAt) ? positive(quote?.bp) : null,
    ask: Number.isFinite(quoteAt) ? positive(quote?.ap) : null,
    quoteAt: Number.isFinite(quoteAt) ? quoteAt : null,
    high: number(daily?.h),
    low: number(daily?.l),
    volume: number(daily?.v),
    statsAt: timestamp(daily?.t) || null,
    previousClose: positive(previous?.c),
    changePct: positive(previous?.c)
      ? (+trade.p / +previous.c - 1) * 100
      : null,
  };
}
export function alpacaStreamQuote(row, old, p) {
  const at = timestamp(row.t);
  if (!Number.isFinite(at) || at > Date.now() + 30000) return null;
  if (row.T === "t") {
    if (!positive(row.p) || (old?.sourceAt && at < old.sourceAt)) return null;
    const sameSession =
      old?.statsAt && at >= old.statsAt && at < old.statsAt + 86400000;
    const quoteFresh = old?.quoteAt && Math.abs(at - old.quoteAt) < 45000;
    return {
      ...baseQuote(p),
      price: +row.p,
      sourceAt: at,
      tradeId: row.i ?? null,
      tradeVenue: row.x ?? null,
      ...(sameSession
        ? {
            high: old.high,
            low: old.low,
            volume: old.volume,
            statsAt: old.statsAt,
            previousClose: old.previousClose,
            changePct: positive(old.previousClose)
              ? (+row.p / old.previousClose - 1) * 100
              : null,
          }
        : {}),
      bid: quoteFresh ? old.bid : null,
      ask: quoteFresh ? old.ask : null,
      quoteAt: quoteFresh ? old.quoteAt : null,
    };
  }
  if (
    row.T === "d" &&
    old &&
    at <= old.sourceAt &&
    old.sourceAt < at + 86400000 &&
    (!old.statsAt || at >= old.statsAt)
  ) {
    return {
      ...old,
      high: number(row.h),
      low: number(row.l),
      volume: number(row.v),
      statsAt: at,
    };
  }
  if (row.T === "q" && old && (!old.quoteAt || at >= old.quoteAt)) {
    return {
      ...old,
      bid: positive(row.bp),
      ask: positive(row.ap),
      quoteAt: at,
    };
  }
  return null;
}
export const alpacaAdapter = {
  supports: alpacaSupports,
  venue: (_i, p) => alpacaVenue(p),
  async quote(i, _interval, secret, p = {}) {
    if (!alpacaSupports(i, p))
      throw new Error("Instrument past niet bij de gekozen Alpaca-feed");
    const crypto = alpacaFeed(p) === "crypto_us";
    const params = new URLSearchParams({
      symbols: i.mappings.alpaca,
      ...(!crypto ? { feed: alpacaFeed(p) } : {}),
    });
    const data = await request(
      crypto ? "/v1beta3/crypto/us/snapshots" : "/v2/stocks/snapshots",
      params,
      secret,
    );
    return alpacaSnapshot(
      (crypto ? data.snapshots : data)?.[i.mappings.alpaca],
      p,
    );
  },
  async candles(i, interval, secret, p = {}) {
    if (!alpacaSupports(i, p) || !frames[interval])
      throw new Error(
        "Instrument of tijdsperiode niet ondersteund door Alpaca",
      );
    const crypto = alpacaFeed(p) === "crypto_us";
    const params = new URLSearchParams({
      symbols: i.mappings.alpaca,
      timeframe: frames[interval],
      limit: "500",
      sort: "desc",
      start: new Date(
        periodStart(
          (Date.now() - lookbackDays[interval] * 86400000) / 1000,
          interval,
        ) * 1000,
      ).toISOString(),
      ...(!crypto
        ? { feed: alpacaFeed(p), adjustment: "raw", currency: "USD" }
        : {}),
    });
    const data = await request(
      crypto ? "/v1beta3/crypto/us/bars" : "/v2/stocks/bars",
      params,
      secret,
    );
    // One symbol, descending: only the latest page is needed for this bounded chart.
    return normalizeCandles(
      (data.bars?.[i.mappings.alpaca] ?? []).map((r) => ({
        time: timestamp(r.t) / 1000,
        open: number(r.o),
        high: number(r.h),
        low: number(r.l),
        close: number(r.c),
        volume: number(r.v),
      })),
    );
  },
};
export function alpacaStreamError(code) {
  return (
    {
      400: "Alpaca: ongeldige streamaanvraag",
      401: "Alpaca: authenticatie vereist",
      402: "Alpaca: ongeldige API-sleutels",
      404: "Alpaca: authenticatie verlopen",
      405: "Alpaca: symboollimiet bereikt; overige koersen via REST",
      406: "Alpaca: verbindingslimiet bereikt; sluit andere streams met deze sleutels",
      407: "Alpaca: stream kon niet snel genoeg verwerkt worden",
      409: "Alpaca: abonnement geeft geen toegang tot deze feed",
      410: "Alpaca: streamkanaal niet beschikbaar",
    }[code] ?? "Alpaca-stream tijdelijk niet beschikbaar"
  );
}
// Lifecycle is injected so the engine owns reconnects, generation checks and shutdown.
export function connectAlpaca({
  provider: p,
  secret,
  instruments,
  isCurrent,
  schedule,
  onQuote,
  onInvalidate,
  getQuote,
  status,
  reconnect,
  WebSocketClass = WebSocket,
}) {
  const credentials = alpacaCredentials(secret);
  const feed = alpacaFeed(p);
  const ws = new WebSocketClass(
    `wss://stream.data.alpaca.markets/${feed === "crypto_us" ? "v1beta3/crypto/us" : `v2/${feed}`}`,
    { handshakeTimeout: 10000, maxPayload: 1024 * 1024 },
  );
  let authenticated = false,
    subscribed = [],
    desired = instruments,
    stopped = false,
    pong = true,
    retryDelay = 0;
  let subscribeTimer;
  const sync = (rows = desired) => {
    desired = rows;
    if (!authenticated || ws.readyState !== 1) return;
    const eligible = rows.filter((i) => alpacaSupports(i, p));
    const symbols = [...new Set(eligible.map((i) => i.mappings.alpaca))].slice(
      0,
      30,
    );
    const remove = subscribed.filter((s) => !symbols.includes(s));
    const add = symbols.filter((s) => !subscribed.includes(s));
    if (remove.length)
      ws.send(
        JSON.stringify({
          action: "unsubscribe",
          trades: remove,
          quotes: remove,
          dailyBars: remove,
        }),
      );
    if (add.length)
      ws.send(
        JSON.stringify({
          action: "subscribe",
          trades: add,
          quotes: add,
          dailyBars: add,
        }),
      );
    subscribed = symbols;
  };
  ws.on("open", () => {
    if (!isCurrent()) return ws.terminate();
    status({ status: "authenticeren" });
    ws.send(
      JSON.stringify({
        action: "auth",
        key: credentials.key,
        secret: credentials.secret,
      }),
    );
    subscribeTimer = setTimeout(() => {
      if (!authenticated) ws.terminate();
    }, 10000);
  });
  ws.on("pong", () => {
    pong = true;
  });
  ws.on("message", (raw) => {
    if (!isCurrent()) return;
    try {
      const rows = JSON.parse(raw.toString());
      if (!Array.isArray(rows)) return;
      for (const row of rows) {
        if (row.T === "success" && row.msg === "authenticated") {
          authenticated = true;
          clearTimeout(subscribeTimer);
          status({ status: "verbonden", error: null });
          sync();
        } else if (row.T === "error") {
          status({ status: "streamfout", error: alpacaStreamError(row.code) });
          retryDelay = [400, 401, 402, 404, 405, 406, 409, 410].includes(
            row.code,
          )
            ? 60000
            : 10000;
          ws.terminate();
        } else if (authenticated && ["t", "q", "d", "c", "x"].includes(row.T)) {
          const i = desired.find(
            (i) => alpacaSupports(i, p) && i.mappings.alpaca === row.S,
          );
          if (!i) continue;
          const old = getQuote(i);
          if (
            (row.T === "c" && row.oi != null && row.oi === old?.tradeId) ||
            (row.T === "x" && row.i != null && row.i === old?.tradeId)
          ) {
            onInvalidate(i);
            continue;
          }
          const q = alpacaStreamQuote(row, old, p);
          if (q) onQuote(i, q);
        }
      }
    } catch {
      /* Malformed frames are never forwarded or logged with credentials. */
    }
  });
  ws.on("error", () => {
    if (isCurrent())
      status({ error: "Alpaca-stream onderbroken; REST-fallback actief" });
  });
  const heartbeat = setInterval(() => {
    if (ws.readyState !== 1) return;
    if (!pong) return ws.terminate();
    pong = false;
    ws.ping();
  }, 20000);
  ws.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(subscribeTimer);
    if (stopped || !isCurrent()) return;
    status({ status: "herverbinden" });
    schedule(reconnect, retryDelay || 10000);
  });
  return {
    sync,
    terminate() {
      stopped = true;
      clearInterval(heartbeat);
      clearTimeout(subscribeTimer);
      ws.terminate();
    },
  };
}
