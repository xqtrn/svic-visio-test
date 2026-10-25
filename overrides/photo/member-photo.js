/* Фото нового участника платформы (Артур 2026-10-25) — общий помощник для
 * страниц, где человек добавляет фото: первый вход (/onboarding), страница
 * фото (/my-photo) и портал партнёра. Проверяет, что это картинка разумного
 * размера, уменьшает её в браузере (на сервер уходит JPEG до 1024 px, а не
 * снимок с телефона на десятки мегабайт) и говорит, есть ли у устройства
 * камера: на телефоне — «Take a photo» (камера) и «Choose a photo», на
 * компьютере — «Upload photo». Сервер проверяет всё ещё раз
 * (src/services/member-photo.js). */
(function () {
  'use strict';
  var MIN_SIDE = 200;
  var MAX_SIDE = 1024;
  var MAX_FILE = 25 * 1024 * 1024;

  function touch() {
    try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (_) { return false; }
  }

  function fail(message) { var e = new Error(message); e.photo = true; return e; }

  // Файл → data URL JPEG. Ошибка — понятная фраза для человека.
  function read(file, minSide) {
    var min = minSide || MIN_SIDE;
    return new Promise(function (resolve, reject) {
      if (!file) return reject(fail('Choose a photo.'));
      if (file.type && !/^image\//.test(file.type)) return reject(fail('This file is not a photo. Choose a JPEG, PNG or WebP image.'));
      if (file.size > MAX_FILE) return reject(fail('This file is too large. Choose a photo under 25 MB.'));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) return reject(fail('This photo could not be read. Choose another one.'));
        if (Math.min(w, h) < min) return reject(fail('This photo is too small. Use one at least ' + min + ' pixels wide and tall.'));
        var k = Math.min(1, MAX_SIDE / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var out = c.toDataURL('image/jpeg', 0.88);
        if (out.length > 3.9 * 1024 * 1024) out = c.toDataURL('image/jpeg', 0.72);
        resolve(out);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(fail('This file is not a photo we can read. Try a JPEG or PNG.')); };
      img.src = url;
    });
  }

  // Подписи кнопок для этого устройства.
  function labels(hasPhoto) {
    if (touch()) return { camera: hasPhoto ? 'Retake photo' : 'Take a photo', pick: hasPhoto ? 'Choose another' : 'Choose a photo', showCamera: true };
    return { camera: '', pick: hasPhoto ? 'Change photo' : 'Upload photo', showCamera: false };
  }

  function initials(name) {
    return String(name || '').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
  }

  window.SVICMemberPhoto = { read: read, touch: touch, labels: labels, initials: initials, MIN_SIDE: MIN_SIDE };
})();
