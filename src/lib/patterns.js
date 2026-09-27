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

/** Prix extrême (high/low) réel de la bougie, pour coller aux mèches. */
function candleExt(candles, index, side) {
  const c = candles[index];
  if (!c) return null;
  return side === 'high' ? c.high : c.low;
}

/**
 * Après la fin de figure : a-t-on clairement cassé dans le sens inverse ?
 */
function maxHighSince(candles, fromIdx) {
  let m = -Infinity;
  for (let i = fromIdx; i < candles.length; i++) m = Math.max(m, candles[i].high);
  return m;
}

function minLowSince(candles, fromIdx) {
  let m = Infinity;
  for (let i = fromIdx; i < candles.length; i++) m = Math.min(m, candles[i].low);
  return m;
}

/** Première bougie qui clôture au-delà de la neckline (dans le sens attendu). */
function findBreakIndex(candles, fromIdx, neck, direction) {
  for (let i = fromIdx; i < candles.length; i++) {
    if (direction === 'down' && candles[i].close < neck) return i;
    if (direction === 'up' && candles[i].close > neck) return i;
  }
  return null;
}

/** Objectif déjà atteint (ou dépassé) → figure terminée, plus à afficher. */
function targetAlreadyHit(bias, price, target) {
  if (target == null || !Number.isFinite(target)) return false;
  if (bias === 'haussier') return price >= target;
  if (bias === 'baissier') return price <= target;
  return false;
}

/**
 * Figure « usée » : objectif touché dans l’historique, ou cassure trop vieille
 * alors que le prix est déjà loin de la zone utile.
 */
function isStalePattern(pattern, candles, price) {
  if (targetAlreadyHit(pattern.bias, price, pattern.target)) return true;

  const last = candles.length - 1;
  const end = pattern.silhouette?.[pattern.silhouette.length - 1];
  if (!end) return true;

  // Confirmée mais trop ancienne (ex. double creux depuis longtemps sur 15m)
  if (pattern.confirmed) {
    const br = findBreakIndex(
      candles,
      end.index + 1,
      pattern.neckline,
      pattern.bias === 'haussier' ? 'up' : 'down',
    );
    const age = last - (br ?? end.index);
    if (age > 48) return true;

    // Prix déjà bien au-delà de l’objectif mesuré (même sans clôture exacte dessus)
    if (pattern.target != null && pattern.neckline != null) {
      const move = Math.abs(pattern.target - pattern.neckline);
      if (pattern.bias === 'haussier' && price > pattern.target + move * 0.15) return true;
      if (pattern.bias === 'baissier' && price < pattern.target - move * 0.15) return true;
    }
  }

  return false;
}

/**
 * Construit UN seul tracé style fiche :
 * pivots de la figure, puis prolongation jusqu’à l’objectif
 * (au-delà de la dernière bougie si pas encore atteint).
 */
