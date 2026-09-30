import { z } from "zod";

// Remove only user-created instruments with no remaining watchlist references.
// The discovery catalog and chart annotations are independent of watchlists.
function cleanUnreferenced(store, candidates) {
  const referenced = new Set(store.watchlists().flatMap((w) => w.instruments));
  const orphanIds = candidates.filter((id) => !referenced.has(id));
  const custom = store.get("instruments", []);
  store.put(
    "instruments",
    custom.filter((i) => !orphanIds.includes(i.id)),
  );
  return orphanIds;
}
export function registerWatchlistRoutes(app, store, onRemove = () => {}) {
  const watchSchema = z.object({
    name: z.string().trim().min(1).max(40),
    instruments: z.array(z.string()).max(50),
  });
  app.post("/api/watchlists", async (req, reply) => {
    const body = watchSchema.parse(req.body);
    if (store.watchlists().length >= 20)
      return reply.code(400).send({ error: "Maximaal 20 watchlists" });
    if (
      body.instruments.some(
        (id) => !store.instruments().some((i) => i.id === id),
      )
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
      body.instruments.some(
        (id) => !store.instruments().some((i) => i.id === id),
      )
    )
      return reply.code(400).send({ error: "Onbekend instrument" });
    const lists = store.watchlists();
    if (!lists.some((w) => w.id === req.params.id))
      return reply.code(404).send({ error: "Watchlist niet gevonden" });
    const previous = lists.find((w) => w.id === req.params.id);
    const candidates = previous.instruments.filter(
      (id) => !body.instruments.includes(id),
    );
    store.db.exec("BEGIN IMMEDIATE");
    let removed;
    try {
      store.put(
        "watchlists",
        lists.map((w) =>
          w.id === req.params.id
            ? { ...w, ...body, instruments: [...new Set(body.instruments)] }
            : w,
        ),
      );
      removed = cleanUnreferenced(store, candidates);
      store.db.exec("COMMIT");
    } catch (e) {
      store.db.exec("ROLLBACK");
      throw e;
    }
    if (removed.length) onRemove(removed);
    return { ok: true };
  });

  app.delete("/api/watchlists/:id", async (req, reply) => {
    const lists = store.watchlists();
    const list = lists.find((w) => w.id === req.params.id);
    if (!list)
      return reply.code(404).send({ error: "Watchlist niet gevonden" });
    store.db.exec("BEGIN IMMEDIATE");
    let removed;
    try {
      store.put(
        "watchlists",
        lists.filter((w) => w.id !== list.id),
      );
      removed = cleanUnreferenced(store, list.instruments);
      store.db.exec("COMMIT");
    } catch (e) {
      store.db.exec("ROLLBACK");
      throw e;
    }
    onRemove(removed);
    return { ok: true, removedInstrumentIds: removed };
  });
  app.delete("/api/watchlists/:id/items/:instrument", async (req, reply) => {
    const lists = store.watchlists();
    const list = lists.find((w) => w.id === req.params.id);
    if (!list)
      return reply.code(404).send({ error: "Watchlist niet gevonden" });
    if (!list.instruments.includes(req.params.instrument))
      return reply
        .code(404)
        .send({ error: "Vermelding niet gevonden in deze watchlist" });
    store.db.exec("BEGIN IMMEDIATE");
    let removed;
    try {
      store.put(
        "watchlists",
        lists.map((w) =>
          w.id === list.id
            ? {
                ...w,
                instruments: w.instruments.filter(
                  (id) => id !== req.params.instrument,
                ),
              }
            : w,
        ),
      );
      removed = cleanUnreferenced(store, [req.params.instrument]);
      store.db.exec("COMMIT");
    } catch (e) {
      store.db.exec("ROLLBACK");
      throw e;
    }
    onRemove(removed);
    return { ok: true, removedInstrumentIds: removed };
  });
}
