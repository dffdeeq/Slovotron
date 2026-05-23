// Подключение к чату Twitch через tmi.js — та же библиотека, что в вебе (js/init.js).
// Анонимно (read-only): identity не передаём, токен не нужен.
import tmi from 'tmi.js';

export function connectChat(channel, { onMessage, onStatus }) {
  const client = new tmi.Client({
    options: { skipUpdatingEmotesets: true },
    connection: { reconnect: true, secure: true },
    channels: [channel],
  });

  client.on('message', (ch, user, message, self) => {
    if (self) return;
    onMessage({
      username: user.username,
      displayName: user['display-name'] || user.username,
      color: user.color || '#00FF00', // дефолт как в js/init.js:22
      message,
    });
  });

  client.on('connected', () => onStatus?.('online'));
  client.on('reconnect', () => onStatus?.('reconnecting'));
  client.on('disconnected', () => onStatus?.('offline'));

  onStatus?.('reconnecting');
  client.connect().catch(() => onStatus?.('offline'));
  return client;
}