function withProjection(pattern, candles) {
  const last = candles.length - 1;
  const formation = (pattern.silhouette || []).map((p) => ({ ...p }));
  if (formation.length < 2) {
    return { ...pattern, trace: null, projection: null, targetLine: null };
  }

  const first = formation[0];
  const end = formation[formation.length - 1];
  const span = Math.max(6, end.index - first.index);
  const neck = pattern.neckline;
  const target = pattern.target;
  const confirmed = pattern.confirmed === true;
  const bullish = pattern.bias === 'haussier';
  const bearish = pattern.bias === 'baissier';
  const price = candles[last].close;

  const trace = [...formation];

  if (
    pattern.invalidated ||
    target == null ||
    !Number.isFinite(target) ||
    (pattern.bias !== 'haussier' && pattern.bias !== 'baissier')
  ) {
    return {
      ...pattern,
      trace,
      projection: null,
      projectionStyle: null,
      targetLine: null,
      overlayUpper: pattern.showChannel ? pattern.overlayUpper : null,
      overlayLower: pattern.showChannel ? pattern.overlayLower : null,
    };
  }

  // 1) Cassure / neckline après le dernier pivot
  let breakIdx = end.index + Math.max(2, Math.round(span * 0.22));
  if (confirmed && neck != null) {
    const found = findBreakIndex(candles, end.index + 1, neck, bullish ? 'up' : 'down');
    if (found != null) breakIdx = found;
  }
  if (neck != null && Number.isFinite(neck) && Math.abs(end.price - neck) > Math.abs(target - neck) * 0.03) {
    // Ne pas coller la cassure sur la dernière bougie : on garde la géométrie
    if (breakIdx >= last) breakIdx = Math.max(end.index + 2, last - 1);
    if (breakIdx > end.index) {
      trace.push(node(breakIdx, neck, 'Cassure'));
    }
  }

  // 2) Toujours prolonger jusqu’à l’objectif
  const reached =
    (bullish && price >= target) || (bearish && price <= target);

  // Marge à droite : assez de bougies « futures » pour voir la projection
  const futureBars = Math.max(12, Math.round(span * 0.5), 8);
  const targetIdx = reached ? last : last + futureBars;

  // Point intermédiaire au prix actuel (si on n’a pas encore l’objectif)
  // pour que le tracé parte du présent vers la cible, sans zigzag parasite
  if (!reached && Math.abs(price - (trace[trace.length - 1]?.price ?? price)) > Math.abs(target - price) * 0.02) {
    if (last > (trace[trace.length - 1]?.index ?? -1)) {
      trace.push(node(last, price, 'Maintenant'));
    }
  }

  trace.push(node(targetIdx, target, 'Objectif'));

  const neckLine =
    neck != null ? [node(first.index, neck), node(Math.max(end.index, breakIdx), neck)] : null;

  return {
    ...pattern,
    trace,
    silhouette: formation,
    projection: null,
    projectionStyle: confirmed ? 'solid' : 'dashed',
    neckPoints: neckLine,
    overlayUpper: pattern.showChannel ? pattern.overlayUpper : null,
    overlayLower: pattern.showChannel ? pattern.overlayLower : null,
    targetLine: [
      node(last, target),
      node(last + futureBars + 4, target),
    ],
    targetPrice: target,
    rightPadBars: futureBars + 6,
  };
}

/**
 * Détecte des figures chartistes et prépare des overlays
 * (silhouette + bordures), seulement si encore cohérentes avec le prix.
 */
