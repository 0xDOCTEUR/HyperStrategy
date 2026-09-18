function fmt(n, digits) {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  let d = digits;
  if (d == null) {
    if (abs >= 1000) d = 2;
    else if (abs >= 1) d = 4;
    else d = 6;
  }
  return n.toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function zone(low, high, digits) {
  return `${fmt(low, digits)}–${fmt(high, digits)}`;
}

export function buildAnalysis(candles, computed) {
  const {
    ma50,
    ma100,
    ma200,
    rsiArr,
    macdObj,
    levels,
    trendline,
  } = computed;

  const last = candles.length - 1;
  const price = candles[last].close;
  const prev = candles[Math.max(0, last - 1)].close;
  const change = price - prev;
  const changePct = prev ? (change / prev) * 100 : 0;

  const m50 = ma50[last];
  const m100 = ma100[last];
  const m200 = ma200[last];
  const rsiNow = rsiArr[last];
  const macdLine = macdObj.line[last];
  const macdSignal = macdObj.signal[last];
  const macdHist = macdObj.hist[last];
  const prevHist = macdObj.hist[last - 1];

  const above50 = m50 != null && price > m50;
  const above100 = m100 != null && price > m100;
  const above200 = m200 != null && price > m200;
  const goldenCross = m50 != null && m200 != null && m50 > m200;
  const deathCross = m50 != null && m200 != null && m50 < m200;

  let rsiLabel = 'neutre';
  if (rsiNow != null) {
    if (rsiNow >= 70) rsiLabel = 'surachat';
    else if (rsiNow <= 30) rsiLabel = 'sursvente';
    else if (rsiNow >= 55) rsiLabel = 'neutre, au-dessus de 50';
    else if (rsiNow <= 45) rsiLabel = 'neutre, sous 50';
  }

  let macdLabel = 'indisponible';
  if (macdLine != null && macdSignal != null) {
    if (macdLine > macdSignal) {
      macdLabel =
        macdHist != null && prevHist != null && macdHist > prevHist
          ? 'ligne au-dessus du signal (momentum en hausse)'
          : 'ligne au-dessus du signal';
    } else {
      macdLabel =
        macdHist != null && prevHist != null && macdHist < prevHist
          ? 'ligne sous le signal (affaiblissement)'
          : 'ligne sous le signal';
    }
  }

  const byName = Object.fromEntries(levels.rows.map((r) => [r.level, r]));
  const digits = price >= 1000 ? 0 : price >= 1 ? 2 : 4;
  const atrVal = levels.atr;

  const techBullets = [
    `Prix ${above50 ? 'au-dessus' : 'sous'} MM50 (${fmt(m50, digits)})`,
    `Prix ${above200 ? 'au-dessus' : 'sous'} MM200 (${fmt(m200, digits)})`,
    `Croisement doré (MM50 > MM200) : ${goldenCross ? 'OUI' : 'NON'}`,
    deathCross ? 'Croisement mort (MM50 < MM200) : OUI' : null,
    `RSI(14) ${rsiNow != null ? rsiNow.toFixed(2) : '—'} — ${rsiLabel}`,
    `MACD — ${macdLabel}`,
    trendline
      ? 'Ligne de tendance haussière détectée (plus bas croissants)'
      : 'Pas de ligne de tendance haussière claire',
  ].filter(Boolean);

  // Scénario long
  const s1 = byName.S1;
  const r1 = byName.R1;
  const r2 = byName.R2;
  const r3 = byName.R3;
  const s2 = byName.S2;
  const s3 = byName.S3;

  const longEntryLow = s1 ? Math.min(s1.mid, price - atrVal * 0.3) : price - atrVal;
  const longEntryHigh = Math.min(price, s1 ? s1.high : price);
  const longNums = {
    entryLow: Math.min(longEntryLow, longEntryHigh),
    entryHigh: Math.max(longEntryLow, longEntryHigh),
    tp1: r1?.mid ?? price + atrVal * 1.2,
    tp2: r2?.mid ?? price + atrVal * 2.2,
    tp3: r3?.mid ?? price + atrVal * 3.5,
    stop: s2?.mid ?? price - atrVal * 1.8,
  };
  const long = {
    ...longNums,
    entry: zone(longNums.entryLow, longNums.entryHigh, digits),
    tp1: fmt(longNums.tp1, digits),
    tp2: fmt(longNums.tp2, digits),
    tp3: fmt(longNums.tp3, digits),
    stop: fmt(longNums.stop, digits),
    note: above50
      ? 'Privilégier un repli vers S1 / MM50'
      : 'Attendre reprise au-dessus de la MM50',
    tp1Num: longNums.tp1,
    tp2Num: longNums.tp2,
    tp3Num: longNums.tp3,
    stopNum: longNums.stop,
  };

  const shortEntryLow = Math.max(price, r1?.low ?? price);
  const shortEntryHigh = r1?.high ?? price + atrVal;
  const shortNums = {
    entryLow: shortEntryLow,
    entryHigh: shortEntryHigh,
    tp1: s1?.mid ?? price - atrVal * 1.2,
    tp2: s2?.mid ?? price - atrVal * 2.2,
    tp3: s3?.mid ?? price - atrVal * 3.5,
    stop: r2?.mid ?? price + atrVal * 1.8,
  };
  const short = {
    ...shortNums,
    entry: zone(shortNums.entryLow, shortNums.entryHigh, digits),
    tp1: fmt(shortNums.tp1, digits),
    tp2: fmt(shortNums.tp2, digits),
    tp3: fmt(shortNums.tp3, digits),
    stop: fmt(shortNums.stop, digits),
    note: 'Seulement après rejet clair sous R1',
    tp1Num: shortNums.tp1,
    tp2Num: shortNums.tp2,
    tp3Num: shortNums.tp3,
    stopNum: shortNums.stop,
  };

  let bias = 'neutre';
  let summary = '';
  const bullScore =
    (above50 ? 1 : 0) +
    (above200 ? 1 : 0) +
    (goldenCross ? 1 : 0) +
    (rsiNow != null && rsiNow >= 50 ? 1 : 0) +
    (macdLine != null && macdSignal != null && macdLine > macdSignal ? 1 : 0) +
    (trendline ? 1 : 0);

  if (bullScore >= 4) {
    bias = 'achat sur replis';
    summary = `${fmt(price, digits)} tient au-dessus de la pile de moyennes. Structure plutôt haussière. Biais : ${bias} vers S1. Vente seulement sur rejet de R1.`;
  } else if (bullScore <= 2) {
    bias = 'vente sur rebonds';
    summary = `${fmt(price, digits)} sous pression face aux moyennes. Structure plutôt baissière. Biais : ${bias} sous R1. Achat seulement si reprise nette au-dessus de R1.`;
  } else {
    bias = 'range / attentiste';
    summary = `${fmt(price, digits)} entre supports et résistances sans signal dominant. Biais : ${bias}. Trader les bornes S1 / R1 jusqu’à cassure claire.`;
  }

  return {
    price,
    change,
    changePct,
    open: candles[last].open,
    high: candles[last].high,
    low: candles[last].low,
    close: candles[last].close,
    m50,
    m100,
    m200,
    rsiNow,
    macdLine,
    macdSignal,
    macdHist,
    goldenCross,
    deathCross,
    above50,
    above200,
    techBullets,
    long,
    short,
    summary,
    bias,
    bullScore,
    levelRows: levels.rows.map((r) => ({
      ...r,
      priceLabel: zone(r.low, r.high, digits),
    })),
    levels: {
      S1: s1?.mid ?? null,
      S2: s2?.mid ?? null,
      S3: s3?.mid ?? null,
      R1: r1?.mid ?? null,
      R2: r2?.mid ?? null,
      R3: r3?.mid ?? null,
    },
    digits,
    at: Date.now(),
  };
}

export { fmt };
