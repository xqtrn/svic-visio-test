/* Страница фото нового участника (/my-photo). Замок (src/services/member-photo.js)
 * пускает дальше, как только фото сохранено; Continue ведёт туда, куда человек шёл. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var S = { data: null, hasPhoto: false };

  function next() {
    var n = new URLSearchParams(location.search).get('next') || '/';
    return /^\/(?!\/)/.test(n) && n.indexOf('/my-photo') !== 0 ? n : '/';
  }
  function err(msg) { $('mpErr').textContent = msg || ''; $('mpErr').hidden = !msg; }
  async function api(path, opts) {
    opts = opts || {};
    var r = await fetch(path, { method: opts.method || 'GET', credentials: 'same-origin', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
    var b = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(b.error || 'Something went wrong. Try again in a moment.'); e.code = b.code; throw e; }
    return b;
  }
  function buttons() {
    var L = window.SVICMemberPhoto.labels(S.hasPhoto);
    $('mpPick').textContent = L.pick;
    $('mpCamera').hidden = !L.showCamera;
    if (L.showCamera) $('mpCamera').textContent = L.camera;
  }
  function show(url) {
    S.hasPhoto = true;
    $('mpImg').src = url; $('mpImg').hidden = false; $('mpInit').hidden = true;
    $('mpTag').hidden = false;
    $('mpNext').disabled = false; $('mpHint').hidden = true;
    buttons();
  }
  async function onFile(e) {
    var f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    var b1 = $('mpPick'), b2 = $('mpCamera'); b1.disabled = b2.disabled = true;
    if (window.UI && window.UI.startProgress) window.UI.startProgress();
    try {
      var dataUrl = await window.SVICMemberPhoto.read(f, S.data && S.data.minSide);
      var d = await api('/api/member-photo', { method: 'PUT', body: { dataUrl: dataUrl } });
      err('');
      show(d.photoUrl);
    } catch (x) { err(x.message); }
    finally {
      b1.disabled = b2.disabled = false;
      if (window.UI && window.UI.doneProgress) window.UI.doneProgress();
    }
  }
  async function load() {
    try {
      S.data = await api('/api/member-photo');
    } catch (e) { err(e.message); buttons(); return; }
    var first = String(S.data.name || '').trim().split(/\s+/)[0];
    if (first) $('mpHead').textContent = 'One last step, ' + first + '.';
    $('mpInit').textContent = window.SVICMemberPhoto.initials(S.data.name);
    if (S.data.photoUrl) {
      show(S.data.photoUrl);
      $('mpLead').textContent = 'Your photo is on your account. You can replace it here.';
    } else buttons();
    if (S.data.preview) { $('mpPick').disabled = true; $('mpCamera').disabled = true; }
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('#mpPick')) return $('mpFile').click();
    if (e.target.closest('#mpCamera')) return $('mpCamFile').click();
    if (e.target.closest('#mpNext')) { location.href = next(); }
  });
  document.addEventListener('change', function (e) { if (e.target.id === 'mpFile' || e.target.id === 'mpCamFile') onFile(e); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
