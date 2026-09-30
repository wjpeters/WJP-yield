import WebSocket from "ws";
import { normalizeCandles, validQuote } from "./domain.mjs";
// Public EEA market data only. A future execution adapter must own private auth/orders.
export const OKX_REST = "https://eea.okx.com";
export const OKX_WS = "wss://wseea.okx.com:8443/ws/v5/public";
import { candleSource } from "./timeframes.mjs";
const frames = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "30m": "30m",
  "2h": "2H",
  "4h": "4H",
  "6h": "6Hutc",
  "12h": "12Hutc",
  "1d": "1Dutc",
  "1w": "1Wutc",
  "1mo": "1Mutc",
  "3mo": "3Mutc",
};
const number = (v) => (v == null || v === "" ? null : Number(v));
export function okxSupports(i) {
  return (
    i.assetClass === "crypto" &&
    typeof i.currency === "string" &&
    /^[A-Z0-9.]{2,16}$/.test(i.currency) &&
    !!i.base &&
    i.mappings.okx === `${i.base}-${i.currency}` &&
    i.symbol === `${i.base}/${i.currency}`
  );
}
function errorFor(code, status = 502) {
  const missing = ["51001", "51014"].includes(String(code));
  const limited = String(code) === "50011" || status === 429;
  const error = new Error(
    missing
      ? "Instrument niet beschikbaar bij OKX; controleer het spotpaar"
      : limited
        ? "OKX-aanvraaglimiet bereikt"
        : status === 403
          ? "OKX: deze aansluiting is niet toegankelijk"
          : `OKX-marktdata tijdelijk niet beschikbaar (${String(code).match(/^\d{1,6}$/) ? code : status})`,
  );
  error.status = missing ? 404 : limited ? 429 : status;
  if (missing) error.scope = "instrument";
  return error;
}
async function request(path, params) {
  let response;
  try {
    response = await fetch(
      `${OKX_REST}/api/v5/${path}?${new URLSearchParams(params)}`,
      {
        signal: AbortSignal.timeout(9000),
        headers: { "User-Agent": "WJP-yield/0.1" },
      },
    );
  } catch {
    throw new Error("OKX is tijdelijk niet bereikbaar");
  }
  if (!response.ok) throw errorFor(response.status, response.status);
  const body = await response.json().catch(() => null);
  if (!body || String(body.code) !== "0") throw errorFor(body?.code);
  if (!Array.isArray(body.data)) throw new Error("Ongeldig OKX-antwoord");
  return body.data;
}
export function okxQuote(row, i) {
  if (
    !okxSupports(i) ||
    row?.instId !== i.mappings.okx ||
    row.instType !== "SPOT"
  )
    throw new Error("OKX-spotpaar wijkt af van instrument");
  const sourceAt = number(row.ts);
  const q = {
    price: number(row.last),
    bid: number(row.bidPx) || null,
    ask: number(row.askPx) || null,
    high: number(row.high24h),
    low: number(row.low24h),
    volume: number(row.vol24h),
    changePct:
      number(row.open24h) > 0
        ? (Number(row.last) / Number(row.open24h) - 1) * 100
        : null,
    sourceAt,
    venue: "OKX",
    timeliness: "realtime",
  };
  if (!(sourceAt > 0) || !validQuote({ ...q, receivedAt: Date.now() }))
    throw new Error("Ongeldige OKX-koers of koerstijd");
  return q;
}
export const okxAdapter = {
  supports: okxSupports,
  venue: () => "OKX",
  async quote(i) {
    if (!okxSupports(i))
      throw new Error("Instrument is geen ondersteund OKX-spotpaar");
    const rows = await request("market/ticker", { instId: i.mappings.okx });
    if (!rows.length) throw errorFor("51001");
    return okxQuote(rows[0], i);
  },
  async candles(i, interval) {
    const source = candleSource("okx", interval);
    if (!okxSupports(i) || !frames[source])
      throw new Error("OKX ondersteunt dit spotpaar of interval niet");
    const rows = await request("market/candles", {
      instId: i.mappings.okx,
      bar: frames[source],
      limit: "300",
    });
    return normalizeCandles(
      rows
        .filter(
          (r) => Array.isArray(r) && r.length >= 9 && ["0", "1"].includes(r[8]),
        )
        .map((r) => ({
          time: Number(r[0]) / 1000,
          open: Number(r[1]),
          high: Number(r[2]),
          low: Number(r[3]),
          close: Number(r[4]),
          volume: number(r[5]),
          confirmed: r[8] === "1",
        })),
    );
  },
};
export function connectOKX({
  instruments,
  isCurrent,
  schedule,
  reconnect,
  status,
  onQuote,
  WebSocketClass = WebSocket,
  now = Date.now,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  const ws = new WebSocketClass(OKX_WS, {
    handshakeTimeout: 10000,
    maxPayload: 1024 * 1024,
  });
  let desired = instruments,
    subscribed = new Set(),
    stopped = false,
    seen = now(),
    pingAt = null,
    retry = 10000;
  const sync = (rows = desired) => {
    desired = rows;
    if (!isCurrent() || ws.readyState !== 1) return;
    const next = new Set(rows.filter(okxSupports).map((i) => i.mappings.okx));
    const remove = [...subscribed].filter((id) => !next.has(id));
    const add = [...next].filter((id) => !subscribed.has(id));
    // One message per operation, bounded by the terminal's 100 active instruments.
    for (const [op, ids] of [
      ["unsubscribe", remove],
      ["subscribe", add],
    ])
      if (ids.length)
        ws.send(
          JSON.stringify({
            op,
            args: ids.map((instId) => ({ channel: "tickers", instId })),
          }),
        );
    subscribed = next;
  };
  ws.on("open", () => {
    if (!isCurrent()) return ws.terminate();
    seen = now();
    status({ status: "verbonden", error: null });
    sync();
  });
  ws.on("message", (raw) => {
    if (stopped || !isCurrent()) return;
    const text = raw.toString();
    if (text === "pong") {
      seen = now();
      pingAt = null;
      return;
    }
    try {
      const frame = JSON.parse(text);
      seen = now();
      if (frame.event === "error") {
        retry = 60000;
        status({
          status: "streamfout",
          error: "OKX: streamaanvraag afgewezen; REST-fallback actief",
        });
        ws.terminate();
        return;
      }
      if (frame.arg?.channel !== "tickers" || !Array.isArray(frame.data))
        return;
      const i = desired.find(
        (i) => okxSupports(i) && i.mappings.okx === frame.arg.instId,
      );
      if (!i || !subscribed.has(i.mappings.okx)) return;
      for (const row of frame.data) {
        try {
          const q = okxQuote(row, i);
          if (onQuote(i, q) !== false) status({ error: null });
        } catch {
          /* Reject malformed or mismatched rows without losing the stream. */
        }
      }
    } catch {
      /* No upstream payloads are logged or forwarded. */
    }
  });
  ws.on("error", () => {
    if (isCurrent() && !stopped)
      status({ error: "OKX-stream onderbroken; REST-fallback actief" });
  });
  const heartbeat = setIntervalFn(() => {
    if (ws.readyState !== 1 || stopped || !isCurrent()) return;
    if (pingAt != null && now() - pingAt >= 10000) {
      ws.terminate();
      return;
    }
    if (pingAt == null && now() - seen >= 15000) {
      pingAt = now();
      ws.send("ping");
    }
  }, 5000);
  ws.on("close", () => {
    clearIntervalFn(heartbeat);
    if (stopped || !isCurrent()) return;
    status({ status: "herverbinden" });
    schedule(reconnect, retry);
  });
  return {
    sync,
    terminate() {
      stopped = true;
      clearIntervalFn(heartbeat);
      ws.terminate();
    },
  };
}
