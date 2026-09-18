export async function sendTelegramMessage(token, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram: ${data.description || res.status}`);
  }
  return data;
}

export async function getUpdates(token, offset = 0, timeout = 0) {
  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('timeout', String(timeout));
  url.searchParams.set('allowed_updates', JSON.stringify(['message']));
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram getUpdates: ${data.description || res.status}`);
  }
  return data.result || [];
}

export async function setMyCommands(token, commands) {
  const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram setMyCommands: ${data.description || res.status}`);
  }
  return data;
}
