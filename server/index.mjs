import Fastify from "fastify";
import websocket from "@fastify/websocket";
import serveStatic from "@fastify/static";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createStore } from "./store.mjs";
import { Engine } from "./engine.mjs";
import { adaptersInfo, intervals } from "./domain.mjs";
import { adapters } from "./adapters.mjs";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const store = createStore(process.env.DATA_DIR || resolve(root, "data"));
const engine = new Engine(store);
const app = Fastify({ logger: false, bodyLimit: 32768 });
const origins = new Set([
  "http://localhost:4310",
  "http://127.0.0.1:4310",
  "http://localhost:4311",
  "http://127.0.0.1:4311",
]);
app.addHook("onRequest", async (req, reply) => {
  const host = (req.headers.host ?? "").split(":")[0];
  if (!["127.0.0.1", "localhost"].includes(host))
    return reply.code(403).send({ error: "Alleen lokale toegang toegestaan" });
  if (req.headers.origin && !origins.has(req.headers.origin))
    return reply.code(403).send({ error: "Origin niet toegestaan" });
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers["x-yield-request"] !== "1"
  )
    return reply.code(403).send({ error: "Lokale app-header ontbreekt" });
});
app.addHook("onSend", async (_req, reply) => {
  reply
    .header("X-Content-Type-Options", "nosniff")
    .header("Referrer-Policy", "no-referrer")
    .header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    )
    .header("Cache-Control", "no-store");
});
app.setErrorHandler((err, req, reply) => {
  if (err instanceof z.ZodError)
    return reply.code(400).send({
      error: "Controleer de ingevoerde waarden",
      fields: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  reply.code(err.statusCode ?? 502).send({
    error:
      err.statusCode && err.statusCode < 500
        ? err.message
        : "Databron tijdelijk niet beschikbaar",
    details: err.details,
  });
});
await app.register(websocket, { options: { maxPayload: 1024 } });
app.get("/api/health", async () => ({ ok: true, version: "0.1.0" }));
app.get("/api/state", async () => engine.snapshot());
app.get("/api/adapters", async () => adaptersInfo);
app.get("/api/candles", async (req, reply) => {
  const q = z
    .object({
      instrument: z.string(),
      interval: z.enum(Object.keys(intervals)),
      provider: z.string().optional(),
    })
    .parse(req.query);
  const i = store.instruments().find((i) => i.id === q.instrument);
  if (!i) return reply.code(404).send({ error: "Instrument niet gevonden" });
  try {
    return await engine.history(i, q.interval, q.provider);
  } catch (e) {
    return reply.code(503).send({ error: e.message, details: e.details });
  }
});
const providerSchema = z.object({
  type: z.enum(adaptersInfo.map((a) => a.type)),
  name: z.string().trim().min(1).max(48),
  priority: z.number().int().min(1).max(1000),
  enabled: z.boolean(),
  rpm: z.number().int().min(1).max(6000),
  apiKey: z.string().trim().max(512).optional(),
  clearKey: z.boolean().optional(),
});
app.post("/api/providers", async (req, reply) => {
  const { apiKey, clearKey, ...body } = providerSchema.parse(req.body);
  const providers = store.providers();
  if (providers.length >= 20)
    return reply.code(400).send({ error: "Maximaal 20 databronnen" });
  const provider = {
    ...body,
    id: store.id(),
    ...(apiKey ? { secret: store.encrypt(apiKey) } : {}),
  };
  providers.push(provider);
  store.put("providers", providers);
  engine.restart();
  return store.publicProvider(provider);
});
app.put("/api/providers/:id", async (req, reply) => {
  const { apiKey, clearKey, ...body } = providerSchema.parse(req.body);
  const providers = store.providers();
  const index = providers.findIndex((p) => p.id === req.params.id);
  if (index < 0) return reply.code(404).send({ error: "Bron niet gevonden" });
  if (providers[index].type !== body.type)
    return reply
      .code(400)
      .send({ error: "Adaptertype kan niet worden gewijzigd" });
  providers[index] = {
    ...providers[index],
    ...body,
    ...(clearKey
      ? { secret: undefined }
      : apiKey
        ? { secret: store.encrypt(apiKey) }
        : {}),
  };
  store.put("providers", providers);
  engine.cache.clear();
  engine.restart();
  return store.publicProvider(providers[index]);
});
app.delete("/api/providers/:id", async (req) => {
  store.put(
    "providers",
    store.providers().filter((p) => p.id !== req.params.id),
  );
  engine.restart();
  return { ok: true };
});
app.post("/api/providers/:id/test", async (req, reply) => {
  const p = store.providers().find((p) => p.id === req.params.id);
  if (!p) return reply.code(404).send({ error: "Bron niet gevonden" });
  if (adaptersInfo.find((a) => a.type === p.type)?.keyRequired && !p.secret)
    return reply.code(400).send({ error: "Voeg eerst een API-sleutel toe" });
  const i = store.instruments().find((i) => i.mappings[p.type]);
  try {
    const q = await engine.request(p, (key) =>
      adapters[p.type].quote(i, null, key),
    );
    if (!engine.ingest(p, i, q)) throw new Error("Ongeldige koers ontvangen");
    return {
      ok: true,
      symbol: i.symbol,
      latencyMs: engine.state(p.id).latencyMs,
    };
  } catch (e) {
    return reply.code(503).send({ error: e.message });
  }
});
const watchSchema = z.object({
  name: z.string().trim().min(1).max(40),
  instruments: z.array(z.string()).max(50),
});
app.post("/api/watchlists", async (req, reply) => {
  const body = watchSchema.parse(req.body);
  if (store.watchlists().length >= 20)
    return reply.code(400).send({ error: "Maximaal 20 watchlists" });
  if (
    body.instruments.some((id) => !store.instruments().some((i) => i.id === id))
  )
    return reply.code(400).send({ error: "Onbekend instrument" });
  const w = {
    ...body,
    instruments: [...new Set(body.instruments)],
    id: store.id(),
  };
  store.put("watchlists", [...store.watchlists(), w]);
  return w;
});
app.put("/api/watchlists/:id", async (req, reply) => {
  const body = watchSchema.parse(req.body);
  if (
    body.instruments.some((id) => !store.instruments().some((i) => i.id === id))
  )
    return reply.code(400).send({ error: "Onbekend instrument" });
  const lists = store.watchlists();
  if (!lists.some((w) => w.id === req.params.id))
    return reply.code(404).send({ error: "Watchlist niet gevonden" });
  store.put(
    "watchlists",
    lists.map((w) =>
      w.id === req.params.id
        ? { ...w, ...body, instruments: [...new Set(body.instruments)] }
        : w,
    ),
  );
  return { ok: true };
});
app.delete("/api/watchlists/:id", async (req, reply) => {
  if (store.watchlists().length <= 1)
    return reply.code(400).send({ error: "Behoud minimaal één watchlist" });
  store.put(
    "watchlists",
    store.watchlists().filter((w) => w.id !== req.params.id),
  );
  return { ok: true };
});
const instrumentSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9./:_-]+$/),
  name: z.string().trim().min(1).max(80),
  assetClass: z.enum([
    "stock",
    "etf",
    "forex",
    "commodity",
    "index",
    "bond",
    "future",
  ]),
  exchange: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .regex(/^[A-Za-z0-9 _-]+$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
app.post("/api/instruments", async (req, reply) => {
  const body = instrumentSchema.parse(req.body);
  const id = `${body.assetClass}:${body.exchange}:${body.symbol}:${body.currency}`;
  if (store.instruments().some((i) => i.id === id))
    return reply.code(409).send({ error: "Instrument bestaat al" });
  const custom = store.get("instruments", []);
  if (custom.length >= 200)
    return reply.code(400).send({ error: "Maximaal 200 eigen instrumenten" });
  const item = { ...body, id, mappings: { twelve: body.symbol } };
  store.put("instruments", [...custom, item]);
  return item;
});
const clients = new Set();
app.get("/ws", { websocket: true }, (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify(engine.snapshot()));
  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});
const timer = setInterval(() => {
  if (!clients.size) return;
  const payload = JSON.stringify(engine.snapshot());
  for (const client of clients) {
    if (client.readyState === 1 && client.bufferedAmount < 512000)
      client.send(payload);
    else if (client.bufferedAmount >= 512000) client.terminate();
  }
}, 1000);
if (existsSync(resolve(root, "dist"))) {
  await app.register(serveStatic, { root: resolve(root, "dist") });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/"))
      reply.code(404).send({ error: "Niet gevonden" });
    else reply.sendFile("index.html");
  });
}
engine.restart();
await app.listen({
  port: Number(process.env.PORT || 4310),
  host: process.env.HOST || "127.0.0.1",
});
console.log("WJP yield gestart; lokale marktdata-terminal gereed.");
const stop = async () => {
  clearInterval(timer);
  engine.stop();
  for (const client of clients) client.close();
  await app.close();
  store.db.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
