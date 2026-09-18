/**
 * Compare une analyse précédente au marché actuel.
 * Renvoie des événements : confirmation | invalidation | info
 */

function extremeSince(candles, sinceMs) {
  if (!sinceMs || !candles.length) {
    const last = candles[candles.length - 1];
    return { high: last?.high ?? null, low: last?.low ?? null, last };
  }
  const sinceSec = Math.floor(sinceMs / 1000);
  // Bougies ouvertes après l’analyse précédente
  let slice = candles.filter((c) => c.time >= sinceSec);
  // Si on est encore dans la même bougie, prendre au moins la dernière
  if (!slice.length) {
    const last = candles[candles.length - 1];
    // Uniquement si la dernière bougie chevauche la période (ouverte avant, pas encore close)
    if (last && last.time * 1000 <= sinceMs) {
      slice = [last];
    }
  }
  if (!slice.length) {
    const last = candles[candles.length - 1];
    return { high: last.close, low: last.close, last };
  }
  let high = -Infinity;
  let low = Infinity;
  for (const c of slice) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  return { high, low, last: candles[candles.length - 1] };
}

function push(events, evt) {
  events.push({
    id: evt.id,
    kind: evt.kind, // 'confirmation' | 'invalidation' | 'info'
    title: evt.title,
    detail: evt.detail,
  });
}

/**
 * @param {object} prev - snapshot sauvé
 * @param {object} curr - analyse actuelle
 * @param {array} candles - bougies actuelles (même horizon)
 */
