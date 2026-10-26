/* loader.js — canonical top-line preloader + pre-paint theme init (design
 * system v2.2, §Layout contract). IRON RULE R-11: included on EVERY page of
 * every SVIC property, no exceptions. Self-contained, no dependencies; loaded
 * synchronously in <head> so the theme lands before first paint.
 *
 * Theme: on pages marked <html data-theme-auto> (token-complete pages),
 * localStorage 'svic-theme' wins, else prefers-color-scheme; set at eval,
 * follows OS changes until a manual choice. Legacy pages stay light.
 * ui.js setTheme/toggleTheme write the same key.
 *
 * Visual = a 2px accent line as the top bar's own bottom edge (its ::after,
 * driven by --page-progress); a fixed standalone bar (#ds-loader) only on pages
 * without a top bar. 2026-09-08: the standalone bar pinned at the bar's bottom
 * coordinate cut through the bar during trackpad rubber-band scrolling — the
 * sticky bar moves with the page, a fixed element does not. Arthur 2026-08-26:
 * the accent line over the navy bar was invisible at 2px and reported missing
 * four times — below the bar it is contrast-correct by construction. Pages
 * without a .topbar keep the line at the very top. Escape hatch: an element
 * marked [data-progress-host] hosts the line on its own ::after instead
 * (driven by --page-progress) — rare.
 * Timings per spec: 8% at parse → 38% @140ms → 72% at DOMContentLoaded →
 * 100% at load → opacity fade 480ms (never a visible rewind); instant under
 * prefers-reduced-motion.
 *
 * Programmatic milestones (fetch flows): window.dsLoaderSet(0..100) and
 * window.dsLoaderDone(). ui.js setProgress/startProgress/doneProgress delegate.
 */
