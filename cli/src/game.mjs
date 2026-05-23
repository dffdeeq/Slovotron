// Игровое состояние и логика раунда (порт js/ws.js + js/tips.js + js/init.js + js/easter_eggs.js).
// Без привязки к рисованию: меняет стейт и дёргает onChange для перерисовки.
import { recordWin } from './store.mjs';

const MAX_LAST_WORDS = 20;                 // js/config.js
const TIPS_MAX_DISTANCE = 300;             // js/config.js kontekstno_api_tips_max_distance
const TIP_COOLDOWN_MS = 60 * 1000;         // js/tips.js tip_cooldown_time
const TIP_MULTIPLIER = 1.5;                // js/tips.js tip_distance_tune_multiplier

// Пасхалки (теги селеб из js/easter_eggs.js). В терминале — текстовая строка без картинок.
const CELEBS = [
  { id: 'fra3a', tags: ['fra3a', 'fraza', 'фра3а', 'фраза'] },
  { id: 'iwawwa', tags: ['ивавва', 'ивава', 'акане', 'аканэ', 'iwawwa', 'iwawa', 'akane', 'akane_iwawwa'] },
  { id: 'yui2d', tags: ['yui2d', 'yui', 'юй', 'юи', 'юй2д', 'юи2д'] },
  { id: 'quantum075', tags: ['quantum0', 'quantum', 'quantum075', 'квантум'] },
  { id: 'hatome', tags: ['hatome', 'хатоме', 'хатомка', 'хатоми'] },
  { id: 'mrwhiskanson', tags: ['mrwhiskanson', 'вискансон'] },
];

function checkEasterEgg(input) {
  const words = input.toLowerCase().split(/\s+/);
  for (const w of words) {
    const celeb = CELEBS.find((c) => c.tags.includes(w));
    if (celeb) return { matched: true, id: celeb.id, passThrough: w === 'фраза' };
  }
  return { matched: false };
}

// Фильтр сообщения чата (порт js/init.js:27-50).
// → { type: 'tip' } | { type: 'word', word } | null
export function filterWord(message) {
  const lower = message.toLowerCase();
  if (lower.startsWith('!подска') || lower.startsWith('! подска')) return { type: 'tip' };

  // больше одного слова / длиннее 20 / короче 2 / число — игнор
  if (message.split(' ').length > 1 || message.length > 20 || message.length <= 1 || !isNaN(message)) {
    return null;
  }
  let word = message.replace(/ё/gi, 'е');          // ЛЁД == ЛЕД
  word = word.replace(/[^a-zA-Zа-яА-Я]/g, '');     // только буквы (анти-XSS + чистка)
  if (word.length < 2) return null;
  return { type: 'word', word };
}

export class Game {
  constructor({ settings, api, onChange = () => {}, bell = () => {} }) {
    this.settings = settings;
    this.api = api;
    this.onChange = onChange;
    this.bell = bell;

    this.challengeId = '';
    this.secretWord = null;
    this.leaderboard = {};
    this.queue = [];
    this.processing = false;
    this.starting = false;

    this.resetRound();
  }

  resetRound() {
    this.finished = false;
    this.winAt = null;
    this.winner = null;
    this.winningWord = null;
    this.lastWords = [];          // лента (новые сверху)
    this.bestMatches = [];        // отсортировано по дистанции ↑
    this.checked = new Map();     // слово → distance (0 = нет в словаре)
    this.uniqUsers = new Set();
    this.uniqWords = 0;
    this.repeatWords = 0;
    this.bestDistance = TIPS_MAX_DISTANCE;
    this.restartAt = null;
    this.roundStart = Date.now();
    this.resetTips();
  }

  async startRound() {
    this.starting = true;
    try {
      const { challengeId, secretWord } = await this.api.generateSecretWord();
      this.challengeId = challengeId;
      this.secretWord = secretWord;
      this.resetRound();
    } finally {
      this.starting = false;
    }
  }

  // --- лента / лучшие ---
  addGuess(entry) {
    this.lastWords.unshift(entry);
    this.cap();
  }

  addInfo(text) {
    this.lastWords.unshift({ kind: 'info', text });
    this.cap();
  }

  cap() {
    if (this.lastWords.length > MAX_LAST_WORDS) this.lastWords.length = MAX_LAST_WORDS;
  }

  // Вставка в bestMatches по возрастанию дистанции (порт addMatchWord).
  addMatch(entry) {
    let idx = this.bestMatches.findIndex((m) => m.distance > entry.distance);
    if (idx === -1) idx = this.bestMatches.length;
    if (idx === 0 && entry.distance < 150) this.bell(); // звук при новом лучшем близком слове
    this.bestMatches.splice(idx, 0, entry);
  }

