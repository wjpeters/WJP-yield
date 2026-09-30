import { z } from "zod";
import { XMLParser } from "fast-xml-parser";

const CG = "https://www.coingecko.com";
const SEC =
  "https://www.sec.gov/search-filings/edgar-application-programming-interfaces";
const FNG = "https://alternative.me/crypto/fear-and-greed-index/";
const GDELT = "https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/";
const coins = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  LINK: "chainlink",
  AVAX: "avalanche-2",
  LTC: "litecoin",
};
const num = (v) =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const text = (v, max = 160) => (typeof v === "string" ? v.slice(0, max) : "");
const date = (v) => {
  const t = Date.parse(v);
  return Number.isFinite(t) && t <= Date.now() + 30000 ? t : null;
};
export const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};
const unavailable = (source, url, note) => ({
  source,
  url,
  status: "unavailable",
  note,
  metrics: [],
  sourceAt: null,
});
const metric = (label, value, unit, extra = {}) => ({
  label,
  value: num(value),
  unit,
  ...extra,
});
const cryptoId = (i) =>
  i.assetClass === "crypto" ? coins[i.base ?? i.symbol.split("/")[0]] : null;

export function coinFundamentals(d, id) {
  if (d.id !== id || !d.market_data)
    throw new Error("CoinGecko leverde geen bevestigde instrumentdata");
  const m = d.market_data;
  return {
    source: "CoinGecko",
    url: `${CG}/en/coins/${id}`,
    status: "ok",
    sourceAt: date(d.last_updated),
    note: "Geaggregeerd over handelsplatformen, bedragen in USD. Tokenomics, geen bedrijfsresultaten.",
    identity: text(d.name),
    metrics: [
      metric("Marktkapitalisatie", m.market_cap?.usd, "USD"),
      metric(
        "Volledig verwaterde waarde",
        m.fully_diluted_valuation?.usd,
        "USD",
      ),
      metric(
        "Circulerende voorraad",
        m.circulating_supply,
        text(d.symbol).toUpperCase(),
      ),
      metric("Totale voorraad", m.total_supply, text(d.symbol).toUpperCase()),
      metric("Maximale voorraad", m.max_supply, text(d.symbol).toUpperCase()),
      metric("Volume 24u · alle venues", m.total_volume?.usd, "USD"),
      metric("Marktrang", d.market_cap_rank, "rank"),
      metric("All-time high", m.ath?.usd, "USD", {
        period: text(m.ath_date?.usd, 10),
      }),
      metric("Afstand tot ATH", m.ath_change_percentage?.usd, "%"),
    ],
  };
}

export function secFundamentals(d, cik) {
  if (Number(d.cik) !== Number(cik) || !d.facts?.["us-gaap"])
    throw new Error("Geen passende US-GAAP-bedrijfsdata ontvangen");
  const facts = d.facts["us-gaap"];
  const specs = [
    [
      "Omzet · jaar",
      [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
      ],
      "USD",
      true,
    ],
    ["Nettowinst · jaar", ["NetIncomeLoss", "ProfitLoss"], "USD", true],
    [
      "Operationele cashflow · jaar",
      ["NetCashProvidedByUsedInOperatingActivities"],
      "USD",
      true,
    ],
    ["EPS verwaterd · jaar", ["EarningsPerShareDiluted"], "USD/shares", true],
    ["Activa", ["Assets"], "USD", false],
    ["Verplichtingen", ["Liabilities"], "USD", false],
    [
      "Liquide middelen",
      ["CashAndCashEquivalentsAtCarryingValue"],
      "USD",
      false,
    ],
    [
      "Eigen vermogen",
      [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
      ],
      "USD",
      false,
    ],
  ];
  const metrics = specs.map(([label, tags, unit, annual]) => {
    const rows = tags
      .flatMap((tag) => facts[tag]?.units?.[unit] ?? [])
      .filter((r) => {
        if (
          !["10-K", "10-K/A"].includes(r.form) ||
          num(r.val) == null ||
          !date(r.end) ||
          !date(r.filed)
        )
          return false;
        const days = (Date.parse(r.end) - Date.parse(r.start)) / 86400000;
        return annual ? days >= 330 && days <= 380 : !r.start;
      })
      .sort(
        (a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed),
      );
    const row = rows[0];
    return metric(
      label,
      row?.val,
      unit === "USD/shares" ? "USD / aandeel" : unit,
      {
        period: row ? `${row.start ? row.start + " → " : ""}${row.end}` : null,
        filed: row?.filed ?? null,
      },
    );
  });
  return {
    source: "SEC EDGAR",
    url: `https://www.sec.gov/edgar/browse/?CIK=${Number(cik)}&owner=exclude`,
    status: metrics.some((m) => m.value != null) ? "ok" : "unavailable",
    sourceAt: null,
    identity: text(d.entityName),
    note: "Gerapporteerde jaarcijfers uit 10-K (US GAAP). Elke waarde heeft een eigen verslagperiode; geen TTM of live waardering.",
    metrics,
  };
}

