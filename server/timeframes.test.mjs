import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  candleSource,
  periodStart,
  periodEnd,
  aggregateCandles,
} from "./timeframes.mjs";
import { intervals, catalog } from "./domain.mjs";
import { timeframes } from "../src/timeframes.ts";
import { adapters } from "./adapters.mjs";
import { createStore } from "./store.mjs";
import { Engine } from "./engine.mjs";
const ts = (s) => Date.parse(s + "T00:00:00Z") / 1000;
const bar = (date, patch = {}) => ({
  time: ts(date),
  open: 10,
  high: 15,
  low: 5,
  close: 12,
  volume: 2,
  ...patch,
});
test("UI, API validation and drawing steps agree on every supported interval", () => {
  assert.deepEqual(
    Object.fromEntries(timeframes.map((f) => [f.value, f.step])),
    intervals,
  );
  assert.equal(new Set(timeframes.map((f) => f.label)).size, timeframes.length);
  assert.throws(() => candleSource("okx", "bad"), /interval/);
});
test("calendar buckets cross leap day, quarter, year and Monday week boundaries", () => {
  assert.equal(periodStart(ts("2024-02-29"), "1mo"), ts("2024-02-01"));
  assert.equal(periodEnd(ts("2024-02-29"), "1mo"), ts("2024-03-01"));
  assert.equal(periodStart(ts("2024-12-31"), "3mo"), ts("2024-10-01"));
  assert.equal(periodEnd(ts("2024-12-31"), "3mo"), ts("2025-01-01"));
  assert.equal(periodStart(ts("2024-12-31"), "1y"), ts("2024-01-01"));
  assert.equal(periodEnd(ts("2024-12-31"), "1y"), ts("2025-01-01"));
  assert.equal(periodStart(ts("2025-01-05"), "1w"), ts("2024-12-30"));
  assert.equal(periodStart(ts("2025-01-06"), "1w"), ts("2025-01-06"));
});
test("aggregation sorts, deduplicates and combines OHLC/volume without creating empty periods", () => {
  const rows = [
    bar("2024-02-29", { open: 12, high: 20, low: 8, close: 17, volume: 3 }),
    bar("2024-04-01"),
    bar("2024-02-01"),
    bar("2024-02-01"),
  ];
  const out = aggregateCandles(rows, "1mo", "1d");
  assert.deepEqual(out[0], {
    time: ts("2024-02-01"),
    open: 10,
    high: 20,
    low: 5,
    close: 17,
    volume: 5,
    partial: false,
    confirmed: true,
  });
  assert.equal(out.length, 2);
  assert.equal(out[1].time, ts("2024-04-01"));
});
test("unknown volume, truncated start and unfinished source candles stay explicit", () => {
  const rows = [
    bar("2024-01-15", { volume: null }),
    bar("2024-02-01", { confirmed: false }),
  ];
  const out = aggregateCandles(rows, "1y", "1mo", ts("2025-01-01"));
  assert.equal(out[0].volume, null);
  assert.equal(out[0].partial, true);
  assert.equal(out[0].confirmed, false);
  const current = aggregateCandles(
    [bar("2024-01-01")],
    "1y",
    "1mo",
    ts("2024-06-01"),
  );
  assert.equal(current[0].confirmed, false);
  assert.equal(current[0].partial, false);
  assert.equal(aggregateCandles([], "1y", "1mo").length, 0);
});
test("yearly OHLC crosses calendar years and quarterly/monthly grouping does not use nominal seconds", () => {
  const rows = [
    bar("2023-12-01"),
    bar("2024-01-01", { open: 12, high: 18, close: 16 }),
    bar("2024-12-01", { open: 16, high: 20, low: 7, close: 19 }),
  ];
  const out = aggregateCandles(rows, "1y", "1mo");
  assert.equal(out.length, 2);
  assert.equal(out[0].partial, true);
  assert.equal(out[1].time, ts("2024-01-01"));
  assert.equal(out[1].open, 12);
  assert.equal(out[1].close, 19);
  assert.equal(out[1].high, 20);
  assert.equal(out[1].volume, 4);
});
const expected = {
  kraken: [1, 5, 15, 30, 60, 60, 240, 60, 240, 1440, 10080, 1440, 1440, 1440],
  coinbase: [
    60, 300, 900, 900, 3600, 3600, 3600, 21600, 21600, 86400, 86400, 86400,
    86400, 86400,
  ],
  twelve: [
    "1min",
    "5min",
    "15min",
    "30min",
    "1h",
    "2h",
    "4h",
    "2h",
    "4h",
    "1day",
    "1week",
    "1month",
    "1month",
    "1month",
  ],
  okx: [
    "1m",
    "5m",
    "15m",
    "30m",
    "1H",
    "2H",
    "4H",
    "6Hutc",
    "12Hutc",
    "1Dutc",
    "1Wutc",
    "1Mutc",
    "3Mutc",
    "1Mutc",
  ],
  alpaca: [
    "1Min",
    "5Min",
    "15Min",
    "30Min",
    "1Hour",
    "2Hour",
    "4Hour",
    "6Hour",
    "12Hour",
    "1Day",
    "1Week",
    "1Month",
    "3Month",
    "12Month",
  ],
};
for (const type of Object.keys(expected)) {
  test(`${type}: every interval requests a documented native frame`, async (t) => {
    let index = 0;
    const i = catalog.find((i) =>
      type === "okx"
        ? i.symbol === "BTC/USDC"
        : ["twelve", "alpaca"].includes(type)
          ? i.symbol === "AAPL"
          : i.symbol === "BTC/USD",
    );
    t.mock.method(globalThis, "fetch", async (url) => {
      const u = new URL(url);
      const param =
        type === "coinbase"
          ? "granularity"
          : type === "okx"
            ? "bar"
            : type === "alpaca"
              ? "timeframe"
              : "interval";
      assert.equal(u.searchParams.get(param), String(expected[type][index++]));
      const r = bar("2024-01-01");
      const data =
        type === "kraken"
          ? {
              error: [],
              result: {
                pair: [[r.time, "10", "15", "5", "12", "11", "2", 1]],
                last: 1,
              },
            }
          : type === "coinbase"
            ? [[r.time, 5, 15, 10, 12, 2]]
            : type === "okx"
              ? {
                  code: "0",
                  data: [
                    [
                      String(r.time * 1000),
                      "10",
                      "15",
                      "5",
                      "12",
                      "2",
                      "20",
                      "20",
                      "1",
                    ],
                  ],
                }
              : type === "alpaca"
                ? {
                    bars: {
                      [i.mappings.alpaca]: [
                        {
                          t: "2024-01-01T00:00:00Z",
                          o: 10,
                          h: 15,
                          l: 5,
                          c: 12,
                          v: 2,
                        },
                      ],
                    },
                  }
                : {
                    values: [
                      {
                        datetime: "2024-01-01",
                        open: "10",
                        high: "15",
                        low: "5",
                        close: "12",
                        volume: "2",
                      },
                    ],
                  };
      return { ok: true, json: async () => data };
    });
    for (const frame of timeframes) {
      const rows = await adapters[type].candles(
        i,
        frame.value,
        type === "alpaca"
          ? JSON.stringify({ key: "fixture", secret: "fixture" })
          : "fixture",
        { feed: "iex" },
      );
      assert.equal(rows.length, 1);
    }
    assert.equal(index, timeframes.length);
  });
}
test("engine bundles all 720 Kraken daily bars before limiting output and caches provenance", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "yield-frames-"));
  const store = createStore(dir);
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const p = {
    id: "fixture",
    type: "kraken",
    name: "Kraken",
    enabled: true,
    priority: 1,
    rpm: 100,
  };
  store.put("providers", [p]);
  const i = catalog.find((i) => i.symbol === "BTC/USD");
  store.put("instruments", [i]);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    const start = ts("2023-01-01");
    return {
      ok: true,
      json: async () => ({
        error: [],
        result: {
          pair: Array.from({ length: 720 }, (_, n) => [
            start + n * 86400,
            10,
            15,
            5,
            12,
            11,
            2,
            1,
          ]),
          last: 1,
        },
      }),
    };
  });
  const engine = new Engine(store);
  const result = await engine.history(i, "1y");
  assert.equal(result.candles[0].time, ts("2023-01-01"));
  assert.equal(result.candles[0].volume, 730);
  assert.equal(result.candles.length, 2);
  assert.equal(result.providerId, p.id);
  assert.equal(result.sourceInterval, "1d");
  assert.equal(result.aggregated, true);
  assert.equal(result.candles[0].partial, false);
  const cached = await engine.history(i, "1y");
  assert.equal(cached.cached, true);
  assert.equal(calls, 1);
});
