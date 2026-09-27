import { atr, findSwingLevels } from './indicators.js';

function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

function between(lowsOrHighs, from, to) {
  return lowsOrHighs.filter((p) => p.index > from && p.index < to);
}

function node(index, price, label) {
  return { index, price, label };
}

/**
 * Garde la formation intacte, puis ajoute une projection
 * juste après la figure → neckline → objectif (comme une fiche).
 */
function withProjection(pattern, last) {
  const target = pattern.target;
  if (target == null || !Number.isFinite(target)) return pattern;
  const formation = pattern.silhouette;
  if (!formation?.length) return pattern;

  const first = formation[0];
  const end = formation[formation.length - 1];
  const span = Math.max(8, end.index - first.index);
  const neck = pattern.neckline;
  const broken = /cassé|cassure/i.test(pattern.status || '');

  // Projection collée à la figure (pas étirée jusqu’à aujourd’hui)
  const proj = [node(end.index, end.price)];
  let cursor = end.index;

  if (neck != null && Number.isFinite(neck) && Math.abs(end.price - neck) > Math.abs(target - neck) * 0.05) {
    cursor = end.index + Math.max(3, Math.round(span * 0.28));
    proj.push(node(cursor, neck, 'Cassure'));
  }

  cursor = cursor + Math.max(6, Math.round(span * 0.55));
  proj.push(node(cursor, target, 'Objectif'));

  // Si la figure est récente, déborde un peu après la dernière bougie
  // pour laisser voir l’objectif ; sinon reste dans l’historique.
  if (end.index > last - Math.max(5, Math.round(span * 0.3))) {
    const overflow = Math.max(4, Math.round(span * 0.35));
    const lastProj = proj[proj.length - 1];
    if (lastProj.index <= last) {
      lastProj.index = last + overflow;
    }
  }

  return {
    ...pattern,
    silhouette: formation,
    projection: proj,
    projectionStyle: broken ? 'solid' : 'dashed',
    targetLine: [
      node(proj[proj.length - 2]?.index ?? end.index, target),
      node(proj[proj.length - 1].index + Math.max(2, Math.round(span * 0.12)), target),
    ],
  };
}

