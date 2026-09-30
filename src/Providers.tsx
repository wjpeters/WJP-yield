import { useState } from "react";
import {
  Plus,
  ArrowUpRight,
  Settings2,
  ShieldCheck,
  Activity,
  Waypoints,
  KeyRound,
  Trash2,
  Check,
  RefreshCw,
} from "lucide-react";
import { api, age, time } from "./api";
import { Dialog, Dot } from "./ui";
import type { Provider, State } from "./types";
type Props = {
  state: State;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
};
export default function Providers({ state, refresh, notify }: Props) {
  const [edit, setEdit] = useState<Provider | "new" | null>(null);
  const [busy, setBusy] = useState("");
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [type, setType] = useState("twelve");
  const [feed, setFeed] = useState("iex");
  const [formError, setFormError] = useState("");
  const adapter = state.adapters.find((a) => a.type === type);
  async function test(p: Provider) {
    setBusy(p.id);
    try {
      const r = await api<{ latencyMs: number; symbol: string }>(
        `/providers/${p.id}/test`,
        "POST",
        {},
      );
      setTestResults((v) => ({
        ...v,
        [p.id]: `${r.symbol} ontvangen · ${r.latencyMs} ms`,
      }));
      await refresh();
    } catch (e) {
      setTestResults((v) => ({ ...v, [p.id]: (e as Error).message }));
    } finally {
      setBusy("");
    }
  }
  const active = state.providers.filter((p) => p.enabled).length;
  return (
    <main className="providers-page">
      <div className="page-heading">
        <div>
          <span className="section-index">DATA WORKSPACE</span>
          <h1>Jouw markt. Jouw bronnen.</h1>
          <p>
            Verbind feeds, vergelijk koersen en houd grip op je datakwaliteit.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setFormError("");
            setType("twelve");
            setEdit("new");
          }}
        >
          <Plus size={17} /> Databron toevoegen
        </button>
      </div>
      <div className="provider-summary">
        <div>
          <Activity size={19} />
          <strong>
            {active}
            <span> / {state.providers.length}</span>
          </strong>
          <span>Bronnen ingeschakeld</span>
        </div>
        <div>
          <Waypoints size={19} />
          <strong>Automatisch</strong>
          <span>Failover op actualiteit & prioriteit</span>
        </div>
        <div>
          <ShieldCheck size={19} />
          <strong>Alleen lokaal</strong>
          <span>API-sleutels versleuteld opgeslagen</span>
        </div>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>Verbonden databronnen</h2>
          <span className="muted small-text">
            Laagste prioriteitsnummer wordt eerst gebruikt
          </span>
        </div>
        <div className="provider-list">
          {state.providers.map((p) => (
            <article className="provider-item" key={p.id}>
              <div className={`provider-logo large ${p.type}`}>
                {p.name.slice(0, 1)}
              </div>
              <div className="provider-info">
                <h3>
                  {p.name}
                  <span className="type-label">
                    {state.adapters.find((a) => a.type === p.type)?.classes
                      .length === 1
                      ? state.adapters
                          .find((a) => a.type === p.type)
                          ?.classes[0].toUpperCase()
                      : "MULTI-ASSET"}
                  </span>
                </h3>
                <p>
                  {state.adapters.find((a) => a.type === p.type)?.description ??
                    p.type}
                </p>
                {p.feed && (
                  <p className="provider-feed">
                    {state.adapters
                      .find((a) => a.type === p.type)
                      ?.feeds?.find((f) => f.value === p.feed)?.label ?? p.feed}
                  </p>
                )}
                <div className="inline small-text">
                  <Dot
                    good={
                      p.enabled &&
                      ["streaming", "REST"].includes(p.health.status)
                    }
                    warn={p.enabled && !!p.health.error}
                  />
                  <span>{p.health.status}</span>
                  <span className="middot">·</span>
                  <span className="muted">
                    {p.health.lastReceived
                      ? age(p.health.lastReceived)
                      : "Nog niet ontvangen"}
                  </span>
                </div>
                {p.health.error && <p className="warning">{p.health.error}</p>}
                {p.health.instrumentIssues?.map((issue) => (
                  <p className="warning" key={issue.instrumentId}>
                    {issue.error}. Nieuwe poging na {time(issue.retryAt)}.
                    Andere instrumenten blijven actief.
                  </p>
                ))}
                {testResults[p.id] && (
                  <p className="test-result" role="status">
                    {testResults[p.id]}
                  </p>
                )}
              </div>
              <div className="provider-meta">
                <small>Prioriteit</small>
                <strong>{p.priority.toString().padStart(2, "0")}</strong>
              </div>
              <div className="provider-actions">
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() => test(p)}
                >
                  {busy === p.id ? (
                    <RefreshCw size={14} className="spin" />
                  ) : (
                    <Activity size={14} />
                  )}{" "}
                  Test
                </button>
                <button
                  className="icon-button framed"
                  aria-label={`${p.name} bewerken`}
                  onClick={() => {
                    setFormError("");
                    setType(p.type);
                    setFeed(p.feed ?? "iex");
                    setEdit(p);
                  }}
                >
                  <Settings2 size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="provider-lower">
        <section className="panel routing-explainer">
          <div className="panel-title">
            <h2>Van bron naar inzicht</h2>
            <Waypoints size={17} className="muted" />
          </div>
          <div className="routing-steps">
            <span>Provider</span>
            <span>→</span>
            <span>Normalisatie</span>
            <span>→</span>
            <span>Validatie</span>
            <span>→</span>
            <strong>Terminal</strong>
          </div>
          <p>
            Een quote bewaart de bron, handelslocatie, valuta, koerstijd en
            ontvangsttijd. De router kiest een actuele beschikbare bron. Bij
            uitval volgt de volgende geschikte provider.
          </p>
          <p className="muted">
            Er worden geen candles van verschillende bronnen samengevoegd. Een
            bronswitch haalt een nieuwe reeks op. Voor nieuwe feedprotocollen
            komt er een adapter bij; de terminal blijft hetzelfde.
          </p>
        </section>
        <section className="panel">
          <div className="panel-title">
            <h2>Bronwisselingen</h2>
            <span className="count">{state.events.length}</span>
          </div>
          <div className="event-list">
            {state.events.slice(0, 5).map((e, n) => (
              <div key={`${e.at}-${n}`}>
                <span className="mono muted">{time(e.at)}</span>
                <strong>{e.instrument}</strong>
                <span>
                  {state.providers.find((p) => p.id === e.from)?.name ?? e.from}{" "}
                  → {state.providers.find((p) => p.id === e.to)?.name ?? e.to}
                </span>
              </div>
            ))}
            {!state.events.length && (
              <p className="empty-small">
                Nog geen bronwisselingen in deze sessie.
              </p>
            )}
          </div>
        </section>
      </div>
      <div className="provider-footnote">
        <KeyRound size={16} />
        <p>
          OKX, Kraken en Coinbase werken zonder sleutel. Alpaca biedt
          Amerikaanse aandelen, ETF’s en crypto; Twelve Data voegt andere
          markten toe. Dekking en limieten hangen af van de gekozen feed en je
          abonnement.
        </p>
        <a
          href="https://docs.alpaca.markets/us/docs/market-data-faq"
          target="_blank"
          rel="noreferrer"
        >
          Alpaca-feeds <ArrowUpRight size={14} />
        </a>
      </div>
      {edit && (
        <Dialog
          title={
            edit === "new" ? "Databron toevoegen" : `${edit.name} bewerken`
          }
          wide
          className="provider-dialog"
          onClose={() => setEdit(null)}
        >
          <form
            key={type}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const body = {
                type,
                name: f.get("name"),
                priority: Number(f.get("priority")),
                rpm: Number(f.get("rpm")),
                enabled: f.get("enabled") === "on",
                apiKey: f.get("apiKey") || undefined,
                apiSecret: f.get("apiSecret") || undefined,
                feed: adapter?.feeds ? feed : undefined,
                clearKey: f.get("clearKey") === "on",
              };
              setFormError("");
              setBusy("save");
              try {
                await api(
                  edit === "new" ? "/providers" : `/providers/${edit.id}`,
                  edit === "new" ? "POST" : "PUT",
                  body,
                );
                await refresh();
                setEdit(null);
                notify("Databron opgeslagen");
              } catch (e) {
                setFormError((e as Error).message);
              } finally {
                setBusy("");
              }
            }}
          >
            <div className="provider-form-body">
              <div className="form-grid provider-identity">
                <label>
                  Adapter
                  <select
                    name="type"
                    value={type}
                    disabled={edit !== "new"}
                    onChange={(e) => {
                      setType(e.target.value);
                      setFeed(
                        state.adapters.find((a) => a.type === e.target.value)
                          ?.feeds?.[0]?.value ?? "iex",
                      );
                    }}
                  >
                    {state.adapters.map((a) => (
                      <option key={a.type} value={a.type}>
                        {a.name} ·{" "}
                        {a.classes.length > 1 ? "multi-asset" : a.classes[0]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Naam
                  <input
                    name="name"
                    required
                    maxLength={48}
                    defaultValue={edit === "new" ? "" : edit.name}
                    placeholder="Bijvoorbeeld Twelve Data Pro"
                  />
                </label>
              </div>
              {type === "okx" && (
                <p className="muted small-text">
                  Publieke spotmarktdata via OKX Europa. Geen sleutel nodig.
                  EUR- en USDC-paren zijn afzonderlijke instrumenten. Orders
                  plaatsen wordt later toegevoegd.
                </p>
              )}
              {adapter?.keyRequired && (
                <section
                  className="provider-credentials"
                  aria-label="API-sleutels"
                >
                  <div className="form-grid credential-fields">
                    <label>
                      {adapter.keyLabel ?? "API-sleutel"}
                      <input
                        name="apiKey"
                        type="password"
                        autoComplete="new-password"
                        placeholder={
                          edit !== "new" && edit.hasKey
                            ? "•••••••• opgeslagen; leeg laten om te behouden"
                            : "Plak je API-sleutel"
                        }
                        maxLength={512}
                      />
                    </label>
                    {adapter.secretRequired && (
                      <label>
                        Secret Key
                        <input
                          name="apiSecret"
                          type="password"
                          autoComplete="new-password"
                          maxLength={512}
                          placeholder={
                            edit !== "new" && edit.hasKey
                              ? "•••••••• opgeslagen; beide velden leeg laten om te behouden"
                              : "Plak je Secret Key"
                          }
                        />
                      </label>
                    )}
                  </div>
                  {adapter.secretRequired && (
                    <p className="muted small-text">
                      Vul API Key ID én Secret Key in vanuit je Alpaca-account.
                    </p>
                  )}
                  <p className="muted small-text">
                    Sleutels worden alleen lokaal en versleuteld opgeslagen.
                    {edit !== "new" &&
                      edit.hasKey &&
                      " Laat de sleutelvelden leeg om de opgeslagen sleutels te behouden."}
                  </p>
                  {edit !== "new" && edit.hasKey && (
                    <label className="checkbox">
                      <input type="checkbox" name="clearKey" /> Opgeslagen
                      sleutel verwijderen
                    </label>
                  )}
                </section>
              )}
              <div className="form-grid">
                <label>
                  Prioriteit
                  <input
                    name="priority"
                    type="number"
                    min={1}
                    max={1000}
                    defaultValue={edit === "new" ? 30 : edit.priority}
                    required
                  />
                </label>
                <label>
                  Max. REST-aanvragen/min
                  <input
                    name="rpm"
                    type="number"
                    min={1}
                    max={6000}
                    defaultValue={
                      edit === "new"
                        ? adapter?.feeds
                          ? 120
                          : adapter?.keyRequired
                            ? 8
                            : 60
                        : edit.rpm
                    }
                    required
                  />
                </label>
              </div>
              {adapter?.feeds && (
                <>
                  <label>
                    Marktdatafeed
                    <select
                      name="feed"
                      value={feed}
                      onChange={(e) => setFeed(e.target.value)}
                    >
                      {adapter.feeds.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="muted small-text">
                    {adapter.feeds.find((f) => f.value === feed)?.description}
                  </p>
                </>
              )}
              <label className="checkbox">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={edit === "new" ? true : edit.enabled}
                />{" "}
                Databron inschakelen
              </label>
            </div>
            <div className="provider-form-footer">
              {formError && (
                <p className="provider-form-error" role="alert">
                  {formError}
                </p>
              )}
              <div className="dialog-actions">
                {edit !== "new" && (
                  <button
                    type="button"
                    className="button danger"
                    disabled={!!busy}
                    onClick={async () => {
                      setBusy("delete");
                      try {
                        await api(`/providers/${edit.id}`, "DELETE");
                        await refresh();
                        setEdit(null);
                      } catch (e) {
                        notify((e as Error).message);
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    <Trash2 size={14} /> Verwijderen
                  </button>
                )}
                <button
                  type="submit"
                  className="button primary"
                  disabled={!!busy}
                >
                  <Check size={15} /> Opslaan
                </button>
              </div>
            </div>
          </form>
        </Dialog>
      )}
    </main>
  );
}
