/* Partner portal (Arthur 2026-10-07; v2 2026-10-09). One application on
   portal.siliconvalleyinvestclub.com: Market · Deals · Companies · Me. What a
   person sees is decided by their access level on the server; this page only
   draws what /api answers. Names of sellers, buyers, brokers and sources never
   reach it. Design system: app.css tokens and components, portal.css layout. */
(function () {
  'use strict';

  // The portal host maps "/" onto the platform's /portal and "/api" onto /api/portal;
  // the platform owner's preview runs on the platform host under /portal.
  var ON_PORTAL_HOST = /^portal\./.test(location.hostname);
  var BASE = ON_PORTAL_HOST ? '' : '/portal';
  var API = ON_PORTAL_HOST ? '/api' : '/api/portal';
  var SITE = 'https://siliconvalleyinvestclub.com';
  var PLATFORM = 'https://platform.siliconvalleyinvestclub.com';

  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.setAttribute('data-theme', 'dark');
  } catch (_) { /* light by default */ }

  var state = { me: null, section: null, page: null, arg: null, watch: new Set(), list: [], sheetIndex: -1 };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var can = function (cap) { return !!(state.me && state.me.caps && state.me.caps[cap]); };

  // ── icons: line SVG from the system set ──────────────────────────────
  var I = function (d) { return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var ICON = {
    search: I('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    star: I('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    back: I('<path d="M15 18l-6-6 6-6"/>'),
    chev: I('<path d="M9 18l6-6-6-6"/>'),
    x: I('<path d="M18 6L6 18M6 6l12 12"/>'),
    check: I('<path d="M20 6L9 17l-5-5"/>'),
    link: I('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    lock: I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  };

  // ── formatting ───────────────────────────────────────────────────────
  function money(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(n >= 1e13 ? 0 : 1).replace(/\.0$/, '') + 'T';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function px(n) { return n == null ? '—' : '$' + (n >= 1000 ? Math.round(n).toLocaleString('en-US') : Number(n).toFixed(2)); }
  function pct(x) {
    if (x == null || !isFinite(x)) return '—';
    var v = Math.round(x * 100);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '%';
  }
  function num(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
  function day(s) {
    if (!s) return '—';
    var d = new Date(String(s).length === 10 ? s + 'T12:00:00Z' : s);
    return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function dayShort(s) {
    if (!s) return '—';
    var d = new Date(String(s).length === 10 ? s + 'T12:00:00Z' : s);
    return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function sizeOf(o) {
    if (o.sizeBand) return o.sizeBand;
    if (o.sizeMin && o.sizeMax) return money(o.sizeMin) + ' – ' + money(o.sizeMax);
    return o.sizeMax ? money(o.sizeMax) : 'Not stated';
  }
  function structText(o) {
    var s = o.structure || 'Not stated';
    if (!o.managementFee && !o.carry && (o.managementFee === 0 || o.carry === 0)) s += ' · no fees';
    else if (o.managementFee != null || o.carry != null) s += ' · ' + (o.managementFee != null ? o.managementFee : '–') + '% / ' + (o.carry != null ? o.carry : '–') + '%';
    if (o.upfrontFee) s += ' · +' + o.upfrontFee + '% upfront';
    return s;
  }
  function sideTag(side) {
    return side === 'bid' ? '<span class="tag ok"><span class="dot"></span>Bid</span>' : '<span class="tag warn"><span class="dot"></span>Offer</span>';
  }
  function tag(kind, text) { return '<span class="tag ' + kind + '"><span class="dot"></span>' + esc(text) + '</span>'; }
  // Relative figures stay muted: a premium is good news for one side and bad for the other.
  function vsTxt(x, label) {
    if (x == null) return '';
    return '<span class="sub">' + pct(x) + ' vs ' + label + '</span>';
  }
  function source(o) { return esc(o.counterparty || 'Not stated'); }
  function logo(company, size) {
    var ini = esc(String(company || '?').trim().charAt(0).toUpperCase());
    return '<span class="p-logo' + (size ? ' ' + size : '') + '"><img src="' + API + '/logo/' + encodeURIComponent(company || '') + '" alt="" loading="lazy" data-ini="' + ini + '"></span>';
  }
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (img && img.tagName === 'IMG' && img.getAttribute('data-ini') != null) {
      var s = document.createElement('span');
      s.className = 'ini';
      s.textContent = img.getAttribute('data-ini');
      img.replaceWith(s);
    }
  }, true);

  // ── plumbing ─────────────────────────────────────────────────────────
  function href(p) { return BASE + p; }
  function go(p, replace) {
    var url = href(p);
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
    render();
  }
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(API + path, init).then(function (r) {
      if (r.status === 401) { location.href = SITE + '/login/investors'; throw new Error('Signed out'); }
      // Новый участник без фото: сервер открывает только шаг фото — перечитать портал.
      if (r.status === 428 && path !== '/me' && path !== '/photo') { location.reload(); throw new Error('Add your photo to continue.'); }
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) { var e = new Error(b.error || 'Something went wrong'); e.body = b; e.status = r.status; throw e; }
        return b;
      });
    });
  }
  function toast(msg, bad) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'show' + (bad ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = ''; }, 3200);
  }
  function modal(title, body, foot, wide) {
    var o = $('#modalOverlay');
    o.innerHTML = '<div class="modal' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="modal-hd"><h2>' + esc(title) + '</h2>' +
      '<button class="modal-x" type="button" aria-label="Close">' + ICON.x + '</button></div>' +
      '<div class="modal-bd">' + body + '</div>' + (foot ? '<div class="modal-ft">' + foot + '</div>' : '') + '</div>';
    o.classList.add('open');
    document.body.classList.add('p-modal-open');
    $('.modal-x', o).onclick = closeModal;
    o.onclick = function (e) { if (e.target === o) closeModal(); };
    return $('.modal', o);
  }
  function closeModal() { var o = $('#modalOverlay'); o.classList.remove('open'); o.innerHTML = ''; document.body.classList.remove('p-modal-open'); }
  function closeSheet(keepUrl) {
    $('#pOverlay').innerHTML = '';
    document.body.style.overflow = '';
    if (!keepUrl) {
      var u = new URL(location.href);
      if (u.searchParams.has('order')) { u.searchParams.delete('order'); history.replaceState(null, '', u.pathname + u.search); }
    }
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if ($('#modalOverlay').classList.contains('open')) return closeModal();
    if ($('#pOverlay').innerHTML) return closeSheet();
    closeMenu();
  });
  function controls(html) { $('#pControls').innerHTML = html; }
  function main(html) { $('#pMain').innerHTML = previewStrip() + html; }
  function loading() { main('<div class="empty"><span class="serif">Loading…</span></div>'); }
  function fail(e) { main('<div class="empty"><span class="serif">This page could not load</span>' + esc(e && e.message) + '</div>'); }
  function empty(title, text) { return '<div class="empty"><span class="serif">' + esc(title) + '</span>' + text + '</div>'; }
  function panel(title, body, opts) {
    opts = opts || {};
    return '<section class="panel-card">' + (title ? '<div class="pc-head"><div><h2>' + title + '</h2>' + (opts.desc ? '<div class="desc">' + opts.desc + '</div>' : '') + '</div>' + (opts.right || '') + '</div>' : '') +
      '<div class="pc-body' + (opts.flush ? ' flush' : '') + '">' + body + '</div></section>';
  }
  function kv(rows) { return '<dl class="kv">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>'; }
  function tableOrCards(table, cards) { return '<div class="p-table">' + table + '</div><div class="p-cards">' + cards + '</div>'; }

  // ── shell ────────────────────────────────────────────────────────────
  function sectionOf(id) { return (state.me.sections || []).filter(function (s) { return s.id === id; })[0]; }
  function firstOpen(section) {
    var s = sectionOf(section);
    var p = s && s.pages.filter(function (x) { return x.open; })[0];
    return p ? (p.id === s.id ? '/' + s.id : '/' + s.id + '/' + p.id) : '/' + section;
  }
  function pagePath(section, page) { return page === section ? '/' + section : '/' + section + '/' + page; }
  function parseRoute() {
    var rel = location.pathname.slice(BASE.length).replace(/\/+$/, '');
    var parts = rel.split('/').filter(Boolean);
    var section = parts[0] || 'market';
    var page = parts[1] || null;
    var arg = null;
    if (section === 'companies' && page && !['watchlist'].includes(page)) { arg = page; page = 'company'; }
    if (section === 'deals' && page === 'threads' && parts[2]) arg = parts[2];
    if (!page) page = section === 'me' ? 'notifications' : section === 'deals' ? 'threads' : section;
    state.section = section; state.page = page; state.arg = arg;
  }
  function renderShell() {
    var me = state.me;
    $('#pHome').setAttribute('href', href(firstOpen('market')));
    $('#pOut').setAttribute('href', BASE + '/logout');
    $('#pNav').innerHTML = me.sections.map(function (s) {
      var on = s.id === state.section;
      return '<a class="tb-nav-link' + (on ? ' active' : '') + '" href="' + href(firstOpen(s.id)) + '" data-nav="' + firstOpen(s.id) + '"' + (on ? ' aria-current="page"' : '') + '>' + esc(s.label) + '</a>';
    }).join('');
    var sec = sectionOf(state.section);
    $('#pCtx').textContent = sec ? sec.label : '';
    $('#pName').textContent = me.name || '';
    document.title = (sec ? sec.label + ' — ' : '') + 'Silicon Valley Investclub';
  }
  function subTabs() {
    var sec = sectionOf(state.section);
    if (!sec) return '';
    var pages = sec.pages.filter(function (p) { return p.open; });
    if (pages.length < 2) return '';
    var current = state.page === 'company' ? 'companies' : state.page;
    return '<nav class="tabs p-sub" role="tablist">' + pages.map(function (p) {
      var on = p.id === current;
      return '<a class="tab' + (on ? ' active' : '') + '" role="tab" href="' + href(pagePath(sec.id, p.id)) + '" data-nav="' + pagePath(sec.id, p.id) + '"' + (on ? ' aria-selected="true"' : '') + '>' + esc(p.label) + '</a>';
    }).join('') + '</nav>';
  }
  function previewStrip() {
    var me = state.me;
    if (!me || !me.preview) return '';
    return '<div class="p-preview">' + tag('neutral', 'Preview') + '<span>You see the portal exactly as a partner with the <b>' + esc(me.levelLabel) + '</b> level. Nothing you submit is saved or sent.</span><span class="spacer"></span>' +
      me.levels.map(function (l) { return '<a class="' + (l.id === me.level ? 'on' : '') + '" href="' + PLATFORM + '/portal/preview/' + l.id + '">' + esc(l.label) + '</a>'; }).join(' · ') + '</div>';
  }
  // Phone menu: the design-system offcanvas anatomy (navy header with the 2px accent line, close 32, footer with the person).
  function openMenu() {
    var me = state.me;
    var el = document.createElement('div');
    el.className = 'p-offc';
    el.id = 'pMenu';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Menu');
    el.innerHTML = '<div class="pane"><div class="oc-hdr"><img src="/portal/assets/logo.svg" alt="Silicon Valley Investclub"><button class="oc-close" type="button" aria-label="Close">' + ICON.x + '</button></div><div>' +
      me.sections.map(function (s) {
        return '<div class="g">' + esc(s.label) + '</div>' + s.pages.filter(function (p) { return p.open; }).map(function (p) {
          var on = s.id === state.section && (p.id === state.page || (state.page === 'company' && p.id === 'companies'));
          return '<a class="it' + (on ? ' on' : '') + '" href="' + href(pagePath(s.id, p.id)) + '" data-nav="' + pagePath(s.id, p.id) + '">' + esc(p.label) + '</a>';
        }).join('');
      }).join('') + '</div><div class="foot"><div><b>' + esc(me.name) + '</b>' + esc([me.firm, me.roleLabel, me.levelLabel].filter(Boolean).join(' · ')) + '</div><a href="' + BASE + '/logout">Sign out</a></div></div><div class="scrim"></div>';
    document.body.appendChild(el);
    $('#pBurger').setAttribute('aria-expanded', 'true');
    $('.oc-close', el).onclick = closeMenu;
    $('.scrim', el).onclick = closeMenu;
  }
  function closeMenu() {
    var m = $('#pMenu');
    if (m) m.remove();
    $('#pBurger').setAttribute('aria-expanded', 'false');
  }
  $('#pBurger').onclick = function () { if ($('#pMenu')) closeMenu(); else openMenu(); };

  document.addEventListener('click', function (e) {
    var w = e.target.closest('[data-watch]');
    if (w) {
      e.preventDefault();
      e.stopPropagation();
      toggleWatch(w.getAttribute('data-watch'), w.getAttribute('data-key'));
      return;
    }
    if (e.target.closest('[data-rowmenu], .menu-list, [data-matches]')) return;
    var a = e.target.closest('[data-nav]');
    if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      closeMenu();
      closeModal();
      closeSheet(true);
      go(a.getAttribute('data-nav'));
      return;
    }
    var row = e.target.closest('[data-order]');
    if (row) { e.preventDefault(); openOrder(row.getAttribute('data-order')); return; }
    var link = e.target.closest('[data-href]');
    if (link) { e.preventDefault(); go(link.getAttribute('data-href')); }
  });
  window.addEventListener('popstate', render);

  function toggleWatch(company, key) {
    if (!can('watchlist')) return;
    var on = !state.watch.has(key);
    api('/watchlist', { method: 'PUT', body: { company: company, on: on } }).then(function (b) {
      if (b.preview) return toast('Preview: the watchlist was not changed');
      state.watch = new Set((b.watchlist || []).map(function (x) { return x.company_key; }));
      $$('[data-watch][data-key="' + String(key).replace(/"/g, '') + '"]').forEach(function (el) {
        el.classList.toggle('on', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (el.classList.contains('btn')) el.innerHTML = ICON.star + (on ? 'In your watchlist' : 'Watch');
      });
      toast(on ? 'Added to your watchlist' : 'Removed from your watchlist');
    }).catch(function (err) { toast(err.message, true); });
  }
  function watchBtn(company, key, asButton) {
    if (!can('watchlist')) return '';
    var on = state.watch.has(key);
    if (asButton) return '<button class="btn btn-ghost btn-sm' + (on ? ' on' : '') + '" type="button" data-watch="' + esc(company) + '" data-key="' + esc(key) + '" aria-pressed="' + on + '">' + ICON.star + (on ? 'In your watchlist' : 'Watch') + '</button>';
    return '<button class="iconbtn' + (on ? ' on' : '') + '" type="button" data-watch="' + esc(company) + '" data-key="' + esc(key) + '" aria-pressed="' + on + '" aria-label="Watch ' + esc(company) + '">' + ICON.star + '</button>';
  }

  // ── level lock: a page the level does not open says so and what is open ──
  function lockedView() {
    var me = state.me;
    var sec = sectionOf(state.section);
    controls('<span class="ctitle">' + esc(sec ? sec.label : '') + '</span>');
    var open = [];
    me.sections.forEach(function (s) { s.pages.forEach(function (p) { if (p.open && s.id !== 'me') open.push('<a class="cell-link" href="' + href(pagePath(s.id, p.id)) + '" data-nav="' + pagePath(s.id, p.id) + '">' + esc(p.label) + '</a>'); }); });
    main(subTabs() + '<div class="p-grid two"><div>' +
      empty('Not in your access level', 'Your level, <b>' + esc(me.levelLabel) + '</b>, does not include this page. ' + (open.length ? 'Open to you: ' + open.join(' · ') + '.' : '') + '<br><br>Your level is set by Silicon Valley Investclub. To change it, write to us from <a class="cell-link" href="' + href('/me/access') + '" data-nav="/me/access">Access &amp; role</a>.') +
      '</div><div>' + panel('Access levels', levelsGrid(true)) + '</div></div>');
  }
  function levelsGrid(single) {
    var me = state.me;
    return '<div class="p-level"' + (single ? ' style="grid-template-columns:1fr"' : '') + '>' + me.levels.map(function (l) {
      return '<div class="' + (l.id === me.level ? 'on' : '') + '"><b>' + esc(l.label) + '</b>' + esc(l.summary) + '</div>';
    }).join('') + '</div>';
  }
  function pageOpen(section, page) {
    var s = sectionOf(section);
    if (!s) return false;
    if (page === 'company') page = 'companies';
    var p = s.pages.filter(function (x) { return x.id === page; })[0];
    return !!(p && p.open);
  }

  // ── Market: live market ──────────────────────────────────────────────
  var mk = { q: '', side: '', structure: '', checked: false, direct: false, watch: false, sort: 'updated', page: 1 };
  function marketQuery() {
    var q = new URLSearchParams();
    if (mk.q) q.set('q', mk.q);
    if (mk.side) q.set('side', mk.side);
    if (mk.structure) q.set('structure', mk.structure);
    if (mk.checked) q.set('checked', '1');
    if (mk.direct) q.set('direct', '1');
    if (mk.watch) q.set('watch', '1');
    q.set('sort', mk.sort);
    q.set('page', String(mk.page));
    return q.toString();
  }
  function viewMarket() {
    controls('<span class="ctitle">Market</span><span class="ccount hide-m" id="mCount"></span>' +
      '<div class="search">' + ICON.search + '<input type="search" id="mQ" placeholder="Search companies" value="' + esc(mk.q) + '" aria-label="Search companies"></div>' +
      '<div class="seg" id="mSide">' + [['', 'All'], ['offer', 'Offers'], ['bid', 'Bids']].map(function (x) { return '<button type="button" data-v="' + x[0] + '" class="' + (mk.side === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<select id="mStruct" class="hide-m" aria-label="Structure"><option value="">Any structure</option><option>Direct trade</option><option value="SPV">SPV</option><option>Forward</option></select>' +
      (can('watchlist') ? '<button class="btn btn-ghost btn-sm hide-m' + (mk.watch ? ' on' : '') + '" type="button" id="mWatch">' + ICON.star + 'Watchlist</button>' : '') +
      (can('deskCheck') ? '<button class="btn btn-ghost btn-sm' + (mk.checked ? ' on' : '') + '" type="button" id="mChecked">' + ICON.check + 'Checked by the desk</button>' : '') +
      (can('route') ? '<button class="btn btn-ghost btn-sm hide-m' + (mk.direct ? ' on' : '') + '" type="button" id="mDirect">Direct only</button>' : '') +
      '<select id="mSort" class="hide-m" aria-label="Sort"><option value="updated">Newest first</option><option value="size">Largest first</option><option value="price">Highest price</option><option value="company">Company A–Z</option></select>' +
      '<button class="btn btn-ghost btn-sm show-m" type="button" id="mFilters">Filters' + (mk.structure || mk.watch || mk.direct || mk.sort !== 'updated' ? ' · on' : '') + '</button>' +
      '<span class="spacer"></span>' + (can('ownOrders') ? '<button class="btn btn-primary btn-sm" type="button" id="mNew">' + ICON.plus + 'New order</button>' : ''));
    $('#mStruct').value = mk.structure;
    $('#mSort').value = mk.sort;
    var t;
    $('#mQ').oninput = function () { clearTimeout(t); var v = this.value; t = setTimeout(function () { mk.q = v; mk.page = 1; loadMarket(); }, 250); };
    $('#mSide').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; mk.side = b.getAttribute('data-v'); mk.page = 1; $$('#mSide button').forEach(function (x) { x.classList.toggle('on', x === b); }); loadMarket(); };
    $('#mStruct').onchange = function () { mk.structure = this.value; mk.page = 1; loadMarket(); };
    $('#mSort').onchange = function () { mk.sort = this.value; mk.page = 1; loadMarket(); };
    [['#mWatch', 'watch'], ['#mChecked', 'checked'], ['#mDirect', 'direct']].forEach(function (x) {
      var b = $(x[0]);
      if (b) b.onclick = function () { mk[x[1]] = !mk[x[1]]; b.classList.toggle('on', mk[x[1]]); mk.page = 1; loadMarket(); };
    });
    var nb = $('#mNew'); if (nb) nb.onclick = function () { wizard(null); };
    // Phone: the same filters in one sheet (Codex F4 — structure, sort, watchlist and direct only had no way in).
    $('#mFilters').onclick = function () {
      var m = modal('Filters',
        '<div class="field"><label for="fStruct">Structure</label><select id="fStruct"><option value="">Any structure</option><option>Direct trade</option><option value="SPV">SPV</option><option>Forward</option></select></div>' +
        '<div class="field"><label for="fSort">Sort</label><select id="fSort"><option value="updated">Newest first</option><option value="size">Largest first</option><option value="price">Highest price</option><option value="company">Company A–Z</option></select></div>' +
        (can('watchlist') ? '<label class="p-check"><input type="checkbox" id="fWatch"' + (mk.watch ? ' checked' : '') + '><span>Only companies on my watchlist</span></label>' : '') +
        (can('route') ? '<label class="p-check"><input type="checkbox" id="fDirect"' + (mk.direct ? ' checked' : '') + '><span>Direct only</span></label>' : ''),
        '<button class="btn btn-ghost" type="button" id="fReset">Reset</button><button class="btn btn-primary" type="button" id="fApply">Show orders</button>');
      $('#fStruct', m).value = mk.structure;
      $('#fSort', m).value = mk.sort;
      $('#fReset', m).onclick = function () { mk.structure = ''; mk.sort = 'updated'; mk.watch = false; mk.direct = false; mk.page = 1; closeModal(); viewMarket(); };
      $('#fApply', m).onclick = function () {
        mk.structure = $('#fStruct', m).value; mk.sort = $('#fSort', m).value;
        var w = $('#fWatch', m); if (w) mk.watch = w.checked;
        var dr = $('#fDirect', m); if (dr) mk.direct = dr.checked;
        mk.page = 1; closeModal(); viewMarket();
      };
    };
    main(subTabs() + '<div id="mBody"><div class="empty"><span class="serif">Loading…</span></div></div>');
    loadMarket();
  }
  var MARKET_COLS = function () {
    return [
      { l: 'Company', co: true, v: function (o) { return '<span class="co-in">' + logo(o.company) + '<span>' + esc(o.company) + '<span class="sub">' + esc(o.industry || '') + '</span></span></span>'; } },
      { l: 'Side', v: function (o) { return sideTag(o.side); } },
      { l: 'Price', num: true, v: function (o) { return o.price ? '<span class="cell-strong">' + px(o.price) + '</span>' + vsTxt(o.vsEstimate, 'estimate') : '<span class="muted">Unpriced</span>'; } },
      { l: 'Size', num: true, v: function (o) { return esc(sizeOf(o)); } },
      { l: 'Structure', v: function (o) { return esc(structText(o)); } },
      { l: 'Source type', v: function (o) { return source(o) + (o.route ? '<span class="sub">' + esc(o.route) + '</span>' : ''); } },
    ].concat(can('deskCheck') ? [{ l: 'Desk', v: function (o) { return o.deskChecked ? tag('active', 'Checked') : '<span class="muted">—</span>'; } }] : [])
      .concat([{ l: 'Updated', v: function (o) { return '<span class="muted">' + dayShort(o.updated) + '</span>'; } }]);
  };
  function orderTable(list) {
    var cols = MARKET_COLS();
    return '<table class="data"><thead><tr>' + cols.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + '>' + c.l + '</th>'; }).join('') + '</tr></thead><tbody>' +
      list.map(function (o) { return '<tr data-order="' + esc(o.id) + '">' + cols.map(function (c) { return '<td' + (c.num ? ' class="num"' : '') + (c.co ? ' class="co"' : '') + '>' + c.v(o) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table>';
  }
  function orderCard(o) {
    return '<a class="p-mcard" data-order="' + esc(o.id) + '" href="#"><div class="a">' + logo(o.company, 'md') + '<b>' + esc(o.company) + '</b>' + sideTag(o.side) + '</div>' +
      '<div class="b"><span>' + esc(structText(o)) + ' · ' + source(o) + '</span><strong>' + (o.price ? px(o.price) : 'Unpriced') + '</strong></div>' +
      '<div class="c"><span>' + esc(sizeOf(o)) + '</span>' + (o.vsEstimate != null ? '<span>' + pct(o.vsEstimate) + ' vs estimate</span>' : '') +
      (o.deskChecked ? tag('active', 'Checked') : '') + '<span class="w">' + dayShort(o.updated) + '</span></div></a>';
  }
  function loadMarket() {
    var body = $('#mBody');
    api('/book?' + marketQuery()).then(function (b) {
      state.list = b.orders;
      var c = $('#mCount');
      var filtered = mk.q || mk.side || mk.structure || mk.watch || mk.checked || mk.direct;
      if (c) c.textContent = filtered ? num(b.total) + ' of ' + num(b.counts.orders) + ' live orders' : num(b.counts.orders) + ' live orders · ' + num(b.counts.companies) + ' companies';
      var emptyHtml = mk.watch && !state.watch.size
        ? empty('Your watchlist is empty', 'Star a company on its page or on an order, and its orders gather here.')
        : mk.watch ? empty('No live orders on your watchlist', 'New orders on the companies you follow appear here and in your notifications.')
          : empty('No orders match', 'Change the filters or search for another company.');
      body.innerHTML = (b.orders.length
        ? tableOrCards(orderTable(b.orders), b.orders.map(orderCard).join(''))
        : emptyHtml) +
        '<div class="p-pager"><span>' + num(b.total) + ' orders</span>' +
        (b.pages > 1 ? '<button class="btn btn-ghost btn-sm" type="button" id="mPrev"' + (b.page <= 1 ? ' disabled' : '') + '>' + ICON.back + 'Previous</button><span>Page ' + b.page + ' of ' + b.pages + '</span><button class="btn btn-ghost btn-sm" type="button" id="mNext"' + (b.page >= b.pages ? ' disabled' : '') + '>Next' + ICON.chev + '</button>' : '') + '</div>' +
        '<p class="p-note">Our book, newest first. The source is shown by type; names open only at an introduction both sides agree to.' + (can('exactSizes') ? '' : ' Sizes are shown in bands at your level.') + '</p>';
      var p = $('#mPrev'); if (p) p.onclick = function () { mk.page -= 1; loadMarket(); window.scrollTo(0, 0); };
      var n = $('#mNext'); if (n) n.onclick = function () { mk.page += 1; loadMarket(); window.scrollTo(0, 0); };
      var focus = new URLSearchParams(location.search).get('order');
      if (focus && !$('#pOverlay').innerHTML) openOrder(focus);
    }).catch(function (e) { body.innerHTML = empty('The market could not load', esc(e.message)); });
  }

  // ── The order: the design-system Record sheet under the top bar (R-16) ──
  function openOrder(id) {
    if (!can('book')) return;
    api('/order/' + encodeURIComponent(id)).then(function (b) {
      var u = new URL(location.href);
      u.searchParams.set('order', id);
      history.replaceState(null, '', u.pathname + u.search);
      state.sheetIndex = state.list.map(function (x) { return x.id; }).indexOf(id);
      drawSheet(b);
    }).catch(function (e) { toast(e.message, true); closeSheet(); });
  }
  function rangeBar(est, price, side) {
    if (!est || !est.low || !est.high) return '';
    var lo = Math.min(est.low, price || est.estimate, est.estimate) * 0.92;
    var hi = Math.max(est.high, price || est.estimate, est.estimate) * 1.08;
    var at = function (v) { return (((v - lo) / (hi - lo)) * 100).toFixed(1); };
    return '<div class="p-range" role="img" aria-label="Price against our estimate"><i style="left:' + at(est.low) + '%;right:' + (100 - at(est.high)).toFixed(1) + '%"></i>' +
      '<em class="m" style="left:' + at(est.estimate) + '%">' + px(est.estimate) + ' estimate</em>' +
      (price ? '<em class="s" style="left:' + at(price) + '%">' + px(price) + ' this ' + side + '</em>' : '') + '</div>';
  }
  function drawSheet(b) {
    var o = b.order;
    var e = b.estimate;
    var total = state.list.length;
    var idx = state.sheetIndex;
    var sec = function (title, body) { return '<div class="sheet-section"><div class="sheet-section-title">' + title + '</div>' + body + '</div>'; };
    var deal = b.deal && ['requested', 'approved', 'accepted', 'introduced', 'agreed'].indexOf(b.deal.stage.status) >= 0 ? b.deal : null;
    var connectBtn = can('connect')
      ? (deal ? '<button class="btn btn-ghost btn-sm" type="button" data-nav="/deals/threads/' + esc(deal.id) + '">Open thread</button>' : '<button class="btn btn-primary btn-sm" type="button" id="sConnect">' + ICON.link + 'Connect</button>')
      : '';
    var askBtn = '<button class="btn btn-ghost btn-sm" type="button" id="sAsk">Ask a question</button>';
    var html = '<div class="sheet-overlay" id="sOverlay"><div class="sheet" role="dialog" aria-label="Order ' + esc(o.company) + '">' +
      '<div class="sheet-hd"><div class="lead">' + logo(o.company, 'md') + '<div><div class="sheet-title">' + esc(o.company) + '</div>' +
      '<div class="sheet-meta"><span>' + (o.side === 'bid' ? 'Bid' : 'Offer') + (o.industry ? ' · ' + esc(o.industry) : '') + '</span><span>#' + esc(o.id.slice(1, 9)) + '</span>' +
      (can('companies') ? '<a class="cell-link" href="' + href('/companies/' + o.companyKey) + '" data-nav="/companies/' + esc(o.companyKey) + '">Company page</a>' : '') + '</div>' +
      '<div class="tags">' + sideTag(o.side) + (o.deskChecked ? tag('active', 'Checked by the desk') : '') + (o.outlier ? tag('pending', 'Far from the market') : '') + tag('neutral', 'Updated ' + dayShort(o.updated)) + '</div></div></div>' +
      '<div class="sheet-actions"><span class="sheet-nav"><button class="iconbtn sheet-nav-btn" type="button" id="sPrev" aria-label="Previous order"' + (idx <= 0 ? ' disabled' : '') + '>' + ICON.back + '</button>' +
      (idx >= 0 ? '<span class="sheet-nav-count">' + (idx + 1) + ' of ' + total + '</span>' : '') +
      '<button class="iconbtn sheet-nav-btn" type="button" id="sNext" aria-label="Next order"' + (idx < 0 || idx >= total - 1 ? ' disabled' : '') + '>' + ICON.chev + '</button></span>' +
      '<button class="iconbtn" type="button" id="sCopy" aria-label="Copy link">' + ICON.link + '</button>' + watchBtn(o.company, o.companyKey) + askBtn + connectBtn +
      '<button class="sheet-close" type="button" id="sClose" aria-label="Close">×</button></div></div>' +
      '<div class="sheet-statband">' +
      '<div class="sheet-stat"><span class="k">Price per share</span><span class="v' + (o.price ? '' : ' is-empty') + '">' + (o.price ? px(o.price) : 'Unpriced') + '</span></div>' +
      '<div class="sheet-stat"><span class="k">Size</span><span class="v">' + esc(sizeOf(o)) + '</span></div>' +
      '<div class="sheet-stat"><span class="k">Structure</span><span class="v">' + esc(o.structure || 'Not stated') + '</span></div>' +
      '<div class="sheet-stat"><span class="k">Share class</span><span class="v">' + esc(o.shareClass || 'Any') + '</span></div>' +
      (o.valuation ? '<div class="sheet-stat"><span class="k">Valuation</span><span class="v">' + money(o.valuation) + (o.valuationEstimated ? ' <span class="calc">implied</span>' : '') + '</span></div>' : '') +
      '</div><div class="sheet-bd"><div class="sheet-cols"><div class="sheet-col-main">' +
      (e ? sec('Price against our estimate', rangeBar(e, o.price, o.side === 'bid' ? 'bid' : 'offer') +
        '<p class="p-note" style="margin:0">' + esc(e.confidence) + ' confidence · ' + num(e.observed) + ' orders behind the estimate' + (e.low ? ' · the band is the middle half of priced orders in the last 30 days' : '') +
        (can('companies') ? ' · <a class="cell-link" href="' + href('/companies/' + o.companyKey) + '" data-nav="/companies/' + esc(o.companyKey) + '">how it is built</a>' : '') + '</p>') : '') +
      sec('Terms', kv([
        ['Price', o.price ? px(o.price) + ' ' + (o.priceBasis === 'net' ? 'net' : 'gross') + (o.netPrice ? ' · ' + px(o.netPrice) + ' net' : '') : 'Unpriced · agreed through our desk'],
        ['Price status', esc(o.priceStatus || 'Not stated')],
        ['Structure', esc(structText(o)) + (o.layers ? (o.layers > 1 ? ' · multi-layer' : ' · single layer') : '')],
        ['Share class', esc(o.shareClass || 'Any') + ' · ' + esc(o.typeOfShares || 'Secondary')],
        ['Jurisdiction', esc(o.jurisdiction || 'Not stated')],
        ['Closing', esc(o.closingTimeline || 'Discussed at the introduction')],
        ['Last round', o.lastRound ? [o.lastRound.price ? px(o.lastRound.price) + ' per share' : '', o.lastRound.valuation ? money(o.lastRound.valuation) + ' valuation' : '', o.lastRound.type ? esc(o.lastRound.type) : '',
          o.vsLastRound != null ? 'this ' + (o.side === 'bid' ? 'bid' : 'offer') + ' ' + pct(o.vsLastRound) : ''].filter(Boolean).join(' · ') : 'Not on record'],
      ])) +
      sec('Counterparty', kv([
        ['Source type', source(o)],
        o.route ? ['Route to us', esc(o.route)] : null,
        ['Identity', 'Named only at the introduction both sides agree to'],
        can('deskCheck') ? ['Desk check', o.deskChecked ? 'Terms confirmed with this side' : 'Not yet checked'] : null,
      ].filter(Boolean))) +
      (can('connect') ? sec('Connect', '<p class="p-note" style="margin:0 0 12px">Our manager reviews every introduction by hand. Once approved, the other side sees your type, not your name. If they accept and you both sign the NCNDA, you see each other and talk directly in your thread.</p>' +
        (deal ? stageTag(deal.stage) + ' <a class="cell-link" href="' + href('/deals/threads/' + deal.id) + '" data-nav="/deals/threads/' + esc(deal.id) + '">Open thread</a>' : '<button class="btn btn-primary btn-sm" type="button" id="sConnect2">' + ICON.link + 'Connect</button>')) : '') +
      '</div><div class="sheet-col-side">' +
      sec('History of this order', b.timeline.length ? '<div class="timeline">' + b.timeline.map(function (t) { return '<div class="tl"><div class="when">' + day(t.day) + '</div><div class="what">' + esc(t.event) + '</div></div>'; }).join('') + '</div>' : '<p class="p-note">No changes since it was received.</p>') +
      sec('Other live ' + esc(o.company) + ' orders', b.others.length ? b.others.map(function (x) {
        return '<div class="p-row" data-order="' + esc(x.id) + '" style="cursor:pointer">' + sideTag(x.side) + '<div class="g">' + (x.price ? px(x.price) : 'Unpriced') + ' · ' + esc(sizeOf(x)) + '<small>' + esc(structText(x)) + ' · ' + source(x) + '</small></div><span class="w">' + dayShort(x.updated) + '</span></div>';
      }).join('') : '<p class="p-note">This is the only live order on this company.</p>') +
      '</div></div></div></div></div>' +
      '<div class="p-actbar">' + askBtn.replace('id="sAsk"', 'id="sAsk2"') + (connectBtn ? connectBtn.replace('id="sConnect"', 'id="sConnect3"') : '') + '</div>';
    $('#pOverlay').innerHTML = html;
    document.body.style.overflow = 'hidden';
    $('#sOverlay').onclick = function (ev) { if (ev.target.id === 'sOverlay') closeSheet(); };
    $('#sClose').onclick = function () { closeSheet(); };
    $('#sCopy').onclick = function () {
      var link = location.origin + location.pathname + '?order=' + encodeURIComponent(o.id);
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { toast('Link copied'); }).catch(function () { toast(link); });
    };
    var step = function (d) { var i = state.sheetIndex + d; if (i >= 0 && i < state.list.length) openOrder(state.list[i].id); };
    $('#sPrev').onclick = function () { step(-1); };
    $('#sNext').onclick = function () { step(1); };
    ['#sConnect', '#sConnect2', '#sConnect3'].forEach(function (s) { var x = $(s); if (x) x.onclick = function () { connectDialog(o); }; });
    ['#sAsk', '#sAsk2'].forEach(function (s) { var x = $(s); if (x) x.onclick = function () { askDialog(o); }; });
  }
  function connectDialog(o) {
    var m = modal('Connect on this ' + (o.side === 'bid' ? 'bid' : 'offer'),
      '<p style="margin:0 0 12px">Our manager reviews every introduction by hand. Once approved, the other side sees your <b>type</b>, not your name. If they accept and you both sign the NCNDA in the thread, you see each other and talk directly.</p>' +
      '<div class="field"><label for="cMsg">Message to the other side (optional)</label><textarea id="cMsg" rows="3" maxlength="2000" placeholder="For example: interested in the full block, can close within three weeks."></textarea></div>' +
      '<label class="p-check"><input type="checkbox" id="cAssoc" checked><span>Ask my associate to join the thread and set up a call</span></label>',
      '<button class="btn btn-ghost" type="button" id="cCancel">Cancel</button><button class="btn btn-primary" type="button" id="cSend">Send request</button>');
    $('#cCancel', m).onclick = closeModal;
    $('#cSend', m).onclick = function () {
      this.disabled = true;
      api('/deals', { method: 'POST', body: { order: o.id, message: $('#cMsg', m).value, associate: $('#cAssoc', m).checked } }).then(function (r) {
        if (r.preview) { closeModal(); return toast('Preview: nothing was sent'); }
        $('.modal-bd', m).innerHTML = '<div class="p-ok">' + (r.existing ? 'You already have a thread on this order.' : 'Request sent · our manager is reviewing it, usually within one business day. Meanwhile you can sign the NCNDA in the thread.') + '</div>';
        $('.modal-ft', m).innerHTML = '<button class="btn btn-primary" type="button" id="cOpen">Open the thread</button>';
        $('#cOpen', m).onclick = function () { closeModal(); closeSheet(true); go('/deals/threads/' + r.id); };
      }).catch(function (e) { toast(e.message, true); $('#cSend', m).disabled = false; });
    };
  }
  function askDialog(o) {
    var m = modal(o ? 'Ask about this ' + (o.side === 'bid' ? 'bid' : 'offer') : 'Write to us',
      '<div class="field"><label for="aMsg">Your question</label><textarea id="aMsg" rows="4" maxlength="2000" placeholder="' + (o ? 'For example: is the price firm for a larger size?' : 'Ask anything — access, an order, a company.') + '"></textarea></div>' +
      '<p class="p-note">Our desk answers here in your threads; we usually answer within one business day.</p>',
      '<button class="btn btn-ghost" type="button" id="aCancel">Cancel</button><button class="btn btn-primary" type="button" id="aSend">Send</button>');
    $('#aCancel', m).onclick = closeModal;
    $('#aSend', m).onclick = function () {
      var text = $('#aMsg', m).value.trim();
      if (!text) return toast('Write your question first', true);
      this.disabled = true;
      api('/requests', { method: 'POST', body: o ? { kind: 'inquire', order: o.id, message: text } : { kind: 'question', message: text } }).then(function (r) {
        closeModal();
        toast(r.preview ? 'Preview: nothing was sent' : 'Sent to our desk');
      }).catch(function (e) { toast(e.message, true); $('#aSend', m).disabled = false; });
    };
  }

  // ── Market: search ──────────────────────────────────────────────────
  function viewSearch() {
    var q0 = new URLSearchParams(location.search).get('q') || '';
    controls('<span class="ctitle">Search</span>');
    main(subTabs() + '<div class="search" style="max-width:640px;margin-bottom:20px">' + ICON.search + '<input type="search" id="sQ" placeholder="Company name" value="' + esc(q0) + '" aria-label="Search" autofocus></div><div id="sBody"></div>');
    var t;
    var run = function (v) {
      var u = new URL(location.href);
      if (v) u.searchParams.set('q', v); else u.searchParams.delete('q');
      history.replaceState(null, '', u.pathname + u.search);
      if (v.trim().length < 2) { $('#sBody').innerHTML = '<p class="p-note">Type at least two letters of a company name.</p>'; return; }
      api('/search?q=' + encodeURIComponent(v)).then(function (b) {
        state.list = b.orders;
        $('#sBody').innerHTML = '<div class="p-grid two"><div>' +
          panel('Companies', b.companies.length ? b.companies.map(companyLine).join('') : '<p class="p-note">No company with this name in our book.</p>') +
          (can('book') ? panel('Live orders', b.orders.length ? b.orders.map(function (o) {
            return '<div class="p-row" data-order="' + esc(o.id) + '" style="cursor:pointer">' + sideTag(o.side) + '<div class="g">' + esc(o.company) + ' · ' + (o.price ? px(o.price) : 'Unpriced') + '<small>' + esc(sizeOf(o)) + ' · ' + esc(structText(o)) + ' · ' + source(o) + '</small></div><span class="w">' + dayShort(o.updated) + '</span></div>';
          }).join('') : '<p class="p-note">No live orders on these companies.</p>') : '') +
          '</div><div></div></div>';
      }).catch(function (e) { $('#sBody').innerHTML = empty('Search failed', esc(e.message)); });
    };
    $('#sQ').oninput = function () { clearTimeout(t); var v = this.value; t = setTimeout(function () { run(v); }, 250); };
    run(q0);
  }
  function dateText(d) { return !d ? '' : /^\d{4}-\d{2}-\d{2}$/.test(d) ? day(d) : esc(d); }
  function roundText(r) {
    var main = [r.price ? px(r.price) + ' per share' : null, r.valuation ? money(r.valuation) : null].filter(Boolean).join(' · ') || 'Terms not stated';
    var sub = [r.type ? esc(r.type) : null, dateText(r.date) || null].filter(Boolean).join(' · ');
    return main + (sub ? '<span class="sub">' + sub + '</span>' : '');
  }
  function companyLine(c) {
    var bits = [];
    if (c.offers != null) bits.push(c.offers + ' offers · ' + c.bids + ' bids');
    if (c.estimate) bits.push('estimate ' + px(c.estimate));
    if (c.industry) bits.push(esc(c.industry));
    return '<div class="p-row" data-href="/companies/' + esc(c.key) + '">' + logo(c.company, 'md') + '<div class="g">' + esc(c.company) + '<small>' + bits.join(' · ') + '</small></div><span class="w">' + ICON.chev + '</span></div>';
  }

  // ── Companies ───────────────────────────────────────────────────────
  var co = { q: '' };
  function viewCompanies(watchOnly) {
    controls('<span class="ctitle">' + (watchOnly ? 'Watchlist' : 'Companies') + '</span><span class="ccount hide-m" id="cCount"></span>' +
      '<div class="search">' + ICON.search + '<input type="search" id="cQ" placeholder="Search companies" value="' + esc(co.q) + '" aria-label="Search companies"></div><span class="spacer"></span>');
    main(subTabs() + '<div id="cBody"><div class="empty"><span class="serif">Loading…</span></div></div>');
    var t;
    $('#cQ').oninput = function () { clearTimeout(t); var v = this.value; t = setTimeout(function () { co.q = v; co.page = 1; loadCompanies(watchOnly); }, 250); };
    co.page = 1;
    loadCompanies(watchOnly);
  }
  function loadCompanies(watchOnly) {
    var q = new URLSearchParams();
    if (co.q) q.set('q', co.q);
    if (watchOnly) q.set('watch', '1');
    api('/companies?' + q.toString()).then(function (b) {
      var c = $('#cCount'); if (c) c.textContent = num(b.total) + ' companies';
      // 50 a page (Grok, 2026-10-09: 434 rows in one list, an endless feed on a phone).
      var PER = 50;
      var pages = Math.max(1, Math.ceil(b.companies.length / PER));
      co.page = Math.min(Math.max(1, co.page || 1), pages);
      var list = b.companies.slice((co.page - 1) * PER, co.page * PER);
      if (!list.length) {
        $('#cBody').innerHTML = watchOnly
          ? empty('Your watchlist is empty', 'Follow a company with the star on its page or on any order. ' + (can('alerts') ? 'New orders on the companies you follow arrive in Notifications.' : ''))
          : empty('No company matches', 'Try another name.');
        return;
      }
      var showMarket = list[0].offers != null;
      var table = '<table class="data"><thead><tr><th>Company</th>' + (can('estimate') ? '<th class="num">Our estimate</th>' : '') + '<th>Last round</th>' + (can('estimate') ? '<th class="num">Estimate vs round</th>' : '') + (showMarket ? '<th class="num">Offers</th><th class="num">Bids</th>' : '') + (can('exactSizes') ? '<th class="num">Volume</th>' : '') + '<th></th></tr></thead><tbody>' +
        list.map(function (x) {
          return '<tr data-href="/companies/' + esc(x.key) + '"><td class="co"><span class="co-in">' + logo(x.company) + '<span>' + esc(x.company) + '<span class="sub">' + esc(x.industry || '') + '</span></span></span></td>' +
            (can('estimate') ? '<td class="num">' + (x.estimate ? '<span class="cell-strong">' + px(x.estimate) + '</span><span class="sub">' + esc(x.confidence) + ' confidence</span>' : '<span class="muted">—</span>') + '</td>' : '') +
            '<td>' + (x.lastRound ? roundText(x.lastRound) : '<span class="muted">Not on record</span>') + '</td>' +
            (can('estimate') ? '<td class="num">' + (x.vsLastRound != null ? pct(x.vsLastRound) : '—') + '</td>' : '') +
            (showMarket ? '<td class="num">' + num(x.offers) + '</td><td class="num">' + num(x.bids) + '</td>' : '') +
            (can('exactSizes') ? '<td class="num">' + money(x.volume) + '</td>' : '') +
            '<td>' + watchBtn(x.company, x.key) + '</td></tr>';
        }).join('') + '</tbody></table>';
      var cards = list.map(function (x) {
        return '<a class="p-mcard" href="' + href('/companies/' + x.key) + '" data-nav="/companies/' + esc(x.key) + '"><div class="a">' + logo(x.company, 'md') + '<b>' + esc(x.company) + '</b>' + watchBtn(x.company, x.key) + '</div>' +
          '<div class="b"><span>' + esc(x.industry || '') + '</span><strong>' + (x.estimate ? px(x.estimate) : (x.lastRound && x.lastRound.valuation ? money(x.lastRound.valuation) : '')) + '</strong></div>' +
          '<div class="c">' + (x.offers != null ? '<span>' + x.offers + ' offers · ' + x.bids + ' bids</span>' : '') + (x.vsLastRound != null ? '<span>' + pct(x.vsLastRound) + ' vs round</span>' : '') + '</div></a>';
      }).join('');
      var pager = pages > 1 ? '<div class="p-pager"><span>' + num(b.companies.length) + ' companies</span><button class="btn btn-ghost btn-sm" type="button" id="cPrev"' + (co.page <= 1 ? ' disabled' : '') + '>' + ICON.back + 'Previous</button><span>Page ' + co.page + ' of ' + pages + '</span><button class="btn btn-ghost btn-sm" type="button" id="cNext"' + (co.page >= pages ? ' disabled' : '') + '>Next' + ICON.chev + '</button></div>' : '';
      $('#cBody').innerHTML = tableOrCards(table, cards) + pager + (can('estimate') ? '<p class="p-note">Our estimate is built from our own book: live orders, the last 90 days of orders, trades through our desk and the last round. Confidence says how much data stands behind it.</p>' : '');
      var pv = $('#cPrev'); if (pv) pv.onclick = function () { co.page -= 1; loadCompanies(watchOnly); window.scrollTo(0, 0); };
      var nx = $('#cNext'); if (nx) nx.onclick = function () { co.page += 1; loadCompanies(watchOnly); window.scrollTo(0, 0); };
    }).catch(function (e) { $('#cBody').innerHTML = empty('Companies could not load', esc(e.message)); });
  }

  function chartSvg(raw) {
    // A week whose median sits far from the company's typical price (a split, a stray unit)
    // would flatten the chart: it is left out of the line, not of the history table.
    var all = []; raw.forEach(function (w) { if (w.bid) all.push(w.bid); if (w.offer) all.push(w.offer); });
    all.sort(function (a, b) { return a - b; });
    var med = all.length ? all[Math.floor(all.length / 2)] : 0;
    var keep = function (v) { return v && v < med * 1.6 && v > med / 1.6 ? v : null; };
    var weeks = raw.map(function (w) { return { week: w.week, bid: keep(w.bid), offer: keep(w.offer) }; });
    var vals = [];
    weeks.forEach(function (w) { if (w.bid) vals.push(w.bid); if (w.offer) vals.push(w.offer); });
    if (vals.length < 2) return empty('No price history yet', 'Weekly medians appear once the book holds priced orders for two weeks or more.');
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi *= 1.05; lo *= 0.95; }
    var W = 640, H = 200, L = 52, R = 10, T = 12, B = 24;
    var x = function (i) { return L + (i * (W - L - R)) / Math.max(1, weeks.length - 1); };
    var y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var line = function (k) { var d = '', pen = false; weeks.forEach(function (w, i) { if (w[k]) { d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(w[k]).toFixed(1) + ' '; pen = true; } else pen = false; }); return d; };
    var lastOf = function (k) { for (var i = weeks.length - 1; i >= 0; i--) if (weeks[i][k]) return [i, weeks[i][k]]; return null; };
    var lb = lastOf('bid'), lof = lastOf('offer');
    var bidAbove = lb && lof ? lb[1] >= lof[1] : true;
    var endLabel = function (p, name, col, dy) { return p ? '<text x="' + (x(p[0]) - 2).toFixed(1) + '" y="' + (y(p[1]) + dy).toFixed(1) + '" font-size="10.5" font-weight="600" fill="' + col + '" text-anchor="end" font-family="Inter">' + name + ' ' + px(p[1]) + '</text>' : ''; };
    return '<svg class="p-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Weekly median bid and offer">' +
      [lo, (lo + hi) / 2, hi].map(function (v) { return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="4" y="' + (y(v) + 3) + '" font-size="10" fill="var(--muted-2)" font-family="Inter">' + px(v) + '</text>'; }).join('') +
      '<path d="' + line('offer') + '" fill="none" stroke="var(--chart-2)" stroke-width="1.8"/><path d="' + line('bid') + '" fill="none" stroke="var(--chart-1)" stroke-width="1.8"/>' +
      endLabel(lof, 'Median offer', 'var(--chart-2)', bidAbove ? 14 : -6) + endLabel(lb, 'Median bid', 'var(--chart-1)', bidAbove ? -6 : 14) +
      '<text x="' + L + '" y="' + (H - 6) + '" font-size="10" fill="var(--muted-2)" font-family="Inter">' + dayShort(weeks[0].week) + '</text><text x="' + (W - R) + '" y="' + (H - 6) + '" font-size="10" fill="var(--muted-2)" text-anchor="end" font-family="Inter">' + dayShort(weeks[weeks.length - 1].week) + '</text></svg>' +
      '<p class="p-note">' + weeks.length + ' weeks · our book · the axis is fitted to the range of weekly medians, not to zero</p>';
  }

  function viewCompany(key) {
    controls('<a class="btn btn-ghost btn-sm" href="' + href('/companies') + '" data-nav="/companies">' + ICON.back + 'Companies</a><span class="spacer"></span>');
    loading();
    api('/company/' + encodeURIComponent(key)).then(function (c) {
      state.list = c.orders;
      var p = c.profile || {};
      var e = c.estimate;
      var lr = c.rounds[0];
      var site = c.domain ? '<a href="https://' + esc(String(c.domain).replace(/^https?:\/\//, '')) + '" target="_blank" rel="noopener">' + esc(String(c.domain).replace(/^https?:\/\/(www\.)?/, '')) + '</a>' : '';
      controls('<a class="btn btn-ghost btn-sm" href="' + href('/companies') + '" data-nav="/companies">' + ICON.back + 'Companies</a><span class="ctitle hide-m">' + esc(c.company) + '</span><span class="spacer"></span>' +
        watchBtn(c.company, c.key, true) + (can('ownOrders') ? '<button class="btn btn-primary btn-sm" type="button" id="kNew">' + ICON.plus + 'New order</button>' : ''));
      var nb = $('#kNew'); if (nb) nb.onclick = function () { wizard(null, c.company); };
      var stats = [];
      if (e) stats.push([px(e.estimate), 'Our estimate · ' + esc(e.confidence)]);
      if (lr) stats.push([lr.price ? px(lr.price) : money(lr.valuation), (lr.type ? esc(lr.type) : 'Last round') + (lr.date ? ' · ' + (/^\d{4}-\d{2}-\d{2}$/.test(lr.date) ? day(lr.date) : esc(lr.date)) : '')]);
      if (e && lr && lr.price) stats.push([pct((e.estimate - lr.price) / lr.price), 'Estimate vs last round']);
      if (c.counts) stats.push([num(c.counts.offers) + ' / ' + num(c.counts.bids), 'Live offers / bids']);
      if (!stats.length && p.valuation) stats.push([esc(p.valuation), 'Valuation']);
      var left = [];
      var right = [];
      if (e) {
        left.push(panel('Our price estimate', '<div class="p-est"><b>' + px(e.estimate) + '</b>' + tag(e.confidence === 'High' ? 'active' : 'pending', e.confidence + ' confidence') + '</div>' +
          '<p class="p-note">' + (e.low ? 'Middle half of priced orders, last 30 days: ' + px(e.low) + ' – ' + px(e.high) + ' · ' + e.observed30 + ' orders' : 'Too few priced orders in the last 30 days for a range') + '</p>' +
          tableOrCards('<table class="data" style="margin-top:12px"><thead><tr><th>Built from</th><th class="num">Price</th><th class="num">Orders</th><th class="num">Weight</th></tr></thead><tbody>' +
            e.parts.map(function (x) { return '<tr><td>' + esc(x.label) + '</td><td class="num">' + px(x.value) + '</td><td class="num">' + num(x.orders) + '</td><td class="num"><span class="p-wbar"><i style="width:' + x.share + '%"></i></span>' + x.share + '%</td></tr>'; }).join('') + '</tbody></table>',
          e.parts.map(function (x) { return '<div class="p-row"><div class="g">' + esc(x.label) + '<small>' + num(x.orders) + ' orders · weight ' + x.share + '%</small></div><b>' + px(x.value) + '</b></div>'; }).join('')) +
          '<p class="p-note">Recomputed from our book every few minutes. Fresh and desk-checked orders weigh more; trades through our desk weigh most when there are any; the last round fades with its age. Confidence says how many orders stand behind the number, not how accurate it is.</p>'));
      }
      if (c.history) {
        var h = c.history;
        left.push(panel('Market history', chartSvg(h.weeks) +
          '<div class="stats" style="margin:16px 0 0">' + [[num(h.distinct), 'Distinct orders since ' + dayShort(h.since)], [num(h.offers), 'Offers'], [num(h.bids), 'Bids'], [num(h.expired), 'No longer live']].map(function (s) { return '<div class="stat"><div class="v">' + s[0] + '</div><div class="l">' + s[1] + '</div></div>'; }).join('') + '</div>' +
          '<p class="p-note">Repeats of the same order are counted once. Orders that are no longer live stay in the history.</p>'));
        if (h.past.length) {
          left.push(panel('Past orders', tableOrCards('<table class="data"><thead><tr><th>Side</th><th class="num">Price</th><th>Live</th>' + (can('deskCheck') ? '<th>Desk</th>' : '') + '</tr></thead><tbody>' +
            h.past.map(function (x) { return '<tr><td>' + sideTag(x.side) + '</td><td class="num">' + px(x.price) + '</td><td>' + dayShort(x.from) + ' – ' + dayShort(x.to) + '</td>' + (can('deskCheck') ? '<td>' + (x.checked ? tag('active', 'Checked') : '—') + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table>',
          h.past.map(function (x) { return '<div class="p-row">' + sideTag(x.side) + '<div class="g">' + px(x.price) + '<small>' + dayShort(x.from) + ' – ' + dayShort(x.to) + '</small></div></div>'; }).join('')), { flush: false }));
        }
      }
      if (c.orders.length) {
        left.push(panel('Live orders', tableOrCards(orderTable(c.orders), c.orders.map(orderCard).join('')), { flush: true }));
      }
      right.push(panel('Company', (p.summary ? '<p style="margin:0 0 14px;font-size:13.5px;line-height:1.55">' + esc(p.summary) + '</p>' : '') + kv([
        ['Sector', esc(p.sector || c.industry || 'Not stated')],
        ['Headquarters', esc(p.headquarters || c.country || 'Not stated')],
        ['Website', site || 'Not stated'],
        p.valuation ? ['Valuation', esc(p.valuation)] : null,
        p.raised ? ['Total raised', esc(p.raised)] : null,
        p.investors && p.investors.length ? ['Investors', esc(p.investors.join(', '))] : null,
      ].filter(Boolean)) + (p.highlights && p.highlights.length ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px">' + p.highlights.map(function (h) { return '<span class="tag neutral">' + esc(h) + '</span>'; }).join('') + '</div>' : '') +
        (p.profileUrl ? '<p class="p-note" style="margin-top:14px"><a class="cell-link" href="' + esc(p.profileUrl) + '" target="_blank" rel="noopener">Full profile on siliconvalleyinvestclub.com</a></p>' : '')));
      if (c.rounds.length) {
        right.push(panel('Financing', c.rounds.map(function (r) {
          return '<div class="p-row"><div class="g">' + esc(r.type || 'Round') + '<small>' + (r.date ? day(r.date) : 'Date not stated') + '</small></div><span class="w">' + [r.price ? px(r.price) + ' per share' : null, r.valuation ? money(r.valuation) : null].filter(Boolean).join(' · ') + '</span></div>';
        }).join('')));
      }
      if (c.spv && c.spv.length) {
        right.push(panel('New SPVs filed', c.spv.map(function (s) {
          return '<div class="p-row"><div class="g">' + esc(s.vehicle) + '<small>' + esc(s.form || 'Form D') + (s.amount ? ' · ' + esc(s.amount) : '') + '</small></div><span class="w">' + (s.link ? '<a class="cell-link" href="' + esc(s.link) + '" target="_blank" rel="noopener">' + day(s.filed) + '</a>' : day(s.filed)) + '</span></div>';
        }).join('') + '<p class="p-note">From the public filings of the SEC.</p>'));
      }
      if (c.depth && (c.depth.offers.length || c.depth.bids.length)) {
        var lvl = function (l) { return '<div class="p-row"><div class="g">' + px(l.price) + '<small>' + l.orders + ' order' + (l.orders === 1 ? '' : 's') + '</small></div><span class="w">' + (l.volume ? money(l.volume) : 'Size not stated') + '</span></div>'; };
        right.push(panel('Depth', '<div class="sheet-section-title">Offers</div>' + (c.depth.offers.map(lvl).join('') || '<p class="p-note">None</p>') +
          '<div class="sheet-section-title" style="margin-top:14px">Bids</div>' + (c.depth.bids.map(lvl).join('') || '<p class="p-note">None</p>')));
      }
      main('<div class="p-band">' + logo(c.company, 'lg') + '<div><h1>' + esc(c.company) + '</h1><div class="sub">' + [esc(p.sector || c.industry || ''), esc(c.country || ''), site].filter(Boolean).join(' · ') + '</div></div><div class="acts"></div></div>' +
        (stats.length ? '<div class="stats">' + stats.map(function (s) { return '<div class="stat"><div class="v">' + s[0] + '</div><div class="l">' + s[1] + '</div></div>'; }).join('') + '</div>' : '') +
        (window.matchMedia && window.matchMedia('(max-width: 900px)').matches
          // Phone and tablet: the estimate, then who the company is and its rounds, then the market
          // (Grok, 2026-10-09: dozens of live orders stood above the company profile).
          ? '<div class="p-stack">' + left.filter(function (x) { return x.indexOf('Our price estimate') >= 0; }).join('') + right.join('') +
            left.filter(function (x) { return x.indexOf('Our price estimate') < 0; }).join('') + '</div>'
          : '<div class="p-grid two"><div>' + (left.join('') || empty('Market data opens at the Market data level', 'Your level shows the company profile, its rounds and investors.')) + '</div><div>' + right.join('') + '</div></div>'));
      document.title = c.company + ' — Silicon Valley Investclub';
    }).catch(fail);
  }

  // ── Deals: threads (introductions, deals and our desk) ──────────────
  var KIND = { connect: 'Introduction', inquire: 'Question on an order', closed_trade: 'Closed trade', question: 'Question' };
  function statusTag(s) {
    return { new: tag('pending', 'Sent'), in_review: tag('pending', 'With our manager'), answered: tag('active', 'Answered'), declined: '<span class="tag neutral">Declined</span>', closed: '<span class="tag neutral">Closed</span>' }[s] || esc(s);
  }
  function stageTag(st) { return st.tag === 'neutral' ? '<span class="tag neutral">' + esc(st.label) + '</span>' : tag(st.tag, st.label); }
  function sideWord(side) { return side === 'buy' ? 'You buy' : 'You sell'; }
  function whoText(c) { return c.revealed ? esc(c.name) + (c.firm ? ' · ' + esc(c.firm) : '') : esc(c.type || 'Not stated'); }
  function viewThreads() {
    if (state.arg) return viewThread(state.arg);
    controls('<span class="ctitle">Threads</span><span class="spacer"></span><button class="btn btn-ghost btn-sm" type="button" id="tAsk">Write to us</button>');
    $('#tAsk').onclick = function () { askDialog(null); };
    loading();
    api('/deals').then(function (b) {
      var ds = b.deals || [];
      var rq = (b.requests || []).filter(function (r) { return r.kind !== 'connect'; });
      var dealRows = ds.map(function (d) {
        return '<div class="p-row p-thr" data-href="/deals/threads/' + esc(d.id) + '">' + logo(d.company, 'md') + '<div class="g"><b>' + esc(d.company) + '</b> · ' + sideWord(d.side) +
          '<small>' + (d.counterparty.revealed ? 'With ' : 'Other side: ') + whoText(d.counterparty) + (d.last ? ' · ' + esc(d.last) : '') + '</small></div>' +
          '<div class="r">' + stageTag(d.stage) + '<div class="w">' + dayShort(d.updated) + '</div></div></div>';
      }).join('');
      var reqRows = rq.map(function (r) {
        return '<div class="p-row p-thr">' + logo(r.company || 'Silicon Valley Investclub', 'md') + '<div class="g"><b>' + esc(r.company || 'Silicon Valley Investclub') + '</b> · ' + esc(KIND[r.kind] || r.kind) +
          (r.message ? '<small>You: ' + esc(r.message) + '</small>' : '') + (r.answer ? '<small class="ans">Our desk: ' + esc(r.answer) + '</small>' : '') + '</div>' +
          '<div class="r">' + statusTag(r.status) + '<div class="w">' + dayShort(r.created_at) + '</div></div></div>';
      }).join('');
      var html = '';
      if (ds.length) html += panel('Introductions and deals', dealRows, { flush: true, desc: 'Our manager approves every introduction. Names open once both sides accept and sign the NCNDA.' });
      if (rq.length) html += panel('Questions to our desk', reqRows, { flush: true });
      main(subTabs() + (html ? '<div class="p-stack">' + html + '</div>' : empty('No threads yet', can('connect') ? 'Press Connect on any order: our manager reviews the introduction, and the conversation with the other side opens here.' : 'Questions you send to our desk and our answers appear here.')));
    }).catch(fail);
  }

  // The stage band uses the same names as the stage tag (one vocabulary, sent by the server for this side).
  function stepper(d) {
    var list = d.stages || [];
    var at = list.map(function (s) { return s.status; }).indexOf(d.stage.status);
    if (at < 0) return '';
    return '<ol class="p-steps p-stage" aria-label="Stages">' + list.map(function (s, i) {
      return '<li class="' + (i < at ? 'done' : i === at ? 'on' : '') + '"' + (i === at ? ' aria-current="step"' : '') + '>' + esc(s.label) + '</li>';
    }).join('') + '</ol>';
  }
  function msgList(list) {
    if (!list.length) return '<p class="p-note" style="margin:0">No messages yet.</p>';
    return '<div class="p-msgs">' + list.map(function (m) {
      if (m.kind === 'system' || !m.who) return '<div class="p-sys"><span>' + esc(m.body) + '</span><time>' + dayShort(m.at) + '</time></div>';
      var extra = '';
      if (m.kind === 'call' && m.payload && m.payload.at) extra = '<div class="p-msg-x">' + esc(new Date(m.payload.at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })) + (m.payload.link ? ' · <a class="cell-link" href="' + esc(m.payload.link) + '" target="_blank" rel="noopener">Join the call</a>' : '') + '</div>';
      if (m.kind === 'agreement' && m.payload && m.payload.terms) extra = agreedBlock(m.payload.terms, m.payload.steps || []);
      return '<div class="p-msg' + (m.mine ? ' mine' : '') + (m.who === 'Silicon Valley Investclub' ? ' desk' : '') + '"><div class="hd"><b>' + esc(m.who) + '</b><time>' + esc(new Date(m.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</time></div><div class="bd">' + esc(m.body) + '</div>' + extra + '</div>';
    }).join('') + '</div>';
  }
  function agreedBlock(t, steps, bare) {
    return '<div class="' + (bare ? '' : 'p-msg-x') + '">' + kv([['Price', esc(t.price)], ['Size', esc(t.size)], ['Structure', esc(t.structure)], ['Closing', esc(t.closing || '—')]].concat(t.comment ? [['Notes', esc(t.comment)]] : [])) +
      (steps.length ? '<div class="sheet-section-title" style="margin-top:12px">Your next steps</div><ol class="p-stepsl">' + steps.map(function (s) { return '<li>' + esc(s.task) + (s.when ? ' <span class="muted">· ' + esc(s.when) + '</span>' : '') + '</li>'; }).join('') + '</ol>' : '') + '</div>';
  }
  function ncndaPanel(d, base) {
    var n = d.ncnda;
    if (!n) return '';
    var body;
    if (n.state === 'on_file') body = tag('active', 'On file') + '<p class="p-note">Your NCNDA with us is already signed; it covers this introduction.</p>';
    else if (n.state === 'signed') body = tag('active', 'Signed') + '<p class="p-note">' + (d.stage.status === 'accepted' ? 'Waiting for the other side to sign.' : 'Signed for this introduction.') + '</p>';
    else if (n.state === 'sent' && n.toSign) body = tag('pending', 'Waiting for your signature') + '<div style="margin-top:12px"><button class="btn btn-primary btn-sm" type="button" data-sign="' + esc(n.envelope) + '">Sign the NCNDA</button></div>';
    else if (n.state === 'sent') body = tag('pending', 'Signed by you · with our signatory');
    else body = '<p class="p-note" style="margin:0 0 12px">One short non-circumvention and non-disclosure agreement with Silicon Valley Investclub. You sign it once; it covers every later introduction.</p><button class="btn btn-primary btn-sm" type="button" id="dNcnda">Sign the NCNDA</button>';
    return panel('NCNDA', body);
  }
  function docsPanel(d) {
    if (!d.documents || !d.documents.length) return '';
    return panel('Documents', d.documents.map(function (x) {
      return '<div class="p-row"><div class="g">' + esc(x.title) + '<small>' + dayShort(x.at) + '</small></div>' +
        (x.done ? tag('active', 'Signed') + ' <a class="cell-link" href="' + (d.filePath ? d.filePath(x.envelope) : API + '/documents/' + encodeURIComponent(x.envelope) + '/file') + '" target="_blank" rel="noopener">Open</a>' : x.toSign ? '<button class="btn btn-primary btn-sm" type="button" data-sign="' + esc(x.envelope) + '">Sign</button>' : tag('pending', 'With our signatory')) + '</div>';
    }).join(''));
  }
  function threadBody(d, opts) {
    opts = opts || {};
    var o = d.order || {};
    var c = d.counterparty;
    var head = '<div class="p-band">' + logo(d.company, 'lg') + '<div><h1>' + esc(d.company) + '</h1><div class="sub">' + sideWord(d.side) + ' · ' + (o.price ? px(o.price) + ' per share' : 'Unpriced') + ' · ' + esc(o.sizeBand || (o.sizeMax ? money(o.sizeMax) : 'Size not stated')) + ' · ' + esc(o.structure || 'Structure not stated') + '</div></div>' +
      '<div class="acts">' + stageTag(d.stage) + '</div></div>';
    var act = '';
    if (d.can.accept) act = panel('Introduction request', '<p style="margin:0 0 12px">Our manager approved a request to be introduced on your ' + (d.side === 'buy' ? 'bid' : 'offer') + '. The other side: <b>' + esc(c.type) + '</b>. If you accept, you both sign the NCNDA and then see each other here.</p>' +
      '<div class="p-acts"><button class="btn btn-primary btn-sm" type="button" id="dAccept">Accept the introduction</button><button class="btn btn-ghost btn-sm" type="button" id="dDecline">Decline</button></div>');
    var side = panel('The other side', kv([
      ['Who', whoText(c)],
      ['Identity', c.revealed ? 'Open · you were introduced' : 'Named once both sides accept and sign the NCNDA'],
    ])) + panel('Order', kv([
      ['Price', o.price ? px(o.price) + ' ' + (o.priceBasis === 'net' ? 'net' : 'gross') : 'Unpriced'],
      ['Size', esc(o.sizeBand || (o.sizeMin && o.sizeMax ? money(o.sizeMin) + ' – ' + money(o.sizeMax) : o.sizeMax ? money(o.sizeMax) : 'Not stated'))],
      ['Structure', esc(structText(o))],
      ['Share class', esc(o.shareClass || 'Any')],
    ])) + ncndaPanel(d) +
      (d.call ? panel('Call', kv([['When', esc(new Date(d.call.at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }))], ['Link', d.call.link ? '<a class="cell-link" href="' + esc(d.call.link) + '" target="_blank" rel="noopener">Join the call</a>' : 'Our associate sends it']])) : '') +
      docsPanel(d) +
      (d.can.withdraw ? '<button class="btn btn-ghost btn-sm" type="button" id="dWithdraw">Withdraw the request</button>' : '');
    var composer = d.can.write ? '<div class="p-compose"><textarea id="dMsg" rows="3" maxlength="2000" placeholder="' + (c.revealed ? 'Write to the other side and our associate' : 'Write to our associate · the other side reads the thread once you are introduced') + '"></textarea><div class="p-acts"><span class="p-note" style="margin:0">' + (c.revealed ? 'Everyone in this thread reads it.' : 'Only our associate reads it before the introduction.') + '</span><button class="btn btn-primary btn-sm" type="button" id="dSend">Send</button></div></div>' : '';
    return (opts.back ? '<a class="cell-link p-back" href="' + href('/deals/threads') + '" data-nav="/deals/threads">' + ICON.back + 'All threads</a>' : '') + head + stepper(d) +
      '<div class="p-grid two"><div>' + act + (d.terms ? panel('Agreed terms', agreedBlock(d.terms, d.steps || [], true), { desc: 'Confirmed by our associate after the call.' }) : '') +
      panel('Thread', msgList(d.messages) + composer) + '</div><div>' + side + '</div></div>';
  }
  function ncndaDialog(onYes) {
    var m = modal('Sign the NCNDA',
      '<p style="margin:0 0 12px">Are you based in the United States?</p><div class="p-opts" id="nUs"><label><input type="radio" name="us" value="no"> No</label><label><input type="radio" name="us" value="yes"> Yes</label></div>' +
      '<p class="p-note">Signers based in the United States sign through Finalis Securities, our broker-dealer; our desk sends that document to you.</p>' + (onYes.extra || ''),
      '<button class="btn btn-ghost" type="button" id="nCancel">Cancel</button><button class="btn btn-primary" type="button" id="nGo">Continue</button>');
    $('#nCancel', m).onclick = closeModal;
    $('#nGo', m).onclick = function () {
      var v = ($('input[name=us]:checked', m) || {}).value;
      if (!v) return toast('Say whether you are based in the United States', true);
      this.disabled = true;
      onYes.run(v === 'yes', m).then(function (r) {
        if (r.preview) { closeModal(); return toast('Preview: nothing was sent'); }
        if (r.url) { closeModal(); location.href = r.url; return; }
        closeModal();
        toast(r.finalis ? 'Our desk will send you the document through Finalis' : r.onFile ? 'Your NCNDA is already on file' : 'Done');
        onYes.after();
      }).catch(function (e) { toast(e.message, true); $('#nGo', m).disabled = false; });
    };
  }
  function bindThread(d, apiBase, after) {
    // Each button keeps its own element: one shared variable was reassigned by the
    // next line, so the click handler found null and Send / Accept did nothing
    // (Grok and Codex visual runs, 2026-10-09).
    var on = function (sel, fn) { var el = $(sel); if (el) el.onclick = function () { fn(el); }; };
    on('#dAccept', function (el) {
      el.disabled = true;
      api(apiBase + '/accept', { method: 'POST' }).then(function (r) { toast(r.preview ? 'Preview: nothing was sent' : 'Accepted · sign the NCNDA next'); after(); }).catch(function (e) { toast(e.message, true); el.disabled = false; });
    });
    on('#dDecline', function () {
      var m = modal('Decline the introduction', '<p style="margin:0">The other side learns only that the introduction was declined.</p>', '<button class="btn btn-ghost" type="button" id="xNo">Cancel</button><button class="btn btn-primary" type="button" id="xYes">Decline</button>');
      $('#xNo', m).onclick = closeModal;
      $('#xYes', m).onclick = function () { api(apiBase + '/decline', { method: 'POST' }).then(function () { closeModal(); toast('Declined'); after(); }).catch(function (e) { toast(e.message, true); }); };
    });
    on('#dWithdraw', function () { api(apiBase + '/withdraw', { method: 'POST' }).then(function (r) { toast(r.preview ? 'Preview: nothing was changed' : 'Withdrawn'); after(); }).catch(function (e) { toast(e.message, true); }); });
    on('#dSend', function (el) {
      var t = $('#dMsg').value.trim();
      if (!t) return toast('Write a message first', true);
      el.disabled = true;
      api(apiBase + '/messages', { method: 'POST', body: { body: t } }).then(function (r) { toast(r.preview ? 'Preview: nothing was sent' : 'Sent'); after(); }).catch(function (e) { toast(e.message, true); el.disabled = false; });
    });
    on('#dNcnda', function () {
      ncndaDialog({ extra: d.ncndaExtra || '', run: function (us, m) { return api(apiBase + '/ncnda', { method: 'POST', body: d.ncndaBody ? d.ncndaBody(us, m) : { usBased: us } }); }, after: after });
    });
    $$('[data-sign]').forEach(function (x) {
      x.onclick = function () {
        x.disabled = true;
        var path = d.signPath ? d.signPath(x.getAttribute('data-sign')) : '/documents/' + encodeURIComponent(x.getAttribute('data-sign')) + '/sign';
        api(path, { method: 'POST' }).then(function (r) { if (r.preview) return toast('Preview: nothing was signed'); if (r.url) location.href = r.url; }).catch(function (e) { toast(e.message, true); x.disabled = false; });
      };
    });
  }
  // A thread stays current by itself (Codex F5, 2026-10-09): a guarded tick every
  // 15 s, skipped while the tab is hidden, a dialog is open or a reply is being
  // typed, and redrawing only when the thread actually changed.
  var threadLive = { timer: null, fp: null };
  function threadFingerprint(d) {
    return [d.stage && d.stage.status, (d.messages || []).length, (d.documents || []).map(function (x) { return x.done ? 1 : 0; }).join(''),
      d.ncnda ? d.ncnda.state : '', d.call ? d.call.at : ''].join('|');
  }
  function stopThreadLive() { if (threadLive.timer) clearInterval(threadLive.timer); threadLive.timer = null; }
  function startThreadLive(path, redraw) {
    stopThreadLive();
    threadLive.timer = setInterval(function autoRefreshTick() {
      if (document.hidden || $('#modalOverlay').classList.contains('open')) return;
      var box = $('#dMsg');
      if (box && box.value.trim()) return;
      api(path).then(function (d) { if (threadFingerprint(d) !== threadLive.fp) redraw(d); }).catch(function () {});
    }, 15000);
  }
  function viewThread(id) {
    controls('<span class="ctitle">Thread</span><span class="spacer"></span><button class="btn btn-ghost btn-sm" type="button" id="tAsk">Write to us</button>');
    $('#tAsk').onclick = function () { askDialog(null); };
    loading();
    var path = '/deals/' + encodeURIComponent(id);
    var draw = function (d) {
      threadLive.fp = threadFingerprint(d);
      main(threadBody(d, { back: true }));
      bindThread(d, path, function () { viewThread(id); });
      var list = $('.p-msgs'); if (list) list.scrollTop = list.scrollHeight;
    };
    api(path).then(function (d) {
      draw(d);
      startThreadLive(path, draw);
      var list = $('.p-msgs'); if (list) list.scrollTop = list.scrollHeight;
    }).catch(fail);
  }

  // ── Deals: network (phase 3) ────────────────────────────────────────
  var nw = { data: null };
  function viewNetwork() {
    controls('<span class="ctitle">Network</span><span class="spacer"></span><button class="btn btn-primary btn-sm" type="button" id="nAdd">' + ICON.plus + 'Add contact</button>');
    $('#nAdd').onclick = function () { contactDialog(null); };
    loading();
    api('/network').then(function (b) {
      nw.data = b;
      var list = b.contacts || [];
      var shared = b.shared || [];
      var rows = list.map(function (c) {
        return '<tr><td class="co">' + esc(c.name) + (c.firm ? '<span class="sub">' + esc(c.firm) + '</span>' : '') + '</td><td>' + esc(c.group) + '</td><td>' + (c.email ? esc(c.email) : '<span class="muted">No email</span>') + '</td>' +
          '<td>' + (c.onPortal ? tag('active', 'On the portal') : c.inviteRequested ? tag('pending', 'Invitation requested') : '<span class="muted">Not on the portal</span>') + '</td><td class="num">' + (c.shares || 0) + '</td>' +
          '<td><div class="p-acts end">' + (!c.onPortal && !c.inviteRequested && c.email ? '<button class="btn btn-ghost btn-sm" type="button" data-inv="' + c.id + '">Ask us to invite</button>' : '') + '<button class="btn btn-ghost btn-sm" type="button" data-ced="' + c.id + '">Edit</button></div></td></tr>';
      }).join('');
      var cards = list.map(function (c) {
        return '<div class="p-mcard"><div class="a"><b>' + esc(c.name) + '</b>' + (c.onPortal ? tag('active', 'On the portal') : '') + '</div><div class="b"><span>' + esc([c.firm, c.group].filter(Boolean).join(' · ')) + '</span></div>' +
          '<div class="c"><span>' + esc(c.email || 'No email') + '</span>' + (c.onPortal ? '' : c.inviteRequested ? tag('pending', 'Invitation requested') : '') +
          '<span class="w">' + (!c.onPortal && !c.inviteRequested && c.email ? '<button class="btn-link" type="button" data-inv="' + c.id + '">Ask us to invite</button> · ' : '') +
          '<button class="btn-link" type="button" data-ced="' + c.id + '">Edit</button></span></div></div>';
      }).join('');
      var sharedHtml = shared.length ? shared.map(function (s) {
        return '<div class="p-row">' + logo(s.company, 'md') + '<div class="g"><b>' + esc(s.company) + '</b> · ' + (s.side === 'bid' ? 'Bid' : 'Offer') + ' · ' + (s.price ? px(s.price) : 'Unpriced') + (s.sizeMax ? ' · ' + (s.sizeUnit === 'shares' ? num(s.sizeMax) + ' shares' : money(s.sizeMax)) : '') +
          '<small>From ' + esc(s.from.name || '') + (s.from.firm ? ' · ' + esc(s.from.firm) : '') + (s.from.email ? ' · <a class="cell-link" href="mailto:' + esc(s.from.email) + '">' + esc(s.from.email) + '</a>' : '') + (s.note ? ' · ' + esc(s.note) : '') + '</small></div>' + (can('connect') ? '<button class="btn btn-ghost btn-sm" type="button" data-shconnect="' + s.id + '">Connect</button>' : '') + '<span class="w">' + dayShort(s.sharedAt) + '</span></div>';
      }).join('') : '<p class="p-note" style="margin:0">Orders your contacts share with you privately appear here.</p>';
      main(subTabs() + '<div class="p-grid two"><div>' +
        (list.length ? panel('Your contacts', tableOrCards('<table class="data"><thead><tr><th>Name</th><th>Group</th><th>Email</th><th>Portal</th><th class="num">Shared</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>', cards), { flush: true }) :
          empty('Your network is empty', 'Add the people you trade with. Share your own orders with them privately, and ask us to invite them to the portal.')) +
        '</div><div>' + panel('Shared with me', sharedHtml) + panel('How sharing works', '<p class="p-note" style="margin:0">From My orders, share a live order of yours with chosen contacts. They see it under Shared with me with your name, because you chose to show it to them. Orders from our book are never shared this way. Access to the portal is always granted by Silicon Valley Investclub.</p>') + '</div></div>');
      $$('[data-ced]').forEach(function (x) { x.onclick = function () { contactDialog(list.filter(function (c) { return String(c.id) === x.getAttribute('data-ced'); })[0]); }; });
      $$('[data-shconnect]').forEach(function (x) {
        x.onclick = function () {
          x.disabled = true;
          api('/deals', { method: 'POST', body: { sharedOrder: Number(x.getAttribute('data-shconnect')) } }).then(function (r) {
            if (r.preview) { toast('Preview: nothing was sent'); x.disabled = false; return; }
            toast(r.existing ? 'You already have a thread on this order' : 'Request sent · our manager reviews it');
            go('/deals/threads/' + r.id);
          }).catch(function (e) { toast(e.message, true); x.disabled = false; });
        };
      });
      $$('[data-inv]').forEach(function (x) {
        x.onclick = function () { x.disabled = true; api('/network/' + x.getAttribute('data-inv') + '/invite', { method: 'POST' }).then(function (r) { toast(r.preview ? 'Preview: nothing was sent' : 'Our desk will review the invitation'); viewNetwork(); }).catch(function (e) { toast(e.message, true); x.disabled = false; }); };
      });
    }).catch(fail);
  }
  function contactDialog(c) {
    var groups = (nw.data && nw.data.groups) || ['Buyers', 'Sellers', 'Brokers', 'Funds', 'Other'];
    var m = modal(c ? 'Edit contact' : 'Add contact',
      '<div class="frm"><div class="field"><label for="kName">Name</label><input type="text" id="kName" maxlength="120" value="' + esc(c ? c.name : '') + '"></div>' +
      '<div class="field"><label for="kFirm">Firm</label><input type="text" id="kFirm" maxlength="160" value="' + esc(c ? c.firm || '' : '') + '"></div>' +
      '<div class="field"><label for="kEmail">Email</label><input id="kEmail" type="email" maxlength="200" value="' + esc(c ? c.email || '' : '') + '"></div>' +
      '<div class="field"><label for="kGroup">Group</label><select id="kGroup">' + groups.map(function (g) { return '<option' + (c && c.group === g ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><label for="kNote">Note</label><textarea id="kNote" rows="2" maxlength="600">' + esc(c ? c.note || '' : '') + '</textarea></div>',
      (c ? '<button class="btn btn-ghost" type="button" id="kDel">Remove</button><span class="spacer"></span>' : '') + '<button class="btn btn-ghost" type="button" id="kCancel">Cancel</button><button class="btn btn-primary" type="button" id="kSave">Save</button>');
    $('#kCancel', m).onclick = closeModal;
    var body = function () { return { name: $('#kName', m).value, firm: $('#kFirm', m).value, email: $('#kEmail', m).value, group: $('#kGroup', m).value, note: $('#kNote', m).value }; };
    $('#kSave', m).onclick = function () {
      var p = c ? api('/network/' + c.id, { method: 'PUT', body: body() }) : api('/network', { method: 'POST', body: body() });
      p.then(function (r) { closeModal(); toast(r.preview ? 'Preview: nothing was saved' : 'Saved'); viewNetwork(); }).catch(function (e) { toast(e.message, true); });
    };
    if (c) $('#kDel', m).onclick = function () { api('/network/' + c.id, { method: 'DELETE' }).then(function (r) { closeModal(); toast(r.preview ? 'Preview: nothing was changed' : 'Removed'); viewNetwork(); }).catch(function (e) { toast(e.message, true); }); };
  }
  function shareDialog(o) {
    Promise.all([api('/network'), api('/orders/' + o.id + '/shares')]).then(function (rs) {
      var list = rs[0].contacts || [];
      var on = new Set(rs[1].contacts || []);
      if (!list.length) {
        var e = modal('Share privately', '<p style="margin:0">Add the people you trade with in Network first.</p>', '<button class="btn btn-primary" type="button" id="sNet">Open Network</button>');
        $('#sNet', e).onclick = function () { closeModal(); go('/deals/network'); };
        return;
      }
      var m = modal('Share ' + o.company + ' privately',
        '<p class="p-note" style="margin:0 0 12px">Chosen contacts see this order with your name. Nothing else is shared.</p>' +
        list.map(function (c) { return '<label class="p-check"><input type="checkbox" value="' + c.id + '"' + (on.has(c.id) ? ' checked' : '') + '><span><b>' + esc(c.name) + '</b>' + (c.firm ? ' · ' + esc(c.firm) : '') + '<br><span class="muted">' + esc(c.email || 'No email · they will not see it until you add one') + '</span></span></label>'; }).join('') +
        '<div class="field" style="margin-top:12px"><label for="sNote">Note to them (optional)</label><input type="text" id="sNote" maxlength="400"></div>',
        '<button class="btn btn-ghost" type="button" id="sCancel">Cancel</button><button class="btn btn-primary" type="button" id="sSave">Share</button>');
      $('#sCancel', m).onclick = closeModal;
      $('#sSave', m).onclick = function () {
        var ids = $$('input[type=checkbox]:checked', m).map(function (x) { return Number(x.value); });
        api('/orders/' + o.id + '/shares', { method: 'PUT', body: { contacts: ids, note: $('#sNote', m).value } }).then(function (r) { closeModal(); toast(r.preview ? 'Preview: nothing was shared' : ids.length ? 'Shared with ' + ids.length + (ids.length === 1 ? ' contact' : ' contacts') : 'No longer shared'); }).catch(function (e) { toast(e.message, true); });
      };
    }).catch(function (e) { toast(e.message, true); });
  }

  // ── Deals: documents ────────────────────────────────────────────────
  function viewDocuments() {
    controls('<span class="ctitle">Documents</span>');
    loading();
    api('/documents').then(function (b) {
      var list = b.documents || [];
      var st = function (x) { return x.state === 'signed' ? tag('active', 'Signed') : x.state === 'to_sign' ? tag('pending', 'Waiting for you') : x.state === 'countersign' ? tag('pending', 'With our signatory') : '<span class="tag neutral">' + esc(x.state) + '</span>'; };
      var act = function (x) {
        if (x.toSign) return '<button class="btn btn-primary btn-sm" type="button" data-sign="' + esc(x.id) + '">Sign</button>';
        if (x.state === 'signed') return '<a class="btn btn-ghost btn-sm" href="' + API + '/documents/' + encodeURIComponent(x.id) + '/file" target="_blank" rel="noopener">Open signed copy</a>';
        return '';
      };
      var th = function (x) { return x.thread ? '<a class="cell-link" href="' + href('/deals/threads/' + x.thread.id) + '" data-nav="/deals/threads/' + esc(x.thread.id) + '">' + esc(x.thread.company) + '</a>' : '<span class="muted">—</span>'; };
      main(subTabs() + (list.length ? tableOrCards(
        '<table class="data"><thead><tr><th>Document</th><th>Thread</th><th>Status</th><th>Sent</th><th>Signed</th><th></th></tr></thead><tbody>' + list.map(function (x) {
          return '<tr><td class="co">' + esc(x.title) + '</td><td>' + th(x) + '</td><td>' + st(x) + '</td><td>' + dayShort(x.sent) + '</td><td>' + (x.signed ? dayShort(x.signed) : '<span class="muted">—</span>') + '</td><td>' + act(x) + '</td></tr>';
        }).join('') + '</tbody></table>',
        list.map(function (x) { return '<div class="p-mcard"><div class="a"><b>' + esc(x.title) + '</b>' + st(x) + '</div><div class="c"><span>' + dayShort(x.sent) + '</span><span class="w">' + act(x) + '</span></div></div>'; }).join('')) +
        '<p class="p-note">Every agreement is signed in our E-Sign: you sign first, then our signatory. The signed copy opens here and comes to your email.</p>'
        : empty('No documents yet', 'Your NCNDA and the agreements of your deals appear here, ready to sign.')));
      bindThread({}, '', viewDocuments);
    }).catch(fail);
  }

  // ── Market: desk picks (Premium) ────────────────────────────────────
  function viewPicks() {
    controls('<span class="ctitle">Desk picks</span>');
    loading();
    api('/picks').then(function (b) {
      var list = b.picks || [];
      state.list = list.map(function (p) { return p.order; });
      main(subTabs() + (list.length ? panel('Orders our desk picked for you', list.map(function (p) {
        var o = p.order;
        return '<div class="p-row" data-order="' + esc(o.id) + '" style="cursor:pointer">' + logo(o.company, 'md') + '<div class="g"><b>' + esc(o.company) + '</b> · ' + (o.side === 'bid' ? 'Bid' : 'Offer') + ' · ' + (o.price ? px(o.price) : 'Unpriced') + ' · ' + esc(sizeOf(o)) +
          '<small>' + [o.structure ? esc(structText(o)) : '', p.note ? 'Our desk: ' + esc(p.note) : ''].filter(Boolean).join(' · ') + '</small></div>' + (o.deskChecked ? tag('active', 'Checked') : '') + '<span class="w">' + dayShort(p.at) + '</span></div>';
      }).join(''), { flush: false }) : empty('No picks yet', 'Our desk picks orders that fit your mandate and explains why. They appear here and in your notifications.')));
    }).catch(fail);
  }

  // ── Personal link: an order owner without an account ───────────────
  function linkMode(token) {
    $('#pBurger').hidden = true;
    $('#pNav').innerHTML = '';
    $('#pOut').hidden = true;
    $('#pHome').setAttribute('href', SITE + '/');
    $('#pCtx').textContent = 'Introduction';
    document.title = 'Introduction — Silicon Valley Investclub';
    var base = '/link/' + encodeURIComponent(token);
    var load = function () {
      $('#pMain').innerHTML = '<div class="empty"><span class="serif">Loading…</span></div>';
      api(base).then(function (d) {
        controls('<span class="ctitle">Introduction request</span>');
        d.ncndaExtra = '<div class="frm" style="margin-top:12px"><div class="field"><label for="lName">Your full name</label><input type="text" id="lName" maxlength="120" value="' + esc(d.owner.name) + '"></div>' +
          '<div class="field"><label for="lEmail">Email</label><input id="lEmail" type="email" maxlength="200" value="' + esc(d.owner.email) + '"></div>' +
          '<div class="field"><label for="lCo">Company</label><input type="text" id="lCo" maxlength="160" value="' + esc(d.owner.company) + '"></div></div>';
        d.ncndaBody = function (us, m) { return { usBased: us, name: $('#lName', m).value, email: $('#lEmail', m).value, company: $('#lCo', m).value }; };
        d.signPath = function (env) { return base + '/sign/' + encodeURIComponent(env); };
        d.filePath = function (env) { return API + base + '/file/' + encodeURIComponent(env); };
        d.can.withdraw = false;
        $('#pMain').innerHTML = threadBody(d) + '<p class="p-note">This personal link opens only this introduction. Keep it to yourself; it expires in three weeks.</p>';
        bindThread(d, base, load);
        threadLive.fp = threadFingerprint(d);
        if (!threadLive.timer) startThreadLive(base, function () { load(); });
      }).catch(function (e) { $('#pMain').innerHTML = empty('This link is not available', esc(e.message) + '<br><br>Write to the person at Silicon Valley Investclub who sent it to you.'); });
    };
    load();
  }

  // ── Deals: my orders ────────────────────────────────────────────────
  var ob = { tab: 'live', data: null };
  function viewOrders() {
    controls('<span class="ctitle">My orders</span><div class="seg" id="oTabs">' + [['live', 'Live'], ['other', 'Expired and closed'], ['archived', 'Archived']].map(function (t) {
      return '<button type="button" data-t="' + t[0] + '" class="' + (ob.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>';
    }).join('') + '</div><span class="spacer"></span><button class="btn btn-primary btn-sm" type="button" id="oNew">' + ICON.plus + 'New order</button>');
    $('#oTabs').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; ob.tab = b.getAttribute('data-t'); viewOrders(); };
    $('#oNew').onclick = function () { wizard(null); };
    main(subTabs() + '<div id="oBody"><div class="empty"><span class="serif">Loading…</span></div></div>');
    api('/orders').then(function (b) {
      ob.data = b;
      var list = b.orders.filter(function (o) { return ob.tab === 'archived' ? o.status === 'archived' : ob.tab === 'live' ? o.status === 'live' : (o.status === 'expired' || o.status === 'closed'); });
      if (!list.length) {
        $('#oBody').innerHTML = empty(ob.tab === 'live' ? 'No live orders' : 'Nothing here', ob.tab === 'live' ? 'Place an order with New order. Our desk checks it, and the orders in our book that match it appear next to it at once.' : '');
        return;
      }
      var stTag = function (s, o) {
        if (s === 'live' && o && o.deskState === 'review') return tag('pending', 'With our desk');
        if (s === 'live' && o && o.deskState === 'returned') return tag('pending', 'Returned');
        if (s === 'live' && o && o.visibility !== 'darkpool') return tag('active', 'In the book');
        return { live: tag('active', 'Live'), expired: tag('pending', 'Expired'), closed: '<span class="tag neutral">Closed</span>', archived: '<span class="tag neutral">Archived</span>' }[s] || esc(s);
      };
      var table = '<table class="data"><thead><tr><th>Company</th><th>Side</th><th>Status</th><th>Visibility</th><th class="num">Price</th><th class="num">Size</th><th>Structure</th><th>Live until</th><th class="num">Matches</th><th></th></tr></thead><tbody>' +
        list.map(function (o) {
          return '<tr><td class="co"><span class="co-in">' + logo(o.company) + esc(o.company) + '</span></td><td>' + sideTag(o.side) + '</td><td>' + stTag(o.status, o) + (o.deskState === 'returned' && o.deskNote ? '<span class="sub">' + esc(o.deskNote) + '</span>' : '') + '</td><td>' + (o.visibility === 'darkpool' ? 'Private' : 'Book') + '</td>' +
            '<td class="num">' + (o.price ? px(o.price) : '<span class="muted">Unpriced</span>') + '</td><td class="num">' + money(o.sizeMax) + '</td><td>' + esc(o.structure) + '</td><td>' + dayShort(o.liveUntil) + '</td>' +
            '<td class="num">' + (o.matches ? '<button class="btn-link" type="button" data-matches="' + o.id + '">' + o.matches + '</button>' : '0') + '</td><td>' + rowActions(o) + '</td></tr>';
        }).join('') + '</tbody></table>';
      var cards = list.map(function (o) {
        return '<div class="p-mcard"><div class="a">' + logo(o.company, 'md') + '<b>' + esc(o.company) + '</b>' + sideTag(o.side) + '</div><div class="b"><span>' + esc(o.structure) + '</span><strong>' + (o.price ? px(o.price) : 'Unpriced') + '</strong></div>' +
          '<div class="c"><span>' + money(o.sizeMax) + '</span>' + stTag(o.status, o) + (o.matches ? '<button class="btn-link" type="button" data-matches="' + o.id + '">' + o.matches + ' matches</button>' : '') + '<span class="w">' + rowActions(o) + '</span></div></div>';
      }).join('');
      $('#oBody').innerHTML = tableOrCards(table, cards);
      bindRowActions();
      var focus = new URLSearchParams(location.search).get('order');
      if (focus) showMatches(focus);
    }).catch(function (e) { $('#oBody').innerHTML = empty('Your orders could not load', esc(e.message)); });
  }
  function rowActions(o) {
    var item = function (act, label, cls) { return '<button class="menu-item' + (cls ? ' ' + cls : '') + '" type="button" data-act="' + act + '" data-id="' + o.id + '">' + label + '</button>'; };
    var a = item('view', 'View details');
    if (o.status !== 'archived' && o.status !== 'closed') a += item('edit', 'Edit');
    if (o.status === 'live' && can('network')) a += item('share', 'Share privately');
    if (o.status === 'live' || o.status === 'expired') a += item('renew', 'Renew for ' + ob.data.options.liveDays + ' days') + item('closed', 'Report a closed trade');
    if (o.status === 'live') a += item('expire', 'Expire now', 'danger');
    if (o.status !== 'archived') a += item('archive', 'Archive');
    return '<div class="menu p-rowmenu"><button class="btn btn-ghost btn-sm" type="button" data-rowmenu aria-haspopup="true" aria-expanded="false">Actions</button><div class="menu-list">' + a + '</div></div>';
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-rowmenu]');
    $$('.p-rowmenu.open').forEach(function (m) { if (!t || m !== t.parentNode) { m.classList.remove('open'); m.firstChild.setAttribute('aria-expanded', 'false'); } });
    if (t) { var m = t.parentNode; var on = !m.classList.contains('open'); m.classList.toggle('open', on); t.setAttribute('aria-expanded', on ? 'true' : 'false'); }
  });
  function findMine(id) { return ob.data.orders.filter(function (o) { return String(o.id) === String(id); })[0]; }
  function bindRowActions() {
    $$('[data-matches]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); showMatches(b.getAttribute('data-matches')); }; });
    $$('[data-act]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-id'), o = findMine(id), act = b.getAttribute('data-act');
        var done = function (msg) { return function (r) { toast(r && r.preview ? 'Preview: nothing was changed' : msg); viewOrders(); }; };
        if (act === 'view') return showMine(o);
        if (act === 'edit') return wizard(o);
        if (act === 'renew') return api('/orders/' + id + '/renew', { method: 'POST' }).then(done('Renewed for ' + ob.data.options.liveDays + ' days')).catch(function (er) { toast(er.message, true); });
        if (act === 'archive') return api('/orders/' + id + '/archive', { method: 'POST' }).then(done('Archived')).catch(function (er) { toast(er.message, true); });
        if (act === 'expire') return expireDialog(o);
        if (act === 'closed') return closedDialog(o);
        if (act === 'share') return shareDialog(o);
      };
    });
  }
  function showMine(o) {
    var yn = function (v) { return v === true ? 'Yes' : v === false ? 'No' : 'Not stated'; };
    var rows = [['Company', esc(o.company)], ['Side', o.direction === 'BUY' ? 'Bid' : 'Offer'], ['Visibility', o.visibility === 'darkpool' ? 'Private — matched, not shown in the book' : 'Shown in the book']];
    o.terms.forEach(function (t, i) {
      rows.push(['Structure ' + (i + 1), esc(t.structure) + (t.layers > 1 ? ' · multi-layer' : '')]);
      rows.push(['Price', t.pricePerShare ? px(t.pricePerShare) + ' ' + esc(t.priceBasis) : 'Unpriced']);
      rows.push(['Valuation', money(t.valuation)]);
      rows.push(['Size', (t.sizeMin ? (t.sizeUnit === 'shares' ? num(t.sizeMin) : money(t.sizeMin)) + ' – ' : '') + (t.sizeUnit === 'shares' ? num(t.sizeMax) + ' shares' : money(t.sizeMax))]);
      if (t.managementFee != null || t.carry != null || t.upfrontFee != null) rows.push(['Fees', (t.managementFee != null ? t.managementFee + '%' : '–') + ' / ' + (t.carry != null ? t.carry + '%' : '–') + (t.upfrontFee ? ' · +' + t.upfrontFee + '% upfront' : '')]);
    });
    rows = rows.concat([['Share class', esc(o.shareClass || 'Not stated') + (o.preferredSeries ? ' · ' + esc(o.preferredSeries) : '')], ['Price includes fees', yn(o.priceInclusiveOfFees)], ['Client', esc(o.clientType || 'Not stated')], ['Mandate confirmed', yn(o.mandateConfirmed)]]);
    if (o.direction === 'SELL') rows.push(['Transfer restrictions', esc((o.transferRestrictions || []).join(', ') || 'Not stated')], ['Right of first refusal', esc(o.sellerRofr || 'Not stated')], ['Diligence available', esc(o.diligenceAvailable || 'Not stated')]);
    else rows.push(['Funds', esc(o.fundsOnHand || 'Not stated')], ['Investment committee approved', yn(o.icApproved)], ['Diligence required', esc(o.diligenceRequired || 'Not stated')]);
    rows.push(['Closing timeline', esc(o.closingTimeline || 'Not stated')], ['Live until', day(o.liveUntil)], ['Notes', esc(o.notes || '—')]);
    if (o.expireReason) rows.push(['Expired', esc(o.expireReason + (o.expireNote ? ' — ' + o.expireNote : ''))]);
    modal(o.company + ' · ' + (o.direction === 'BUY' ? 'Bid' : 'Offer'), kv(rows) +
      '<div class="sheet-section-title" style="margin-top:20px">History</div><div class="timeline">' + o.history.slice().reverse().map(function (h) { return '<div class="tl"><div class="when">' + day(h.at) + '</div><div class="what">' + esc(h.event) + '</div></div>'; }).join('') + '</div>');
  }
  function showMatches(id) {
    api('/orders/' + encodeURIComponent(id) + '/matches').then(function (b) {
      state.list = b.matches;
      modal('Orders matching your ' + (b.order.side === 'bid' ? 'bid' : 'offer') + ' · ' + b.order.company,
        (b.matches.length ? tableOrCards(orderTable(b.matches), b.matches.map(orderCard).join('')) : empty('No match yet', 'You will be notified when one appears.')) +
        '<p class="p-note">Open any order for its details and to ask for an introduction.</p>', null, true);
      $$('#modalOverlay [data-order]').forEach(function (el) { el.onclick = function (e) { e.preventDefault(); e.stopPropagation(); closeModal(); openOrder(el.getAttribute('data-order')); }; });
    }).catch(function (e) { toast(e.message, true); });
  }
  function expireDialog(o) {
    var m = modal('Expire the ' + o.company + ' order', '<div class="field"><label for="eR">Reason</label><select id="eR">' + ob.data.options.expireReasons.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select></div><div class="field"><label for="eN">Note (optional)</label><input type="text" id="eN" maxlength="400"></div>',
      '<button class="btn btn-ghost" type="button" id="eC">Cancel</button><button class="btn btn-primary" type="button" id="eG">Expire now</button>');
    $('#eC', m).onclick = closeModal;
    $('#eG', m).onclick = function () {
      api('/orders/' + o.id + '/expire', { method: 'POST', body: { reason: $('#eR', m).value, note: $('#eN', m).value } })
        .then(function (r) { closeModal(); toast(r.preview ? 'Preview: nothing was changed' : 'Order expired'); viewOrders(); }).catch(function (e) { toast(e.message, true); });
    };
  }
  function closedDialog(o) {
    var m = modal('Report a closed trade · ' + o.company,
      '<div class="frm"><div class="field"><label for="kP">Price per share</label><input type="text" id="kP" inputmode="decimal" placeholder="$0.00"></div>' +
      '<div class="field"><label for="kS">Size</label><input type="text" id="kS" inputmode="decimal" placeholder="$0"></div>' +
      '<div class="field"><label for="kT">Structure</label><select id="kT">' + ob.data.options.structures.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="kD">Closed on</label><input type="date" id="kD"></div>' +
      '<div class="field full"><label for="kN">Note (optional)</label><textarea id="kN" rows="3" maxlength="2000"></textarea></div></div>',
      '<button class="btn btn-ghost" type="button" id="kC">Cancel</button><button class="btn btn-primary" type="button" id="kG">Send to our desk</button>');
    $('#kC', m).onclick = closeModal;
    $('#kG', m).onclick = function () {
      api('/requests', { method: 'POST', body: { kind: 'closed_trade', myOrder: o.id, company: o.company, closedPrice: $('#kP', m).value, closedSize: $('#kS', m).value, closedStructure: $('#kT', m).value, closedOn: $('#kD', m).value, message: $('#kN', m).value } })
        .then(function (r) { closeModal(); toast(r.preview ? 'Preview: nothing was sent' : 'Sent to our desk'); viewOrders(); }).catch(function (e) { toast(e.message, true); });
    };
  }

  // The order form: Company and side → Terms → Client → Review (every Caplight order field).
  function wizard(existing, company) {
    var opt = (ob.data && ob.data.options) || null;
    if (!opt) return api('/orders').then(function (b) { ob.data = b; wizard(existing, company); }).catch(function (e) { toast(e.message, true); });
    var f = existing ? JSON.parse(JSON.stringify(existing)) : {
      direction: state.me.role === 'investor' || state.me.role === 'fund' ? 'BUY' : 'SELL', company: company || '', visibility: 'live',
      terms: [{ structure: 'Direct trade', priceBasis: 'gross', sizeUnit: 'usd' }], transferRestrictions: [], originationDate: new Date().toISOString().slice(0, 10),
    };
    var step = 0;
    var STEPS = ['Company', 'Terms', 'Client', 'Review'];
    var m = modal(existing ? 'Edit your order' : 'New order', '<div id="wz"></div>', '<button class="btn btn-ghost" type="button" id="wBack">Back</button><button class="btn btn-primary" type="button" id="wNext">Continue</button>', true);
    var val = function (id) { var el = $('#' + id, m); return el ? el.value : ''; };
    var yn = function (name, v) {
      return '<div class="p-opts">' + ['yes', 'no', ''].map(function (x) {
        var label = x === 'yes' ? 'Yes' : x === 'no' ? 'No' : 'Not sure';
        var on = (x === 'yes' && v === true) || (x === 'no' && v === false) || (x === '' && v == null);
        return '<label><input type="radio" name="' + name + '" value="' + x + '"' + (on ? ' checked' : '') + '>' + label + '</label>';
      }).join('') + '</div>';
    };
    var radioVal = function (name) { var el = m.querySelector('input[name="' + name + '"]:checked'); if (!el || el.value === '') return null; return el.value === 'yes'; };
    var choice = function (name, list, v) { return '<div class="p-opts">' + list.map(function (x) { return '<label><input type="radio" name="' + name + '" value="' + esc(x) + '"' + (v === x ? ' checked' : '') + '>' + esc(x) + '</label>'; }).join('') + '</div>'; };
    var choiceVal = function (name) { var el = m.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : null; };
    function termHtml(t, i) {
      var spv = /SPV/.test(t.structure || '');
      var field = function (label, k, ph, inputmode) { return '<div class="field"><label>' + label + '</label><input type="text" inputmode="' + (inputmode || 'decimal') + '" data-t="' + k + '" data-i="' + i + '" value="' + esc(t[k] != null ? t[k] : '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></div>'; };
      return '<div class="p-term"><div class="p-term-hd"><span class="eyebrow">Structure ' + (i + 1) + '</span>' + (i ? '<button class="btn-link" type="button" data-rmterm="' + i + '">Remove</button>' : '') + '</div><div class="frm">' +
        '<div class="field"><label>Structure</label><select data-t="structure" data-i="' + i + '">' + opt.structures.map(function (s) { return '<option' + (t.structure === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label>Price basis</label><select data-t="priceBasis" data-i="' + i + '"><option value="gross"' + (t.priceBasis !== 'net' ? ' selected' : '') + '>Gross</option><option value="net"' + (t.priceBasis === 'net' ? ' selected' : '') + '>Net</option></select></div>' +
        field('Price per share', 'pricePerShare', 'Leave empty for an indication of interest') + field('Valuation', 'valuation', 'For example $60B') +
        '<div class="field"><label>Size in</label><select data-t="sizeUnit" data-i="' + i + '"><option value="usd"' + (t.sizeUnit !== 'shares' ? ' selected' : '') + '>Dollar amount</option><option value="shares"' + (t.sizeUnit === 'shares' ? ' selected' : '') + '>Number of shares</option></select></div>' +
        field('Minimum', 'sizeMin') + field('Maximum', 'sizeMax') +
        (spv ? field('Management fee, %', 'managementFee') + field('Carry, %', 'carry') + field('Upfront fee, % (included in the price)', 'upfrontFee') : '') + '</div></div>';
    }
    function readTerms() { $$('[data-t]', m).forEach(function (el) { var i = Number(el.getAttribute('data-i')); f.terms[i] = f.terms[i] || {}; f.terms[i][el.getAttribute('data-t')] = el.value; }); }
    function read() {
      if (step === 0) { f.company = val('wCo'); f.direction = choiceVal('wDir') === 'Bid' ? 'BUY' : 'SELL'; f.visibility = choiceVal('wVis') === 'Private' ? 'darkpool' : 'live'; }
      else if (step === 1) {
        readTerms();
        f.shareClass = val('wCls') || null; f.preferredSeries = val('wSeries'); f.priceInclusiveOfFees = radioVal('wIncl');
        if (f.direction === 'SELL') { f.transferRestrictions = $$('input[name="wTR"]:checked', m).map(function (x) { return x.value; }); f.sellerRofr = choiceVal('wRofr'); f.approvedBuyersOnly = radioVal('wApproved'); }
      } else if (step === 2) {
        f.clientType = choiceVal('wClient'); f.mandateConfirmed = radioVal('wMandate'); f.previousClientTrade = radioVal('wPrev');
        if (f.direction === 'SELL') f.diligenceAvailable = choiceVal('wDA');
        else { f.fundsOnHand = choiceVal('wFunds'); f.icInvolved = radioVal('wIC'); f.icApproved = radioVal('wICA'); f.buyerOnCapTable = radioVal('wCap'); f.diligenceRequired = choiceVal('wDR'); }
        f.documentsOnHand = radioVal('wDocs'); f.recentClosedTrade = radioVal('wRecent'); f.closingTimeline = val('wTimeline'); f.originationDate = val('wOrig'); f.liveUntil = val('wUntil'); f.notes = val('wNotes');
      }
    }
    function draw(err) {
      var sell = f.direction === 'SELL';
      var html = '<div class="p-steps">' + STEPS.map(function (s, i) { return '<span class="' + (i === step ? 'on' : i < step ? 'done' : '') + '">' + (i + 1) + '. ' + s + '</span>'; }).join('') + '</div>';
      if (step === 0) {
        html += '<div class="frm"><div class="field full"><label for="wCo">Company</label><input type="text" id="wCo" list="wCoList" value="' + esc(f.company) + '" maxlength="120" placeholder="Start typing a company"><datalist id="wCoList"></datalist></div>' +
          '<div class="field"><label>Side</label>' + choice('wDir', ['Offer', 'Bid'], sell ? 'Offer' : 'Bid') + '</div>' +
          '<div class="field"><label>Visibility</label>' + choice('wVis', ['Book', 'Private'], f.visibility === 'darkpool' ? 'Private' : 'Book') + '<div class="hint">A private order is matched against the book but not shown in it.</div></div></div>';
      } else if (step === 1) {
        html += f.terms.map(termHtml).join('') + '<button class="btn btn-ghost btn-sm" type="button" id="wAddTerm">' + ICON.plus + 'Add another structure</button>' +
          '<div class="frm" style="margin-top:20px"><div class="field"><label for="wCls">Share class</label><select id="wCls"><option value="">Not stated</option>' + opt.shareClasses.map(function (s) { return '<option' + (f.shareClass === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="wSeries">Preferred series</label><input type="text" id="wSeries" maxlength="40" value="' + esc(f.preferredSeries || '') + '" placeholder="For example Series C"></div>' +
          '<div class="field"><label>The price includes fees</label>' + yn('wIncl', f.priceInclusiveOfFees) + '</div></div>' +
          (sell ? '<div class="field"><label>Which transfer restrictions apply to these shares?</label><div class="p-opts">' + opt.transferRestrictions.map(function (r) { return '<label><input type="checkbox" name="wTR" value="' + esc(r) + '"' + ((f.transferRestrictions || []).indexOf(r) >= 0 ? ' checked' : '') + '>' + esc(r) + '</label>'; }).join('') + '</div></div>' +
            '<div class="frm"><div class="field"><label>Right of first refusal</label>' + choice('wRofr', opt.yesNo, f.sellerRofr) + '</div><div class="field"><label>Approved buyers only</label>' + yn('wApproved', f.approvedBuyersOnly) + '</div></div>' : '');
      } else if (step === 2) {
        html += '<div class="field"><label>Who is the client?</label>' + choice('wClient', opt.clientTypes, f.clientType) + '</div>' +
          '<div class="frm"><div class="field"><label>The mandate is confirmed with the client</label>' + yn('wMandate', f.mandateConfirmed) + '</div><div class="field"><label>You have traded with this client before</label>' + yn('wPrev', f.previousClientTrade) + '</div></div>' +
          (sell ? '<div class="field"><label>Is diligence available to serious buyers?</label>' + choice('wDA', opt.yesNo, f.diligenceAvailable) + '</div>'
            : '<div class="field"><label>Does the client have the funds for this transaction?</label>' + choice('wFunds', opt.funds, f.fundsOnHand) + '</div>' +
              '<div class="frm"><div class="field"><label>An investment committee is involved</label>' + yn('wIC', f.icInvolved) + '</div><div class="field"><label>The investment committee approved</label>' + yn('wICA', f.icApproved) + '</div>' +
              '<div class="field"><label>The client is already on the cap table</label>' + yn('wCap', f.buyerOnCapTable) + '</div><div class="field"><label>Does the client require diligence?</label>' + choice('wDR', opt.yesNo, f.diligenceRequired) + '</div></div>') +
          '<div class="frm"><div class="field"><label>Transaction documents on hand</label>' + yn('wDocs', f.documentsOnHand) + '</div><div class="field"><label>You recently closed a trade in this company</label>' + yn('wRecent', f.recentClosedTrade) + '</div>' +
          '<div class="field"><label for="wTimeline">Closing timeline</label><input type="text" id="wTimeline" maxlength="60" value="' + esc(f.closingTimeline || '') + '" placeholder="For example within 30 days"></div>' +
          '<div class="field"><label for="wOrig">Origination date</label><input type="date" id="wOrig" value="' + esc(f.originationDate || '') + '"></div>' +
          '<div class="field"><label for="wUntil">Live until</label><input type="date" id="wUntil" value="' + esc(f.liveUntil || '') + '"><div class="hint">Empty — ' + opt.liveDays + ' days from today. You can renew it at any time.</div></div>' +
          '<div class="field full"><label for="wNotes">Notes for our desk</label><textarea id="wNotes" rows="3" maxlength="2000">' + esc(f.notes || '') + '</textarea></div></div>';
      } else {
        html += kv([['Company', esc(f.company)], ['Side', sell ? 'Offer' : 'Bid'], ['Visibility', f.visibility === 'darkpool' ? 'Private' : 'In the book']].concat(
          f.terms.map(function (t, i) {
            var amt = function (v) { var n = Number(String(v || '').replace(/[$,\s]/g, '')); return !n ? '' : t.sizeUnit === 'shares' ? num(n) + ' shares' : money(n); };
            var sizeTxt = [amt(t.sizeMin), amt(t.sizeMax)].filter(Boolean).join(' – ') || 'Size not stated';
            var priceN = Number(String(t.pricePerShare || '').replace(/[$,\s]/g, ''));
            return ['Structure ' + (i + 1), esc(t.structure) + ' · ' + (priceN ? px(priceN) + ' ' + esc(t.priceBasis || 'gross') : 'Unpriced') + ' · ' + sizeTxt];
          }),
          (function () {
            var y = function (v) { return v === true ? 'Yes' : v === false ? 'No' : 'Not sure'; };
            var rows = [['Share class', esc((f.shareClass || 'Not stated') + (f.preferredSeries ? ' · ' + f.preferredSeries : ''))], ['Price includes fees', y(f.priceInclusiveOfFees)]];
            if (sell) rows.push(['Transfer restrictions', esc((f.transferRestrictions || []).join(', ') || 'Not stated')], ['Right of first refusal', esc(f.sellerRofr || 'Not stated')], ['Approved buyers only', y(f.approvedBuyersOnly)]);
            rows.push(['Client', esc(f.clientType || 'Not stated')], ['Mandate confirmed', y(f.mandateConfirmed)], ['Traded with this client before', y(f.previousClientTrade)]);
            if (sell) rows.push(['Diligence available', esc(f.diligenceAvailable || 'Not stated')]);
            else rows.push(['Funds', esc(f.fundsOnHand || 'Not stated')], ['Investment committee', y(f.icInvolved) + ' · approved: ' + y(f.icApproved)], ['On the cap table', y(f.buyerOnCapTable)], ['Diligence required', esc(f.diligenceRequired || 'Not stated')]);
            rows.push(['Documents on hand', y(f.documentsOnHand)], ['Recent closed trade here', y(f.recentClosedTrade)], ['Closing timeline', esc(f.closingTimeline || 'Not stated')],
              ['Origination date', f.originationDate ? day(f.originationDate) : 'Not stated'], ['Live until', f.liveUntil ? day(f.liveUntil) : opt.liveDays + ' days'], ['Notes for our desk', esc(f.notes || '—')]);
            return rows;
          })())) +
          (!(f.terms[0] || {}).pricePerShare ? '<p class="p-note">This is an indication of interest without a price: it can receive introduction requests, and the price is agreed through our desk.</p>' : '') +
          '<p class="p-note">Our desk checks every order before it reaches the book; you see its status in My orders. The orders in our book that match it appear next to it at once.</p>';
      }
      if (err) html += '<div class="p-err">' + esc(err) + '</div>';
      $('#wz', m).innerHTML = html;
      $('#wBack', m).style.visibility = step ? 'visible' : 'hidden';
      $('#wNext', m).textContent = step === 3 ? (existing ? 'Save order' : 'Place order') : 'Continue';
      if (step === 0) api('/companies').then(function (b) { var dl = $('#wCoList', m); if (dl) dl.innerHTML = b.companies.map(function (c) { return '<option value="' + esc(c.company) + '">'; }).join(''); }).catch(function () {});
      var add = $('#wAddTerm', m);
      if (add) add.onclick = function () { readTerms(); f.terms.push({ structure: 'SPV', priceBasis: 'gross', sizeUnit: 'usd' }); draw(); };
      $$('[data-rmterm]', m).forEach(function (b) { b.onclick = function () { readTerms(); f.terms.splice(Number(b.getAttribute('data-rmterm')), 1); draw(); }; });
      $$('select[data-t="structure"]', m).forEach(function (s) { s.onchange = function () { readTerms(); draw(); }; });
    }
    function local() {
      if (step === 0 && (!f.company || !f.direction)) return 'Name the company and the side to continue.';
      if (step === 1) {
        if (!f.terms.length) return 'Add at least one structure to continue.';
        if (!f.terms.some(function (t) { return t.sizeMax || t.sizeMin; })) return 'Enter the size to continue.';
        if (f.direction === 'SELL' && f.terms.some(function (t) { return t.structure === 'Direct trade'; }) && !(f.transferRestrictions || []).length) return 'Say which transfer restrictions apply to these shares.';
      }
      if (step === 2 && !f.clientType) return 'Say who the client is to continue.';
      return null;
    }
    $('#wBack', m).onclick = function () { read(); step = Math.max(0, step - 1); draw(); };
    $('#wNext', m).onclick = function () {
      read();
      var er = local();
      if (er) return draw(er);
      if (step < 3) { step += 1; return draw(); }
      (existing ? api('/orders/' + existing.id, { method: 'PUT', body: f }) : api('/orders', { method: 'POST', body: f })).then(function (b) {
        closeModal();
        toast(b.preview ? 'Preview: the order was checked and not saved' : existing ? 'Order saved' : 'Order placed with our desk');
        if (state.section === 'deals' && state.page === 'orders') viewOrders(); else go('/deals/orders');
      }).catch(function (e) {
        var idx = { company: 0, terms: 1, client: 2 }[e.body && e.body.step];
        if (idx != null) step = idx;
        draw(e.message);
      });
    };
    draw();
  }

  // ── Deals: data rooms ───────────────────────────────────────────────
  function viewRooms() {
    controls('<span class="ctitle">Data rooms</span>');
    loading();
    api('/rooms').then(function (b) {
      main(subTabs() + (b.rooms.length ? '<div class="p-cardgrid">' + b.rooms.map(function (r) {
        return '<a href="' + esc(r.url) + '" target="_blank" rel="noopener"><span class="nm">' + esc(r.title) + '</span><div class="meta">' +
          [r.structure, r.minimum ? 'Minimum ' + (isFinite(Number(r.minimum)) ? money(Number(r.minimum)) : r.minimum) : null, r.closing ? 'Closing ' + day(r.closing) : null, r.ncnda ? 'NCNDA first' : null].filter(Boolean).map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div></a>';
      }).join('') + '</div>' : empty('No data rooms yet', 'Data rooms you are invited to open here, each with its NCNDA where one is required.')));
    }).catch(fail);
  }

  // ── Me ──────────────────────────────────────────────────────────────
  function viewNotifications() {
    controls('<span class="ctitle">Notifications</span><span class="spacer"></span><button class="btn btn-ghost btn-sm" type="button" id="nRead">Mark all as read</button>');
    loading();
    api('/notifications').then(function (b) {
      var list = b.notifications || [];
      main(subTabs() + (list.length ? '<div class="panel-card"><div class="pc-body flush"><ul class="p-notes">' + list.map(function (n) {
        return '<li class="' + (n.read_at ? '' : 'unread') + '"' + (n.link ? ' data-href="' + esc(n.link.replace(/^\/portal/, '')) + '"' : '') + '><span class="dot"></span><div><div class="t">' + esc(n.title) + '</div>' + (n.body ? '<div class="b">' + esc(n.body) + '</div>' : '') + '</div><span class="w">' + dayShort(n.created_at) + '</span></li>';
      }).join('') + '</ul></div></div>' : empty('Nothing new', 'New orders on the companies you follow, orders that match yours and answers from our desk appear here.')));
      $('#nRead').onclick = function () {
        api('/notifications/read', { method: 'POST' }).then(function () { state.me.unread = 0; $$('.p-notes li.unread').forEach(function (li) { li.classList.remove('unread'); }); toast('All read'); });
      };
    }).catch(fail);
  }
  function viewAccess() {
    var me = state.me;
    controls('<span class="ctitle">Access &amp; role</span><span class="spacer"></span><button class="btn btn-ghost btn-sm" type="button" id="xAsk">Write to us</button>');
    $('#xAsk').onclick = function () { askDialog(null); };
    main(subTabs() + '<div class="p-grid two"><div>' +
      panel('Your access', kv([
        ['Name', esc(me.name) + (me.firm ? ' · ' + esc(me.firm) : '')],
        ['Role', esc(me.roleLabel) + '<span class="p-note" style="display:block;margin:2px 0 0">Shapes the questions of the order form and how our associate works with you. It never opens or closes data.</span>'],
        ['Access level', '<b>' + esc(me.levelLabel) + '</b><span class="p-note" style="display:block;margin:2px 0 0">Set by Silicon Valley Investclub. It decides how deep the data goes.</span>'],
      ])) +
      panel('Access levels', levelsGrid(false)) +
      '<p class="p-note">To change your level, write to us — Silicon Valley Investclub decides.</p></div><div>' +
      panel('What your level opens', me.sections.map(function (s) {
        return '<div class="sheet-section-title" style="margin-top:8px">' + esc(s.label) + '</div>' + s.pages.map(function (p) {
          return '<div class="p-row">' + (p.open ? tag('active', 'Open') : tag('neutral', 'Not in your level')) + '<div class="g">' + esc(p.label) + '</div></div>';
        }).join('');
      }).join('')) + '</div></div>');
  }

  // ── router ──────────────────────────────────────────────────────────
  var VIEWS = {
    'market/market': viewMarket,
    'market/search': viewSearch,
    'market/picks': viewPicks,
    'deals/threads': viewThreads,
    'deals/orders': viewOrders,
    'deals/network': viewNetwork,
    'deals/documents': viewDocuments,
    'deals/rooms': viewRooms,
    'companies/companies': function () { viewCompanies(false); },
    'companies/watchlist': function () { viewCompanies(true); },
    'companies/company': function () { viewCompany(state.arg); },
    'me/notifications': viewNotifications,
    'me/access': viewAccess,
  };
  function render() {
    stopThreadLive();
    closeModal();
    if ($('#pOverlay').innerHTML && !new URLSearchParams(location.search).get('order')) closeSheet(true);
    parseRoute();
    var key = state.section + '/' + state.page;
    if (!sectionOf(state.section) || !VIEWS[key]) return go(firstOpen('market'), true);
    renderShell();
    if (!pageOpen(state.section, state.page)) return lockedView();
    window.scrollTo(0, 0);
    VIEWS[key]();
  }

  // Фото у каждого нового участника (Артур 2026-10-25, src/services/member-photo.js):
  // новый партнёр без фото видит в портале только этот шаг; камера на телефоне,
  // загрузка на компьютере. Сохранено — портал открывается как обычно.
  function photoStep() {
    var me = state.me;
    var P = window.SVICMemberPhoto;
    $('#pNav').innerHTML = '';
    $('#pCtx').textContent = 'Welcome';
    $('#pName').textContent = me.name || '';
    $('#pOut').setAttribute('href', BASE + '/logout');
    document.title = 'Welcome — Silicon Valley Investclub';
    controls('<span class="ctitle">Welcome</span>');
    main('<section class="p-photo">' +
      '<span class="eyebrow">One last step</span>' +
      '<h1 class="p-photo-h">Add your photo</h1>' +
      '<p class="p-photo-lead">Every member of the platform has a photo. It shows the Silicon Valley Investclub team who they are working with. A clear photo of your face, looking at the camera.</p>' +
      '<div class="p-photo-row"><div class="p-photo-face" id="phFace"><span id="phInit">' + esc(P ? P.initials(me.name) : '') + '</span><img id="phImg" alt="" hidden></div>' +
      '<div class="p-photo-acts"><button class="btn btn-ghost" id="phCam" type="button" hidden>Take a photo</button><button class="btn btn-ghost" id="phPick" type="button">Upload photo</button></div></div>' +
      '<input type="file" id="phCamFile" accept="image/*" capture="user" hidden><input type="file" id="phFile" accept="image/jpeg,image/png,image/webp" hidden>' +
      '<p class="p-photo-err" id="phErr" role="alert" hidden></p>' +
      '<div class="p-photo-foot"><button class="btn btn-primary" id="phNext" type="button" disabled>Continue</button></div>' +
      '</section>');
    var has = false;
    function labels() {
      var L = P ? P.labels(has) : { pick: has ? 'Change photo' : 'Upload photo', showCamera: false };
      $('#phPick').textContent = L.pick;
      $('#phCam').hidden = !L.showCamera;
      if (L.showCamera) $('#phCam').textContent = L.camera;
    }
    function fail(msg) { $('#phErr').textContent = msg || ''; $('#phErr').hidden = !msg; }
    function pick(e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f || !P) return;
      $('#phPick').disabled = $('#phCam').disabled = true;
      P.read(f, me.minPhotoSide).then(function (dataUrl) {
        return api('/photo', { method: 'PUT', body: { dataUrl: dataUrl } }).then(function () {
          has = true; fail('');
          $('#phImg').src = dataUrl; $('#phImg').hidden = false; $('#phInit').hidden = true;
          $('#phNext').disabled = false;
          labels();
        });
      }).catch(function (x) { fail(x.message); }).then(function () { $('#phPick').disabled = $('#phCam').disabled = false; });
    }
    labels();
    $('#phPick').onclick = function () { $('#phFile').click(); };
    $('#phCam').onclick = function () { $('#phCamFile').click(); };
    $('#phFile').onchange = pick;
    $('#phCamFile').onchange = pick;
    $('#phNext').onclick = function () { location.href = href(firstOpen('market')); };
  }

  var linkMatch = location.pathname.slice(BASE.length).match(/^\/link\/([A-Za-z0-9_-]{30,80})\/?$/);
  if (linkMatch) { linkMode(linkMatch[1]); return; }

  api('/me').then(function (me) {
    state.me = me;
    if (me.photoRequired) { photoStep(); return 'photo'; }
    if (!can('watchlist')) return null;
    return api('/watchlist').then(function (w) { state.watch = new Set((w.watchlist || []).map(function (x) { return x.company_key; })); });
  }).then(function (r) { if (r !== 'photo') render(); }).catch(function (e) {
    $('#pMain').innerHTML = '<div class="empty"><span class="serif">The portal could not load</span>' + esc(e.message) + '</div>';
  });
})();
