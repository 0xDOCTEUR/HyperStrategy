import { getBotConfig } from './config.js';
import { buildReport, buildAlertMessages } from './report.js';
import { sendTelegramMessage } from './telegram.js';
import { processCommandsOnce, pollCommandsLoop } from './commands.js';

function splitMessage(text, max) {
  if (text.length <= max) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.4) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) parts.push(rest);
  return parts;
}

async function sendText(cfg, text) {
  const chunks = splitMessage(text, 4000);
  const targets = cfg.chatIds || [cfg.chatId];
  for (const chatId of targets) {
    for (const chunk of chunks) {
      await sendTelegramMessage(cfg.token, chatId, chunk);
    }
  }
  return chunks.length * targets.length;
}

async function runReport(cfg) {
  console.log(`[bot] Compte rendu (${cfg.assets.join(', ')})…`);
  const { text, alerts } = await buildReport({
    assets: cfg.assets,
    interval: cfg.interval,
  });
  const n = await sendText(cfg, text);
  console.log(
    `[bot] Rapport envoyé (${n} msg). Nouvelles alarmes dans le rapport: ${alerts.length}`,
  );
}

async function runAlerts(cfg) {
  console.log(`[bot] Vérification alarmes (${cfg.assets.join(', ')})…`);
  const messages = await buildAlertMessages({
    assets: cfg.assets,
    interval: cfg.interval,
  });
  if (!messages.length) {
    console.log('[bot] Aucune nouvelle alarme.');
    return;
  }
  for (const msg of messages) {
    await sendText(cfg, msg);
  }
  console.log(`[bot] ${messages.length} alarme(s) envoyée(s).`);
}

async function main() {
  const once = process.argv.includes('--once');
  const alertsOnly = process.argv.includes('--alerts');
  const commandsOnly = process.argv.includes('--commands');
  const cfg = getBotConfig();
  const reportMs = Math.max(0.25, cfg.everyHours) * 60 * 60 * 1000;
  const alertEveryMin = Number(process.env.TELEGRAM_ALERT_EVERY_MIN || 30);
  const alertMs = Math.max(5, alertEveryMin) * 60 * 1000;

  console.log(
    `[bot] Chats ${cfg.chatIds.join(', ')} · rapport /${cfg.everyHours}h · alarmes /${alertEveryMin}min · ${cfg.assets.join(', ')}`,
  );

  if (commandsOnly) {
    const r = await processCommandsOnce(cfg);
    console.log(`[bot] Commandes : ${r.handled} traitée(s) / ${r.seen} update(s)`);
    return;
  }

  if (alertsOnly) {
    try {
      await runAlerts(cfg);
    } catch (err) {
      console.error('[bot] Échec alarmes:', err.message);
      process.exitCode = 1;
    }
    return;
  }

  if (once || cfg.sendOnStart) {
    try {
      await runReport(cfg);
    } catch (err) {
      console.error('[bot] Échec rapport:', err.message);
      if (once) process.exitCode = 1;
    }
  }

  if (once) return;

  const listen = process.argv.includes('--listen');

  setInterval(async () => {
    try {
      await runReport(cfg);
    } catch (err) {
      console.error('[bot] Échec rapport:', err.message);
    }
  }, reportMs);

  setInterval(async () => {
    try {
      await runAlerts(cfg);
    } catch (err) {
      console.error('[bot] Échec alarmes:', err.message);
    }
  }, alertMs);

  console.log(
    `[bot] Planifié : rapport /${cfg.everyHours}h, alarmes /${alertEveryMin}min`,
  );

  if (listen) {
    await pollCommandsLoop(cfg);
    return;
  }

  // Garde le process vivant (rapports/alarmes). Les commandes Telegram
  // sont traitées par GitHub Actions toutes les 5 min (npm run bot:commands).
  console.log('[bot] Commandes : via GitHub (toutes les ~5 min) ou npm run bot:listen');
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
