// Куда сторожа этого репозитория докладывают о проблемах.
//
// Раньше каждый сторож писал напрямую в Телеграм Артуру. Сторож главной ходит
// раз в полчаса, здоровье платформы — раз в час: пока стенд лежал, одна и та же
// фраза приходила Артуру снова и снова (3 августа — четыре раза «Главная стенда
// отдала 403» до полудня). Артур: «вместо этих сообщений сразу добавь задачи …
// присылай только если произошло что-то критичное, требующее немедленного
// вмешательства».
//
// Теперь сторож открывает КАРТОЧКУ на /developement: пока проблема держится,
// повторные срабатывания обновляют одну и ту же карточку, а когда проверка
// снова проходит — карточка закрывается сама. Телеграм этот путь не трогает.
const BASE = process.env.SVIC_PLATFORM_URL || 'https://platform.siliconvalleyinvestclub.com';
const KEY = process.env.SVIC_INTERNAL_KEY || '';

async function post(body) {
  if (!KEY) { console.error('[system-task] нет SVIC_INTERNAL_KEY — задача не создана'); return null; }
  try {
    const r = await fetch(`${BASE}/api/internal/system-tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': KEY },
      body: JSON.stringify(body),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) console.error(`[system-task] платформа ответила ${r.status}: ${out.error || ''}`);
    return out;
  } catch (e) {
    // Сторож не должен падать из-за почтальона.
    console.error('[system-task] не доставлено: ' + e.message);
    return null;
  }
}

// key — семейство проблемы (одна карточка на семейство).
// summary/ownerBrief — простой русский для Артура, без техники.
// instructions — что делать исполнителю.
export const openTask = ({ key, summary, ownerBrief, details, instructions }) =>
  post({ key, summary, owner_brief: ownerBrief || summary, details: details || summary, instructions });

// Проверка снова прошла — карточка уходит из активных сама.
export const closeTask = (key, reason) => post({ key, resolved: true, reason });