  // --- обработка входящих сообщений ---
  handleMessage(msg) {
    const egg = checkEasterEgg(msg.message);
    if (egg.matched) {
      this.addInfo(`✨ ${egg.id}`);
      if (!egg.passThrough) {
        this.onChange();
        return;
      }
    }

    const f = filterWord(msg.message);
    if (!f) {
      if (egg.matched) this.onChange();
      return;
    }
    if (f.type === 'tip') {
      this.useTip(msg.username).then(() => this.onChange());
      return;
    }
    this.queue.push({ ...msg, word: f.word });
    if (!this.processing) this.runQueue();
  }

  async runQueue() {
    this.processing = true;
    while (this.queue.length) {
      await this.processOne(this.queue.shift());
      this.onChange();
    }
    this.processing = false;
  }

  // Порт process_message (js/ws.js:66-139).
  async processOne({ username, displayName, color, word }) {
    if (this.finished) return;
    word = word.toLowerCase();

    if (this.checked.has(word)) {
      if (this.checked.get(word)) { // у слова была дистанция → это повтор
        if (!this.uniqUsers.has(username)) this.uniqUsers.add(username);
        this.repeatWords++;
      }
      this.addInfo(`${word} — уже было`);
      return;
    }

    let distance;
    try {
      const res = await this.api.scoreWord(this.challengeId, word);
      distance = res.distance;
    } catch {
      this.addInfo(`ошибка проверки «${word}»`);
      return;
    }

    this.checked.set(word, distance || 0);
    if (!distance) {
      this.addInfo(`${word} — не в словаре`);
      return;
    }

    if (distance < this.bestDistance) this.bestDistance = distance;
    if (!this.uniqUsers.has(username)) this.uniqUsers.add(username);
    this.uniqWords++;

    const entry = { kind: 'guess', word, distance, name: displayName, color };
    this.addGuess(entry);
    this.addMatch(entry);

    if (distance === 1) this.handleWin(displayName, word);
  }

  // Порт handle_win (js/ws.js:198-265) без DOM.
  handleWin(name, word) {
    this.finished = true;
    this.winAt = Date.now();
    this.winner = name;
    this.winningWord = word;
    this.leaderboard = recordWin(name);
    this.bell();
    const restart = Number(this.settings.restart_time) || 0;
    this.restartAt = restart > 0 ? Date.now() + restart * 1000 : null;
    this.onChange();
  }

  // --- подсказки (порт js/tips.js) ---
  resetTips() {
    this.tipVoters = new Set();
    this.tipLastReset = Date.now();
  }

  tipProgress() {
    const required = Math.floor(this.uniqUsers.size / 2);
    return { current: this.tipVoters.size, required };
  }

  tipCooldownLeft() {
    return Math.max(0, TIP_COOLDOWN_MS - (Date.now() - this.tipLastReset));
  }

  async useTip(user = '', force = false) {
    if (this.finished || !this.challengeId) return;
    if (user && this.tipVoters.has(user) && !force) return;
    if (!this.bestDistance) this.bestDistance = TIPS_MAX_DISTANCE;

    const left = this.tipCooldownLeft();
    if (left > 0 && !force) {
      this.addInfo(`до подсказки: ${Math.ceil(left / 1000)}с`);
      return;
    }
    if (user) this.tipVoters.add(user);

    const required = Math.floor(this.uniqUsers.size / 2);
    if (this.tipVoters.size < required && !force) {
      this.addInfo(`для подсказки нужно ещё человек: ${required - this.tipVoters.size}`);
      return;
    }

    // Подгоняем дальность (апи отдаёт вдвое ближе) — порт fine_tuned_distance.
    let tuned = Math.floor(this.bestDistance * TIP_MULTIPLIER);
    if (tuned > TIPS_MAX_DISTANCE) tuned = TIPS_MAX_DISTANCE;
    if (Math.ceil(tuned / 2) === this.bestDistance) tuned = this.bestDistance;

    let tip;
    try {
      tip = await this.api.getTip(this.challengeId, tuned);
    } catch {
      this.addInfo('подсказка недоступна');
      return;
    }
    if (!tip.distance) {
      this.addInfo('подсказка недоступна');
      return;
    }

    this.bestDistance = tip.distance;
    this.resetTips();
    this.checked.set(tip.word, tip.distance);

    const entry = { kind: 'guess', word: tip.word, distance: tip.distance, name: '💡 Подсказка', color: '#DDDDDD' };
    this.addGuess(entry);
    this.addMatch(entry);

    if (tip.distance === 1) this.handleWin('💡 Подсказка', tip.word);
  }

  // --- таймеры/статистика для рендера ---
  roundSeconds() {
    const end = this.finished && this.winAt ? this.winAt : Date.now();
    return Math.max(0, Math.floor((end - this.roundStart) / 1000));
  }

  restartSeconds() {
    if (!this.restartAt) return null;
    return Math.max(0, Math.ceil((this.restartAt - Date.now()) / 1000));
  }
}
