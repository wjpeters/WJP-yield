import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  okxAdapter,
  okxQuote,
  okxSupports,
  connectOKX,
  OKX_REST,
  OKX_WS,
} from "./okx.mjs";
import { catalog } from "./domain.mjs";
import { createStore } from "./store.mjs";
import { Engine } from "./engine.mjs";
const btc = catalog.find((i) => i.symbol === "BTC/USDC");
const eur = catalog.find((i) => i.symbol === "BTC/EUR");
const ticker = () => ({
  instId: "BTC-USDC",
  instType: "SPOT",
  last: "100",
  bidPx: "99",
  askPx: "101",
  open24h: "80",
  high24h: "110",
  low24h: "70",
  vol24h: "2",
  volCcy24h: "200",
  ts: String(Date.now()),
});
test("OKX REST uses public EEA spot endpoint and preserves source timestamp, venue and base volume", async (t) => {
  const row = ticker();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin, OKX_REST);
    assert.equal(u.pathname, "/api/v5/market/ticker");
    assert.equal(u.searchParams.get("instId"), "BTC-USDC");
    assert.deepEqual(Object.keys(options.headers), ["User-Agent"]);
    return { ok: true, json: async () => ({ code: "0", data: [row] }) };
  });
  const q = await okxAdapter.quote(btc);
  assert.equal(q.price, 100);
  assert.equal(q.sourceAt, Number(row.ts));
  assert.equal(q.volume, 2);
  assert.equal(q.venue, "OKX");
  assert.equal(q.changePct, 25);
});
test("OKX never maps USDC to USDT or derivative contracts and rejects malformed or future quotes", () => {
  assert.equal(okxSupports(btc), true);
  assert.equal(okxSupports(eur), true);
  for (const bad of [
    { ...btc, mappings: { okx: "BTC-USDT" } },
    { ...btc, mappings: { okx: "BTC-USD-SWAP" } },
    { ...btc, assetClass: "future" },
    { ...btc, currency: "EUR" },
  ])
    assert.equal(okxSupports(bad), false);
  for (const patch of [
    { instId: "BTC-USDT" },
    { instType: "SWAP" },
    { ts: "" },
    { ts: String(Date.now() + 120000) },
    { last: "oops" },
    { last: "0" },
    { bidPx: "-1" },
  ])
    assert.throws(() => okxQuote({ ...ticker(), ...patch }, btc));
  assert.throws(() => okxQuote(ticker(), eur));
});
test("OKX candles use UTC daily bars, chronological order and base volume, preserving unfinished status", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = new URL(url);
    assert.equal(u.pathname, "/api/v5/market/candles");
    assert.equal(u.searchParams.get("bar"), "1Dutc");
    assert.equal(u.searchParams.get("limit"), "300");
    return {
      ok: true,
      json: async () => ({
        code: "0",
        data: [
          ["1728086400000", "100", "110", "90", "105", "2", "200", "200", "0"],
          ["1728000000000", "90", "105", "80", "100", "3", "300", "300", "1"],
          ["1728086400000", "0", "0", "0", "0", "2", "0", "0", "1"],
        ],
      }),
    };
  });
  const bars = await okxAdapter.candles(btc, "1d");
  assert.equal(bars.length, 2);
  assert.ok(bars[0].time < bars[1].time);
  assert.equal(bars[1].volume, 2);
  assert.equal(bars[1].confirmed, false);
  assert.equal(bars[0].confirmed, true);
  await assert.rejects(() => okxAdapter.candles(btc, "invalid"), /interval/);
});
test("OKX payload rate limits and missing listings have safe categories; raw provider messages never escape", async (t) => {
  let body = { code: "50011", msg: "secret-in-untrusted-payload" },
    status = 200;
  t.mock.method(globalThis, "fetch", async () => ({
    ok: status === 200,
    status,
    json: async () => body,
  }));
  await assert.rejects(
    () => okxAdapter.quote(btc),
    (e) => e.status === 429 && !e.message.includes("secret"),
  );
  body = { code: "51001", msg: "secret-in-untrusted-payload" };
  await assert.rejects(
    () => okxAdapter.quote(btc),
    (e) => e.status === 404 && e.scope === "instrument",
  );
  status = 403;
  await assert.rejects(
    () => okxAdapter.quote(btc),
    (e) => e.status === 403 && !e.scope,
  );
  status = 200;
  body = { code: "0", data: "bad" };
  await assert.rejects(() => okxAdapter.quote(btc), /Ongeldig/);
});
function streamFixture() {
  let ws,
    tick,
    now = 100000,
    current = true,
    cleared = 0;
  const quotes = [],
    statuses = [],
    scheduled = [];
  class FakeWS extends EventEmitter {
    constructor(url) {
      super();
      assert.equal(url, OKX_WS);
      ws = this;
      this.readyState = 0;
      this.sent = [];
    }
    send(data) {
      this.sent.push(data);
    }
    terminate() {
      this.readyState = 3;
      this.emit("close");
    }
  }
  const connection = connectOKX({
    instruments: [btc],
    isCurrent: () => current,
    schedule: (fn, ms) => scheduled.push(ms),
    reconnect: () => {},
    status: (s) => statuses.push(s),
    onQuote: (i, q) => quotes.push({ i, q }),
    WebSocketClass: FakeWS,
    now: () => now,
    setIntervalFn: (fn) => {
      tick = fn;
      return 1;
    },
    clearIntervalFn: () => cleared++,
  });
  ws.readyState = 1;
  ws.emit("open");
  return {
    ws,
    connection,
    quotes,
    statuses,
    scheduled,
    tick: () => tick(),
    advance: (ms) => (now += ms),
    stale: () => (current = false),
    cleared: () => cleared,
  };
}
test("OKX stream subscribes and updates watchlist, ignores wrong symbols and obsolete connection frames", () => {
  const f = streamFixture();
  assert.deepEqual(JSON.parse(f.ws.sent[0]), {
    op: "subscribe",
    args: [{ channel: "tickers", instId: "BTC-USDC" }],
  });
  const frame = (row) =>
    JSON.stringify({
      arg: { channel: "tickers", instId: "BTC-USDC" },
      data: [row],
    });
  f.ws.emit("message", frame(ticker()));
  assert.equal(f.quotes.length, 1);
  f.ws.emit("message", frame({ ...ticker(), instId: "ETH-USD" }));
  f.ws.emit("message", "broken");
  assert.equal(f.quotes.length, 1);
  f.connection.sync([eur]);
  assert.equal(JSON.parse(f.ws.sent[1]).op, "unsubscribe");
  assert.equal(JSON.parse(f.ws.sent[2]).args[0].instId, "BTC-EUR");
  f.ws.emit("message", frame(ticker()));
  assert.equal(f.quotes.length, 1);
  f.stale();
  f.ws.emit(
    "message",
    JSON.stringify({
      arg: { channel: "tickers", instId: "BTC-EUR" },
      data: [{ ...ticker(), instId: "BTC-EUR" }],
    }),
  );
  assert.equal(f.quotes.length, 1);
  f.connection.terminate();
  assert.equal(f.scheduled.length, 0);
  assert.ok(f.cleared() > 0);
});
test("OKX uses text ping/pong, reconnects after heartbeat timeout, and backs off on subscription errors", () => {
  const f = streamFixture();
  f.advance(15000);
  f.tick();
  assert.equal(f.ws.sent.at(-1), "ping");
  f.ws.emit("message", "pong");
  f.advance(5000);
  f.tick();
  assert.equal(f.scheduled.length, 0);
  f.advance(10000);
  f.tick();
  f.advance(10000);
  f.tick();
  assert.deepEqual(f.scheduled, [10000]);
  const g = streamFixture();
  g.ws.emit(
    "message",
    JSON.stringify({ event: "error", code: "60012", msg: "untrusted" }),
  );
  assert.deepEqual(g.scheduled, [60000]);
  assert.ok(!JSON.stringify(g.statuses).includes("untrusted"));
});
test("OKX migration is idempotent, keeps user config and does not resurrect a removed provider", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "yield-okx-"));
  let store = createStore(dir);
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const p = store.providers().find((p) => p.type === "okx");
  assert.ok(p.enabled);
  assert.equal(p.secret, undefined);
  const lists = store.watchlists();
  store.put(
    "providers",
    store
      .providers()
      .map((x) => (x.id === p.id ? { ...x, enabled: false, priority: 7 } : x)),
  );
  store.db.close();
  store = createStore(dir);
  assert.equal(store.providers().filter((x) => x.type === "okx").length, 1);
  assert.equal(store.providers().find((x) => x.id === p.id).priority, 7);
  assert.deepEqual(store.watchlists(), lists);
  store.put(
    "providers",
    store.providers().filter((x) => x.id !== p.id),
  );
  store.db.close();
  store = createStore(dir);
  assert.ok(!store.providers().some((x) => x.type === "okx"));
});
test("OKX participates in comparisons and freshness failover without mixing EUR and USDC", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "yield-okx-"));
  const store = createStore(dir);
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const engine = new Engine(store),
    okx = store.providers().find((p) => p.type === "okx"),
    kraken = { ...okx, id: "okx-backup-fixture", priority: 10 };
  store.put("providers", [...store.providers(), kraken]);
  engine.ingest(
    kraken,
    btc,
    { price: 99, sourceAt: Date.now() - 120000 },
    "WebSocket",
  );
  engine.ingest(okx, btc, okxQuote(ticker(), btc), "WebSocket");
  assert.equal(engine.selected(btc).providerId, okx.id);
  assert.equal(engine.snapshot().comparisons[btc.id].length, 2);
  assert.equal(engine.selected(eur), null);
  engine.ingest(kraken, btc, { price: 100, sourceAt: Date.now() }, "WebSocket");
  assert.equal(engine.selected(btc).providerId, kraken.id);
});