(function () {
  if (window.__dsLoaderInit) return;
  window.__dsLoaderInit = true;

  /* Presentation strip (2026-09-28). While the `svic_present` cookie is set
   * (GET /present/start … /present/stop; the server decides what is sample,
   * src/services/trade-desk/presentation.js), every platform page carries one
   * thin bar ABOVE the top bar: «Presentation · sample counterparties, live
   * prices» and «End presentation». It is in the page flow and sticky at the
   * very top; the top bar sticks under it, and --topbar-h grows by the strip so
   * every offset built on it (sheets, sticky heads, full-height panes) moves
   * with it — nothing overlaps. Top-level documents only (no iframes). */
  try {
    if (window.top === window && /(?:^|;\s*)svic_present=1(?:;|$)/.test(String(document.cookie || ''))) {
      var presentRoot = document.documentElement;
      presentRoot.classList.add('svic-presenting');
      var presentCss = document.createElement('style');
      presentCss.id = 'svic-present-css';
      presentCss.textContent =
        'html.svic-presenting{--present-h:28px;--topbar-h:90px}' +
        'html.svic-presenting .topbar{top:var(--present-h)}' +
        'html.svic-presenting .topbar-in{height:calc(var(--topbar-h) - var(--present-h))}' +
        '.svic-present{position:sticky;top:0;z-index:calc(var(--z-topbar,1000) + 1);box-sizing:border-box;height:var(--present-h,28px);' +
          'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 26px;margin:0;' +
          'background:var(--navy-2,#13233f);color:var(--on-navy,#cdd6e6);border-bottom:1px solid rgba(205,214,230,.14);' +
          'font:600 12px/1 var(--sans,Inter,-apple-system,BlinkMacSystemFont,sans-serif);letter-spacing:.1em;text-transform:uppercase}' +
        '.svic-present-l{display:flex;align-items:center;gap:8px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.svic-present-l i{flex:none;width:6px;height:6px;border-radius:50%;background:var(--accent,#0a64bc)}' +
        '.svic-present-l span{color:var(--on-navy-muted,#8c98b0)}' +
        '.svic-present-x{flex:none;display:inline-flex;align-items:center;height:20px;padding:0 10px;border:1px solid rgba(205,214,230,.42);' +
          'border-radius:var(--r-control,4px);color:var(--on-navy,#cdd6e6);text-decoration:none;font:inherit;letter-spacing:.1em;cursor:pointer}' +
        '.svic-present-x:hover{background:rgba(205,214,230,.1)}' +
        '.svic-present-x:focus-visible{outline:2px solid var(--accent,#0a64bc);outline-offset:1px}' +
        '@media (max-width:640px){.svic-present{padding:0 16px}.svic-present-l span{display:none}}' +
        '@media print{.svic-present{display:none}}';
      (document.head || presentRoot).appendChild(presentCss);
      var presentMount = function () {
        if (!document.body || document.getElementById('svicPresent')) return !!document.body;
        var strip = document.createElement('div');
        strip.id = 'svicPresent';
        strip.className = 'svic-present';
        strip.setAttribute('role', 'region');
        strip.setAttribute('aria-label', 'Presentation mode');
        strip.innerHTML = '<div class="svic-present-l"><i aria-hidden="true"></i>Presentation<span>&nbsp;· sample counterparties, live prices</span></div>' +
          '<a class="svic-present-x" href="/present/stop">End presentation</a>';
        document.body.insertBefore(strip, document.body.firstChild);
        return true;
      };
      /* Tour prompter (2026-10-09, public/tour-prompter.js). A presented page
       * names its screen on the 'svic-tour' channel whenever it is the visible
       * tab, so the prompter window shows the line for that screen by itself.
       * The tab Start tour opened (window.name svicTourDesk) also ends itself:
       * «End presentation» or «End tour» in the prompter clears the mode and
       * closes this tab instead of loading the call card into it. */
      if (typeof BroadcastChannel === 'function') {
        var tourBc = new BroadcastChannel('svic-tour');
        var tourTab = window.name === 'svicTourDesk';
        var tourSay = function () {
          if (document.visibilityState === 'hidden') return;
          try { tourBc.postMessage({ type: 'screen', path: location.pathname, search: location.search, tour: tourTab }); } catch (e) {}
        };
        var tourEnd = function (notify) {
          if (notify) { try { tourBc.postMessage({ type: 'ended' }); } catch (e) {} }
          var leave = function () { try { window.close(); } catch (e) {} setTimeout(function () { location.href = '/present/stop'; }, 400); };
          try { fetch('/present/stop', { credentials: 'same-origin', redirect: 'manual' }).then(leave, leave); } catch (e) { leave(); }
        };
        tourBc.onmessage = function (e) {
          var m = (e && e.data) || {};
          if (m.type === 'where') tourSay();
          else if (m.type === 'end' && tourTab) tourEnd(false);
        };
        document.addEventListener('visibilitychange', tourSay);
        window.addEventListener('pageshow', tourSay);
        window.addEventListener('popstate', tourSay);
        ['pushState', 'replaceState'].forEach(function (k) {
          var orig = history[k];
          if (typeof orig !== 'function') return;
          history[k] = function () { var r = orig.apply(this, arguments); setTimeout(tourSay, 0); return r; };
        });
        if (tourTab) {
          document.addEventListener('click', function (e) {
            var a = e.target && e.target.closest ? e.target.closest('.svic-present-x') : null;
            if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            tourEnd(true);
          });
        }
        tourSay();
      }
      if (!presentMount()) {
        // Mount the moment <body> exists, before the first paint where we can.
        var presentObs = typeof MutationObserver === 'function' ? new MutationObserver(function () {
          if (presentMount()) presentObs.disconnect();
        }) : null;
        if (presentObs) presentObs.observe(presentRoot, { childList: true });
        document.addEventListener('DOMContentLoaded', function () { presentMount(); if (presentObs) presentObs.disconnect(); });
      }
    }
  } catch (e) {}

  /* Test candidate strip (Arthur 2026-10-25, src/services/auth/qa-test-session.js).
   * A reviewer who opened a test candidate's link sees the platform AS that
   * test candidate; his own session is set aside, never replaced. While the
   * page-readable `svic_qa_test` cookie is set (the server keeps it in step
   * with the session itself), every platform page carries one thin strip
   * above the top bar — «Test candidate» and «Back to my account», which
   * restores the reviewer's own session in one click (or, with none saved,
   * closes the test session and opens sign-in). Same geometry as the
   * presentation strip; top-level documents only. */
  try {
    var qaMatch = /(?:^|;\s*)svic_qa_test=([rs])(?:;|$)/.exec(String(document.cookie || ''));
    if (window.top === window && qaMatch && !document.documentElement.classList.contains('svic-presenting')) {
      var qaRoot = document.documentElement;
      qaRoot.classList.add('svic-qa-testing');
      var qaCss = document.createElement('style');
      qaCss.id = 'svic-qatest-css';
      qaCss.textContent =
        // scroll-padding: anything scrolled into view (focus, anchors, a control
        // brought up from below) stops under the strip, never behind it.
        'html.svic-qa-testing{--present-h:28px;--topbar-h:90px;scroll-padding-top:var(--present-h)}' +
        'html.svic-qa-testing:has(.topbar){scroll-padding-top:var(--topbar-h)}' +
        'html.svic-qa-testing .topbar{top:var(--present-h)}' +
        'html.svic-qa-testing .topbar-in{height:calc(var(--topbar-h) - var(--present-h))}' +
        // A test candidate on the candidate-preview screens: the Preview strip (mounted later,
        // first in the page) stays on top, this strip sits under it, the top bar under both.
        'html.svic-qa-testing.svic-candidate{--topbar-h:118px}' +
        'html.svic-qa-testing.svic-candidate .svic-qatest{top:28px}' +
        'html.svic-qa-testing.svic-candidate .topbar{top:56px}' +
        'html.svic-qa-testing.svic-candidate .topbar-in{height:calc(var(--topbar-h) - 56px)}' +
        '.svic-qatest{position:sticky;top:0;z-index:calc(var(--z-topbar,1000) + 1);box-sizing:border-box;height:var(--present-h,28px);' +
          'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 26px;margin:0;' +
          'background:var(--navy-2,#13233f);color:var(--on-navy,#cdd6e6);border-bottom:1px solid rgba(205,214,230,.14);' +
          'font:600 12px/1 var(--sans,Inter,-apple-system,BlinkMacSystemFont,sans-serif);letter-spacing:.1em;text-transform:uppercase}' +
        '.svic-qatest-l{display:flex;align-items:center;gap:8px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.svic-qatest-l i{flex:none;width:6px;height:6px;border-radius:50%;background:var(--warn,currentColor)}' +
        '.svic-qatest-l span{color:var(--on-navy-muted,#8c98b0)}' +
        '.svic-qatest-x{flex:none;display:inline-flex;align-items:center;height:20px;padding:0 10px;border:1px solid rgba(205,214,230,.42);' +
          'border-radius:var(--r-control,4px);color:var(--on-navy,#cdd6e6);text-decoration:none;font:inherit;letter-spacing:.1em;cursor:pointer}' +
        '.svic-qatest-x:hover{background:rgba(205,214,230,.1)}' +
        '.svic-qatest-x:focus-visible{outline:2px solid var(--accent,#0a64bc);outline-offset:1px}' +
        '@media (max-width:640px){.svic-qatest{padding:0 16px}.svic-qatest-l span{display:none}}' +
        '@media print{.svic-qatest{display:none}}';
      (document.head || qaRoot).appendChild(qaCss);
      var qaMount = function () {
        if (!document.body || document.getElementById('svicQaTest')) return !!document.body;
        var strip = document.createElement('div');
        strip.id = 'svicQaTest';
        strip.className = 'svic-qatest';
        strip.setAttribute('role', 'region');
        strip.setAttribute('aria-label', 'Test candidate session');
        // Never sealed by the candidate lens: it is the way out, not a value.
        strip.setAttribute('data-open', '');
        strip.innerHTML = '<div class="svic-qatest-l"><i aria-hidden="true"></i>Test candidate<span>&nbsp;· you see the platform as the test candidate</span></div>' +
          '<a class="svic-qatest-x" id="svicQaBack" href="/auth/qa-test-back" title="' +
          (qaMatch[1] === 'r' ? 'Return to your own session' : 'Close the test session and sign in as yourself') + '">Back to my account</a>';
        document.body.insertBefore(strip, document.body.firstChild);
        return true;
      };
      if (!qaMount()) {
        var qaObs = typeof MutationObserver === 'function' ? new MutationObserver(function () {
          if (qaMount()) qaObs.disconnect();
        }) : null;
        if (qaObs) qaObs.observe(qaRoot, { childList: true });
        document.addEventListener('DOMContentLoaded', function () { qaMount(); if (qaObs) qaObs.disconnect(); });
      }
    }
  } catch (e) {}

  /* Candidate mode (2026-10-19/20, src/services/trade-desk/presentation.js).
   * A broker candidate holding the `candidatepreview` grant has Marketplace,
   * Matches, Order Book, Pipeline and Clients. The firm's book — Marketplace,
   * Matches, Order Book — answers him the live book with every partner field a
   * placeholder (the server sets the page-readable `svic_candidate` cookie);
   * Pipeline and Clients are his own sections and are never sealed. On the three
   * book screens the deal's own terms stay in clear — the page marks them
   * [data-open], partner data inside them [data-sealed] — and every other value
   * is sealed (.ds-sealed, app.css: blurred, not selectable); every control that
   * would create or change a deal is locked (.ds-locked); hover or focus says
   * when it opens; labels, headings, buttons and navigation stay readable.
   * Fail-closed: any text that is neither a label nor marked open is a value.
   * One thin strip above the top bar says the same in one line. */
  try {
    var cpScreens = /^\/(desk\/(matches|order-book)(\/|$)|marketplaceadmin(\.html)?\/?$)/;
    if (window.top === window && /(?:^|;\s*)svic_candidate=1(?:;|$)/.test(String(document.cookie || '')) && cpScreens.test(location.pathname)) {
      var cpRoot = document.documentElement;
      var CP_SAY = 'Opens once you are registered with Finalis and have passed your FINRA exams.';
      cpRoot.classList.add('svic-candidate');
      var cpCss = document.createElement('style');
      cpCss.id = 'svic-candidate-css';
      cpCss.textContent =
        'html.svic-candidate{--present-h:28px;--topbar-h:90px}' +
        'html.svic-candidate .topbar{top:var(--present-h)}' +
        'html.svic-candidate .topbar-in{height:calc(var(--topbar-h) - var(--present-h))}' +
        '.svic-preview{position:sticky;top:0;z-index:calc(var(--z-topbar,1000) + 1);box-sizing:border-box;height:var(--present-h,28px);' +
          'display:flex;align-items:center;gap:10px;padding:0 26px;margin:0;' +
          'background:var(--navy-2,#13233f);color:var(--on-navy,#cdd6e6);border-bottom:1px solid rgba(205,214,230,.14);' +
          'font:500 12px/1 var(--sans,Inter,-apple-system,BlinkMacSystemFont,sans-serif);white-space:nowrap;overflow:hidden}' +
        '.svic-preview b{flex:none;display:flex;align-items:center;gap:8px;font-weight:600;letter-spacing:.1em;text-transform:uppercase}' +
        '.svic-preview b i{width:6px;height:6px;border-radius:50%;background:var(--accent,#0a64bc)}' +
        '.svic-preview span{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--on-navy-muted,#8c98b0)}' +
        '.svic-preview .s{display:none}' +
        '@media (max-width:640px){.svic-preview{padding:0 16px}.svic-preview .l{display:none}.svic-preview .s{display:inline}}' +
        '@media print{.svic-preview{display:none}}';
      (document.head || cpRoot).appendChild(cpCss);

      // Labels stay readable; everything else that carries text is a value.
      var CP_READABLE = 'h1,h2,h3,h4,h5,h6,th,thead,label,legend,select,option,textarea,input,nav,' +
        // the deal's own terms (2026-10-20, «всё, кроме данных партнёров»): the page marks them
        // [data-open]; partner data inside such an area carries [data-sealed] and stays a value
        '[data-open],.td-asked,dt,.td-claim-hd .copy,' +
        '.topbar,#svicPreview,#sealedTip,#oc-panel,#oc-overlay,.oc-panel,[role="tab"],[role="tablist"],' +
        // the associate's own path strip under the top bar is his, not the firm's book (rehearsal 2026-10-23)
        '#yourPath,.path-strip,' +
        '[role="menu"],[role="menuitem"],[role="navigation"],.btn,.iconbtn,.eyebrow,.tabs,.tab,.seg,.skeleton,#toast,' +
        '.toast,[data-readable],script,style,noscript,template,title,' +
        // design-system labels: type scale headings, stat and section labels, page descriptions, hints, empty states
        '.t-h1,.t-h2,.t-h3,.stat .l,.sec-label,.hero p,.page-head p,.hint,.empty,.wl-sub,.ac-h,.ac-d,.col-head,' +
        // Trade Desk: channel and day labels of a conversation, the composer note; Pipeline: column names, field labels
        '.nr-chan,.nr-day,.td-composer-row .to,.p-col-label,.p-col-empty,.p-col-sum span,.p-card-meta strong,.p-rail-txt b,' +
        // Marketplace: the company panel's waiting line; the deal sheet's field and section labels
        '.cpanel-wait,.sheet-stat .k,.dd-stat .k,.dd-section-title,.dd-label,.dd-link,.calc,.mobile-field-label,.mobile-price-label';
      // A button is a label when it says one thing («Open», «Take the deal»);
      // a button that carries a record (a list row drawn as a button) is data.
      var cpOneText = function (el) {
        var seen = 0, w = document.createTreeWalker(el, 4, null);
        for (var t = w.nextNode(); t; t = w.nextNode()) if (/\S/.test(t.nodeValue || '') && ++seen > 1) return false;
        return true;
      };
      var cpTip = null;
      var CP_HTML = 'http://www.w3.org/1999/xhtml';
      var CP_MEDIA = { IMG: 1, IFRAME: 1, VIDEO: 1, CANVAS: 1 };
      var cpSeal = function (el) {
        if (!el || !el.classList || el.classList.contains('ds-sealed')) return;
        el.classList.add('ds-sealed');
        if (el.namespaceURI === CP_HTML && !el.hasAttribute('tabindex') && el.tagName !== 'A') el.setAttribute('tabindex', '0');
        el.setAttribute('aria-describedby', 'sealedTip');
        if (el.hasAttribute('title')) { el.setAttribute('data-sealed-title', ''); el.removeAttribute('title'); }
      };
      var CP_LABEL = 'dt,label,th,legend,.dd-label,.k,.mobile-field-label,.eyebrow';
      var cpSkip = function (el) {
        if (!el || !el.closest) return true;
        if (el.closest('.ds-sealed')) return true;
        // Partner data inside an open area ([data-sealed]) is a value again; only its label reads.
        var area = el.closest('[data-sealed]');
        if (area) { var lbl = el.closest(CP_LABEL); return !!(lbl && area.contains(lbl)); }
        if (el.closest(CP_READABLE)) return true;
        var b = el.closest('button,[role="button"]');
        return !!b && cpOneText(b);
      };
      // A count inside a label («Available (48)», a tab «Offers 120») is a value.
      var CP_COUNTS = '.eyebrow,[role="tab"],.tab,.seg,th,button,.btn,.stat .l';
      var CP_NEVER = '[data-open],.ds-sealed,.topbar,#svicPreview,#sealedTip,#oc-panel,#yourPath,.path-strip,nav,select,option,input,textarea,script,style';
      var cpCounts = function (node) {
        var v = node.nodeValue || '', p = node.parentElement;
        if (!/\d/.test(v) || !p || !p.closest(CP_COUNTS) || p.closest(CP_NEVER)) return;
        var frag = document.createDocumentFragment();
        v.split(/(\d[\d,.]*)/).forEach(function (part, i) {
          if (!part) return;
          if (i % 2) { var sp = document.createElement('span'); sp.textContent = part; cpSeal(sp); frag.appendChild(sp); }
          else frag.appendChild(document.createTextNode(part));
        });
        p.replaceChild(frag, node);
      };
      var cpText = function (node) {
        var parent = node.parentElement;
        if (!parent || parent === document.body || parent === cpRoot) return;
        if (cpSkip(parent)) { cpCounts(node); return; }
        if (!/[0-9A-Za-z\u00C0-\u024F\u0370-\u052F\u3040-\u30FF\u4E00-\u9FFF$\u20AC\u00A3%]/.test(node.nodeValue || '')) return;
        var mixed = false;
        for (var c = parent.firstChild; c; c = c.nextSibling) { if (c.nodeType === 1) { mixed = true; break; } }
        if (!mixed || parent.namespaceURI !== CP_HTML) { cpSeal(parent); return; }
        var span = document.createElement('span');
        span.className = 'ds-sealed-i';
        parent.insertBefore(span, node);
        span.appendChild(node);
        cpSeal(span);
      };
      // Every control that would create or change a deal, a match, an order or a
      // partner is locked for him (Arthur 2026-10-20: «нельзя создавать пока сделки»);
      // the server refuses those writes anyway (candidate-lens.refuseWrite).
      var CP_WRITES = '#tdTake,#tdRelease,.td-demo-touch,.td-mark,.td-other,#tdBoard,#bookDeal,.open-cp,' +
        '.btn-new-order,.mobile-fab,#smartImportBtn,.dd-btn,.chain-hop-name-btn,.chain-hop-person-btn,' +
        '.chain-link-add,.chain-hop-remove,.chain-reset-btn,[data-write]';
      var cpLock = function (el) {
        if (!el || !el.classList || el.classList.contains('ds-locked')) return;
        el.classList.add('ds-locked');
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('aria-describedby', 'sealedTip');
        if (el.tagName === 'SELECT') el.disabled = true;
        if (el.hasAttribute('title')) { el.setAttribute('data-sealed-title', ''); el.removeAttribute('title'); }
      };
      var cpLocks = function (root) {
        if (!root || root.nodeType !== 1) return;
        if (root.matches && root.matches(CP_WRITES)) cpLock(root);
        var w = root.querySelectorAll ? root.querySelectorAll(CP_WRITES) : [];
        for (var i = 0; i < w.length; i++) cpLock(w[i]);
      };
      var cpScan = function (root) {
        if (!root) return;
        if (root.nodeType === 3) { cpText(root); return; }
        if (root.nodeType !== 1) return;
        cpLocks(root);
        if (cpSkip(root)) {
          // An open area can still hold partner data: its [data-sealed] parts are scanned on their own.
          if (root.querySelectorAll && !root.closest('[data-sealed],.ds-sealed')) {
            var inner = root.querySelectorAll('[data-sealed]');
            for (var q = 0; q < inner.length; q++) if (!inner[q].parentElement.closest('[data-sealed]')) cpScan(inner[q]);
          }
          return;
        }
        if (CP_MEDIA[root.tagName]) { cpSeal(root); return; }
        var texts = [];
        var walker = document.createTreeWalker(root, 4, null);
        for (var n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
        for (var i = 0; i < texts.length; i++) cpText(texts[i]);
        // Logos, letters shown in a frame (an email), pictures: values too.
        var media = root.querySelectorAll('img,iframe,video,canvas');
        for (var j = 0; j < media.length; j++) if (!cpSkip(media[j])) cpSeal(media[j]);
      };
      var cpPlace = function (el) {
        if (!cpTip) return;
        var r = el.getBoundingClientRect();
        cpTip.classList.add('on');
        var w = cpTip.offsetWidth, h = cpTip.offsetHeight, vw = window.innerWidth, gap = 8;
        var left = Math.max(16, Math.min(r.left + r.width / 2 - w / 2, vw - 16 - w));
        // Above the value, never over the top bar or the strip; else below it.
        var bar = document.querySelector('.topbar') || document.getElementById('svicPreview');
        var floor = bar ? Math.max(0, bar.getBoundingClientRect().bottom) + gap : gap;
        var top = r.top - h - gap;
        if (top < floor) top = r.bottom + gap;
        cpTip.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
      };
      var cpHide = function () { if (cpTip) cpTip.classList.remove('on'); };
      var cpMount = function () {
        if (!document.body) return false;
        if (!document.getElementById('svicPreview')) {
          var strip = document.createElement('div');
          strip.id = 'svicPreview';
          strip.className = 'svic-preview';
          strip.setAttribute('role', 'region');
          strip.setAttribute('aria-label', 'Preview');
          strip.innerHTML = '<b><i aria-hidden="true"></i>Preview</b><span class="l">Live deals in clear; partner data and deal actions: ' + CP_SAY + '</span>' +
            '<span class="s">Partners open after Finalis and FINRA</span>';
          document.body.insertBefore(strip, document.body.firstChild);
        }
        if (!document.getElementById('sealedTip')) {
          cpTip = document.createElement('div');
          cpTip.id = 'sealedTip';
          cpTip.className = 'sealed-tip';
          cpTip.setAttribute('role', 'tooltip');
          cpTip.textContent = CP_SAY;
          document.body.appendChild(cpTip);
        }
        return true;
      };
      if (typeof MutationObserver === 'function') {
        new MutationObserver(function (list) {
          if (document.body && !document.getElementById('svicPreview')) cpMount();
          for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (m.type === 'characterData') { cpText(m.target); continue; }
            for (var k = 0; k < m.addedNodes.length; k++) cpScan(m.addedNodes[k]);
          }
        }).observe(cpRoot, { childList: true, subtree: true, characterData: true });
      }
      var cpOver = function (e) {
        var t = e.target, el = t && t.closest ? t.closest('.ds-sealed,.ds-locked') : null;
        // The cell around a sealed value answers too (its padding is part of the value's place).
        if (!el && t && t.children) for (var i = 0; i < t.children.length && !el; i++) if (t.children[i].classList && t.children[i].classList.contains('ds-sealed')) el = t.children[i];
        if (el) cpPlace(el); else cpHide();
      };
      document.addEventListener('mouseover', cpOver, true);
      document.addEventListener('focusin', cpOver, true);
      document.addEventListener('focusout', cpHide, true);
      document.addEventListener('click', cpHide, true);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cpHide(); }, true);
      // A locked control does nothing but say when it opens.
      var cpBlock = function (e) {
        var t = e.target, el = t && t.closest ? t.closest('.ds-locked') : null;
        if (!el) return;
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        cpPlace(el);
      };
      document.addEventListener('click', cpBlock, true);
      document.addEventListener('keydown', cpBlock, true);
      window.addEventListener('scroll', cpHide, true);
      window.addEventListener('resize', cpHide);
      // Copying a sealed value gives nothing either.
      document.addEventListener('copy', function (e) {
        var sel = window.getSelection && window.getSelection();
        var node = sel && sel.anchorNode;
        var el = node && (node.nodeType === 1 ? node : node.parentElement);
        if (el && el.closest && el.closest('.ds-sealed')) e.preventDefault();
      }, true);
      document.addEventListener('DOMContentLoaded', function () { cpMount(); cpScan(document.body); });
      if (document.body) { cpMount(); cpScan(document.body); }
    }
  } catch (e) {}

  /* Addressable state (DS §URLs 2.26). Same helper as /url-state.js. */
  if (!window.svicUrlState) {
    window.svicUrlState = (function () {
      function empty(v) { return v == null || v === '' || v === false; }
      function applyPatch(sp, patch) {
        Object.keys(patch || {}).forEach(function (k) {
          var v = patch[k];
          if (empty(v)) sp.delete(k);
          else sp.set(k, String(v));
        });
        return sp;
      }
      function href(loc, patch, dropKeys) {
        var u = new URL(loc.href);
        if (dropKeys) dropKeys.forEach(function (k) { u.searchParams.delete(k); });
        applyPatch(u.searchParams, patch || {});
        var q = u.searchParams.toString();
        return u.pathname + (q ? '?' + q : '') + u.hash;
      }
      function targetWin(win) {
        win = win || window;
        try {
          if (win.parent && win.parent !== win && win.parent.location && win.parent.history) return win.parent;
        } catch (e) {}
        return win;
      }
      function read(win) {
        var w = targetWin(win);
        var out = {};
        try { new URL(w.location.href).searchParams.forEach(function (v, k) { out[k] = v; }); } catch (e) {}
        return out;
      }
      function write(patch, opts) {
        opts = opts || {};
        var w = targetWin(opts.win);
        var next = href(w.location, patch, opts.drop);
        var st = opts.state !== undefined ? opts.state : w.history.state;
        try {
          if (opts.push) w.history.pushState(st, '', next);
          else w.history.replaceState(st, '', next);
        } catch (e) {}
        return next;
      }
      return { applyPatch: applyPatch, href: href, read: read, write: write };
    })();
  }

  /* Admin preview: `#@daria` at the END of the address bar. Hash, not `?` —
   * live pages already have query filters, and appending `?daria` was eaten
   * by the last parameter (Marketplace Admin 2026-08-20). The hash never
   * reaches the server; we stamp X-SVIC-View-As on own /api/ calls and mirror
   * the alias into svic_view_as so HTML page loads get the same overlay. */
  function svicViewAsHash() {
    try {
      if (window.parent && window.parent !== window && window.parent.location && window.parent.location.hash)
        return window.parent.location.hash || '';
    } catch (e) {}
    try { return (window.location && window.location.hash) || ''; } catch (e2) { return ''; }
  }
  function svicViewAsAlias() {
    var matches = String(svicViewAsHash() || '').match(/@([a-zA-Z0-9-]{2,40})/g);
    if (!matches || !matches.length) return '';
    var last = matches[matches.length - 1].replace(/^@/, '').toLowerCase();
    return last || '';
  }
  function svicReadViewAsCookie() {
    var raw = String((typeof document !== 'undefined' && document.cookie) || '');
    var parts = raw.split(';');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var eq = p.indexOf('=');
      if (eq < 0) continue;
      if (p.slice(0, eq).trim() !== 'svic_view_as') continue;
      try { return decodeURIComponent(p.slice(eq + 1).trim()).toLowerCase(); }
      catch (e) { return p.slice(eq + 1).trim().toLowerCase(); }
    }
    return '';
  }
  function svicWriteViewAsCookie(alias) {
    alias = String(alias || '').toLowerCase();
    var body = 'svic_view_as=' + (alias ? encodeURIComponent(alias) : '') + '; Path=/; SameSite=Lax';
    try {
      if (location.protocol === 'https:') body += '; Secure';
      if (/(^|\.)siliconvalleyinvestclub\.com$/i.test(location.hostname)) {
        body += '; Domain=.siliconvalleyinvestclub.com';
      }
    } catch (e) {}
    body += alias ? '; Max-Age=604800' : '; Max-Age=0';
    try { document.cookie = body; } catch (e2) {}
  }
  function svicMergeHash(hash, alias) {
    if (!alias) return hash || '';
    var body = String(hash || '').replace(/^#/, '');
    body = body.replace(/[@#&]*@[a-zA-Z0-9-]+/g, '').replace(/[&]+$/g, '').replace(/^[&]+/g, '');
    if (!body) return '#@' + alias;
    return '#' + body + '&@' + alias;
  }
  function svicWithViewAs(url) {
    var alias = window.svicViewAs && window.svicViewAs.alias;
    if (!alias || !url) return url;
    if (/^(mailto|javascript|data|blob):/i.test(url)) return url;
    var hash = '';
    var hashAt = String(url).indexOf('#');
    if (hashAt >= 0) { hash = url.slice(hashAt); url = url.slice(0, hashAt); }
    if (/^https?:\/\//i.test(url) || url.slice(0, 2) === '//') {
      try {
        var abs = new URL(url, location.origin);
        if (abs.origin !== location.origin) return url + hash;
        if (abs.pathname.indexOf('/login') === 0) return abs.pathname + abs.search + hash;
        url = abs.pathname + abs.search;
      } catch (e) { return url + hash; }
    }
    if (url.indexOf('/login') === 0) return url + hash;
    return url + svicMergeHash(hash, alias);
  }
  window.svicViewAs = {
    get alias() { return svicViewAsAlias(); },
    withAlias: svicWithViewAs
  };
  try {
    var histPush = history.pushState.bind(history);
    var histReplace = history.replaceState.bind(history);
    history.pushState = function (state, title, url) {
      if (url != null && url !== '') url = svicWithViewAs(String(url));
      return histPush(state, title, url);
    };
    history.replaceState = function (state, title, url) {
      if (url != null && url !== '') url = svicWithViewAs(String(url));
      return histReplace(state, title, url);
    };
  } catch (e) {}
  try {
    var assign0 = window.location.assign.bind(window.location);
    var replace0 = window.location.replace.bind(window.location);
    window.location.assign = function (url) { assign0(svicWithViewAs(String(url))); };
    window.location.replace = function (url) { replace0(svicWithViewAs(String(url))); };
  } catch (e) {}
  try {
    document.addEventListener('click', function (e) {
      if (!svicViewAsAlias()) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target;
      while (a && a.nodeType === 1 && a.tagName !== 'A') a = a.parentNode;
      if (!a || a.tagName !== 'A') return;
      if (a.hasAttribute('download')) return;
      var raw = a.getAttribute('href');
      if (!raw || raw.indexOf('javascript:') === 0) return;
      try {
        var u = new URL(a.href, location.href);
        if (u.origin !== location.origin) return;
        if (u.pathname.indexOf('/login') === 0) return;
        var next = svicWithViewAs(u.pathname + u.search + u.hash);
        var cur = u.pathname + u.search + u.hash;
        if (next !== cur) a.setAttribute('href', next);
      } catch (err) {}
    }, true);
  } catch (e) {}
  try {
    var lastViewAs = svicViewAsAlias();
    window.addEventListener('hashchange', function () {
      var now = svicViewAsAlias();
      if (now !== lastViewAs) {
        lastViewAs = now;
        svicWriteViewAsCookie(now);
        window.location.reload();
      }
    });
  } catch (e) {}
  // `#@daria` sticks on every same-origin click until it is deleted from the
  // address bar. A link that dropped the hash gets it put back. Same path
  // without the hash is a manual exit and stays on that page as admin.
  // Cookie mirrors the hash so the next document request is already overlaid.
  try {
    if (window.top === window && location.pathname !== '/login') {
      var aliasNow = svicViewAsAlias();
      var cookieNow = svicReadViewAsCookie();
      if (aliasNow && cookieNow !== aliasNow) {
        svicWriteViewAsCookie(aliasNow);
        location.reload();
        return;
      }
      var storedAlias = '';
      var storedPath = '';
      try {
        storedAlias = sessionStorage.getItem('svicViewAsAlias') || '';
        storedPath = sessionStorage.getItem('svicViewAsPath') || '';
      } catch (e) {}
      var here = location.pathname + location.search;
      if (aliasNow) {
        try {
          sessionStorage.setItem('svicViewAsAlias', aliasNow);
          sessionStorage.setItem('svicViewAsPath', here);
        } catch (e2) {}
        if (storedAlias !== aliasNow) {
          fetch('/api/nav', { credentials: 'include' }).then(function (r) { return r.json(); }).then(function (data) {
            var landing = (data && data.landing) || '/';
            var norm = function (p) {
              return String(p || '/').split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
            };
            // A link into a section this person has stays where it points;
            // only a page outside their menu lands on their home.
            var menu = (data && data.menu) || {};
            var items = (menu.pinned || []).concat.apply(menu.pinned || [], (menu.groups || []).map(function (g) { return g.items || []; }));
            var cur = norm(location.pathname);
            // Свой первый вход (/onboarding) — не раздел меню, но страница
            // самого человека: ссылки на её шаги стоят в его Interviews.
            var theirs = cur === '/onboarding' || items.some(function (i) {
              var r = i && !i.external && norm(i.href);
              return r && r !== '/' && (cur === r || cur.indexOf(r + '/') === 0);
            });
            if (!theirs && cur !== norm(landing)) location.replace(svicWithViewAs(landing));
          }).catch(function () {});
        }
      } else if (storedAlias) {
        if (here !== storedPath) {
          location.replace(here + '#@' + storedAlias);
        } else {
          try {
            sessionStorage.removeItem('svicViewAsAlias');
            sessionStorage.removeItem('svicViewAsPath');
          } catch (e3) {}
          if (cookieNow) {
            svicWriteViewAsCookie('');
            location.reload();
            return;
          }
        }
      } else if (cookieNow) {
        svicWriteViewAsCookie('');
        location.reload();
        return;
      }
    }
  } catch (e) {}

  /* ── theme before first paint — manual choice wins, else OS.
   * Gated on <html data-theme-auto>: only token-complete pages opt in;
   * legacy pages (hardcoded light CSS) pin light until converged. ── */
  try {
    if (!document.documentElement.hasAttribute('data-theme-auto')) throw 0;
    var saved = null;
    try { saved = localStorage.getItem('svic-theme'); } catch (e) {}
    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    document.documentElement.setAttribute('data-theme',
      (saved || (mq && mq.matches ? 'dark' : 'light')) === 'dark' ? 'dark' : 'light');
    if (mq && mq.addEventListener) mq.addEventListener('change', function (e) {
      var manual = null;
      try { manual = localStorage.getItem('svic-theme'); } catch (er) {}
      if (!manual) document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    });
  } catch (e) {}

  /* ── progress line ── */
  /* Честная полоса (2026-08-27, Артур: «прелоадер не соответствует процессу
   * загрузки — он зависает»). Раньше проценты были ТАЙМЕРОМ: 8% при разборе,
   * 38% через 140мс, 72% на DOMContentLoaded — и всё. Данные раздела ехали
   * ещё секунды, а полоса стояла на 72%. Замер в день жалобы: полосу носят
   * все 49 экранов, 31 из них тянет данные ПОСЛЕ загрузки документа, и лишь
   * 2 (лента отзывов и кампании) управляли полосой руками — у остальных 29
   * она гасла раньше содержимого, а у ленты ещё и откатывалась назад
   * (страница ставила 72%, лента возвращала 38% — заливка ползла влево).
   * Модель теперь одна на все экраны:
   *   · значение выводится из РАБОТЫ — доли отвеченных запросов к нашему API,
   *     посчитанных в том же единственном горле, где живёт защита от обрыва;
   *   · только вперёд: значение ниже текущего игнорируется (откат невозможен);
   *   · пока работа не закончена, полоса всегда ползёт, замедляясь к 92% —
   *     стоящая на месте полоса читается человеком как зависание;
   *   · 100% и гашение — когда И документ загружен, И незакрытых запросов нет;
   *   · фоновые тики после первой загрузки полосу не поднимают: закрытый цикл
   *     открывает только явный старт со страницы (действие человека).
   * Закреплено tests/loader-progress-honesty.test.js. */
  var standalone = null;
  function rm() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  // Хозяин полосы — сама шапка (2026-09-08): линия рисуется её нижней кромкой
  // (.topbar[data-progress-host]::after в app.css) и едет вместе с ней при любой
  // пружинящей прокрутке. Отдельная фиксированная полоса остаётся только на
  // страницах без шапки.
  function host() {
    var h = document.querySelector('[data-progress-host]');
    if (h) return h;
    var tb = document.querySelector('.topbar');
    if (tb) { try { tb.setAttribute('data-progress-host', ''); } catch (e) {} return tb; }
    return null;
  }
  function fadeCSS() {
    if (document.getElementById('ds-loader-css')) return;
    var s = document.createElement('style');
    s.id = 'ds-loader-css';
    s.textContent = '.ds-loader-fade::after{ transition:opacity .48s ease !important; opacity:0; }\n'
      + '.ds-loader-reset::after{ transition:none !important; }';
    (document.head || document.documentElement).appendChild(s);
  }
  function bar() {
    if (standalone && standalone.parentNode) return standalone;
    standalone = document.createElement('div');
    standalone.id = 'ds-loader';
    standalone.setAttribute('aria-hidden', 'true');
    // Полоса живёт ПОД шапкой, на светлом фоне (Артур, четырежды 2026-08-25/26:
    // прелоадер ждут под шапкой; над тёмным корпусом синюю линию в 2px не
    // видно). Канон §Layout contract обновлён этим же диффом. На страницах без
    // шапки полоса остаётся на самом верху окна.
    standalone.style.cssText = 'position:fixed;top:0;left:0;right:0;height:2px;z-index:var(--z-toast,6000);pointer-events:none;'
      + 'background-color:var(--accent-track,rgba(10,100,188,.14));'
      + 'background-image:linear-gradient(90deg,var(--accent,#0a64bc),var(--accent-mid,#2d8fe0) 60%,var(--accent,#0a64bc));'
      + 'background-repeat:no-repeat;background-size:0% 100%;'
      + (rm() ? '' : 'transition:background-size .35s ease;');
    (document.body || document.documentElement).appendChild(standalone);
    return standalone;
  }
  var fadeTimers = [];
  function cancelFade() {
    // Затухание, начатое ПРЕДЫДУЩИМ завершением, не вправе убрать полосу,
    // которую страница показала заново (Артур 2026-08-25: полоса мигала и
    // исчезала, пока очередь ещё грузилась). clearTimeout может отсутствовать
    // в изолированной среде, где этот файл исполняется как строка (тестовая
    // песочница) — снятие таймера не должно ронять страницу целиком.
    while (fadeTimers.length) {
      var t = fadeTimers.pop();
      try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
    }
    var h0 = host();
    if (h0) { h0.classList.remove('ds-loader-fade'); h0.classList.remove('ds-loader-reset'); }
    if (standalone) { standalone.style.transition = ''; standalone.style.opacity = ''; }
  }
  function placeBar(b) {
    // Под шапкой: sticky-шапка всегда прижата к верху, её низ и есть место
    // полосы. Пересчитываем на каждом наборе — шапка появляется позже парсинга.
    try {
      var tb = document.querySelector('.topbar');
      var top = tb ? Math.max(0, Math.round(tb.getBoundingClientRect().bottom)) : 0;
      b.style.top = top + 'px';
    } catch (e) { b.style.top = '0px'; }
  }
  // paint — ЕДИНСТВЕННОЕ место, которое трогает пиксели.
  function paint(pct) {
    pct = Math.max(0, Math.min(100, pct));
    if (pct > 0 && pct < 100) cancelFade();
    var h = host();
    if (h) {
      if (pct > 0) h.classList.remove('ds-loader-fade');
      h.style.setProperty('--page-progress', pct + '%');
      if (standalone && standalone.parentNode) { standalone.parentNode.removeChild(standalone); standalone = null; }
    } else {
      var b = bar();
      placeBar(b);
      if (pct > 0) b.style.opacity = '';
      b.style.backgroundSize = pct + '% 100%';
    }
  }

  var TICK_MS = 120, CAP = 92, SETTLE_MS = 220, STUCK_MS = 20000;
  var value = 0, floor = 0, started = 0, settled = 0, holds = 0;
  var cycleOpen = false, docLoaded = false, domReady = false;
  var tickTimer = null, settleTimer = null;
  var openRequests = [];   // отметки времени незакрытых запросов к нашему API

  function later(fn, ms) {
    try { return typeof setTimeout === 'function' ? setTimeout(fn, ms) : null; } catch (e) { return null; }
  }
  function cancel(t) {
    try { if (t != null && typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
  }
  function paintValue(v) {
    v = Math.min(v, CAP);
    if (v <= value) return;   // только вперёд: отката не бывает
    value = v;
    paint(value);
  }
  function targetNow() {
    var t = floor;
    if (started > 0) t = Math.max(t, 45 + 50 * (settled / started));
    return Math.min(t, CAP);
  }
  function nowMs() {
    try { return Date.now(); } catch (e) { return 0; }
  }
  // Запрос, который висит дольше STUCK_MS, перестаёт держать полосу: это уже не
  // загрузка экрана, а поток или зависшее соединение. Иначе полоса стоит на 92%
  // вечно — тот самый «зависает», ради которого всё и переписано.
  function liveRequests() {
    if (!openRequests.length) return 0;
    var cutoff = nowMs() - STUCK_MS;
    var live = 0;
    for (var i = 0; i < openRequests.length; i++) if (openRequests[i] > cutoff) live++;
    return live;
  }
  // Картинки не держат полосу: экран готов, когда пришли ДАННЫЕ. Раньше финиш
  // ждал события load, и на списке с сотнями логотипов полоса стояла на 92%
  // ещё двадцать секунд после того, как строки были на экране (замер на живом
  // /marketplaceadmin 27.08: данные на 3-й секунде, load на 23-й).
  function outstanding() { return holds > 0 || liveRequests() > 0 || !(domReady || docLoaded); }
  function tick() {
    tickTimer = null;
    if (!cycleOpen) return;
    var t = targetNow();
    if (value < t - 0.2) paintValue(value + Math.max(0.4, (t - value) * 0.28));
    else if (outstanding()) paintValue(value + (CAP - value) * 0.03);  // подползание вместо «зависания»
    tickTimer = later(tick, TICK_MS);
  }
  function startTicking() {
    if (!cycleOpen) return;
    if (rm()) { paintValue(targetNow()); return; }
    if (tickTimer == null) tickTimer = later(tick, TICK_MS);
  }
  function openCycle() {
    if (cycleOpen) return;
    cycleOpen = true;
    started = settled = 0;
    openRequests = [];
    value = 0; floor = 0;
    cancelFade();
    paint(0);
    startTicking();
  }
  // Внешняя отметка — ПОЛ, а не приказ: значение ниже текущего не откатывает.
  function bump(pct) {
    if (!cycleOpen) openCycle();
    cancel(settleTimer); settleTimer = null;
    floor = Math.max(floor, Math.max(0, Math.min(100, Number(pct) || 0)));
    paintValue(targetNow());
    startTicking();
  }
  function maybeFinish() {
    if (!cycleOpen || outstanding()) return;
    cancel(settleTimer);
    // Пауза перед финишем: один запрос часто рождает следующий, и полоса не
    // должна мигать «готово» в зазоре между ними.
    settleTimer = later(function () {
      settleTimer = null;
      if (!cycleOpen || outstanding()) return;
      done();
    }, rm() ? 0 : SETTLE_MS);
  }
  // Учёт запросов к нашему API. Счётчик открыт только внутри цикла — поэтому
  // фоновые обновления списков после первой загрузки полосу не дёргают.
  function trackRequest() {
    if (!cycleOpen) return null;
    started++;
    var stamp = nowMs();
    openRequests.push(stamp);
    cancel(settleTimer); settleTimer = null;
    startTicking();
    var closed = false;
    return function () {
      if (closed) return;
      closed = true;
      settled++;
      var at = openRequests.indexOf(stamp);
      if (at >= 0) openRequests.splice(at, 1);
      if (!cycleOpen) return;
      paintValue(targetNow());
      maybeFinish();
    };
  }
  // done: залить до 100%, погасить прозрачностью, затем сбросить в 0% с
  // выключенными переходами — заливка никогда не едет назад на глазах.
  function done() {
    cycleOpen = false;
    cancel(tickTimer); tickTimer = null;
    cancel(settleTimer); settleTimer = null;
    value = 100;
    paint(100);
    var instant = rm();
    fadeTimers.push(later(function () {
      var h = host();
      if (h) {
        fadeCSS();
        h.classList.add('ds-loader-fade');
        fadeTimers.push(later(function () {
          h.classList.add('ds-loader-reset');
          h.style.setProperty('--page-progress', '0%');
          void h.offsetWidth;
          h.classList.remove('ds-loader-fade');
          void h.offsetWidth;
          h.classList.remove('ds-loader-reset');
          value = 0;
        }, instant ? 0 : 480));
      } else if (standalone) {
        var b = standalone;
        if (!instant) { b.style.transition = 'opacity .48s ease'; b.style.opacity = '0'; }
        fadeTimers.push(later(function () {
          if (b.parentNode) b.parentNode.removeChild(b);
          if (standalone === b) standalone = null;
          value = 0;
        }, instant ? 0 : 480));
      } else { value = 0; }
    }, instant ? 0 : 380));
  }

  // Фазы документа задают только НИЖНЮЮ границу; выше её тянет реальная работа.
  openCycle();
  bump(8);
  function onDomReady() { domReady = true; bump(45); maybeFinish(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDomReady);
  } else { onDomReady(); }
  function onDocLoaded() { docLoaded = true; bump(70); maybeFinish(); }
  if (document.readyState === 'complete') onDocLoaded();
  else window.addEventListener('load', onDocLoaded);
  // Сторож против вечной полосы: раз в секунду пересчитываем, не осталось ли
  // работы (зависший запрос стареет и перестаёт считаться).
  (function watch() {
    later(function () {
      if (cycleOpen) { maybeFinish(); watch(); }
    }, 1000);
  })();

  // Страница может держать полосу дольше жизни документа (долгая работа без
  // запроса к API): dsLoaderHold() откладывает финиш, dsLoaderRelease()
  // отпускает; явный dsLoaderDone() гасит всегда.
  window.dsLoaderHold = function () { holds++; if (!cycleOpen) openCycle(); cancel(settleTimer); settleTimer = null; startTicking(); };
  window.__dsLoaderState = function () {
    return { value: value, started: started, settled: settled, live: liveRequests(), holds: holds, open: cycleOpen };
  };
  window.dsLoaderRelease = function () { holds = Math.max(0, holds - 1); maybeFinish(); };
  window.dsLoaderSet = bump;
  window.dsLoaderDone = function () { holds = 0; if (cycleOpen) done(); };

  /* ── one throat for a dropped request to our own API ──
   * A request that never gets an answer (the platform is swapped blue→green and
   * the browser's kept-alive HTTP/2 connection to the retired instance dies, a
   * wifi blip, a sleeping laptop) makes fetch reject with the browser's own
   * "Failed to fetch". Every console page hands error.message straight to the
   * person, so two things happened at once: an English browser internal on
   * screen, and the action itself silently lost — the server never heard it.
   * Mariam, 2026-08-10: she pressed No-show on a meeting during a deploy, saw
   * "Failed to fetch", and the meeting stayed confirmed.
   *
   * The guarantee belongs here, in the one file every page is required to load,
   * not in each page's own api() helper (74 call sites toast a raw error today):
   *   · nothing came back (or the edge answered 502/503/504 mid-swap) and the
   *     request is safe to repeat → repeat it, three times over ~6s;
   *   · still nothing → reject with a sentence a human can act on.
   * A request that DID get an answer — including 4xx/5xx from our own code —
   * passes through untouched. Requests that must not be repeated blind (POST
   * that creates something) are never repeated; a caller that knows its POST is
   * idempotent opts in with the header X-Svic-Retry: safe.
   * Pinned by tests/network-drop-resilience.test.js. */
  try {
    var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    if (nativeFetch && !window.__svicFetchGuard) {
      window.__svicFetchGuard = true;
      var RETRY_AFTER = [500, 1500, 4000];
      var REPEATABLE = { GET: 1, HEAD: 1, OPTIONS: 1, PUT: 1, PATCH: 1, DELETE: 1 };
      var ownApi = function (input) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (!url) return false;
        if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
          try {
            var parsed = new URL(url);
            return parsed.origin === location.origin && parsed.pathname.indexOf('/api/') === 0;
          } catch (e) { return false; }
        }
        return url.indexOf('/api/') === 0;
      };
      var headerOf = function (init, name) {
        var h = init && init.headers;
        if (!h) return '';
        try { if (typeof h.get === 'function') return h.get(name) || ''; } catch (e) {}
        var keys = Object.keys(h);
        for (var i = 0; i < keys.length; i++) {
          if (keys[i].toLowerCase() === name.toLowerCase()) return String(h[keys[i]] || '');
        }
        return '';
      };
      var repeatable = function (input, init) {
        var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        var body = init && init.body;
        // A stream body is consumed by the first attempt; there is nothing left
        // to send twice, so such a request is never repeated.
        if (body && typeof body.getReader === 'function') return false;
        if (REPEATABLE[method]) return true;
        return method === 'POST' && headerOf(init, 'X-Svic-Retry').toLowerCase() === 'safe';
      };
      var humanError = function (cause) {
        var offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        var err = new Error(offline
          ? 'No connection to the internet — nothing was saved. Reconnect and try again.'
          : 'The server did not answer — nothing was saved. Try again in a moment.');
        err.name = 'SvicNetworkError';
        err.cause = cause;
        return err;
      };
      var lostError = function (cause) {
        var err = new Error(
          'The connection dropped before the server answered. Reload the page to see whether it went through.');
        err.name = 'SvicNetworkError';
        err.cause = cause;
        return err;
      };
      window.fetch = function (input, init) {
        // Опрос версии сборки (общая полоса подхвата ниже) — не работа
        // страницы: мимо учёта полосы и мимо повторов.
        if (init && init.dsBuildWatch) return nativeFetch(input, init);
        if (!ownApi(input)) return nativeFetch(input, init);
        var alias = window.svicViewAs && window.svicViewAs.alias;
        if (alias) {
          init = Object.assign({}, init || {});
          var headers = init.headers;
          if (headers && typeof Headers === 'function' && headers instanceof Headers) {
            headers = new Headers(headers);
            if (!headers.get('X-SVIC-View-As')) headers.set('X-SVIC-View-As', alias);
            init.headers = headers;
          } else {
            headers = Object.assign({}, headers || {});
            var hasViewAs = false;
            Object.keys(headers).forEach(function (k) {
              if (String(k).toLowerCase() === 'x-svic-view-as') hasViewAs = true;
            });
            if (!hasViewAs) headers['X-SVIC-View-As'] = alias;
            init.headers = headers;
          }
        }
        var canRepeat = repeatable(input, init);
        // One "retrying…" line per action, however many attempts it takes: the
        // person must see movement (IRON: no silent pause), not a stack of toasts.
        var announced = false;
        var announce = function () {
          if (announced) return;
          announced = true;
          try { if (window.showToast) window.showToast('Connection dropped — retrying…'); } catch (e) {}
        };
        var attempt = function (index) {
          return nativeFetch(input, init).then(function (response) {
            if (canRepeat && index < RETRY_AFTER.length &&
                (response.status === 502 || response.status === 503 || response.status === 504)) {
              announce();
              return new Promise(function (resolve) {
                setTimeout(function () { resolve(attempt(index + 1)); }, RETRY_AFTER[index]);
              });
            }
            return response;
          }, function (error) {
            // A cancelled request is not a failure: the page or the person
            // asked for it to stop, and repeating it would undo that.
            var aborted = (error && error.name === 'AbortError') ||
              (init && init.signal && init.signal.aborted);
            if (aborted) throw error;
            if (!canRepeat) throw lostError(error);
            if (index >= RETRY_AFTER.length) throw humanError(error);
            announce();
            return new Promise(function (resolve) {
              setTimeout(function () { resolve(attempt(index + 1)); }, RETRY_AFTER[index]);
            });
          });
        };
        // Полоса прогресса выводится из этой же точки: запрос открыт — работа
        // идёт, ответ пришёл — доля выросла. Отдельного учёта по страницам нет.
        var settleProgress = trackRequest();
        if (!settleProgress) return attempt(0);
        return attempt(0).then(function (response) {
          settleProgress();
          return response;
        }, function (error) {
          settleProgress();
          throw error;
        });
      };

      if (window.XMLHttpRequest && XMLHttpRequest.prototype && !window.__svicViewAsXhr) {
        window.__svicViewAsXhr = true;
        var xhrOpen = XMLHttpRequest.prototype.open;
        var xhrSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
          try { this.__svicViewAs = ownApi(url); } catch (e) { this.__svicViewAs = false; }
          return xhrOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
          var viewAlias = window.svicViewAs && window.svicViewAs.alias;
          if (viewAlias && this.__svicViewAs) {
            try { this.setRequestHeader('X-SVIC-View-As', viewAlias); } catch (e) {}
          }
          // Старый транспорт считается наравне с fetch — иначе экран на нём
          // гасил бы полосу раньше своих же данных.
          if (this.__svicViewAs) {
            var settleXhr = trackRequest();
            if (settleXhr) {
              try { this.addEventListener('loadend', function () { settleXhr(); }); }
              catch (e) { settleXhr(); }
            }
          }
          return xhrSend.apply(this, arguments);
        };
      }
    }
  } catch (e) {}

  /* Platform menu (design-system R-11 companion): inject the ONE offcanvas
   * component on every page, so a page can never "forget" the menu and a section
   * added to src/nav/registry.js appears everywhere automatically. The component
   * self-guards against double-init; it stays dormant until openOffcanvas() runs. */
  try {
    if (!window.__offcanvasMenuInitialized &&
        !document.querySelector('script[src$="/offcanvas-menu.js"],script[src$="/brandbook-offcanvas.js"]')) {
      var ocs = document.createElement('script');
      ocs.src = '/offcanvas-menu.js';
      ocs.defer = true;
      (document.head || document.documentElement).appendChild(ocs);
    }
  } catch (e) {}

  /* Role-split navigation (brand book §Navigation, R-15 — rule 2026-08-21): an admin
   * always has the burger; everyone else gets their sections as buttons in the
   * top bar on desktop (>900px) and the burger on phones. One renderer, injected
   * here so no page can forget it or wire it by hand; it reads /api/nav and stays
   * idle for admins and on pages without a .topbar-in. */
  /* Публичный сайт (apex/www) проксирует этот файл живьём как /_skin/loader.js,
   * но topnav.js и activity.js — платформенные: на публичном хосте их нет, и
   * каждая страница сыпала в консоль два 404 (2026-08-27). Гейт по хосту. */
  var svicPublicHost = /^(?:www\.)?siliconvalleyinvestclub\.com$/.test(location.hostname) ||
    /* Публичные страницы записи на платформе (кандидат, гость: /meet/…,
     * /booking/…, короткие адреса хостов) открывают без сессии — topnav.js
     * спрашивал /api/nav и оставлял в консоли каждого гостя 401 (ночной
     * прогон 2026-09-25, WebKit-стенд). Меню и учёт активности там не нужны. */
    /* То же для страниц без сессии или до неё: приглашение (/welcome/…) и
     * подпись (/sign/…, внешний подписант; у сотрудника на этапе настройки
     * разделов ещё нет — как в утверждённом демо). */
    /^\/(?:meet|schedule|booking|welcome|sign)(?:\/|$)|^\/(?:arthur|victoria|mariam)\/?$/.test(location.pathname);
  try {
    if (!svicPublicHost && location.pathname !== '/login' && !window.__svicTopnavInit &&
        !document.querySelector('script[src$="/topnav.js"]')) {
      var tns = document.createElement('script');
      tns.src = '/topnav.js';
      tns.defer = true;
      (document.head || document.documentElement).appendChild(tns);
    }
  } catch (e) {}

  /* Append-only employee activity audit. The tracker records navigation,
   * interactive-control clicks and active time, but never reads form values,
   * request bodies, cookies or tokens. Server-side middleware separately logs
   * API actions and their status. */
  try {
    if (!svicPublicHost && location.pathname !== '/login' && !window.__svicActivityInitialized &&
        !document.querySelector('script[src$="/activity.js"]')) {
      var ats = document.createElement('script');
      ats.src = '/activity.js';
      ats.defer = true;
      (document.head || document.documentElement).appendChild(ats);
    }
  } catch (e) {}

  /* Back to top (§Public site · specs) — one control per page, shared by every
   * surface. Scrolls the ACTIVE scroller: an open drawer or modal when the
   * reader is looking at one, else the document. Threshold is relative so the
   * control also appears inside short scrollable panels. Opt out per page with
   * <body data-no-totop>. */
  try {
    var initTotop = function () {
      if (!document.body || document.body.hasAttribute('data-no-totop') ||
          document.querySelector('.totop')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'totop'; b.setAttribute('aria-label', 'Back to top');
      document.body.appendChild(b);
      var scroller = function () {
        var d = document.querySelector('.sheet-overlay.open .sheet-bd');
        if (d && d.scrollHeight > d.clientHeight + 4) return d;
        var m = document.getElementById('modalOverlay');
        if (m && m.scrollHeight > m.clientHeight + 4 && getComputedStyle(m).display !== 'none') return m;
        return null; /* the document */
      };
      /* The control never lies over a form or a control (Codex 2026-10-11: on a phone it covered
       * «Personal note» and «Send invitation» in the owner's Open access window and took the tap).
       * Same rule as the public site's arrow: whatever form, modal panel, field or button sits
       * under it hides it. Re-checked when a window opens or closes, not only on scroll. */
      var CONTROL = 'form,.modal,button,input,select,textarea,label,[role=button],[contenteditable=true]';
      var coversControl = function () {
        if (!document.elementsFromPoint) return false;
        var r = b.getBoundingClientRect();
        var pts = [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2], [r.left + r.width / 2, r.top + r.height / 2]];
        for (var i = 0; i < pts.length; i++) {
          var stack = document.elementsFromPoint(pts[i][0], pts[i][1]);
          for (var j = 0; j < stack.length; j++) {
            var el = stack[j];
            if (el === b) continue;
            if (el.closest && el.closest(CONTROL)) return true;
            break;
          }
        }
        return false;
      };
      var tick = function () {
        var el = scroller();
        var max = el ? (el.scrollHeight - el.clientHeight)
                     : (document.documentElement.scrollHeight - window.innerHeight);
        var pos = el ? el.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0);
        var thr = Math.min(280, Math.max(80, max * 0.25));
        /* Over a form the control vanishes at once — no fade (Codex 2026-10-12: WebKit kept painting
         * the fading arrow over «Role on the card» for about a second). Elsewhere the fade stays. */
        var cov = coversControl();
        b.classList.toggle('totop-covered', cov);
        b.classList.toggle('on', max > 40 && pos > thr && !cov);
      };
      var _tq = 0;
      var queueTick = function () { if (_tq) return; _tq = setTimeout(function () { _tq = 0; tick(); }, 30); };
      b.addEventListener('click', function () {
        var el = scroller();
        try { (el || window).scrollTo({ top: 0, behavior: 'smooth' }); }
        catch (e) { if (el) el.scrollTop = 0; else window.scrollTo(0, 0); }
      });
      window.addEventListener('scroll', tick, { passive: true });
      document.addEventListener('scroll', tick, { capture: true, passive: true });
      window.addEventListener('resize', queueTick);
      document.addEventListener('focusin', queueTick);
      if (window.MutationObserver) new MutationObserver(queueTick).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open'] });
      tick();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTotop);
    else initTotop();
  } catch (e) {}

  /* New build pickup — ONE shared lane for every page (2026-09-08, Arthur:
   * the feed reloaded itself under his hands after each deploy, the load line
   * ran across the top bar mid-scroll). Rule: a page is never reloaded while
   * the reader can see it. Visible tab → a quiet pill «New version · Reload».
   * Hidden tab for 5 minutes or more → reload happens out of sight. Pages own
   * no reload logic of their own (tests/ui-shared-build-watch.test.js). */
  try {
    var BUILD_POLL_MS = 90000, HIDDEN_RELOAD_MS = 5 * 60 * 1000;
    var knownBuild = null, newBuild = null, hiddenSince = null, pill = null;
    // Только настоящий браузер: без интервального таймера и живого fetch
    // (имитация в тестах) полоса подхвата не запускается.
    if (typeof window.setInterval !== 'function' || typeof window.fetch !== 'function') throw 0;
    function readBuild() {
      return window.fetch('/healthz', { cache: 'no-store', credentials: 'same-origin', dsBuildWatch: true })
        .then(function (r) { return r.json(); })
        .then(function (j) { return j && j.deploySha ? String(j.deploySha) : null; })
        .catch(function () { return null; });
    }
    function showPill() {
      if (pill || !document.body) return;
      pill = document.createElement('div');
      pill.className = 'ds-newbuild';
      pill.setAttribute('role', 'status');
      pill.innerHTML = '<span>New version available</span><button type="button">Reload</button>';
      pill.querySelector('button').addEventListener('click', function () { location.reload(); });
      document.body.appendChild(pill);
    }
    function tick() {
      readBuild().then(function (b) {
        if (!b) return;
        if (knownBuild === null) { knownBuild = b; return; }
        if (b !== knownBuild) { newBuild = b; if (!document.hidden) showPill(); }
      });
    }
    function onVisibility() {
      if (document.hidden) { hiddenSince = Date.now(); return; }
      hiddenSince = null;
      if (newBuild) showPill();
    }
    function hiddenTick() {
      if (newBuild && document.hidden && hiddenSince && Date.now() - hiddenSince >= HIDDEN_RELOAD_MS) location.reload();
    }
    window.dsNewBuildSeen = function (b) { if (b && knownBuild && String(b) !== knownBuild) { newBuild = String(b); if (!document.hidden) showPill(); } if (b && knownBuild === null) knownBuild = String(b); };
    document.addEventListener('visibilitychange', onVisibility);
    if (document.hidden) hiddenSince = Date.now();
    var startWatch = function () { setTimeout(tick, 5000); setInterval(tick, BUILD_POLL_MS); setInterval(hiddenTick, 30000); };
    if (document.readyState === 'complete') startWatch(); else window.addEventListener('load', startWatch);
  } catch (e) {}
})();
