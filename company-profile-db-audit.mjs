import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
const since = new Date(process.env.SINCE || Date.now() - 24 * 60 * 60 * 1000);

const { rows } = await pool.query(
  `SELECT slug, name, website, status, updated_at, updated_by, data
     FROM company_profiles
    ORDER BY slug`,
);

const profiles = rows.map((row) => {
  const data = row.data || {};
  const model = data.model || {};
  const reg = data.reg || {};
  return {
    slug: row.slug,
    name: row.name,
    website: row.website,
    status: row.status,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
    daily: new Date(row.updated_at) >= since,
    build_gaps: Array.isArray(data.buildGaps) ? data.buildGaps : [],
    kpi: model.kpi || [],
    highlights: model.highlights || [],
    leadership: (model.leadership || []).map((person) => ({
      name: person.name,
      title: person.title,
      photo: person.photo,
    })),
    rounds: reg.rounds || [],
    cap_table: reg.capTable || null,
    built: data.built || null,
  };
});

const report = {
  captured_at: new Date().toISOString(),
  since: since.toISOString(),
  counts: {
    total: profiles.length,
    daily: profiles.filter((profile) => profile.daily).length,
    with_build_gaps: profiles.filter((profile) => profile.build_gaps.length).length,
    draft: profiles.filter((profile) => profile.status === 'draft').length,
    failed: profiles.filter((profile) => profile.status === 'failed').length,
  },
  profiles,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await pool.end();
