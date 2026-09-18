export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);
  const line = closes.map((_, i) =>
    fastE[i] != null && slowE[i] != null ? fastE[i] - slowE[i] : null,
  );
  const valid = line.map((v) => (v == null ? 0 : v));
  // EMA du MACD en ignorant les nulls initiaux
  const first = line.findIndex((v) => v != null);
  const signal = new Array(closes.length).fill(null);
  const hist = new Array(closes.length).fill(null);
  if (first < 0) return { line, signal, hist };

  const slice = line.slice(first);
  const sigSlice = ema(
    slice.map((v) => v ?? 0),
    signalPeriod,
  );
  for (let i = 0; i < sigSlice.length; i++) {
    const idx = first + i;
    signal[idx] = sigSlice[i];
    if (line[idx] != null && sigSlice[i] != null) {
      hist[idx] = line[idx] - sigSlice[i];
    }
  }
  return { line, signal, hist };
}

/** Pivots locaux pour supports / résistances */
export function findSwingLevels(candles, lookback = 5) {
  const highs = [];
  const lows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= h || candles[i + j].high >= h) isHigh = false;
      if (candles[i - j].low <= l || candles[i + j].low <= l) isLow = false;
    }
    if (isHigh) highs.push({ price: h, index: i });
    if (isLow) lows.push({ price: l, index: i });
  }
  return { highs, lows };
}

function clusterLevels(points, atr, maxClusters = 3, preferAbove) {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const tol = Math.max(atr * 0.6, sorted[0].price * 0.004);
  const clusters = [];

  for (const p of sorted) {
    const hit = clusters.find((c) => Math.abs(c.center - p.price) <= tol);
    if (hit) {
      hit.prices.push(p.price);
      hit.center = hit.prices.reduce((s, x) => s + x, 0) / hit.prices.length;
      hit.strength += 1;
      hit.lastIndex = Math.max(hit.lastIndex, p.index);
    } else {
      clusters.push({
        center: p.price,
        prices: [p.price],
        strength: 1,
        lastIndex: p.index,
      });
    }
  }

  const filtered = preferAbove
    ? clusters.filter((c) => c.center > preferAbove * 0.998)
    : clusters.filter((c) => c.center < preferAbove * 1.002);

  return filtered
    .sort((a, b) => b.strength - a.strength || b.lastIndex - a.lastIndex)
    .slice(0, maxClusters)
    .map((c) => {
      const lo = Math.min(...c.prices);
      const hi = Math.max(...c.prices);
      const pad = Math.max(atr * 0.15, c.center * 0.0015);
      return {
        mid: c.center,
        low: lo - pad,
        high: hi + pad,
        strength: c.strength,
      };
    });
}

export function atr(candles, period = 14) {
  if (candles.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((s, x) => s + x, 0) / slice.length;
}

export function buildSupportResistance(candles) {
  const price = candles[candles.length - 1].close;
  const rangeAtr = atr(candles, 14);
  const { highs, lows } = findSwingLevels(candles, 4);

  let resists = clusterLevels(highs, rangeAtr, 3, price).sort((a, b) => a.mid - b.mid);
  let supports = clusterLevels(lows, rangeAtr, 3, price)
    .filter((s) => s.mid < price)
    .sort((a, b) => b.mid - a.mid);

  // Compléter avec des niveaux psychologiques / % si trop peu
  const fill = (list, dir) => {
    while (list.length < 3) {
      const step = rangeAtr * (1.8 + list.length * 0.9);
      const mid = dir > 0 ? price + step * (list.length + 1) : price - step * (list.length + 1);
      list.push({
        mid,
        low: mid - rangeAtr * 0.25,
        high: mid + rangeAtr * 0.25,
        strength: 1,
        synthetic: true,
      });
    }
  };
  fill(resists, 1);
  fill(supports, -1);

  resists = resists.slice(0, 3).sort((a, b) => a.mid - b.mid);
  supports = supports.slice(0, 3).sort((a, b) => b.mid - a.mid);

  const describe = (level, type, idx) => {
    if (level.synthetic) {
      return type === 'resistance'
        ? idx === 2
          ? 'Extension de tendance'
          : 'Zone estimée (peu de pivots)'
        : idx === 2
          ? 'Support profond'
          : 'Zone estimée (peu de pivots)';
    }
    if (type === 'resistance') {
      if (idx === 0) return 'Résistance proche';
      if (idx === 1) return 'Zone d’offre intermédiaire';
      return 'Résistance majeure';
    }
    if (idx === 0) return 'Support proche';
    if (idx === 1) return 'Zone de demande';
    return 'Support majeur';
  };

  const rows = [];
  // Affichage du haut vers le bas : R3 → R2 → R1 → S1 → S2 → S3
  [
    { name: 'R3', type: 'resistance', idx: 2 },
    { name: 'R2', type: 'resistance', idx: 1 },
    { name: 'R1', type: 'resistance', idx: 0 },
    { name: 'S1', type: 'support', idx: 0 },
    { name: 'S2', type: 'support', idx: 1 },
    { name: 'S3', type: 'support', idx: 2 },
  ].forEach(({ name, type, idx }) => {
    const L = type === 'resistance' ? resists[idx] : supports[idx];
    rows.push({
      level: name,
      type,
      mid: L.mid,
      low: L.low,
      high: L.high,
      description: describe(L, type, idx),
    });
  });
  return { rows, atr: rangeAtr };
}

/** Ligne de tendance haussière approximative (plus bas croissants) */
export function ascendingTrendline(candles) {
  const look = Math.min(120, candles.length);
  const slice = candles.slice(-look);
  const { lows } = findSwingLevels(slice, 3);
  if (lows.length < 2) return null;
  const recent = lows.slice(-6);
  let best = null;
  for (let i = 0; i < recent.length; i++) {
    for (let j = i + 1; j < recent.length; j++) {
      const a = recent[i];
      const b = recent[j];
      if (b.price <= a.price) continue;
      const slope = (b.price - a.price) / (b.index - a.index);
      let touches = 0;
      let violated = false;
      for (const p of recent) {
        const expected = a.price + slope * (p.index - a.index);
        if (Math.abs(p.price - expected) / expected < 0.012) touches += 1;
        if (p.price < expected * 0.985) violated = true;
      }
      if (violated) continue;
      const score = touches * 10 - (b.index - a.index) * 0.01;
      if (!best || score > best.score) {
        best = {
          score,
          t1: slice[a.index].time,
          p1: a.price,
          t2: slice[b.index].time,
          p2: b.price,
          slopePerBar: slope,
          startIndexGlobal: candles.length - look + a.index,
        };
      }
    }
  }
  if (!best) return null;
  const lastIdx = candles.length - 1;
  const barsFromStart = lastIdx - best.startIndexGlobal;
  const endPrice = best.p1 + best.slopePerBar * barsFromStart;
  return {
    startTime: best.t1,
    startPrice: best.p1,
    endTime: candles[lastIdx].time,
    endPrice,
  };
}
