// Rules of the archive-clips robot, kept apart from the script so a test can hold them.

// A YouTube id is exactly 11 characters. Articles also carry ids of our own video
// library (media3aig, umvzevr0j-horizontal): those files are already ours, and
// sending them to YouTube fails every time. From 2026-09-10 they filled all five
// slots of a run ahead of the real videos.
export function ytId(value) {
  const s = String(value || '').trim();
  const m = s.match(/(?:youtu\.be\/|[?&]v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
  const id = m ? m[1] : s;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  if (/^media[0-9a-z]+$/.test(id)) return null;
  return id;
}

// Only 404 means the file is missing. A login page, 403 or a dead host says nothing
// about the file (2026-09-10: test.* closed behind login and every video looked lost).
export function probeVerdict(status, contentType) {
  if ((status === 200 || status === 206) && /^video\//i.test(String(contentType || ''))) return 'have';
  if (status === 404) return 'missing';
  return 'unknown';
}

export function probeIsBlind(unknownCount, checkedCount) {
  return checkedCount > 0 && unknownCount * 2 >= checkedCount;
}
