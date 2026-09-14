// ─── CALENDAR ─────────────────────────────────────────────────────────────────
let calYear  = new Date().getUTCFullYear();
let calMonth = new Date().getUTCMonth(); // 0-indexed
let _calBlackoutDates = new Set();

let _calBlackoutLoaded = false;

async function loadCalBlackoutDates() {
  try {
    const raw = await apiFetch('/api/blackout');
    const arr = Array.isArray(raw) ? raw : (raw.blackout || []);
    _calBlackoutDates = new Set(arr);
    _calBlackoutLoaded = true;
    renderCalendar();
    _calClearError();
  } catch(e) {
    _calShowError('Blackout dates failed to load: ' + e.message, '/api/blackout');
  }
}

// Called by dashboard-extras.js after it updates blackout data, keeps calendar in sync
function _calSyncBlackouts(arr) {
  _calBlackoutDates = new Set(Array.isArray(arr) ? arr : []);
  _calBlackoutLoaded = true;
  renderCalendar();
}

function _calShowError(msg, endpoint) {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;
  let errEl = document.getElementById('cal-diag-error');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.id = 'cal-diag-error';
    errEl.style.cssText = 'margin:1rem 2rem;padding:10px 14px;background:rgba(232,0,28,.08);border:1px solid var(--red);font-family:var(--mono);font-size:11px;color:var(--red);line-height:1.8';
    grid.parentNode.insertBefore(errEl, grid.nextSibling);
  }
  errEl.innerHTML = `⚠ ${escapeHtml ? escapeHtml(msg) : msg}`
    + (endpoint ? ` · <a href="${endpoint}" target="_blank" style="color:var(--accent)">inspect</a>` : '');
}

function _calClearError() {
  const el = document.getElementById('cal-diag-error');
  if (el) el.remove();
}

// Always try to load blackouts when calendar renders for the first time
async function _ensureBlackouts() {
  if (!_calBlackoutLoaded) await loadCalBlackoutDates();
}

function calPrev()    { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); }
function calNext()    { calMonth++; if (calMonth > 11) { calMonth = 0;  calYear++; } renderCalendar(); }
function calGoToday() { calYear = new Date().getUTCFullYear(); calMonth = new Date().getUTCMonth(); renderCalendar(); }

function renderCalendar() {
  // Fetch blackouts if not yet loaded (runs async, re-renders when done)
  if (!_calBlackoutLoaded) { _ensureBlackouts(); } // async, re-renders when done
  try { _renderCalendarInner(); } catch(e) { _calShowError('Calendar render error: ' + e.message); }
}

