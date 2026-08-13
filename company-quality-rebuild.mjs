const ORIGIN = 'https://svic-platform-production.up.railway.app';
const slugs = ['appsflyer', 'crypto-com', 'current', 'sierra', 'generalist-ai'];
const headers = {
  'x-internal-key': process.env.SVIC_INTERNAL_KEY,
  'content-type': 'application/json',
};

for (const slug of slugs) {
  const response = await fetch(`${ORIGIN}/api/internal/company-rebuild`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ slug }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 409) {
    throw new Error(`${slug} rebuild HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  console.log(JSON.stringify({ slug, triggered: response.ok, status: response.status, payload }));
}

const deadline = Date.now() + 25 * 60 * 1000;
const done = new Map();
while (Date.now() < deadline && done.size < slugs.length) {
  for (const slug of slugs) {
    if (done.has(slug)) continue;
    const response = await fetch(`${ORIGIN}/api/internal/company-state/${slug}`, { headers });
    if (!response.ok) throw new Error(`${slug} state HTTP ${response.status}`);
    const state = await response.json();
    if (state.status !== 'building') {
      done.set(slug, state);
      console.log(JSON.stringify({ completed: slug, state }));
    }
  }
  if (done.size < slugs.length) await new Promise((resolve) => setTimeout(resolve, 15000));
}

for (const slug of slugs) {
  const state = done.get(slug);
  if (!state) throw new Error(`${slug} rebuild timed out`);
  if (state.status !== 'published') throw new Error(`${slug} rebuild ended ${state.status}: ${JSON.stringify(state)}`);
}
