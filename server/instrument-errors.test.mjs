import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adapters } from "./adapters.mjs";
import { catalog } from "./domain.mjs";
import { createStore } from "./store.mjs";
import { Engine } from "./engine.mjs";
const stock = catalog.find((i) => i.symbol === "AAPL");
const missing = {
  ...stock,
  id: "missing",
  symbol: "TLD0",
  exchange: "NYSE",
  mappings: { twelve: "TLD0", alpaca: "TLD0" },
};
const secret = JSON.stringify({ key: "fixture-key", secret: "fixture-secret" });
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "yield-errors-"));
  const store = createStore(dir);
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const p = {
    id: "test-provider",
    type: "twelve",
    name: "Test source",
    enabled: true,
    rpm: 100,
    priority: 1,
    secret: store.encrypt("fixture"),
  };
  store.put("providers", [p]);
  store.put("instruments", [missing]);
  return { store, p, engine: new Engine(store) };
}
function missingError() {
  return Object.assign(new Error("Instrument niet gevonden"), {
    scope: "instrument",
    status: 404,
  });
}
test("Twelve Data HTTP and JSON 404 identify the instrument without exposing provider text", async (t) => {
  for (const http of [true, false]) {
    const mock = t.mock.method(globalThis, "fetch", async () => ({
      ok: !http,
      status: http ? 404 : 200,
      json: async () => ({
        status: "error",
        code: 404,
        message: "fixture-secret",
      }),
    }));
    for (const call of [
      () => adapters.twelve.quote(missing, null, "fixture"),
      () => adapters.twelve.candles(missing, "1h", "fixture"),
    ])
      await assert.rejects(
        call,
        (e) =>
          e.scope === "instrument" &&
          e.status === 404 &&
          e.message.includes("symbool en beurs") &&
          !e.message.includes("fixture"),
      );
    mock.mock.restore();
  }
});
test("Alpaca classifies invalid symbols, but other 400 errors remain request failures", async (t) => {
  let message = "code=400, message=invalid symbol: TLD0 fixture-secret";
  t.mock.method(globalThis, "fetch", async () => ({
    ok: false,
    status: 400,
    json: async () => ({ message }),
  }));
  for (const call of [
    () => adapters.alpaca.quote(missing, null, secret, { feed: "iex" }),
    () => adapters.alpaca.candles(missing, "1h", secret, { feed: "iex" }),
  ])
    await assert.rejects(
      call,
      (e) =>
        e.scope === "instrument" &&
        e.status === 400 &&
        !e.message.includes("fixture"),
    );
  message = "invalid start parameter fixture-secret";
  await assert.rejects(
    () => adapters.alpaca.candles(stock, "1h", secret, { feed: "iex" }),
    (e) => !e.scope && e.message === "Alpaca: ongeldige aanvraagparameters",
  );
});
test("Missing symbols pause across quote and history, preserve healthy symbols and survive restart", async (t) => {
  const { store, p, engine } = setup(t);
  let calls = 0;
  const fail = async () => {
    calls++;
    throw missingError();
  };
  await assert.rejects(() => engine.request(p, fail, missing), /TLD0 \(NYSE\)/);
  for (let n = 0; n < 4; n++)
    await assert.rejects(() => engine.request(p, fail, missing), /TLD0/);
  assert.equal(calls, 1);
  assert.equal(engine.state(p.id).requests.length, 1);
  assert.equal(engine.state(p.id).failures, 0);
  assert.equal(engine.state(p.id).openUntil, 0);
  assert.equal(engine.state(p.id).error, null);
  await engine.request(p, async () => 123, stock);
  const restarted = new Engine(store);
  await assert.rejects(() => restarted.request(p, fail, missing), /TLD0/);
  assert.equal(calls, 1);
  assert.equal(
    restarted.snapshot().providers[0].health.instrumentIssues[0].symbol,
    "TLD0",
  );
  engine.issue(p, missing).retryAt = Date.now() - 1;
  await engine.request(p, async () => 123, missing);
  assert.equal(engine.issue(p, missing), undefined);
  assert.equal(new Engine(store).issue(p, missing), undefined);
});
test("History failover respects instrument pause without calling the rejected source again", async (t) => {
  const { store, p, engine } = setup(t);
  const backup = { ...p, id: "backup", priority: 2 };
  store.put("providers", [p, backup]);
  await assert.rejects(() =>
    engine.request(
      p,
      async () => {
        throw missingError();
      },
      missing,
    ),
  );
  let calls = 0;
  t.mock.method(adapters.twelve, "candles", async () => {
    calls++;
    return [{ time: 1000, open: 1, high: 2, low: 1, close: 2, volume: 3 }];
  });
  const result = await engine.history(missing, "1h");
  assert.equal(calls, 1);
  assert.equal(result.providerId, "backup");
  assert.match(result.failures[0].error, /TLD0/);
  assert.equal(engine.state(p.id).requests.length, 1);
});
test("Polling continues after a missing instrument and skips it on the next cycle", async (t) => {
  const { store, p, engine } = setup(t);
  store.put("watchlists", [
    { id: "test", name: "Test", instruments: [missing.id, stock.id] },
  ]);
  let rejected = 0,
    valid = 0;
  t.mock.method(adapters.twelve, "quote", async (i) => {
    if (i.id === missing.id) {
      rejected++;
      throw missingError();
    }
    valid++;
    return { price: 100, sourceAt: Date.now() };
  });
  await engine.poll();
  engine.state(p.id).lastPoll = 0;
  await engine.poll();
  assert.equal(rejected, 1);
  assert.equal(valid, 2);
  assert.equal(engine.state(p.id).status, "REST");
  assert.equal(engine.state(p.id).error, null);
});
test("Changing provider config clears pauses and late responses cannot reinstate them", async (t) => {
  const { p, engine } = setup(t);
  let reject;
  const pending = engine.request(
    p,
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
    missing,
  );
  engine.stop();
  engine.invalidate(p.id);
  reject(missingError());
  await assert.rejects(() => pending);
  assert.equal(engine.issue(p, missing), undefined);
  await assert.rejects(() =>
    engine.request(
      p,
      async () => {
        throw missingError();
      },
      missing,
    ),
  );
  engine.invalidate(p.id);
  assert.equal(engine.issue(p, missing), undefined);
});
