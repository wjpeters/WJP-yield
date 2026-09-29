import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectQuote, normalizeCandles, validQuote } from "./domain.mjs";
import { createStore } from "./store.mjs";
import { Engine } from "./engine.mjs";
const now = Date.now();
const providers = [
  { id: "primary", priority: 10, enabled: true },
  { id: "backup", priority: 20, enabled: true },
];
const quote = (id, age = 0) => ({
  providerId: id,
  price: 100,
  sourceAt: now - age,
  receivedAt: now,
  transport: "WebSocket",
  assetClass: "crypto",
});
test("Router kiest verse primaire feed en schakelt bij veroudering over", () => {
  assert.equal(
    selectQuote(
      providers,
      new Map([
        ["primary", quote("primary")],
        ["backup", quote("backup")],
      ]),
      now,
    ).providerId,
    "primary",
  );
  assert.equal(
    selectQuote(
      providers,
      new Map([
        ["primary", quote("primary", 46000)],
        ["backup", quote("backup")],
      ]),
      now,
    ).providerId,
    "backup",
  );
});
test("Uitgeschakelde feed wordt nooit geselecteerd en alle oude quotes blijven expliciet stale", () => {
  assert.equal(
    selectQuote(
      [{ ...providers[0], enabled: false }, providers[1]],
      new Map([["primary", quote("primary")]]),
      now,
    ),
    null,
  );
  assert.equal(
    selectQuote(providers, new Map([["primary", quote("primary", 60000)]]), now)
      .stale,
    true,
  );
});
test("Afwezige provider-tijd gebruikt ontvangsttijd en herlabelt oude quotes niet", () => {
  assert.equal(
    selectQuote(
      providers,
      new Map([
        [
          "primary",
          { ...quote("primary"), sourceAt: null, receivedAt: now - 50000 },
        ],
      ]),
      now,
    ).stale,
    true,
  );
});
test("Ongeldige en toekomstige koersen worden verworpen", () => {
  assert.equal(validQuote(quote("x")), true);
  for (const price of [0, -1, NaN, Infinity])
    assert.equal(validQuote({ ...quote("x"), price }), false);
  assert.equal(validQuote({ ...quote("x"), sourceAt: now + 100000 }), false);
});
test("Candles worden gededupliceerd, gesorteerd en inhoudelijk gevalideerd", () => {
  const c = { time: 1000, open: 10, high: 12, low: 9, close: 11, volume: 3 };
  const rows = normalizeCandles([
    c,
    { ...c, time: 900 },
    { ...c, close: 12 },
    { ...c, time: 1100, low: 11 },
    { ...c, time: 1200, volume: -1 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].time, 900);
  assert.equal(rows[1].close, 12);
});
test("Sleutels blijven versleuteld, niet in API-objecten en persistent over heropenen", () => {
  const dir = mkdtempSync(join(tmpdir(), "yield-test-"));
  try {
    const s = createStore(dir);
    const secret = s.encrypt("test-only-key");
    assert.ok(!secret.includes("test-only-key"));
    assert.equal(s.decrypt(secret), "test-only-key");
    assert.equal(s.publicProvider({ id: "p", secret }).secret, undefined);
    s.put("test", { secret });
    s.db.close();
    const next = createStore(dir);
    assert.equal(next.decrypt(next.get("test").secret), "test-only-key");
    next.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Ingest weigert out-of-order updates; ontvangsttijd van oude quote blijft intact", () => {
  const dir = mkdtempSync(join(tmpdir(), "yield-test-"));
  const s = createStore(dir);
  try {
    const engine = new Engine(s);
    const p = s.providers()[0];
    const i = s.instruments()[0];
    assert.equal(engine.ingest(p, i, { ...quote(p.id), sourceAt: now }), true);
    assert.equal(
      engine.ingest(p, i, { ...quote(p.id), sourceAt: now - 1000, price: 90 }),
      false,
    );
    assert.equal(engine.selected(i).price, 100);
  } finally {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Rate limiter verhindert extra providerverzoeken", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yield-test-"));
  const s = createStore(dir);
  try {
    const engine = new Engine(s);
    const p = { ...s.providers()[0], rpm: 1 };
    let count = 0;
    await engine.request(p, async () => ++count);
    await assert.rejects(
      () => engine.request(p, async () => ++count),
      /aanvraaglimiet/,
    );
    assert.equal(count, 1);
  } finally {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Circuit breaker opent na drie fouten", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yield-test-"));
  const s = createStore(dir);
  try {
    const engine = new Engine(s);
    const p = s.providers()[0];
    for (let n = 0; n < 3; n++)
      await assert.rejects(() =>
        engine.request(p, async () => {
          throw new Error("offline");
        }),
      );
    await assert.rejects(
      () => engine.request(p, async () => true),
      /gepauzeerd/,
    );
  } finally {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Aanvraagbudget en foutpauze overleven een engine-herstart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yield-test-"));
  const s = createStore(dir);
  try {
    const p = { ...s.providers()[0], rpm: 1 };
    const e = new Engine(s);
    await e.request(p, async () => true);
    const restarted = new Engine(s);
    await assert.rejects(
      () => restarted.request(p, async () => true),
      /aanvraaglimiet/,
    );
    const p2 = { ...p, id: "rate-limited", rpm: 8 };
    const error = new Error("Rate limit bereikt");
    error.status = 429;
    await assert.rejects(() =>
      e.request(p2, async () => {
        throw error;
      }),
    );
    await assert.rejects(
      () => new Engine(s).request(p2, async () => true),
      /gepauzeerd/,
    );
  } finally {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
