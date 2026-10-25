/* Первый вход нового человека (Артур 2026-09-24, шесть шагов 2026-09-25):
 * вход (LinkedIn уже привязан приглашением, здесь добавляется Face ID) →
 * свои данные → соглашение (короткое Confidentiality Agreement через нашу
 * электронную подпись; её подписи достаточно, SVIC LTD контрподписывает
 * позже) → обучение → часы → Zoom → готово.
 * Каждый шаг сохраняется сразу, поэтому возврат на страницу продолжает с
 * первого незаконченного шага. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ICONS = {
    li: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 11v6M8 8v.01M12 17v-4.5a2 2 0 0 1 4 0V17"/></svg>',
    face: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 15.5c1.4 1.2 3.6 1.2 5 0"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 8.6v6.8l5.4-3.4z"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    quiz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17"/></svg>',
  };
  var STEPS = ['Account', 'Details', 'Agreement', 'Training', 'Hours', 'Zoom'];
  var LAST = STEPS.length;
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var state = { data: null, methods: null, step: 1, passkeys: 0, trainingOpened: false, qz: null };

  function aside(step, first) {
    var A = {
      1: ['Step 1 of 6 · Account', 'Secure your account.', 'You sign in with LinkedIn. Face ID is optional: add it and this device signs you in with a single touch, or skip it and keep signing in with LinkedIn.'],
      2: ['Step 2 of 6 · Details', 'About you.', 'Your phone lets the desk reach you. Your photo tells candidates who they are about to meet.'],
      3: ['Step 3 of 6 · Agreement', 'Confidentiality.', 'Candidates share personal and professional details with us. Everything you hear and see on the platform stays with the firm. You sign the agreement through our e-signature service, as the person already signed in.'],
      4: ['Step 4 of 6 · Training', 'How your calls work.', 'A video on your own screens: how your calls work, from the first booking to your report. Then a quick check, about two minutes.'],
      5: ['Step 5 of 6 · Hours', 'Your hours.', 'Choose when you are free. Candidates book 15-minute calls back to back inside these windows. Nothing to schedule by hand.'],
      6: ['Step 6 of 6 · Zoom', 'Your Zoom.', 'You activate your Zoom account in the firm’s account once. After that every booking gets its own Zoom link, with you as the host. Nothing else to set up.'],
      7: ['All set', 'Setup complete.', 'Candidates can now book time with you. Every call appears under Interviews with the application and your questions ready. Zoom links, notes and your report run on their own.'],
    }[step];
    if (!A) return;
    $('aEyebrow').textContent = A[0];
    $('aHead').textContent = step === 1 && first ? 'Welcome to the desk, ' + first + '.' : A[1];
    $('aSub').textContent = A[2];
  }

  async function api(path, opts) {
    var o = Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {});
    if (o.body && typeof o.body !== 'string') o.body = JSON.stringify(o.body);
    var r = await fetch(path, o);
    var d = {}; try { d = await r.json(); } catch (_) {}
    if (!r.ok) { var e = new Error(d.error || ('Request failed: ' + r.status)); e.field = d.field; e.code = d.code; throw e; }
    return d;
  }
  function err(id, msg) { var el = $(id); el.textContent = msg || ''; el.hidden = !msg; }
  function firstName() { return String((state.data && state.data.user && state.data.user.name) || '').split(' ')[0]; }

  function go(step) {
    state.step = step;
    document.querySelectorAll('.ob-panel').forEach(function (p) { p.classList.toggle('on', +p.getAttribute('data-step') === step); });
    $('obSteps').innerHTML = step > LAST || step < 1 ? '' : STEPS.map(function (n, i) {
      var k = i + 1, cls = k < step ? 'done' : (k === step ? 'on' : '');
      return '<div class="step ' + cls + '"' + (k === step ? ' aria-current="step"' : '') + '><span class="n">' + (k < step ? ICONS.check : k) + '</span>' + n + '</div>';
    }).join('');
    aside(step, firstName());
    if (step === 4) renderTraining();
    if (step === 6) renderZoom();
    if (step === LAST + 1) renderDone();
    window.scrollTo(0, 0);
  }

  // ── 1. Вход ──
  function renderAccount() {
    var ids = (state.methods && state.methods.identities) || [];
    var li = ids.find(function (i) { return i.provider === 'linkedin'; });
    $('liState').textContent = li ? ((state.data.user.name || 'Your LinkedIn') + ' · connected') : 'Not connected yet';
    $('liTag').hidden = !li;
    var mail = state.data.user && state.data.user.email;
    if (li && mail) $('liLead').innerHTML = 'Your platform work email is <b>' + esc(mail) + '</b>. LinkedIn sign-in follows your LinkedIn account, even if its email changes. You can also add Face ID for this device.';
    state.passkeys = ((state.methods && state.methods.passkeys) || []).length;
    var can = window.SVICPasskey && window.SVICPasskey.supported();
    $('btnFace').hidden = state.passkeys > 0 || !can;
    $('pkTag').hidden = state.passkeys === 0;
    // Face ID по желанию: без него шаг закрывает «Skip for now», с ним — «Continue».
    var added = state.passkeys > 0 || !can;
    $('btnNext1').hidden = !added;
    $('btnSkip1').hidden = added;
    if (!can && !state.passkeys) $('pkState').textContent = 'This browser cannot save a passkey. Add Face ID later from your phone.';
  }
  async function onFace() {
    var b = $('btnFace'); b.disabled = true;
    try {
      if (await window.SVICPasskey.enroll()) {
        state.methods = await api('/api/auth/methods');
        renderAccount();
      }
    } catch (e) {
      if (window.showToast) window.showToast(e.message || 'Could not add Face ID', true);
    } finally { b.disabled = false; }
  }

  // ── 2. Данные ──
  // Страна решает подпись и вид региона: США — штаты, Канада — провинции и
  // территории, остальные страны — свободный текст. Телефон — любой страны
  // (Артур 2026-10-07): код по умолчанию следует стране, но выбирается отдельно.
  function countries() {
    var list = state.data && state.data.countries;
    return list && list.length ? list : [{ code: 'US', name: 'United States', dial: '1', regionLabel: 'State', regions: state.data.states || [] }];
  }
  function regionValue() {
    return countryByCode($('ctry').value).regions.length ? $('st').value : String($('stText').value || '').trim();
  }
  function placeholderFor(code) {
    return countryByCode(code).dial === '1' ? '(555) 555-0100' : 'Mobile number';
  }
  function countryByCode(code) {
    var list = countries();
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
    return list[0];
  }
  function fillRegions(code, keep) {
    var c = countryByCode(code);
    var sel = $('st'), txt = $('stText');
    var listed = c.regions.length > 0;
    sel.innerHTML = '<option value="">Select…</option>' + c.regions.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    if (listed && keep && c.regions.indexOf(keep) >= 0) sel.value = keep;
    if (!listed) txt.value = keep && US_CA_REGION.indexOf(keep) < 0 ? keep : '';
    sel.hidden = !listed; txt.hidden = listed;
    $('stLabel').htmlFor = listed ? 'st' : 'stText';
    $('stLabel').textContent = c.regionLabel;
  }
  var US_CA_REGION = [];
  function setDial(code) {
    $('phc').value = countryByCode(code).code;
    $('ph').placeholder = placeholderFor(code);
  }
  function renderDetails() {
    var p = (state.data && state.data.profile) || {};
    var ctry = $('ctry');
    ctry.innerHTML = countries().map(function (c) { return '<option value="' + esc(c.code) + '">' + esc(c.name) + '</option>'; }).join('');
    $('phc').innerHTML = countries().map(function (c) { return '<option value="' + esc(c.code) + '">' + esc(c.code) + ' +' + esc(c.dial || '1') + '</option>'; }).join('');
    US_CA_REGION = countries().filter(function (c) { return c.regions.length; }).reduce(function (a, c) { return a.concat(c.regions); }, []);
    ctry.value = countryByCode(p.country || 'US').code;
    fillRegions(ctry.value, p.state);
    setDial(ctry.value);
    // Сохранённый номер +1 хранится без кода — его код и показываем.
    if (/^\(\d{3}\)/.test(p.phone || '') && countryByCode(ctry.value).dial !== '1') { $('phc').value = 'US'; $('ph').placeholder = placeholderFor('US'); }
    if (p.phone) $('ph').value = p.phone;
    if (p.city) $('city').value = p.city;
    var name = (state.data.user && state.data.user.name) || '';
    $('photoInit').textContent = name.split(' ').map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
    if (p.photoUrl) showPhoto(p.photoUrl); else photoButtons();
    detailsGate();
  }
  // Кнопки фото по устройству (member-photo.js): телефон — камера и выбор, компьютер — загрузка.
  function photoButtons() {
    var L = window.SVICMemberPhoto ? window.SVICMemberPhoto.labels(!!state.hasPhoto) : { pick: state.hasPhoto ? 'Change photo' : 'Upload photo', showCamera: false };
    $('btnPhoto').textContent = L.pick;
    $('btnCamera').hidden = !L.showCamera;
    if (L.showCamera) $('btnCamera').textContent = L.camera;
  }
  function showPhoto(url) {
    $('photoImg').src = url; $('photoImg').hidden = false; $('photoInit').hidden = true;
    $('photoTag').hidden = false;
    state.hasPhoto = true;
    photoButtons();
    detailsGate();
  }
  // Все четыре обязательны (Артур 2026-09-25: фото — обязательно): Continue
  // открывается, когда есть телефон из 10 цифр, штат, город и фото.
  function detailsGate() {
    // Окончательную проверку номера делает сервер; здесь — только «похоже на номер».
    var raw = String($('ph').value || '').trim();
    var digits = raw.replace(/\D/g, '');
    var nanp = raw.charAt(0) !== '+' && countryByCode($('phc').value).dial === '1';
    var missing = [];
    if (nanp ? digits.replace(/^1(?=\d{10}$)/, '').length !== 10 : (digits.length < 7 || digits.length > 15)) missing.push('phone');
    if (!regionValue()) missing.push(countryByCode($('ctry').value).regionLabel.toLowerCase().replace(' or territory', ''));
    if (String($('city').value || '').trim().length < 2) missing.push('city');
    if (!state.hasPhoto) missing.push('photo');
    $('btnDetails').disabled = missing.length > 0;
    $('detHint').hidden = missing.length === 0;
    if (missing.length) $('detHint').textContent = 'Add your ' + (missing.length > 1 ? missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1] : missing[0]) + ' to continue.';
  }
  // Фото проверяется и уменьшается в браузере (member-photo.js) — на страницу
  // записи и в подпись уходит аватар, не оригинал с телефона на десятки мегабайт.
  async function onPhotoFile(e) {
    var f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      var dataUrl = await window.SVICMemberPhoto.read(f);
      var d = await api('/api/onboarding/photo', { method: 'PUT', body: { dataUrl: dataUrl } });
      state.data.profile = Object.assign({}, state.data.profile, { photoUrl: d.photoUrl });
      showPhoto(d.photoUrl);
      err('detErr', '');
    } catch (x) { err('detErr', x.message); }
  }
  async function onDetails() {
    var b = $('btnDetails'); b.disabled = true;
    try {
      var d = await api('/api/onboarding/details', { method: 'PUT', body: { country: $('ctry').value, phoneCountry: $('phc').value, phone: $('ph').value, state: regionValue(), city: $('city').value } });
      $('ph').value = d.phone;
      state.data.profile = Object.assign({}, state.data.profile, d);
      err('detErr', '');
      go(3);
    } catch (e) {
      err('detErr', e.message);
      var f = { country: 'ctry', phone: 'ph', state: countryByCode($('ctry').value).regions.length ? 'st' : 'stText', city: 'city' }[e.field]; if (f) $(f).focus();
    } finally { b.disabled = false; }
  }

  // ── 3. Соглашение ──
  function day(at) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(at)); }
  function setTag(id, cls, text) { var el = $(id); el.className = 'tag ' + cls; el.innerHTML = '<span class="dot"></span>' + esc(text); }
  function staffSigned() { var a = state.data.agreement || {}; return !!a.staffSigned; }
  function ln(icon, text) { return ICONS[icon] + '<span>' + esc(text) + '</span>'; }
  function renderAgreement() {
    var a = state.data.agreement || {};
    var name = (state.data.user && state.data.user.name) || 'You';
    $('agTitle').textContent = a.title || 'Confidentiality Agreement';
    $('agSub').textContent = a.subtitle || '';
    $('agParties').textContent = (a.firm || 'SVIC LTD') + ' · ' + name;
    var signed = staffSigned(), sealed = a.state === 'completed';
    var again = a.state === 'declined' || a.state === 'voided' || a.state === 'expired';
    setTag('agTag', sealed || signed ? 'ready' : (again ? 'bad' : ''), sealed ? 'Signed' : signed ? 'Signed' : again ? (a.state === 'declined' ? 'Declined' : 'Withdrawn') : 'To sign');
    $('agFt').hidden = signed;
    $('agLog').hidden = !signed;
    if (signed) {
      $('agLnYou').innerHTML = ln('check', 'Signed by ' + name + ' · ' + day(a.signedAt));
      var fl = $('agLnFirm');
      fl.classList.toggle('wait', !sealed);
      fl.innerHTML = sealed
        ? ln('check', 'Countersigned by ' + a.countersigner + ' for ' + a.firm + ' · ' + day(a.countersignedAt || a.completedAt))
        : ln('clock', 'Signed. ' + (a.firm || 'SVIC LTD') + ' countersigns shortly; you can continue.');
      $('agLnMail').hidden = !sealed;
      $('agLnMail').innerHTML = ln('mail', 'Sealed copy sent to ' + (a.workEmail || 'your work email'));
    }
    $('btnSign').lastChild.textContent = again ? 'Sign again' : 'Review and sign';
    $('btnAgNext').disabled = !signed;
    $('agDoc').hidden = !signed;
    $('agDoc').textContent = sealed ? 'Download signed copy' : 'View document';
    $('btnSign').disabled = !a.workEmail;
    err('agErr', !a.workEmail && !signed ? 'Your work email is not set up yet. The desk will add it, then you can sign.' : '');
  }
  async function onSign(retry) {
    if (staffSigned()) return;
    var b = $('btnSign'); b.disabled = true;
    try {
      var d = await api('/api/onboarding/agreement', { method: 'POST', body: {} });
      state.data.agreement = d.agreement;
      if (d.url) { location.href = d.url; return; }
      renderAgreement();
      err('agErr', '');
    } catch (e) {
      // Конверт готовит соседнее нажатие: через мгновение он будет, пробуем ещё раз.
      if (e.code === 'preparing' && !retry) { setTimeout(function () { onSign(true); }, 1500); return; }
      err('agErr', e.message);
    }
    b.disabled = false;
  }

  // ── 4. Обучение ──
  // Две строки (Артур 2026-10-09: проверка «в отдельном окне»): урок и короткая
  // проверка. Проверка открывается своим окном (/onboarding/quick-check), там
  // же ответы проверяет сервер. Закончила — окно сообщает сюда (канал вкладок,
  // opener, storage), строка показывает счёт, Continue открывается без
  // перезагрузки. Шаг пройден: урок просмотрен и проверка отправлена хотя бы
  // раз — с любым счётом.
  var QUICK_CHECK_URL = '/onboarding/quick-check';
  function quiz() { return (state.data.training && state.data.training.quiz) || null; }
  function trainingDone() {
    var t = state.data.training || {};
    var q = t.quiz || {};
    return !!(t.viewedAt && q.last);
  }
  function renderTraining() {
    var t = state.data.training || {};
    var q = quiz() || {};
    var last = q.last || null;
    var watched = !!t.viewedAt;
    $('trLen').textContent = (t.minutes ? t.minutes + ' min · ' : '') + 'voice and subtitles · opens in a new tab';
    $('trItem').classList.toggle('done', watched);
    $('trNum').innerHTML = watched ? ICONS.check : '1';
    $('trTag').hidden = !watched;
    var w = $('btnTrain');
    w.className = 'btn btn-sm ' + (watched ? 'btn-link' : 'btn-primary');
    w.lastChild.textContent = watched ? 'Watch again' : 'Watch the video';
    // Число вопросов — с сервера (training-quiz.js), в разметке его нет.
    $('qzCount').textContent = q.total ? q.total + ' questions · ' : '';
    $('qzItem').classList.toggle('done', !!last);
    $('qzItem').classList.toggle('locked', !watched);
    $('qzNum').innerHTML = last ? ICONS.check : '2';
    $('qzSub').textContent = !watched ? 'Opens once the video has started.'
      : last ? 'Your score: ' + last.score + ' of ' + last.total + ((last.missed || []).length ? ' · ' + last.missed.length + ' to review' : ' · all correct')
      : 'Short questions on the video. Any score lets you continue.';
    var b = $('btnQuiz');
    b.disabled = !watched;
    b.className = 'btn btn-sm ' + (last ? 'btn-ghost' : 'btn-primary');
    b.lastChild.textContent = last ? 'Retake' : 'Start the quick check';
    var done = trainingDone();
    $('btnTrainNext').disabled = !done;
    var hint = !watched ? (state.trainingOpened ? 'The quick check opens once the video has started.' : '') : (!done ? 'Finish the quick check to continue.' : '');
    $('trHint').textContent = hint; $('trHint').hidden = !hint;
  }
  // Своё окно проверки; повторное нажатие поднимает то же окно, а не второе.
  function openQuickCheck() {
    if ($('btnQuiz').disabled) return;
    var win = null;
    try { win = window.open(QUICK_CHECK_URL, 'svic-quick-check'); } catch (_) {}
    if (!win) location.href = QUICK_CHECK_URL;
    else { try { win.focus(); } catch (_) {} }
  }
  // Вернулась из вкладки с видео или окно проверки сообщило результат.
  async function refreshTraining() {
    if (!state.data) return;
    try {
      var d = await api('/api/onboarding');
      state.data.training = d.training;
      if (state.step === 4) renderTraining();
    } catch (_) {}
  }
  function onQuickCheckDone(msg) {
    if (!msg || msg.type !== 'svic-quick-check' || !state.data) return;
    var t = state.data.training || {};
    if (msg.attempt && t.quiz) { t.quiz.last = msg.attempt; if (state.step === 4) renderTraining(); }
    refreshTraining();
  }
  try {
    if (window.BroadcastChannel) new BroadcastChannel('svic-onboarding').onmessage = function (e) { onQuickCheckDone(e.data); };
  } catch (_) {}
  window.addEventListener('message', function (e) { if (e.origin === location.origin) onQuickCheckDone(e.data); });
  window.addEventListener('storage', function (e) {
    if (e.key !== 'svic-quick-check' || !e.newValue) return;
    try { onQuickCheckDone(JSON.parse(e.newValue)); } catch (_) {}
  });

  // ── 5. Часы ──
  function hm(min) { var h = Math.floor(min / 60), m = min % 60; var ap = h >= 12 ? 'PM' : 'AM'; return (((h + 11) % 12) + 1) + ':' + String(m).padStart(2, '0') + ' ' + ap; }
  function opts(sel) { var o = ''; for (var m = 7 * 60; m <= 21 * 60; m += 30) o += '<option value="' + m + '"' + (m === sel ? ' selected' : '') + '>' + hm(m) + '</option>'; return o; }
  function renderHours() {
    var h = state.data.hours;
    if (!h) {
      $('hoursBox').innerHTML = '<div class="banner">' + ICONS.info.replace('<svg', '<svg width="16" height="16"') + '<div>Your booking page is being prepared by the desk. You can set your hours later from the platform.</div></div>';
      $('btnHours').textContent = 'Continue';
      return;
    }
    var byDay = {};
    (h.intervals || []).forEach(function (i) { if (!byDay[i.weekday]) byDay[i.weekday] = i; });
    var zone = h.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    var zoneName = zone.replace(/_/g, ' ');
    try {
      var part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find(function (x) { return x.type === 'timeZoneName'; });
      if (part) zoneName = part.value + ', ' + zone.split('/').pop().replace(/_/g, ' ');
    } catch (_) {}
    $('hoursBox').innerHTML = '<p class="ob-tz">Time zone: <b>' + esc(zoneName) + '</b></p><div class="ob-hours">' +
      '<div class="ob-hrow ob-hhead" aria-hidden="true"><span>Day</span><span>From</span><span>To</span></div>' + DAYS.map(function (d, i) {
      var iv = byDay[i];
      return '<div class="ob-hrow' + (iv ? '' : ' off') + '" data-day="' + i + '"><label class="chk"><input type="checkbox"' + (iv ? ' checked' : '') + '> ' + d.slice(0, 3) + '</label>' +
        '<select data-start aria-label="' + d + ' from">' + opts(iv ? iv.startMinute : 540) + '</select><select data-end aria-label="' + d + ' to">' + opts(iv ? iv.endMinute : 1020) + '</select></div>';
    }).join('') + '</div>';
    state.zone = zone;
  }
  function hoursSaved() { return !state.data.hours || ((state.data.hours.intervals || []).length > 0); }
  async function onHours() {
    if (!state.data.hours) return go(6);
    var intervals = [];
    document.querySelectorAll('.ob-hrow[data-day]').forEach(function (r) {
      if (!r.querySelector('input').checked) return;
      intervals.push({ weekday: +r.getAttribute('data-day'), startMinute: +r.querySelector('[data-start]').value, endMinute: +r.querySelector('[data-end]').value });
    });
    if (!intervals.length) return err('hrsErr', 'Choose at least one day.');
    var b = $('btnHours'); b.disabled = true;
    try {
      await api('/api/onboarding/hours', { method: 'PUT', body: { timezone: state.zone, intervals: intervals } });
      state.data.hours.intervals = intervals;
      err('hrsErr', '');
      go(6);
    } catch (e) { err('hrsErr', e.message); } finally { b.disabled = false; }
  }

  // ── 6. Zoom ──
  // Кнопка открывает именно письмо Zoom в её ящике (сервер нашёл его по ящику,
  // адрес не зашит); шаг отмечается сам, когда её пользователь Zoom активен.
  function renderZoom() {
    var z = state.data.zoom || {};
    var ready = !!z.readyAt;
    var inv = z.invitation || null;
    var expired = !ready && !!(inv && inv.expired);
    var missing = !ready && !inv;
    // «Мы попросили новое» — только когда сервер это сделал (Zoom подтвердил,
    // что она не активна, и карточка админу заведена).
    var renewal = expired && !!z.renewalRequested;
    var missingRequested = missing && !!z.missingRequested;
    var box = z.workEmail || 'your work email';
    $('zLead').textContent = ready
      ? 'Your Zoom account is active. Every booking gets its own Zoom link, with you as the host.'
      : inv ? 'Open the Zoom invitation in your work email, ' + box + ', and activate your account.'
      : 'No Zoom invitation was found in your work mailbox, ' + box + '.';
    $('zTitle').textContent = ready ? 'Zoom account' : 'Zoom account invitation';
    $('zWhere').textContent = ready
      ? 'Active in the firm’s account. Every booking gets its own link, you host.'
      : expired ? 'Sent ' + day(inv.sentAt) + ' · expired ' + day(inv.expiresAt)
      : inv ? 'Sent ' + day(inv.sentAt) + ' · valid until ' + day(inv.expiresAt)
      : missingRequested ? 'The desk is checking delivery to ' + box + '.'
      : 'No invitation found in ' + box + '.';
    $('zItem').classList.toggle('done', ready);
    $('zNum').innerHTML = ready ? ICONS.check : '1';
    $('zTag').hidden = !ready;
    var mail = $('btnMail');
    mail.hidden = ready || renewal || missingRequested;
    mail.href = (inv && inv.mailboxUrl) || '/mailbox';
    mail.className = 'btn btn-sm ' + (inv ? 'btn-primary' : 'btn-ghost');
    mail.lastChild.textContent = inv ? 'Open the invitation' : 'Open email';
    $('zExpired').hidden = !renewal;
    $('zMissing').hidden = !missingRequested;
    $('zWait').hidden = ready || renewal || missingRequested;
    $('btnZoom').hidden = !ready;
    $('btnZoomCheck').hidden = ready;
    $('zWaitText').textContent = z.selfCheck
      ? 'This step completes on its own once your Zoom account is active. You can close this page; your setup keeps your place.'
      : 'The desk sends it and marks this step once you have joined. You can close this page; your setup keeps your place.';
    if (!ready && z.selfCheck && !state.data.preview && !state.zoomAutoChecked) { state.zoomAutoChecked = true; onZoomCheck(true); }
  }
  async function onZoomCheck(quiet) {
    if (state.data && state.data.preview) return;
    // Фокус и смена видимости приходят парой — один вопрос, не два.
    if (state.zoomChecking) return;
    state.zoomChecking = true;
    var b = $('btnZoomCheck'); b.disabled = true;
    try {
      var z = state.data.zoom || {};
      var d = z.selfCheck ? await api('/api/onboarding/zoom/check', { method: 'POST', body: {} }) : null;
      if (d) {
        state.data.zoom = Object.assign({}, z, { readyAt: d.readyAt || null, invitation: d.readyAt ? null : (d.invitation || null), renewalRequested: !!d.renewalRequested, missingRequested: !!d.missingRequested });
      } else { var all = await api('/api/onboarding'); state.data.zoom = all.zoom; }
      renderZoom();
      if (!(state.data.zoom && state.data.zoom.readyAt) && !quiet && window.showToast) {
        window.showToast(z.selfCheck ? (state.data.zoom.invitation ? 'Not active yet. Open the invitation from Zoom and activate your account.' : 'No Zoom invitation found. The desk is checking delivery.') : 'Not yet. The desk marks it once you have joined.');
      }
    }
    catch (e) { if (!quiet && window.showToast) window.showToast('Could not check. Try again.', true); }
    finally { b.disabled = false; state.zoomChecking = false; }
  }
  // Вернулась на вкладку (из письма Zoom) — проверить ещё раз, без подсказок.
  function recheckZoom() {
    if (!state.data || state.data.preview) return;
    var z = state.data.zoom;
    if (!z || z.readyAt || !z.selfCheck) return;
    onZoomCheck(true);
  }

  // ── Готово ──
  // «Mon – Thu, 10:00 AM – 2:00 PM · Fri, 10:00 AM – 12:00 PM · Eastern»:
  // соседние дни с одинаковым окном сливаются в диапазон.
  function hoursLine() {
    var h = state.data.hours; if (!h) return 'Set by the desk';
    var iv = (h.intervals || []).slice().sort(function (a, b) { return ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.startMinute - b.startMinute; });
    if (!iv.length) return 'Not set yet';
    var groups = [];
    iv.forEach(function (i) {
      var g = groups[groups.length - 1];
      var win = hm(i.startMinute) + ' – ' + hm(i.endMinute);
      if (g && g.win === win && ((g.last + 1) % 7) === i.weekday) { g.last = i.weekday; return; }
      groups.push({ first: i.weekday, last: i.weekday, win: win });
    });
    var zone = '';
    try {
      var part = new Intl.DateTimeFormat('en-US', { timeZone: h.timezone || state.zone, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find(function (x) { return x.type === 'timeZoneName'; });
      if (part) zone = part.value.replace(/ Time$/, '');
    } catch (_) {}
    return groups.map(function (g) {
      var d = DAYS[g.first].slice(0, 3) + (g.last !== g.first ? ' – ' + DAYS[g.last].slice(0, 3) : '');
      return d + ', ' + g.win;
    }).join(' · ') + (zone ? ' · ' + zone : '');
  }
  function renderDone() {
    var p = state.data.profile || {}, a = state.data.agreement || {};
    var rows = [
      ['Account secured', state.passkeys ? 'LinkedIn and Face ID' : 'LinkedIn'],
      ['Details', [p.phone, [p.city, p.state, p.country && p.country !== 'US' ? countryByCode(p.country).name : ''].filter(Boolean).join(', '), p.photoUrl || state.hasPhoto ? 'Photo added' : ''].filter(Boolean).join(' · ')],
      ['Agreement', a.state === 'completed'
        ? 'Signed and countersigned · ' + day(a.completedAt || a.countersignedAt)
        : 'Signed ' + (a.signedAt ? day(a.signedAt) : '') + ' · SVIC LTD countersigns shortly'],
      ['Training', state.data.training && state.data.training.viewedAt
        ? 'How your calls work · watched' + (quiz() && quiz().last ? ' · quick check ' + quiz().last.score + ' of ' + quiz().last.total : '')
        : 'How your calls work · any time from Interviews'],
      ['Hours', hoursLine()],
      ['Zoom', 'Account active · every booking gets its own link, you host'],
    ];
    $('doneList').innerHTML = rows.map(function (r) {
      return '<div class="ob-item"><span class="num">' + ICONS.check + '</span><div class="grow"><div class="t">' + esc(r[0]) + '</div><div class="s">' + esc(r[1]) + '</div></div></div>';
    }).join('');
    var page = state.data.hours && state.data.hours.bookingPage;
    $('doneBook').hidden = !page;
    if (page) { $('doneBookUrl').textContent = location.host + page; $('doneBookBtn').href = page; }
    api('/api/onboarding/complete', { method: 'POST' }).catch(function () {});
  }

  // Первый незаконченный шаг. Обучение — урок просмотрен и проверка отправлена;
  // пройденным оно считается и тогда, когда человек уже двинулся дальше
  // (сохранил часы). Та же логика — stepFromState в src/services/signin-watch.js.
  function firstOpenStep() {
    var p = state.data.profile || {};
    if (!(p.phone && p.state && p.city && p.photoUrl)) return p.phone || state.passkeys ? 2 : 1;
    if (!staffSigned()) return 3;
    if (!trainingDone() && !(state.data.hours && (state.data.hours.intervals || []).length)) return 4;
    if (!hoursSaved()) return 5;
    if (!(state.data.zoom && state.data.zoom.readyAt)) return 6;
    return LAST + 1;
  }
  var NAMED = { account: 1, details: 2, agreement: 3, training: 4, hours: 5, zoom: 6 };

  function showPanel(step) {
    document.querySelectorAll('.ob-panel').forEach(function (p) { p.classList.toggle('on', +p.getAttribute('data-step') === step); });
  }
  async function load() {
    document.querySelectorAll('[data-icon]').forEach(function (el) { el.innerHTML = ICONS[el.getAttribute('data-icon')] || ''; });
    showPanel(0); $('obSteps').innerHTML = '';
    try {
      var r = await Promise.all([api('/api/onboarding'), api('/api/auth/methods').catch(function () { return null; })]);
      state.data = r[0]; state.methods = r[1];
      // Настройка associate (2026-10-20): свой вариант из четырёх шагов на той же странице.
      if (state.data && state.data.variant === 'associate' && window.SVICAssociateSetup) {
        window.SVICAssociateSetup.start(state.data, state.methods, { icons: ICONS, api: api, showPanel: showPanel });
        return;
      }
    } catch (e) {
      $('obErrText').textContent = 'The page did not respond. Try again in a moment.';
      showPanel(-1);
      return;
    }
    renderAccount(); renderDetails(); renderAgreement(); renderTraining(); renderHours(); renderZoom();
    var first = firstOpenStep();
    // Возврат со страницы подписи или ссылка на шаг: ?step=agreement. Дальше
    // первого незаконченного шага не пускаем.
    var named = NAMED[new URLSearchParams(location.search).get('step')];
    // Просмотр глазами (#@alias у админа) открывает любой шаг: он только читает.
    go(named && (named <= first || state.data.preview) ? named : first);
    // Страница подписи сказала «это соглашение подписать нельзя» и вернула
    // сюда с ?renew=1: сразу выпускаем новое и ведём на подпись (один раз —
    // метка снимается с адреса, чтобы перезагрузка не повторяла запрос).
    var q = new URLSearchParams(location.search);
    if (q.get('renew') === '1') {
      q.delete('renew');
      history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash);
      if (first === 3 && !staffSigned() && !state.data.preview && (state.data.agreement || {}).workEmail) onSign(false);
    }
  }

  document.addEventListener('click', function (e) {
    if (state.data && state.data.variant === 'associate') return;
    var n = e.target.closest('[data-next]'); if (n) return go(+n.getAttribute('data-next'));
    var b = e.target.closest('[data-back]'); if (b) return go(+b.getAttribute('data-back'));
    if (e.target.closest('#btnFace')) return onFace();
    if (e.target.closest('#btnPhoto')) return $('photoFile').click();
    if (e.target.closest('#btnCamera')) return $('photoCam').click();
    if (e.target.closest('#btnDetails')) return onDetails();
    if (e.target.closest('#btnSign')) return onSign(false);
    if (e.target.closest('#btnAgNext')) return go(4);
    if (e.target.closest('#btnTrain')) { state.trainingOpened = true; renderTraining(); return; }
    if (e.target.closest('#btnTrainNext')) return go(5);
    if (e.target.closest('#btnQuiz')) return openQuickCheck();
    if (e.target.closest('#btnHours')) return onHours();
    if (e.target.closest('#btnZoomCheck')) return onZoomCheck(false);
    if (e.target.closest('#btnZoom')) return go(LAST + 1);
    if (e.target.closest('#btnRetry')) return load();
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'photoFile' || e.target.id === 'photoCam') return onPhotoFile(e);
    if (e.target.id === 'st') return detailsGate();
    if (e.target.id === 'phc') { $('ph').placeholder = placeholderFor(e.target.value); return detailsGate(); }
    if (e.target.id === 'ctry') { fillRegions(e.target.value, regionValue()); setDial(e.target.value); return detailsGate(); }
    var row = e.target.closest && e.target.closest('.ob-hrow');
    if (row && e.target.type === 'checkbox') row.classList.toggle('off', !e.target.checked);
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'ph' || e.target.id === 'city' || e.target.id === 'stText') detailsGate(); });
  window.addEventListener('focus', function () { if (state.step === 4) refreshTraining(); });
  // Вернулась из письма Zoom — проверить шаг ещё раз, без всплывающих подсказок.
  window.addEventListener('focus', recheckZoom);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { if (state.step === 4) refreshTraining(); recheckZoom(); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
