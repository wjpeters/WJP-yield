import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
} from "lightweight-charts";
import {
  CandlestickChart,
  ChartNoAxesCombined,
  Maximize2,
  Minus,
  RefreshCw,
  Trash2,
  Database,
  Star,
} from "lucide-react";
import { api, price, percent, time } from "./api";
import { sma, ema, rsi } from "./indicators";
import { Dot, SymbolMark } from "./ui";
import type { Instrument, Quote, Candle, History } from "./types";
type Props = {
  instrument: Instrument;
  quote: Quote | null;
  onProviders: () => void;
  connected: boolean;
};
export default function ChartPanel({
  instrument: i,
  quote: q,
  onProviders,
  connected,
}: Props) {
  const [interval, setIntervalValue] = useState(() => {
    const v = localStorage.getItem("yield-interval");
    return ["1m", "5m", "15m", "1h", "1d"].includes(v ?? "") ? v! : "1h";
  });
  const [mode, setMode] = useState<"candles" | "line">(() =>
    localStorage.getItem("yield-chart") === "line" ? "line" : "candles",
  );
  const [indicators, setIndicators] = useState(() => {
    const v = localStorage.getItem("yield-indicators");
    return v === null
      ? ["sma"]
      : v.split(",").filter((i) => ["sma", "ema", "rsi"].includes(i));
  });
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [hover, setHover] = useState<Candle | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [levels, setLevels] = useState(0);
  const host = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLElement>(null),
    chart = useRef<IChartApi | null>(null),
    main = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null),
    volume = useRef<ISeriesApi<"Histogram"> | null>(null),
    lines = useRef<Record<string, ISeriesApi<"Line">>>({}),
    priceLine = useRef<IPriceLine | null>(null),
    drawn = useRef<IPriceLine[]>([]),
    drawingRef = useRef(false),
    dataRef = useRef<Candle[]>([]),
    fitKey = useRef("");
  drawingRef.current = drawing;
  dataRef.current = history?.candles ?? [];
  useEffect(() => {
    localStorage.setItem("yield-interval", interval);
    localStorage.setItem("yield-chart", mode);
    localStorage.setItem("yield-indicators", indicators.join(","));
  }, [interval, mode, indicators]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setHistory(null);
    setError("");
    setLoading(true);
    fitKey.current = "";
    const fetchHistory = async () => {
      try {
        const result = await api<History>(
          `/candles?instrument=${encodeURIComponent(i.id)}&interval=${interval}${q?.providerId ? `&provider=${q.providerId}` : ""}`,
          "GET",
          undefined,
          controller.signal,
        );
        if (active) {
          setHistory(result);
          setError("");
        }
      } catch (e) {
        if (active && (e as Error).name !== "AbortError")
          setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchHistory();
    const timer = setInterval(fetchHistory, 30000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [i.id, interval, q?.providerId, retry]);
  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0e131c" },
        textColor: "#8490a5",
        fontFamily: "Inter, sans-serif",
        fontSize: 11,
        attributionLogo: true,
        panes: { separatorColor: "#242a36", separatorHoverColor: "#394351" },
      },
      grid: {
        vertLines: { color: "#1b222e" },
        horzLines: { color: "#1b222e" },
      },
      crosshair: {
        vertLine: { color: "#667383", labelBackgroundColor: "#303b49" },
        horzLine: { color: "#667383", labelBackgroundColor: "#303b49" },
      },
      rightPriceScale: {
        borderColor: "#242a36",
        scaleMargins: { top: 0.1, bottom: 0.24 },
      },
      timeScale: {
        borderColor: "#242a36",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
      },
      localization: { locale: "en-US" },
      handleScroll: true,
      handleScale: true,
    });
    chart.current = c;
    const series =
      mode === "candles"
        ? c.addSeries(CandlestickSeries, {
            upColor: "#57c9ad",
            downColor: "#ef7c85",
            borderVisible: false,
            wickUpColor: "#57c9ad",
            wickDownColor: "#ef7c85",
            priceLineVisible: false,
          })
        : c.addSeries(LineSeries, {
            color: "#d4f77d",
            lineWidth: 2,
            priceLineVisible: false,
          });
    main.current = series;
    const v = c.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    v.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    volume.current = v;
    lines.current = {};
    if (indicators.includes("sma"))
      lines.current.sma = c.addSeries(LineSeries, {
        color: "#e1c276",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    if (indicators.includes("ema"))
      lines.current.ema = c.addSeries(LineSeries, {
        color: "#8aacf2",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    if (indicators.includes("rsi")) {
      lines.current.rsi = c.addSeries(
        LineSeries,
        {
          color: "#bd9dec",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
        },
        1,
      );
      lines.current.rsi.createPriceLine({
        price: 70,
        color: "#444358",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: "",
      });
      lines.current.rsi.createPriceLine({
        price: 30,
        color: "#444358",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: "",
      });
      c.panes()[1].setHeight(100);
    }
    c.subscribeCrosshairMove((e) => {
      const candle = dataRef.current.find((d) => d.time === e.time);
      setHover(candle ?? null);
    });
    c.subscribeClick((e) => {
      if (!drawingRef.current || !e.point) return;
      const value = series.coordinateToPrice(e.point.y);
      if (value == null) return;
      drawn.current.push(
        series.createPriceLine({
          price: value,
          color: "#d4f77d",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "Niveau",
        }),
      );
      setLevels(drawn.current.length);
      setDrawing(false);
    });
    fitKey.current = "";
    priceLine.current = null;
    drawn.current = [];
    setLevels(0);
    return () => {
      c.remove();
      chart.current = null;
      main.current = null;
    };
  }, [mode, indicators]);
  useEffect(() => {
    if (!history || !main.current || !volume.current) return;
    const candles = history.candles;
    const digits = (candles.at(-1)?.close ?? 1) < 1 ? 4 : 2;
    main.current.applyOptions({
      priceFormat: { type: "price", precision: digits, minMove: 10 ** -digits },
    });
    if (mode === "candles")
      (main.current as ISeriesApi<"Candlestick">).setData(
        candles.map((c) => ({ ...c, time: c.time as Time })),
      );
    else
      (main.current as ISeriesApi<"Line">).setData(
        candles.map((c) => ({ time: c.time as Time, value: c.close })),
      );
    volume.current.setData(
      candles
        .filter((c) => c.volume != null)
        .map((c) => ({
          time: c.time as Time,
          value: c.volume!,
          color: c.close >= c.open ? "#57c9ad35" : "#ef7c8535",
        })),
    );
    for (const [name, series] of Object.entries(lines.current)) {
      const values =
        name === "sma"
          ? sma(candles, 20)
          : name === "ema"
            ? ema(candles, 50)
            : rsi(candles);
      series.setData(values.map((v) => ({ ...v, time: v.time as Time })));
    }
    const key = `${i.id}:${interval}`;
    if (fitKey.current !== key) {
      chart.current?.timeScale().setVisibleLogicalRange({
        from: Math.max(0, candles.length - 100),
        to: candles.length + 4,
      });
      fitKey.current = key;
    }
  }, [history, mode, indicators, i.id, interval]);
  useEffect(() => {
    if (!main.current || !q || history?.providerId !== q.providerId) return;
    if (!priceLine.current)
      priceLine.current = main.current.createPriceLine({
        price: q.price,
        color: "#d4f77d",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: "",
      });
    else
      priceLine.current.applyOptions({
        price: q.price,
        color: q.stale ? "#8490a5" : "#d4f77d",
      });
  }, [q, history, mode, indicators]);
  useEffect(() => {
    if (main.current) {
      drawn.current.forEach((l) => main.current!.removePriceLine(l));
      drawn.current = [];
      setLevels(0);
    }
    setHover(null);
  }, [i.id, interval]);
  const candle = hover ?? history?.candles.at(-1);
  const change = q?.changePct;
  return (
    <section ref={panel} className="chart-panel panel">
      <div className="instrument-header">
        <div className="instrument-title">
          <SymbolMark symbol={i.symbol} />
          <div>
            <h1>
              {i.name}
              <span className="title-currency"> / {i.currency}</span>
            </h1>
            <div className="muted">
              {i.symbol} <span className="middot">·</span>{" "}
              {i.exchange === "MULTI" ? "Crypto spot" : i.exchange}
            </div>
          </div>
          <Star size={17} className="muted star" />
        </div>
        <div className="headline-price">
          <strong>{price(q?.price, q && q.price < 1 ? 4 : 2)}</strong>
          <span
            className={
              change == null ? "muted" : change >= 0 ? "positive" : "negative"
            }
          >
            {percent(change)}
          </span>
          <small>
            <Dot good={!!q && !q.stale && connected} warn={!!q?.stale} />
            {q
              ? `${q.provider} · ${!connected ? "Verbinding verbroken" : q.marketOpen === false ? "Markt gesloten" : q.stale ? "Verouderd" : q.timeliness === "entitlement" ? "Rechtenafhankelijk" : q.transport === "WebSocket" ? "Streaming" : "REST"}`
              : "Databron nodig"}
          </small>
        </div>
      </div>
      <div className="chart-toolbar">
        <div className="timeframes">
          {[
            ["1m", "1m"],
            ["5m", "5m"],
            ["15m", "15m"],
            ["1h", "1u"],
            ["1d", "1D"],
          ].map(([v, label]) => (
            <button
              key={v}
              className={interval === v ? "active" : ""}
              onClick={() => setIntervalValue(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="divider" />
        <button
          title="Candlesticks"
          aria-label="Candlesticks"
          className={`icon-button ${mode === "candles" ? "selected-tool" : ""}`}
          onClick={() => setMode("candles")}
        >
          <CandlestickChart size={18} />
        </button>
        <button
          title="Lijngrafiek"
          aria-label="Lijngrafiek"
          className={`icon-button ${mode === "line" ? "selected-tool" : ""}`}
          onClick={() => setMode("line")}
        >
          <ChartNoAxesCombined size={18} />
        </button>
        <span className="divider" />
        <div className="indicator-controls">
          {[
            ["sma", "SMA 20"],
            ["ema", "EMA 50"],
            ["rsi", "RSI 14"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={`${indicators.includes(id) ? `indicator-${id} active` : ""}`}
              aria-pressed={indicators.includes(id)}
              onClick={() =>
                setIndicators((a) =>
                  a.includes(id) ? a.filter((x) => x !== id) : [...a, id],
                )
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar-end">
          <button
            className={`icon-button ${drawing ? "selected-tool" : ""}`}
            onClick={() => setDrawing(!drawing)}
            aria-label="Horizontaal prijsniveau tekenen"
            title="Klik daarna in de grafiek om een prijsniveau te plaatsen"
          >
            <Minus size={18} />
          </button>
          {levels > 0 && (
            <button
              className="icon-button"
              aria-label="Prijsniveaus wissen"
              onClick={() => {
                drawn.current.forEach((l) => main.current?.removePriceLine(l));
                drawn.current = [];
                setLevels(0);
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Grafiek passend maken"
            title="Grafiek passend maken"
            onClick={() => chart.current?.timeScale().fitContent()}
          >
            <Maximize2 size={16} />
          </button>
        </div>
      </div>
      <div className="ohlc-row">
        {candle ? (
          <>
            <span className="muted">
              {hover ? "Inspectie" : "Laatste candle"}
            </span>
            {(["open", "high", "low", "close"] as const).map((k, index) => (
              <span key={k}>
                <i>{["O", "H", "L", "C"][index]}</i>{" "}
                {price(candle[k], candle.close < 1 ? 4 : 2)}
              </span>
            ))}
          </>
        ) : (
          <span className="muted">
            {loading ? "Markthistorie ophalen…" : "Geen markthistorie"}
          </span>
        )}
        {history && q && history.providerId !== q.providerId && (
          <span className="warning">
            Grafiek: {history.provider} · fallback
          </span>
        )}
        {drawing && (
          <span className="positive">Klik om een niveau te plaatsen</span>
        )}
      </div>
      <div className="chart-canvas-wrap">
        <div ref={host} className="chart-canvas" />
        {(!history || !history.candles.length) && (
          <div className="chart-overlay">
            <div className="empty-icon">
              {loading ? (
                <RefreshCw className="spin" size={25} />
              ) : (
                <Database size={26} />
              )}
            </div>
            <h3>
              {loading ? "Marktdata ophalen" : "Nog geen grafiek beschikbaar"}
            </h3>
            <p>
              {loading
                ? "Historische candles rechtstreeks uit de databron."
                : error}
            </p>
            {!loading && (
              <div className="inline">
                <button
                  className="button"
                  onClick={() => setRetry((n) => n + 1)}
                >
                  Opnieuw proberen
                </button>
                <button className="button primary" onClick={onProviders}>
                  Databronnen beheren
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="chart-caption">
        <span>
          {history
            ? `${history.provider} · ${history.venue} · Candles via REST · 30s`
            : "Historische candles"}{" "}
          {history && time(history.fetchedAt)}
        </span>
        <span>
          {error && history
            ? "Vernieuwen mislukt · vorige candles zichtbaar"
            : history?.failures.length
              ? "Historie via fallback"
              : "Tijden in UTC"}{" "}
          <a
            href="https://www.tradingview.com/"
            target="_blank"
            rel="noreferrer"
          >
            TradingView
          </a>
        </span>
      </div>
    </section>
  );
}