/**
 * Détecte des figures chartistes et prépare des overlays
 * (silhouette + bordures + neckline), style fiche chartiste.
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

  // —— Double sommet (forme en M)
  for (let i = 0; i < rh.length - 1; i++) {
    for (let j = i + 1; j < rh.length; j++) {
      const a = rh[i];
      const b = rh[j];
      if (b.index - a.index < 5) continue;
      if (!near(a.price, b.price, tol)) continue;
      const mid = between(rl, a.index, b.index);
      if (!mid.length) continue;
      const trough = mid.sort((x, y) => x.price - y.price)[0];
      const neck = trough.price;
      const height = (a.price + b.price) / 2 - neck;
      if (height < atrVal * 1.1) continue;
      const broken = price < neck;
      const score =
        55 +
        Math.min(25, (height / atrVal) * 4) +
        (broken ? 15 : 0) +
        Math.max(0, 10 - (last - b.index) * 0.15);
      const topLevel = (a.price + b.price) / 2;
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
          node(a.index, a.price, 'S1'),
          node(trough.index, neck, 'N'),
          node(b.index, b.price, 'S2'),
        ],
        // Formation M (les 3 pivots) — la projection ajoute la suite
        silhouette: [
          node(a.index, a.price),
          node(trough.index, neck),
          node(b.index, b.price),
        ],
        overlayUpper: [
          node(a.index, topLevel),
          node(b.index, topLevel),
        ],
        overlayLower: [
          node(trough.index, neck),
          node(b.index, neck),
        ],
        targetLine: null,
      });
    }
  }

  // —— Double creux (forme en W)
  for (let i = 0; i < rl.length - 1; i++) {
    for (let j = i + 1; j < rl.length; j++) {
      const a = rl[i];
      const b = rl[j];
      if (b.index - a.index < 5) continue;
      if (!near(a.price, b.price, tol)) continue;
      const mid = between(rh, a.index, b.index);
      if (!mid.length) continue;
      const peak = mid.sort((x, y) => y.price - x.price)[0];
      const neck = peak.price;
      const height = neck - (a.price + b.price) / 2;
      if (height < atrVal * 1.1) continue;
      const broken = price > neck;
      const score =
        55 +
        Math.min(25, (height / atrVal) * 4) +
        (broken ? 15 : 0) +
        Math.max(0, 10 - (last - b.index) * 0.15);
      const botLevel = (a.price + b.price) / 2;
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
          node(a.index, a.price, 'C1'),
          node(peak.index, neck, 'N'),
          node(b.index, b.price, 'C2'),
        ],
        // Formation W (les 3 pivots) — la projection ajoute la suite
        silhouette: [
          node(a.index, a.price),
          node(peak.index, neck),
          node(b.index, b.price),
        ],
        overlayUpper: [
          node(peak.index, neck),
          node(b.index, neck),
        ],
        overlayLower: [
          node(a.index, botLevel),
          node(b.index, botLevel),
        ],
        targetLine: null,
      });
    }
  }

  // —— Épaule-tête-épaule
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
    const lv = leftValley.sort((x, y) => x.price - y.price)[0];
    const rv = rightValley.sort((x, y) => x.price - y.price)[0];
    const neck = (lv.price + rv.price) / 2;
    const height = h.price - neck;
    if (height < atrVal * 1.3) continue;
    const broken = price < neck;
    const score =
      60 +
      Math.min(20, (height / atrVal) * 3) +
      (broken ? 15 : 0) +
      (near(lv.price, rv.price, tol * 1.2) ? 8 : 0);
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
        node(l.index, l.price, 'ÉG'),
        node(h.index, h.price, 'T'),
        node(r.index, r.price, 'ÉD'),
      ],
      silhouette: [
        node(l.index, l.price),
        node(lv.index, lv.price),
        node(h.index, h.price),
        node(rv.index, rv.price),
        node(r.index, r.price),
      ],
      overlayUpper: null,
      overlayLower: [
        node(lv.index, neck),
        node(rv.index, neck),
      ],
      targetLine: null,
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
    const lp = leftPeak.sort((x, y) => y.price - x.price)[0];
    const rp = rightPeak.sort((x, y) => y.price - x.price)[0];
    const neck = (lp.price + rp.price) / 2;
    const height = neck - h.price;
    if (height < atrVal * 1.3) continue;
    const broken = price > neck;
    const score =
      60 +
      Math.min(20, (height / atrVal) * 3) +
      (broken ? 15 : 0) +
      (near(lp.price, rp.price, tol * 1.2) ? 8 : 0);
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
        node(l.index, l.price, 'ÉG'),
        node(h.index, h.price, 'T'),
        node(r.index, r.price, 'ÉD'),
      ],
      silhouette: [
        node(l.index, l.price),
        node(lp.index, lp.price),
        node(h.index, h.price),
        node(rp.index, rp.price),
        node(r.index, r.price),
      ],
      overlayUpper: [
        node(lp.index, neck),
        node(rp.index, neck),
      ],
      overlayLower: null,
      targetLine: null,
    });
  }

  const triangle = detectTriangle(candles, rh, rl, atrVal, price, last);
  if (triangle) found.push(triangle);

  const byKey = new Map();
  for (const p of found) {
    const prev = byKey.get(p.key);
    if (!prev || p.confidence > prev.confidence) byKey.set(p.key, p);
  }

  return [...byKey.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map((p) => withProjection(p, last))
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

  const brokenUp = price > Math.max(h1.price, h2.price);
  const brokenDown = price < Math.min(l1.price, l2.price);
  let status = 'en formation / compression';
  if (brokenUp) status = 'cassure haussière';
  if (brokenDown) status = 'cassure baissière';

  const score =
    50 +
    (compressing ? 12 : 0) +
    (brokenUp || brokenDown ? 18 : 0) +
    Math.max(0, 10 - (last - Math.max(h2.index, l2.index)) * 0.2);

  // Silhouette en zigzag H/B/H/B selon l’ordre temporel
  const swings = [
    node(h1.index, h1.price, 'H1'),
    node(l1.index, l1.price, 'B1'),
    node(h2.index, h2.price, 'H2'),
    node(l2.index, l2.price, 'B2'),
  ].sort((a, b) => a.index - b.index);

  const height = Math.abs(upper - lower);
  let target = null;
  let neckline = bias === 'haussier' ? upper : lower;
  if (bias === 'haussier' || brokenUp) {
    target = upper + height;
    neckline = upper;
    if (bias === 'neutre' && brokenUp) bias = 'haussier';
  } else if (bias === 'baissier' || brokenDown) {
    target = lower - height;
    neckline = lower;
    if (bias === 'neutre' && brokenDown) bias = 'baissier';
  }

  return {
    id: `${key}-${h1.index}-${l2.index}`,
    key,
    name,
    bias,
    status,
    confidence: Math.min(95, Math.round(score)),
    neckline,
    target,
    detail: target
      ? `${name} entre ~${fmtP(lower)} et ~${fmtP(upper)}. ${status}. Objectif potentiel ~${fmtP(target)}.`
      : `${name} entre ~${fmtP(lower)} et ~${fmtP(upper)}. ${status}.`,
    points: swings,
    silhouette: swings,
    overlayUpper: [node(h1.index, h1.price), node(h2.index, h2.price)],
    overlayLower: [node(l1.index, l1.price), node(l2.index, l2.price)],
    targetLine: null,
  };
}

function enrichTimes(pattern, candles) {
  const n = candles.length;
  const step =
    n >= 2 ? Math.max(1, candles[n - 1].time - candles[n - 2].time) : 3600;

  const timeAt = (index) => {
    if (index == null || !Number.isFinite(index)) return null;
    if (candles[index]?.time != null) return candles[index].time;
    if (index >= n && n > 0) {
      return candles[n - 1].time + (index - (n - 1)) * step;
    }
    if (index < 0 && n > 0) {
      return candles[0].time + index * step;
    }
    return null;
  };

  const mapPts = (pts) =>
    (pts || [])
      .map((p) => ({
        ...p,
        time: timeAt(p.index),
      }))
      .filter((p) => p.time != null);

  return {
    ...pattern,
    points: mapPts(pattern.points),
    silhouette: mapPts(pattern.silhouette),
    projection: mapPts(pattern.projection),
    overlayUpper: mapPts(pattern.overlayUpper),
    overlayLower: mapPts(pattern.overlayLower),
    targetLine: mapPts(pattern.targetLine),
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