export function evaluateSincePrevious(prev, curr, candles) {
  if (!prev || !curr) return { events: [], summaryLines: [] };

  const events = [];
  const since = prev.at || 0;
  const { high, low } = extremeSince(candles, since);
  const price = curr.price;
  const digits = curr.digits ?? 2;

  const fmtN = (n) =>
    n == null || !Number.isFinite(n)
      ? '—'
      : n.toLocaleString('en-US', {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });

  // —— Scénario achat (niveaux de la précédente analyse)
  const L = prev.long || {};
  if (L.tp1 != null && high >= L.tp1) {
    push(events, {
      id: `long-tp1-${prev.at}`,
      kind: 'confirmation',
      title: 'Achat : TP1 touché',
      detail: `Plus haut ${fmtN(high)} ≥ TP1 ${fmtN(L.tp1)}`,
    });
  }
  if (L.tp2 != null && high >= L.tp2) {
    push(events, {
      id: `long-tp2-${prev.at}`,
      kind: 'confirmation',
      title: 'Achat : TP2 touché',
      detail: `Plus haut ${fmtN(high)} ≥ TP2 ${fmtN(L.tp2)}`,
    });
  }
  if (L.tp3 != null && high >= L.tp3) {
    push(events, {
      id: `long-tp3-${prev.at}`,
      kind: 'confirmation',
      title: 'Achat : TP3 touché',
      detail: `Plus haut ${fmtN(high)} ≥ TP3 ${fmtN(L.tp3)}`,
    });
  }
  if (L.stop != null && low <= L.stop) {
    push(events, {
      id: `long-stop-${prev.at}`,
      kind: 'invalidation',
      title: 'Achat : stop touché',
      detail: `Plus bas ${fmtN(low)} ≤ stop ${fmtN(L.stop)}`,
    });
  }

  // —— Scénario vente
  const S = prev.short || {};
  if (S.tp1 != null && low <= S.tp1) {
    push(events, {
      id: `short-tp1-${prev.at}`,
      kind: 'confirmation',
      title: 'Vente : TP1 touché',
      detail: `Plus bas ${fmtN(low)} ≤ TP1 ${fmtN(S.tp1)}`,
    });
  }
  if (S.tp2 != null && low <= S.tp2) {
    push(events, {
      id: `short-tp2-${prev.at}`,
      kind: 'confirmation',
      title: 'Vente : TP2 touché',
      detail: `Plus bas ${fmtN(low)} ≤ TP2 ${fmtN(S.tp2)}`,
    });
  }
  if (S.tp3 != null && low <= S.tp3) {
    push(events, {
      id: `short-tp3-${prev.at}`,
      kind: 'confirmation',
      title: 'Vente : TP3 touché',
      detail: `Plus bas ${fmtN(low)} ≤ TP3 ${fmtN(S.tp3)}`,
    });
  }
  if (S.stop != null && high >= S.stop) {
    push(events, {
      id: `short-stop-${prev.at}`,
      kind: 'invalidation',
      title: 'Vente : stop touché',
      detail: `Plus haut ${fmtN(high)} ≥ stop ${fmtN(S.stop)}`,
    });
  }

  // —— Niveaux S1 / R1
  const prevS1 = prev.levels?.S1;
  const prevR1 = prev.levels?.R1;
  if (prevS1 != null && price < prevS1 && prev.price >= prevS1) {
    push(events, {
      id: `break-s1-${prev.at}`,
      kind: 'invalidation',
      title: 'Cassure de S1',
      detail: `Clôture ${fmtN(price)} sous S1 ${fmtN(prevS1)}`,
    });
  }
  if (prevR1 != null && price > prevR1 && prev.price <= prevR1) {
    push(events, {
      id: `break-r1-${prev.at}`,
      kind: 'confirmation',
      title: 'Cassure de R1',
      detail: `Clôture ${fmtN(price)} au-dessus de R1 ${fmtN(prevR1)}`,
    });
  }

  // —— Biais
  if (prev.bias && curr.bias && prev.bias !== curr.bias) {
    const bullish = (b) => b.includes('achat');
    const bearish = (b) => b.includes('vente');
    let kind = 'info';
    if (bullish(prev.bias) && bearish(curr.bias)) kind = 'invalidation';
    if (bearish(prev.bias) && bullish(curr.bias)) kind = 'invalidation';
    if (prev.bias.includes('range') && (bullish(curr.bias) || bearish(curr.bias))) {
      kind = 'confirmation';
    }
    push(events, {
      id: `bias-${prev.at}-${curr.bias}`,
      kind,
      title: 'Changement de biais',
      detail: `${prev.bias} → ${curr.bias}`,
    });
  }

  // —— Croisement doré perdu / gagné
  if (prev.goldenCross && curr.deathCross) {
    push(events, {
      id: `death-${prev.at}`,
      kind: 'invalidation',
      title: 'Croisement doré perdu',
      detail: 'MM50 repasse sous MM200',
    });
  }
  if (prev.deathCross && curr.goldenCross) {
    push(events, {
      id: `golden-${prev.at}`,
      kind: 'confirmation',
      title: 'Croisement doré formé',
      detail: 'MM50 repasse au-dessus de MM200',
    });
  }

  // —— Score rétrospectif simple
  const conf = events.filter((e) => e.kind === 'confirmation').length;
  const inv = events.filter((e) => e.kind === 'invalidation').length;
  const ageH = since ? ((Date.now() - since) / 3600000).toFixed(1) : '?';
  const summaryLines = [
    `Depuis la dernière analyse (~${ageH} h) : ${conf} confirmation(s), ${inv} invalidation(s).`,
    `Prix alors ${fmtN(prev.price)} → maintenant ${fmtN(price)} (${price >= prev.price ? '+' : ''}${(((price - prev.price) / prev.price) * 100).toFixed(2)}%).`,
    `Biais alors : ${prev.bias || '—'} · maintenant : ${curr.bias || '—'}.`,
  ];

  if (!events.length) {
    summaryLines.push('Aucun TP/stop/niveau clé touché depuis la dernière analyse.');
  }

  return { events, summaryLines, conf, inv };
}

export function toSnapshot(coin, interval, analysis) {
  return {
    coin,
    interval,
    at: analysis.at || Date.now(),
    price: analysis.price,
    bias: analysis.bias,
    bullScore: analysis.bullScore,
    rsiNow: analysis.rsiNow,
    goldenCross: !!analysis.goldenCross,
    deathCross: !!analysis.deathCross,
    above50: !!analysis.above50,
    above200: !!analysis.above200,
    levels: analysis.levels,
    long: {
      entryLow: analysis.long.entryLow,
      entryHigh: analysis.long.entryHigh,
      tp1: analysis.long.tp1Num ?? analysis.long.tp1,
      tp2: analysis.long.tp2Num ?? analysis.long.tp2,
      tp3: analysis.long.tp3Num ?? analysis.long.tp3,
      stop: analysis.long.stopNum ?? analysis.long.stop,
    },
    short: {
      entryLow: analysis.short.entryLow,
      entryHigh: analysis.short.entryHigh,
      tp1: analysis.short.tp1Num ?? analysis.short.tp1,
      tp2: analysis.short.tp2Num ?? analysis.short.tp2,
      tp3: analysis.short.tp3Num ?? analysis.short.tp3,
      stop: analysis.short.stopNum ?? analysis.short.stop,
    },
    summary: analysis.summary,
  };
}
