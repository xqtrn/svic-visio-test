(function () {
  'use strict';

  var app = document.getElementById('bookingApp');
  var query = new URLSearchParams(location.search);
  var embedded = query.get('embed') === '1';
  var embedSuffix = embedded ? '?embed=1' : '';
  if (embedded) document.body.classList.add('sch-embedded');
  // Deploy gates and screenshot probes render with ?__static=1: every entrance
  // animation is frozen so a capture never races a cascade mid-flight.
  if (query.get('__static') === '1') document.body.classList.add('sch-static');
  var legalUrl = 'https://siliconvalleyinvestclub.com/legal/';
  var embedResizeFrame = 0;
  // The visitor's own clock decides the default: the calendar always opens in the
  // timezone the browser reports, never in the host's or the server's.
  var deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  var state = {
    mode: 'booking',
    hostSlug: '',
    eventSlug: '',
    formSlug: '',
    profile: null,
    eventType: null,
    timezone: deviceTimezone,
    month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    slots: [],
    availabilityStatus: 'loading',
    availabilityError: null,
    selectedDate: '',
    selectedSlot: null,
    pendingSlot: null,
    hold: null,
    capabilityToken: '',
    capability: null,
    // A personal invitation link (?c= / ?app=) pre-fills name and email from
    // the application; the person still sees, edits and confirms them.
    invitee: null
  };
  var personalLink = !!(query.get('c') || query.get('app'));
  // Per-month availability cache: instant month navigation plus a background
  // prefetch of the following month. Values: { slots, fetchedAt }.
  var monthCache = {};
  var MONTH_CACHE_TTL = 60000;

  function notifyEmbedHeight() {
    if (!embedded || window.parent === window) return;
    cancelAnimationFrame(embedResizeFrame);
    embedResizeFrame = requestAnimationFrame(function () {
      var box = app.querySelector('.sch-booker');
      if (!box) return;
      var height = Math.ceil(box.getBoundingClientRect().height);
      window.parent.postMessage({
        type: 'svic:scheduler:resize',
        height: height
      }, '*');
    });
  }

  if (embedded && 'ResizeObserver' in window) {
    new ResizeObserver(notifyEmbedHeight).observe(app);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(name) {
    var paths = {
      clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
      video: '<rect x="3" y="6" width="13" height="12" rx="2"></rect><path d="m16 10 5-3v10l-5-3z"></path>',
      globe: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"></path>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18"></path>',
      check: '<path d="m5 12 4 4L19 6"></path>'
    };
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = paths[name] || paths.calendar;
    return svg;
  }

  async function api(url, options) {
    var response = await fetch(url, Object.assign({
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit'
    }, options || {}));
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(data.error || 'Scheduling is temporarily unavailable');
      error.code = data.code;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function parseRoute() {
    var parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'booking' && parts[1]) {
      state.mode = 'capability';
      state.capabilityToken = parts[1];
      return;
    }
    var publicAliases = {
      arthur: 'meeting',
      victoria: '15min',
      mariam: '30min'
    };
    if (parts.length === 1 && publicAliases[parts[0]]) {
      state.hostSlug = parts[0];
      state.eventSlug = publicAliases[parts[0]];
      return;
    }
    state.hostSlug = parts[1] || '';
    if (parts[2] === 'route' && parts[3]) {
      state.mode = 'routing';
      state.formSlug = parts[3];
      return;
    }
    state.eventSlug = parts[2] || '';
  }

  function initials(name) {
    return String(name || 'SV').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); }).join('');
  }

  function profilePanel(profile, eventType) {
    var aside = el('aside', 'sch-profile');
    var avatar = el('div', 'sch-avatar');
    if (profile.avatarUrl) {
      var image = document.createElement('img');
      image.src = profile.avatarUrl;
      image.alt = '';
      avatar.appendChild(image);
    } else {
      avatar.textContent = initials(profile.displayName);
    }
    aside.appendChild(avatar);
    aside.appendChild(el('div', 'sch-host', profile.displayName));
    aside.appendChild(el('h1', 'sch-title', eventType ? eventType.name : (profile.title || 'Schedule a meeting')));
    if (eventType) {
      var facts = el('div', 'sch-facts');
      var duration = el('div', 'sch-fact');
      duration.appendChild(icon('clock'));
      duration.appendChild(el('span', '', eventType.durationMinutes + ' min'));
      facts.appendChild(duration);
      var location = el('div', 'sch-fact');
      location.appendChild(icon('video'));
      location.appendChild(el('span', '', locationLabel(eventType.locationType)));
      facts.appendChild(location);
      aside.appendChild(facts);
      var description = visibleEventDescription(profile, eventType);
      if (description) {
        aside.appendChild(el('p', 'sch-description', description));
      }
    }
    var footer = el('nav', 'sch-profile-footer');
    footer.setAttribute('aria-label', 'Booking policies');
    var privacy = el('a', '', 'Privacy Policy');
    privacy.href = legalUrl;
    privacy.target = '_blank';
    privacy.rel = 'noopener';
    var terms = el('a', '', 'Terms');
    terms.href = legalUrl;
    terms.target = '_blank';
    terms.rel = 'noopener';
    footer.appendChild(privacy);
    footer.appendChild(terms);
    aside.appendChild(footer);
    return aside;
  }

  function isConferenceBoilerplate(value) {
    var normalized = String(value || '').trim().replace(/\s+/g, ' ')
      .replace(/[.!]+$/, '').toLowerCase();
    return /^(?:call\s*\/\s*)?(?:web|video) conferencing details (?:are )?provided (?:upon|after) confirmation$/
      .test(normalized);
  }

  function visibleEventDescription(profile, eventType) {
    var description = eventType.description ||
      (profile.description && !/^welcome to my scheduling page/i.test(profile.description) ?
        profile.description : '');
    var conferencingLocation = [
      'google_meet', 'zoom', 'microsoft_teams', 'webex', 'goto_meeting'
    ].indexOf(eventType.locationType) !== -1;
    return conferencingLocation && isConferenceBoilerplate(description) ? '' : description;
  }

  function locationLabel(value) {
    return ({
      google_meet: 'Web conferencing details provided upon confirmation.',
      zoom: 'Web conferencing details provided upon confirmation.',
      microsoft_teams: 'Web conferencing details provided upon confirmation.',
      webex: 'Web conferencing details provided upon confirmation.',
      goto_meeting: 'Web conferencing details provided upon confirmation.',
      phone: 'Phone call',
      in_person: 'In-person meeting',
      custom: 'Meeting details on confirmation',
      invitee_choice: 'Choose a location'
    })[value] || 'Video conference';
  }

  function shell(profile, eventType) {
    app.replaceChildren();
    // Embeds keep the compact widget card (they live inside an iframe on an
    // already-chromed page); the standalone URL renders as a page of the site.
    if (embedded) {
      var box = el('div', 'sch-booker');
      box.appendChild(profilePanel(profile, eventType));
      var stage = el('section', 'sch-stage');
      stage.id = 'scheduleStage';
      stage.setAttribute('aria-label', 'Booking');
      box.appendChild(stage);
      app.appendChild(box);
        notifyEmbedHeight();
      return stage;
    }
    // Native page keeps Calendly's proven composition — host and meeting facts
    // on the left, the calendar on the right, both columns starting level — and
    // fits a single viewport; only the styling layer is the site's own.
    document.body.classList.add('sch-native');
    var page = el('div', 'sch-page');
    var body = el('div', 'sch-body');
    body.appendChild(profilePanel(profile, eventType));
    var pageStage = el('section', 'sch-stage');
    pageStage.id = 'scheduleStage';
    pageStage.setAttribute('aria-label', 'Booking');
    body.appendChild(pageStage);
    page.appendChild(body);
    app.appendChild(page);
    return pageStage;
  }

  function stageHeader(title, subtitle, back) {
    var head = el('div', 'sch-stage-head');
    var copy = el('div');
    copy.appendChild(el('h2', '', title));
    if (subtitle) copy.appendChild(el('p', '', subtitle));
    head.appendChild(copy);
    if (back) {
      var button = el('button', 'sch-back', '←');
      button.type = 'button';
      button.setAttribute('aria-label', 'Back');
      button.addEventListener('click', back);
      head.appendChild(button);
    }
    return head;
  }

  function renderEventTypes() {
    var stage = shell(state.profile, null);
    stage.appendChild(stageHeader('Select an event', 'Choose the meeting that best fits your conversation.'));
    var list = el('div', 'sch-events');
    state.profile.eventTypes.forEach(function (eventType) {
      var button = el('button', 'sch-event');
      button.type = 'button';
      var copy = el('span', 'sch-event-copy');
      copy.appendChild(el('span', 'sch-event-name', eventType.name));
      copy.appendChild(el('span', 'sch-event-sub', eventType.durationMinutes + ' min · ' + locationLabel(eventType.locationType)));
      button.appendChild(copy);
      button.appendChild(el('span', 'sch-event-arrow', '›'));
      button.addEventListener('click', function () {
        state.eventType = eventType;
        state.eventSlug = eventType.slug;
        history.replaceState({}, '', '/meet/' + encodeURIComponent(state.hostSlug) + '/' +
          encodeURIComponent(eventType.slug) + embedSuffix);
        renderCalendar();
      });
      list.appendChild(button);
    });
    stage.appendChild(list);
  }

  function renderRoutingForm(routing) {
    state.profile = routing.profile;
    var stage = shell(state.profile, null);
    stage.appendChild(stageHeader(routing.form.name, 'Answer a few questions to find the right meeting.'));
    var form = el('form', 'sch-form');
    var controls = [];
    (routing.form.fields || []).forEach(function (field, index) {
      var wrapper = el('div', 'field');
      var id = 'routingField' + index;
      var label = el('label', '', field.label || field.key);
      label.htmlFor = id;
      wrapper.appendChild(label);
      var control;
      if (field.type === 'select') {
        control = document.createElement('select');
        var prompt = el('option', '', 'Select…');
        prompt.value = '';
        control.appendChild(prompt);
        (field.options || []).forEach(function (optionValue) {
          var value = typeof optionValue === 'object' ? optionValue.value : optionValue;
          var option = el('option', '', typeof optionValue === 'object' ? optionValue.label : optionValue);
          option.value = value;
          control.appendChild(option);
        });
      } else if (field.type === 'textarea') {
        control = document.createElement('textarea');
        control.rows = 3;
      } else {
        control = document.createElement('input');
        control.type = field.type === 'email' ? 'email' : 'text';
      }
      control.id = id;
      control.required = !!field.required;
      wrapper.appendChild(control);
      form.appendChild(wrapper);
      controls.push({ key: String(field.key), control: control });
    });
    var submit = el('button', 'btn btn-primary', 'Continue');
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      submit.disabled = true;
      try {
        var answers = {};
        controls.forEach(function (row) { answers[row.key] = row.control.value; });
        var resolved = await api('/api/scheduling/public/' + encodeURIComponent(state.hostSlug) +
          '/route/' + encodeURIComponent(state.formSlug) + '/resolve', {
          method: 'POST',
          body: JSON.stringify({ answers: answers }),
        });
        state.profile = resolved.profile;
        state.eventType = resolved.eventType;
        state.eventSlug = resolved.eventType.slug;
        state.mode = 'booking';
        history.replaceState({}, '', '/meet/' + encodeURIComponent(state.hostSlug) +
          '/' + encodeURIComponent(state.eventSlug) + embedSuffix);
        renderCalendar();
      } catch (error) {
        showToast(error.message, true);
        submit.disabled = false;
      }
    });
    stage.appendChild(form);
  }

  function dateKey(value, timezone) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(value).reduce(function (out, part) {
      if (part.type !== 'literal') out[part.type] = part.value;
      return out;
    }, {});
    return parts.year + '-' + parts.month + '-' + parts.day;
  }

  function monthCacheKey(monthDate) {
    return monthDate.getFullYear() + '-' + monthDate.getMonth() + '|' +
      state.timezone + '|' + state.hostSlug + '/' + state.eventSlug;
  }

  async function fetchMonthSlots(monthDate) {
    var year = monthDate.getFullYear();
    var month = monthDate.getMonth();
    var from = new Date(Date.UTC(year, month, 1, 0, 0, 0)).toISOString();
    var to = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0)).toISOString();
    var url = '/api/scheduling/public/' + encodeURIComponent(state.hostSlug) + '/' +
      encodeURIComponent(state.eventSlug) + '/availability?from=' +
      encodeURIComponent(from) + '&to=' + encodeURIComponent(to) +
      '&timezone=' + encodeURIComponent(state.timezone);
    var data = await api(url);
    var slots = data.slots || [];
    monthCache[monthCacheKey(monthDate)] = { slots: slots, fetchedAt: Date.now() };
    return slots;
  }

  function prefetchAdjacentMonth() {
    var next = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
    var cached = monthCache[monthCacheKey(next)];
    if (cached && Date.now() - cached.fetchedAt < MONTH_CACHE_TTL) return;
    fetchMonthSlots(next).catch(function () { /* prefetch is best-effort */ });
  }

  function slotsByDate() {
    return state.slots.reduce(function (map, slot) {
      var key = dateKey(new Date(slot.startsAt), state.timezone);
      (map[key] || (map[key] = [])).push(slot);
      return map;
    }, {});
  }

  function formatTime(iso) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: state.timezone, hour: 'numeric', minute: '2-digit'
    }).format(new Date(iso));
  }

  function formatFull(iso) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: state.timezone, weekday: 'long', month: 'long', day: 'numeric',
      year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    }).format(new Date(iso));
  }

  function timezoneLabel(zone, includeTime) {
    var common = {
      'America/Los_Angeles': 'Pacific Time — US & Canada',
      'America/Denver': 'Mountain Time — US & Canada',
      'America/Chicago': 'Central Time — US & Canada',
      'America/New_York': 'Eastern Time — US & Canada',
      'Europe/London': 'United Kingdom Time',
      'UTC': 'Coordinated Universal Time'
    };
    var city = common[zone] || String(zone || 'UTC').split('/').pop().replace(/_/g, ' ');
    if (!includeTime) return city;
    var time = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date());
    return city + ' (' + time.toLowerCase() + ')';
  }

  function timezoneValues() {
    var values = [];
    try { values = Intl.supportedValuesOf('timeZone').slice(); } catch (_) {
      values = ['UTC', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Tbilisi'];
    }
    [state.timezone, deviceTimezone, state.profile && state.profile.timezone, 'UTC']
      .forEach(function (zone) {
        if (zone && values.indexOf(zone) === -1) values.unshift(zone);
      });
    return values;
  }

  // The visitor's zone is detected automatically; this control only announces the
  // detection and lets a traveller override it. A searchable panel replaces the
  // 400-option native dropdown: common zones first, everything else findable.
  function renderTimezoneControl(stage) {
    var tz = el('div', 'sch-timezone field');
    var label = el('label', '', 'Time zone');
    label.id = 'bookingTimezoneLabel';
    label.htmlFor = 'bookingTimezone';
    if (state.timezone === deviceTimezone) {
      label.appendChild(el('span', 'sch-tz-auto', 'detected automatically'));
    }
    tz.appendChild(label);
    tz.appendChild(icon('globe'));

    var control = el('div', 'sch-tz');
    var button = el('button', 'sch-tz-button', timezoneLabel(state.timezone, true));
    button.type = 'button';
    button.id = 'bookingTimezone';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    control.appendChild(button);

    var panel = el('div', 'sch-tz-panel');
    panel.hidden = true;
    var search = document.createElement('input');
    search.type = 'search';
    search.className = 'sch-tz-search';
    search.placeholder = 'Search time zones';
    search.setAttribute('aria-label', 'Search time zones');
    panel.appendChild(search);
    var listBox = el('div', 'sch-tz-list');
    listBox.setAttribute('role', 'listbox');
    listBox.setAttribute('aria-labelledby', 'bookingTimezoneLabel');
    panel.appendChild(listBox);
    control.appendChild(panel);
    tz.appendChild(control);

    var values = timezoneValues();
    var common = ['America/Los_Angeles', 'America/Denver', 'America/Chicago',
      'America/New_York', 'Europe/London', 'UTC'];

    function optionRow(zone) {
      var row = el('button', 'sch-tz-option');
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', zone === state.timezone ? 'true' : 'false');
      row.appendChild(el('span', '', timezoneLabel(zone, false)));
      row.appendChild(el('span', 'sch-tz-time', new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hour: 'numeric', minute: '2-digit'
      }).format(new Date()).toLowerCase()));
      row.addEventListener('click', function () {
        state.timezone = zone;
        state.selectedDate = '';
        state.selectedSlot = null;
        state.pendingSlot = null;
        drawCalendar(stage);
        loadSlots();
      });
      return row;
    }

    function renderOptions(filter) {
      listBox.replaceChildren();
      var needle = String(filter || '').trim().toLowerCase();
      function matches(zone) {
        return !needle || zone.toLowerCase().indexOf(needle) !== -1 ||
          timezoneLabel(zone, false).toLowerCase().indexOf(needle) !== -1;
      }
      function group(title, zones) {
        var shown = zones.filter(matches);
        if (!shown.length) return;
        listBox.appendChild(el('div', 'sch-tz-group', title));
        shown.forEach(function (zone) { listBox.appendChild(optionRow(zone)); });
      }
      group('Detected', [deviceTimezone]);
      group('Common', common.filter(function (zone) { return zone !== deviceTimezone; }));
      group('All time zones', values.filter(function (zone) {
        return zone !== deviceTimezone && common.indexOf(zone) === -1;
      }));
      if (!listBox.childElementCount) {
        listBox.appendChild(el('p', 'sch-status-copy', 'No matching time zone.'));
      }
    }

    function closePanel() {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onOutside, true);
    }
    function onOutside(event) {
      if (!control.contains(event.target)) closePanel();
    }
    button.addEventListener('click', function () {
      if (panel.hidden) {
        renderOptions('');
        search.value = '';
        panel.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onOutside, true);
        search.focus();
      } else {
        closePanel();
      }
    });
    search.addEventListener('input', function () { renderOptions(search.value); });
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { closePanel(); button.focus(); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      var options = Array.prototype.slice.call(listBox.querySelectorAll('.sch-tz-option'));
      if (!options.length) return;
      var index = options.indexOf(document.activeElement);
      var target = event.key === 'ArrowDown' ?
        options[Math.min(options.length - 1, index + 1)] :
        (index <= 0 ? search : options[index - 1]);
      target.focus();
    });
    return tz;
  }

  async function loadSlots() {
    var stage = document.getElementById('scheduleStage');
    var live = document.getElementById('slotLive');
    var cached = monthCache[monthCacheKey(state.month)];
    if (cached && Date.now() - cached.fetchedAt < MONTH_CACHE_TTL) {
      state.slots = cached.slots;
      state.availabilityStatus = 'ready';
      state.availabilityError = null;
      state.selectedSlot = null;
      state.pendingSlot = null;
      if (stage) drawCalendar(stage);
      prefetchAdjacentMonth();
      return;
    }
    if (live) live.textContent = 'Checking availability…';
    state.availabilityStatus = 'loading';
    state.availabilityError = null;
    try {
      var slots = await fetchMonthSlots(state.month);
      state.slots = slots;
      state.availabilityStatus = 'ready';
      state.selectedDate = '';
      state.selectedSlot = null;
      state.pendingSlot = null;
      if (stage) drawCalendar(stage);
      prefetchAdjacentMonth();
    } catch (error) {
      state.slots = [];
      state.selectedDate = '';
      state.selectedSlot = null;
      state.pendingSlot = null;
      // A host whose calendar cannot be checked reads as "not open yet", the
      // same calm state as a page still being set up — never as a broken page,
      // and never as an open grid.
      state.availabilityStatus = error && (error.code === 'booking_not_ready' ||
        error.code === 'calendar_coverage_missing') ? 'pending' : 'error';
      state.availabilityError = error;
      if (stage) drawCalendar(stage);
    }
  }

  // Empty months should not turn into blind arrow-paging: walk forward through
  // availability until a month answers, then land on its first open day.
  async function jumpToNextAvailable(trigger) {
    trigger.disabled = true;
    trigger.textContent = 'Searching…';
    var probe = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
    try {
      for (var step = 0; step < 6; step += 1) {
        var slots = await fetchMonthSlots(probe);
        if (slots.length) {
          state.month = probe;
          state.slots = slots;
          state.availabilityStatus = 'ready';
          state.availabilityError = null;
          state.selectedDate = dateKey(new Date(slots[0].startsAt), state.timezone);
          state.selectedSlot = null;
          state.pendingSlot = null;
          var stage = document.getElementById('scheduleStage');
          if (stage) drawCalendar(stage);
          prefetchAdjacentMonth();
          return;
        }
        probe = new Date(probe.getFullYear(), probe.getMonth() + 1, 1);
      }
      trigger.disabled = false;
      trigger.textContent = 'No times in the next six months';
    } catch (error) {
      showToast(error.message, true);
      trigger.disabled = false;
      trigger.textContent = 'Jump to the next available day';
    }
  }

  function renderCalendar() {
    stopHoldTimer();
    state.slots = [];
    state.availabilityStatus = 'loading';
    state.availabilityError = null;
    state.selectedDate = '';
    state.selectedSlot = null;
    state.pendingSlot = null;
    var stage = shell(state.profile, state.eventType);
    drawCalendar(stage);
    loadSlots();
  }

  function drawCalendar(stage) {
    stage.replaceChildren();
    var booker = stage.closest('.sch-booker');
    if (booker) booker.classList.toggle('sch-booker-expanded', !!state.selectedDate);
    stage.appendChild(stageHeader(
      matchMedia('(max-width:640px)').matches ? 'Select a day' : 'Select a date & time',
      '',
      state.profile.eventTypes.length > 1 ? renderEventTypes : null
    ));
    var layout = el('div', 'sch-calendar-layout' + (state.selectedDate ? ' has-selection' : ''));
    var card = el('div', 'sch-calendar-card');
    var monthHead = el('div', 'sch-month-head');
    var previous = el('button', 'sch-month-nav-button', '‹');
    previous.type = 'button';
    previous.setAttribute('aria-label', 'Previous month');
    var now = new Date();
    var currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    previous.disabled = state.month <= currentMonth;
    previous.addEventListener('click', function () {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
      state.selectedDate = '';
      state.pendingSlot = null;
      drawCalendar(stage);
      loadSlots();
      requestAnimationFrame(function () {
        var control = stage.querySelector('[aria-label="Previous month"]');
        if (control) control.focus();
      });
    });
    monthHead.appendChild(previous);
    var monthTitle = el('div', 'sch-month-title', new Intl.DateTimeFormat('en-US', {
      month: 'long', year: 'numeric'
    }).format(state.month));
    monthTitle.id = 'bookingMonth';
    monthTitle.setAttribute('aria-live', 'polite');
    monthHead.appendChild(monthTitle);
    var next = el('button', 'sch-month-nav-button', '›');
    next.type = 'button';
    next.setAttribute('aria-label', 'Next month');
    next.addEventListener('click', function () {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
      state.selectedDate = '';
      state.pendingSlot = null;
      drawCalendar(stage);
      loadSlots();
      requestAnimationFrame(function () {
        var control = stage.querySelector('[aria-label="Next month"]');
        if (control) control.focus();
      });
    });
    monthHead.appendChild(next);
    card.appendChild(monthHead);
    var weekdays = el('div', 'sch-weekdays');
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (day) {
      weekdays.appendChild(el('span', '', day));
    });
    card.appendChild(weekdays);
    var grid = el('div', 'sch-days');
    if (state.availabilityStatus === 'loading') grid.classList.add('sch-loading');
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-labelledby', 'bookingMonth');
    var first = new Date(state.month.getFullYear(), state.month.getMonth(), 1);
    var cursor = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    var visibleCellCount = Math.ceil((first.getDay() +
      new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7) * 7;
    var byDate = slotsByDate();
    var today = dateKey(new Date(), state.timezone);
    for (var i = 0; i < visibleCellCount; i += 1) {
      (function (date) {
        if (date.getMonth() !== state.month.getMonth()) {
          var placeholder = el('span', 'sch-day-placeholder');
          placeholder.setAttribute('aria-hidden', 'true');
          grid.appendChild(placeholder);
          return;
        }
        var key = [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, '0'),
          String(date.getDate()).padStart(2, '0')
        ].join('-');
        var button = el('button', 'sch-day', String(date.getDate()));
        button.type = 'button';
        button.disabled = !byDate[key] || !byDate[key].length;
        if (byDate[key] && byDate[key].length) button.classList.add('available');
        if (key === state.selectedDate) button.classList.add('selected');
        if (key === today) {
          button.classList.add('today');
          button.setAttribute('aria-current', 'date');
        }
        button.setAttribute('aria-pressed', key === state.selectedDate ? 'true' : 'false');
        button.setAttribute('aria-label', new Intl.DateTimeFormat('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
        }).format(date) + ((byDate[key] || []).length ? ', available' : ', unavailable'));
        button.addEventListener('click', function () {
          state.selectedDate = key;
          state.pendingSlot = null;
          drawCalendar(stage);
          requestAnimationFrame(function () {
            var firstSlot = stage.querySelector('.sch-slot');
            if (firstSlot) {
              firstSlot.focus({ preventScroll: true });
              if (matchMedia('(max-width:900px)').matches) {
                firstSlot.scrollIntoView({
                  behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth',
                  block: 'center'
                });
              }
            }
          });
        });
        grid.appendChild(button);
      })(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    card.appendChild(grid);
    card.appendChild(renderTimezoneControl(stage));
    layout.appendChild(card);

    if (state.selectedDate) {
      var slotsPanel = el('div', 'sch-slots');
      var dateSlots = byDate[state.selectedDate] || [];
      var slotsTitle = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric'
      }).format(new Date(state.selectedDate + 'T12:00:00Z'));
      slotsPanel.appendChild(el('div', 'sch-slots-title', slotsTitle));
      var list = el('div', 'sch-slot-list');
      dateSlots.forEach(function (slot, index) {
        var pending = state.pendingSlot && state.pendingSlot.startsAt === slot.startsAt;
        var row;
        if (pending) {
          // Calendly's two-tap contract: the first tap only arms the time, the
          // second moves on to the details step. It says «Next», never
          // «Confirm»: nothing is booked until the details step's own
          // «Confirm booking» (2026-10-04 — a candidate read «Confirm» here as
          // the booking itself and left before giving his details).
          row = el('div', 'sch-slot-split');
          row.appendChild(el('span', 'sch-slot-time', formatTime(slot.startsAt)));
          var confirm = el('button', 'sch-slot-confirm', 'Next');
          confirm.type = 'button';
          confirm.setAttribute('aria-label', 'Next: enter your details for ' + formatTime(slot.startsAt));
          confirm.addEventListener('click', function () { chooseSlot(slot); });
          row.appendChild(confirm);
          requestAnimationFrame(function () { confirm.focus({ preventScroll: true }); });
        } else {
          row = el('button', 'sch-slot', formatTime(slot.startsAt));
          row.type = 'button';
          row.setAttribute('aria-label', formatTime(slot.startsAt) + ', tap to select');
          row.addEventListener('click', function () {
            state.pendingSlot = slot;
            drawCalendar(stage);
          });
        }
        row.style.animationDelay = Math.min(index, 10) * 24 + 'ms';
        list.appendChild(row);
      });
      if (!dateSlots.length) list.appendChild(el('p', 'sch-status-copy', 'No times remain on this day.'));
      slotsPanel.appendChild(list);
      layout.appendChild(slotsPanel);
    }
    stage.appendChild(layout);

    if (!state.selectedDate && (state.availabilityStatus === 'pending' ||
        state.availabilityStatus === 'error')) {
      var unavailable = el('div', 'sch-calendar-status');
      unavailable.appendChild(icon('calendar'));
      var unavailableCopy = el('div');
      unavailableCopy.appendChild(el('strong', '', 'Scheduling is temporarily unavailable'));
      unavailableCopy.appendChild(el('span', '', 'Please try again in a moment.'));
      var retry = el('button', 'btn btn-ghost btn-sm', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', loadSlots);
      unavailableCopy.appendChild(retry);
      unavailable.appendChild(unavailableCopy);
      stage.appendChild(unavailable);
    } else if (!state.selectedDate && state.availabilityStatus === 'ready' &&
        !state.slots.length) {
      var empty = el('div', 'sch-calendar-status');
      empty.appendChild(icon('calendar'));
      var emptyCopy = el('div');
      emptyCopy.appendChild(el('strong', '', 'No available times this month'));
      emptyCopy.appendChild(el('span', '', 'The next opening may be further out.'));
      var jump = el('button', 'btn btn-primary btn-sm', 'Jump to the next available day');
      jump.type = 'button';
      jump.addEventListener('click', function () { jumpToNextAvailable(jump); });
      emptyCopy.appendChild(jump);
      empty.appendChild(emptyCopy);
      stage.appendChild(empty);
    }

    var liveMessage = state.availabilityStatus === 'error' ||
      state.availabilityStatus === 'pending' ?
      'Scheduling is temporarily unavailable. Please try again.' :
      state.availabilityStatus === 'ready' ?
        (state.slots.length ?
          state.slots.length + ' available times found.' :
          'No available times in this month.') :
        'Checking availability…';
    var live = el('div', 'sch-live', liveMessage);
    live.id = 'slotLive';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    stage.appendChild(live);
    notifyEmbedHeight();
  }

  async function chooseSlot(slot) {
    state.selectedSlot = slot;
    var live = document.getElementById('slotLive');
    if (live) live.textContent = 'Holding ' + formatTime(slot.startsAt) + '…';
    try {
      var data = await api('/api/scheduling/public/' + encodeURIComponent(state.hostSlug) +
        '/' + encodeURIComponent(state.eventSlug) + '/holds', {
        method: 'POST',
        body: JSON.stringify({ startsAt: slot.startsAt })
      });
      state.hold = data.hold;
      renderInviteeForm();
    } catch (error) {
      showToast(error.message, true);
      delete monthCache[monthCacheKey(state.month)];
      loadSlots();
    }
  }

  // The five-minute hold must be visible, not a surprise at submit time: a live
  // countdown in the form header, one silent re-hold when it lapses, and an
  // honest return to the calendar only when the slot is truly gone.
  var holdTimerId = 0;
  function stopHoldTimer() {
    if (holdTimerId) clearInterval(holdTimerId);
    holdTimerId = 0;
  }

  function startHoldTimer(subtitle) {
    stopHoldTimer();
    if (!state.hold || !state.hold.expiresAt) {
      subtitle.textContent = 'Your time is held for five minutes.';
      return;
    }
    var renewing = false;
    function tick() {
      var left = new Date(state.hold.expiresAt).getTime() - Date.now();
      if (left > 0) {
        var minutes = Math.floor(left / 60000);
        var seconds = Math.floor((left % 60000) / 1000);
        subtitle.textContent = 'Your time is held for ' + minutes + ':' +
          String(seconds).padStart(2, '0') + '.';
        subtitle.classList.toggle('sch-hold-low', left < 60000);
        return;
      }
      if (renewing) return;
      renewing = true;
      subtitle.textContent = 'Re-holding your time…';
      api('/api/scheduling/public/' + encodeURIComponent(state.hostSlug) +
        '/' + encodeURIComponent(state.eventSlug) + '/holds', {
        method: 'POST',
        body: JSON.stringify({ startsAt: state.selectedSlot.startsAt })
      }).then(function (data) {
        state.hold = data.hold;
        renewing = false;
        subtitle.classList.remove('sch-hold-low');
        tick();
      }).catch(function () {
        stopHoldTimer();
        showToast('This time was released. Please pick a time again.', true);
        delete monthCache[monthCacheKey(state.month)];
        renderCalendar();
      });
    }
    tick();
    holdTimerId = setInterval(tick, 1000);
  }

  function addField(form, id, labelText, type, required) {
    var field = el('div', 'field');
    var label = el('label', '', labelText);
    label.htmlFor = id;
    var input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    input.id = id;
    input.name = id;
    if (type !== 'textarea') input.type = type;
    input.required = !!required;
    input.autocomplete = id === 'inviteeName' ? 'name' : id === 'inviteeEmail' ? 'email' : 'off';
    field.appendChild(label);
    field.appendChild(input);
    form.appendChild(field);
    return input;
  }

  function renderInviteeForm() {
    var stage = document.getElementById('scheduleStage');
    stage.replaceChildren();
    stage.appendChild(stageHeader('Confirm your details', 'Your time is held for five minutes.', renderCalendar));
    startHoldTimer(stage.querySelector('.sch-stage-head p'));
    var form = el('form', 'sch-form');
    // The selected time is a choice, not a booking: the card says so in words,
    // and the only way forward is the explicit «Confirm booking» below.
    var summary = el('div', 'sch-form-summary');
    summary.appendChild(icon('calendar'));
    var summaryCopy = el('div');
    summaryCopy.appendChild(el('span', 'eyebrow', 'Selected time · not booked yet'));
    summaryCopy.appendChild(el('strong', '', state.eventType.name));
    summaryCopy.appendChild(el('span', '', formatFull(state.selectedSlot.startsAt)));
    summary.appendChild(summaryCopy);
    form.appendChild(summary);
    var name = addField(form, 'inviteeName', 'Name', 'text', true);
    var email = addField(form, 'inviteeEmail', 'Email', 'email', true);
    if (state.invitee) {
      if (state.invitee.name) name.value = state.invitee.name;
      if (state.invitee.email) email.value = state.invitee.email;
    }
    var guestInputs = [];
    if (state.eventType.guestsAllowed) {
      var guestList = el('div', 'sch-guest-list');
      guestList.id = 'bookingGuests';
      var addGuest = el('button', 'btn btn-ghost sch-add-guests', 'Add guests');
      addGuest.type = 'button';
      addGuest.setAttribute('aria-controls', guestList.id);
      addGuest.addEventListener('click', function () {
        var row = el('div', 'sch-guest-row');
        var wrapper = el('div', 'field');
        var id = 'inviteeGuest' + guestInputs.length;
        var guestLabel = el('label', '', 'Guest email');
        guestLabel.htmlFor = id;
        var input = document.createElement('input');
        input.type = 'email';
        input.id = id;
        input.name = 'inviteeGuest';
        input.autocomplete = 'email';
        wrapper.appendChild(guestLabel);
        wrapper.appendChild(input);
        var remove = el('button', 'sch-guest-remove', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove guest');
        remove.addEventListener('click', function () {
          guestInputs = guestInputs.filter(function (candidate) { return candidate !== input; });
          row.remove();
          notifyEmbedHeight();
          addGuest.focus();
        });
        row.appendChild(wrapper);
        row.appendChild(remove);
        guestList.appendChild(row);
        guestInputs.push(input);
        input.focus();
        notifyEmbedHeight();
      });
      form.appendChild(addGuest);
      form.appendChild(guestList);
    }
    var questionInputs = [];
    (state.eventType.questions || []).forEach(function (question, index) {
      var input = addField(form, 'question' + index, question.label, 'textarea', question.required);
      input.rows = 3;
      questionInputs.push({ question: question, input: input });
    });
    // A refused booking is said on the form itself (not only in a toast that
    // fades): what went wrong and that the button can be pressed again.
    var formError = el('div', 'banner bad sch-form-error');
    formError.setAttribute('role', 'alert');
    formError.hidden = true;
    var actions = el('div', 'sch-form-actions');
    var submit = el('button', 'btn btn-primary', 'Confirm booking');
    submit.type = 'submit';
    actions.appendChild(submit);
    var back = el('button', 'btn btn-ghost', 'Back');
    back.type = 'button';
    back.addEventListener('click', renderCalendar);
    actions.appendChild(back);
    form.appendChild(actions);
    // A host whose calls are recorded (a dedicated notes assistant — the
    // interviewer) asks for an explicit tick on the Scheduling Terms, whose
    // «Calls» clause is the recording consent (approved demo 2026-09-25; the
    // interviewer is told «Candidates agree to recording when they book»).
    // Everyone else keeps the one-line notice.
    if (state.profile && state.profile.recordsCalls) {
      var termsRow = el('label', 'chk sch-terms');
      var termsBox = document.createElement('input');
      termsBox.type = 'checkbox';
      termsBox.required = true;
      termsBox.id = 'schTerms';
      termsRow.appendChild(termsBox);
      var termsText = document.createElement('span');
      termsText.appendChild(document.createTextNode('I agree to the '));
      var schTermsLink = el('a', '', 'Scheduling Terms');
      schTermsLink.href = '/meet/terms';
      schTermsLink.target = '_blank';
      schTermsLink.rel = 'noopener';
      termsText.appendChild(schTermsLink);
      termsText.appendChild(document.createTextNode(', including the recording of calls, and the '));
      var schPrivacyLink = el('a', '', 'Privacy Policy');
      schPrivacyLink.href = legalUrl;
      schPrivacyLink.target = '_blank';
      schPrivacyLink.rel = 'noopener';
      termsText.appendChild(schPrivacyLink);
      termsText.appendChild(document.createTextNode(' of Silicon Valley Investclub.'));
      termsRow.appendChild(termsText);
      form.insertBefore(termsRow, actions);
    } else {
      var legal = el('p', 'sch-legal');
      legal.appendChild(document.createTextNode('By proceeding, you agree to the SVIC '));
      var termsLink = el('a', '', 'Terms');
      termsLink.href = legalUrl;
      termsLink.target = '_blank';
      termsLink.rel = 'noopener';
      legal.appendChild(termsLink);
      legal.appendChild(document.createTextNode(' and '));
      var privacyLink = el('a', '', 'Privacy Policy');
      privacyLink.href = legalUrl;
      privacyLink.target = '_blank';
      privacyLink.rel = 'noopener';
      legal.appendChild(privacyLink);
      legal.appendChild(document.createTextNode('.'));
      form.appendChild(legal);
    }
    form.insertBefore(formError, actions);
    // One key per attempt to book this time: a retry after a network blip
    // replays the same request instead of creating a second booking.
    var idempotencyKey = newIdempotencyKey();
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      formError.hidden = true;
      formError.textContent = '';
      var seenGuests = new Set();
      var guestRows = [];
      var inviteeEmail = String(email.value || '').trim().toLowerCase();
      var invalidGuest = null;
      guestInputs.forEach(function (input) {
        input.setCustomValidity('');
        var value = String(input.value || '').trim().toLowerCase();
        if (!value) return;
        if (value === inviteeEmail || seenGuests.has(value)) {
          input.setCustomValidity(value === inviteeEmail ?
            'The invitee is already included.' : 'This guest is already included.');
          invalidGuest = invalidGuest || input;
          return;
        }
        seenGuests.add(value);
        guestRows.push({ email: value });
      });
      if (invalidGuest || !form.reportValidity()) {
        if (invalidGuest) invalidGuest.focus();
        return;
      }
      submit.disabled = true;
      submit.classList.add('loading');
      submit.textContent = 'Booking…';
      stopHoldTimer();
      function bookingRequest() {
        return api('/api/scheduling/public/' + encodeURIComponent(state.hostSlug) +
          '/' + encodeURIComponent(state.eventSlug) + '/bookings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey
          },
          body: JSON.stringify({
            startsAt: state.selectedSlot.startsAt,
            holdToken: state.hold.token,
            invitee: { name: name.value, email: email.value, timezone: state.timezone },
            guests: guestRows,
            answers: questionInputs.map(function (row) {
              return { key: row.question.key, label: row.question.label, value: row.input.value };
            }),
            source: 'svic-public',
            // A candidate's personal invitation link: the booking binds to
            // their application (the server verifies the signature).
            applicationToken: query.get('app') || undefined,
            // The LinkedIn hiring path's personal code (?c=…): the same binding,
            // resolved through the candidate's code (2026-09-29).
            applicationCode: query.get('c') || undefined
          })
        });
      }
      try {
        var data;
        try {
          data = await bookingRequest();
        } catch (first) {
          // The five-minute hold lapsed while the form was open: hold the
          // same time again and book it in one go; only a time that is
          // really gone goes back to the person.
          if (first.code !== 'hold_expired') throw first;
          var renewed = await api('/api/scheduling/public/' + encodeURIComponent(state.hostSlug) +
            '/' + encodeURIComponent(state.eventSlug) + '/holds', {
            method: 'POST',
            body: JSON.stringify({ startsAt: state.selectedSlot.startsAt })
          });
          state.hold = renewed.hold;
          data = await bookingRequest();
        }
        // Success is shown ONLY for a booking the server created and returned.
        if (!data || !data.booking || !data.booking.id || !data.booking.startsAt) {
          var empty = new Error('The booking was not confirmed.');
          empty.code = 'booking_not_confirmed';
          empty.status = 200;
          throw empty;
        }
        await renderBookingProgress(data.booking);
      } catch (error) {
        var message = error && error.message ? error.message : 'The booking did not go through.';
        if (error && error.status == null) message = 'No connection to the booking service. Check your connection';
        message = String(message).replace(/[.!?]*\s*$/, '.');
        formError.textContent = message + (error && (error.code === 'slot_conflict' || error.code === 'invalid_slot') ?
          ' Go back and pick another time.' : ' Your time is not booked yet — you can press Confirm booking again.');
        formError.hidden = false;
        submit.disabled = false;
        submit.classList.remove('loading');
        submit.textContent = 'Confirm booking';
        formError.scrollIntoView({ block: 'nearest' });
        startHoldTimer(stage.querySelector('.sch-stage-head p'));
      }
    });
    stage.appendChild(form);
    // On a phone the details step replaces the calendar below the host card:
    // bring its heading into view so the form is what the person sees.
    revealStage(stage);
    if (!name.value) name.focus({ preventScroll: true });
    notifyEmbedHeight();
  }

  // Instant, never smooth: a smooth scroll is skipped in a background or
  // throttled tab and leaves the person looking at the footer below a form
  // they never see (2026-10-04, measured on the site). scroll-margin-top on
  // .sch-stage keeps the heading clear of the site's sticky top bar.
  function revealStage(stage) {
    if (embedded || !stage || typeof stage.getBoundingClientRect !== 'function') return;
    var top = stage.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.35) {
      stage.scrollIntoView({ block: 'start' });
    }
  }

  function newIdempotencyKey() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (_) { /* older WebKit without randomUUID */ }
    var bytes = new Uint8Array(16);
    try { window.crypto.getRandomValues(bytes); } catch (_) {
      for (var i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  async function loadInviteePrefill() {
    if (!personalLink || !state.hostSlug || !state.eventSlug) return;
    try {
      var qs = new URLSearchParams();
      if (query.get('c')) qs.set('c', query.get('c'));
      if (query.get('app')) qs.set('app', query.get('app'));
      var data = await api('/api/scheduling/public/' + encodeURIComponent(state.hostSlug) +
        '/' + encodeURIComponent(state.eventSlug) + '/invitee?' + qs.toString());
      if (data && data.invitee) state.invitee = data.invitee;
    } catch (_) { /* pre-fill is a courtesy; the form works without it */ }
  }

  function confirmationRow(list, label, value) {
    var row = el('div', 'sch-confirmation-row');
    row.appendChild(el('dt', '', label));
    row.appendChild(el('dd', '', value));
    list.appendChild(row);
  }

  function googleCalendarUrl(booking) {
    var params = new URLSearchParams({
      action: 'TEMPLATE',
      text: state.eventType.name + ' — ' + booking.inviteeName,
      dates: new Date(booking.startsAt).toISOString().replace(/[-:]/g, '').replace('.000', '') +
        '/' + new Date(booking.endsAt).toISOString().replace(/[-:]/g, '').replace('.000', ''),
      details: 'Scheduled by Silicon Valley Investclub'
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  function outlookCalendarUrl(booking) {
    var params = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: state.eventType.name + ' — ' + booking.inviteeName,
      startdt: new Date(booking.startsAt).toISOString(),
      enddt: new Date(booking.endsAt).toISOString(),
      body: 'Scheduled by Silicon Valley Investclub'
    });
    return 'https://outlook.office.com/calendar/0/deeplink/compose?' + params.toString();
  }

  function downloadIcs(booking) {
    function clean(value) {
      return String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
        .replace(/,/g, '\\,').replace(/;/g, '\\;');
    }
    function stamp(value) {
      return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    }
    var content = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SVIC//Scheduling//EN',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      'UID:' + clean(booking.id) + '@siliconvalleyinvestclub.com',
      'DTSTAMP:' + stamp(new Date()), 'DTSTART:' + stamp(booking.startsAt),
      'DTEND:' + stamp(booking.endsAt), 'SUMMARY:' + clean(state.eventType.name),
      'DESCRIPTION:' + clean('Scheduled with ' + state.profile.displayName),
      'END:VEVENT', 'END:VCALENDAR', ''
    ].join('\r\n');
    var link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    link.download = 'svic-meeting.ics';
    document.body.appendChild(link);
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 0);
  }

  function renderConfirmation(booking) {
    if (booking.status !== 'confirmed') return renderPendingConfirmation(booking);
    var stage = document.getElementById('scheduleStage');
    stage.replaceChildren();
    var box = el('div', 'sch-success');
    var mark = el('div', 'sch-success-mark');
    mark.appendChild(icon('check'));
    box.appendChild(mark);
    box.appendChild(el('h2', '', 'You are scheduled'));
    box.appendChild(el('p', '', 'A calendar invitation with the meeting details is on its way to ' +
      booking.inviteeEmail + '.'));
    var list = el('dl', 'sch-confirmation');
    confirmationRow(list, 'Event', state.eventType.name);
    confirmationRow(list, 'With', state.profile.displayName);
    confirmationRow(list, 'When', formatFull(booking.startsAt));
    confirmationRow(list, 'Duration', state.eventType.durationMinutes + ' minutes');
    box.appendChild(list);
    var actions = el('div', 'sch-form-actions');
    var google = el('a', 'btn btn-primary', 'Add to Google Calendar');
    google.href = googleCalendarUrl(booking);
    google.target = '_blank';
    google.rel = 'noopener';
    actions.appendChild(google);
    var outlook = el('a', 'btn btn-ghost', 'Add to Outlook');
    outlook.href = outlookCalendarUrl(booking);
    outlook.target = '_blank';
    outlook.rel = 'noopener';
    actions.appendChild(outlook);
    var ics = el('button', 'btn btn-ghost', 'Download .ics');
    ics.type = 'button';
    ics.addEventListener('click', function () { downloadIcs(booking); });
    actions.appendChild(ics);
    if (!personalLink) {
      var again = el('a', 'btn btn-ghost', 'Schedule another');
      again.href = '/meet/' + encodeURIComponent(state.hostSlug);
      actions.appendChild(again);
    }
    box.appendChild(actions);
    if (booking.cancelToken) {
      var manage = el('p', 'sch-manage');
      manage.appendChild(document.createTextNode('Plans changed? '));
      var manageLink = el('a', '', 'Reschedule or cancel this meeting');
      manageLink.href = '/booking/' + encodeURIComponent(booking.cancelToken);
      manage.appendChild(manageLink);
      manage.appendChild(document.createTextNode('.'));
      box.appendChild(manage);
    }
    stage.appendChild(box);
  }

  function renderPendingConfirmation(booking) {
    var stage = document.getElementById('scheduleStage');
    stage.replaceChildren();
    var box = el('div', 'sch-success');
    var mark = el('div', 'sch-success-mark');
    mark.appendChild(icon('calendar'));
    box.appendChild(mark);
    box.appendChild(el('h2', '', 'Booking received'));
    var status = el('p', '', 'Your booking is being finalized. Calendar and email confirmations are on the way.');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    box.appendChild(status);
    var list = el('dl', 'sch-confirmation');
    confirmationRow(list, 'Event', state.eventType.name);
    confirmationRow(list, 'With', state.profile.displayName);
    confirmationRow(list, 'When', formatFull(booking.startsAt));
    box.appendChild(list);
    stage.appendChild(box);
    notifyEmbedHeight();
  }

  async function renderBookingProgress(booking) {
    if (booking.status === 'confirmed') return renderConfirmation(booking);
    renderPendingConfirmation(booking);
    if (!booking.cancelToken) return;
    for (var attempt = 0; attempt < 15; attempt += 1) {
      await new Promise(function (resolve) { setTimeout(resolve, 1000); });
      try {
        var data = await api('/api/scheduling/public/bookings/' +
          encodeURIComponent(booking.cancelToken));
        if (data.booking.status === 'confirmed') {
          return renderConfirmation(Object.assign({}, booking, {
            status: data.booking.status,
            startsAt: data.booking.startsAt,
            endsAt: data.booking.endsAt,
          }));
        }
        if (data.booking.status === 'canceled') {
          state.capability = data.booking;
          state.capabilityToken = booking.cancelToken;
          return renderCancellation();
        }
      } catch (_) {
        // The booking is durable; a transient status read must not erase the
        // honest pending state. The outbox keeps retrying independently.
      }
    }
  }

  function renderUnavailable(error) {
    var stage = document.getElementById('scheduleStage') || shell(
      state.profile || { displayName: 'Silicon Valley Investclub', timezone: 'UTC', eventTypes: [] },
      state.eventType
    );
    stage.replaceChildren();
    // A page that is not published (a new colleague's draft) is not an outage:
    // «temporarily unavailable» told a guest to retry a page that does not open
    // until its owner publishes it (rehearsal 2026-10-23).
    var notOpen = error && (error.code === 'profile_not_found' || error.status === 404);
    stage.appendChild(stageHeader(notOpen ? 'Booking page not open' : 'Scheduling unavailable'));
    var message = el('div', 'sch-inline-status');
    message.appendChild(el('strong', '', notOpen ? 'This booking page is not open yet.' : 'Scheduling is temporarily unavailable.'));
    message.appendChild(el('span', '', notOpen ? 'Ask the person who shared the link for a time, or try again later.' : 'Please try again shortly.'));
    stage.appendChild(message);
  }

  async function loadCapability() {
    try {
      // The email's Cancel link carries ?action=cancel; the page forwards it,
      // because the platform sends no Referer the server could read it from.
      var wantsCancel = query.get('action') === 'cancel';
      var data = await api('/api/scheduling/public/bookings/' + encodeURIComponent(state.capabilityToken) +
        (wantsCancel ? '?action=cancel' : ''));
      state.capability = data.booking;
      var profile = {
        displayName: data.booking.host.name,
        title: data.booking.eventType,
        description: '',
        avatarUrl: data.booking.host.avatarUrl || null,
        timezone: data.booking.host.timezone,
        eventTypes: []
      };
      state.profile = profile;
      state.eventType = {
        name: data.booking.eventType,
        durationMinutes: Math.round((new Date(data.booking.endsAt) - new Date(data.booking.startsAt)) / 60000),
        locationType: 'google_meet'
      };
      state.timezone = data.booking.inviteeTimezone || state.timezone;
      if (data.booking.manageable === false && data.booking.status !== 'canceled') {
        return renderManageClosed(data.booking);
      }
      if (data.booking.capability === 'reschedule') renderReschedule();
      else renderCancellation();
    } catch (error) {
      state.profile = { displayName: 'Silicon Valley Investclub', timezone: 'UTC', eventTypes: [] };
      renderUnavailable(error);
    }
  }

  // Inside the host's notice window (24 hours by default) the server refuses
  // both a move and a cancellation; the page says so up front and points the
  // guest at the host instead of showing controls that would fail.
  function renderManageClosed(booking) {
    var stage = shell(state.profile, state.eventType);
    var hours = booking.manageWindowHours || 24;
    stage.appendChild(stageHeader('This meeting is locked in',
      'Changes are possible only up to ' + hours + ' hours before the start.'));
    var box = el('div', 'sch-confirm');
    box.appendChild(el('div', 'banner warn',
      'Your meeting with ' + booking.host.name + ' starts ' + formatFull(booking.startsAt) +
      '. It can no longer be rescheduled or canceled online.'));
    var help = el('p', 'sch-manage');
    help.appendChild(document.createTextNode('Need to change it anyway? Write to '));
    var mail = el('a', '', booking.hostContact || booking.host.name);
    if (booking.hostContact) mail.href = 'mailto:' + booking.hostContact;
    help.appendChild(mail);
    help.appendChild(document.createTextNode(' and the host will sort it out with you.'));
    box.appendChild(help);
    if (booking.meetingUrl) {
      var actions = el('div', 'sch-form-actions');
      var join = el('a', 'btn btn-primary', 'Join meeting');
      join.href = booking.meetingUrl;
      join.target = '_blank';
      join.rel = 'noopener';
      actions.appendChild(join);
      box.appendChild(actions);
    }
    stage.appendChild(box);
  }

  function renderCancellation() {
    var booking = state.capability;
    var stage = shell(state.profile, state.eventType);
    stage.appendChild(stageHeader('Cancel this meeting'));
    var box = el('div', 'sch-success');
    var list = el('dl', 'sch-confirmation');
    confirmationRow(list, 'Event', booking.eventType);
    confirmationRow(list, 'With', booking.host.name);
    confirmationRow(list, 'When', formatFull(booking.startsAt));
    confirmationRow(list, 'Status', booking.status);
    box.appendChild(list);
    if (booking.status === 'canceled') {
      box.appendChild(el('div', 'banner ok', 'This meeting has already been canceled.'));
    } else {
      var reasonField = el('div', 'field');
      var label = el('label', '', 'Reason (optional)');
      label.htmlFor = 'cancelReason';
      var input = document.createElement('textarea');
      input.id = 'cancelReason';
      input.rows = 3;
      reasonField.appendChild(label);
      reasonField.appendChild(input);
      box.appendChild(reasonField);
      var cancel = el('button', 'btn btn-danger', 'Cancel meeting');
      cancel.type = 'button';
      cancel.addEventListener('click', async function () {
        cancel.disabled = true;
        try {
          await api('/api/scheduling/public/bookings/' + encodeURIComponent(state.capabilityToken) + '/cancel', {
            method: 'POST', body: JSON.stringify({ reason: input.value, email: booking.inviteeEmail })
          });
          booking.status = 'canceled';
          renderCancellation();
        } catch (error) {
          showToast(error.message, true);
          cancel.disabled = false;
        }
      });
      box.appendChild(cancel);
    }
    stage.appendChild(box);
  }

  async function renderReschedule() {
    var stage = shell(state.profile, state.eventType);
    stage.appendChild(stageHeader('Choose a new time', 'Your current meeting remains booked until the new time is confirmed.'));
    var status = el('div', 'sch-status-copy', 'Checking availability…');
    stage.appendChild(status);
    try {
      var from = new Date();
      var to = new Date(from.getTime() + 21 * 86_400_000);
      var data = await api('/api/scheduling/public/bookings/' + encodeURIComponent(state.capabilityToken) +
        '/availability?from=' + encodeURIComponent(from.toISOString()) +
        '&to=' + encodeURIComponent(to.toISOString()));
      var list = el('div', 'sch-slot-list');
      (data.slots || []).forEach(function (slot) {
        var button = el('button', 'sch-slot', formatFull(slot.startsAt));
        button.type = 'button';
        button.addEventListener('click', async function () {
          button.disabled = true;
          try {
            var result = await api('/api/scheduling/public/bookings/' +
              encodeURIComponent(state.capabilityToken) + '/reschedule', {
              method: 'POST', body: JSON.stringify({ startsAt: slot.startsAt })
            });
            state.capability.startsAt = result.booking.startsAt;
            state.capability.endsAt = result.booking.endsAt;
            state.capability.capability = 'reschedule';
            state.capabilityToken = result.booking.rescheduleToken;
            renderCapabilitySuccess('Meeting rescheduled', result.booking.startsAt);
          } catch (error) {
            showToast(error.message, true);
            button.disabled = false;
          }
        });
        list.appendChild(button);
      });
      status.replaceWith(list);
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function renderCapabilitySuccess(title, startsAt) {
    var stage = shell(state.profile, state.eventType);
    var box = el('div', 'sch-success');
    var mark = el('div', 'sch-success-mark');
    mark.appendChild(icon('check'));
    box.appendChild(mark);
    box.appendChild(el('h2', '', title));
    box.appendChild(el('p', '', formatFull(startsAt)));
    stage.appendChild(box);
  }

  // Deterministic preview states for capture gates and pixel review: the deep
  // screens (times list, armed Confirm, details form, confirmation) render from
  // the real profile plus stubbed slots. No booking API is written.
  async function renderPreviewState(kind) {
    var data = await api('/api/scheduling/public/' + encodeURIComponent(state.hostSlug));
    state.profile = data.profile;
    state.eventType = state.profile.eventTypes[0];
    state.eventSlug = state.eventType.slug;
    var base = new Date();
    base.setDate(base.getDate() + 14);
    base.setHours(17, 0, 0, 0);
    var slots = [];
    for (var i = 0; i < 8; i += 1) {
      slots.push({ startsAt: new Date(base.getTime() + i * 3600000).toISOString() });
    }
    state.slots = slots;
    state.availabilityStatus = 'ready';
    state.selectedDate = dateKey(base, state.timezone);
    state.month = new Date(base.getFullYear(), base.getMonth(), 1);
    if (kind === 'slots' || kind === 'armed') {
      if (kind === 'armed') state.pendingSlot = slots[2];
      drawCalendar(shell(state.profile, state.eventType));
      return;
    }
    state.selectedSlot = slots[2];
    if (kind === 'form') {
      state.hold = { token: 'preview', expiresAt: new Date(Date.now() + 270000).toISOString() };
      shell(state.profile, state.eventType);
      renderInviteeForm();
      return;
    }
    if (kind === 'confirm') {
      shell(state.profile, state.eventType);
      renderConfirmation({
        status: 'confirmed',
        inviteeEmail: 'guest@example.com',
        inviteeName: 'Alex Guest',
        cancelToken: 'preview-token',
        id: 'preview',
        startsAt: state.selectedSlot.startsAt,
        endsAt: new Date(base.getTime() + 2 * 3600000 + 1800000).toISOString()
      });
      return;
    }
    renderCalendar();
  }

  async function init() {
    parseRoute();
    if (state.mode === 'capability') return loadCapability();
    if (!state.hostSlug) return renderUnavailable(new Error('Missing host'));
    var preview = query.get('__preview');
    if (preview) {
      try { return await renderPreviewState(preview); }
      catch (error) { return renderUnavailable(error); }
    }
    try {
      if (state.mode === 'routing') {
        var routing = await api('/api/scheduling/public/' + encodeURIComponent(state.hostSlug) +
          '/route/' + encodeURIComponent(state.formSlug));
        renderRoutingForm(routing);
        document.title = routing.form.name + ' — Silicon Valley Investclub';
        return;
      }
      var data = await api('/api/scheduling/public/' + encodeURIComponent(state.hostSlug));
      state.profile = data.profile;
      if (!state.profile.eventTypes.length) throw new Error('No public event types');
      state.eventType = state.profile.eventTypes.find(function (row) {
        return row.slug === state.eventSlug;
      }) || (state.profile.eventTypes.length === 1 ? state.profile.eventTypes[0] : null);
      if (state.eventType) {
        state.eventSlug = state.eventType.slug;
        loadInviteePrefill();
        renderCalendar();
      } else {
        renderEventTypes();
      }
      document.title = 'Schedule with ' + state.profile.displayName + ' — Silicon Valley Investclub';
    } catch (error) {
      state.profile = { displayName: 'Silicon Valley Investclub', timezone: 'UTC', eventTypes: [] };
      renderUnavailable(error);
    }
  }

  init();
})();
