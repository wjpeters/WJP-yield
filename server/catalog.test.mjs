import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { z } from "zod";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Catalog,
  normalizeDirectory,
  registerCatalogRoutes,
} from "./catalog.mjs";
import { createStore } from "./store.mjs";
import { registerWatchlistRoutes } from "./watchlists.mjs";
import { supportsInstrument } from "./adapters.mjs";
import { Engine } from "./engine.mjs";
const product = (base, quote, patch = {}) => ({
  id: `${base}-${quote}`,
  base_currency: base,
  quote_currency: quote,
  display_name: `${base}/${quote}`,
  status: "online",
  trading_disabled: false,
  ...patch,
});
const spot = (base, quote, patch = {}) => ({
  instId: `${base}-${quote}`,
  baseCcy: base,
  quoteCcy: quote,
  instType: "SPOT",
  state: "live",
  ...patch,
});
const ok = (data) => ({ ok: true, status: 200, json: async () => data });
function setup(
  t,
  providers = [
    {
      id: "coinbase",
      name: "Coinbase",
      type: "coinbase",
      enabled: true,
      priority: 1,
      rpm: 60,
    },
  ],
) {
  const dir = mkdtempSync(join(tmpdir(), "yield-catalog-"));
  const store = createStore(dir);
  store.put("providers", providers);
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, dir };
}
test("Catalog normalizers preserve exact currency, spot status, Kraken aliases and explicit stock venue", () => {
  assert.equal(
    normalizeDirectory("coinbase", [
      product("BTC", "EUR"),
      product("BAD", "USD", { trading_disabled: true }),
      product("BTC", "USDT", { id: "BTC-USDC" }),
    ]).length,
    1,
  );
  const kraken = normalizeDirectory("kraken", {
    error: [],
    result: {
      one: { wsname: "XBT/EUR", altname: "XBTEUR", status: "online" },
      two: { wsname: "XDG/USD", altname: "XDGUSD", status: "online" },
    },
  });
  assert.equal(kraken[0].id, "crypto:BTC:EUR");
  assert.equal(kraken[0].mappings.krakenRest, "XBTEUR");
  assert.equal(kraken[1].mappings.kraken, "DOGE/USD");
  const okx = normalizeDirectory("okx", {
    code: "0",
    data: [
      spot("NEW", "USDT"),
      spot("BTC", "USDC", { instType: "SWAP" }),
      spot("BAD", "EUR", { state: "suspend" }),
    ],
  });
  assert.equal(okx.length, 1);
  assert.equal(okx[0].currency, "USDT");
  assert.equal(
    normalizeDirectory("coinbase", [product("XDG", "USD")])[0].base,
    "XDG",
  );
  assert.throws(
    () =>
      normalizeDirectory(
        "twelve",
        { data: [{ symbol: "HG1", name: "Copper" }] },
        "commodities",
      ),
    /Geen ondersteunde/,
  );
  assert.throws(() => normalizeDirectory("coinbase", { data: [] }));
  const stock = normalizeDirectory(
    "twelve",
    {
      data: [
        {
          symbol: "IBM",
          name: "<script>bad</script>",
          exchange: "NYSE",
          currency: "USD",
        },
        { symbol: "IBM", exchange: "LSE", currency: "GBP" },
      ],
    },
    "stocks",
  );
  assert.equal(stock.length, 2);
  assert.equal(stock[0].name, "IBM");
  assert.notEqual(stock[0].id, stock[1].id);
});
test("Search merges actual BTC/EUR listings, filters and paginates without adding the directory to live state", async (t) => {
  const providers = ["coinbase", "kraken", "okx", "twelve"].map((type, n) => ({
    id: type,
    type,
    name: type,
    priority: n,
    enabled: true,
    rpm: 100,
  }));
  const { store, dir } = setup(t, providers);
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push(url);
    assert.equal(options.method, "GET");
    if (url.includes("coinbase"))
      return ok([product("BTC", "EUR"), product("NEW", "USDT")]);
    if (url.includes("kraken"))
      return ok({
        error: [],
        result: {
          btc: { wsname: "XBT/EUR", altname: "XBTEUR", status: "online" },
        },
      });
    if (url.includes("okx"))
      return ok({ code: "0", data: [spot("BTC", "EUR"), spot("NEW", "USDC")] });
    assert.equal(Object.keys(options.headers).length, 1);
    assert.ok(!url.includes("apikey"));
    return ok({
      data: url.endsWith("stocks")
        ? Array.from({ length: 120 }, (_, n) => ({
            symbol: `STK${n}`,
            name: `Stock ${n}`,
            exchange: "NYSE",
            currency: "USD",
          }))
        : [],
    });
  };
  const catalog = new Catalog(store, { fetcher });
  await Promise.all([catalog.refresh(), catalog.refresh()]);
  assert.equal(requests.length, 7);
  const btc = catalog.search({ q: "BTC-EUR" });
  assert.equal(btc.items.length, 1);
  assert.deepEqual(btc.items[0].providerIds, ["coinbase", "kraken", "okx"]);
  assert.equal(catalog.search({ q: "NEW" }).items.length, 2);
  const stocks = catalog.search({
    provider: "twelve",
    assetClass: "stock",
    offset: 50,
    limit: 50,
  });
  assert.equal(stocks.total, 120);
  assert.equal(stocks.items.length, 50);
  assert.ok(!store.instruments().some((i) => i.symbol === "STK0"));
  const app = Fastify();
  app.setErrorHandler((e, _req, reply) =>
    reply
      .code(e instanceof z.ZodError ? 400 : (e.statusCode ?? 500))
      .send({ error: e.message }),
  );
  registerCatalogRoutes(app, catalog);
  registerWatchlistRoutes(app, store);
  t.after(() => app.close());
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/catalog/instruments",
        payload: { id: "forged" },
      })
    ).statusCode,
    404,
  );
  const response = await app.inject({
    method: "POST",
    url: "/api/catalog/instruments",
    payload: { id: "stock:NYSE:STK0:USD" },
  });
  assert.equal(response.statusCode, 200);
  assert.ok(store.instruments().some((i) => i.symbol === "STK0"));
  const w = store.watchlists()[0];
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `/api/watchlists/${w.id}`,
        payload: {
          ...w,
          instruments: [...w.instruments, "stock:NYSE:STK0:USD"],
        },
      })
    ).statusCode,
    200,
  );
  const reopened = createStore(dir);
  assert.ok(reopened.instruments().some((i) => i.symbol === "STK0"));
  reopened.db.close();
  const materialized = store
    .instruments()
    .find((i) => i.id === "crypto:BTC:EUR");
  assert.equal(supportsInstrument(materialized, providers[0]), true);
  assert.equal(
    supportsInstrument(materialized, {
      ...providers[0],
      id: "unverified-clone",
    }),
    false,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/catalog?limit=101" }))
      .statusCode,
    400,
  );
});
test("Catalog cache survives restart, avoids per-keystroke calls, retains last success on errors and retires delisted pairs", async (t) => {
  const { store } = setup(t);
  let now = 100000,
    calls = 0,
    mode = "ok";
  const fetcher = async () => {
    calls++;
    if (mode === "error") throw new Error("internal provider secret");
    return ok(mode === "empty" ? [] : [product("NEW", "EUR")]);
  };
  let catalog = new Catalog(store, { fetcher, now: () => now });
  await catalog.refresh();
  catalog.register("crypto:NEW:EUR");
  for (const q of ["N", "NE", "NEW"]) {
    catalog.search({ q });
    await catalog.refresh();
  }
  assert.equal(calls, 1);
  catalog = new Catalog(store, { fetcher, now: () => now });
  await catalog.refresh();
  assert.equal(calls, 1);
  now += 86400001;
  mode = "error";
  await catalog.refresh();
  const cached = catalog.search({ q: "NEW" });
  assert.equal(cached.items.length, 1);
  assert.equal(cached.sources[0].stale, true);
  assert.ok(!JSON.stringify(cached).includes("internal provider secret"));
  now += 60001;
  mode = "empty";
  await catalog.refresh(true);
  assert.equal(catalog.search({ q: "NEW" }).items.length, 0);
  assert.deepEqual(
    store.instruments().find((i) => i.id === "crypto:NEW:EUR").catalogSources,
    {},
  );
});
test("Alpaca catalog uses asset metadata only, paper fallback and server-side headers; errors never expose keys", async (t) => {
  const { store } = setup(t, []);
  const p = {
    id: "alpaca",
    type: "alpaca",
    name: "Alpaca",
    enabled: true,
    priority: 1,
    rpm: 100,
    feed: "iex",
    secret: store.encrypt(
      JSON.stringify({ key: "fixture-key", secret: "fixture-secret" }),
    ),
  };
  store.put("providers", [p]);
  const urls = [];
  const catalog = new Catalog(store, {
    fetcher: async (url, options) => {
      urls.push(url);
      const u = new URL(url);
      assert.equal(u.pathname, "/v2/assets");
      assert.equal(options.method, "GET");
      assert.equal(options.headers["APCA-API-KEY-ID"], "fixture-key");
      assert.ok(!url.includes("fixture"));
      if (u.hostname === "api.alpaca.markets")
        return {
          ok: false,
          status: 401,
          json: async () => ({ message: "fixture-secret" }),
        };
      return ok([
        {
          status: "active",
          class: "us_equity",
          symbol: "IBM",
          name: "IBM",
          exchange: "NYSE",
        },
      ]);
    },
  });
  await catalog.refresh();
  assert.equal(urls.length, 2);
  assert.equal(catalog.search({ q: "IBM" }).total, 1);
  assert.ok(!JSON.stringify(catalog.search()).includes("fixture-key"));
  assert.ok(
    !JSON.stringify(store.get("catalog:alpaca")).includes("fixture-secret"),
  );
  const failing = new Catalog(store, {
    fetcher: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: "fixture-secret" }),
    }),
  });
  await failing.refresh(true);
  assert.ok(!JSON.stringify(failing.search()).includes("fixture-secret"));
});
test("In-flight catalog refresh cannot publish after feed or credential changes", async (t) => {
  const { store } = setup(t);
  let resolveFetch;
  const catalog = new Catalog(store, {
    fetcher: () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
  });
  const pending = catalog.refresh();
  store.put("providers", []);
  resolveFetch(ok([product("NEW", "EUR")]));
  await pending;
  assert.equal(catalog.search().total, 0);
  assert.equal(store.get("catalog:coinbase", null), null);
});
test("Catalog requests share the existing provider budget without recording metadata as a quote", async (t) => {
  const { store } = setup(t);
  const engine = new Engine(store);
  const p = store.providers()[0];
  p.rpm = 1;
  store.put("providers", [p]);
  const catalog = new Catalog(store, {
    reserve: (p) => engine.reserveBudget(p),
    fetcher: async () => ok([product("NEW", "EUR")]),
  });
  await catalog.refresh();
  assert.equal(engine.state(p.id).requests.length, 1);
  assert.equal(engine.state(p.id).lastReceived, null);
  assert.throws(() => engine.reserveBudget(p), /aanvraaglimiet/);
});
test("Large Twelve Data segments are accumulated without argument limits and partial failures remain explicit", async (t) => {
  const { store } = setup(t, [
    {
      id: "twelve",
      type: "twelve",
      name: "Twelve Data",
      enabled: true,
      priority: 1,
      rpm: 100,
    },
  ]);
  const catalog = new Catalog(store, {
    fetcher: async (url) => {
      if (url.endsWith("stocks"))
        return ok({
          data: Array.from({ length: 150000 }, () => ({
            symbol: "IBM",
            name: "IBM",
            exchange: "NYSE",
            currency: "USD",
          })),
        });
      if (url.endsWith("etfs")) return { ok: false, status: 429 };
      return ok({ data: [] });
    },
  });
  const result = await catalog.load(store.providers()[0]);
  assert.equal(result.rows.length, 150000);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /etfs/);
});
