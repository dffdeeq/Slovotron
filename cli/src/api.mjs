// Клиент API контекстно (порт js/api.js на встроенный fetch).
const BASE_DOMAIN = 'https://api.contextno.com/';

async function query({ method = '', word = '', challenge_id = '', last_word_rank = 0 } = {}) {
  const url = new URL(method, BASE_DOMAIN);
  if (method === 'score') {
    url.searchParams.append('challenge_id', challenge_id);
    url.searchParams.append('word', word);
    url.searchParams.append('challenge_type', 'random');
  } else if (method === 'tip') {
    url.searchParams.append('challenge_id', challenge_id);
    url.searchParams.append('last_word_rank', last_word_rank);
    url.searchParams.append('challenge_type', 'random');
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Response status: ${response.status}`);
  return response.json();
}

// Оценка слова: { distance } (1 — победа). Порт process_message → kontekstno_query('score').
export function scoreWord(challengeId, word) {
  return query({ method: 'score', challenge_id: challengeId, word });
}

// Подсказка: { word, distance }. Порт use_tip → kontekstno_query('tip').
export function getTip(challengeId, lastWordRank) {
  return query({ method: 'tip', challenge_id: challengeId, last_word_rank: lastWordRank });
}

// Получение секретного слова + проверка на «забагованное» слово (порт generate_secret_word).
// Если для «банан» дистанция 0 — челлендж сломан, берём другой. До 5 попыток.
export async function generateSecretWord() {
  const maxRetries = 5;
  for (let retry = 0; retry < maxRetries; retry++) {
    let roomId;
    try {
      const data = await query({ method: 'random-challenge' });
      roomId = data.id;
      const check = await query({ method: 'score', word: 'банан', challenge_id: roomId });
      if (check.distance === 0) continue; // забагованное слово — пробуем заново

      let secretWord = null;
      try {
        const tip = await query({ method: 'tip', challenge_id: roomId, last_word_rank: 1 });
        secretWord = tip?.word || null;
      } catch {
        // секрет необязателен — игре он не нужен, только для шапки
      }
      return { challengeId: roomId, secretWord };
    } catch {
      await new Promise((r) => setTimeout(r, 1000)); // пауза при сетевой ошибке
    }
  }
  throw new Error('Превышено количество попыток получения секретного слова.');
}
