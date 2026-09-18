const isViteDev =
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  import.meta.env.DEV === true;

const API_BASE = isViteDev ? '/hl-api' : 'https://api.hyperliquid.xyz';

async function postInfo(body) {
  const res = await fetch(`${API_BASE}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hyperliquid ${res.status}: ${text.slice(0, 160)}`);
  }
  return res.json();
}

export async function fetchPerpAssets() {
  const meta = await postInfo({ type: 'meta' });
  return (meta.universe || [])
    .filter((a) => !a.isDelisted)
    .map((a) => ({
      name: a.name,
      maxLeverage: a.maxLeverage,
      szDecimals: a.szDecimals,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchMidPrices() {
  const data = await postInfo({ type: 'allMids' });
  return data || {};
}

/** Intervalle → durée d’une bougie en ms */
const INTERVAL_MS = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
};

export async function fetchCandles(coin, interval = '1d', lookback = 420) {
  const step = INTERVAL_MS[interval] || INTERVAL_MS['1d'];
  const endTime = Date.now();
  const startTime = endTime - lookback * step;
  const raw = await postInfo({
    type: 'candleSnapshot',
    req: { coin, interval, startTime, endTime },
  });

  return (raw || [])
    .map((c) => ({
      time: Math.floor(c.t / 1000),
      open: Number(c.o),
      high: Number(c.h),
      low: Number(c.l),
      close: Number(c.c),
      volume: Number(c.v),
    }))
    .filter((c) => Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => a.time - b.time);
}