export function sentimentData(d) {
  if (d.metadata?.error || !Array.isArray(d.data))
    throw new Error("Ongeldige sentimentdata ontvangen");
  const points = d.data.slice(0, 7).flatMap((r) => {
    const value = num(r.value),
      at = num(r.timestamp);
    return value != null &&
      value >= 0 &&
      value <= 100 &&
      at != null &&
      at > 0 &&
      at * 1000 <= Date.now() + 30000
      ? [{ value, at: at * 1000, label: text(r.value_classification, 40) }]
      : [];
  });
  if (!points.length) throw new Error("Geen actuele sentimentmeting ontvangen");
  return {
    source: "Alternative.me",
    url: FNG,
    status: "ok",
    sourceAt: points[0].at,
    points,
    note: "Deze index meet Bitcoin-sentiment. Bij andere cryptomunten dient hij als marktcontext.",
  };
}

export function newsQuery(i) {
  const names = {
    "EUR/USD": "euro dollar",
    "GBP/USD": "pound dollar",
    "USD/JPY": "yen dollar",
    "XAU/USD": "gold",
    "XAG/USD": "silver",
  };
  const name = (names[i.symbol] ?? i.name)
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .trim()
    .slice(0, 80);
  if (name.length < 3) return null;
  return `"${name}" ${i.assetClass === "crypto" ? "(crypto OR cryptocurrency OR blockchain)" : "(market OR finance OR stock OR shares OR earnings)"}`;
}
export function newsData(d, query) {
  if (!Array.isArray(d.articles))
    throw new Error("Nieuwsbron leverde geen geldige artikellijst");
  const seen = new Set();
  const articles = d.articles
    .flatMap((r) => {
      const url = safeUrl(r.url),
        title = text(r.title, 240);
      if (!url || !title || seen.has(url)) return [];
      seen.add(url);
      const stamp = /^\d{8}T\d{6}Z$/.test(r.seendate ?? "")
        ? r.seendate.replace(
            /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
            "$1-$2-$3T$4:$5:$6Z",
          )
        : null;
      return [
        {
          url,
          title,
          domain: new URL(url).hostname,
          at: stamp ? date(stamp) : null,
          language: text(r.language, 40),
        },
      ];
    })
    .slice(0, 8);
  return {
    source: "GDELT",
    url: GDELT,
    status: "ok",
    sourceAt: null,
    articles,
    query,
    note: "Naamzoekopdracht in de laatste 7 dagen. Relevantie niet bevestigd. Tijd = eerste registratie door GDELT, niet de publicatietijd.",
  };
}

export function rssNewsData(xml, query, now = Date.now()) {
  if (
    typeof xml !== "string" ||
    xml.length > 2000000 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml)
  )
    throw new Error("Nieuwsfeed bevat geen ondersteunde RSS-data");
  const parsed = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: true,
  }).parse(xml);
  const channel = parsed.rss?.channel;
  if (!channel || typeof channel !== "object")
    throw new Error("Nieuwsbron leverde geen geldige RSS-feed");
  const rows =
    channel.item == null
      ? []
      : Array.isArray(channel.item)
        ? channel.item
        : [channel.item];
  const seen = new Set();
  const articles = rows
    .flatMap((row) => {
      const url = safeUrl(row.link),
        title = text(row.title, 240),
        at = date(row.pubDate);
      if (
        !url ||
        !title ||
        seen.has(url) ||
        (at != null && now - at > 7 * 86400000)
      )
        return [];
      seen.add(url);
      const publisher =
        typeof row.source === "string" ? row.source : row.source?.["#text"];
      return [
        {
          url,
          title,
          domain: text(publisher, 80) || new URL(url).hostname,
          at,
          language: "Engels",
          timeKind: "publication",
        },
      ];
    })
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, 8);
  return {
    source: "Google Nieuws · RSS",
    url: `https://news.google.com/search?q=${encodeURIComponent(query)}`,
    status: "ok",
    sourceAt: null,
    articles,
    query,
    note: "Openbare RSS-terugval op instrumentnaam, laatste 7 dagen. Relevantie niet bevestigd. Tijd = publicatietijd volgens de feed. Links openen via Google Nieuws. Geen gegarandeerde API-dienst.",
  };
}

