import { useEffect, useState } from "react";
import { Search, Plus, Check, RefreshCw } from "lucide-react";
import { api, stamp } from "./api";
import { SymbolMark } from "./ui";
import {
  classNames,
  type State,
  type Instrument,
  type CatalogResult,
} from "./types";

export default function InstrumentCatalog({
  state,
  selectedIds,
  busy,
  onToggle,
}: {
  state: State;
  selectedIds: string[];
  busy: boolean;
  onToggle: (instrument: Instrument) => void;
}) {
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [market, setMarket] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<CatalogResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const providerSignature = JSON.stringify(
    state.providers.map((p) => [
      p.id,
      p.name,
      p.priority,
      p.enabled,
      p.hasKey,
      p.feed,
    ]),
  );
  useEffect(() => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    setLoading(true);
    setError("");
    const load = async () => {
      try {
        const params = new URLSearchParams({
          q: search,
          provider,
          assetClass: market,
          offset: String(offset),
          limit: "50",
        });
        const data = await api<CatalogResult>(
          `/catalog?${params}`,
          "GET",
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setResult(data);
        setLoading(false);
        if (data.sources.some((s) => s.loading))
          timeout = setTimeout(load, 1500);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError((e as Error).message);
        setLoading(false);
      }
    };
    timeout = setTimeout(load, 200);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [search, provider, market, offset, providerSignature, revision]);
  async function refreshCatalog() {
    setError("");
    setLoading(true);
    try {
      await api("/catalog/refresh", "POST");
      setRevision((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }
  const fetching = result?.sources.some((s) => s.loading) ?? false;
  const providers = [...state.providers].sort(
    (a, b) => a.priority - b.priority,
  );
  return (
    <div className="catalog-search">
      <label className="search">
        <Search size={17} />
        <input
          autoFocus
          value={search}
          maxLength={100}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          placeholder="Zoek op naam, symbool, beurs, valuta of bron"
          aria-label="Instrument zoeken"
        />
      </label>
      <div className="catalog-filters">
        <label>
          Databron
          <select
            aria-label="Catalogus databron"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Alle bronnen</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {!p.enabled ? " (uit)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Markt
          <select
            aria-label="Catalogus markt"
            value={market}
            onChange={(e) => {
              setMarket(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Alle markten</option>
            {["crypto", "stock", "etf", "forex", "commodity"].map((c) => (
              <option key={c} value={c}>
                {classNames[c]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          disabled={loading || fetching}
          onClick={refreshCatalog}
        >
          <RefreshCw size={14} /> Catalogus vernieuwen
        </button>
      </div>
      <p className="muted small-text">
        Instrumenten uit de catalogi van je bronnen. Koersbeschikbaarheid hangt
        af van je feedrechten. De koersbron wordt gekozen op prioriteit en
        actualiteit.
      </p>
      {error && (
        <p className="provider-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="catalog-summary" aria-live="polite">
        <span>
          {loading
            ? "Zoeken…"
            : `${(result?.total ?? 0).toLocaleString("nl-NL")} instrumenten gevonden`}
        </span>
        {fetching && <span className="muted">Broncatalogi ophalen…</span>}
      </div>
      {!!result?.sources.length && (
        <details className="catalog-source-status">
          <summary>
            Catalogusstatus per bron
            {result.sources.some((s) => s.error || s.warnings.length || s.stale)
              ? " · meldingen"
              : ""}
          </summary>
          {result.sources.map((s) => (
            <div key={s.id}>
              <strong>{s.name}</strong>
              <span>
                {s.loading
                  ? "Ophalen…"
                  : `${s.count.toLocaleString("nl-NL")} instrumenten${s.stale && s.fetchedAt ? " · bewaarde catalogus" : ""}`}
                {s.fetchedAt ? ` · ${stamp(s.fetchedAt)}` : ""}
              </span>
              {s.error && <span className="warning">{s.error}</span>}
              {s.warnings.map((w) => (
                <span className="warning" key={w}>
                  {w}
                </span>
              ))}
            </div>
          ))}
        </details>
      )}
      <div className="instrument-results" aria-busy={loading}>
        {!loading &&
          result?.items.map((i) => {
            const sources = providers.filter((p) =>
              i.providerIds?.includes(p.id),
            );
            const sourceLabel =
              sources
                .map(
                  (p) =>
                    `${p.name}${!p.enabled ? " (uit)" : state.adapters.find((a) => a.type === p.type)?.keyRequired && !p.hasKey ? " (sleutel nodig)" : ""}`,
                )
                .join(" · ") || "Geen gekoppelde bron";
            return (
              <button
                className="instrument-result"
                key={i.id}
                disabled={busy}
                onClick={() => onToggle(i)}
              >
                <SymbolMark small symbol={i.symbol} />
                <span>
                  <strong>{i.symbol}</strong>
                  <small>
                    {i.name} ·{" "}
                    {i.exchange === "MULTI" ? "Crypto spot" : i.exchange} ·{" "}
                    {i.currency}
                  </small>
                  <small className="instrument-sources">
                    Bronnen: {sourceLabel}
                  </small>
                  {i.verified === false && (
                    <small className="warning">
                      Bronkoppeling deels uit startlijst of eigen invoer
                    </small>
                  )}
                </span>
                <span className="asset-label">{classNames[i.assetClass]}</span>
                {selectedIds.includes(i.id) ? (
                  <Check size={18} className="positive" />
                ) : (
                  <Plus size={18} />
                )}
              </button>
            );
          })}
        {!loading && !result?.items.length && (
          <p className="empty-small">
            Geen instrumenten gevonden. Pas je zoekterm of filters aan
            {fetching ? "; de broncatalogi worden nog opgehaald" : ""}.
          </p>
        )}
      </div>
      {!!result?.total && (
        <div className="catalog-pagination">
          <span className="muted small-text">
            {Math.min(offset + 1, result.total)}–
            {Math.min(offset + result.limit, result.total)} van{" "}
            {result.total.toLocaleString("nl-NL")}
          </span>
          <button
            className="button"
            disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Vorige
          </button>
          <button
            className="button"
            disabled={loading || offset + 50 >= result.total}
            onClick={() => setOffset(offset + 50)}
          >
            Volgende
          </button>
        </div>
      )}
    </div>
  );
}
