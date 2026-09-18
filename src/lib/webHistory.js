const KEY = 'hl-ta-history-v1';
const FIRED = 'hl-ta-fired-v1';
const MAX_PER_KEY = 40;

function keyOf(coin, interval) {
  return `${coin}::${interval}`;
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

export function getLastSnapshot(coin, interval) {
  const hist = read(KEY, { series: {} });
  const list = hist.series[keyOf(coin, interval)] || [];
  return list.length ? list[list.length - 1] : null;
}

export function getRecentSnapshots(coin, interval, n = 5) {
  const hist = read(KEY, { series: {} });
  const list = hist.series[keyOf(coin, interval)] || [];
  return list.slice(-n);
}

export function appendSnapshot(snapshot) {
  const hist = read(KEY, { series: {} });
  const key = keyOf(snapshot.coin, snapshot.interval);
  const list = hist.series[key] || [];
  // Évite de doubler si rechargement < 2 min
  const last = list[list.length - 1];
  if (last && snapshot.at - last.at < 120000) {
    list[list.length - 1] = snapshot;
  } else {
    list.push(snapshot);
  }
  while (list.length > MAX_PER_KEY) list.shift();
  hist.series[key] = list;
  write(KEY, hist);
}

export function markFired(ids) {
  const fired = read(FIRED, { ids: {} });
  const now = Date.now();
  for (const id of ids) fired.ids[id] = now;
  write(FIRED, fired);
}

export function filterNewEvents(events) {
  const fired = read(FIRED, { ids: {} });
  return events.filter((e) => !fired.ids[e.id]);
}