export class Research {
  constructor({ fetcher = fetch, clock = Date.now } = {}) {
    this.fetcher = fetcher;
    this.clock = clock;
    this.cache = new Map();
    this.pending = new Map();
    this.budgets = new Map();
  }
  async json(url, format = "json") {
    const host = new URL(url).hostname,
      now = this.clock();
    const budget = (this.budgets.get(host) ?? []).filter(
      (t) => now - t < 60000,
    );
    const limit = host === "api.gdeltproject.org" ? 6 : 12;
    if (
      budget.length >= limit ||
      (host === "api.gdeltproject.org" &&
        budget.length &&
        now - budget.at(-1) < 6000)
    )
      throw new Error(
        "Openbare bron is tijdelijk begrensd; probeer straks opnieuw",
      );
    budget.push(now);
    this.budgets.set(host, budget);
    let r;
    try {
      r = await this.fetcher(url, {
        signal: AbortSignal.timeout(12000),
        redirect: "error",
        headers: {
          "User-Agent": "WJP-yield/0.1 local market research",
          Accept: "application/json",
        },
      });
    } catch {
      throw new Error("Openbare bron reageert niet; probeer later opnieuw");
    }
    if (!r.ok)
      throw new Error(
        r.status === 429
          ? "Bronlimiet bereikt; probeer later opnieuw"
          : [401, 403].includes(r.status)
            ? "Bron geeft geen toegang tot deze data"
            : `Bron niet beschikbaar (HTTP ${r.status})`,
      );
    try {
      return format === "text" ? await r.text() : await r.json();
    } catch {
      throw new Error("Bron leverde geen geldige JSON-data");
    }
  }
  async cached(key, ttl, source, url, job) {
    const now = this.clock(),
      old = this.cache.get(key);
    if (old && now < old.retryAt) return { ...old.result, cached: true };
    if (this.pending.has(key)) return this.pending.get(key);
    // Bound pending work and cached records, including during rapid instrument changes.
    if (this.pending.size >= 16)
      return unavailable(
        source,
        url,
        "Te veel lopende onderzoeken; probeer straks opnieuw",
      );
    const task = (async () => {
      let result, retryAt;
      try {
        result = { ...(await job()), fetchedAt: this.clock(), stale: false };
        retryAt = this.clock() + ttl;
      } catch (e) {
        result =
          old?.result.status === "ok"
            ? { ...old.result, stale: true, error: e.message }
            : {
                ...unavailable(source, url, e.message),
                fetchedAt: null,
                stale: false,
              };
        retryAt = this.clock() + 60000;
      }
      this.cache.set(key, { result, retryAt });
      if (this.cache.size > 100)
        this.cache.delete(this.cache.keys().next().value);
      return { ...result, cached: false };
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
  async section(i, section) {
    const id = cryptoId(i);
    if (section === "sentiment") {
      if (i.assetClass !== "crypto")
        return unavailable(
          "Alternative.me",
          FNG,
          "Deze index meet Bitcoin-sentiment. Voor deze markt is nog geen passende sentimentfeed aangesloten.",
        );
      return this.cached("fng", 3600000, "Alternative.me", FNG, async () =>
        sentimentData(
          await this.json("https://api.alternative.me/fng/?limit=7"),
        ),
      );
    }
    if (section === "news") {
      const query = newsQuery(i);
      if (!query)
        return unavailable(
          "GDELT",
          GDELT,
          "Geen betrouwbare naamzoekopdracht beschikbaar",
        );
      const params = new URLSearchParams({
        query,
        mode: "artlist",
        format: "json",
        timespan: "7d",
        maxrecords: "20",
        sort: "datedesc",
      });
      return this.cached(`news:${query}`, 900000, "GDELT", GDELT, async () => {
        try {
          return newsData(
            await this.json(
              `https://api.gdeltproject.org/api/v2/doc/doc?${params}`,
            ),
            query,
          );
        } catch (gdeltError) {
          const name = query.match(/^"([^"]+)"/)?.[1];
          if (!name) throw gdeltError;
          const rssQuery = `"${name}" ${i.assetClass === "crypto" ? "crypto" : "finance"} when:7d`;
          const params = new URLSearchParams({
            q: rssQuery,
            hl: "en-US",
            gl: "US",
            ceid: "US:en",
          });
          try {
            const result = rssNewsData(
              await this.json(
                `https://news.google.com/rss/search?${params}`,
                "text",
              ),
              rssQuery,
              this.clock(),
            );
            return {
              ...result,
              fallback: `GDELT niet beschikbaar: ${gdeltError.message}. RSS-terugval gebruikt.`,
            };
          } catch (rssError) {
            throw new Error(
              `GDELT: ${gdeltError.message}. RSS-terugval: ${rssError.message}`,
            );
          }
        }
      });
    }

    if (section === "market") {
      if (i.assetClass !== "crypto")
        return unavailable(
          "Bestaande koersbronnen",
          "https://twelvedata.com/docs",
          "Marktcontext hieronder gebruikt je ontvangen koersen. Macro- en beursbrede statistieken zijn nog niet aangesloten.",
        );
      return this.cached(
        "global",
        900000,
        "CoinGecko",
        `${CG}/en/global-charts`,
        async () => {
          const { data: d } = await this.json(
            "https://api.coingecko.com/api/v3/global",
          );
          if (!d || num(d.total_market_cap?.usd) == null)
            throw new Error("Geen geldige globale marktdata ontvangen");
          return {
            source: "CoinGecko",
            url: `${CG}/en/global-charts`,
            status: "ok",
            sourceAt:
              num(d.updated_at) == null
                ? null
                : date(new Date(d.updated_at * 1000).toISOString()),
            note: "Wereldwijde cryptomarkt, geaggregeerd over venues. Bedragen in USD.",
            metrics: [
              metric(
                "Totale marktkapitalisatie",
                d.total_market_cap.usd,
                "USD",
              ),
              metric(
                "Marktverandering 24u",
                d.market_cap_change_percentage_24h_usd,
                "%",
              ),
              metric("Totaal volume 24u", d.total_volume?.usd, "USD"),
              metric("Bitcoin-dominantie", d.market_cap_percentage?.btc, "%"),
              metric("Ethereum-dominantie", d.market_cap_percentage?.eth, "%"),
              metric(
                "Actieve cryptomunten",
                d.active_cryptocurrencies,
                "count",
              ),
            ],
          };
        },
      );
    }
    if (i.assetClass === "crypto") {
      if (!id)
        return unavailable(
          "CoinGecko",
          CG,
          "Nog geen bevestigde CoinGecko-ID voor deze munt. Geen automatische koppeling op alleen tickersymbool.",
        );
      return this.cached(
        `coin:${id}`,
        900000,
        "CoinGecko",
        `${CG}/en/coins/${id}`,
        async () =>
          coinFundamentals(
            await this.json(
              `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`,
            ),
            id,
          ),
      );
    }
    if (
      i.assetClass === "stock" &&
      i.currency === "USD" &&
      /^(NASDAQ|NYSE|AMEX|NYSEAMERICAN)$/i.test(i.exchange)
    ) {
      return this.cached(
        `sec:${i.exchange}:${i.symbol}`,
        21600000,
        "SEC EDGAR",
        SEC,
        async () => {
          const list = await this.cached(
            "sec-list",
            86400000,
            "SEC EDGAR",
            SEC,
            async () => ({
              status: "ok",
              data: await this.json(
                "https://www.sec.gov/files/company_tickers_exchange.json",
              ),
            }),
          );
          if (list.status !== "ok" || list.stale)
            throw new Error("SEC-instrumentregister niet beschikbaar");
          const { fields, data } = list.data;
          if (
            !Array.isArray(fields) ||
            !Array.isArray(data) ||
            !["ticker", "exchange", "cik"].every((f) => fields.includes(f))
          )
            throw new Error("SEC-instrumentregister ongeldig");
          const normalize = (exchange) =>
            String(exchange).toUpperCase().replace("NYSEAMERICAN", "AMEX");
          const matches = data.filter(
            (r) =>
              r[fields.indexOf("ticker")] === i.symbol &&
              normalize(r[fields.indexOf("exchange")]) ===
                normalize(i.exchange),
          );
          if (matches.length !== 1)
            throw new Error(
              "Geen unieke SEC-koppeling voor dit symbool en deze beurs (geen US-GAAP-data voor sommige buitenlandse emittenten)",
            );
          const cik = String(matches[0][fields.indexOf("cik")]).padStart(
            10,
            "0",
          );
          return secFundamentals(
            await this.json(
              `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
            ),
            cik,
          );
        },
      );
    }
    return unavailable(
      "Fundamentals",
      i.assetClass === "etf"
        ? "https://www.sec.gov/edgar/search/"
        : "https://data.ecb.europa.eu/",
      i.assetClass === "etf"
        ? "ETF-fundamentals vragen fondsdata zoals TER, holdings en tracking difference. Nog geen issuerfeed aangesloten."
        : "Voor deze instrumentklasse zijn nog geen passende fundamentals aangesloten.",
    );
  }
}

export function registerResearchRoutes(
  app,
  store,
  engine,
  research = new Research(),
) {
  app.get("/api/research", async (req, reply) => {
    const { instrument, section } = z
      .object({
        instrument: z.string().min(1).max(160),
        section: z.enum(["fundamentals", "sentiment", "news", "market"]),
      })
      .parse(req.query);
    const i = store.instruments().find((row) => row.id === instrument);
    if (!i) return reply.code(404).send({ error: "Instrument niet gevonden" });
    engine.touch(i.id);
    return {
      instrumentId: i.id,
      section,
      ...(await research.section(i, section)),
    };
  });
}
