export type DrawingKind = "horizontal" | "trend" | "rectangle" | "fib";
export type Anchor = { time: number; price: number };
export type Drawing = {
  id: string;
  kind: DrawingKind;
  color: string;
  points: Anchor[];
};
export const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const drawingNames: Record<DrawingKind, string> = {
  horizontal: "Horizontaal niveau",
  trend: "Trendlijn",
  rectangle: "Rechthoek",
  fib: "Fibonacci",
};
// Interpolate within the actual candle calendar, preserving timestamps across timeframes.
export function timeToLogical(
  time: number,
  times: number[],
  step: number,
): number {
  if (!times.length) return 0;
  if (time <= times[0]) return (time - times[0]) / step;
  const last = times.length - 1;
  if (time >= times[last]) return last + (time - times[last]) / step;
  let lo = 0,
    hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid;
  }
  return lo + (time - times[lo]) / (times[hi] - times[lo]);
}
export function logicalToTime(
  logical: number,
  times: number[],
  step: number,
): number {
  if (!times.length) return 0;
  const last = times.length - 1;
  if (logical <= 0) return times[0] + logical * step;
  if (logical >= last) return times[last] + (logical - last) * step;
  const lo = Math.floor(logical);
  return times[lo] + (logical - lo) * (times[lo + 1] - times[lo]);
}
export function fibPrice(a: number, b: number, ratio: number) {
  return b + (a - b) * ratio;
}
