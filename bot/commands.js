import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport } from './report.js';
import { analyzeCoin } from './analyze.js';
import { evaluateSincePrevious, toSnapshot } from '../src/lib/alerts.js';
import { getLastSnapshot, appendSnapshot } from './historyStore.js';
import { fmt } from '../src/lib/analysis.js';
import { sendTelegramMessage, getUpdates, setMyCommands } from './telegram.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const offsetPath = resolve(root, 'data', 'telegram-offset.json');

function loadOffset() {
  try {
    if (!existsSync(offsetPath)) return 0;
    return Number(JSON.parse(readFileSync(offsetPath, 'utf8')).offset) || 0;
  } catch {
    return 0;
  }
}

function saveOffset(offset) {
  const dir = resolve(root, 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(offsetPath, JSON.stringify({ offset }, null, 2), 'utf8');
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function perfArrow(changePct) {
  if (changePct == null || !Number.isFinite(changePct)) return '→';
  if (changePct > 0.1) return '↑';
  if (changePct < -0.1) return '↓';
  return '→';
}

function parseCommand(text) {
  if (!text || !text.startsWith('/')) return null;
  // /rapport@botname args
  const raw = text.trim().split(/\s+/)[0];
  const cmd = raw.slice(1).split('@')[0].toLowerCase();
  const args = text.trim().slice(raw.length).trim();
  return { cmd, args };
}

function helpText() {
  return [
    `<b>HyperStrategy — commandes</b>`,
    ``,
    `/rapport — compte rendu des actifs suivis`,
    `/analyse BTC — analyse d’un actif`,
    `/btc — raccourci (marche aussi /eth /sol /hype…)`,
    `/help — cette aide`,
    ``,
    `<i>Dans un groupe, tape la commande telle quelle (ex. /rapport).</i>`,
  ].join('\n');
}

async function sendChunks(token, chatId, text) {
  const max = 4000;
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.4) cut = max;
    await sendTelegramMessage(token, chatId, rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) await sendTelegramMessage(token, chatId, rest);
}

async function formatSingle(coin, interval) {
  const { analysis, candles } = await analyzeCoin(coin, interval);
  const prev = getLastSnapshot(coin, interval);
  const retro = prev ? evaluateSincePrevious(prev, analysis, candles) : null;
  appendSnapshot(toSnapshot(coin, interval, analysis));

  const sign = analysis.changePct >= 0 ? '+' : '';
  const arrow = perfArrow(analysis.changePct);
  const s1 = analysis.levelRows.find((r) => r.level === 'S1');
  const r1 = analysis.levelRows.find((r) => r.level === 'R1');

  const lines = [
    `📊 <b>HyperStrategy</b>`,
    `${arrow} <b>${esc(coin)}</b>  ${fmt(analysis.price, analysis.digits)}  (${sign}${analysis.changePct.toFixed(2)}%)`,
    `Biais : <b>${esc(analysis.bias)}</b>`,
    `RSI ${analysis.rsiNow != null ? analysis.rsiNow.toFixed(1) : '—'} · MM50 ${fmt(analysis.m50, analysis.digits)} · MM200 ${fmt(analysis.m200, analysis.digits)}`,
    `S1 ${s1 ? esc(s1.priceLabel) : '—'} · R1 ${r1 ? esc(r1.priceLabel) : '—'}`,
    `Achat : entrée ${esc(analysis.long.entry)} · stop ${esc(analysis.long.stop)} · TP1 ${esc(analysis.long.tp1)}`,
    `Vente : entrée ${esc(analysis.short.entry)} · stop ${esc(analysis.short.stop)} · TP1 ${esc(analysis.short.tp1)}`,
  ];

  if (retro?.summaryLines?.length) {
    lines.push('');
    lines.push('<b>Rétrospective</b>');
    for (const l of retro.summaryLines) lines.push(esc(l));
    for (const e of (retro.events || []).filter((x) => x.kind === 'confirmation').slice(0, 3)) {
      lines.push(`✅ ${esc(e.title)} — ${esc(e.detail)}`);
    }
    for (const e of (retro.events || []).filter((x) => x.kind === 'invalidation').slice(0, 3)) {
      lines.push(`🛑 ${esc(e.title)} — ${esc(e.detail)}`);
    }
  }

  lines.push('');
  lines.push('<i>Aide à la lecture, pas un conseil financier.</i>');
  return lines.join('\n');
}

export async function handleMessage(cfg, message) {
  const text = message.text || message.caption || '';
  const parsed = parseCommand(text);
  if (!parsed) return false;

  const chatId = message.chat.id;
  const { cmd, args } = parsed;
  const interval = cfg.interval;

  try {
    if (cmd === 'start' || cmd === 'help' || cmd === 'aide') {
      await sendChunks(cfg.token, chatId, helpText());
      return true;
    }

    if (cmd === 'rapport' || cmd === 'report') {
      await sendTelegramMessage(cfg.token, chatId, '⏳ Génération du compte rendu…');
      const { text: report } = await buildReport({
        assets: cfg.assets,
        interval,
        persist: true,
      });
      await sendChunks(cfg.token, chatId, report);
      return true;
    }

    if (cmd === 'analyse' || cmd === 'a') {
      const coin = (args.split(/\s+/)[0] || '').toUpperCase();
      if (!coin) {
        await sendTelegramMessage(
          cfg.token,
          chatId,
          'Usage : <code>/analyse BTC</code>',
        );
        return true;
      }
      await sendTelegramMessage(cfg.token, chatId, `⏳ Analyse de ${coin}…`);
      const body = await formatSingle(coin, interval);
      await sendChunks(cfg.token, chatId, body);
      return true;
    }

    // Raccourci /btc /eth /sol …
    if (/^[a-z0-9]{2,15}$/i.test(cmd) && !['start', 'help', 'aide', 'rapport', 'report', 'analyse', 'a'].includes(cmd)) {
      const coin = cmd.toUpperCase();
      await sendTelegramMessage(cfg.token, chatId, `⏳ Analyse de ${coin}…`);
      const body = await formatSingle(coin, interval);
      await sendChunks(cfg.token, chatId, body);
      return true;
    }
  } catch (err) {
    await sendTelegramMessage(
      cfg.token,
      chatId,
      `⚠️ Erreur : ${esc(err.message || 'inconnue')}`,
    );
    return true;
  }

  return false;
}

/** Traite les messages en attente (une passe) */
export async function processCommandsOnce(cfg) {
  let offset = loadOffset();
  const updates = await getUpdates(cfg.token, offset, 0);
  let handled = 0;

  for (const upd of updates) {
    offset = upd.update_id + 1;
    const msg = upd.message;
    if (!msg) continue;
    const ok = await handleMessage(cfg, msg);
    if (ok) handled += 1;
  }

  if (updates.length) saveOffset(offset);
  return { handled, seen: updates.length };
}

/** Écoute longue (PC allumé / serveur) */
export async function pollCommandsLoop(cfg) {
  console.log('[bot] Commandes actives : /rapport /analyse BTC /btc /help');
  try {
    await setMyCommands(cfg.token, [
      { command: 'rapport', description: 'Compte rendu des actifs suivis' },
      { command: 'analyse', description: 'Analyse d’un actif (ex. /analyse ETH)' },
      { command: 'help', description: 'Liste des commandes' },
    ]);
  } catch (err) {
    console.warn('[bot] setMyCommands:', err.message);
  }

  let offset = loadOffset();
  for (;;) {
    try {
      const updates = await getUpdates(cfg.token, offset, 25);
      for (const upd of updates) {
        offset = upd.update_id + 1;
        saveOffset(offset);
        const msg = upd.message;
        if (!msg) continue;
        await handleMessage(cfg, msg);
      }
    } catch (err) {
      console.error('[bot] poll:', err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
