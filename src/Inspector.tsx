import { ArrowUpRight, Info } from "lucide-react";
import { age, price, time, stamp } from "./api";
import type { Instrument, Quote, State } from "./types";
import { Dot } from "./ui";
export default function Inspector({
  instrument: i,
  quote: q,
  state,
}: {
  instrument: Instrument;
  quote: Quote | null;
  state: State;
}) {
  const rows = state.comparisons[i.id] ?? [];
  const fresh = rows.filter((r) => !r.stale);
  const reference =
    fresh.find((r) => r.providerId === q?.providerId) ?? fresh[0];
  const spread = q?.bid != null && q?.ask != null ? q.ask - q.bid : null;
  return (
    <aside className="inspector">
      <section className="panel">
        <div className="panel-title">
          <h2>Marktoverzicht</h2>
          <ArrowUpRight size={16} className="muted" />
        </div>
        <div className="overview-body">
          <div className="stat-lead">
            <span>
              Laatste prijs <small>{i.currency}</small>
            </span>
            <strong>{price(q?.price, q && q.price < 1 ? 4 : 2)}</strong>
          </div>
          {q?.high != null && q?.low != null && (
            <div className="daily-range">
              <div>
                <span>Dagbereik</span>
                <span>
                  {q.marketOpen === false
                    ? "Markt gesloten"
                    : "24 uur / sessie"}
                </span>
              </div>
              <div className="range-track">
                <span
                  style={{
                    left: `${Math.max(0, Math.min(100, ((q.price - q.low) / (q.high - q.low || 1)) * 100))}%`,
                  }}
                />
              </div>
              <div className="mono">
                <span>{price(q.low)}</span>
                <span>{price(q.high)}</span>
              </div>
            </div>
          )}
          <dl>
            {[
              ["Hoog", price(q?.high)],
              ["Laag", price(q?.low)],
              [
                i.assetClass === "crypto"
                  ? `Volume (${i.base ?? i.symbol.split("/")[0]})`
                  : "Volume",
                q?.volume == null
                  ? "—"
                  : Intl.NumberFormat("en-US", {
                      notation: "compact",
                      maximumFractionDigits: 2,
                    }).format(q.volume),
              ],
              ["Bid", price(q?.bid)],
              ["Ask", price(q?.ask)],
              ["Spread", price(spread, 4)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="source-detail">
            <span>
              <Dot good={!!q && !q.stale} warn={!!q?.stale} />
              {q?.venue ?? "Geen bron"}
            </span>
            <span>{q?.transport ?? "—"}</span>
          </div>
          <div className="freshness">
            <span>Ontvangen</span>
            <strong>{age(q?.receivedAt)}</strong>
            <span>
              {q?.timeliness === "entitlement" ? "Laatste minuut" : "Koerstijd"}
            </span>
            <strong>
              {q?.sourceAt ? stamp(q.sourceAt) : "Niet aangeleverd"}
            </strong>
          </div>
          {q?.timeliness === "entitlement" && (
            <p className="data-note">
              <Info size={13} /> Vertraging en beursrechten hangen af van je
              abonnement.
            </p>
          )}
        </div>
      </section>
      <section className="panel comparison">
        <div className="panel-title">
          <h2>Bronvergelijking</h2>
          <span className="count">{rows.length}</span>
        </div>
        <div className="compare-heading">
          <span>Bron / venue</span>
          <span>Prijs · {i.currency}</span>
        </div>
        {rows.map((r) => (
          <div className="compare-row" key={r.providerId}>
            <div>
              <strong>
                <Dot good={!r.stale} warn={r.stale} />
                {r.provider}
              </strong>
              <small>
                {r.venue} ·{" "}
                {r.stale ? "verouderd" : age(r.sourceAt ?? r.receivedAt)}
              </small>
            </div>
            <div>
              <strong className="mono">
                {price(r.price, r.price < 1 ? 4 : 2)}
              </strong>
              <small className={r.stale ? "warning" : "muted"}>
                {r.stale
                  ? "Niet vergelijkbaar"
                  : reference?.providerId === r.providerId
                    ? "Referentie"
                    : reference
                      ? `Δ ${price(r.price - reference.price, 4)}`
                      : "—"}
              </small>
            </div>
          </div>
        ))}
        {!rows.length && (
          <div className="empty-small">
            Nog geen offertes voor dit instrument.
          </div>
        )}
        <p className="comparison-note">
          <Info size={13} />{" "}
          {i.assetClass === "crypto"
            ? "Verschillende handelsplatformen en tijdstippen. Prijsverschillen zijn geen meetfout."
            : "Vergelijk dezelfde beurs, valuta en koerstijd. Feedrechten bepalen beschikbaarheid en vertraging."}
        </p>
      </section>
    </aside>
  );
}
export function ProviderTable({
  state,
  onManage,
}: {
  state: State;
  onManage: () => void;
}) {
  return (
    <section className="panel quality">
      <div className="panel-title">
        <div className="inline">
          <h2>Datakwaliteit</h2>
          <span className="muted small-text">Bronstatus & ontvangst</span>
        </div>
        <button className="text-button" onClick={onManage}>
          Beheer bronnen <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Databron</th>
              <th>Markten</th>
              <th>Status</th>
              <th>Laatst ontvangen</th>
              <th>REST-responstijd</th>
              <th>Aanvragen / min</th>
              <th>Prioriteit</th>
            </tr>
          </thead>
          <tbody>
            {state.providers.map((p) => (
              <tr key={p.id}>
                <td>
                  <span className={`provider-logo ${p.type}`}>
                    {p.name.slice(0, 1)}
                  </span>
                  <strong>{p.name}</strong>
                </td>
                <td className="muted">
                  {state.adapters.find((a) => a.type === p.type)?.classes
                    .length === 1
                    ? state.adapters.find((a) => a.type === p.type)?.classes[0]
                    : "Multi-asset"}
                </td>
                <td>
                  <span className="inline">
                    <Dot
                      good={
                        p.enabled &&
                        ["streaming", "REST"].includes(p.health.status)
                      }
                      warn={p.enabled && !!p.health.error}
                    />
                    {p.health.status}
                  </span>
                </td>
                <td className="mono muted">{time(p.health.lastReceived)}</td>
                <td className="mono">
                  {p.health.latencyMs == null
                    ? "—"
                    : `${p.health.latencyMs} ms`}
                </td>
                <td className="mono muted">
                  {p.health.usedThisMinute} / {p.rpm}
                </td>
                <td>
                  <span className="priority">{p.priority}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
