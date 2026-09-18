import { analyzeCoin } from './analyze.js';
import { fmt } from '../src/lib/analysis.js';
import { evaluateSincePrevious, toSnapshot } from '../src/lib/alerts.js';
import {
  getLastSnapshot,
  appendSnapshot,
  filterNewEvents,
} from './historyStore.js';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatCoinBlock(coin, a, retro) {
  const sign = a.changePct >= 0 ? '+' : '';
  const s1 = a.levelRows.find((r) => r.level === 'S1');
  const r1 = a.levelRows.find((r) => r.level === 'R1');
  const lines = [
    `<b>${esc(coin)}</b>  ${fmt(a.price, a.digits)}  (${sign}${a.changePct.toFixed(2)}%)`,
    `Biais : <b>${esc(a.bias)}</b>`,
    `RSI ${a.rsiNow != null ? a.rsiNow.toFixed(1) : '—'} · MM50 ${fmt(a.m50, a.digits)} · MM200 ${fmt(a.m200, a.digits)}`,
    `S1 ${s1 ? esc(s1.priceLabel) : '—'} · R1 ${r1 ? esc(r1.priceLabel) : '—'}`,
    `Achat : entrée ${esc(a.long.entry)} · stop ${esc(a.long.stop)} · TP1 ${esc(a.long.tp1)}`,
    `Vente : entrée ${esc(a.short.entry)} · stop ${esc(a.short.stop)} · TP1 ${esc(a.short.tp1)}`,
  ];

  if (retro?.summaryLines?.length) {
    lines.push('');
    lines.push('<b>Rétrospective</b>');
    for (const l of retro.summaryLines) lines.push(esc(l));
    const conf = (retro.events || []).filter((e) => e.kind === 'confirmation');
    const inv = (retro.events || []).filter((e) => e.kind === 'invalidation');
    for (const e of conf.slice(0, 4)) {
      lines.push(`✅ ${esc(e.title)} — ${esc(e.detail)}`);
    }
    for (const e of inv.slice(0, 4)) {
      lines.push(`🛑 ${esc(e.title)} — ${esc(e.detail)}`);
    }
  } else {
    lines.push('<i>Première analyse enregistrée (rétrospective au prochain passage).</i>');
  }

  return lines.join('\n');
}

export async function buildReport({ assets, interval, persist = true }) {
  const now = new Date().toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const blocks = [];
  const errors = [];
  const allNewAlerts = [];

  for (const coin of assets) {
    try {
      const { analysis, candles } = await analyzeCoin(coin, interval);
      const prev = getLastSnapshot(coin, interval);
      const retro = prev
        ? evaluateSincePrevious(prev, analysis, candles)
        : null;

      if (retro?.events?.length) {
        for (const e of retro.events) allNewAlerts.push({ coin, ...e });
      }

      blocks.push(formatCoinBlock(coin, analysis, retro));

      if (persist) {
        appendSnapshot(toSnapshot(coin, interval, analysis));
      }
    } catch (err) {
      errors.push(`${coin} : ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const header = [
    `📊 <b>HL Analyse — compte rendu</b>`,
    `${esc(now)} (Paris) · horizon ${esc(interval)}`,
    ``,
  ].join('\n');

  let body = blocks.join('\n\n————\n\n');
  if (errors.length) {
    body += `\n\n⚠️ ${errors.map(esc).join(' · ')}`;
  }
  body += `\n\n<i>Aide à la lecture, pas un conseil financier.</i>`;

  return { text: header + body, alerts: allNewAlerts };
}

/** Messages d’alarme uniquement (nouveaux événements) */
export async function buildAlertMessages({ assets, interval }) {
  const messages = [];
  const now = new Date().toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  for (const coin of assets) {
    try {
      const { analysis, candles } = await analyzeCoin(coin, interval);
      const prev = getLastSnapshot(coin, interval);
      if (!prev) {
        appendSnapshot(toSnapshot(coin, interval, analysis));
        continue;
      }

      const { events, summaryLines } = evaluateSincePrevious(prev, analysis, candles);
      const fresh = filterNewEvents(events);
      if (fresh.length) {
        const lines = [
          `🚨 <b>Alarme ${esc(coin)}</b> · ${esc(now)}`,
          `Prix ${fmt(analysis.price, analysis.digits)} · biais ${esc(analysis.bias)}`,
          ``,
        ];
        for (const e of fresh) {
          const icon =
            e.kind === 'confirmation' ? '✅' : e.kind === 'invalidation' ? '🛑' : 'ℹ️';
          lines.push(`${icon} <b>${esc(e.title)}</b>`);
          lines.push(esc(e.detail));
        }
        lines.push('');
        lines.push(esc(summaryLines[0] || ''));
        messages.push(lines.join('\n'));
      }

      // Met à jour la photo du marché pour la prochaine rétrospective
      // (seulement si on a eu des événements, sinon on garde le scénario de référence
      // jusqu’au compte rendu 4h — en pratique on met à jour le prix de suivi via un
      // snapshot "léger" ? Non : on veut comparer au dernier rapport complet.
      // Donc on NE remplace PAS le snapshot ici.)
    } catch (err) {
      console.error(`[alerte ${coin}]`, err.message);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return messages;
}
