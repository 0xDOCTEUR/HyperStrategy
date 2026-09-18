import { fetchCandles } from '../src/api/hyperliquid.js';
import {
  sma,
  rsi,
  macd,
  buildSupportResistance,
  ascendingTrendline,
} from '../src/lib/indicators.js';
import { buildAnalysis } from '../src/lib/analysis.js';

export const LOOKBACK = {
  '15m': 500,
  '1h': 500,
  '4h': 500,
  '1d': 420,
  '1w': 260,
};

export async function analyzeCoin(coin, interval) {
  const candles = await fetchCandles(coin, interval, LOOKBACK[interval] || 400);
  if (candles.length < 50) {
    throw new Error(`Pas assez d’historique (${candles.length} bougies)`);
  }
  const closes = candles.map((c) => c.close);
  const ma50 = sma(closes, 50);
  const ma100 = sma(closes, 100);
  const ma200 = sma(closes, 200);
  const rsiArr = rsi(closes, 14);
  const macdObj = macd(closes, 12, 26, 9);
  const levels = buildSupportResistance(candles);
  const trendline = ascendingTrendline(candles);
  const analysis = buildAnalysis(candles, {
    ma50,
    ma100,
    ma200,
    rsiArr,
    macdObj,
    levels,
    trendline,
  });
  return { analysis, candles };
}
