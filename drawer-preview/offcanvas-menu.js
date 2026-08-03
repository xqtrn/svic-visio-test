/**
 * Self-contained offcanvas navigation menu — the ONE platform menu.
 * Works in the parent SPA, in iframe pages, and embedded cross-origin in sibling
 * sub-apps on *.siliconvalleyinvestclub.com.
 *
 * IRON RULE: the menu CONTENT is never hardcoded here. This script is a pure
 * renderer; it fetches the role-filtered menu from <origin>/api/nav, whose single
 * source of truth is src/nav/registry.js. Add a section there → it appears here on
 * every page automatically. (Enforced by lint Step 0dz.)
 *
 * Usage: <script src="/offcanvas-menu.js"></script>  (loader.js injects it on every
 * page automatically, so a page can never "forget" the menu). Then call
 * openOffcanvas() from any hamburger button.
 */
(function() {
  'use strict';

  // Prevent double-init (loader.js injects this AND some pages include it explicitly)
  if (window.__offcanvasMenuInitialized) return;
  window.__offcanvasMenuInitialized = true;

  // Origin that served THIS script — so an embedding sub-app fetches the canonical
  // /api/nav (and shares the .siliconvalleyinvestclub.com cookie). Same-origin pages
  // resolve to '' (location.origin), unchanged behaviour.
  var API_BASE = '';
  try {
    if (document.currentScript && document.currentScript.src) {
      var o = new URL(document.currentScript.src).origin;
      if (o !== window.location.origin) API_BASE = o;
    }
  } catch (e) {}

  // ── Inject CSS (only once) ──
  function injectStyles() {
    if (document.getElementById('offcanvas-menu-styles')) return;
    var style = document.createElement('style');
    style.id = 'offcanvas-menu-styles';
    style.textContent = [
      // Канон §Navigation «Drawer anatomy» (брендбук, раздел Components):
      // navy-шапка с 2px акцентной линией, список 14px из токенов, активный пункт
      // несёт accent-текст + accent-soft заливку + 2px левое ребро, футер — имя
      // серифом, роль капсом, выход иконкой. Токены через var(...,fallback):
      // на страницах платформы приходят живые (и тёмная тема работает сама),
      // во встроенном виде без app.css держат fallback'и.
      '.oc-overlay { display:none; position:fixed; inset:0; background:rgba(10,23,51,.45); z-index:var(--z-scrim,4000); }',
      '.oc-overlay.open { display:block; }',
      '.oc-panel { position:fixed; top:0; left:-320px; width:320px; height:100%; background:var(--panel,#fff); z-index:var(--z-drawer,4001); display:flex; flex-direction:column; transition:transform var(--t-slow,250ms) ease; border-right:1px solid var(--line,#e6eaf1); }',
      '.oc-panel.open { transform:translate3d(320px,0,0); }',
      '.oc-panel:focus { outline:none; }',
      // Шапка — navy + санкционированная 2px акцентная полоса (единственный
      // акцентный «декор» канона; яркая синяя заливка была отступлением).
      '.oc-hdr { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 18px; background:var(--navy,#0a1733); border-bottom:2px solid var(--accent,#0a64bc); min-height:56px; flex-shrink:0; }',
      '.oc-logo { display:flex; align-items:center; }',
      '.oc-logo img { display:block; height:21px; width:auto; filter:brightness(0) invert(1); }',
      // Крестик — квадрат 32×32 по таблице «Menu trigger & close button».
      '.oc-close { box-sizing:border-box; width:32px; height:32px; padding:0; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--on-navy-muted,#8c98b0); background:none; border:1px solid rgba(255,255,255,.18); border-radius:var(--r-control,4px); transition:var(--t-med,180ms); flex-shrink:0; }',
      '.oc-close:hover { color:#fff; border-color:rgba(255,255,255,.45); }',
      '.oc-close:focus-visible { outline:2px solid var(--accent,#0a64bc); outline-offset:2px; box-shadow:0 0 0 3px var(--accent-soft,#eef4fb); }',
      '.oc-body { flex:1; overflow-x:hidden; overflow-y:auto; padding:10px 0; }',
      '.oc-group { font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.14em; color:var(--muted-2,#67738a); padding:8px 18px 6px; margin:8px 0 0; }',
      '.oc-list { list-style:none; padding:0; margin:0; }',
      // Разделителей между пунктами канон не несёт — структуру держат группы.
      '.oc-link { box-sizing:border-box; display:block; padding:9px 18px; color:var(--ink,#0c1626); text-decoration:none; font-family:var(--sans,"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif); font-size:14px; font-weight:400; line-height:1.5; transition:var(--t-fast,150ms); border:none; border-left:2px solid transparent; background:none; cursor:pointer; width:100%; text-align:left; }',
      '.oc-link:hover { background:var(--subtle,#f7f9fc); color:var(--accent,#0a64bc); }',
      '.oc-link.active { color:var(--accent,#0a64bc); font-weight:500; background:var(--accent-soft,#eef4fb); border-left-color:var(--accent,#0a64bc); }',
      '.oc-link:focus-visible { outline:2px solid var(--accent,#0a64bc); outline-offset:-2px; }',
      '.oc-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:13px 18px; border-top:1px solid var(--line,#e6eaf1); flex-shrink:0; }',
      '.oc-user { font-family:var(--serif,Georgia,serif); font-weight:600; color:var(--ink,#0c1626); font-size:15px; }',
      '.oc-role { color:var(--muted-2,#67738a); font-size:10.5px; text-transform:uppercase; letter-spacing:.12em; margin-top:2px; }',
      // Выход — иконочная кнопка (.iconbtn канона), не полноширинная плашка.
      '.oc-logout { box-sizing:border-box; width:30px; height:30px; padding:0; display:flex; align-items:center; justify-content:center; background:none; border:1px solid transparent; border-radius:var(--r-control,4px); color:var(--muted-2,#67738a); cursor:pointer; transition:var(--t-med,180ms); flex-shrink:0; }',
      '.oc-logout:hover { color:var(--bad,#a32a30); background:var(--bad-soft,#f7ebec); }',
      '.oc-logout:focus-visible { outline:2px solid var(--accent,#0a64bc); outline-offset:2px; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Inject HTML ──
  function injectHTML() {
    if (document.getElementById('oc-overlay')) return;

    var overlay = document.createElement('div');
    overlay.id = 'oc-overlay';
    overlay.className = 'oc-overlay';
    overlay.onclick = closeOffcanvas;

    var panel = document.createElement('div');
    panel.id = 'oc-panel';
    panel.className = 'oc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Navigation');
    // Фокус входит в ПАНЕЛЬ, а не на крестик (канон «drawer — true dialog»):
    // иначе закрытие показывает кольцо фокуса в покое.
    panel.setAttribute('tabindex', '-1');
    panel.innerHTML = [
      '<div class="oc-hdr">',
      // Реверсивный знак бренда — тот же SVG, что в шапке (канон §Navigation).
      '  <div class="oc-logo"><img src="' + API_BASE + '/brandbook-logo.svg" alt="Silicon Valley Investclub"></div>',
      // ICON.x канона: 20×20, stroke 2, круглые концы.
      '  <button class="oc-close" id="oc-close-btn" aria-label="Close">',
      '    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
      '  </button>',
      '</div>',
      '<div class="oc-body"><div id="oc-menu-list"></div></div>',
      '<div class="oc-footer">',
      '  <div id="oc-user-info"></div>',
      '  <button class="oc-logout" id="oc-logout-btn" aria-label="Sign out" title="Sign out">',
      '    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>',
      '  </button>',
      '</div>'
    ].join('');

    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    document.getElementById('oc-close-btn').onclick = closeOffcanvas;
    document.getElementById('oc-logout-btn').onclick = function() {
      fetch(API_BASE + '/api/auth/logout', { method: 'POST', credentials: 'include' }).then(function() {
        window.top.location.href = (API_BASE || '') + '/login';
      });
    };
  }

  function makeLink(it) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.className = 'oc-link';
    var href = it.external ? it.href : (API_BASE + it.href);
    a.setAttribute('href', href);
    if (it.id) a.setAttribute('data-tab', it.id);
    a.textContent = it.label;
    li.appendChild(a);
    return li;
  }

  // Активный пункт — по САМОМУ ДЛИННОМУ совпавшему префиксу пути (канон
  // §Navigation). Точное сравнение оставляло раздел неподсвеченным на любом
  // внутреннем экране: /siteadmin/posts не равен /siteadmin.
  // Второй проход — по первому сегменту: маршруты реестра бывают сами вложенными
  // (Messenger Desk = /messengers/SMS), и на соседнем экране того же раздела
  // (/messengers/WhatsApp) префикс не совпадает, а раздел тот же. Хвост #... в
  // маршруте (Outreach Inbox = /sourcing#inbox) в pathname не приходит и снимается.
  function markActive(container) {
    if (API_BASE) return; // встроенное меню чужого origin — активного нет
    var norm = function(s) { return String(s || '').split('#')[0].split('?')[0].replace(/\/+$/, '') || '/'; };
    var seg1 = function(s) { var m = norm(s).match(/^\/[^/]*/); return m ? m[0] : '/'; };
    var path = norm(window.location.pathname);
    var best = null, bestLen = -1, segBest = null, segBestLen = -1;
    container.querySelectorAll('.oc-link').forEach(function(el) {
      var href = norm(el.getAttribute('href'));
      if (href === '/' ? path === '/' : (path === href || path.indexOf(href + '/') === 0)) {
        if (href.length > bestLen) { best = el; bestLen = href.length; }
      } else if (href !== '/' && seg1(href) === seg1(path)) {
        if (href.length > segBestLen) { segBest = el; segBestLen = href.length; }
      }
    });
    if (!best) best = segBest;
    if (best) best.classList.add('active');
  }

  // ── Render menu from /api/nav payload ──
  var menuBuilt = false;
  function renderMenu(data) {
    if (menuBuilt) return;
    menuBuilt = true;
    var container = document.getElementById('oc-menu-list');
    if (!container) return;
    container.textContent = '';

    var menu = (data && data.menu) || { pinned: [], groups: [] };

    if (menu.pinned && menu.pinned.length) {
      var pul = document.createElement('ul');
      pul.className = 'oc-list';
      menu.pinned.forEach(function(it) { pul.appendChild(makeLink(it)); });
      container.appendChild(pul);
    }
    (menu.groups || []).forEach(function(g) {
      var lab = document.createElement('div');
      lab.className = 'oc-group';
      lab.textContent = g.label;
      container.appendChild(lab);
      var ul = document.createElement('ul');
      ul.className = 'oc-list';
      g.items.forEach(function(it) { ul.appendChild(makeLink(it)); });
      container.appendChild(ul);
    });

    markActive(container);

    // Click handler: navigate the TOP window (exits iframe context).
    // Cmd/Ctrl/Shift-click and middle-click → let the browser open a new tab.
    container.querySelectorAll('.oc-link').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        closeOffcanvas();
        window.top.location.href = el.getAttribute('href');
      });
    });

    // User info — textContent prevents XSS via a crafted display_name.
    var userInfo = document.getElementById('oc-user-info');
    var user = (data && data.user) || {};
    if (userInfo && user.name) {
      userInfo.textContent = '';
      var nameDiv = document.createElement('div');
      nameDiv.className = 'oc-user';
      nameDiv.textContent = user.name;
      var roleDiv = document.createElement('div');
      roleDiv.className = 'oc-role';
      roleDiv.textContent = user.role || '';
      userInfo.appendChild(nameDiv);
      userInfo.appendChild(roleDiv);
    }
  }

  // Public escape helper for inline code on iframe pages that build HTML strings.
  window.svicEscapeHtml = function(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // ── Fetch the role-filtered menu on first open ──
  var menuFetched = false;
  function ensureMenu() {
    if (menuFetched) return;
    menuFetched = true;
    fetch(API_BASE + '/api/nav', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) { renderMenu(data); })
      .catch(function() { renderMenu({ menu: { pinned: [], groups: [] }, user: {} }); });
  }

  // ── Public API ──
  var ocTrigger = null;
  function openOffcanvas() {
    injectStyles();
    injectHTML();
    ensureMenu();
    var ae = document.activeElement;
    if (ae && ae !== document.body && ae !== document.documentElement) ocTrigger = ae;
    var panel = document.getElementById('oc-panel');
    var overlay = document.getElementById('oc-overlay');
    if (panel) panel.classList.add('open');
    if (overlay) overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (ocTrigger && ocTrigger.setAttribute) ocTrigger.setAttribute('aria-expanded', 'true');
    // Фокус — в панель (канон): крестик не должен светиться кольцом в покое.
    if (panel && panel.focus) { try { panel.focus({ preventScroll: true }); } catch (e) { panel.focus(); } }
  }

  function closeOffcanvas() {
    var panel = document.getElementById('oc-panel');
    var overlay = document.getElementById('oc-overlay');
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
    if (ocTrigger) {
      if (ocTrigger.setAttribute) ocTrigger.setAttribute('aria-expanded', 'false');
      if (ocTrigger.focus) { try { ocTrigger.focus(); } catch (e) {} }
    }
  }

  // Esc closes the open menu (doc §05 keyboard contract)
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    var panel = document.getElementById('oc-panel');
    if (panel && panel.classList.contains('open')) closeOffcanvas();
  });

  // ── Expose globally ──
  window.openOffcanvas = openOffcanvas;
  window.closeOffcanvas = closeOffcanvas;
  window.mpOpenMenu = openOffcanvas; // iframe pages

  // Legacy postMessage support
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'open-offcanvas') openOffcanvas();
  });
})();
