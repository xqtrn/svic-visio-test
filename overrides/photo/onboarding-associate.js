/* Настройка associate на странице первого входа (Артур 2026-10-20, утверждённое
 * демо candidate-onboarding-demo, 30-ob). Четыре шага: Account (LinkedIn,
 * Face ID по желанию) → Details (телефон, страна, штат, город и — новому
 * участнику с 2026-10-25 — фото: камера на телефоне, загрузка на компьютере;
 * тестовому кандидату всё заполнено вымышленными значениями) → Documents (Associate Agreement и Confidentiality Agreement
 * одной подписью в нашей электронной подписи, как вошедший человек) → Work
 * email (имя.фамилия@siliconvalleyinvestclub.com, подпись готова). Готово —
 * платформа открывается в Mail с окном приветствия. Каждый шаг сохраняется
 * сразу: возврат на страницу продолжает с первого незаконченного шага.
 * Включает его onboarding.js, когда /api/onboarding отвечает variant=associate. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var STEPS = ['Account', 'Details', 'Documents', 'Work email'];
  var ASIDE = {
    1: ['Step 1 of 4 · Account', 'Secure your account.', 'You sign in with LinkedIn. Face ID is optional: add it and this device signs you in with a single touch.'],
    2: ['Step 2 of 4 · Details', 'About you.', 'Your phone and city, so the desk can reach you.'],
    3: ['Step 3 of 4 · Documents', 'Your documents.', 'Two documents, signed through our e-signature service as the person already signed in. No code to enter.'],
    4: ['Step 4 of 4 · Work email', 'Your work email.', 'Every associate gets an address in the same format: first name dot last name at siliconvalleyinvestclub.com.'],
  };
  var S = { data: null, methods: null, step: 1, icons: {}, api: null, busy: false, pendingPhoto: null };

  function err(id, msg) { var el = $(id); el.textContent = msg || ''; el.hidden = !msg; }
  function a() { return S.data.associate || {}; }
  function docs() { return a().documents || {}; }
  function firstName() { return a().firstName || String((S.data.user && S.data.user.name) || '').split(' ')[0]; }

  function go(step) {
    S.step = step;
    document.querySelectorAll('.ob-panel').forEach(function (p) { p.classList.toggle('on', +p.getAttribute('data-astep') === step); });
    $('obSteps').innerHTML = STEPS.map(function (n, i) {
      var k = i + 1, cls = k < step ? 'done' : (k === step ? 'on' : '');
      return '<div class="step ' + cls + '"' + (k === step ? ' aria-current="step"' : '') + '><span class="n">' + (k < step ? S.icons.check : k) + '</span>' + n + '</div>';
    }).join('');
    var A = ASIDE[step];
    $('aEyebrow').textContent = A[0];
    $('aHead').textContent = step === 1 && firstName() ? 'Welcome, ' + firstName() + '.' : A[1];
    $('aSub').textContent = step === 2 && photoRequired() ? 'Your phone, city and photo. The desk can reach you, and your photo appears on your profile and in your email signature.' : A[2];
    if (step === 3) renderDocs();
    if (step === 4) renderMail();
    window.scrollTo(0, 0);
  }

  // ── 1. Вход ──
  // Тестовый кандидат (репетиция): плашка «это тест» и тестовый вход вместо LinkedIn.
  function renderTest() {
    var t = a().test;
    if (!$('aTest')) return;
    $('aTest').hidden = !t;
    if (t && t.expiresAt) $('aTestText').textContent = 'This is a test setup, not a real person: nothing here reaches a candidate. It is removed after ' + new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t.expiresAt)) + '.';
  }
  function renderAccount() {
    var ids = (S.methods && S.methods.identities) || [];
    var li = ids.find(function (i) { return i.provider === 'linkedin'; });
    var test = !!a().test;
    $('aLiState').textContent = li ? 'Signed in as ' + ((S.data.user && S.data.user.name) || 'you')
      : test ? 'Test link: a real candidate signs in with LinkedIn here' : 'Not connected yet';
    $('aLiTag').hidden = !(li || test);
    $('aLiTag').className = 'tag ' + (li ? 'ready' : 'pending');
    $('aLiTag').lastChild.textContent = li ? 'Connected' : 'Test';
    var keys = ((S.methods && S.methods.passkeys) || []).length;
    var can = window.SVICPasskey && window.SVICPasskey.supported();
    $('aBtnFace').hidden = keys > 0 || !can;
    $('aPkTag').hidden = keys === 0;
    if (!can && !keys) $('aPkState').textContent = 'This browser cannot save a passkey. Add Face ID later from your phone.';
  }
  async function onFace() {
    var b = $('aBtnFace'); b.disabled = true;
    try {
      if (await window.SVICPasskey.enroll()) { S.methods = await S.api('/api/auth/methods'); renderAccount(); }
    } catch (e) { if (window.showToast) window.showToast(e.message || 'Could not add Face ID', true); }
    finally { b.disabled = false; }
  }

  // ── 2. Данные: страна решает вид региона (США — штаты, Канада — провинции, остальные — текст) ──
  function countries() {
    var list = S.data.countries;
    return list && list.length ? list : [{ code: 'US', name: 'United States', dial: '1', regionLabel: 'State', regions: S.data.states || [] }];
  }
  function country(code) { var l = countries(); for (var i = 0; i < l.length; i++) if (l[i].code === code) return l[i]; return l[0]; }
  function region() { return country($('aCtry').value).regions.length ? $('aSt').value : String($('aStText').value || '').trim(); }
  function fillRegions(code, keep) {
    var c = country(code), listed = c.regions.length > 0;
    $('aSt').innerHTML = '<option value="">Select…</option>' + c.regions.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('');
    if (listed && keep && c.regions.indexOf(keep) >= 0) $('aSt').value = keep;
    if (!listed) $('aStText').value = keep || '';
    $('aSt').hidden = !listed; $('aStText').hidden = listed;
    $('aStLabel').htmlFor = listed ? 'aSt' : 'aStText';
    $('aStLabel').textContent = c.regionLabel;
  }
  function placeholder(code) { return country(code).dial === '1' ? '(555) 555-0100' : 'Mobile number'; }
  // Фото обязательно новому участнику (сервер: src/services/member-photo.js).
  function photoRequired() { return !!(S.data && S.data.photoRequired); }
  function hasPhoto() { return !!((S.data.profile || {}).photoUrl); }
  function photoButtons() {
    var L = window.SVICMemberPhoto ? window.SVICMemberPhoto.labels(hasPhoto() || !!S.pendingPhoto) : { pick: 'Upload photo', showCamera: false };
    $('aBtnPhoto').textContent = L.pick;
    $('aBtnCamera').hidden = !L.showCamera;
    if (L.showCamera) $('aBtnCamera').textContent = L.camera;
  }
  function showPhoto(url, test) {
    $('aPhotoImg').src = url; $('aPhotoImg').hidden = false; $('aPhotoInit').hidden = true;
    var tag = $('aPhotoTag');
    tag.hidden = false;
    tag.className = 'tag ' + (test ? 'pending' : 'ready');
    tag.innerHTML = '<span class="dot"></span>' + (test ? 'Test photo' : 'Added');
    $('aPhotoNote').textContent = test ? 'A test picture stands in for the candidate’s photo. A real candidate takes or uploads their own.' : 'On your profile and in your email signature.';
    photoButtons();
  }
  function renderDetails() {
    var p = S.data.profile || {};
    // Тестовый кандидат: каждое обязательное поле уже заполнено вымышленным значением.
    var pre = S.data.prefill || {};
    $('aCtry').innerHTML = countries().map(function (c) { return '<option value="' + esc(c.code) + '">' + esc(c.name) + '</option>'; }).join('');
    $('aPhc').innerHTML = countries().map(function (c) { return '<option value="' + esc(c.code) + '">' + esc(c.code) + ' +' + esc(c.dial || '1') + '</option>'; }).join('');
    $('aCtry').value = country(p.country || pre.country || 'US').code;
    fillRegions($('aCtry').value, p.state || pre.state);
    $('aPhc').value = pre.phoneCountry && !p.phone ? country(pre.phoneCountry).code : $('aCtry').value; $('aPh').placeholder = placeholder($('aCtry').value);
    if (p.phone || pre.phone) $('aPh').value = p.phone || pre.phone;
    if (p.city || pre.city) $('aCity').value = p.city || pre.city;
    $('aPhotoRow').hidden = !photoRequired();
    if (photoRequired()) {
      $('aDetLead').textContent = 'So the desk can reach you, and colleagues and clients know who you are. Every field is required.';
      $('aPhotoInit').textContent = window.SVICMemberPhoto ? window.SVICMemberPhoto.initials((S.data.user && S.data.user.name) || '') : '';
      if (hasPhoto()) showPhoto(p.photoUrl, false);
      else if (pre.photo) { S.pendingPhoto = pre.photo; showPhoto(pre.photo, true); }
      else photoButtons();
    }
    gate();
  }
  async function onPhotoFile(e) {
    var f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      var dataUrl = await window.SVICMemberPhoto.read(f);
      var d = await S.api('/api/onboarding/photo', { method: 'PUT', body: { dataUrl: dataUrl } });
      S.pendingPhoto = null;
      S.data.profile = Object.assign({}, S.data.profile, { photoUrl: d.photoUrl });
      showPhoto(d.photoUrl, false);
      err('aDetErr', '');
    } catch (x) { err('aDetErr', x.message); }
    gate();
  }
  function gate() {
    var raw = String($('aPh').value || '').trim(), digits = raw.replace(/\D/g, '');
    var nanp = raw.charAt(0) !== '+' && country($('aPhc').value).dial === '1';
    var missing = [];
    if (nanp ? digits.replace(/^1(?=\d{10}$)/, '').length !== 10 : (digits.length < 7 || digits.length > 15)) missing.push('phone');
    if (!region()) missing.push(country($('aCtry').value).regionLabel.toLowerCase().replace(' or territory', ''));
    if (String($('aCity').value || '').trim().length < 2) missing.push('city');
    if (photoRequired() && !hasPhoto() && !S.pendingPhoto) missing.push('photo');
    $('aBtnDetails').disabled = missing.length > 0;
    $('aDetHint').hidden = missing.length === 0;
    if (missing.length) $('aDetHint').textContent = 'Add your ' + (missing.length > 1 ? missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1] : missing[0]) + ' to continue.';
  }
  async function onDetails() {
    var b = $('aBtnDetails'); b.disabled = true;
    try {
      // Тестовое фото уходит тем же путём, что настоящее, — по нажатию Continue.
      if (photoRequired() && !hasPhoto() && S.pendingPhoto) {
        var ph = await S.api('/api/onboarding/photo', { method: 'PUT', body: { dataUrl: S.pendingPhoto } });
        S.pendingPhoto = null;
        S.data.profile = Object.assign({}, S.data.profile, { photoUrl: ph.photoUrl });
      }
      var d = await S.api('/api/onboarding/details', { method: 'PUT', body: { country: $('aCtry').value, phoneCountry: $('aPhc').value, phone: $('aPh').value, state: region(), city: $('aCity').value } });
      $('aPh').value = d.phone;
      S.data.profile = Object.assign({}, S.data.profile, d);
      err('aDetErr', '');
      go(3);
    } catch (e) {
      err('aDetErr', e.message);
      var f = { country: 'aCtry', phone: 'aPh', state: country($('aCtry').value).regions.length ? 'aSt' : 'aStText', city: 'aCity' }[e.field]; if (f) $(f).focus();
    } finally { b.disabled = false; gate(); }
  }

  // ── 3. Документы ──
  function day(at) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(at)); }
  function renderDocs() {
    var d = docs();
    var signed = !!d.signed;
    var again = ['declined', 'voided', 'expired'].indexOf(d.state) >= 0;
    $('aDocs').innerHTML = (d.items || []).map(function (it, i) {
      var t = signed ? '<span class="tag ready"><span class="dot"></span>Signed</span>' : '<span class="tag"><span class="dot"></span>To sign</span>';
      return '<div class="ob-item' + (signed ? ' done' : '') + '" id="aDoc' + (i + 1) + '"><span class="num">' + (signed ? S.icons.check : i + 1) + '</span><div class="grow"><div class="t">' + esc(it.title) + '</div><div class="s">' + esc(it.subtitle) + '</div></div><div class="side">' + t + '</div></div>';
    }).join('');
    $('aBtnSign').hidden = signed;
    $('aBtnSign').lastChild.textContent = again ? 'Sign both again' : 'Review and sign both';
    $('aDocLink').hidden = !d.documentUrl;
    $('aDocLink').textContent = d.countersigned ? 'Download signed copy' : 'View documents';
    $('aSignNote').hidden = !signed;
    if (signed) {
      $('aSignNote').textContent = 'Signed by you' + (d.signedAt ? ' · ' + day(d.signedAt) : '') + '. ' +
        (d.countersigned ? 'Countersigned by ' + d.countersigner + ' for ' + d.firm + '.' : (d.firm || 'SVIC LTD') + ' countersigns shortly; you can continue.');
    }
    $('aBtnDocsNext').disabled = !signed;
  }
  async function onSign(retry) {
    if (docs().signed || S.busy) return;
    var b = $('aBtnSign'); b.disabled = true; S.busy = true;
    err('aDocErr', '');
    if (window.UI && window.UI.startProgress) window.UI.startProgress();
    try {
      var d = await S.api('/api/onboarding/associate/documents', { method: 'POST', body: {} });
      S.data.associate = d.associate;
      if (d.url) { location.href = d.url; return; }
      renderDocs();
    } catch (e) {
      if (e.code === 'preparing' && !retry) { S.busy = false; setTimeout(function () { onSign(true); }, 1500); return; }
      err('aDocErr', e.message);
    } finally {
      S.busy = false; b.disabled = false;
      if (window.UI && window.UI.doneProgress) window.UI.doneProgress();
    }
  }

  // Адрес переносится по «@», а не посреди домена.
  function addr(x) { $('aAddrText').innerHTML = esc(x.workEmail || x.plannedEmail || '').replace('@', '<wbr>@'); }
  // ── 4. Рабочий адрес: заведён на шаге документов; здесь он показан и подтверждён ──
  function renderMail() {
    var x = a();
    addr(x);
    var ready = !!x.mailboxReady;
    var tag = $('aAddrTag');
    tag.className = 'tag ' + (ready ? 'ready' : '');
    tag.innerHTML = '<span class="dot"></span>' + (ready ? 'Created' : 'Creating');
    $('aBtnMailNext').disabled = !ready;
    if (!ready && !S.busy) ensureMailbox();
  }
  async function ensureMailbox() {
    S.busy = true;
    try {
      var d = await S.api('/api/onboarding/associate/mailbox', { method: 'POST', body: {} });
      S.data.associate = d.associate; err('aMailErr', '');
    } catch (e) { err('aMailErr', e.message); }
    S.busy = false;
    if (S.step === 4) { var x = a(); addr(x); $('aAddrTag').className = 'tag ' + (x.mailboxReady ? 'ready' : ''); $('aAddrTag').innerHTML = '<span class="dot"></span>' + (x.mailboxReady ? 'Created' : 'Creating'); $('aBtnMailNext').disabled = !x.mailboxReady; }
  }
  async function onFinish() {
    var b = $('aBtnMailNext'); b.disabled = true;
    try {
      var d = await S.api('/api/onboarding/associate/complete', { method: 'POST', body: {} });
      location.href = d.next || '/mailbox';
    } catch (e) { err('aMailErr', e.message); b.disabled = false; }
  }

  function firstOpenStep() {
    var p = S.data.profile || {};
    if (a().completedAt) return 4;
    if (!(p.phone && p.state && p.city) || (photoRequired() && !p.photoUrl)) return p.phone || p.photoUrl || ((S.methods && S.methods.passkeys) || []).length ? 2 : 1;
    if (!docs().signed) return 3;
    return 4;
  }
  var NAMED = { account: 1, details: 2, documents: 3, agreement: 3, email: 4, mail: 4 };

  function start(data, methods, ctx) {
    S.data = data; S.methods = methods; S.icons = ctx.icons; S.api = ctx.api;
    document.querySelectorAll('[data-icon]').forEach(function (el) { el.innerHTML = S.icons[el.getAttribute('data-icon')] || ''; });
    ctx.showPanel(-99);
    renderTest(); renderAccount(); renderDetails();
    var first = firstOpenStep();
    var named = NAMED[new URLSearchParams(location.search).get('step')];
    go(named && (named <= first || data.preview) ? named : first);
    if (data.associate && data.associate.completedAt && !data.preview) { location.replace('/mailbox'); return; }

    document.addEventListener('click', function (e) {
      var back = e.target.closest('[data-aback]'); if (back) return go(+back.getAttribute('data-aback'));
      if (e.target.closest('#aBtnNext1')) return go(2);
      if (e.target.closest('#aBtnFace')) return onFace();
      if (e.target.closest('#aBtnDetails')) return onDetails();
      if (e.target.closest('#aBtnPhoto')) return $('aPhotoFile').click();
      if (e.target.closest('#aBtnCamera')) return $('aPhotoCam').click();
      if (e.target.closest('#aBtnSign')) return onSign(false);
      if (e.target.closest('#aBtnDocsNext')) return go(4);
      if (e.target.closest('#aBtnMailNext')) return onFinish();
    });
    document.addEventListener('change', function (e) {
      if (e.target.id === 'aCtry') { fillRegions(e.target.value, region()); $('aPhc').value = country(e.target.value).code; $('aPh').placeholder = placeholder(e.target.value); return gate(); }
      if (e.target.id === 'aPhc') { $('aPh').placeholder = placeholder(e.target.value); return gate(); }
      if (e.target.id === 'aSt') return gate();
      if (e.target.id === 'aPhotoFile' || e.target.id === 'aPhotoCam') return onPhotoFile(e);
    });
    document.addEventListener('input', function (e) { if (e.target.id === 'aPh' || e.target.id === 'aCity' || e.target.id === 'aStText') gate(); });
    // Вернулась со страницы подписи в другой вкладке — перечитать состояние документов.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || S.step !== 3 || docs().signed) return;
      S.api('/api/onboarding').then(function (d) { if (d && d.associate) { S.data.associate = d.associate; renderDocs(); } }).catch(function () {});
    });
  }

  window.SVICAssociateSetup = { start: start, STEPS: STEPS };
})();