export function detectChartPatterns(candles) {
  if (!candles || candles.length < 40) return [];

  const atrVal = atr(candles, 14) || candles[candles.length - 1].close * 0.01;
  const tol = Math.max(atrVal * 0.55, candles[candles.length - 1].close * 0.008);
  const lookback = Math.min(3, Math.floor(candles.length / 40) || 3);
  const { highs, lows } = findSwingLevels(candles, lookback);

  const minIdx = Math.max(0, candles.length - 120);
  const rh = highs.filter((h) => h.index >= minIdx).slice(-8);
  const rl = lows.filter((l) => l.index >= minIdx).slice(-8);
  const last = candles.length - 1;
  const price = candles[last].close;

  const found = [];

  // —— Double sommet (M)
  for (let i = 0; i < rh.length - 1; i++) {
    for (let j = i + 1; j < rh.length; j++) {
      const a = rh[i];
      const b = rh[j];
      if (b.index - a.index < 5 || b.index - a.index > 80) continue;
      if (!near(a.price, b.price, tol)) continue;
      const mid = between(rl, a.index, b.index);
      if (!mid.length) continue;
      const trough = mid.sort((x, y) => x.price - y.price)[0];
      const p1 = candleExt(candles, a.index, 'high') ?? a.price;
      const p2 = candleExt(candles, b.index, 'high') ?? b.price;
      const neckPx = candleExt(candles, trough.index, 'low') ?? trough.price;
      const topLevel = (p1 + p2) / 2;
      const height = topLevel - neckPx;
      if (height < atrVal * 1.2) continue;

      // Invalidé si le prix a clairement dépassé les sommets
      const hiAfter = maxHighSince(candles, b.index + 1);
      const invalidated = hiAfter > topLevel + tol * 0.8;
      const target = neckPx - height;
      if (targetAlreadyHit('baissier', price, target)) continue;
      if (minLowSince(candles, b.index + 1) <= target) continue;

      const confirmed = !invalidated && price < neckPx;
      const forming = !invalidated && !confirmed && price <= topLevel + tol * 0.3;
      if (!forming && !confirmed) continue;
      if (forming && last - b.index > 40) continue;
      if (confirmed && last - b.index > 60) continue;

      const score =
        50 +
        Math.min(25, (height / atrVal) * 4) +
        (confirmed ? 20 : 8) +
        Math.max(0, 18 - (last - b.index) * 0.35);

      found.push({
        id: `dt-${a.index}-${b.index}`,
        key: 'double_top',
        name: 'Double sommet',
        bias: 'baissier',
        confirmed,
        invalidated: false,
        status: confirmed ? 'cassé (confirmation)' : 'en formation / à surveiller',
        confidence: Math.min(96, Math.round(score)),
        neckline: neckPx,
        target,
        detail: confirmed
          ? `Neckline cassée vers ${fmtP(neckPx)}. Objectif potentiel ~${fmtP(target)}.`
          : `Deux sommets proches. Une clôture sous ${fmtP(neckPx)} validerait la figure.`,
        points: [
          node(a.index, p1, 'S1'),
          node(trough.index, neckPx, 'N'),
          node(b.index, p2, 'S2'),
        ],
        silhouette: [
          node(a.index, p1),
          node(trough.index, neckPx),
          node(b.index, p2),
        ],
        overlayUpper: [node(a.index, topLevel), node(b.index, topLevel)],
        overlayLower: [node(trough.index, neckPx), node(b.index, neckPx)],
        targetLine: null,
      });
    }
  }

  // —— Double creux (W)
  for (let i = 0; i < rl.length - 1; i++) {
    for (let j = i + 1; j < rl.length; j++) {
      const a = rl[i];
      const b = rl[j];
      if (b.index - a.index < 5 || b.index - a.index > 80) continue;
      if (!near(a.price, b.price, tol)) continue;
      const mid = between(rh, a.index, b.index);
      if (!mid.length) continue;
      const peak = mid.sort((x, y) => y.price - x.price)[0];
      const p1 = candleExt(candles, a.index, 'low') ?? a.price;
      const p2 = candleExt(candles, b.index, 'low') ?? b.price;
      const neckPx = candleExt(candles, peak.index, 'high') ?? peak.price;
      const botLevel = (p1 + p2) / 2;
      const height = neckPx - botLevel;
      if (height < atrVal * 1.2) continue;

      const loAfter = minLowSince(candles, b.index + 1);
      const invalidated = loAfter < botLevel - tol * 0.8;
      const target = neckPx + height;
      // Objectif déjà dépassé → figure terminée, on ne la propose plus
      if (targetAlreadyHit('haussier', price, target)) continue;
      if (maxHighSince(candles, b.index + 1) >= target) continue;

      const confirmed = !invalidated && price > neckPx;
      const forming = !invalidated && !confirmed && price >= botLevel - tol * 0.3;
      if (!forming && !confirmed) continue;
      if (forming && last - b.index > 40) continue;
      if (confirmed && last - b.index > 60) continue;

      const score =
        50 +
        Math.min(25, (height / atrVal) * 4) +
        (confirmed ? 20 : 8) +
        Math.max(0, 18 - (last - b.index) * 0.35);

      found.push({
        id: `db-${a.index}-${b.index}`,
        key: 'double_bottom',
        name: 'Double creux',
        bias: 'haussier',
        confirmed,
        invalidated: false,
        status: confirmed ? 'cassé (confirmation)' : 'en formation / à surveiller',
        confidence: Math.min(96, Math.round(score)),
        neckline: neckPx,
        target,
        detail: confirmed
          ? `Résistance ${fmtP(neckPx)} franchie. Objectif potentiel ~${fmtP(target)}.`
          : `Deux creux proches. Une clôture au-dessus de ${fmtP(neckPx)} validerait la figure.`,
        points: [
          node(a.index, p1, 'C1'),
          node(peak.index, neckPx, 'N'),
          node(b.index, p2, 'C2'),
        ],
        silhouette: [
          node(a.index, p1),
          node(peak.index, neckPx),
          node(b.index, p2),
        ],
        overlayUpper: [node(peak.index, neckPx), node(b.index, neckPx)],
        overlayLower: [node(a.index, botLevel), node(b.index, botLevel)],
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

    const lp = candleExt(candles, l.index, 'high') ?? l.price;
    const hp = candleExt(candles, h.index, 'high') ?? h.price;
    const rp = candleExt(candles, r.index, 'high') ?? r.price;
    const lvP = candleExt(candles, lv.index, 'low') ?? lv.price;
    const rvP = candleExt(candles, rv.index, 'low') ?? rv.price;
    const neck = (lvP + rvP) / 2;
    const height = hp - neck;
    if (height < atrVal * 1.3) continue;

    const hiAfter = maxHighSince(candles, r.index + 1);
    const invalidated = hiAfter > hp + tol * 0.5;
    const target = neck - height;
    if (targetAlreadyHit('baissier', price, target)) continue;
    if (minLowSince(candles, r.index + 1) <= target) continue;

    const confirmed = !invalidated && price < neck;
    const forming = !invalidated && !confirmed && price < hp;
    if (!forming && !confirmed) continue;
    if (forming && last - r.index > 40) continue;
    if (confirmed && last - r.index > 60) continue;

    const score =
      55 +
      Math.min(20, (height / atrVal) * 3) +
      (confirmed ? 18 : 6) +
      (near(lvP, rvP, tol * 1.2) ? 8 : 0) +
      Math.max(0, 10 - (last - r.index) * 0.2);

    found.push({
      id: `hs-${l.index}-${r.index}`,
      key: 'head_shoulders',
      name: 'Épaule-tête-épaule',
      bias: 'baissier',
      confirmed,
      invalidated: false,
      status: confirmed ? 'cassé (confirmation)' : 'en formation / à surveiller',
      confidence: Math.min(96, Math.round(score)),
      neckline: neck,
      target,
      detail: confirmed
        ? `Neckline cassée. Objectif potentiel ~${fmtP(target)}.`
        : `Tête au-dessus des épaules. Surveillance sous ${fmtP(neck)}.`,
      points: [
        node(l.index, lp, 'ÉG'),
        node(h.index, hp, 'T'),
        node(r.index, rp, 'ÉD'),
      ],
      silhouette: [
        node(l.index, lp),
        node(lv.index, lvP),
        node(h.index, hp),
        node(rv.index, rvP),
        node(r.index, rp),
      ],
      overlayUpper: null,
      overlayLower: [node(lv.index, neck), node(rv.index, neck)],
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

    const lLo = candleExt(candles, l.index, 'low') ?? l.price;
    const hLo = candleExt(candles, h.index, 'low') ?? h.price;
    const rLo = candleExt(candles, r.index, 'low') ?? r.price;
    const lpH = candleExt(candles, lp.index, 'high') ?? lp.price;
    const rpH = candleExt(candles, rp.index, 'high') ?? rp.price;
    const neck = (lpH + rpH) / 2;
    const height = neck - hLo;
    if (height < atrVal * 1.3) continue;

    const loAfter = minLowSince(candles, r.index + 1);
    const invalidated = loAfter < hLo - tol * 0.5;
    const target = neck + height;
    if (targetAlreadyHit('haussier', price, target)) continue;
    if (maxHighSince(candles, r.index + 1) >= target) continue;

    const confirmed = !invalidated && price > neck;
    const forming = !invalidated && !confirmed && price > hLo;
    if (!forming && !confirmed) continue;
    if (forming && last - r.index > 40) continue;
    if (confirmed && last - r.index > 60) continue;

    const score =
      55 +
      Math.min(20, (height / atrVal) * 3) +
      (confirmed ? 18 : 6) +
      (near(lpH, rpH, tol * 1.2) ? 8 : 0) +
      Math.max(0, 10 - (last - r.index) * 0.2);

    found.push({
      id: `ihs-${l.index}-${r.index}`,
      key: 'inv_head_shoulders',
      name: 'Épaule-tête-épaule inversée',
      bias: 'haussier',
      confirmed,
      invalidated: false,
      status: confirmed ? 'cassé (confirmation)' : 'en formation / à surveiller',
      confidence: Math.min(96, Math.round(score)),
      neckline: neck,
      target,
      detail: confirmed
        ? `Neckline franchie. Objectif potentiel ~${fmtP(target)}.`
        : `Creux central plus bas. Surveillance au-dessus de ${fmtP(neck)}.`,
      points: [
        node(l.index, lLo, 'ÉG'),
        node(h.index, hLo, 'T'),
        node(r.index, rLo, 'ÉD'),
      ],
      silhouette: [
        node(l.index, lLo),
        node(lp.index, lpH),
        node(h.index, hLo),
        node(rp.index, rpH),
        node(r.index, rLo),
      ],
      overlayUpper: [node(lp.index, neck), node(rp.index, neck)],
      overlayLower: null,
      targetLine: null,
    });
  }

  const triangle = detectTriangle(candles, rh, rl, atrVal, price, last);
  if (triangle) found.push(triangle);

  // Écarte les figures déjà jouées / trop vieilles
  const fresh = found.filter((p) => !isStalePattern(p, candles, price));

  // Une seule figure par type : plus récente, puis score
  const byKey = new Map();
  for (const p of fresh) {
    const prev = byKey.get(p.key);
    if (!prev) {
      byKey.set(p.key, p);
      continue;
    }
    const pEnd = p.silhouette?.at(-1)?.index ?? 0;
    const prevEnd = prev.silhouette?.at(-1)?.index ?? 0;
    const better =
      pEnd - prevEnd ||
      Number(p.confirmed) - Number(prev.confirmed) ||
      p.confidence - prev.confidence;
    if (better > 0) byKey.set(p.key, p);
  }

  return [...byKey.values()]
    .sort(
      (a, b) =>
        (b.silhouette?.at(-1)?.index ?? 0) - (a.silhouette?.at(-1)?.index ?? 0) ||
        Number(b.confirmed) - Number(a.confirmed) ||
        b.confidence - a.confidence,
    )
    .slice(0, 3)
    .map((p) => withProjection(p, candles))
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

  const uh1 = candleExt(candles, h1.index, 'high') ?? h1.price;
  const uh2 = candleExt(candles, h2.index, 'high') ?? h2.price;
  const ul1 = candleExt(candles, l1.index, 'low') ?? l1.price;
  const ul2 = candleExt(candles, l2.index, 'low') ?? l2.price;
  const upper = (uh1 + uh2) / 2;
  const lower = (ul1 + ul2) / 2;
  const compressing = Math.abs(uh2 - ul2) < Math.abs(uh1 - ul1);
  if (!compressing && key.includes('triangle')) return null;

  const brokenUp = price > Math.max(uh1, uh2);
  const brokenDown = price < Math.min(ul1, ul2);

  // Invalidation : cassure dans le sens opposé au biais
  if (bias === 'haussier' && brokenDown) return null;
  if (bias === 'baissier' && brokenUp) return null;

  let status = 'en formation / compression';
  let confirmed = false;
  if (brokenUp && bias !== 'baissier') {
    status = 'cassure haussière';
    confirmed = true;
    bias = 'haussier';
  }
  if (brokenDown && bias !== 'haussier') {
    status = 'cassure baissière';
    confirmed = true;
    bias = 'baissier';
  }

  const endIdx = Math.max(h2.index, l2.index);
  if (!confirmed && last - endIdx > 35) return null;

  const score =
    48 +
    (compressing ? 12 : 0) +
    (confirmed ? 18 : 0) +
    Math.max(0, 10 - (last - endIdx) * 0.2);

  const swings = [
    node(h1.index, uh1, 'H1'),
    node(l1.index, ul1, 'B1'),
    node(h2.index, uh2, 'H2'),
    node(l2.index, ul2, 'B2'),
  ].sort((a, b) => a.index - b.index);

  const height = Math.abs(upper - lower);
  let target = null;
  let neckline = bias === 'haussier' ? upper : lower;
  if (bias === 'haussier') {
    target = upper + height;
    neckline = upper;
  } else if (bias === 'baissier') {
    target = lower - height;
    neckline = lower;
  }
  if (targetAlreadyHit(bias, price, target)) return null;
  if (confirmed && last - endIdx > 48) return null;

  return {
    id: `${key}-${h1.index}-${l2.index}`,
    key,
    name,
    bias,
    confirmed,
    invalidated: false,
    status,
    confidence: Math.min(92, Math.round(score)),
    neckline,
    target,
    detail: target
      ? `${name} entre ~${fmtP(lower)} et ~${fmtP(upper)}. ${status}. Objectif potentiel ~${fmtP(target)}.`
      : `${name} entre ~${fmtP(lower)} et ~${fmtP(upper)}. ${status}.`,
    points: swings,
    silhouette: swings,
    overlayUpper: [node(h1.index, uh1), node(h2.index, uh2)],
    overlayLower: [node(l1.index, ul1), node(l2.index, ul2)],
    showChannel: true,
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
    trace: mapPts(pattern.trace),
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
  const d =
    abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : abs >= 0.0001 ? 6 : 8;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}
