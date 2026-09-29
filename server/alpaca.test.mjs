import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  alpacaAdapter,
  alpacaSnapshot,
  alpacaStreamQuote,
  alpacaSupports,
  connectAlpaca,
} from "./alpaca.mjs";
import { configureProvider } from "./provider-config.mjs";
import { catalog, isFresh } from "./domain.mjs";
import { createStore } from "./store.mjs";
import { Engine } from "./engine.mjs";
import { adapters } from "./adapters.mjs";
const credentials = JSON.stringify({
  key: "fixture-key-id",
  secret: "fixture-secret",
});
const stock = catalog.find((i) => i.symbol === "AAPL"),
  crypto = catalog.find((i) => i.symbol === "BTC/USD");
const config = {
  type: "alpaca",
  name: "Alpaca test",
  priority: 10,
  enabled: true,
  rpm: 120,
  feed: "iex",
};
const snapshot = {
  latestTrade: { p: 100, t: "2026-09-28T14:30:00.123456789Z", x: "V", i: 10 },
  latestQuote: { bp: 99, ap: 101, t: "2026-09-28T14:30:01Z" },
  dailyBar: { h: 102, l: 98, v: 30, t: "2026-09-28T04:00:00Z" },
  prevDailyBar: { c: 95 },
};
function storeFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "yield-alpaca-"));
  const store = createStore(dir);
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return Object.assign(store, { testDirectory: dir });
}
test("Alpaca stock REST uses authenticated headers and explicit IEX feed, preserving trade time", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin, "https://data.alpaca.markets");
    assert.equal(u.pathname, "/v2/stocks/snapshots");
    assert.equal(u.searchParams.get("feed"), "iex");
    assert.equal(u.searchParams.get("symbols"), "AAPL");
    assert.equal(options.headers["APCA-API-KEY-ID"], "fixture-key-id");
    assert.equal(options.headers["APCA-API-SECRET-KEY"], "fixture-secret");
    assert.ok(!url.includes("fixture"));
    return { ok: true, json: async () => ({ AAPL: snapshot }) };
  });
  const q = await alpacaAdapter.quote(stock, null, credentials, config);
  assert.equal(q.price, 100);
  assert.equal(q.sourceAt, Date.parse(snapshot.latestTrade.t));
  assert.notEqual(q.sourceAt, q.quoteAt);
  assert.notEqual(q.sourceAt, q.statsAt);
  assert.equal(q.venue, "IEX");
  assert.equal(q.bid, 99);
  assert.equal(q.volume, 30);
});
test("Alpaca crypto uses US location and normalized symbol; wrong market and currency rejected", async (t) => {
  const p = { ...config, feed: "crypto_us" };
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = new URL(url);
    assert.equal(u.pathname, "/v1beta3/crypto/us/snapshots");
    assert.equal(u.searchParams.get("symbols"), "BTC/USD");
    assert.equal(u.searchParams.has("feed"), false);
    return {
      ok: true,
      json: async () => ({ snapshots: { "BTC/USD": snapshot } }),
    };
  });
  assert.equal(
    (await alpacaAdapter.quote(crypto, null, credentials, p)).venue,
    "Alpaca US",
  );
  assert.equal(alpacaSupports(crypto, config), false);
  assert.equal(alpacaSupports(stock, p), false);
  assert.equal(alpacaSupports({ ...stock, currency: "EUR" }, config), false);
  assert.equal(alpacaSupports({ ...stock, exchange: "LSE" }, config), false);
  await assert.rejects(
    () => alpacaAdapter.quote(stock, null, credentials, p),
    /past niet/,
  );
});
test("Alpaca history uses explicit feed, newest bounded page, UTC and chronological OHLC normalization", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = new URL(url);
    assert.equal(u.pathname, "/v2/stocks/bars");
    assert.equal(u.searchParams.get("feed"), "sip");
    assert.equal(u.searchParams.get("timeframe"), "1Hour");
    assert.equal(u.searchParams.get("sort"), "desc");
    assert.equal(u.searchParams.get("adjustment"), "raw");
    assert.ok(u.searchParams.get("start"));
    return {
      ok: true,
      json: async () => ({
        bars: {
          AAPL: [
            { t: "2026-09-28T15:00:00Z", o: 100, h: 103, l: 99, c: 102, v: 40 },
            { t: "2026-09-28T14:00:00Z", o: 99, h: 101, l: 98, c: 100, v: 30 },
            { t: "invalid", o: 99, h: 101, l: 98, c: 100 },
          ],
        },
        next_page_token: "older-bars-not-needed",
      }),
    };
  });
  const candles = await alpacaAdapter.candles(stock, "1h", credentials, {
    ...config,
    feed: "sip",
  });
  assert.equal(candles.length, 2);
  assert.ok(candles[0].time < candles[1].time);
  assert.equal(candles[1].volume, 40);
});
test("Alpaca access errors and rate limits are sanitized, never silently upgraded to SIP", async (t) => {
  let code = 403,
    calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return {
      ok: false,
      status: code,
      json: async () => ({ message: credentials }),
    };
  });
  await assert.rejects(
    () => alpacaAdapter.quote(stock, null, credentials, config),
    (e) =>
      e.status === 403 &&
      !e.message.includes("fixture") &&
      e.message.includes("datarechten"),
  );
  assert.equal(calls, 1);
  code = 429;
  await assert.rejects(
    () => alpacaAdapter.quote(stock, null, credentials, config),
    (e) => e.status === 429,
  );
  assert.throws(
    () => alpacaSnapshot({ latestTrade: { p: 100 } }, config),
    /geldige/,
  );
});
test("Alpaca quote messages do not make an old trade fresh and reject reversed/future timestamps", () => {
  const old = {
    ...alpacaSnapshot(snapshot, config),
    sourceAt: Date.now() - 180000,
    quoteAt: Date.now() - 1000,
    receivedAt: Date.now(),
    transport: "WebSocket",
    assetClass: "stock",
  };
  const updated = alpacaStreamQuote(
    { T: "q", bp: 101, ap: 102, t: new Date().toISOString() },
    old,
    config,
  );
  assert.equal(updated.price, old.price);
  assert.equal(updated.sourceAt, old.sourceAt);
  assert.equal(isFresh(updated), false);
  assert.equal(
    alpacaStreamQuote(
      { T: "t", p: 10, t: "2020-01-01T00:00:00Z" },
      old,
      config,
    ),
    null,
  );
  assert.equal(
    alpacaStreamQuote(
      { T: "t", p: 10, t: new Date(Date.now() + 120000).toISOString() },
      old,
      config,
    ),
    null,
  );
  assert.equal(
    alpacaStreamQuote(
      { T: "q", bp: 1, ap: 2, t: new Date().toISOString() },
      null,
      config,
    ),
    null,
  );
  const trade = alpacaStreamQuote(
    { T: "t", p: 102, t: new Date().toISOString(), i: 20 },
    old,
    config,
  );
  assert.equal(trade.high, null);
  assert.equal(trade.volume, null);
  assert.equal(trade.tradeId, 20);
});
test("Alpaca credential pair is encrypted, preserved together, validated and absent from public config", (t) => {
  const store = storeFixture(t);
  const p = configureProvider(
    { ...config, apiKey: "fixture-key-id", apiSecret: "fixture-secret" },
    null,
    store,
  );
  assert.equal(store.decrypt(p.secret), credentials);
  assert.ok(!p.secret.includes("fixture"));
  assert.equal(
    JSON.stringify(store.publicProvider(p)).includes("fixture"),
    false,
  );
  assert.equal(store.publicProvider(p).hasKey, true);
  assert.equal(configureProvider(config, p, store).secret, p.secret);
  assert.throws(
    () => configureProvider({ ...config, apiKey: "only-one" }, p, store),
    /samen/,
  );
  assert.throws(() => configureProvider(config, null, store), /beide/);
  assert.throws(
    () => configureProvider({ ...config, clearKey: true }, p, store),
    /beide/,
  );
  assert.equal(
    configureProvider({ ...config, enabled: false, clearKey: true }, p, store)
      .secret,
    undefined,
  );
  assert.equal(
    configureProvider(
      { ...config, feed: undefined, enabled: false },
      null,
      store,
    ).feed,
    "iex",
  );
});
test("Alpaca default is inactive, migration is idempotent and respects removal; custom US mappings work", (t) => {
  const store = storeFixture(t);
  assert.equal(store.providers().filter((p) => p.type === "alpaca").length, 1);
  const p = store.providers().find((p) => p.type === "alpaca");
  assert.equal(p.enabled, false);
  assert.equal(p.feed, "iex");
  store.put("instruments", [
    {
      id: "custom",
      symbol: "IBM",
      assetClass: "stock",
      exchange: "NYSE",
      currency: "USD",
      mappings: { twelve: "IBM" },
    },
  ]);
  assert.equal(
    store.instruments().find((i) => i.id === "custom").mappings.alpaca,
    "IBM",
  );
  store.put(
    "providers",
    store.providers().filter((p) => p.type !== "alpaca"),
  );
  assert.equal(store.get("migration:alpaca-v1"), true);
  assert.equal(
    store.providers().some((p) => p.type === "alpaca"),
    false,
  );
  const reopened = createStore(store.testDirectory);
  try {
    assert.equal(
      reopened.providers().some((p) => p.type === "alpaca"),
      false,
    );
  } finally {
    reopened.db.close();
  }
});
test("Alpaca feeds participate in stale-data failover and feed invalidation removes previous quotes", (t) => {
  const store = storeFixture(t),
    e = new Engine(store);
  const p = configureProvider(
    { ...config, apiKey: "fixture-key-id", apiSecret: "fixture-secret" },
    null,
    store,
  );
  const backup = {
    id: "backup",
    type: "twelve",
    name: "Backup",
    enabled: true,
    priority: 20,
    rpm: 8,
    secret: store.encrypt("fixture-only"),
  };
  store.put("providers", [p, backup]);
  e.ingest(p, stock, { price: 100, sourceAt: Date.now() - 180000 });
  e.ingest(backup, stock, { price: 101, sourceAt: Date.now() });
  assert.equal(e.selected(stock).providerId, "backup");
  e.ingest(p, stock, { price: 102, sourceAt: Date.now() });
  assert.equal(e.selected(stock).providerId, p.id);
  assert.equal(e.eligible(crypto).length, 0);
  e.invalidate(p.id);
  assert.equal(e.selected(stock).providerId, "backup");
});
test("in-flight Alpaca history cannot populate the cache after changing provider configuration", async (t) => {
  const store = storeFixture(t),
    engine = new Engine(store);
  const p = configureProvider(
    { ...config, apiKey: "fixture-key-id", apiSecret: "fixture-secret" },
    null,
    store,
  );
  store.put("providers", [p]);
  let resolve;
  t.mock.method(
    adapters.alpaca,
    "candles",
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const request = engine.history(stock, "1h");
  engine.stop();
  resolve([{ time: 1000, open: 1, high: 2, low: 1, close: 2, volume: 1 }]);
  await assert.rejects(() => request, /gewijzigd/);
  assert.equal(engine.cache.size, 0);
});
class FakeSocket extends EventEmitter {
  static last;
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 1;
    this.sent = [];
    FakeSocket.last = this;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  ping() {
    this.emit("pong");
  }
  terminate() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close");
  }
}
test("Alpaca WebSocket authenticates before subscribing, updates symbols, handles corrections and shuts down", () => {
  const received = new Map(),
    invalidated = [],
    statuses = [],
    timers = [];
  const connection = connectAlpaca({
    provider: config,
    secret: credentials,
    instruments: [stock],
    isCurrent: () => true,
    schedule: (fn, ms) => timers.push(ms),
    reconnect: () => {},
    onQuote: (i, q) => received.set(i.id, q),
    onInvalidate: (i) => invalidated.push(i.id),
    getQuote: (i) => received.get(i.id),
    status: (s) => statuses.push(s),
    WebSocketClass: FakeSocket,
  });
  const ws = FakeSocket.last;
  try {
    assert.match(ws.url, /v2\/iex$/);
    ws.emit("open");
    assert.deepEqual(ws.sent, [
      { action: "auth", key: "fixture-key-id", secret: "fixture-secret" },
    ]);
    const emit = (row) =>
      ws.emit("message", Buffer.from(JSON.stringify([row])));
    emit({ T: "success", msg: "authenticated" });
    assert.equal(ws.sent[1].action, "subscribe");
    assert.deepEqual(ws.sent[1].trades, ["AAPL"]);
    emit({ T: "t", S: "AAPL", p: 100, t: new Date().toISOString(), i: 10 });
    assert.equal(received.get(stock.id).price, 100);
    emit({ T: "c", S: "AAPL", oi: 10, t: new Date().toISOString() });
    assert.deepEqual(invalidated, [stock.id]);
    connection.sync([]);
    assert.equal(ws.sent.at(-1).action, "unsubscribe");
    connection.terminate();
    assert.deepEqual(timers, []);
  } finally {
    connection.terminate();
  }
});
test("Alpaca stream access failure uses a sanitized message and delayed reconnect", () => {
  const statuses = [],
    timers = [];
  const connection = connectAlpaca({
    provider: config,
    secret: credentials,
    instruments: [stock],
    isCurrent: () => true,
    schedule: (fn, ms) => timers.push(ms),
    reconnect: () => {},
    onQuote: () => {},
    onInvalidate: () => {},
    getQuote: () => null,
    status: (s) => statuses.push(s),
    WebSocketClass: FakeSocket,
  });
  try {
    FakeSocket.last.emit("open");
    FakeSocket.last.emit(
      "message",
      Buffer.from(
        JSON.stringify([{ T: "error", code: 409, msg: credentials }]),
      ),
    );
    assert.deepEqual(timers, [60000]);
    assert.ok(JSON.stringify(statuses).includes("abonnement"));
    assert.equal(JSON.stringify(statuses).includes("fixture"), false);
  } finally {
    connection.terminate();
  }
});

test("Alpaca daily bars update session statistics without refreshing the trade timestamp", () => {
  const now = Date.now(),
    start = now - 3600000;
  const old = {
    price: 100,
    sourceAt: now - 10000,
    high: null,
    low: null,
    volume: null,
  };
  const q = alpacaStreamQuote(
    { T: "d", h: 110, l: 90, v: 1000, t: new Date(start).toISOString() },
    old,
    config,
  );
  assert.equal(q.sourceAt, old.sourceAt);
  assert.equal(q.volume, 1000);
  const trade = alpacaStreamQuote(
    { T: "t", p: 105, t: new Date(now).toISOString() },
    q,
    config,
  );
  assert.equal(trade.volume, 1000);
  assert.equal(trade.high, 110);
  const nextDay = alpacaStreamQuote(
    { T: "t", p: 106, t: new Date(now).toISOString() },
    { ...q, statsAt: now - 90000000 },
    config,
  );
  assert.equal(nextDay.volume, null);
});
