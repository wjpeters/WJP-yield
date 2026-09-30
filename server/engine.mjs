import WebSocket from "ws";
import { connectOKX } from "./okx.mjs";
import { connectAlpaca } from "./alpaca.mjs";
import { adapters, streamQuote, supportsInstrument } from "./adapters.mjs";
import { validQuote, selectQuote, isFresh, adaptersInfo } from "./domain.mjs";
import { candleSource, aggregateCandles } from "./timeframes.mjs";
const needsKey = (p) =>
  adaptersInfo.find((a) => a.type === p.type)?.keyRequired;
export class Engine {
  constructor(store) {
    this.store = store;
    this.quotes = new Map();
    this.health = new Map();
    this.sockets = new Map();
    this.timers = new Set();
    this.cache = new Map();
    this.pending = new Map();
    this.lastRoute = new Map();
    this.events = [];
    this.generation = 0;
    this.running = false;
    this.active = new Map();
    this.instrumentIssues = new Map(store.get("instrument-issues", []));
  }
  providers() {
    return this.store.providers();
  }
  state(id) {
    if (!this.health.has(id))
      this.health.set(id, {
        status: "wachten",
        lastReceived: null,
        latencyMs: null,
        failures: 0,
        openUntil: 0,
        error: null,
        requests: [],
        lastPoll: 0,
        ...this.store.get(`budget:${id}`, {}),
      });
    return this.health.get(id);
  }
  touch(id) {
    this.active.set(id, Date.now());
  }
  instruments() {
    const ids = new Set([
      ...this.store.watchlists().flatMap((w) => w.instruments),
      ...Array.from(this.active)
        .filter(([, t]) => Date.now() - t < 120000)
        .map(([id]) => id),
    ]);
    return this.store
      .instruments()
      .filter((i) => ids.has(i.id))
      .slice(0, 100);
  }
  eligible(i) {
    return this.providers()
      .filter(
        (p) =>
          p.enabled && supportsInstrument(i, p) && (!needsKey(p) || p.secret),
      )
      .sort((a, b) => a.priority - b.priority);
  }
  ingest(p, i, q, transport = "REST") {
    if (!this.store.instruments().some((row) => row.id === i.id)) return false;
    const result = {
      ...q,
      instrumentId: i.id,
      providerId: p.id,
      provider: p.name,
      assetClass: i.assetClass,
      currency: i.currency,
      receivedAt: Date.now(),
      transport,
    };
    if (!validQuote(result)) return false;
    const values = this.quotes.get(i.id) ?? new Map();
    const old = values.get(p.id);
    if (old?.sourceAt && result.sourceAt && result.sourceAt < old.sourceAt)
      return false;
    values.set(p.id, result);
    this.quotes.set(i.id, values);
    const s = this.state(p.id);
    s.lastReceived = result.receivedAt;
    s.status = transport === "WebSocket" ? "streaming" : "REST";
    if (transport === "REST") {
      s.error = null;
    }
    return true;
  }
  selected(i) {
    const q = selectQuote(this.eligible(i), this.quotes.get(i.id) ?? new Map());
    if (q) {
      const old = this.lastRoute.get(i.id);
      if (old && old !== q.providerId) {
        this.events.unshift({
          at: Date.now(),
          instrument: i.symbol,
          from: old,
          to: q.providerId,
          reason: "Prioriteit, beschikbaarheid of actualiteit gewijzigd",
        });
        this.events = this.events.slice(0, 30);
      }
      this.lastRoute.set(i.id, q.providerId);
    }
    return q;
  }
  snapshot() {
    const providers = this.providers();
    const instruments = this.store.instruments().map((i) => ({
      ...i,
      providerIds: providers
        .filter((p) => supportsInstrument(i, p))
        .map((p) => p.id),
    }));
    return {
      at: Date.now(),
      adapters: adaptersInfo,
      instruments,
      watchlists: this.store.watchlists(),
      quotes: Object.fromEntries(
        instruments.map((i) => [i.id, this.selected(i)]),
      ),
      comparisons: Object.fromEntries(
        instruments.map((i) => [
          i.id,
          [...(this.quotes.get(i.id)?.values() ?? [])]
            .filter((q) =>
              this.providers().some(
                (p) =>
                  p.id === q.providerId &&
                  p.enabled &&
                  supportsInstrument(i, p),
              ),
            )
            .map((q) => ({ ...q, stale: !isFresh(q) })),
        ]),
      ),
      providers: this.providers().map((p) => {
        const s = this.state(p.id);
        return {
          ...this.store.publicProvider(p),
          health: {
            ...s,
            requests: undefined,
            instrumentIssues: [...this.instrumentIssues.values()].filter(
              (issue) =>
                issue.providerId === p.id &&
                instruments.some(
                  (i) =>
                    this.instrumentIssues.get(this.issueKey(p, i)) === issue,
                ),
            ),
            status: !p.enabled
              ? "uitgeschakeld"
              : needsKey(p) && !p.secret
                ? "sleutel nodig"
                : s.lastReceived && Date.now() - s.lastReceived > 60000
                  ? "geen recente data"
                  : s.status,
            usedThisMinute: s.requests.filter((t) => Date.now() - t < 60000)
              .length,
          },
        };
      }),
      events: this.events,
    };
  }
  issueKey(p, i) {
    return JSON.stringify([
      p.id,
      p.feed,
      i.id,
      i.exchange,
      i.currency,
      i.mappings[p.type],
    ]);
  }
  saveIssues() {
    // Bound persisted diagnostics to current instruments and providers.
    const keys = new Set(
      this.providers().flatMap((p) =>
        this.store.instruments().map((i) => this.issueKey(p, i)),
      ),
    );
    for (const key of this.instrumentIssues.keys())
      if (!keys.has(key)) this.instrumentIssues.delete(key);
    this.store.put("instrument-issues", [...this.instrumentIssues]);
  }
  issue(p, i) {
    return this.instrumentIssues.get(this.issueKey(p, i));
  }
  reserveBudget(p) {
    const s = this.state(p.id);
    const now = Date.now();
    if (s.openUntil > now)
      throw new Error("Bron tijdelijk gepauzeerd na fouten");
    s.requests = s.requests.filter((t) => now - t < 60000);
    if (s.requests.length >= p.rpm)
      throw new Error("Lokale aanvraaglimiet bereikt");
    s.requests.push(now);
    this.store.put(`budget:${p.id}`, {
      requests: s.requests,
      failures: s.failures,
      openUntil: s.openUntil,
    });
    return s;
  }
  async request(p, job, instrument) {
    const issue = instrument && this.issue(p, instrument);
    if (issue?.retryAt > Date.now()) throw new Error(issue.error);
    const generation = this.generation;
    const s = this.reserveBudget(p);
    const start = performance.now();
    try {
      const value = await job(this.store.decrypt(p.secret));
      if (instrument && generation === this.generation) {
        this.instrumentIssues.delete(this.issueKey(p, instrument));
        if (issue) this.saveIssues();
      }
      s.latencyMs = Math.round(performance.now() - start);
      s.failures = 0;
      s.openUntil = 0;
      s.error = null;
      return value;
    } catch (e) {
      if (e.scope === "instrument" && instrument) {
        const error = `${instrument.symbol} (${instrument.exchange}): ${e.message}`;
        if (generation === this.generation) {
          this.instrumentIssues.set(this.issueKey(p, instrument), {
            providerId: p.id,
            instrumentId: instrument.id,
            symbol: instrument.symbol,
            error,
            retryAt: Date.now() + 15 * 60000,
          });
          this.quotes.get(instrument.id)?.delete(p.id);
          this.saveIssues();
        }
        // A missing listing must not open the circuit for healthy instruments.
        throw new Error(error);
      }
      s.failures++;
      s.error = e.message.includes("http")
        ? "Verbinding met provider mislukt"
        : e.message;
      s.status = "fout";
      if (s.failures >= 3 || e.status === 429) s.openUntil = Date.now() + 60000;
      throw new Error(s.error);
    } finally {
      this.store.put(`budget:${p.id}`, {
        requests: s.requests,
        failures: s.failures,
        openUntil: s.openUntil,
      });
    }
  }
  async poll() {
    const generation = this.generation;
    for (const p of this.providers().filter((p) => p.enabled)) {
      if (generation !== this.generation) return;
      const s = this.state(p.id);
      if (needsKey(p) && !p.secret) continue;
      if (Date.now() - s.lastPoll < (p.type === "twelve" ? 60000 : 20000))
        continue;
      s.lastPoll = Date.now();
      const eligible = this.instruments().filter((i) =>
        supportsInstrument(i, p),
      );
      const offset = (s.pollOffset ?? 0) % Math.max(1, eligible.length);
      const ordered = [...eligible.slice(offset), ...eligible.slice(0, offset)];
      for (const i of ordered) {
        if (generation !== this.generation) return;
        if (s.requests.filter((t) => Date.now() - t < 60000).length >= p.rpm)
          break;
        s.pollOffset = (eligible.indexOf(i) + 1) % Math.max(1, eligible.length);
        const old = this.quotes.get(i.id)?.get(p.id);
        if (old?.transport === "WebSocket" && isFresh(old)) continue;
        try {
          const q = await this.request(
            p,
            (key) => adapters[p.type].quote(i, null, key, p),
            i,
          );
          if (generation !== this.generation) return;
          if (this.providers().some((x) => x.id === p.id && x.enabled))
            this.ingest(p, i, q);
        } catch {}
      }
    }
  }
  async history(i, interval, preferred) {
    const generation = this.generation;
    this.touch(i.id);
    const providers = this.eligible(i).sort((a, b) =>
      a.id === preferred
        ? -1
        : b.id === preferred
          ? 1
          : a.priority - b.priority,
    );
    const failures = [];
    for (const p of providers) {
      const key = `${p.id}:${p.feed ?? ""}:${generation}:${i.id}:${interval}`;
      const cached = this.cache.get(key);
      if (
        cached &&
        Date.now() - cached.fetchedAt < (p.type === "twelve" ? 60000 : 15000)
      )
        return { ...cached, cached: true, failures };
      try {
        if (!this.pending.has(key))
          this.pending.set(
            key,
            this.request(
              p,
              (secret) => adapters[p.type].candles(i, interval, secret, p),
              i,
            )
              .then((rows) => {
                const sourceInterval = candleSource(p.type, interval);
                const candles = aggregateCandles(
                  rows,
                  interval,
                  sourceInterval,
                );
                if (generation !== this.generation)
                  throw new Error(
                    "Broninstellingen gewijzigd; probeer opnieuw",
                  );
                if (!candles.length)
                  throw new Error("Geen geldige candles ontvangen");
                const result = {
                  candles,
                  provider: p.name,
                  providerId: p.id,
                  venue:
                    adapters[p.type].venue?.(i, p) ??
                    (i.assetClass === "crypto" ? p.name : i.exchange),
                  interval,
                  sourceInterval,
                  aggregated: sourceInterval !== interval,
                  instrumentId: i.id,
                  currency: i.currency,
                  fetchedAt: Date.now(),
                  cached: false,
                };
                this.cache.set(key, result);
                if (this.cache.size > 100)
                  this.cache.delete(this.cache.keys().next().value);
                return result;
              })
              .finally(() => this.pending.delete(key)),
          );
        return { ...(await this.pending.get(key)), failures };
      } catch (e) {
        if (generation !== this.generation)
          throw new Error("Broninstellingen gewijzigd; probeer opnieuw");
        failures.push({ provider: p.name, error: e.message });
      }
    }
    const e = new Error(
      providers.length
        ? "Geen bron kan op dit moment historie leveren"
        : "Voeg een passende databron met API-sleutel toe",
    );
    e.details = failures;
    throw e;
  }
  later(fn, ms) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }
  releaseUnwatched(ids) {
    const referenced = new Set(
      this.store.watchlists().flatMap((w) => w.instruments),
    );
    for (const id of ids) {
      if (referenced.has(id)) continue;
      this.active.delete(id);
      this.quotes.delete(id);
      this.lastRoute.delete(id);
      for (const [key, issue] of this.instrumentIssues)
        if (issue.instrumentId === id) this.instrumentIssues.delete(key);
    }
    this.cache.clear();
    this.saveIssues();
    for (const socket of this.sockets.values())
      socket.sync?.(this.instruments());
  }
  invalidate(id) {
    for (const [key, issue] of this.instrumentIssues)
      if (issue.providerId === id) this.instrumentIssues.delete(key);
    this.saveIssues();
    for (const values of this.quotes.values()) values.delete(id);
    this.cache.clear();
    const state = this.state(id);
    Object.assign(state, {
      lastReceived: null,
      status: "wachten",
      error: null,
      failures: 0,
      openUntil: 0,
      lastPoll: 0,
    });
    this.store.put(`budget:${id}`, {
      requests: state.requests,
      failures: 0,
      openUntil: 0,
    });
  }
  connect(p, generation, attempt = 0) {
    if (!this.running || generation !== this.generation) return;
    if (p.type === "okx") {
      this.sockets.set(
        p.id,
        connectOKX({
          instruments: this.instruments(),
          isCurrent: () => this.running && generation === this.generation,
          schedule: (fn, ms) => this.later(fn, ms),
          reconnect: () => this.connect(p, generation),
          status: (update) => Object.assign(this.state(p.id), update),
          onQuote: (i, q) => this.ingest(p, i, q, "WebSocket"),
        }),
      );
      return;
    }
    if (p.type === "alpaca") {
      if (!p.secret) return;
      try {
        const connection = connectAlpaca({
          provider: p,
          secret: this.store.decrypt(p.secret),
          instruments: this.instruments(),
          isCurrent: () => this.running && generation === this.generation,
          schedule: (fn, ms) => this.later(fn, ms),
          reconnect: () => this.connect(p, generation),
          status: (update) => Object.assign(this.state(p.id), update),
          getQuote: (i) => this.quotes.get(i.id)?.get(p.id),
          onQuote: (i, q) => this.ingest(p, i, q, "WebSocket"),
          onInvalidate: (i) => {
            this.quotes.get(i.id)?.delete(p.id);
            this.state(p.id).lastPoll = 0;
          },
        });
        this.sockets.set(p.id, connection);
      } catch {
        this.state(p.id).error = "Controleer de Alpaca-sleutels";
      }
      return;
    }
    let instruments = this.instruments().filter((i) =>
      supportsInstrument(i, p),
    );
    let subscribed = new Set();
    const ws = new WebSocket(
      p.type === "kraken"
        ? "wss://ws.kraken.com/v2"
        : "wss://ws-feed.exchange.coinbase.com",
      { handshakeTimeout: 10000, maxPayload: 1024 * 1024 },
    );
    this.sockets.set(p.id, ws);
    let seen = Date.now();
    const send = (action, symbols) => {
      if (!symbols.length) return;
      ws.send(
        JSON.stringify(
          p.type === "kraken"
            ? {
                method: action,
                params: {
                  channel: "ticker",
                  symbol: symbols,
                  ...(action === "subscribe" ? { snapshot: true } : {}),
                },
              }
            : {
                type: action,
                product_ids: symbols,
                channels: ["ticker", "heartbeat"],
              },
        ),
      );
    };
    ws.sync = (desired) => {
      instruments = desired
        .filter((i) => supportsInstrument(i, p))
        .slice(0, 100);
      if (ws.readyState !== WebSocket.OPEN) return;
      const next = new Set(instruments.map((i) => i.mappings[p.type]));
      send(
        "unsubscribe",
        [...subscribed].filter((symbol) => !next.has(symbol)),
      );
      send(
        "subscribe",
        [...next].filter((symbol) => !subscribed.has(symbol)),
      );
      subscribed = next;
    };
    ws.on("open", () => {
      attempt = 0;
      this.state(p.id).status = "verbonden";
      ws.sync(this.instruments());
    });
    ws.on("message", (raw) => {
      seen = Date.now();
      if (generation !== this.generation) return;
      try {
        const d = JSON.parse(raw.toString());
        const records =
          p.type === "kraken" && d.channel === "ticker"
            ? d.data
            : p.type === "coinbase" && d.type === "ticker"
              ? [d]
              : [];
        for (const row of records ?? []) {
          const q = streamQuote(p.type, row);
          const i = instruments.find((i) => i.symbol === q.symbol);
          if (i) this.ingest(p, i, q, "WebSocket");
        }
      } catch {}
    });
    ws.on("error", () => {
      this.state(p.id).error =
        "WebSocket-verbinding onderbroken; REST-fallback actief";
    });
    const watchdog = setInterval(() => {
      if (Date.now() - seen > 35000) ws.terminate();
    }, 10000);
    ws.on("close", () => {
      clearInterval(watchdog);
      if (generation !== this.generation || !this.running) return;
      this.state(p.id).status = "herverbinden";
      this.later(
        () => this.connect(p, generation, attempt + 1),
        Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500,
      );
    });
  }
  restart() {
    this.stop();
    this.running = true;
    const generation = this.generation;
    for (const p of this.providers().filter(
      (p) =>
        p.enabled && ["kraken", "coinbase", "alpaca", "okx"].includes(p.type),
    ))
      this.connect(p, generation);
    for (const s of this.health.values()) s.lastPoll = 0;
    const cycle = async () => {
      for (const socket of this.sockets.values())
        socket.sync?.(this.instruments());
      await this.poll();
      if (this.running && generation === this.generation)
        this.later(cycle, 5000);
    };
    cycle();
  }
  stop() {
    this.running = false;
    this.generation++;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const ws of this.sockets.values()) ws.terminate();
    this.sockets.clear();
  }
}
