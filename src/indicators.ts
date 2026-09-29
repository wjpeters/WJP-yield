import type { Candle } from "./types";
export function sma(data: Candle[], period: number) {
  let sum = 0;
  return data.flatMap((c, i) => {
    sum += c.close;
    if (i >= period) sum -= data[i - period].close;
    return i >= period - 1 ? [{ time: c.time, value: sum / period }] : [];
  });
}
export function ema(data: Candle[], period: number) {
  let value = 0;
  const k = 2 / (period + 1);
  return data.flatMap((c, i) => {
    if (i < period) {
      value += c.close;
      return i === period - 1
        ? [{ time: c.time, value: (value /= period) }]
        : [];
    }
    value = c.close * k + value * (1 - k);
    return [{ time: c.time, value }];
  });
}
export function rsi(data: Candle[], period = 14) {
  let gain = 0,
    loss = 0;
  return data.flatMap((c, i) => {
    if (i === 0) return [];
    const delta = c.close - data[i - 1].close;
    const up = Math.max(delta, 0),
      down = Math.max(-delta, 0);
    if (i <= period) {
      gain += up;
      loss += down;
      if (i < period) return [];
      gain /= period;
      loss /= period;
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
    }
    return [
      {
        time: c.time,
        value:
          gain === 0 && loss === 0
            ? 50
            : loss === 0
              ? 100
              : 100 - 100 / (1 + gain / loss),
      },
    ];
  });
}
