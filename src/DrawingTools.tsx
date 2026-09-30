import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IChartApi, ISeriesApi, Logical } from "lightweight-charts";
import {
  MousePointer2,
  Minus,
  MoveUpRight,
  RectangleHorizontal,
  ListFilter,
  Undo2,
  Trash2,
  Eye,
  EyeOff,
  Check,
  LoaderCircle,
} from "lucide-react";
import { api, price } from "./api";
import {
  drawingNames,
  fibLevels,
  fibPrice,
  logicalToTime,
  timeToLogical,
  type Anchor,
  type Drawing,
  type DrawingKind,
} from "./drawings";
import type { Candle } from "./types";
export type DrawingChart = {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;
  alive: boolean;
};
type Frame = {
  x: number;
  dx: number;
  y: number;
  dy: number;
  base: number;
  width: number;
  height: number;
};
type Change = { before?: Drawing; after?: Drawing };
import { timeframes } from "./timeframes";
const palette = ["#d4f77d", "#57c9ad", "#8aacf2", "#bd9dec", "#ef7c85"];
const colors = ["Limoen", "Groen", "Blauw", "Paars", "Roze"];
const steps: Record<string, number> = Object.fromEntries(
  timeframes.map((f) => [f.value, f.step]),
);
const tools = [
  ["horizontal", Minus],
  ["trend", MoveUpRight],
  ["rectangle", RectangleHorizontal],
  ["fib", ListFilter],
] as const;
export default function DrawingTools({
  instrument,
  context,
  candles,
  interval,
  target,
}: {
  instrument: string;
  context: DrawingChart;
  candles: Candle[];
  interval: string;
  target: HTMLDivElement;
}) {
  const [items, setItems] = useState<Drawing[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [tool, setTool] = useState<DrawingKind | null>(null);
  const [color, setColor] = useState(palette[0]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [undo, setUndo] = useState<Change[]>([]);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    original: Drawing;
    index: number | null;
    start: Anchor;
  } | null>(null);
  const draftRef = useRef<Drawing | null>(null);
  const busy = useRef(false);
  const times = useMemo(() => candles.map((c) => c.time), [candles]);
  const step = steps[interval];
  const active = loaded && !!candles.length && !saving;
  const current = items.find((d) => d.id === selected);
  draftRef.current = draft;
  useEffect(() => {
    const controller = new AbortController();
    api<Drawing[]>(
      `/drawings/${encodeURIComponent(instrument)}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((d) => {
        setItems(d);
        setLoaded(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setError(
            "Tekeningen laden mislukt. Herlaad de pagina om opnieuw te proberen.",
          );
      });
    return () => controller.abort();
  }, [instrument]);
  useEffect(() => {
    setDraft(null);
    setTool(null);
    drag.current = null;
  }, [context, interval]);
  // The chart has no price-scale change event. Sample its transform, not each drawing,
  // so price scaling, live autoscaling, pane resizing and panning remain synchronized.
  useEffect(() => {
    let raf = 0;
    let previous = "";
    const update = () => {
      if (!context.alive) return;
      const { chart, series } = context;
      const x = chart.timeScale().logicalToCoordinate(0 as Logical);
      const x1 = chart.timeScale().logicalToCoordinate(1 as Logical);
      const base = candles.at(-1)?.close ?? 1;
      const unit = Math.max(Math.abs(base) * 0.01, 0.01);
      const y = series.priceToCoordinate(base),
        y1 = series.priceToCoordinate(base + unit);
      const { width, height } = chart.paneSize(0);
      if (x !== null && x1 !== null && y !== null && y1 !== null) {
        const next = {
          x,
          dx: x1 - x,
          y,
          dy: (y1 - y) / unit,
          base,
          width,
          height,
        };
        const signature = JSON.stringify(next);
        if (previous !== signature) {
          setFrame(next);
          previous = signature;
        }
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [context, candles]);
  const apply = (change: Change) =>
    setItems((old) => {
      const id = (change.after ?? change.before)!.id;
      const rest = old.filter((d) => d.id !== id);
      return change.after ? [...rest, change.after] : rest;
    });
  const persist = async (change: Change, isUndo = false) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError("");
    apply(change);
    setDraft(null);
    const id = (change.after ?? change.before)!.id;
    try {
      await api(
        `/drawings/${encodeURIComponent(instrument)}/${id}`,
        change.after ? "PUT" : "DELETE",
        change.after,
      );
      setUndo((old) =>
        isUndo ? old.slice(0, -1) : [...old.slice(-29), change],
      );
    } catch {
      apply({ before: change.after, after: change.before });
      setError(
        "Opslaan mislukt. De wijziging is teruggedraaid; probeer opnieuw.",
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const cancel = () => {
    setTool(null);
    setDraft(null);
    drag.current = null;
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          "input, textarea, select, [contenteditable=true]",
        )
      )
        return;
      if (e.key === "Escape") {
        cancel();
        setSelected(null);
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        current &&
        !saving &&
        document.activeElement?.closest(".chart-panel")
      ) {
        e.preventDefault();
        void persist({ before: current });
        setSelected(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const point = (e: React.PointerEvent): Anchor | null => {
    if (!frame || !svg.current || !frame.dx || !frame.dy) return null;
    const rect = svg.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(frame.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(frame.height, e.clientY - rect.top));
    const time = logicalToTime((x - frame.x) / frame.dx, times, step);
    const value = frame.base + (y - frame.y) / frame.dy;
    return time > 0 && Number.isFinite(value) ? { time, price: value } : null;
  };
  const xy = (a: Anchor) => ({
    x: frame!.x + timeToLogical(a.time, times, step) * frame!.dx,
    y: frame!.y + (a.price - frame!.base) * frame!.dy,
  });
  const startDrag = (
    e: React.PointerEvent,
    d: Drawing,
    index: number | null,
  ) => {
    if (!active || tool || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const anchor = point(e);
    if (!anchor) return;
    setSelected(d.id);
    setDraft(d);
    drag.current = { original: d, index, start: anchor };
    svg.current?.focus();
    svg.current?.setPointerCapture(e.pointerId);
  };
  const renderDrawing = (d: Drawing, preview = false) => {
    const a = xy(d.points[0]),
      b = xy(d.points[1] ?? d.points[0]);
    const isSelected = d.id === selected;
    const left = Math.min(a.x, b.x),
      right = Math.max(a.x, b.x),
      top = Math.min(a.y, b.y),
      bottom = Math.max(a.y, b.y);
    const line = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      key?: string,
    ) => <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} />;
    const geometry =
      d.kind === "horizontal" ? (
        line(0, a.y, frame!.width, a.y)
      ) : d.kind === "trend" ? (
        line(a.x, a.y, b.x, b.y)
      ) : d.kind === "rectangle" ? (
        <rect x={left} y={top} width={right - left} height={bottom - top} />
      ) : (
        fibLevels.map((level) => {
          const y = b.y + (a.y - b.y) * level;
          return (
            <g key={level}>
              {line(left, y, right, y)}
              <text x={left + 5} y={y - 5} fill={d.color} stroke="none">
                {(level * 100).toFixed(1)}% ·{" "}
                {price(fibPrice(d.points[0].price, d.points[1].price, level))}
              </text>
            </g>
          );
        })
      );
    return (
      <g
        key={d.id}
        data-drawing-id={d.id}
        data-drawing-kind={d.kind}
        aria-label={drawingNames[d.kind]}
      >
        <g
          stroke={d.color}
          strokeWidth={isSelected ? 2 : 1.4}
          fill={d.kind === "rectangle" ? `${d.color}12` : "none"}
          pointerEvents="none"
          strokeDasharray={preview && !drag.current ? "5 4" : undefined}
        >
          {geometry}
        </g>
        {d.kind === "horizontal" && (
          <text
            x={frame!.width - 8}
            y={a.y - 6}
            textAnchor="end"
            fill={d.color}
            pointerEvents="none"
          >
            {price(d.points[0].price, Math.abs(d.points[0].price) < 1 ? 4 : 2)}
          </text>
        )}
        {!preview && (
          <g
            className="drawing-hit"
            stroke="transparent"
            strokeWidth={14}
            fill="none"
            style={{ pointerEvents: tool || !active ? "none" : "stroke" }}
            onPointerDown={(e) => startDrag(e, d, null)}
          >
            {geometry}
          </g>
        )}
        {isSelected &&
          !tool &&
          d.points.map((_, index) => {
            const p = index === 0 ? a : b;
            const x =
              d.kind === "horizontal"
                ? Math.min(frame!.width - 16, Math.max(16, p.x))
                : p.x;
            return (
              <circle
                key={index}
                aria-label={`Ankerpunt ${index + 1}`}
                cx={x}
                cy={p.y}
                r={6}
                fill="#0e131c"
                stroke={d.color}
                strokeWidth={2}
                style={{
                  pointerEvents: active ? "all" : "none",
                  cursor: "grab",
                }}
                onPointerDown={(e) => startDrag(e, d, index)}
              />
            );
          })}
      </g>
    );
  };
  const hint = tool
    ? tool === "horizontal"
      ? "Klik op een prijsniveau · Esc annuleert"
      : draft
        ? "Klik op het eindpunt · Esc annuleert"
        : "Klik op het beginpunt · Esc annuleert"
    : current
      ? "Sleep de tekening of een ankerpunt · Delete verwijdert"
      : "Selecteer een tekentool of klik op een tekening";
  return (
    <>
      <div className="drawing-toolbar" role="toolbar" aria-label="Tekentools">
        <button
          className={`icon-button ${!tool ? "selected-tool" : ""}`}
          aria-label="Selecteren en verplaatsen"
          title="Selecteren en verplaatsen (Esc)"
          aria-pressed={!tool}
          onClick={cancel}
        >
          <MousePointer2 size={16} />
        </button>
        {tools.map(([kind, Icon]) => (
          <button
            key={kind}
            disabled={!active || items.length >= 100}
            className={`icon-button ${tool === kind ? "selected-tool" : ""}`}
            aria-label={`${drawingNames[kind]} tekenen`}
            title={drawingNames[kind]}
            aria-pressed={tool === kind}
            onClick={() => {
              setTool(tool === kind ? null : kind);
              setDraft(null);
              setSelected(null);
              setHidden(false);
            }}
          >
            <Icon size={17} />
          </button>
        ))}
        <span className="divider" />
        <label className="drawing-color" title="Tekenkleur">
          <span className="sr-only">Tekenkleur</span>
          <select
            aria-label="Tekenkleur"
            disabled={saving}
            value={current?.color ?? color}
            style={{ color: current?.color ?? color }}
            onChange={(e) => {
              setColor(e.target.value);
              if (current)
                void persist({
                  before: current,
                  after: { ...current, color: e.target.value },
                });
            }}
          >
            {palette.map((c, ix) => (
              <option key={c} value={c}>
                {colors[ix]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="icon-button"
          disabled={!undo.length || saving}
          aria-label="Tekening ongedaan maken"
          title="Laatste tekenbewerking ongedaan maken"
          onClick={() => {
            const last = undo.at(-1)!;
            cancel();
            setSelected(null);
            void persist({ before: last.after, after: last.before }, true);
          }}
        >
          <Undo2 size={16} />
        </button>
        <button
          className="icon-button"
          disabled={!current || saving}
          aria-label="Geselecteerde tekening verwijderen"
          title="Geselecteerde tekening verwijderen (Delete)"
          onClick={() => {
            if (current) void persist({ before: current });
            setSelected(null);
          }}
        >
          <Trash2 size={15} />
        </button>
        <button
          className="icon-button"
          disabled={!items.length}
          aria-label={hidden ? "Tekeningen tonen" : "Tekeningen verbergen"}
          title={hidden ? "Tekeningen tonen" : "Tekeningen verbergen"}
          aria-pressed={hidden}
          onClick={() => {
            cancel();
            setSelected(null);
            setHidden(!hidden);
          }}
        >
          {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <select
          className="drawing-picker"
          aria-label="Tekening selecteren"
          value={selected ?? ""}
          disabled={!items.length || saving}
          onChange={(e) => {
            cancel();
            setHidden(false);
            setSelected(e.target.value || null);
          }}
        >
          <option value="">{items.length} tekeningen</option>
          {items.map((d, ix) => (
            <option key={d.id} value={d.id}>
              {ix + 1}. {drawingNames[d.kind]}
            </option>
          ))}
        </select>
        <span className="drawing-save" role="status">
          {saving ? (
            <>
              <LoaderCircle size={12} className="spin" />
              Opslaan
            </>
          ) : loaded ? (
            <>
              <Check size={12} />
              Lokaal
            </>
          ) : (
            "Laden…"
          )}
        </span>
      </div>
      <div
        className={`drawing-instructions ${error ? "negative" : "muted"}`}
        role={error ? "alert" : undefined}
      >
        {error ||
          (items.length >= 100
            ? "Limiet van 100 tekeningen bereikt. Verwijder een tekening om ruimte te maken."
            : hint)}
      </div>
      {frame &&
        !!candles.length &&
        createPortal(
          <svg
            ref={svg}
            className="drawing-overlay"
            width={frame.width}
            height={frame.height}
            tabIndex={0}
            aria-label="Tekenlaag op de prijsgrafiek"
            style={{
              pointerEvents: tool && active ? "all" : "none",
              cursor: tool ? "crosshair" : undefined,
              touchAction: "none",
            }}
            onPointerDown={(e) => {
              if (!active || !tool || e.button !== 0) return;
              const a = point(e);
              if (!a) return;
              svg.current?.focus();
              if (tool === "horizontal") {
                const d: Drawing = {
                  id: crypto.randomUUID(),
                  kind: tool,
                  color,
                  points: [a],
                };
                void persist({ after: d });
                setSelected(d.id);
                setTool(null);
              } else if (!draft)
                setDraft({
                  id: crypto.randomUUID(),
                  kind: tool,
                  color,
                  points: [a, a],
                });
              else {
                const first = xy(draft.points[0]),
                  end = xy(a);
                if (Math.hypot(first.x - end.x, first.y - end.y) < 4) return;
                const d = { ...draft, points: [draft.points[0], a] };
                void persist({ after: d });
                setSelected(d.id);
                setTool(null);
              }
            }}
            onPointerMove={(e) => {
              const a = point(e);
              if (!a) return;
              if (drag.current) {
                const { original, index, start } = drag.current;
                setDraft({
                  ...original,
                  points: original.points.map((p, ix) =>
                    index === null
                      ? {
                          time: p.time + a.time - start.time,
                          price: p.price + a.price - start.price,
                        }
                      : ix === index
                        ? a
                        : p,
                  ),
                });
              } else if (tool && draft)
                setDraft({ ...draft, points: [draft.points[0], a] });
            }}
            onPointerUp={(e) => {
              const moving = drag.current;
              drag.current = null;
              if (svg.current?.hasPointerCapture(e.pointerId))
                svg.current.releasePointerCapture(e.pointerId);
              if (
                moving &&
                draftRef.current &&
                JSON.stringify(moving.original.points) !==
                  JSON.stringify(draftRef.current.points)
              )
                void persist({
                  before: moving.original,
                  after: draftRef.current,
                });
              else if (moving) setDraft(null);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDraft(null);
            }}
          >
            {!hidden &&
              items
                .filter((d) => d.id !== draft?.id)
                .map((d) => renderDrawing(d))}
            {!hidden && draft && renderDrawing(draft, true)}
          </svg>,
          target,
        )}
    </>
  );
}
