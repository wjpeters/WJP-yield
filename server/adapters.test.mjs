import test from "node:test";
import assert from "node:assert/strict";
import { adapters } from "./adapters.mjs";
import { catalog } from "./domain.mjs";
test("Kraken REST symboolmapping gebruikt XBTUSD, candles numeriek en UTC", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.match(url, /pair=XBTUSD/);
    return {
      ok: true,
      json: async () => ({
        error: [],
        result: {
          XXBTZUSD: [[1000, "10", "12", "9", "11", "10", "2", 5]],
          last: 1000,
        },
      }),
    };
  });
  const rows = await adapters.kraken.candles(catalog[0], "1h");
  assert.deepEqual(rows, [
    { time: 1000, open: 10, high: 12, low: 9, close: 11, volume: 2 },
  ]);
});
test("Twelve Data bewaart beurs/valuta/tijd en noemt rechtenafhankelijke data geen live data", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = new URL(url);
    assert.equal(u.searchParams.get("symbol"), "AAPL");
    assert.equal(u.searchParams.get("exchange"), "NASDAQ");
    return {
      ok: true,
      json: async () => ({
        close: "123.4",
        high: "124",
        low: "122",
        currency: "USD",
        timestamp: 1699990000,
        last_quote_at: 1700000000,
        exchange: "NASDAQ",
        is_market_open: false,
        percent_change: "1.2",
      }),
    };
  });
  const q = await adapters.twelve.quote(
    catalog.find((i) => i.symbol === "AAPL"),
    null,
    "fixture-only",
  );
  assert.equal(q.sourceAt, 1700000000000);
  assert.equal(q.timeliness, "entitlement");
  assert.equal(q.marketOpen, false);
  assert.equal(q.price, 123.4);
});
test("Twelve Data weigert verkeerde quotevaluta en lekt fouttekst of sleutel niet", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ close: "100", currency: "EUR" }),
  }));
  await assert.rejects(
    () =>
      adapters.twelve.quote(
        catalog.find((i) => i.symbol === "AAPL"),
        null,
        "fixture-only",
      ),
    /Quotevaluta/,
  );
  mock.mock.mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      status: "error",
      code: 401,
      message: "secret-in-provider-error",
    }),
  }));
  await assert.rejects(
    () =>
      adapters.twelve.quote(
        catalog.find((i) => i.symbol === "AAPL"),
        null,
        "fixture-only",
      ),
    (e) => e.message === "API-sleutel ongeldig",
  );
});

test("Twelve candle-open wordt nooit voor quote-actualiteit gebruikt", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({
      close: "100",
      currency: "USD",
      timestamp: 1700000000,
      is_market_open: true,
    }),
  }));
  const q = await adapters.twelve.quote(
    catalog.find((i) => i.symbol === "AAPL"),
    null,
    "fixture-only",
  );
  assert.equal(q.sourceAt, null);
  assert.equal(q.barStartAt, 1700000000000);
});

test("Twelve Data-limiet in JSON-body activeert ook de 429-pauze", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ status: "error", code: 429 }),
  }));
  const i = catalog.find((i) => i.symbol === "AAPL");
  await assert.rejects(
    () => adapters.twelve.quote(i, null, "fixture-only"),
    (e) => e.status === 429,
  );
  await assert.rejects(
    () => adapters.twelve.candles(i, "1h", "fixture-only"),
    (e) => e.status === 429,
  );
});
