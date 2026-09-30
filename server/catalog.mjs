import { z } from "zod";
import { catalog as starterCatalog } from "./domain.mjs";
import { supportsInstrument } from "./adapters.mjs";
import { alpacaCredentials } from "./alpaca.mjs";
import { OKX_REST } from "./okx.mjs";

const TTL = 24 * 60 * 60 * 1000;
const RETRY = 60 * 1000;
const token = (v) =>
  typeof v === "string" && /^[A-Za-z0-9._:/ -]{1,64}$/.test(v) ? v : null;
const coin = (v) => ({ XBT: "BTC", XDG: "DOGE" })[v] ?? v;
const cleanName = (v, fallback) =>
  typeof v === "string" && !/[<>\x00-\x1f]/.test(v)
    ? v.slice(0, 160)
    : fallback;
export function instrumentId(i) {
  if (i.assetClass === "crypto") return `crypto:${i.base}:${i.currency}`;
  if (["forex", "commodity"].includes(i.assetClass))
    return `${i.assetClass}:${i.symbol}`;
  return `stock:${i.exchange}:${i.symbol}:${i.currency}`;
}
function instrument(
  symbol,
  name,
  assetClass,
  exchange,
  currency,
  mappings,
  base,
) {
  if (
    ![symbol, exchange, currency].every(token) ||
    !/^[A-Z0-9.]{2,16}$/.test(currency)
  )
    return null;
  const i = {
    symbol,
    name: cleanName(name, symbol),
    assetClass,
    exchange,
    currency,
    mappings,
    ...(base ? { base } : {}),
  };
  return { ...i, id: instrumentId(i) };
}
function crypto(base, quote, name, type, mapping, extra = {}) {
  if (!token(base) || !token(quote) || !token(mapping)) return null;
  base = type === "kraken" ? coin(base.toUpperCase()) : base.toUpperCase();
  quote = type === "kraken" ? coin(quote.toUpperCase()) : quote.toUpperCase();
  return instrument(
    `${base}/${quote}`,
    name,
    "crypto",
    "MULTI",
    quote,
    { [type]: mapping, ...extra },
    base,
  );
}
export function normalizeDirectory(type, data, segment = "") {
  let rows;
  if (type === "coinbase" || type === "alpaca") rows = data;
  else if (type === "kraken") {
    if (data.error?.length || !data.result || typeof data.result !== "object")
      throw new Error("Ongeldige Kraken-catalogus");
    rows = Object.values(data.result);
  } else {
    if (
      (type === "okx" && String(data.code) !== "0") ||
      data.status === "error"
    )
      throw new Error("Catalogus niet beschikbaar");
    rows = data.data;
  }
  if (!Array.isArray(rows) || rows.length > 350000)
    throw new Error("Ongeldige of te grote instrumentcatalogus");
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    let i;
    if (type === "coinbase") {
      if (
        r.status !== "online" ||
        r.trading_disabled ||
        !token(r.id) ||
        r.id !== `${r.base_currency}-${r.quote_currency}`
      )
        continue;
      i = crypto(r.base_currency, r.quote_currency, r.display_name, type, r.id);
    } else if (type === "kraken") {
      if (r.status !== "online" || typeof r.wsname !== "string") continue;
      const [base, quote, extra] = r.wsname.split("/");
      if (extra || !token(base) || !token(quote) || !token(r.altname)) continue;
      i = crypto(base, quote, r.wsname, type, `${coin(base)}/${coin(quote)}`, {
        krakenRest: r.altname,
      });
    } else if (type === "okx") {
      if (
        r.instType !== "SPOT" ||
        r.state !== "live" ||
        r.instId !== `${r.baseCcy}-${r.quoteCcy}`
      )
        continue;
      i = crypto(r.baseCcy, r.quoteCcy, r.instId, type, r.instId);
    } else if (type === "alpaca") {
      if (r.status !== "active") continue;
      if (r.class === "crypto" && typeof r.symbol === "string") {
        const [base, quote, extra] = r.symbol.split("/");
        if (extra || quote !== "USD") continue; // Current Alpaca data adapter uses USD spot only.
        i = crypto(base, quote, r.name, type, r.symbol);
      } else if (r.class === "us_equity") {
        const exchange = r.exchange === "ARCA" ? "NYSE" : r.exchange;
        if (!["NASDAQ", "NYSE", "NYSEARCA", "AMEX", "BATS"].includes(exchange))
          continue;
        i = instrument(
          r.symbol,
          r.name,
          /\bETF\b|exchange.traded fund/i.test(r.name ?? "") ? "etf" : "stock",
          exchange,
          "USD",
          { alpaca: r.symbol },
        );
      }
    } else if (type === "twelve") {
      if (!token(r.symbol)) continue;
      if (segment === "forex_pairs" || segment === "commodities") {
        const quote = r.symbol.includes("/")
          ? r.symbol.split("/")[1]
          : r.currency;
        // Never invent a quote currency for provider rows that do not specify one.
        i = instrument(
          r.symbol,
          r.name ??
            `${r.currency_base ?? r.symbol} / ${r.currency_quote ?? ""}`,
          segment === "forex_pairs" ? "forex" : "commodity",
          "OTC",
          quote,
          { twelve: r.symbol },
        );
      } else {
        i = instrument(
          r.symbol,
          r.name,
          segment === "etfs" || r.type === "ETF" ? "etf" : "stock",
          r.exchange,
          r.currency,
          { twelve: r.symbol },
        );
      }
    }
    if (i) out.push(i);
  }
  if (rows.length && !out.length)
    throw new Error("Geen ondersteunde instrumenten in de catalogus");
  return out;
}

