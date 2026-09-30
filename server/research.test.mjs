import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  Research,
  rssNewsData,
  registerResearchRoutes,
  coinFundamentals,
  secFundamentals,
  sentimentData,
  newsData,
  newsQuery,
  safeUrl,
} from "./research.mjs";
import { technicals } from "../src/technicals.ts";

const now = Date.now();
const candles = (n, step = 0, base = 100) =>
  Array.from({ length: n }, (_, k) => ({
    time: Math.floor(now / 1000) - (n - k + 1) * 86400,
    open: base + k * step,
    high: base + k * step + 2,
    low: base + k * step - 2,
    close: base + k * step,
    volume: 1,
  }));
test("Gauge onderscheidt ontbrekende historie en een echte neutrale markt", () => {
  assert.equal(technicals(candles(10), "1d", now).label, null);
  const flat = technicals(candles(240), "1d", now);
  assert.equal(flat.label, "Neutral");
  assert.equal(flat.score, 0);
  assert.equal(flat.available, 8);
});
test("Trend wijzigt de gauge; lopende en gedeeltelijke candles tellen niet mee", () => {
  const up = technicals(candles(240, 1), "1d", now),
    down = technicals(candles(240, -0.2), "1d", now);
  assert.ok(up.score > 0);
  assert.ok(down.score < 0);
  const open = { ...candles(1)[0], time: Math.floor(now / 1000), close: 10000 };
  const partial = { ...candles(1)[0], partial: true, close: 10000 };
  const unconfirmed = { ...candles(1)[0], confirmed: false, close: 10000 };
  assert.deepEqual(
    technicals([...candles(240), open, partial, unconfirmed], "1d", now),
    technicals(candles(240), "1d", now),
  );
});
test("Crypto koppelt op bevestigde ID, ontbrekende voorraad blijft null", () => {
  assert.throws(() =>
    coinFundamentals({ id: "other", market_data: {} }, "bitcoin"),
  );
  const r = coinFundamentals(
    { id: "bitcoin", symbol: "btc", market_data: { market_cap: { usd: 100 } } },
    "bitcoin",
  );
  assert.equal(
    r.metrics.find((m) => m.label === "Maximale voorraad").value,
    null,
  );
  assert.equal(r.metrics[0].unit, "USD");
});
test("SEC neemt jaarcijfers met passende duur en laatst gerapporteerde balans", () => {
  const row = (val, start, end, filed = "2025-11-01") => ({
    val,
    start,
    end,
    filed,
    form: "10-K",
  });
  const d = {
    cik: 320193,
    entityName: "Apple Inc",
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              row(20, "2024-07-01", "2024-09-30"),
              row(100, "2024-01-01", "2024-12-31"),
              row(110, "2024-01-01", "2024-12-31", "2026-01-01"),
            ],
          },
        },
        Assets: { units: { USD: [row(200, undefined, "2025-09-30")] } },
      },
    },
  };
  const result = secFundamentals(d, "0000320193");
  assert.equal(result.metrics[0].value, 110);
  assert.equal(result.metrics[0].filed, "2026-01-01");
  assert.equal(result.metrics.find((m) => m.label === "Activa").value, 200);
  assert.equal(
    result.metrics.find((m) => m.label === "Nettowinst · jaar").value,
    null,
  );
  assert.throws(() => secFundamentals(d, "999"));
});
test("Nieuws weert onveilige links en dubbels; sentiment bewaart brontijd", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("https://user:pass@site.test"), null);
  const result = newsData(
    {
      articles: [
        { title: "Bad", url: "javascript:alert(1)" },
        {
          title: "Article",
          url: "https://news.test/1",
          seendate: "20260929T100000Z",
        },
        { title: "Duplicate", url: "https://news.test/1" },
      ],
    },
    "bitcoin",
  );
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].at, Date.parse("2026-09-29T10:00:00Z"));
  const sentiment = sentimentData({
    data: [
      {
        value: "40",
        timestamp: String(Math.floor(now / 1000)),
        value_classification: "Fear",
      },
    ],
  });
  assert.equal(sentiment.points[0].value, 40);
  assert.throws(() =>
    sentimentData({ data: [{ value: "101", timestamp: "100" }] }),
  );
  assert.ok(
    newsQuery({
      symbol: "BTC/USD",
      name: "Bitcoin",
      assetClass: "crypto",
    }).includes("crypto"),
  );
});
test("Research deelt requests, cachet en bewaart oude data herkenbaar bij storing", async () => {
  let at = now,
    calls = 0,
    fail = false;
  const service = new Research({ clock: () => at });
  const job = async () => {
    calls++;
    if (fail) throw new Error("offline");
    return { status: "ok", value: 42 };
  };
  const [a, b] = await Promise.all([
    service.cached("x", 1000, "test", "https://example.test", job),
    service.cached("x", 1000, "test", "https://example.test", job),
  ]);
  assert.equal(calls, 1);
  assert.equal(a.value, b.value);
  await service.cached("x", 1000, "test", "https://example.test", job);
  assert.equal(calls, 1);
  at += 2000;
  fail = true;
  const stale = await service.cached(
    "x",
    1000,
    "test",
    "https://example.test",
    job,
  );
  assert.equal(stale.value, 42);
  assert.equal(stale.stale, true);
  assert.equal(stale.error, "offline");
  await service.cached("x", 1000, "test", "https://example.test", job);
  assert.equal(calls, 2);
});
test("Aanvraagbudget beperkt openbare bronnen en onbekende munt wordt niet geraden", async () => {
  let calls = 0;
  const service = new Research({
    clock: () => now,
    fetcher: async () => {
      calls++;
      return { ok: true, json: async () => ({}) };
    },
  });
  for (let n = 0; n < 12; n++)
    await service.json("https://api.coingecko.com/api/v3/ping");
  await assert.rejects(
    service.json("https://api.coingecko.com/api/v3/ping"),
    /begrensd/,
  );
  assert.equal(calls, 12);
  const unknown = await service.section(
    { assetClass: "crypto", base: "FAKE", symbol: "FAKE/USD" },
    "fundamentals",
  );
  assert.equal(unknown.status, "unavailable");
  assert.equal(calls, 12);
  const stock = await service.section({ assetClass: "stock" }, "sentiment");
  assert.equal(stock.status, "unavailable");
  assert.equal(calls, 12);
});
test("API valideert instrument en sectie en geeft alleen genormaliseerde data", async () => {
  const app = Fastify();
  let touched;
  registerResearchRoutes(
    app,
    { instruments: () => [{ id: "btc", assetClass: "crypto" }] },
    {
      touch: (id) => {
        touched = id;
      },
    },
    { section: async () => ({ status: "ok", source: "test" }) },
  );
  const good = await app.inject("/api/research?instrument=btc&section=news");
  assert.equal(good.statusCode, 200);
  assert.equal(good.json().instrumentId, "btc");
  assert.equal(touched, "btc");
  assert.equal(
    (await app.inject("/api/research?instrument=missing&section=news"))
      .statusCode,
    404,
  );
  assert.notEqual(
    (await app.inject("/api/research?instrument=btc&section=secret"))
      .statusCode,
    200,
  );
  await app.close();
});

