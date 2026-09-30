import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  ChartNoAxesCombined,
  Globe2,
  Info,
  Newspaper,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { api, percent, price, stamp } from "./api";
import type { History, Instrument, Quote, State } from "./types";
import { classNames } from "./types";
import { Dot, SymbolMark } from "./ui";
import { ratings, technicals } from "./technicals";

type Metric = {
  label: string;
  value: number | null;
  unit: string;
  period?: string | null;
  filed?: string | null;
};
type Research = {
  status: string;
  source: string;
  url: string;
  note: string;
  sourceAt: number | null;
  fetchedAt?: number | null;
  stale?: boolean;
  error?: string;
  fallback?: string;
  metrics?: Metric[];
  identity?: string;
  articles?: {
    url: string;
    title: string;
    domain: string;
    at: number | null;
    language: string;
    timeKind?: string;
  }[];
  points?: { value: number; at: number; label: string }[];
  query?: string;
};
const sections = ["fundamentals", "sentiment", "news", "market"] as const;
type Section = (typeof sections)[number];
const compact = (v: number | null | undefined) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(v);
const external = { target: "_blank", rel: "noopener noreferrer" } as const;
const smallDate = (v: string) =>
  new Date(v + "T00:00:00Z").toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

function Source({ data, loading }: { data?: Research; loading: boolean }) {
  if (loading && !data)
    return (
      <div className="research-source" role="status">
        <RefreshCw size={12} className="spin" /> Bron ophalen…
      </div>
    );
  if (!data) return null;
  const outdated =
    data.stale ||
    (data.sourceAt != null && Date.now() - data.sourceAt > 48 * 3600000);
  return (
    <div className="research-source">
      <a href={data.url} {...external}>
        {data.source} <ArrowUpRight size={12} />
      </a>
      <span>
        {outdated ? "Verouderd · " : ""}
        {data.sourceAt
          ? `Bron ${stamp(data.sourceAt)}`
          : data.fetchedAt
            ? `Opgehaald ${stamp(data.fetchedAt)}`
            : "Geen data ontvangen"}
        {loading ? " · vernieuwen…" : ""}
      </span>
    </div>
  );
}
function Note({ data, loading }: { data?: Research; loading: boolean }) {
  return (
    <>
      {data && (
        <p
          className={`research-note ${data.status !== "ok" || data.stale ? "warning" : ""}`}
        >
          {data.error ?? data.note}
        </p>
      )}
      {data?.fallback && (
        <p className="research-note warning">{data.fallback}</p>
      )}
      <Source data={data} loading={loading} />
    </>
  );
}
function Metrics({ rows }: { rows: Metric[] }) {
  return (
    <dl className="research-metrics">
      {rows.map((m) => (
        <div key={m.label}>
          <dt>{m.label}</dt>
          <dd>
            {m.value == null
              ? "—"
              : m.unit === "%"
                ? `${price(m.value)}%`
                : m.unit === "rank"
                  ? `#${price(m.value, 0)}`
                  : m.unit === "count"
                    ? price(m.value, 0)
                    : compact(m.value)}{" "}
            {m.value != null && !["%", "rank", "count"].includes(m.unit) && (
              <small>{m.unit}</small>
            )}
          </dd>
          {m.period && <small className="metric-period">{m.period}</small>}
          {m.filed && (
            <small className="metric-period">
              Ingediend {smallDate(m.filed)}
            </small>
          )}
        </div>
      ))}
    </dl>
  );
}
function Panel({
  id,
  title,
  subtitle,
  icon,
  children,
  className = "",
}: {
  id: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`panel research-panel ${className}`}
      aria-labelledby={`${id}-title`}
    >
      <div className="panel-title">
        <div className="inline">
          {icon}
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
        <span className="muted small-text">{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

export default function MarketOverview({
  state,
  instrument,
  onSelect,
  onTerminal,
  onProviders,
  connected,
}: {
  state: State;
  instrument?: Instrument;
  onSelect: (id: string) => void;
  onTerminal: () => void;
  onProviders: () => void;
  connected: boolean;
}) {
  const [search, setSearch] = useState("");
  const matches = state.instruments.filter(
    (i) =>
      !search ||
      `${i.symbol} ${i.name} ${i.exchange} ${i.currency}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const options =
    instrument && !matches.some((i) => i.id === instrument.id)
      ? [instrument, ...matches]
      : matches;
  return (
    <main className="market-overview">
      <div className="research-heading">
        <div>
          <span className="research-eyebrow">INSTRUMENT RESEARCH</span>
          <h1>Marktoverzicht</h1>
          <p>Van koers en momentum naar de context achter de markt.</p>
        </div>
        <div className="research-selector">
          <label>
            <span>Zoek in je instrumenten</span>
            <div className="research-search">
              <Search size={15} />
              <input
                aria-label="Instrumenten zoeken"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Naam, symbool of beurs"
              />
            </div>
          </label>
          <label>
            <span>Instrument selecteren</span>
            <select
              aria-label="Instrument selecteren"
              value={instrument?.id ?? ""}
              onChange={(e) => onSelect(e.target.value)}
            >
              <option value="" disabled>
                Kies een instrument
              </option>
              {options.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.symbol} · {i.name} · {i.exchange} · {i.currency}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {search && (
        <p className="muted small-text">
          {matches.length} instrumenten gevonden. Nieuwe instrumenten voeg je
          toe via je watchlist in Terminal.
        </p>
      )}
      {instrument ? (
        <InstrumentResearch
          key={instrument.id}
          instrument={instrument}
          state={state}
          connected={connected}
          onTerminal={onTerminal}
          onProviders={onProviders}
          onSelect={onSelect}
        />
      ) : (
        <div className="panel research-empty">
          <ChartNoAxesCombined size={30} />
          <h2>Selecteer een instrument</h2>
          <p>Kies hierboven een markt of voeg er een toe in Terminal.</p>
          <button className="button" onClick={onTerminal}>
            Naar Terminal
          </button>
        </div>
      )}
    </main>
  );
}

function InstrumentResearch({
  instrument: i,
  state,
  connected,
  onTerminal,
  onProviders,
  onSelect,
}: {
  instrument: Instrument;
  state: State;
  connected: boolean;
  onTerminal: () => void;
  onProviders: () => void;
  onSelect: (id: string) => void;
}) {
  const q = state.quotes[i.id] ?? null;
  const [interval, setInterval] = useState("1d");
  const [history, setHistory] = useState<History | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [data, setData] = useState<Partial<Record<Section, Research>>>({});
  const [loading, setLoading] = useState<Partial<Record<Section, boolean>>>({});
  const [revision, setRevision] = useState(0);
  const preferred = q?.providerId;
  useEffect(() => {
    const controller = new AbortController();
    setHistory(null);
    setHistoryError("");
    let busy = false;
    async function load() {
      if (busy) return;
      busy = true;
      setHistoryLoading(true);
      try {
        const result = await api<History>(
          `/candles?instrument=${encodeURIComponent(i.id)}&interval=${interval}${preferred ? `&provider=${encodeURIComponent(preferred)}` : ""}`,
          "GET",
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setHistory(result);
          setHistoryError("");
        }
      } catch (e) {
        if (!controller.signal.aborted) setHistoryError((e as Error).message);
      } finally {
        busy = false;
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(load, 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [i.id, interval, preferred, revision]);
  useEffect(() => {
    const controller = new AbortController();
    sections.forEach((section) => {
      setLoading((old) => ({ ...old, [section]: true }));
      void api<Research>(
        `/research?instrument=${encodeURIComponent(i.id)}&section=${section}`,
        "GET",
        undefined,
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted)
            setData((old) => ({ ...old, [section]: result }));
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setData((old) => ({
              ...old,
              [section]: {
                source: "Lokale researchservice",
                url: "#",
                sourceAt: null,
                status: "unavailable",
                note: (e as Error).message,
              },
            }));
        })
        .finally(() => {
          if (!controller.signal.aborted)
            setLoading((old) => ({ ...old, [section]: false }));
        });
    });
    return () => controller.abort();
  }, [i.id, revision]);
  const tech = useMemo(
    () => technicals(history?.candles ?? [], interval),
    [history, interval],
  );
  const historyOld =
    !!history &&
    (!connected || !!historyError || Date.now() - history.fetchedAt > 120000);
  const duration: Record<string, number> = {
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
    "1w": 604800,
  };
  const candleOld =
    tech.at != null &&
    Date.now() / 1000 - tech.at > (duration[interval] ?? 86400) * 2;
  const busy = historyLoading || Object.values(loading).some(Boolean);
  const coin = data.fundamentals;
  const point = data.sentiment?.points?.[0];
  const spread =
    q?.bid != null && q.ask != null && q.ask >= q.bid ? q.ask - q.bid : null;
  const qStatus = !q
    ? "Geen koersbron"
    : !connected
      ? "Verbinding onderbroken"
      : q.stale
        ? "Verouderde koers"
        : q.marketOpen === false
          ? "Markt gesloten"
          : q.timeliness === "entitlement"
            ? "Feedrechten bepalen vertraging"
            : "Koers ontvangen";
  const selectedWatchlists = state.watchlists.filter((w) =>
    w.instruments.includes(i.id),
  );
  const contextIds = new Set(selectedWatchlists.flatMap((w) => w.instruments));
  const context = state.instruments
    .filter(
      (row) =>
        row.id !== i.id &&
        row.assetClass === i.assetClass &&
        contextIds.has(row.id),
    )
    .slice(0, 6);
  const providers = state.comparisons[i.id] ?? [];
  return (
    <>
      <section className="research-instrument panel">
        <div className="research-identity">
          <SymbolMark symbol={i.symbol} />
          <div>
            <div className="inline">
              <h2>{i.name}</h2>
              <span className="research-tag">
                {classNames[i.assetClass] ?? i.assetClass}
              </span>
            </div>
            <p>
              {i.symbol} <span>·</span> {i.exchange} <span>·</span> {i.currency}
            </p>
          </div>
        </div>
        <div className="research-price">
          <strong>
            {price(q?.price, q && q.price < 1 ? 4 : 2)}{" "}
            <small>{i.currency}</small>
          </strong>
          <span
            className={
              !q || q.stale || !connected
                ? "muted"
                : (q.changePct ?? 0) >= 0
                  ? "positive"
                  : "negative"
            }
          >
            {percent(q?.changePct)}{" "}
            <small className="muted">24u / sessie</small>
          </span>
        </div>
        <div className="research-instrument-actions">
          <button className="button secondary" onClick={onTerminal}>
            Open in Terminal <ArrowUpRight size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Marktoverzicht vernieuwen"
            title="Vernieuw onderzoek (broncaches en limieten blijven gelden)"
            disabled={busy}
            onClick={() => setRevision((r) => r + 1)}
          >
            <RefreshCw size={17} className={busy ? "spin" : ""} />
          </button>
        </div>
        <div className="research-quote-source">
          <span className="inline">
            <Dot
              good={!!q && !q.stale && connected}
              warn={!!q && (q.stale || !connected)}
            />
            {qStatus}
          </span>
          <span>
            {q
              ? `${q.provider} · ${q.venue} · ${q.transport}`
              : "Sluit een passende databron aan"}
          </span>
          <span>
            Koerstijd {q?.sourceAt ? stamp(q.sourceAt) : "niet aangeleverd"} ·
            Ontvangst {q?.receivedAt ? stamp(q.receivedAt) : "—"}
          </span>
        </div>
      </section>
      <nav className="research-jumps" aria-label="Onderwerpen marktoverzicht">
        {[
          ["key-data", "Key data"],
          ["technicals", "Technicals"],
          ["sentiment", "Sentiment"],
          ["fundamentals", "Fundamentals"],
          ["news", "Nieuws"],
          ["market", "De markt"],
        ].map(([id, title]) => (
          <a href={`#${id}`} key={id}>
            {title}
          </a>
        ))}
      </nav>
      <Panel
        id="key-data"
        title="Key data points"
        subtitle={`Koersbron · ${q?.provider ?? "niet aangesloten"}`}
        icon={<SlidersHorizontal size={16} />}
      >
        <dl className="key-data-grid">
          {[
            ["Hoog · 24u / sessie", price(q?.high)],
            ["Laag · 24u / sessie", price(q?.low)],
            [
              `Volume${i.assetClass === "crypto" ? ` · ${i.base ?? i.symbol.split("/")[0]}` : " · bron"}`,
              compact(q?.volume),
            ],
            ["Bid", price(q?.bid)],
            ["Ask", price(q?.ask)],
            [
              "Spread",
              spread == null ? "—" : `${price(spread, 4)} ${i.currency}`,
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {q?.high != null && q.low != null && (
          <div className="research-range">
            <span>{price(q.low)}</span>
            <div className="range-track">
              <span
                style={{
                  left: `${Math.max(0, Math.min(100, ((q.price - q.low) / (q.high - q.low || 1)) * 100))}%`,
                }}
              />
            </div>
            <span>{price(q.high)}</span>
            <small className="muted">Koers in dagbereik</small>
          </div>
        )}
        <p className="research-note">
          Prijs, bereik en volume komen uit één koersbron en blijven in{" "}
          {i.currency}. Ontbrekende waarden worden als — getoond.
        </p>
      </Panel>
      <div className="research-top-grid">
        <Panel
          id="technicals"
          title="Technicals"
          subtitle="Eigen berekening"
          icon={<Activity size={16} />}
        >
          <div className="technical-controls">
            <span className="muted">Candleperiode</span>
            <div
              className="research-periods"
              aria-label="Technische candleperiode"
            >
              {[
                ["1h", "1u"],
                ["4h", "4u"],
                ["1d", "1D"],
                ["1w", "1W"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={interval === value}
                  className={interval === value ? "active" : ""}
                  onClick={() => setInterval(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="technical-summary">
            <Gauge index={tech.index} score={tech.score} />
            <div className="technical-summary-detail">
              <span className="muted">
                Samenvatting ·{" "}
                {interval === "1d"
                  ? "dag"
                  : interval === "1w"
                    ? "week"
                    : interval === "4h"
                      ? "4 uur"
                      : "1 uur"}
              </span>
              <strong
                className={
                  tech.index == null
                    ? "muted"
                    : tech.index < 2
                      ? "negative"
                      : tech.index > 2
                        ? "positive"
                        : ""
                }
              >
                {tech.label ??
                  (historyLoading ? "Berekenen…" : "Onvoldoende historie")}
              </strong>
              <div className="technical-counts">
                <span className="negative">{tech.sells} Sell</span>
                <span className="muted">{tech.neutrals} Neutral</span>
                <span className="positive">{tech.buys} Buy</span>
              </div>
              <small className="muted">
                {tech.available} van 8 indicatoren · {tech.count} afgesloten
                candles
              </small>
              {tech.at && (
                <small className="muted">
                  Laatste close {stamp(tech.at * 1000)} · {price(tech.close)}{" "}
                  {i.currency}
                </small>
              )}
            </div>
          </div>
          <div className="technical-scale">
            {ratings.map((label, index) => (
              <span
                key={label}
                className={tech.index === index ? "selected" : ""}
              >
                {label}
              </span>
            ))}
          </div>
          {historyError && (
            <p className="research-note warning" role="status">
              {historyError}{" "}
              <button className="text-button" onClick={onProviders}>
                Databronnen <ArrowUpRight size={12} />
              </button>
            </p>
          )}
          {candleOld && (
            <p className="research-note warning">
              De laatste afgesloten candle is ouder dan twee candleperiodes. Dit
              kan ook voorkomen bij een gesloten markt; de gauge blijft een
              historische momentopname.
            </p>
          )}
          {historyOld && (
            <p className="research-note warning">
              Historie is verouderd of wordt niet bijgewerkt. Signalen horen bij
              de laatst ontvangen candles.
            </p>
          )}
          <details className="technical-details">
            <summary>Bekijk indicatoren en berekening</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Indicator</th>
                    <th>Waarde</th>
                    <th>Signaal</th>
                  </tr>
                </thead>
                <tbody>
                  {tech.signals.map((s) => (
                    <tr key={s.name} title={s.rule}>
                      <td>
                        {s.name}
                        <small className="signal-rule">{s.rule}</small>
                      </td>
                      <td className="mono">
                        {price(s.value, s.name.startsWith("MACD") ? 4 : 2)}
                      </td>
                      <td
                        className={
                          s.vote == null
                            ? "muted"
                            : s.vote === 1
                              ? "positive"
                              : s.vote === -1
                                ? "negative"
                                : "muted"
                        }
                      >
                        {s.vote == null
                          ? "Geen data"
                          : s.vote === 1
                            ? "Buy"
                            : s.vote === -1
                              ? "Sell"
                              : "Neutral"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="research-note">
              Elke beschikbare indicator telt even zwaar: Sell −1, Neutral 0,
              Buy +1. Minimaal 6 indicatoren. Gemiddelde ≤ −0,6 Strong Sell;
              &lt; −0,15 Sell; ≤ 0,15 Neutral; &lt; 0,6 Buy; anders Strong Buy.
              Lopende en gedeeltelijke candles worden uitgesloten. Dit is een
              technische momentopname.
            </p>
          </details>
          <div className="research-source">
            <span>
              {history
                ? `${history.provider} · ${history.venue} · ${history.interval} · ${i.currency}`
                : historyLoading
                  ? "Historie ophalen…"
                  : "Geen historische bron"}
            </span>
            <span>
              {history ? `Opgehaald ${stamp(history.fetchedAt)}` : ""}
            </span>
          </div>
          {history?.failures?.length ? (
            <p className="research-note warning">
              Historie via terugvalbron.{" "}
              {history.failures
                .map((f) => `${f.provider}: ${f.error}`)
                .join(" · ")}
            </p>
          ) : null}
        </Panel>
        <Panel
          id="sentiment"
          title="Sentiment"
          subtitle={
            i.assetClass === "crypto"
              ? "Bitcoin-marktcontext"
              : "Instrumentklasse"
          }
          icon={<Globe2 size={16} />}
        >
          <div className="sentiment-body">
            {point ? (
              <>
                <div className="sentiment-value">
                  <strong>
                    {point.value}
                    <small> / 100</small>
                  </strong>
                  <span>{point.label}</span>
                </div>
                <div className="sentiment-track">
                  <span style={{ left: `${point.value}%` }} />
                </div>
                <div className="sentiment-extremes">
                  <span>Extreme Fear</span>
                  <span>Extreme Greed</span>
                </div>
                <div className="sentiment-week">
                  <span className="muted">Laatste 7 metingen</span>
                  <div>
                    {[...(data.sentiment?.points ?? [])].reverse().map((p) => (
                      <span
                        key={p.at}
                        title={`${stamp(p.at)}: ${p.value} ${p.label}`}
                      >
                        <i
                          style={{ height: `${Math.max(3, p.value * 0.55)}px` }}
                        />
                        <small>{p.value}</small>
                      </span>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="research-empty-small">
                <Globe2 size={24} />
                <strong>
                  {loading.sentiment
                    ? "Sentiment ophalen…"
                    : "Geen passende sentimentdata"}
                </strong>
              </div>
            )}
            <Note data={data.sentiment} loading={!!loading.sentiment} />
          </div>
        </Panel>
      </div>
      <div className="research-middle-grid">
        <Panel
          id="fundamentals"
          title="Fundamentals"
          subtitle={
            i.assetClass === "crypto"
              ? "Tokenomics & waardering"
              : i.assetClass === "stock"
                ? "Gerapporteerde jaarcijfers"
                : "Instrumentcontext"
          }
          icon={<ChartNoAxesCombined size={16} />}
        >
          {coin?.identity && (
            <div className="fundamental-identity">{coin.identity}</div>
          )}
          {coin?.metrics?.length ? (
            <Metrics rows={coin.metrics} />
          ) : (
            <div className="research-empty-small">
              <ChartNoAxesCombined size={24} />
              <strong>
                {loading.fundamentals
                  ? "Fundamentals ophalen…"
                  : "Nog geen passende cijfers beschikbaar"}
              </strong>
            </div>
          )}
          <Note data={coin} loading={!!loading.fundamentals} />
        </Panel>
        <Panel
          id="news"
          title="Nieuws"
          subtitle="Laatste 7 dagen"
          icon={<Newspaper size={16} />}
        >
          <div className="research-news">
            {data.news?.articles?.map((article) => (
              <a key={article.url} href={article.url} {...external}>
                <div>
                  <span>{article.domain}</span>
                  <ArrowUpRight size={14} />
                </div>
                <h3>{article.title}</h3>
                <small>
                  {article.at
                    ? `${article.timeKind === "publication" ? "Gepubliceerd" : "Geregistreerd"} ${stamp(article.at)}`
                    : "Registratietijd onbekend"}{" "}
                  · {article.language}
                </small>
              </a>
            ))}
            {!data.news?.articles?.length && (
              <div className="research-empty-small">
                <Newspaper size={24} />
                <strong>
                  {loading.news
                    ? "Nieuws ophalen…"
                    : data.news?.status === "ok"
                      ? "Geen artikelen gevonden"
                      : "Nieuws momenteel niet beschikbaar"}
                </strong>
              </div>
            )}
          </div>
          <Note data={data.news} loading={!!loading.news} />
          {data.news?.query && (
            <details className="news-query">
              <summary>Zoekopdracht bekijken</summary>
              <p>{data.news.query}</p>
            </details>
          )}
          <a
            className="research-news-link"
            href={`https://news.google.com/search?q=${encodeURIComponent(`${i.name} ${i.assetClass === "crypto" ? "crypto" : "finance"}`)}`}
            {...external}
          >
            Verder zoeken in Google Nieuws <ArrowUpRight size={13} />
          </a>
        </Panel>
      </div>
      <Panel
        id="market"
        title="De markt"
        subtitle={
          i.assetClass === "crypto"
            ? "Wereldwijd & eigen watchlists"
            : "Koersbronnen & eigen watchlists"
        }
        icon={<Globe2 size={16} />}
      >
        {data.market?.metrics?.length ? (
          <Metrics rows={data.market.metrics} />
        ) : null}
        <Note data={data.market} loading={!!loading.market} />
        <div className="market-context-grid">
          <div>
            <h3>Andere instrumenten in je watchlists</h3>
            <p className="muted small-text">
              Dezelfde instrumentklasse · geen sectorbenchmark
            </p>
            {context.length ? (
              <div className="market-peer-list">
                {context.map((peer) => (
                  <Peer
                    key={peer.id}
                    instrument={peer}
                    quote={state.quotes[peer.id] ?? null}
                    onSelect={() => onSelect(peer.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="research-note">
                Voeg andere instrumenten van deze klasse aan je watchlist toe om
                ze hier te vergelijken.
              </p>
            )}
          </div>
          <div>
            <h3>Handelsplatformen voor {i.symbol}</h3>
            <p className="muted small-text">
              Brongebonden prijzen · {i.currency}
            </p>
            <div className="market-peer-list">
              {providers.map((provider) => (
                <div className="market-source-row" key={provider.providerId}>
                  <div>
                    <strong>{provider.provider}</strong>
                    <small>
                      {provider.venue} ·{" "}
                      {provider.stale ? "verouderd" : "ontvangen"}
                    </small>
                  </div>
                  <strong className="mono">
                    {price(provider.price, provider.price < 1 ? 4 : 2)}
                  </strong>
                </div>
              ))}
              {!providers.length && (
                <p className="research-note">
                  Geen koersen ontvangen voor dit instrument.
                </p>
              )}
            </div>
            <button className="text-button" onClick={onProviders}>
              Beheer databronnen <ArrowUpRight size={13} />
            </button>
          </div>
        </div>
      </Panel>
      <p className="research-footnote">
        <Info size={14} /> Aanvullende bronnen worden alleen bij openen of
        vernieuwen opgehaald. Bronlimieten en caches blijven gelden.
        Beursprijzen en geaggregeerde marktdata hebben een eigen scope en
        tijdstip.
      </p>
    </>
  );
}

function Peer({
  instrument: i,
  quote: q,
  onSelect,
}: {
  instrument: Instrument;
  quote: Quote | null;
  onSelect: () => void;
}) {
  return (
    <button
      className="market-peer"
      onClick={onSelect}
      aria-label={`Bekijk ${i.symbol}`}
    >
      <div>
        <strong>{i.symbol}</strong>
        <small>
          {i.name} · {i.exchange}
        </small>
      </div>
      <div>
        <strong className="mono">
          {price(q?.price, q && q.price < 1 ? 4 : 2)}{" "}
          <small>{i.currency}</small>
        </strong>
        <small
          className={
            !q || q.stale
              ? "muted"
              : (q.changePct ?? 0) >= 0
                ? "positive"
                : "negative"
          }
        >
          {!q ? "Geen koers" : q.stale ? "Verouderd" : percent(q.changePct)}
        </small>
      </div>
      <ArrowUpRight size={14} />
    </button>
  );
}
function Gauge({
  index,
  score,
}: {
  index: number | null;
  score: number | null;
}) {
  const colors = ["#ef7c85", "#dfaa7e", "#7f8b9c", "#74bdb0", "#d4f77d"];
  const point = (angle: number, r: number) =>
    `${150 + r * Math.cos(angle)},${140 - r * Math.sin(angle)}`;
  const angle = Math.PI * (1 - ((score ?? 0) + 1) / 2);
  return (
    <svg
      className="technical-gauge"
      viewBox="0 0 300 158"
      role="img"
      aria-label={
        index == null
          ? "Technische gauge: onvoldoende historie"
          : `Technische gauge: ${ratings[index]}, score ${score?.toFixed(2)}`
      }
    >
      {colors.map((color, n) => {
        const start = Math.PI - (n * Math.PI) / 5 - 0.016,
          end = Math.PI - ((n + 1) * Math.PI) / 5 + 0.016;
        return (
          <path
            key={color}
            d={`M ${point(start, 116)} A 116 116 0 0 1 ${point(end, 116)}`}
            fill="none"
            stroke={color}
            strokeWidth="15"
            opacity={index == null ? 0.25 : 0.9}
          />
        );
      })}
      {index != null && (
        <>
          <line
            x1="150"
            y1="140"
            x2={150 + 86 * Math.cos(angle)}
            y2={140 - 86 * Math.sin(angle)}
            stroke="#edf1f7"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="150" cy="140" r="7" fill="#edf1f7" />
        </>
      )}
      <text x="29" y="153" textAnchor="middle" fill="#8490a5" fontSize="10">
        −1
      </text>
      <text x="150" y="90" textAnchor="middle" fill="#8490a5" fontSize="11">
        {index == null ? "GEEN SIGNAAL" : "TECHNISCHE SCORE"}
      </text>
      <text
        x="150"
        y="113"
        textAnchor="middle"
        fill="#edf1f7"
        fontSize="20"
        fontFamily="JetBrains Mono, monospace"
      >
        {score == null ? "—" : score.toFixed(2)}
      </text>
      <text x="271" y="153" textAnchor="middle" fill="#8490a5" fontSize="10">
        +1
      </text>
    </svg>
  );
}
