// Хранение настроек и лидерборда в JSON (замена localStorage из веба).
// Кросс-платформенные пути: %APPDATA%\slovotron на Windows, ~/.config/slovotron на Unix.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

function configDir() {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(base, 'slovotron');
  }
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'slovotron');
}

export const DIR = configDir();
export const SETTINGS_FILE = join(DIR, 'settings.json');
export const LEADERBOARD_FILE = join(DIR, 'leaderboard.json');

export const DEFAULT_SETTINGS = {
  channel: '',
  restart_time: 20,
  sound: true,
  ascii: false,
  colorNames: true,
};

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return { ...fallback, ...parsed };
  } catch {
    return { ...fallback };
  }
}

function writeJson(file, data) {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file); // атомарная запись
}

export function loadSettings() {
  return readJson(SETTINGS_FILE, DEFAULT_SETTINGS);
}

export function saveSettings(settings) {
  writeJson(SETTINGS_FILE, settings);
}

export function loadLeaderboard() {
  return readJson(LEADERBOARD_FILE, {});
}

export function saveLeaderboard(data) {
  writeJson(LEADERBOARD_FILE, data);
}

// +1 победа игроку, как updateLeaderboard в js/leaderboard.js
export function recordWin(name) {
  const data = loadLeaderboard();
  data[name] = (data[name] || 0) + 1;
  saveLeaderboard(data);
  return data;
}

// Топ-N по числу побед (как renderLeaderboard: сорт по убыванию, slice)
export function topWinners(data, n = 5) {
  return Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}