function _renderCalendarInner() {
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const DOW    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  document.getElementById('cal-month-label').textContent = `${MONTHS[calMonth]} ${calYear}`;

  const grid = document.getElementById('cal-grid');
  const today = new Date();
  const todayY = today.getUTCFullYear(), todayM = today.getUTCMonth(), todayD = today.getUTCDate();

  // First day of month, number of days
  const firstDow = new Date(Date.UTC(calYear, calMonth, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(calYear, calMonth + 1, 0)).getUTCDate();
  const daysInPrev  = new Date(Date.UTC(calYear, calMonth, 0)).getUTCDate();

  // Build flight lookup: key = "YYYY-MM-DD" → [flight, ...]
  const flightsByDate = {};
  [...allFlights, ...endedFlights].forEach(f => {
    if (!f.dep_date) return;
    const d = f.dep_date;
    if (!flightsByDate[d]) flightsByDate[d] = [];
    flightsByDate[d].push(f);
  });
  // Build event lookup
  const eventsByDate = {};
  (allEvents || []).forEach(ev => {
    if (!ev.date) return;
    if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
    eventsByDate[ev.date].push(ev);
  });

  let html = DOW.map(d => `<div class="cal-dow">${d}</div>`).join('');

  // Pad before
  for (let i = 0; i < firstDow; i++) {
    const d = daysInPrev - firstDow + 1 + i;
    html += `<div class="cal-cell other-month"><div class="cal-day-num">${d}</div></div>`;
  }

  // Days in month
  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(calMonth + 1).padStart(2,'0');
    const dd = String(d).padStart(2,'0');
    const key = `${calYear}-${mm}-${dd}`;
    const isToday    = calYear === todayY && calMonth === todayM && d === todayD;
    const isBlackout = _calBlackoutDates.has(key);
    const flights    = flightsByDate[key] || [];
    const hasFlights = flights.length > 0;

    const chipColors = {
      'On–Time':'ontime','Delayed':'delayed','Cancelled':'cancelled',
      'Rescheduled':'resched','Ended':'ended','N/A':'na'
    };

    const MAX_CHIPS = 3;
    let chips = flights.slice(0, MAX_CHIPS).map(f => {
      const cls = chipColors[f.status] || 'na';
      return `<div class="cal-flight-chip cal-chip-${cls}" onclick="event.stopPropagation();openDrawer('${f.code}')" title="${f.flight_number} ${f.dep_code}→${f.arr_code}">${f.flight_number} ${f.dep_code}→${f.arr_code}</div>`;
    }).join('');
    if (flights.length > MAX_CHIPS) chips += `<div class="cal-more">+${flights.length - MAX_CHIPS} more</div>`;

    const dayEvents = eventsByDate[key] || [];
    const typeIcons = { gamenight:'🎮', meeting:'📋', community:'🌐', other:'📌' };
    const evChips = dayEvents.map(ev =>
      `<div class="cal-event-chip" title="${ev.title}${ev.time?' · '+ev.time+' UTC':''}">${typeIcons[ev.type]||'📌'} ${ev.title}</div>`
    ).join('');

    html += `<div class="cal-cell${isToday ? ' today' : ''}${hasFlights||dayEvents.length ? ' has-flights' : ''}${isBlackout ? ' blackout-day' : ''}"
      style="${isBlackout ? 'border-top:3px solid #e8001c;' : ''}">
      <div class="cal-day-num" style="${isBlackout ? 'color:#e8001c;font-weight:700;' : ''}">${d}${isBlackout ? ' <span style="font-size:9px;background:#e8001c;color:#fff;padding:1px 4px;border-radius:2px;vertical-align:middle">BLACKOUT</span>' : ''}</div>
      ${chips}${evChips}
    </div>`;
  }

  // Pad after
  const total = firstDow + daysInMonth;
  const remaining = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="cal-cell other-month"><div class="cal-day-num">${i}</div></div>`;
  }

  grid.innerHTML = html;
}


// ─── EVENTS ──────────────────────────────────────────────────────────────────
let allEvents = [];

async function renderEvents() {
  const list = document.getElementById('events-list');
  if (!list) return;
  try {
    allEvents = await apiFetch('/api/events');
  } catch(e) {
    list.innerHTML = '<div style="color:var(--red);font-family:var(--mono);font-size:12px">Failed to load events</div>';
    return;
  }

  if (!allEvents.length) {
    list.innerHTML = '<div style="color:var(--dim);font-family:var(--mono);font-size:12px;padding:2rem;text-align:center">No events yet — click "+ Add Event" to create one</div>';
    return;
  }

  const typeIcons = { gamenight:'🎮', meeting:'📋', community:'🌐', other:'📌' };
  const typeLabels = { gamenight:'Gamenight', meeting:'Meeting', community:'Community Event', other:'Event' };

  list.innerHTML = allEvents.map(ev => `
    <div class="event-card" id="evcard-${ev.id}">
      <div class="event-card-icon">${typeIcons[ev.type] || '📌'}</div>
      <div class="event-card-body">
        <div class="event-card-title">${ev.title}</div>
        <div class="event-card-meta">
          <span class="badge na" style="font-size:10px">${typeLabels[ev.type] || ev.type}</span>
          <span style="color:var(--subtext);font-size:12px">📅 ${ev.date}${ev.time ? ' · ' + ev.time + ' UTC' : ''}</span>
        </div>
        ${ev.description ? `<div class="event-card-desc">${ev.description}</div>` : ''}
      </div>
      <button class="action-btn" onclick="deleteEvent('${ev.id}')" title="Delete event" style="opacity:.5;font-size:13px;padding:4px 8px">✕</button>
    </div>
  `).join('');

  // Also update the calendar with event dots
  renderCalendar();
}

function openAddEvent() {
  ['ev-title','ev-time','ev-desc','ev-duration','ev-cohosts'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  document.getElementById('ev-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('ev-type').selectedIndex = 0;
  document.getElementById('event-error').style.display = 'none';
  document.getElementById('event-overlay').classList.add('open');
  document.getElementById('event-modal').classList.add('open');
  document.getElementById('ev-title').focus();
}

function closeAddEvent() {
  document.getElementById('event-overlay').classList.remove('open');
  document.getElementById('event-modal').classList.remove('open');
}

async function submitAddEvent() {
  const g = id => document.getElementById(id).value.trim();
  const errEl = document.getElementById('event-error');
  errEl.style.display = 'none';

  const title = g('ev-title');
  const date  = g('ev-date');
  if (!title || !date) {
    errEl.textContent = '⚠ Title and date are required';
    errEl.style.display = 'block';
    return;
  }

  try {
    showLoading(true);
    const coHostsRaw = g('ev-cohosts');
    const cohosts = coHostsRaw ? coHostsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const ev = await apiFetch('/api/events', 'POST', {
      title, date,
      time:        g('ev-time'),
      type:        document.getElementById('ev-type').value,
      description: g('ev-desc'),
      duration:    g('ev-duration'),
      cohosts,
    });
    allEvents.push(ev);
    closeAddEvent();
    showToast(`✅ Event "${ev.title}" created`);
    renderEvents();
  } catch(e) {
    errEl.textContent = '❌ ' + (e.message || 'Server error');
    errEl.style.display = 'block';
  } finally {
    showLoading(false);
  }
}

async function deleteEvent(eid) {
  if (!confirm('Delete this event?')) return;
  try {
    await apiFetch(`/api/events/${eid}`, 'DELETE');
    allEvents = allEvents.filter(e => e.id !== eid);
    showToast('🗑 Event deleted');
    renderEvents();
  } catch(e) {
    logError('dashboard-calendar.js', e);
    showToast('❌ Delete failed', true);
  }
}