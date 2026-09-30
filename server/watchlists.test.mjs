import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "./store.mjs";
import { registerWatchlistRoutes } from "./watchlists.mjs";
import { Engine } from "./engine.mjs";
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "yield-watch-"));
  const store = createStore(dir);
  const app = Fastify();
  const engine = new Engine(store);
  registerWatchlistRoutes(app, store, (ids) => engine.releaseUnwatched(ids));
  t.after(async () => {
    await app.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const builtin = store.instruments()[0];
  const shared = {
    ...builtin,
    id: "custom:shared",
    symbol: "SHARED",
    mappings: { twelve: "SHARED" },
  };
  const unique = {
    ...builtin,
    id: "custom:unique",
    symbol: "UNIQUE",
    mappings: { twelve: "UNIQUE" },
  };
  const unrelated = { ...builtin, id: "custom:unrelated", symbol: "UNRELATED" };
  store.put("instruments", [shared, unique, unrelated]);
  store.put("watchlists", [
    { id: "one", name: "One", instruments: [builtin.id, shared.id, unique.id] },
    { id: "two", name: "Two", instruments: [shared.id] },
  ]);
  return { app, store, engine, builtin, shared, unique, unrelated, dir };
}
test("Deleting a watchlist removes its unique custom instruments and preserves shared and catalog instruments", async (t) => {
  const { app, store, engine, builtin, shared, unique, unrelated } =
    await setup(t);
  engine.touch(unique.id);
  engine.touch(shared.id);
  const p = store.providers()[0];
  engine.instrumentIssues.set(engine.issueKey(p, unique), {
    providerId: p.id,
    instrumentId: unique.id,
    error: "missing",
    retryAt: Date.now() + 1000,
  });
  const response = await app.inject({
    method: "DELETE",
    url: "/api/watchlists/one",
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(store.watchlists(), [
    { id: "two", name: "Two", instruments: [shared.id] },
  ]);
  for (const i of [builtin, shared, unrelated])
    assert.ok(store.instruments().some((x) => x.id === i.id));
  assert.ok(!store.instruments().some((x) => x.id === unique.id));
  assert.ok(!engine.active.has(unique.id));
  assert.ok(engine.active.has(shared.id));
  assert.equal(engine.instrumentIssues.size, 0);
  assert.equal(
    engine.ingest(p, unique, { price: 100, sourceAt: Date.now() }),
    false,
  );
});
test("Deleting a single entry preserves other list memberships, then cleans up its last reference", async (t) => {
  const { app, store, shared } = await setup(t);
  const url = (id) =>
    `/api/watchlists/${id}/items/${encodeURIComponent(shared.id)}`;
  assert.equal(
    (await app.inject({ method: "DELETE", url: url("one") })).statusCode,
    200,
  );
  assert.ok(store.instruments().some((i) => i.id === shared.id));
  assert.ok(
    store
      .watchlists()
      .find((w) => w.id === "two")
      .instruments.includes(shared.id),
  );
  assert.equal(
    (await app.inject({ method: "DELETE", url: url("two") })).statusCode,
    200,
  );
  assert.ok(!store.instruments().some((i) => i.id === shared.id));
  assert.deepEqual(
    store.watchlists().find((w) => w.id === "two").instruments,
    [],
  );
});
test("The final watchlist can be deleted, stays empty after reopening and can be created again", async (t) => {
  const { app, store, dir } = await setup(t);
  for (const id of ["one", "two"])
    assert.equal(
      (await app.inject({ method: "DELETE", url: `/api/watchlists/${id}` }))
        .statusCode,
      200,
    );
  assert.deepEqual(store.watchlists(), []);
  const reopened = createStore(dir);
  assert.deepEqual(reopened.watchlists(), []);
  reopened.db.close();
  const created = await app.inject({
    method: "POST",
    url: "/api/watchlists",
    payload: { name: "Fresh", instruments: [] },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(store.watchlists().length, 1);
});
test("Missing targets are rejected without altering existing lists or custom instruments", async (t) => {
  const { app, store } = await setup(t);
  const before = JSON.stringify([store.watchlists(), store.get("instruments")]);
  for (const url of [
    "/api/watchlists/missing",
    "/api/watchlists/one/items/missing",
    "/api/watchlists/missing/items/missing",
  ])
    assert.equal((await app.inject({ method: "DELETE", url })).statusCode, 404);
  assert.equal(
    JSON.stringify([store.watchlists(), store.get("instruments")]),
    before,
  );
});
test("Legacy full-list updates apply the same orphan cleanup rules", async (t) => {
  const { app, store, shared, unique } = await setup(t);
  const response = await app.inject({
    method: "PUT",
    url: "/api/watchlists/one",
    payload: { name: "Renamed", instruments: [] },
  });
  assert.equal(response.statusCode, 200);
  assert.ok(store.instruments().some((i) => i.id === shared.id));
  assert.ok(!store.instruments().some((i) => i.id === unique.id));
  assert.equal(store.watchlists()[0].name, "Renamed");
});
