import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'data');
const historyPath = resolve(dataDir, 'history.json');
const firedPath = resolve(dataDir, 'fired-alerts.json');

const MAX_PER_KEY = 40;

function ensure() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  ensure();
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

function keyOf(coin, interval) {
  return `${coin}::${interval}`;
}

export function loadHistory() {
  return readJson(historyPath, { versions: 1, series: {} });
}

export function getLastSnapshot(coin, interval) {
  const hist = loadHistory();
  const list = hist.series[keyOf(coin, interval)] || [];
  return list.length ? list[list.length - 1] : null;
}

export function appendSnapshot(snapshot) {
  const hist = loadHistory();
  const key = keyOf(snapshot.coin, snapshot.interval);
  const list = hist.series[key] || [];
  list.push(snapshot);
  while (list.length > MAX_PER_KEY) list.shift();
  hist.series[key] = list;
  writeJson(historyPath, hist);
  return snapshot;
}

export function loadFired() {
  return readJson(firedPath, { ids: {} });
}

/** Filtre les événements déjà envoyés ; marque les nouveaux comme envoyés */
export function filterNewEvents(events) {
  const fired = loadFired();
  const fresh = [];
  const now = Date.now();
  for (const e of events) {
    if (fired.ids[e.id]) continue;
    fresh.push(e);
    fired.ids[e.id] = now;
  }
  // Nettoyage > 14 jours
  const cut = now - 14 * 24 * 3600 * 1000;
  for (const id of Object.keys(fired.ids)) {
    if (fired.ids[id] < cut) delete fired.ids[id];
  }
  writeJson(firedPath, fired);
  return fresh;
}

/** Variante lecture seule (page web / preview) */
export function peekNewEvents(events, firedIds) {
  return events.filter((e) => !firedIds[e.id]);
}