export class Catalog {
  constructor(
    store,
    { fetcher = fetch, reserve = () => {}, now = Date.now } = {},
  ) {
    this.store = store;
    this.fetcher = fetcher;
    this.reserve = reserve;
    this.now = now;
    this.entries = new Map();
    this.pending = new Map();
    this.attempts = new Map();
    this.errors = new Map();
    this.indexRows = null;
    this.signature = "";
    for (const p of store.providers()) {
      const entry = store.get(`catalog:${p.id}`, null);
      if (entry && entry.type === p.type && entry.feed === (p.feed ?? ""))
        this.entries.set(p.id, {
          ...entry,
          rows: entry.rows ?? Object.values(entry.segments ?? {}).flat(),
        });
    }
  }
  async json(p, url, headers = {}) {
    this.reserve(p);
    let r;
    try {
      r = await this.fetcher(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(60000),
        headers: { "User-Agent": "WJP-yield/0.1", ...headers },
      });
    } catch {
      throw new Error("Catalogus tijdelijk niet bereikbaar");
    }
    if (!r.ok) {
      const e = new Error(
        r.status === 401
          ? "Catalogustoegang vereist geldige sleutels"
          : r.status === 403
            ? "Geen toegang tot de catalogus"
            : r.status === 429
              ? "Aanvraaglimiet voor catalogus bereikt"
              : `Catalogus antwoordt met HTTP ${r.status}`,
      );
      e.status = r.status;
      throw e;
    }
    let data;
    try {
      data = await r.json();
    } catch {
      throw new Error("Ongeldig catalogusantwoord");
    }
    // Provider error bodies are never forwarded: they may echo credentials.
    if (
      data?.status === "error" ||
      (p.type === "okx" && String(data?.code) !== "0")
    )
      throw new Error(
        "Catalogus niet beschikbaar; controleer bronrechten of aanvraagbudget",
      );
    return data;
  }
  async load(p) {
    if (p.type === "coinbase")
      return {
        rows: normalizeDirectory(
          p.type,
          await this.json(p, "https://api.exchange.coinbase.com/products"),
        ),
        warnings: [],
      };
    if (p.type === "kraken")
      return {
        rows: normalizeDirectory(
          p.type,
          await this.json(p, "https://api.kraken.com/0/public/AssetPairs"),
        ),
        warnings: [],
      };
    if (p.type === "okx")
      return {
        rows: normalizeDirectory(
          p.type,
          await this.json(
            p,
            `${OKX_REST}/api/v5/public/instruments?instType=SPOT`,
          ),
        ),
        warnings: [],
      };
    if (p.type === "alpaca") {
      if (!p.secret)
        throw new Error(
          "Voeg beide Alpaca-sleutels toe om de catalogus op te halen",
        );
      const credentials = alpacaCredentials(this.store.decrypt(p.secret));
      const headers = {
        "APCA-API-KEY-ID": credentials.key,
        "APCA-API-SECRET-KEY": credentials.secret,
      };
      const params = new URLSearchParams({
        status: "active",
        asset_class: p.feed === "crypto_us" ? "crypto" : "us_equity",
      });
      let data;
      try {
        data = await this.json(
          p,
          `https://api.alpaca.markets/v2/assets?${params}`,
          headers,
        );
      } catch (e) {
        if (e.status !== 401) throw e;
        data = await this.json(
          p,
          `https://paper-api.alpaca.markets/v2/assets?${params}`,
          headers,
        );
      }
      return { rows: normalizeDirectory(p.type, data), warnings: [] };
    }
    if (p.type === "twelve") {
      const rows = [],
        warnings = [],
        segments = {};
      const previous = this.entries.get(p.id)?.segments ?? {};
      // Public reference data requires no secret and is shared with the REST request budget.
      for (const path of ["stocks", "etfs", "forex_pairs", "commodities"]) {
        try {
          const data = await this.json(p, `https://api.twelvedata.com/${path}`);
          const normalized = normalizeDirectory(p.type, data, path);
          if (Number.isFinite(data.count) && data.count > data.data.length)
            throw new Error("De provider gaf een onvolledige lijst terug");
          segments[path] = normalized;
          for (const row of normalized) rows.push(row);
        } catch (e) {
          warnings.push(`${path}: ${e.message}`);
          if (previous[path]) {
            segments[path] = previous[path];
            for (const row of previous[path]) rows.push(row);
          }
        }
      }
      if (!rows.length)
        throw new Error(
          "Twelve Data-catalogus niet beschikbaar; probeer opnieuw na herstel van de verbinding of het aanvraagbudget",
        );
      return { rows, segments, warnings };
    }
    throw new Error("Deze bron ondersteunt geen instrumentcatalogus");
  }
  refreshOne(p, force) {
    const entry = this.entries.get(p.id);
    const compatible = entry?.type === p.type && entry.feed === (p.feed ?? "");
    if (
      compatible &&
      !force &&
      !entry.warnings?.length &&
      this.now() - entry.fetchedAt < TTL
    )
      return Promise.resolve();
    if (this.pending.has(p.id)) return this.pending.get(p.id);
    if (this.now() - (this.attempts.get(p.id) ?? -Infinity) < RETRY)
      return Promise.resolve();
    this.attempts.set(p.id, this.now());
    const signature = JSON.stringify([p.type, p.feed, p.secret]);
    const promise = this.load(p)
      .then((result) => {
        const current = this.store.providers().find((x) => x.id === p.id);
        if (
          !current ||
          JSON.stringify([current.type, current.feed, current.secret]) !==
            signature
        )
          return;
        const next = {
          ...result,
          type: p.type,
          feed: p.feed ?? "",
          fetchedAt: this.now(),
        };
        this.entries.set(p.id, next);
        this.store.put(`catalog:${p.id}`, {
          ...next,
          ...(next.segments ? { rows: undefined } : {}),
        });
        this.errors.delete(p.id);
        this.indexRows = null;
      })
      .catch((e) => {
        this.errors.set(p.id, e.message);
      })
      .finally(() => {
        this.pending.delete(p.id);
      });
    this.pending.set(p.id, promise);
    return promise;
  }
  refresh(force = false) {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      // Large reference lists are loaded sequentially to keep memory bounded.
      for (const p of [...this.store.providers()].sort(
        (a, b) => a.priority - b.priority,
      ))
        await this.refreshOne(p, force);
      this.reconcile();
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
  index() {
    const providers = [...this.store.providers()].sort(
      (a, b) => a.priority - b.priority,
    );
    const signature = JSON.stringify(
      providers.map((p) => [p.id, p.type, p.name, p.feed]),
    );
    if (this.indexRows && signature === this.signature) return this.indexRows;
    this.indexRows = null;
    this.byId = null;
    const merged = new Map();
    const seeds = new Map(starterCatalog.map((i) => [instrumentId(i), i]));
    const add = (i, p, verified) => {
      const canonical = instrumentId(i),
        seed = seeds.get(canonical);
      const id = seed?.id ?? i.id;
      const old = merged.get(id);
      const row = old ?? {
        ...i,
        id,
        name: seed?.name ?? i.name,
        mappings: {},
        catalogSources: {},
        providerIds: [],
        verified: true,
      };
      row.mappings = { ...row.mappings, ...i.mappings };
      row.catalogSources[p.id] = {
        type: p.type,
        feed: p.feed ?? "",
        symbol: i.mappings[p.type],
      };
      if (!row.providerIds.includes(p.id)) row.providerIds.push(p.id);
      row.verified &&= verified;
      merged.set(id, row);
    };
    for (const p of providers) {
      const entry = this.entries.get(p.id);
      if (entry?.type === p.type && entry.feed === (p.feed ?? "")) {
        for (const i of entry.rows)
          if (supportsInstrument(i, p)) add(i, p, true);
      } else {
        for (const i of this.store.instruments())
          if (supportsInstrument(i, p)) add(i, p, false);
      }
    }
    // Manually entered symbols stay searchable even when absent from a reference list.
    for (const i of this.store.get("instruments", [])) {
      if (merged.has(i.id)) continue;
      for (const p of providers) if (supportsInstrument(i, p)) add(i, p, false);
    }
    const names = new Map(
      providers.map((p) => [
        p.id,
        `${p.name} ${p.type === "twelve" ? "Twelve Data" : p.type}`,
      ]),
    );
    this.indexRows = [...merged.values()].map((i) => {
      i.searchText =
        `${i.symbol} ${i.name} ${i.exchange} ${i.currency} ${i.assetClass} ${i.providerIds.map((id) => names.get(id)).join(" ")}`.toLowerCase();
      return i;
    });
    const seedsForOrder = new Set(starterCatalog.map((i) => i.id));
    this.indexRows.sort(
      (a, b) =>
        Number(seedsForOrder.has(b.id)) - Number(seedsForOrder.has(a.id)) ||
        a.symbol.localeCompare(b.symbol) ||
        a.exchange.localeCompare(b.exchange),
    );
    this.byId = new Map(this.indexRows.map((i) => [i.id, i]));
    this.signature = signature;
    return this.indexRows;
  }
  materialize(row) {
    const { searchText, providerIds, verified, ...i } = row;
    return i;
  }
  reconcile() {
    this.index();
    const persisted = new Map(
      this.store.get("discovered-instruments", []).map((i) => [i.id, i]),
    );
    const ids = new Set([
      ...persisted.keys(),
      ...this.store.watchlists().flatMap((w) => w.instruments),
    ]);
    for (const id of ids) {
      const row = this.byId.get(id);
      if (row) persisted.set(id, this.materialize(row));
      else if (persisted.has(id)) {
        const old = persisted.get(id);
        persisted.set(id, { ...old, mappings: {}, catalogSources: {} });
      }
    }
    this.store.put("discovered-instruments", [...persisted.values()]);
  }
  register(id) {
    this.index();
    const row = this.byId.get(id);
    if (!row) {
      const e = new Error(
        "Instrument niet gevonden in de catalogus; zoek opnieuw",
      );
      e.statusCode = 404;
      throw e;
    }
    const items = new Map(
      this.store.get("discovered-instruments", []).map((i) => [i.id, i]),
    );
    if (!items.has(id) && items.size >= 2000) {
      const e = new Error("Maximaal 2000 opgeslagen catalogusinstrumenten");
      e.statusCode = 400;
      throw e;
    }
    const i = this.materialize(row);
    items.set(id, i);
    this.store.put("discovered-instruments", [...items.values()]);
    return i;
  }
  search({
    q = "",
    provider = "",
    assetClass = "",
    offset = 0,
    limit = 50,
  } = {}) {
    const providers = this.store.providers();
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let rows = this.index().filter(
      (i) =>
        (!provider || i.providerIds.includes(provider)) &&
        (!assetClass || i.assetClass === assetClass) &&
        words.every(
          (w) =>
            i.searchText.includes(w) ||
            (i.assetClass === "crypto" &&
              i.symbol.toLowerCase().includes(w.replace(/-/g, "/"))),
        ),
    );
    const exact = q.trim().toLowerCase();
    const isExact = (i) =>
      i.symbol.toLowerCase() ===
      (i.assetClass === "crypto" ? exact.replace(/-/g, "/") : exact);
    if (exact)
      rows = [...rows.filter(isExact), ...rows.filter((i) => !isExact(i))];
    return {
      items: rows
        .slice(offset, offset + limit)
        .map(({ searchText, ...i }) => i),
      total: rows.length,
      offset,
      limit,
      sources: [...providers]
        .sort((a, b) => a.priority - b.priority)
        .map((p) => {
          const entry = this.entries.get(p.id);
          const compatible =
            entry?.type === p.type && entry.feed === (p.feed ?? "");
          return {
            id: p.id,
            name: p.name,
            count: compatible ? entry.rows.length : 0,
            fetchedAt: compatible ? entry.fetchedAt : null,
            stale:
              !compatible ||
              this.now() - entry.fetchedAt >= TTL ||
              this.errors.has(p.id),
            loading:
              this.pending.has(p.id) ||
              (!!this.refreshing && !compatible && !this.attempts.has(p.id)),
            error: this.errors.get(p.id) ?? null,
            warnings: compatible ? (entry.warnings ?? []) : [],
          };
        }),
    };
  }
}
export function registerCatalogRoutes(app, catalog) {
  const query = z.object({
    q: z.string().max(100).default(""),
    provider: z.string().max(80).default(""),
    assetClass: z
      .enum(["", "crypto", "stock", "etf", "forex", "commodity"])
      .default(""),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  });
  app.get("/api/catalog", async (req) => {
    const params = query.parse(req.query);
    // Return available results immediately while missing/expired sources refresh.
    void catalog.refresh().catch(() => {});
    return catalog.search(params);
  });
  app.post("/api/catalog/refresh", async () => {
    void catalog.refresh(true).catch(() => {});
    return { ok: true };
  });
  app.post("/api/catalog/instruments", async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(200) }).parse(req.body);
    return catalog.register(id);
  });
}
