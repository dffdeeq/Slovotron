// Цвет по дистанции — те же пороги, что в вебе (js/ws.js getDistanceColor).
import pc from 'picocolors';

// picocolors не умеет «оранжевый», добавляем его 256-цветом (208).
const orange = (s) => (pc.isColorSupported ? `\x1b[38;5;208m${s}\x1b[39m` : String(s));

export function distanceColor(distance) {
  if (distance === 1) return pc.magenta;   // победа — пурпурный
  if (distance <= 150) return pc.green;
  if (distance <= 550) return pc.yellow;
  if (distance <= 1400) return orange;
  return pc.red;
}

// Цвет ника из Twitch (#RRGGBB) → truecolor ANSI. Фолбэк — без цвета.
export function nameColor(hex, text) {
  if (!pc.isColorSupported) return text;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return pc.dim(text);
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

// Полоска близости. Ширина заполнения как в вебе: max(0, 100 - distance/2800*100).
export function bar(distance, width, ascii = false) {
  const ratio = Math.max(0, 1 - distance / 2800);
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  const fillCh = ascii ? '#' : '█';
  const emptyCh = ascii ? '·' : '░';
  const color = distanceColor(distance);
  return color(fillCh.repeat(filled)) + pc.dim(emptyCh.repeat(width - filled));
}
