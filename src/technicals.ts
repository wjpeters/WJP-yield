import type { Candle } from "./types";
import { sma, ema, rsi } from "./indicators.ts";

export const ratings = [
  "Strong Sell",
  "Sell",
  "Neutral",
  "Buy",
  "Strong Buy",
] as const;
export type Signal = {
  name: string;
  value: number | null;
  vote: number | null;
  rule: string;
};
const last = (rows: { value: number }[]) => rows.at(-1)?.value ?? null;
const compare = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(Math.abs(b) * 0.001, 1e-10) ? 0 : a > b ? 1 : -1;

export function technicals(
  candles: Candle[],
  interval: string,
  now = Date.now(),
) {
  const seconds: Record<string, number> = {
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
    "1w": 604800,
  };
  const data = candles.filter(
    (c) =>
      !c.partial &&
      c.confirmed !== false &&
      c.time + (seconds[interval] ?? 86400) <= now / 1000,
  );
  const close = data.at(-1)?.close;
  const signals: Signal[] = [];
  for (const [name, period, method] of [
    ["SMA 20", 20, sma],
    ["SMA 50", 50, sma],
    ["SMA 200", 200, sma],
    ["EMA 20", 20, ema],
    ["EMA 50", 50, ema],
  ] as const) {
    const value = last(method(data, period));
    signals.push({
      name,
      value,
      vote: value == null || close == null ? null : compare(close, value),
      rule: "Close boven/onder gemiddelde; ±0,1% is neutraal.",
    });
  }
  const strength = last(rsi(data));
  signals.push({
    name: "RSI 14",
    value: strength,
    vote: strength == null ? null : strength < 30 ? 1 : strength > 70 ? -1 : 0,
    rule: "Onder 30: Buy. Boven 70: Sell. Daartussen: Neutral.",
  });
  const fast = ema(data, 12),
    slow = ema(data, 26);
  const fastByTime = new Map(fast.map((p) => [p.time, p.value]));
  const macd = slow.map((p) => ({
    ...p,
    value: (fastByTime.get(p.time) ?? p.value) - p.value,
  }));
  const macdSignal = last(
    ema(
      macd.map((p) => ({
        time: p.time,
        open: p.value,
        high: p.value,
        low: p.value,
        close: p.value,
        volume: null,
      })),
      9,
    ),
  );
  const histogram = macdSignal == null ? null : macd.at(-1)!.value - macdSignal;
  signals.push({
    name: "MACD 12/26/9",
    value: histogram,
    vote:
      histogram == null
        ? null
        : Math.abs(histogram) <= Math.max((close ?? 0) * 0.0001, 1e-10)
          ? 0
          : Math.sign(histogram),
    rule: "MACD boven/onder signaallijn; histogram ±0,01% van close is neutraal.",
  });
  const range = data.slice(-14);
  const high = Math.max(...range.map((c) => c.high)),
    low = Math.min(...range.map((c) => c.low));
  const stochastic =
    range.length < 14 || close == null
      ? null
      : high === low
        ? 50
        : (100 * (close - low)) / (high - low);
  signals.push({
    name: "Stochastic %K 14",
    value: stochastic,
    vote:
      stochastic == null
        ? null
        : stochastic < 20
          ? 1
          : stochastic > 80
            ? -1
            : 0,
    rule: "Onder 20: Buy. Boven 80: Sell. Daartussen: Neutral.",
  });
  const votes = signals.filter((s) => s.vote != null);
  const score =
    votes.length >= 6
      ? votes.reduce((sum, s) => sum + s.vote!, 0) / votes.length
      : null;
  const index =
    score == null
      ? null
      : score <= -0.6
        ? 0
        : score < -0.15
          ? 1
          : score <= 0.15
            ? 2
            : score < 0.6
              ? 3
              : 4;
  return {
    signals,
    score,
    index,
    label: index == null ? null : ratings[index],
    count: data.length,
    at: data.length ? data.at(-1)!.time + (seconds[interval] ?? 86400) : null,
    close,
    buys: votes.filter((s) => s.vote === 1).length,
    sells: votes.filter((s) => s.vote === -1).length,
    neutrals: votes.filter((s) => s.vote === 0).length,
    available: votes.length,
  };
}
