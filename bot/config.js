import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Charge un fichier .env simple (sans dépendance) */
export function loadEnv(filename = '.env') {
  const path = resolve(root, filename);
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

export function getBotConfig() {
  loadEnv();
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const assets = (process.env.TELEGRAM_ASSETS || 'BTC,ETH,SOL,HYPE')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const interval = (process.env.TELEGRAM_INTERVAL || '4h').trim();
  const everyHours = Number(process.env.TELEGRAM_EVERY_HOURS || 4);
  const sendOnStart = process.env.TELEGRAM_SEND_ON_START !== '0';

  if (!token) throw new Error('Manque TELEGRAM_BOT_TOKEN dans .env');
  if (!chatId) throw new Error('Manque TELEGRAM_CHAT_ID dans .env');

  return { token, chatId, assets, interval, everyHours, sendOnStart };
}
