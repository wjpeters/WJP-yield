import { z } from "zod";
const anchor = z
  .object({
    time: z.number().min(1).max(4102444800),
    price: z.number().finite().min(-1e12).max(1e12),
  })
  .strict();
export const drawingSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["horizontal", "trend", "rectangle", "fib"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    points: z.array(anchor).min(1).max(2),
  })
  .strict()
  .refine(
    (d) => d.points.length === (d.kind === "horizontal" ? 1 : 2),
    "Ongeldig aantal ankerpunten",
  );
export function registerDrawingRoutes(app, store) {
  app.addHook("preHandler", async (req, reply) => {
    if (!store.instruments().some((i) => i.id === req.params.instrument))
      return reply.code(404).send({ error: "Instrument niet gevonden" });
  });
  const key = (req) => `drawings:${req.params.instrument}`;
  app.get("/api/drawings/:instrument", async (req) => store.get(key(req), []));
  app.put("/api/drawings/:instrument/:id", async (req, reply) => {
    const parsed = drawingSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.id !== req.params.id)
      return reply.code(400).send({ error: "Ongeldige tekening" });
    const drawings = store.get(key(req), []);
    const index = drawings.findIndex((d) => d.id === parsed.data.id);
    if (index < 0 && drawings.length >= 100)
      return reply
        .code(400)
        .send({ error: "Maximaal 100 tekeningen per instrument" });
    if (index < 0) drawings.push(parsed.data);
    else drawings[index] = parsed.data;
    store.put(key(req), drawings);
    return parsed.data;
  });
  app.delete("/api/drawings/:instrument/:id", async (req) => {
    store.put(
      key(req),
      store.get(key(req), []).filter((d) => d.id !== req.params.id),
    );
    return { ok: true };
  });
}
