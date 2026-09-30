import { intervals, normalizeCandles } from "./domain.mjs";

// Native request sizes; never send a calendar duration as a fixed number of seconds.
const sources = {
  kraken: {
    "2h": "1h",
    "6h": "1h",
    "12h": "4h",
    "1mo": "1d",
    "3mo": "1d",
    "1y": "1d",
  },
  coinbase: {
    "30m": "15m",
    "2h": "1h",
    "4h": "1h",
    "12h": "6h",
    "1w": "1d",
    "1mo": "1d",
    "3mo": "1d",
    "1y": "1d",
  },
  twelve: { "6h": "2h", "12h": "4h", "3mo": "1mo", "1y": "1mo" },
  okx: { "1y": "1mo" },
  alpaca: {},
};
export function candleSource(type, interval) {
  if (!Object.hasOwn(intervals, interval) || !Object.hasOwn(sources, type))
    throw new Error("Niet ondersteund grafiekinterval");
  return sources[type][interval] ?? interval;
}
export function periodStart(time, interval) {
  if (["1mo", "3mo", "1y"].includes(interval)) {
    const d = new Date(time * 1000);
    const month =
      interval === "1y"
        ? 0
        : interval === "3mo"
          ? Math.floor(d.getUTCMonth() / 3) * 3
          : d.getUTCMonth();
    return Date.UTC(d.getUTCFullYear(), month, 1) / 1000;
  }
  if (interval === "1w") {
    const d = new Date(time * 1000);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.getTime() / 1000;
  }
  const step = intervals[interval];
  if (!step) throw new Error("Niet ondersteund grafiekinterval");
  return Math.floor(time / step) * step;
}
export function periodEnd(time, interval) {
  const start = periodStart(time, interval);
  if (["1mo", "3mo", "1y"].includes(interval)) {
    const d = new Date(start * 1000);
    return (
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth() + (interval === "1y" ? 12 : interval === "3mo" ? 3 : 1),
        1,
      ) / 1000
    );
  }
  return start + intervals[interval];
}
export function aggregateCandles(
  rows,
  interval,
  sourceInterval,
  now = Date.now() / 1000,
) {
  const sorted = normalizeCandles(rows, Infinity);
  if (interval === sourceInterval) return sorted.slice(-500);
  const buckets = new Map();
  for (const c of sorted) {
    const time = periodStart(c.time, interval);
    let out = buckets.get(time);
    if (!out) {
      out = {
        ...c,
        time,
        partial: c.time > time,
        confirmed: periodEnd(time, interval) <= now && c.confirmed !== false,
      };
      buckets.set(time, out);
    } else {
      out.high = Math.max(out.high, c.high);
      out.low = Math.min(out.low, c.low);
      out.close = c.close;
      out.volume =
        out.volume == null || c.volume == null ? null : out.volume + c.volume;
      out.confirmed &&= c.confirmed !== false;
    }
    out.partial ||= c.partial === true;
  }
  return [...buckets.values()].slice(-500);
}
