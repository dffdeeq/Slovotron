#!/usr/bin/env node
// Словотрон 9000 — CLI. Подключается к чату Twitch, гоняет слова через API контекстно
// и рисует полноэкранный TUI. Запуск: node slovotron.mjs --channel <канал>
import process from 'node:process';
import logUpdate from 'log-update';
import * as store from './src/store.mjs';
import * as api from './src/api.mjs';
import { connectChat } from './src/twitch.mjs';
import { Game } from './src/game.mjs';
import { render } from './src/ui/render.mjs';
import { setupInput } from './src/ui/input.mjs';

// --- проверка версии Node ---
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 18) {
  console.error(`Нужен Node.js 18+, у вас ${process.versions.node}.`);
  process.exit(1);
}

// --- разбор флагов ---
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}
if (args.resetLeaderboard) {
  store.saveLeaderboard({});
  console.log('Лидерборд сброшен.');
}

const settings = store.loadSettings();
if (args.channel != null) settings.channel = args.channel;
if (args.restart != null) settings.restart_time = args.restart;
if (args.noSound) settings.sound = false;
if (args.ascii) settings.ascii = true;

const bell = () => {
  if (settings.sound) process.stdout.write('\x07');
};

// --- общее состояние приложения ---
const app = {
  screen: settings.channel ? 'game' : 'settings',
  settingsCursor: 0,
  editing: null,
  editBuffer: '',
  channelOnEnter: settings.channel,
  settings,
  game: null,
  status: 'offline',
  client: null,
};

const game = new Game({ settings, api, onChange: redraw, bell });
game.leaderboard = store.loadLeaderboard();
app.game = game;

// --- перерисовка (троттлинг, чтобы не молотить stdout) ---
let scheduled = false;
function redraw() {
  if (scheduled) return;
  scheduled = true;
  setImmediate(() => {
    scheduled = false;
    try {
      logUpdate(render(app));
    } catch {
      /* сбой рендера не должен ронять игру */
    }
  });
}

function setStatus(s) {
  app.status = s;
  redraw();
}

function connect() {
  if (app.client) {
    try {
      app.client.disconnect();
    } catch {
      /* noop */
    }
  }
  if (!settings.channel) return;
  app.client = connectChat(settings.channel, {
    onMessage: (m) => game.handleMessage(m),
    onStatus: setStatus,
  });
}

let restarting = false;
async function newRound() {
  if (restarting) return;
  restarting = true;
  try {
    await game.startRound();
  } catch {
    setTimeout(() => {
      restarting = false;
      newRound();
    }, 2000);
    return;
  }
  restarting = false;
  redraw();
}

const ctl = {
  redraw,
  quit,
  restart: () => newRound(),
  reconnect: () => connect(),
  save: () => store.saveSettings(settings),
};

setupInput(app, ctl);

function quit() {
  logUpdate.done();
  process.stdout.write('\x1b[?25h'); // показать курсор
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    /* noop */
  }
  console.log('\nПока! 🧠');
  process.exit(0);
}
process.on('SIGINT', quit);
process.stdout.on('resize', redraw);

// --- главный тик: рестарт по таймеру + обновление таймеров на экране ---
setInterval(() => {
  if (game.finished && game.restartAt && Date.now() >= game.restartAt && !restarting) {
    newRound();
  }
  redraw();
}, 400);

// --- старт ---
process.stdout.write('\x1b[?25l'); // спрятать курсор
redraw();
if (settings.channel) {
  newRound();
  connect();
}

// ---------- утилиты ----------
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--channel') a.channel = argv[++i];
    else if (t.startsWith('--channel=')) a.channel = t.slice('--channel='.length);
    else if (t === '--restart') a.restart = parseInt(argv[++i], 10);
    else if (t.startsWith('--restart=')) a.restart = parseInt(t.slice('--restart='.length), 10);
    else if (t === '--no-sound') a.noSound = true;
    else if (t === '--ascii') a.ascii = true;
    else if (t === '--reset-leaderboard') a.resetLeaderboard = true;
    else if (t === '--help' || t === '-h') a.help = true;
  }
  return a;
}

function printHelp() {
  console.log(`Словотрон 9000 — CLI

Использование:
  node slovotron.mjs [опции]

Опции:
  --channel <имя>        канал Twitch (без него откроется экран настроек)
  --restart <сек>        пауза перед новым раундом после победы (по умолч. 20)
  --no-sound             выключить звуковой сигнал терминала
  --ascii                ASCII-режим (без эмодзи и юникод-рамок)
  --reset-leaderboard    очистить таблицу победителей
  --help, -h             показать эту справку

В игре:  [q] выход  [s] настройки  [l] лидерборд  [i] инфо  [t] подсказка  [r] рестарт`);
}
