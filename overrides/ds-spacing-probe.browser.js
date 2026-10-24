/* ds-spacing-probe — run in the rendered page (browser console / javascript_tool) and
 * paste the JSON into the passport line `spacing-probe: PASS — <json>`.
 * Outcome sensor for §Patterns → Record list (since 2.30): it measures the DOM, not the CSS —
 *   edge      text inside every .sheet keeps ≥16px from the sheet's left/right edge;
 *   scale     computed padding/margin/gap of .sheet-* boxes are steps of the --sp-* scale;
 *   actions   a .sheet-actions column carries at most ONE .btn beside the «…» menu
 *             (delivery repair buttons inside .cr-delivery-like blocks are exempt: they are states, not actions);
 *   overflow  the document does not scroll sideways.
 * verdict PASS only when every list is empty. */
(function () {
  var SCALE = [0, 1, 2, 4, 8, 12, 16, 20, 24, 26, 40];
  var out = { edge: [], scale: [], actions: [], overflow: false, sheets: 0, rows: 0 };
  var sheets = document.querySelectorAll('.sheet, .panel-card');
  out.sheets = sheets.length;
  sheets.forEach(function (sheet) {
    var sr = sheet.getBoundingClientRect();
    sheet.querySelectorAll('.sheet-row, .sheet-tools, .sheet-notice, .sheet-empty').forEach(function (box) {
      var cs = getComputedStyle(box);
      ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap', 'marginTop', 'marginBottom'].forEach(function (k) {
        var v = parseFloat(cs[k]); if (isNaN(v) || cs[k] === 'normal') return;
        if (SCALE.indexOf(Math.round(v)) < 0) out.scale.push(box.className.split(' ')[0] + '.' + k + '=' + v);
      });
      if (box.classList.contains('sheet-row')) out.rows++;
      // pre-wrap text hangs its trailing whitespace past the content edge; measure ink per line
      // and ignore a line box that only reaches the box's own content edge.
      var br = box.getBoundingClientRect();
      var contentRight = br.right - parseFloat(cs.paddingRight);
      var walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      var n; while ((n = walker.nextNode())) {
        if (!n.textContent.trim()) continue;
        var range = document.createRange(); range.selectNodeContents(n);
        var rects = range.getClientRects();
        for (var i = 0; i < rects.length; i++) {
          var r = rects[i]; if (!r.width) continue;
          var hangs = r.right > contentRight - 0.5;
          if (r.left - sr.left < 16 || (!hangs && sr.right - r.right < 16)) { out.edge.push(n.textContent.trim().slice(0, 40)); break; }
        }
      }
    });
    sheet.querySelectorAll('.sheet-actions').forEach(function (a) {
      var btns = a.querySelectorAll(':scope > .main > .btn, :scope > .btn').length;
      if (btns > 1) out.actions.push(btns + ' buttons in one actions column');
    });
  });
  out.overflow = document.documentElement.scrollWidth > window.innerWidth;
  out.verdict = (!out.edge.length && !out.scale.length && !out.actions.length && !out.overflow) ? 'PASS' : 'FAIL';
  return out;
})();
