const origin = 'https://svic-platform-production.up.railway.app';
const response = await fetch(`${origin}/api/internal/company-assets-repair`, {
  method: 'POST',
  headers: {
    'x-internal-key': process.env.SVIC_INTERNAL_KEY,
    'content-type': 'application/json',
  },
  body: JSON.stringify({}),
});
const payload = await response.json().catch(() => ({}));
console.log(JSON.stringify(payload, null, 2));
if (!response.ok || !payload.ok || payload.totals?.failed) process.exitCode = 1;
