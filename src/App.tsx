import { useEffect, useState } from "react";
import {
  ChartCandlestick,
  Database,
  Radio,
  ArrowUpRight,
  Command,
  RefreshCw,
  X,
} from "lucide-react";
import { useTerminal, price, percent } from "./api";
import Watchlist from "./Watchlist";
import ChartPanel from "./ChartPanel";
import Inspector, { ProviderTable } from "./Inspector";
import Providers from "./Providers";
import { Dot } from "./ui";
export default function App() {
  const { state, connected, error, refresh } = useTerminal();
  const [page, setPage] = useState<"terminal" | "providers">("terminal");
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("yield-favorites") ?? "[]");
      return Array.isArray(saved)
        ? saved.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  });
  const [selected, setSelected] = useState(
    () => localStorage.getItem("yield-selected") ?? "crypto:BTC:USD",
  );
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    localStorage.setItem("yield-favorites", JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>(
            'input[aria-label="Watchlist zoeken"]',
          )
          ?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const instrument = state?.instruments.find((i) => i.id === selected);
  const quote = instrument ? (state?.quotes[instrument.id] ?? null) : null;
  const choose = (id: string) => {
    setSelected(id);
    localStorage.setItem("yield-selected", id);
    setPage("terminal");
  };
  const toggleFavorite = (id: string) => {
    setFavorites((current) => {
      return current.includes(id)
        ? current.filter((favorite) => favorite !== id)
        : [...current, id];
    });
  };
  return (
    <div className="app">
      <header className="app-header">
        <a
          href="#"
          className="wordmark"
          onClick={(e) => {
            e.preventDefault();
            setPage("terminal");
          }}
        >
          WJP <span>yield</span>
          <i />
        </a>
        <nav>
          <button
            onClick={() => setPage("terminal")}
            className={page === "terminal" ? "active" : ""}
          >
            <ChartCandlestick size={18} /> Terminal
          </button>
          <button
            onClick={() => setPage("providers")}
            className={page === "providers" ? "active" : ""}
          >
            <Database size={18} /> Databronnen
          </button>
        </nav>
        <div className="header-right">
          <span className="local-label">
            <Dot good /> Alleen lokaal
          </span>
          <span className="header-divider" />
          <span className="avatar">WP</span>
        </div>
      </header>
      {page === "terminal" && (
        <div className="ticker-strip">
          {state?.instruments
            .filter((i) => favorites.includes(i.id))
            .map((i) => {
              const q = state.quotes[i.id];
              return (
                <button onClick={() => choose(i.id)} key={i.id}>
                  <span>{i.symbol}</span>
                  <strong>{price(q?.price)}</strong>
                  <span
                    className={
                      q?.stale || q?.changePct == null
                        ? "muted"
                        : q.changePct >= 0
                          ? "positive"
                          : "negative"
                    }
                  >
                    {q?.marketOpen === false
                      ? "Gesloten"
                      : q?.stale
                        ? "Verouderd"
                        : percent(q?.changePct)}
                  </span>
                </button>
              );
            })}
          {state &&
            !favorites.some((id) =>
              state.instruments.some((i) => i.id === id),
            ) && (
              <span className="ticker-empty">
                Markeer een instrument met de ster om het hier vast te zetten
              </span>
            )}
        </div>
      )}
      {!connected && state && (
        <div className="connection-warning" role="status">
          Verbinding met de lokale dataservice verbroken. Getoonde koersen
          worden niet bijgewerkt. Automatisch opnieuw verbinden…
        </div>
      )}
      {!state ? (
        <div className="boot">
          <RefreshCw className="spin" />
          <h1>Je markten komen eraan.</h1>
          <p>{error || "Verbinding maken met je lokale terminal…"}</p>
          <button className="button" onClick={refresh}>
            Opnieuw verbinden
          </button>
        </div>
      ) : page === "providers" ? (
        <Providers state={state} refresh={refresh} notify={setToast} />
      ) : (
        <main className="terminal">
          <div className="terminal-grid">
            <Watchlist
              state={state}
              selected={instrument?.id ?? ""}
              onSelect={choose}
              refresh={refresh}
              notify={setToast}
            />
            {instrument ? (
              <>
                <ChartPanel
                  instrument={instrument}
                  quote={quote}
                  favorite={favorites.includes(instrument.id)}
                  onToggleFavorite={() => toggleFavorite(instrument.id)}
                  onProviders={() => setPage("providers")}
                  connected={connected}
                />
                <Inspector
                  instrument={instrument}
                  quote={quote}
                  state={state}
                />
              </>
            ) : (
              <section className="panel empty-chart">
                <ChartCandlestick size={36} />
                <h2>Kies je volgende markt</h2>
                <p>
                  Selecteer een instrument of voeg er een toe aan je watchlist.
                </p>
              </section>
            )}
          </div>
          <ProviderTable state={state} onManage={() => setPage("providers")} />
          <div className="workspace-note">
            <span>
              <Command size={13} /> <kbd>/</kbd> zoeken{" "}
              <span className="middot">·</span> Scroll om te zoomen{" "}
              <span className="middot">·</span> Sleep om te verplaatsen
            </span>
            <span>
              Onderzoek begint bij betrouwbare data <ArrowUpRight size={13} />
            </span>
          </div>
        </main>
      )}
      <footer>
        <span>
          <Dot good={connected} warn={!connected} />
          {connected ? "WebSocket verbonden" : "Verbinding herstellen"}
        </span>
        <span className="footer-center">
          <Radio size={12} /> Market research terminal
        </span>
        <span>
          WJP yield <span className="muted">v0.1.0</span>
        </span>
      </footer>
      {toast && (
        <div role="status" className="toast">
          {toast}
          <button aria-label="Melding sluiten" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
