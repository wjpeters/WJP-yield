import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { createStore } from "./store.mjs";
import { registerDrawingRoutes, drawingSchema } from "./drawings.mjs";
import { timeToLogical, logicalToTime, fibPrice } from "../src/drawings.ts";
const drawing = (kind) => ({
  id: randomUUID(),
  kind,
  color: "#d4f77d",
  points: [
    { time: 1700000000, price: 100 },
    ...(kind === "horizontal" ? [] : [{ time: 1700003600, price: 120 }]),
  ],
});
test("time anchors round-trip across candle gaps, timeframe changes and future space", () => {
  const times = [1000, 1060, 1120, 1480, 1540];
  for (const time of [880, 1000, 1030, 1150, 1480, 1510, 1660]) {
    assert.ok(
      Math.abs(
        logicalToTime(timeToLogical(time, times, 60), times, 60) - time,
      ) < 1e-8,
    );
  }
  assert.equal(timeToLogical(1300, times, 60), 2.5);
  const coarse = [1000, 1300, 1600];
  assert.equal(
    logicalToTime(timeToLogical(1120, coarse, 300), coarse, 300),
    1120,
  );
  assert.equal(timeToLogical(1060, [1000], 60), 1);
});
test("Fibonacci retraces from endpoint to origin in both directions", () => {
  assert.equal(fibPrice(100, 200, 0), 200);
  assert.equal(fibPrice(100, 200, 1), 100);
  assert.equal(fibPrice(100, 200, 0.618), 138.2);
  assert.equal(fibPrice(200, 100, 0.5), 150);
});
test("drawing contract rejects malformed anchors and injected styles", () => {
  for (const kind of ["horizontal", "trend", "rectangle", "fib"])
    assert.ok(drawingSchema.safeParse(drawing(kind)).success);
  const valid = drawing("trend");
  for (const bad of [
    { ...valid, points: valid.points.slice(0, 1) },
    { ...valid, color: "url(https://example.org)" },
    { ...valid, points: [{ time: 1, price: Infinity }, valid.points[1]] },
    { ...valid, kind: "script" },
  ])
    assert.equal(drawingSchema.safeParse(bad).success, false);
});
test("drawing CRUD is isolated per instrument, bounded, and survives a database restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yield-drawings-"));
  let store = createStore(dir);
  let app = Fastify();
  await app.register(async (scope) => registerDrawingRoutes(scope, store));
  const ids = store
    .instruments()
    .slice(0, 2)
    .map((i) => i.id);
  const route = (id) => `/api/drawings/${encodeURIComponent(id)}`;
  const d = drawing("trend");
  try {
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `${route(ids[0])}/${d.id}`,
          payload: d,
        })
      ).statusCode,
      200,
    );
    assert.deepEqual((await app.inject(route(ids[0]))).json(), [d]);
    assert.deepEqual((await app.inject(route(ids[1]))).json(), []);
    const edited = { ...d, color: "#8aacf2" };
    await app.inject({
      method: "PUT",
      url: `${route(ids[0])}/${d.id}`,
      payload: edited,
    });
    await app.close();
    store.db.close();
    store = createStore(dir);
    app = Fastify();
    await app.register(async (scope) => registerDrawingRoutes(scope, store));
    assert.deepEqual((await app.inject(route(ids[0]))).json(), [edited]);
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `${route(ids[0])}/${randomUUID()}`,
          payload: d,
        })
      ).statusCode,
      400,
    );
    assert.equal((await app.inject(route("unknown"))).statusCode, 404);
    store.put(
      `drawings:${ids[0]}`,
      Array.from({ length: 100 }, () => drawing("horizontal")),
    );
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `${route(ids[0])}/${d.id}`,
          payload: d,
        })
      ).statusCode,
      400,
    );
    const existing = store.get(`drawings:${ids[0]}`, [])[0];
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `${route(ids[0])}/${existing.id}`,
          payload: existing,
        })
      ).statusCode,
      200,
    );
    await app.inject({
      method: "DELETE",
      url: `${route(ids[0])}/${existing.id}`,
    });
    assert.equal((await app.inject(route(ids[0]))).json().length, 99);
  } finally {
    await app.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
