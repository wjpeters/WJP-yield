import test from "node:test";
import assert from "node:assert/strict";
import { sma, ema, rsi } from "../src/indicators.ts";
const data = Array.from({ length: 60 }, (_, i) => ({
  time: i + 1,
  open: i + 1,
  high: i + 1,
  low: i + 1,
  close: i + 1,
  volume: 1,
}));
test("SMA20 gebruikt exact twintig candles en EMA50 seed is gemiddelde", () => {
  assert.equal(sma(data, 20)[0].value, 10.5);
  assert.equal(ema(data, 50)[0].value, 25.5);
});
test("RSI14 monotone, vlakke en dalende reeksen", () => {
  assert.equal(rsi(data).at(-1).value, 100);
  assert.equal(rsi(data.map((c) => ({ ...c, close: 10 }))).at(-1).value, 50);
  assert.equal(
    rsi(data.map((c) => ({ ...c, close: 100 - c.close }))).at(-1).value,
    0,
  );
});
