import { useState } from "react";
import {
  Plus,
  Search,
  MoreHorizontal,
  Trash2,
  Check,
  ArrowUpRight,
} from "lucide-react";
import { api, price, percent } from "./api";
import { Dialog, SymbolMark } from "./ui";
import {
  classNames,
  type State,
  type Watchlist as List,
  type Instrument,
} from "./types";
type Props = {
  state: State;
  selected: string;
  onSelect: (id: string) => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
};
export default function Watchlist({
  state,
  selected,
  onSelect,
  refresh,
  notify,
}: Props) {
  const [listId, setListId] = useState(
    () => localStorage.getItem("yield-list") || "default",
  );
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<"add" | "manage" | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [custom, setCustom] = useState(false);
  const list =
    state.watchlists.find((w) => w.id === listId) ?? state.watchlists[0];
  async function mutate(task: () => Promise<unknown>) {
    setBusy(true);
    try {
      await task();
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(id: string) {
    if (!list) return;
    await mutate(() =>
      api(`/watchlists/${list.id}`, "PUT", {
        ...list,
        instruments: list.instruments.includes(id)
          ? list.instruments.filter((i) => i !== id)
          : [...list.instruments, id],
      }),
    );
  }
  const rows = state.instruments.filter(
    (i) =>
      list?.instruments.includes(i.id) &&
      (filter === "all" || i.assetClass === filter) &&
      `${i.symbol} ${i.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <aside className="watchlist panel">
      <div className="panel-title">
        <h2>Watchlist</h2>
        <div className="inline">
          <button
            className="icon-button"
            aria-label="Watchlists beheren"
            onClick={() => {
              setNewName(list?.name ?? "");
              setModal("manage");
            }}
          >
            <MoreHorizontal size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Instrument toevoegen"
            onClick={() => setModal("add")}
          >
            <Plus size={19} />
          </button>
        </div>
      </div>
      <div className="watch-controls">
        <select
          aria-label="Watchlist kiezen"
          value={list?.id ?? ""}
          onChange={(e) => {
            setListId(e.target.value);
            localStorage.setItem("yield-list", e.target.value);
          }}
        >
          {state.watchlists.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <label className="search">
          <Search size={15} />
          <input
            aria-label="Watchlist zoeken"
            placeholder="Zoek symbool..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>/</kbd>
        </label>
        <div className="segments">
          {[
            ["all", "Alle"],
            ["crypto", "Crypto"],
            ["stock", "Aandelen"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={filter === id ? "active" : ""}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="watch-table-head">
        <span>Symbool</span>
        <span>Prijs / Δ %</span>
      </div>
      <div className="watch-rows">
        {rows.map((i) => {
          const q = state.quotes[i.id];
          return (
            <button
              key={i.id}
              className={`watch-row ${i.id === selected ? "selected" : ""}`}
              onClick={() => onSelect(i.id)}
            >
              <SymbolMark small symbol={i.symbol} />
              <span className="watch-name">
                <strong>{i.symbol}</strong>
                <small>{i.name}</small>
              </span>
              <span className="watch-quote">
                <strong className={q?.stale ? "muted" : ""}>
                  {price(q?.price, q && q.price < 1 ? 4 : 2)}
                </strong>
                <small
                  className={
                    q?.changePct == null
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
                      : q
                        ? percent(q.changePct)
                        : "Geen bron"}
                </small>
              </span>
            </button>
          );
        })}
        {!rows.length && (
          <div className="empty-small">
            Geen instrumenten gevonden.
            <button className="text-button" onClick={() => setModal("add")}>
              Instrument toevoegen <Plus size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="watch-bottom">
        <span>{list?.instruments.length ?? 0} instrumenten</span>
        <span>USD & lokale valuta</span>
      </div>
      {modal === "manage" && (
        <Dialog title="Watchlists beheren" onClose={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutate(() =>
                api(`/watchlists/${list.id}`, "PUT", {
                  ...list,
                  name: newName,
                }),
              );
            }}
          >
            <label>
              Naam van huidige lijst
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                maxLength={40}
              />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="button danger"
                disabled={busy || state.watchlists.length <= 1}
                onClick={() =>
                  mutate(() => api(`/watchlists/${list.id}`, "DELETE"))
                }
              >
                <Trash2 size={14} /> Lijst verwijderen
              </button>
              <button className="button primary" disabled={busy}>
                Naam opslaan
              </button>
            </div>
          </form>
          <hr />
          <button
            className="button full"
            disabled={busy}
            onClick={() =>
              mutate(async () => {
                const w = await api<List>("/watchlists", "POST", {
                  name: "Nieuwe watchlist",
                  instruments: [],
                });
                setListId(w.id);
                setNewName(w.name);
              })
            }
          >
            <Plus size={16} /> Nieuwe watchlist
          </button>
        </Dialog>
      )}
      {modal === "add" && (
        <Dialog
          title="Instrument toevoegen"
          onClose={() => setModal(null)}
          wide
        >
          <div className="dialog-body">
            <label className="search">
              <Search size={17} />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Zoek op naam, symbool of markt"
                aria-label="Instrument zoeken"
              />
            </label>
            <div className="instrument-results">
              {state.instruments
                .filter((i) =>
                  `${i.symbol} ${i.name} ${classNames[i.assetClass]}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((i) => (
                  <button
                    className="instrument-result"
                    key={i.id}
                    disabled={busy}
                    onClick={() => toggle(i.id)}
                  >
                    <SymbolMark small symbol={i.symbol} />
                    <span>
                      <strong>{i.symbol}</strong>
                      <small>
                        {i.name} · {i.exchange}
                      </small>
                    </span>
                    <span className="asset-label">
                      {classNames[i.assetClass]}
                    </span>
                    {list?.instruments.includes(i.id) ? (
                      <Check size={18} className="positive" />
                    ) : (
                      <Plus size={18} />
                    )}
                  </button>
                ))}
            </div>
            <button className="text-button" onClick={() => setCustom(!custom)}>
              Eigen instrument via Twelve Data <ArrowUpRight size={15} />
            </button>
            {custom && (
              <form
                className="custom-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const values = Object.fromEntries(
                    new FormData(e.currentTarget),
                  );
                  mutate(async () => {
                    const i = await api<Instrument>(
                      "/instruments",
                      "POST",
                      values,
                    );
                    await api(`/watchlists/${list.id}`, "PUT", {
                      ...list,
                      instruments: [...list.instruments, i.id],
                    });
                    setCustom(false);
                    notify(
                      "Instrument toegevoegd. Beschikbaarheid hangt af van je feedrechten.",
                    );
                  });
                }}
              >
                <p className="muted">
                  Gebruik het exacte providersymbool, de beurs en quotevaluta.
                  De databron controleert beschikbaarheid bij het ophalen.
                </p>
                <div className="form-grid">
                  <label>
                    Symbool
                    <input name="symbol" required placeholder="IBM" />
                  </label>
                  <label>
                    Naam
                    <input name="name" required placeholder="IBM" />
                  </label>
                  <label>
                    Markt
                    <select name="assetClass">
                      {Object.entries(classNames)
                        .filter(([k]) => k !== "crypto")
                        .map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Beurs
                    <input name="exchange" required placeholder="NYSE of OTC" />
                  </label>
                  <label>
                    Quotevaluta
                    <input
                      name="currency"
                      required
                      pattern="[A-Z]{3}"
                      defaultValue="USD"
                    />
                  </label>
                </div>
                <button className="button primary" disabled={busy}>
                  Instrument opslaan
                </button>
              </form>
            )}
          </div>
        </Dialog>
      )}
    </aside>
  );
}
