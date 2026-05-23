// Клавиатура (raw-mode) и экран настроек. Меняет app.* и вызывает действия ctl.*.
import readline from 'node:readline';

// Единый источник правды по полям настроек (render строит из этого отображение).
export const SETTINGS_FIELDS = [
  { key: 'channel', label: 'Канал Twitch:', type: 'text' },
  { key: 'restart_time', label: 'Перезапуск (сек):', type: 'number' },
  { key: 'sound', label: 'Звук:', type: 'bool' },
  { key: 'ascii', label: 'ASCII-режим:', type: 'bool' },
  { key: 'colorNames', label: 'Цветные ники:', type: 'bool' },
];

export function setupInput(app, ctl) {
  const stdin = process.stdin;
  if (!stdin.isTTY) return; // неинтерактивный запуск — без клавиатуры
  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('keypress', (str, key) => {
    try {
      handleKey(app, ctl, str, key || {});
    } catch {
      /* ошибка обработчика не должна ронять игру */
    }
  });
}

function handleKey(app, ctl, str, key) {
  if (key.ctrl && key.name === 'c') return ctl.quit();

  if (app.screen === 'settings') return handleSettings(app, ctl, str, key);

  if (app.screen === 'leaderboard' || app.screen === 'info') {
    if (['escape', 'q', 'l', 'i', 'return'].includes(key.name)) {
      app.screen = 'game';
      ctl.redraw();
    }
    return;
  }

  // игровой экран
  switch (key.name) {
    case 'q': return ctl.quit();
    case 's': return openSettings(app, ctl);
    case 'l': app.screen = 'leaderboard'; return ctl.redraw();
    case 'i': app.screen = 'info'; return ctl.redraw();
    case 't': return void app.game.useTip('', true).then(ctl.redraw);
    case 'r': return ctl.restart();
  }
}

function openSettings(app, ctl) {
  app.screen = 'settings';
  app.settingsCursor = 0;
  app.editing = null;
  app.editBuffer = '';
  app.channelOnEnter = app.settings.channel;
  ctl.redraw();
}

function handleSettings(app, ctl, str, key) {
  const fields = SETTINGS_FIELDS;
  const f = fields[app.settingsCursor];

  if (app.editing) {
    if (key.name === 'return') {
      commitEdit(app, f);
      app.editing = null;
    } else if (key.name === 'escape') {
      app.editing = null;
    } else if (key.name === 'backspace') {
      app.editBuffer = app.editBuffer.slice(0, -1);
    } else if (str && str.length === 1 && str >= ' ' && !key.ctrl && !key.meta) {
      if (f.type === 'number') {
        if (/[0-9]/.test(str)) app.editBuffer += str;
      } else {
        app.editBuffer += str;
      }
    }
    return ctl.redraw();
  }

  switch (key.name) {
    case 'up':
      app.settingsCursor = (app.settingsCursor - 1 + fields.length) % fields.length;
      break;
    case 'down':
      app.settingsCursor = (app.settingsCursor + 1) % fields.length;
      break;
    case 'left':
    case 'right':
    case 'space':
      if (f.type === 'bool') app.settings[f.key] = !app.settings[f.key];
      break;
    case 'return':
      if (f.type === 'bool') {
        app.settings[f.key] = !app.settings[f.key];
      } else {
        app.editing = f.key;
        app.editBuffer = f.type === 'text' && !app.settings[f.key] ? '' : String(app.settings[f.key] ?? '');
      }
      break;
    case 's':
      return saveAndApply(app, ctl);
    case 'escape':
    case 'q':
      app.screen = 'game';
      break;
    default:
      return;
  }
  ctl.redraw();
}

function commitEdit(app, f) {
  const val = app.editBuffer.trim();
  if (f.type === 'number') {
    const n = parseInt(val, 10);
    if (Number.isFinite(n) && n >= 0) app.settings[f.key] = n;
  } else {
    app.settings[f.key] = val;
  }
}

function saveAndApply(app, ctl) {
  ctl.save();
  const channelChanged = app.settings.channel !== app.channelOnEnter;
  if (app.settings.channel) {
    if (channelChanged) ctl.reconnect();
    if (channelChanged || !app.game.challengeId) ctl.restart();
  }
  app.screen = 'game';
  ctl.redraw();
}
