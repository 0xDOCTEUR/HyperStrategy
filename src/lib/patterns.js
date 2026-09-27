import { atr, findSwingLevels } from './indicators.js';

function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

function between(lowsOrHighs, from, to) {
  return lowsOrHighs.filter((p) => p.index > from && p.index < to);
}

/**
 * Détecte des figures chartistes classiques à partir des pivots.
 * Retourne les meilleures (récentes + score).
 */
export function detectChartPatterns(candles) {
  if (!candles || candles.length < 40) return [];

  const atrVal = atr(candles, 14) || candles[candles.length - 1].close * 0.01;
  const tol = Math.max(atrVal * 0.55, candles[candles.length - 1].close * 0.008);
  const lookback = Math.min(3, Math.floor(candles.length / 40) || 3);
  const { highs, lows } = findSwingLevels(candles, lookback);

  const minIdx = Math.max(0, candles.length - 150);
  const rh = highs.filter((h) => h.index >= minIdx).slice(-10);
  const rl = lows.filter((l) => l.index >= minIdx).slice(-10);
  const last = candles.length - 1;
  const price = candles[last].close;

  const found = [];

  // —— Double sommet
  for (let i = 0; i < rh.length - 1; i++) {
    for (let j = i + 1; j < rh.length; j++) {
      const a = rh[i];
      const b = rh[j];
      if (b.index - a.index < 5) continue;
      if (!near(a.price, b.price, tol)) continue;
      const mid = between(rl, a.index, b.index);
      if (!mid.length) continue;
      const neck = Math.min(...mid.map((p) => p.price));
      const height = (a.price + b.price) / 2 - neck;
      if (height < atrVal * 1.1) continue;
      const broken = price < neck;
      const score =
        55 +
        Math.min(25, (height / atrVal) * 4) +
        (broken ? 15 : 0) +
        Math.max(0, 10 - (last - b.index) * 0.15);
      found.push({
        id: `dt-${a.index}-${b.index}`,
        key: 'double_top',
        name: 'Double sommet',
        bias: 'baissier',
        status: broken ? 'cassé (confirmation)' : 'en formation / à surveiller',
        confidence: Math.min(98, Math.round(score)),
        neckline: neck,
        target: neck - height,
        detail: broken
          ? `Neckline cassée vers ${fmtP(neck)}. Objectif potentiel ~${fmtP(neck - height)}.`
          : `Deux sommets proches. Une clôture sous ${fmtP(neck)} validerait la figure.`,
        points: [
          { index: a.index, price: a.price, label: 'S1' },
          { index: mid.sort((x, y) => x.price - y.price)[0].index, price: neck, label: 'N' },
          { index: b.index, price: b.price, label: 'S2' },
        ],
      });
    }
  }

  // —— Double creux
  for (let i = 0; i < rl.length - 1; i++) {
    for (let j = i + 1; j < rl.length; j++) {
      const a = rl[i];
      const b = rl[j];
      if (b.index - a.index < 5) continue;
      if (!near(a.price, b.price, tol)) continue;
      const mid = between(rh, a.index, b.index);
      if (!mid.length) continue;
      const neck = Math.max(...mid.map((p) => p.price));
      const height = neck - (a.price + b.price) / 2;
      if (height < atrVal * 1.1) continue;
      const broken = price > neck;
      const score =
        55 +
        Math.min(25, (height / atrVal) * 4) +
        (broken ? 15 : 0) +
        Math.max(0, 10 - (last - b.index) * 0.15);
      found.push({
        id: `db-${a.index}-${b.index}`,
        key: 'double_bottom',
        name: 'Double creux',
        bias: 'haussier',
        status: broken ? 'cassé (confirmation)' : 'en formation / à surveiller',
        confidence: Math.min(98, Math.round(score)),
        neckline: neck,
        target: neck + height,
        detail: broken
          ? `Résistance ${fmtP(neck)} franchie. Objectif potentiel ~${fmtP(neck + height)}.`
          : `Deux creux proches. Une clôture au-dessus de ${fmtP(neck)} validerait la figure.`,
        points: [
          { index: a.index, price: a.price, label: 'C1' },
          { index: mid.sort((x, y) => y.price - x.price)[0].index, price: neck, label: 'N' },
          { index: b.index, price: b.price, label: 'C2' },
        ],
      });
    }
  }

  // —— Épaule-tête-épaule (3 sommets, milieu plus haut)
  for (let i = 0; i < rh.length - 2; i++) {
    const l = rh[i];
    const h = rh[i + 1];
    const r = rh[i + 2];
    if (h.price <= l.price || h.price <= r.price) continue;
    if (!near(l.price, r.price, tol * 1.4)) continue;
    if (h.price - Math.max(l.price, r.price) < atrVal * 0.8) continue;
    const leftValley = between(rl, l.index, h.index);
    const rightValley = between(rl, h.index, r.index);
    if (!leftValley.length || !rightValley.length) continue;
    const n1 = Math.min(...leftValley.map((p) => p.price));
    const n2 = Math.min(...rightValley.map((p) => p.price));
    const neck = (n1 + n2) / 2;
    const height = h.price - neck;
    if (height < atrVal * 1.3) continue;
    const broken = price < neck;
    const score =
      60 +
      Math.min(20, (height / atrVal) * 3) +
      (broken ? 15 : 0) +
      (near(n1, n2, tol * 1.2) ? 8 : 0);
    found.push({
      id: `hs-${l.index}-${r.index}`,
      key: 'head_shoulders',
      name: 'Épaule-tête-épaule',
      bias: 'baissier',
      status: broken ? 'cassé (confirmation)' : 'en formation / à surveiller',
      confidence: Math.min(98, Math.round(score)),
      neckline: neck,
      target: neck - height,
      detail: broken
        ? `Neckline cassée. Objectif potentiel ~${fmtP(neck - height)}.`
        : `Tête au-dessus des épaules. Surveillance sous ${fmtP(neck)}.`,
      points: [
        { index: l.index, price: l.price, label: 'ÉG' },
        { index: h.index, price: h.price, label: 'T' },
        { index: r.index, price: r.price, label: 'ÉD' },
      ],
      neckPoints: [
        { index: leftValley[0].index, price: n1 },
        { index: rightValley[0].index, price: n2 },
      ],
    });
  }

  // —— Épaule-tête-épaule inversée
  for (let i = 0; i < rl.length - 2; i++) {
    const l = rl[i];
    const h = rl[i + 1];
    const r = rl[i + 2];
    if (h.price >= l.price || h.price >= r.price) continue;
    if (!near(l.price, r.price, tol * 1.4)) continue;
    if (Math.min(l.price, r.price) - h.price < atrVal * 0.8) continue;
    const leftPeak = between(rh, l.index, h.index);
    const rightPeak = between(rh, h.index, r.index);
    if (!leftPeak.length || !rightPeak.length) continue;
    const n1 = Math.max(...leftPeak.map((p) => p.price));
    const n2 = Math.max(...rightPeak.map((p) => p.price));
    const neck = (n1 + n2) / 2;
    const height = neck - h.price;
    if (height < atrVal * 1.3) continue;
    const broken = price > neck;
    const score =
      60 +
      Math.min(20, (height / atrVal) * 3) +
      (broken ? 15 : 0) +
      (near(n1, n2, tol * 1.2) ? 8 : 0);
    found.push({
      id: `ihs-${l.index}-${r.index}`,
      key: 'inv_head_shoulders',
      name: 'Épaule-tête-épaule inversée',
      bias: 'haussier',
      status: broken ? 'cassé (confirmation)' : 'en formation / à surveiller',
      confidence: Math.min(98, Math.round(score)),
      neckline: neck,
      target: neck + height,
      detail: broken
        ? `Neckline franchie. Objectif potentiel ~${fmtP(neck + height)}.`
        : `Creux central plus bas. Surveillance au-dessus de ${fmtP(neck)}.`,
      points: [
        { index: l.index, price: l.price, label: 'ÉG' },
        { index: h.index, price: h.price, label: 'T' },
        { index: r.index, price: r.price, label: 'ÉD' },
      ],
      neckPoints: [
        { index: leftPeak[0].index, price: n1 },
        { index: rightPeak[0].index, price: n2 },
      ],
    });
  }

  // —— Triangles (sur 4+ pivots alternés récents)
  const triangle = detectTriangle(candles, rh, rl, atrVal, price, last);
  if (triangle) found.push(triangle);

  // Dédupliquer par type, garder le plus confiant / récent
  const byKey = new Map();
  for (const p of found) {
    const prev = byKey.get(p.key);
    if (!prev || p.confidence > prev.confidence) byKey.set(p.key, p);
  }

  return [...byKey.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map((p) => enrichTimes(p, candles));
}

function detectTriangle(candles, rh, rl, atrVal, price, last) {
  if (rh.length < 2 || rl.length < 2) return null;
  const h1 = rh[rh.length - 2];
  const h2 = rh[rh.length - 1];
  const l1 = rl[rl.length - 2];
  const l2 = rl[rl.length - 1];
  if (h2.index <= h1.index || l2.index <= l1.index) return null;

  const highFlat = near(h1.price, h2.price, atrVal * 0.45);
  const lowFlat = near(l1.price, l2.price, atrVal * 0.45);
  const highsFalling = h2.price < h1.price - atrVal * 0.25;
  const highsRising = h2.price > h1.price + atrVal * 0.25;
  const lowsRising = l2.price > l1.price + atrVal * 0.25;
  const lowsFalling = l2.price < l1.price - atrVal * 0.25;

  let name = null;
  let key = null;
  let bias = 'neutre';
  if (highFlat && lowsRising) {
    name = 'Triangle ascendant';
    key = 'asc_triangle';
    bias = 'haussier';
  } else if (lowFlat && highsFalling) {
    name = 'Triangle descendant';
    key = 'desc_triangle';
    bias = 'baissier';
  } else if (highsFalling && lowsRising) {
    name = 'Triangle symétrique';
    key = 'sym_triangle';
    bias = 'neutre';
  } else if (highsRising && lowsRising && h2.price - h1.price < l2.price - l1.price) {
    name = 'Coin montant (wedge)';
    key = 'rising_wedge';
    bias = 'baissier';
  } else if (highsFalling && lowsFalling && h1.price - h2.price < l1.price - l2.price) {
    name = 'Coin descendant (wedge)';
    key = 'falling_wedge';
    bias = 'haussier';
  } else {
    return null;
  }

  const span = Math.max(h2.index, l2.index) - Math.min(h1.index, l1.index);
  if (span < 8) return null;

  const upper = (h1.price + h2.price) / 2;
  const lower = (l1.price + l2.price) / 2;
  const compressing = Math.abs(h2.price - l2.price) < Math.abs(h1.price - l1.price);
  if (!compressing && key.includes('triangle')) return null;

  const brokenUp = price > upper;
  const brokenDown = price < lower;
  let status = 'en formation / compression';
  if (brokenUp) status = 'cassure haussière';
  if (brokenDown) status = 'cassure baissière';

  const score =
    50 +
    (compressing ? 12 : 0) +
    (brokenUp || brokenDown ? 18 : 0) +
    Math.max(0, 10 - (last - Math.max(h2.index, l2.index)) * 0.2);

  return {
    id: `${key}-${h1.index}-${l2.index}`,
    key,
    name,
    bias,
    status,
    confidence: Math.min(95, Math.round(score)),
    neckline: bias === 'haussier' ? upper : lower,
    target: null,
    detail: `${name} entre ~${fmtP(lower)} et ~${fmtP(upper)}. ${status}.`,
    points: [
      { index: h1.index, price: h1.price, label: 'H1' },
      { index: h2.index, price: h2.price, label: 'H2' },
      { index: l1.index, price: l1.price, label: 'B1' },
      { index: l2.index, price: l2.price, label: 'B2' },
    ],
    upperLine: [
      { index: h1.index, price: h1.price },
      { index: h2.index, price: h2.price },
    ],
    lowerLine: [
      { index: l1.index, price: l1.price },
      { index: l2.index, price: l2.price },
    ],
  };
}

function enrichTimes(pattern, candles) {
  const mapPts = (pts) =>
    (pts || []).map((p) => ({
      ...p,
      time: candles[p.index]?.time,
    }));
  return {
    ...pattern,
    points: mapPts(pattern.points),
    neckPoints: mapPts(pattern.neckPoints),
    upperLine: mapPts(pattern.upperLine),
    lowerLine: mapPts(pattern.lowerLine),
  };
}

function fmtP(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}
