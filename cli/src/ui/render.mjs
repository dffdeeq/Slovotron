// Сборка кадра (массива строк) для log-update. Полноэкранный TUI:
// шапка, две колонки (лента / лучшие), панели (лидерборд / статистика / подсказка),
// футер с клавишами, экран победы и модальные экраны (настройки / лидерборд / инфо).
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import pc from 'picocolors';
import { distanceColor, nameColor, bar } from './colors.mjs';
import { topWinners } from '../store.mjs';
import { SETTINGS_FIELDS } from './input.mjs';

const W = (s) => stringWidth(s);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function clip(s, w) {
  if (w <= 0) return '';
  if (W(s) <= w) return s;
  return wrapAnsi(s, w, { hard: true, trim: false }).split('\n')[0];
}
function padR(s, w) {
  const d = w - W(s);
  return d > 0 ? s + ' '.repeat(d) : s;
}
function padL(s, w) {
  const d = w - W(s);
  return d > 0 ? ' '.repeat(d) + s : s;
}
const fit = (s, w) => padR(clip(s, w), w);

function mmss(sec) {
  const m = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function theme(ascii) {
  if (ascii) {
    return { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', lt: '+', rt: '+', tt: '+', bt: '+',
             brain: '[*]', trophy: '#', bulb: 'i', crown: '*', barF: '#', barE: '-' };
  }
  return { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', lt: '├', rt: '┤', tt: '┬', bt: '┴',
           brain: '🧠', trophy: '🏆', bulb: '💡', crown: '👑', barF: '▓', barE: '░' };
}

// ---------- основной игровой экран ----------
function renderGame(app, cols, rows, t) {
  const g = app.game;
  const s = app.settings;
  const iw = cols - 2;
  const leftW = Math.floor((iw - 1) / 2);
  const rightW = iw - 1 - leftW;
  const bottomRows = 6;
  const mainRows = Math.max(3, rows - 14);
  const lines = [];

  // шапка
  lines.push(t.tl + t.h.repeat(iw) + t.tr);
  lines.push(t.v + fit(' ' + headerText(app, t), iw) + t.v);

  if (g.finished) {
    lines.push(t.lt + t.h.repeat(iw) + t.rt);
    for (const b of winBanner(g, iw, mainRows, s, t)) lines.push(t.v + fit(b, iw) + t.v);
    lines.push(t.lt + t.h.repeat(iw) + t.rt);
  } else {
    lines.push(t.lt + t.h.repeat(leftW) + t.tt + t.h.repeat(rightW) + t.rt);
    const left = feedColumn(g, leftW, mainRows, s);
    const right = bestColumn(g, rightW, mainRows, s);
    for (let i = 0; i < mainRows; i++) {
      lines.push(t.v + fit(left[i] || '', leftW) + t.v + fit(right[i] || '', rightW) + t.v);
    }
    lines.push(t.lt + t.h.repeat(leftW) + t.bt + t.h.repeat(rightW) + t.rt);
  }

  // нижние панели: лидерборд | статистика | подсказка
  const aW = Math.floor(iw * 0.34);
  const bW = Math.floor(iw * 0.33);
  const cW = iw - 2 - aW - bW;
  lines.push(t.lt + t.h.repeat(aW) + t.tt + t.h.repeat(bW) + t.tt + t.h.repeat(cW) + t.rt);
  const lb = leaderboardPanel(g, aW, bottomRows, t);
  const stx = statsPanel(g, bW);
  const tp = tipPanel(g, cW, s, t);
  for (let i = 0; i < bottomRows; i++) {
    lines.push(t.v + fit(lb[i] || '', aW) + t.v + fit(stx[i] || '', bW) + t.v + fit(tp[i] || '', cW) + t.v);
  }

  // футер
  lines.push(t.lt + t.h.repeat(iw) + t.rt);
  lines.push(t.v + fit(' ' + footerKeys(g), iw) + t.v);
  lines.push(t.bl + t.h.repeat(iw) + t.br);
  return lines.join('\n');
}

function headerText(app, t) {
  const s = app.settings;
  const dot = app.status === 'online' ? pc.green('●') : app.status === 'reconnecting' ? pc.yellow('◌') : pc.red('○');
  const label = { online: 'онлайн', reconnecting: 'подключение…', offline: 'оффлайн' }[app.status] || app.status;
  const ch = s.channel ? `канал: ${pc.bold(s.channel)}` : pc.red('канал не задан');
  return `${pc.bold(`${t.brain} СЛОВОТРОН 9000`)}    ${ch}    ${pc.dim(`раунд ${mmss(app.game.roundSeconds())}`)}    ${dot} ${pc.dim(label)}`;
}

function footerKeys(g) {
  const r = g.finished ? '[r] след. раунд' : '[r] рестарт';
  return pc.dim(`[q] выход  [s] настройки  [l] лидерборд  [i] инфо  [t] подсказка  ${r}`);
}

function feedColumn(g, w, h, s) {
  const out = [pc.bold('ЛЕНТА') + pc.dim(' · слова из чата'), pc.dim('─'.repeat(w))];
  for (const e of g.lastWords) {
    if (out.length >= h) break;
    out.push(e.kind === 'guess' ? formatGuess(e, w, s, null) : formatInfo(e, w, s));
  }
  if (out.length === 2) out.push(pc.dim('ждём слова в чате…'));
  return out;
}

function bestColumn(g, w, h, s) {
  const out = [pc.bold('ЛУЧШИЕ') + pc.dim(' · по близости'), pc.dim('─'.repeat(w))];
  let rank = 1;
  for (const e of g.bestMatches) {
    if (out.length >= h) break;
    out.push(formatGuess(e, w, s, rank++));
  }
  if (out.length === 2) out.push(pc.dim('пока нет совпадений'));
  return out;
}

function formatGuess(e, w, s, rank) {
  const color = distanceColor(e.distance);
  const rankStr = rank != null ? padL(String(rank), 2) + ' ' : '';
  const rankW = W(rankStr);
  const barW = clamp(Math.round(w * 0.16), 4, 10);
  const nameW = clamp(Math.round(w * 0.3), 6, 16);
  const wordW = w - rankW - barW - nameW - 8; // 5(dist) + 3 пробела

  let dispName = e.name;
  if (s.ascii) dispName = dispName.replace(/[^\x20-\x7Eа-яА-ЯёЁ]/g, '').trim() || 'tip';

  if (wordW < 3) {
    const compact = `${clip(e.word, Math.max(2, w - 7))} ${padL(String(e.distance), 5)}`;
    return color(fit(compact, w));
  }

  const word = padR(clip(e.word, wordW), wordW);
  const distStr = padL(String(e.distance), 5);
  const name = padR(clip(dispName, nameW), nameW);
  const coloredName = s.colorNames && !s.ascii ? nameColor(e.color, name) : pc.dim(name);
  return rankStr + color(word) + ' ' + color(distStr) + ' ' + bar(e.distance, barW, s.ascii) + ' ' + coloredName;
}

function formatInfo(e, w, s) {
  let text = e.text;
  if (s.ascii) text = text.replace(/[^\x20-\x7Eа-яА-ЯёЁ«»—]/g, '').trim();
  return pc.dim(fit('· ' + text, w));
}

function leaderboardPanel(g, w, h, t) {
  const out = [pc.bold(`${t.trophy} ТОП ПОБЕДИТЕЛЕЙ`)];
  const top = topWinners(g.leaderboard, h - 1);
  if (!top.length) out.push(pc.dim('пока нет победителей'));
  const nameW = Math.max(4, w - 8);
  top.forEach(([name, wins], i) => {
    out.push(`${pc.dim('#' + (i + 1))} ${padR(clip(name, nameW), nameW)} ${padL(String(wins), 3)}`);
  });
  return out;
}

function statsPanel(g, w) {
  const labelW = Math.max(6, w - 7);
  const row = (label, val) => padR(clip(label, labelW), labelW) + ' ' + padL(String(val), 6);
  return [
    pc.bold('СТАТИСТИКА РАУНДА'),
    row('участников:', g.uniqUsers.size),
    row('уник. слов:', g.uniqWords),
    row('повторов:', g.repeatWords),
    row('время:', mmss(g.roundSeconds())),
  ];
}

function tipPanel(g, w, s, t) {
  const { current, required } = g.tipProgress();
  const total = Math.max(required, 1);
  const barW = clamp(w - 8, 4, 16);
  const filled = clamp(Math.round((current / total) * barW), 0, barW);
  const left = g.tipCooldownLeft();
  const cd = left > 0 ? `кулдаун ${Math.ceil(left / 1000)}с` : 'готово';
  return [
    pc.bold(`${t.bulb} ПОДСКАЗКА`),
    `${pc.cyan(t.barF.repeat(filled))}${pc.dim(t.barE.repeat(barW - filled))} ${current}/${required}`,
    pc.dim(`!подсказка · ${cd}`),
    pc.dim('[t] форсировать'),
  ];
}

function winBanner(g, iw, h, s, t) {
  const star = s.ascii ? '*' : '✨';
  const lines = [
    pc.bold(pc.yellow(`${star} ${star} ${star}   П О Б Е Д А !   ${star} ${star} ${star}`)),
    '',
    `${t.crown}  ПОБЕДИТЕЛЬ  ${t.crown}`,
    pc.bold(pc.green(g.winner || '')),
    `слово: ${pc.bold(g.winningWord || '')}   (дистанция 1)`,
    '',
  ];
  const rs = g.restartSeconds();
  lines.push(rs != null ? pc.dim(`перезапуск через ${rs}с · [r] сразу`) : pc.dim('[r] — следующий раунд'));

  const centered = lines.map((l) => {
    const pad = Math.max(0, Math.floor((iw - W(l)) / 2));
    return ' '.repeat(pad) + l;
  });
  const top = Math.max(0, Math.floor((h - centered.length) / 2));
  const out = [];
  for (let i = 0; i < h; i++) {
    const idx = i - top;
    out.push(idx >= 0 && idx < centered.length ? centered[idx] : '');
  }
  return out;
}

// ---------- модальные экраны ----------
function modalBox(title, content, hint, cols, rows, t) {
  const iw = cols - 2;
  const lines = [t.tl + t.h.repeat(iw) + t.tr];
  lines.push(t.v + fit('  ' + pc.bold(title), iw) + t.v);
  lines.push(t.lt + t.h.repeat(iw) + t.rt);
  const bodyH = rows - 6;
  for (let i = 0; i < bodyH; i++) lines.push(t.v + fit(content[i] || '', iw) + t.v);
  lines.push(t.lt + t.h.repeat(iw) + t.rt);
  lines.push(t.v + fit('  ' + pc.dim(hint), iw) + t.v);
  lines.push(t.bl + t.h.repeat(iw) + t.br);
  return lines.join('\n');
}

function settingDisplay(field, app) {
  const s = app.settings;
  const onoff = (b) => (b ? pc.green('[x] вкл') : pc.dim('[ ] выкл'));
  if (app.editing === field.key) return pc.inverse(' ' + app.editBuffer + ' ');
  switch (field.type) {
    case 'bool': return onoff(s[field.key]);
    case 'text': return s[field.key] || pc.dim('(не задано)');
    default: return String(s[field.key]);
  }
}

function renderSettings(app, cols, rows, t) {
  const content = [''];
  SETTINGS_FIELDS.forEach((f, i) => {
    const cur = i === app.settingsCursor ? pc.cyan('▸') : ' ';
    content.push(`  ${cur} ${padR(f.label, 22)}${settingDisplay(f, app)}`);
  });
  content.push('');
  content.push(app.editing
    ? pc.dim('  ввод: Enter — применить, Esc — отмена')
    : pc.dim('  изменения вступают в силу после сохранения'));
  const title = (app.settings.ascii ? '' : '⚙  ') + 'НАСТРОЙКИ';
  const hint = '↑/↓ выбор · Enter правка · ←/→ переключить · [S] сохранить · Esc назад';
  return modalBox(title, content, hint, cols, rows, t);
}

function renderLeaderboard(app, cols, rows, t) {
  const entries = Object.entries(app.game.leaderboard).sort((a, b) => b[1] - a[1]);
  const content = [''];
  if (!entries.length) content.push(pc.dim('  Пока нет победителей.'));
  const nameW = Math.max(8, cols - 22);
  entries.forEach(([name, wins], i) => {
    content.push(`  ${pc.dim('#' + padL(String(i + 1), 2))}  ${padR(clip(name, nameW), nameW)} ${padL(String(wins), 4)} ${t.trophy}`);
  });
  return modalBox(`${t.trophy} ТОП ПОБЕДИТЕЛЕЙ (полный)`, content, 'Esc / q / l — назад', cols, rows, t);
}

function renderInfo(app, cols, rows, t) {
  const orange = (s) => `\x1b[38;5;208m${s}\x1b[39m`;
  const content = [
    '',
    '  Зрители угадывают секретное слово, отправляя слова в чат Twitch.',
    '  Число справа от слова — семантическая дистанция:',
    '  чем меньше, тем ближе к ответу.',
    `  Дистанция ${pc.bold('1')} — это победа.`,
    '',
    '  Команда чата «!подсказка» запускает голосование',
    '  (нужно ≥50% участников раунда), кулдаун — 1 минута.',
    '',
    pc.bold('  Клавиши:'),
    '   [q] выход   [s] настройки   [l] лидерборд   [i] инфо',
    '   [t] подсказка (форс)   [r] рестарт раунда',
    '',
    `  Цвет дистанции:  ${pc.magenta('1')}  ${pc.green('≤150')}  ${pc.yellow('≤550')}  ${orange('≤1400')}  ${pc.red('>1400')}`,
  ];
  const title = (app.settings.ascii ? '' : 'ℹ  ') + 'КАК ИГРАТЬ';
  return modalBox(title, content, 'Esc / q / i — назад', cols, rows, t);
}

// ---------- точка входа рендера ----------
export function render(app) {
  const cols = Math.max(1, process.stdout.columns || 100);
  const rows = Math.max(1, process.stdout.rows || 30);
  if (cols < 60 || rows < 18) {
    return `\n  Увеличьте окно терминала.\n  Нужно минимум 60×18, сейчас ${cols}×${rows}.\n`;
  }
  const t = theme(app.settings.ascii);
  switch (app.screen) {
    case 'settings': return renderSettings(app, cols, rows, t);
    case 'leaderboard': return renderLeaderboard(app, cols, rows, t);
    case 'info': return renderInfo(app, cols, rows, t);
    default: return renderGame(app, cols, rows, t);
  }
}
