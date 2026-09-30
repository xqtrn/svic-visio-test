#!/usr/bin/env node
/* Сторож главной стенда — облачный (Артур 2026-07-28).
 *
 * Правило главной (карточка от ОДНОЙ статьи, статья в СВОЁМ блоке, на странице
 * есть карточки) судит одно горло — стенд: POST /api/internal/frontpage-refresh
 * heal=true сначала пересобирает снимок, потом сверяет живую главную и сам
 * открывает или закрывает карточку stand-frontpage. Этот сторож — только будильник
 * этого горла и свидетель на случай, когда стенд не отвечает вовсе.
 *
 * 2026-09-30: здесь жила вторая копия правила со своим адресом базы. После
 * переезда базы сайта 09-09 он смотрел в старую копию, где статей новее 9 сентября
 * не было, и каждый раз, когда лечение не отвечало за 120 с (стенд выкатывался),
 * судил живую главную по устаревшей базе: «ссылка на несуществующую статью» —
 * 9 ложных карточек за 15–24.09, каждая закрылась сама через 7–45 минут. Копия
 * правила рядом с горлом удалена вместе с доступом к базе. Стенд, который не
 * отвечает в минуту своего выката, тоже не поломка: карточка «не отвечает» — только
 * если горло молчит дольше окна пересборки.
 * Секреты: SVIC_INTERNAL_KEY.
 */
import { openTask } from './system-task.mjs';

const API = (process.env.SVIC_API_ORIGIN || 'https://siliconvalleyinvestclub.com').replace(/\/+$/, '');
const TASK_KEY = 'stand-frontpage';
// Горло само ждёт до 6 минут, пока главная вернётся после выката; ответ дольше
// этого — не ответ.
const HEAL_TIMEOUT_MS = 8 * 60 * 1000;
// Сколько стенд может не отвечать на своём выкате, прежде чем это поломка.
export const REBUILD_WINDOW_MS = 10 * 60 * 1000;
const RETRY_MS = 30 * 1000;

async function healFrontpage() {
  const key = process.env.SVIC_INTERNAL_KEY || '';
  if (!key) return { reached: false, error: 'no SVIC_INTERNAL_KEY' };
  try {
    const r = await fetch(API + '/api/internal/frontpage-refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': key },
      body: JSON.stringify({ heal: true }),
      signal: AbortSignal.timeout(HEAL_TIMEOUT_MS),
    });
    const body = await r.json().catch(() => null);
    // Ответ горла — только JSON его сторожа. 502/503 края и HTML страницы
    // выката — это «не дозвонились», а не вердикт о главной.
    if (!r.ok || !body || typeof body.ok !== 'boolean') {
      return { reached: false, error: `HTTP ${r.status}` };
    }
    return { reached: true, ...body };
  } catch (err) {
    return { reached: false, error: err.message };
  }
}

export async function callThroat({
  heal = healFrontpage,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  windowMs = REBUILD_WINDOW_MS,
  retryMs = RETRY_MS,
} = {}) {
  const started = now();
  let out = await heal();
  let attempts = 1;
  while (!out.reached && now() - started < windowMs) {
    await sleep(retryMs);
    out = await heal();
    attempts++;
  }
  return { ...out, attempts, waitedMs: now() - started };
}

async function main() {
  const out = await callThroat();
  if (!out.reached) {
    await openTask({
      key: TASK_KEY,
      summary: 'Сторож главной стенда не может дозвониться до стенда дольше окна пересборки.',
      details: `POST ${API}/api/internal/frontpage-refresh не ответил вердиктом ${out.attempts} раз за `
        + `${Math.round(out.waitedMs / 60000)} мин (последний ответ: ${out.error}). Выкат стенда занимает до `
        + `${REBUILD_WINDOW_MS / 60000} мин — дольше это не выкат.`,
      instructions: 'Вернуть ответ бэкенда стенда, затем прогнать сторожа главной и убедиться, что он проходит зелёным.',
    });
    console.error(`стенд не отвечает: ${out.error}`);
    process.exit(1);
  }
  // Вердикт и карточку горло уже записало само — здесь только след прогона.
  if (out.ok) {
    console.log(`✓ главная: ${out.checked} карточек — каждая от одной статьи и в своём блоке`
      + (out.repaired ? ' (пересобрана)' : ''));
    process.exit(0);
  }
  console.error(`❌ главная: ${(out.bad || []).length ? out.bad.slice(0, 10).join('; ') : `HTTP ${out.status}`}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
