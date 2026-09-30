import { useEffect, useState } from "react";
import { Plus, Search, Settings2, Trash2, ArrowUpRight } from "lucide-react";
import { api, price, percent } from "./api";
import { Dialog, SymbolMark } from "./ui";
import InstrumentCatalog from "./InstrumentCatalog";
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
  const [custom, setCustom] = useState(false);
  const [formError, setFormError] = useState("");
  const [removal, setRemoval] = useState<{
    list: List;
    instrument?: Instrument;
  } | null>(null);
  const list =
    state.watchlists.find((w) => w.id === listId) ?? state.watchlists[0];
  useEffect(() => {
    if (busy) return;
    if (listId !== (list?.id ?? "")) {
      setListId(list?.id ?? "");
      localStorage.setItem("yield-list", list?.id ?? "");
      setNewName(list?.name ?? "");
    }
  }, [listId, list, busy]);
  function chooseList(w: List) {
    setListId(w.id);
    setNewName(w.name);
    localStorage.setItem("yield-list", w.id);
    setQuery("");
    setFilter("all");
    onSelect(w.instruments[0] ?? "");
  }
  function openManage() {
    setNewName(list?.name ?? "");
    setFormError("");
    setModal("manage");
  }
  async function createList() {
    await mutate(async () => {
      const w = await api<List>("/watchlists", "POST", {
        name: "Nieuwe watchlist",
        instruments: [],
      });
      chooseList(w);
      setModal("manage");
    });
  }
  async function remove() {
    if (!removal) return;
    const target = removal;
    await mutate(async () => {
      await api(
        target.instrument
          ? `/watchlists/${target.list.id}/items/${encodeURIComponent(target.instrument.id)}`
          : `/watchlists/${target.list.id}`,
        "DELETE",
      );
      if (target.instrument) {
        if (selected === target.instrument.id)
          onSelect(
            target.list.instruments.find(
              (id) => id !== target.instrument!.id,
            ) ?? "",
          );
        notify(
          `${target.instrument.symbol} uit ${target.list.name} verwijderd`,
        );
      } else {
        const next = state.watchlists.find((w) => w.id !== target.list.id);
        if (next) chooseList(next);
        else {
          setListId("");
          localStorage.removeItem("yield-list");
          onSelect("");
        }
        notify(`${target.list.name} verwijderd`);
      }
      setRemoval(null);
      setModal(null);
    });
  }
  async function mutate(task: () => Promise<unknown>) {
    setBusy(true);
    setFormError("");
    try {
      await task();
      await refresh();
    } catch (e) {
      setFormError((e as Error).message);
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(instrument: Instrument) {
    if (!list) return;
    const id = instrument.id;
    if (list.instruments.includes(id)) {
      if (instrument) {
        setRemoval({ list, instrument });
        setModal(null);
      }
      return;
    }
    await mutate(async () => {
      await api("/catalog/instruments", "POST", { id });
      await api(`/watchlists/${list.id}`, "PUT", {
        ...list,
        instruments: [...list.instruments, id],
      });
    });
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
            className="text-button watch-manage"
            aria-label="Watchlists beheren"
            onClick={openManage}
          >
            <Settings2 size={15} /> Beheer
          </button>
          <button
            className="icon-button"
            aria-label="Instrument toevoegen"
            disabled={!list}
            onClick={() => {
              setFormError("");
              setModal("add");
            }}
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
            const next = state.watchlists.find((w) => w.id === e.target.value);
            if (next) chooseList(next);
          }}
        >
          {!list && <option value="">Geen watchlists</option>}
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
            <div
              key={i.id}
              className={`watch-row ${i.id === selected ? "selected" : ""}`}
            >
              <button
                className="watch-row-select"
                onClick={() => onSelect(i.id)}
                aria-label={`${i.symbol} bekijken`}
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
              <button
                className="icon-button watch-remove"
                aria-label={`${i.symbol} uit watchlist verwijderen`}
                title="Uit watchlist verwijderen"
                disabled={busy}
                onClick={() => {
                  setFormError("");
                  setRemoval({ list, instrument: i });
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
        {!rows.length && (
          <div className="empty-small">
            {!list
              ? "Je hebt nog geen watchlist."
              : list.instruments.length
                ? "Geen instrumenten voor dit filter."
                : "Deze watchlist is leeg."}
            <button
              className="text-button"
              onClick={() => (list ? setModal("add") : createList())}
              disabled={busy}
            >
              {list ? "Instrument toevoegen" : "Watchlist maken"}{" "}
              <Plus size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="watch-bottom">
        <span>{list?.instruments.length ?? 0} instrumenten</span>
        <span>USD & lokale valuta</span>
      </div>
      {removal && (
        <Dialog
          title={
            removal.instrument
              ? "Vermelding verwijderen"
              : "Watchlist verwijderen"
          }
          onClose={() => !busy && setRemoval(null)}
        >
          <div className="dialog-body">
            <p>
              {removal.instrument
                ? `Wil je ${removal.instrument.symbol} uit “${removal.list.name}” verwijderen?`
                : `Wil je “${removal.list.name}” met ${removal.list.instruments.length} vermeldingen verwijderen?`}
            </p>
            <p className="muted">
              Vermeldingen in andere watchlists blijven behouden. Eigen
              instrumenten die nergens meer voorkomen worden opgeruimd.
            </p>
            {formError && (
              <p className="provider-form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                className="button"
                disabled={busy}
                onClick={() => setRemoval(null)}
              >
                Annuleren
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={remove}
              >
                <Trash2 size={14} /> {busy ? "Verwijderen…" : "Verwijderen"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {modal === "manage" && !removal && (
        <Dialog title="Watchlists beheren" onClose={() => setModal(null)} wide>
          <div className="dialog-body watch-manager">
            <div className="watch-manager-heading">
              <span className="muted">
                {state.watchlists.length}{" "}
                {state.watchlists.length === 1 ? "watchlist" : "watchlists"}
              </span>
              <button className="button" disabled={busy} onClick={createList}>
                <Plus size={16} /> Nieuwe watchlist
              </button>
            </div>
            {list ? (
              <>
                <label>
                  Watchlist beheren
                  <select
                    value={list.id}
                    onChange={(e) => {
                      const next = state.watchlists.find(
                        (w) => w.id === e.target.value,
                      );
                      if (next) chooseList(next);
                    }}
                  >
                    {state.watchlists.map((w) => (
                      <option value={w.id} key={w.id}>
                        {w.name} · {w.instruments.length} vermeldingen
                      </option>
                    ))}
                  </select>
                </label>
                <form
                  className="watch-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    mutate(async () => {
                      await api(`/watchlists/${list.id}`, "PUT", {
                        ...list,
                        name: newName,
                      });
                      notify("Naam opgeslagen");
                    });
                  }}
                >
                  <label>
                    Naam van de watchlist
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      required
                      maxLength={40}
                    />
                  </label>
                  <button className="button" disabled={busy}>
                    Naam opslaan
                  </button>
                </form>
                <div
                  className="watch-manager-items"
                  aria-label="Vermeldingen beheren"
                >
                  {list.instruments
                    .map((id) => state.instruments.find((i) => i.id === id))
                    .filter((i): i is Instrument => !!i)
                    .map((i) => (
                      <div className="watch-manager-item" key={i.id}>
                        <SymbolMark small symbol={i.symbol} />
                        <span>
                          <strong>{i.symbol}</strong>
                          <small>
                            {i.name} · {i.exchange}
                          </small>
                        </span>
                        <button
                          className="icon-button framed"
                          disabled={busy}
                          aria-label={`${i.symbol} uit watchlist verwijderen`}
                          onClick={() => {
                            setFormError("");
                            setRemoval({ list, instrument: i });
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  {!list.instruments.length && (
                    <p className="muted">
                      Deze watchlist heeft nog geen vermeldingen.
                    </p>
                  )}
                </div>
                <div className="dialog-actions">
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() => {
                      setFormError("");
                      setRemoval({ list });
                    }}
                  >
                    <Trash2 size={14} /> Watchlist verwijderen
                  </button>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => {
                      setFormError("");
                      setModal("add");
                    }}
                  >
                    <Plus size={15} /> Instrument toevoegen
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">
                Maak een watchlist om instrumenten te volgen.
              </p>
            )}
            {formError && (
              <p className="provider-form-error" role="alert">
                {formError}
              </p>
            )}
          </div>
        </Dialog>
      )}
      {modal === "add" && list && !removal && (
        <Dialog
          title="Instrument toevoegen"
          onClose={() => setModal(null)}
          wide
        >
          <div className="dialog-body">
            {formError && (
              <p className="provider-form-error" role="alert">
                {formError}
              </p>
            )}
            <InstrumentCatalog
              state={state}
              selectedIds={list.instruments}
              busy={busy}
              onToggle={toggle}
            />
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