test("RSS-terugval bewaart uitgever en publicatietijd, decodeert titels en weert DTD", () => {
  const published = new Date(now - 3600000).toUTCString();
  const xml = `<rss><channel><title>News</title><item><title>Bitcoin &amp; markets</title><link>https://news.google.com/articles/1</link><pubDate>${published}</pubDate><source url="https://publisher.test">Publisher</source></item><item><title>Unsafe</title><link>javascript:alert(1)</link></item></channel></rss>`;
  const result = rssNewsData(xml, "Bitcoin crypto", now);
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].title, "Bitcoin & markets");
  assert.equal(result.articles[0].domain, "Publisher");
  assert.equal(result.articles[0].timeKind, "publication");
  assert.throws(() =>
    rssNewsData('<!DOCTYPE x [<!ENTITY z "test">]><rss/>', "x"),
  );
});

test("Nieuws schakelt bij GDELT-limiet naar openbare RSS zonder geheime headers", async () => {
  const calls = [];
  const service = new Research({
    clock: () => now,
    fetcher: async (url, options) => {
      calls.push({ url, headers: options.headers });
      if (new URL(url).host === "api.gdeltproject.org")
        return { ok: false, status: 429 };
      return {
        ok: true,
        text: async () =>
          "<rss><channel><item><title>Bitcoin news</title><link>https://news.google.com/articles/2</link></item></channel></rss>",
      };
    },
  });
  const result = await service.section(
    { assetClass: "crypto", name: "Bitcoin", symbol: "BTC/EUR", base: "BTC" },
    "news",
  );
  assert.equal(result.status, "ok");
  assert.equal(result.articles.length, 1);
  assert.match(result.fallback, /Bronlimiet/);
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      (call) =>
        !Object.keys(call.headers).some((key) =>
          /key|secret|authorization/i.test(key),
        ),
    ),
  );
});
