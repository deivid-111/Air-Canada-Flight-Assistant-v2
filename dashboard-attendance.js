// ─── STAFF BRIEFING ATTENDANCE TRACKER ───────────────────────────────────────
// Handles the "🗂 Attendance" tab: flight picker (filtered to host/co-host),
// per-flight attendance table, 2h post-end lockout, and browser-history-aware URLs.

let _atdCurrentCode = null;

// ─── Entry point — called by switchPage('attendance') ────────────────────────
async function loadAttendancePage() {
  const listEl   = document.getElementById('atd-flight-list');
  const detailEl = document.getElementById('atd-detail');
  if (!listEl) return;

  // If the URL already encodes a specific flight, open it directly
  const urlCode = _atdCodeFromPath();
  if (urlCode) {
    await atdOpenFlight(urlCode);
    return;
  }

  // Show the flight picker, hide the detail panel
  if (detailEl) detailEl.style.display = 'none';
  listEl.style.display = '';
  listEl.innerHTML = '<div class="atd-state-msg">Loading flights…</div>';

  try {
    // Merge active + ended flights
    const allVisible = [...(allFlights || []), ...(endedFlights || [])];

    // Only show flights where the session user is the host or co-host
    // (managers/BOD/owners bypass the filter and see everything)
    const isPrivileged = sessionIsManager || sessionIsBod || sessionIsOwner;
    const myFlights = isPrivileged
      ? allVisible
      : allVisible.filter(f =>
          String(f.host_user_id) === String(sessionUserId) ||
          (Array.isArray(f.cohosts) && f.cohosts.map(String).includes(String(sessionUserId)))
        );

    if (!myFlights.length) {
      listEl.innerHTML = '<div class="atd-state-msg">No flights found where you are the host or co-host.</div>';
      return;
    }

    // Sort: active first, then ended; within each group sort by dep_date
    myFlights.sort((a, b) => {
      const aEnded = a.status === 'Ended' ? 1 : 0;
      const bEnded = b.status === 'Ended' ? 1 : 0;
      if (aEnded !== bEnded) return aEnded - bEnded;
      return (a.dep_date || '').localeCompare(b.dep_date || '');
    });

    listEl.innerHTML = myFlights.map(f => {
      const isEnded  = f.status === 'Ended';
      const statusDot = isEnded ? 'var(--dim)' : 'var(--green)';
      return `
        <div class="atd-flight-row" id="atd-row-${f.code}"
             onclick="atdOpenFlight('${f.code}')"
             role="button" tabindex="0"
             onkeydown="if(event.key==='Enter')atdOpenFlight('${f.code}')">
          <span class="atd-row-dot" style="background:${statusDot}"></span>
          <span class="atd-row-code">${escapeHtml(f.code)}</span>
          <span class="atd-row-flight">${escapeHtml(f.flight_number || '—')}</span>
          <span class="atd-row-route">${escapeHtml(f.dep_code || '?')} → ${escapeHtml(f.arr_code || '?')}</span>
          <span class="atd-row-date">${escapeHtml(f.dep_date || '')}</span>
          ${isEnded ? '<span class="atd-row-ended">Ended</span>' : ''}
          <span class="atd-row-arrow">→</span>
        </div>`;
    }).join('');

  } catch (e) {
    listEl.innerHTML = `<div class="atd-state-msg atd-state-err">⚠ ${escapeHtml(e.message)}</div>`;
  }
}

// ─── Open a specific flight's attendance table ────────────────────────────────
async function atdOpenFlight(code) {
  code = code.toUpperCase();
  _atdCurrentCode = code;

  // Push URL into history
  const target = `/dashboard/attendance/${code}`;
  if (window.location.pathname !== target) {
    window.history.pushState({ atdCode: code }, '', target);
  }

  // Show detail panel, hide list
  const listEl   = document.getElementById('atd-flight-list');
  const detailEl = document.getElementById('atd-detail');
  if (listEl)   listEl.style.display = 'none';
  if (detailEl) detailEl.style.display = '';

  // Make sure the attendance tab is active
  if (typeof currentPage !== 'undefined' && currentPage !== 'attendance') {
    switchPage('attendance');
  }

  // Loading state
  const wrap = document.getElementById('atd-table-wrap');
  if (wrap) wrap.innerHTML = '<div class="atd-state-msg">Loading roster…</div>';

  try {
    const data = await apiFetch(`/api/flights/${code}/attendance`);
    _atdRenderDetail(data);
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="atd-state-msg atd-state-err">⚠ ${escapeHtml(e.message)}</div>`;
  }
}

// ─── Render the detail view ───────────────────────────────────────────────────
function _atdRenderDetail(data) {
  const titleEl = document.getElementById('atd-flight-title');
  const subEl   = document.getElementById('atd-flight-sub');
  const badge   = document.getElementById('atd-edit-badge');
  const lockEl  = document.getElementById('atd-lock-notice');
  const wrap    = document.getElementById('atd-table-wrap');

  if (titleEl) titleEl.textContent = data.flight_number || data.code;

  // Format dep_date from DDMMYYYY → readable
  let dateStr = data.dep_date || '';
  try {
    if (/^\d{8}$/.test(dateStr)) {
      const d = dateStr.slice(0,2), m = dateStr.slice(2,4), y = dateStr.slice(4);
      dateStr = `${d}/${m}/${y}`;
    }
  } catch(_) {}
  if (subEl) subEl.textContent = `${data.dep_code || '?'} → ${data.arr_code || '?'}  ·  ${dateStr}`;

  // Host badge
  if (badge) badge.style.display = data.can_edit ? '' : 'none';

  // Lock / countdown notice
  if (lockEl) {
    const li = data.lock_info || {};
    if (li.locked) {
      lockEl.style.display = '';
      lockEl.className = 'atd-lock-notice atd-lock-closed';
      lockEl.innerHTML = '🔒 <strong>Attendance tracking closed</strong> — 2 hours have passed since this flight ended.';
    } else if (li.seconds_until_lock != null) {
      lockEl.style.display = '';
      lockEl.className = 'atd-lock-notice atd-lock-warning';
      const mins = Math.ceil(li.seconds_until_lock / 60);
      lockEl.innerHTML = `⏳ Attendance tracking closes in <strong>${mins} minute${mins !== 1 ? 's' : ''}</strong>.`;
    } else {
      lockEl.style.display = 'none';
    }
  }

  if (!data.roster || !data.roster.length) {
    if (wrap) wrap.innerHTML = '<div class="atd-state-msg">No staff have been assigned to this flight yet.</div>';
    return;
  }

  const COLS = [
    { key: 'briefing',     label: 'Briefing' },
    { key: 'flight_start', label: 'Flight — Start' },
    { key: 'flight_end',   label: 'Flight — End' },
    { key: 'debrief',      label: 'Debrief' },
  ];

  const canEdit = !!data.can_edit;
  const code    = data.code;

  // Count totals per column for the summary row (Present and Late count as attended)
  const totals = {};
  COLS.forEach(c => { totals[c.key] = 0; });
  data.roster.forEach(m => COLS.forEach(c => { 
    if (m[c.key] === 'present' || m[c.key] === 'late') totals[c.key]++; 
  }));
  const n = data.roster.length;

  const headerCells = COLS.map(c =>
    `<th class="atd-th-col">${escapeHtml(c.label)}</th>`
  ).join('');

  const summaryRow = `
    <tr class="atd-summary-row">
      <td class="atd-td-name" style="color:var(--dim)">
        <div style="font-size:9px;letter-spacing:.08em;text-transform:uppercase">Attended</div>
      </td>
      ${COLS.map(c => `
        <td class="atd-td-check">
          <span class="atd-count ${totals[c.key] === n ? 'atd-count-full' : ''}">
            ${totals[c.key]}/${n}
          </span>
        </td>`).join('')}
    </tr>`;

  const bodyRows = data.roster.map(member => {
    const cells = COLS.map(col => {
      const state = member[col.key] || 'absent';
      const btnId   = `atd-cb-${member.id}-${col.key}`;

      let icon = 'A', cls = 'atd-state-absent', title = 'Absent';
      if (state === 'present') { icon = '✓'; cls = 'atd-state-present'; title = 'Present'; }
      if (state === 'late')    { icon = 'L'; cls = 'atd-state-late';    title = 'Late'; }

      if (canEdit) {
        return `<td class="atd-td-check">
          <button id="${btnId}"
            class="atd-check-btn ${cls}"
            data-state="${state}"
            onclick="atdToggle('${code}','${member.id}','${col.key}',this)"
            title="${title} (Click to change)">
            <span class="atd-check-icon">${icon}</span>
          </button>
        </td>`;
      } else {
        return `<td class="atd-td-check">
          <span class="atd-check-ro ${cls}" title="${title}">
            <span class="atd-check-icon">${icon}</span>
          </span>
        </td>`;
      }
    }).join('');

    return `<tr>
      <td class="atd-td-name">
        <div class="atd-role-label">${escapeHtml(member.role)}</div>
        <div class="atd-member-name">${escapeHtml(member.name)}</div>
      </td>
      ${cells}
    </tr>`;
  }).join('');

  if (wrap) {
    wrap.innerHTML = `
      <table class="atd-table">
        <thead>
          <tr>
            <th class="atd-th-name">Staff Member</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
          ${summaryRow}
          ${bodyRows}
        </tbody>
      </table>`;
  }
}

// ─── Toggle a single checkbox (3-state cycle) ──────────────────────────────
async function atdToggle(code, memberId, column, btn) {
  const currentState = btn.getAttribute('data-state') || 'absent';
  let newState, newIcon, newCls;

  // Cycle: Absent -> Present -> Late -> Absent
  if (currentState === 'absent') {
    newState = 'present'; newIcon = '✓'; newCls = 'atd-state-present';
  } else if (currentState === 'present') {
    newState = 'late';    newIcon = 'L'; newCls = 'atd-state-late';
  } else {
    newState = 'absent';  newIcon = 'A'; newCls = 'atd-state-absent';
  }

  // Optimistic update
  const oldCls  = btn.className;
  const oldIcon = btn.querySelector('.atd-check-icon').textContent;
  
  btn.setAttribute('data-state', newState);
  btn.className = `atd-check-btn ${newCls}`;
  btn.querySelector('.atd-check-icon').textContent = newIcon;
  btn.title = `${newState.charAt(0).toUpperCase() + newState.slice(1)} (Click to change)`;
  btn.disabled = true;

  try {
    await apiFetch(`/api/flights/${code}/attendance`, 'PATCH', {
      member_id: memberId,
      column:    column,
      state:     newState,
    });
    // Refresh summary counts
    const data = await apiFetch(`/api/flights/${code}/attendance`);
    _atdRenderDetail(data);
  } catch (e) {
    // Revert
    btn.setAttribute('data-state', currentState);
    btn.className = oldCls;
    btn.querySelector('.atd-check-icon').textContent = oldIcon;
    btn.title = `${currentState.charAt(0).toUpperCase() + currentState.slice(1)} (Click to change)`;
    showToast('⚠ Could not update attendance: ' + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ─── Back button ─────────────────────────────────────────────────────────────
function atdBack() {
  _atdCurrentCode = null;
  window.history.pushState({}, '', '/dashboard');

  const detailEl = document.getElementById('atd-detail');
  const listEl   = document.getElementById('atd-flight-list');
  if (detailEl) detailEl.style.display = 'none';
  if (listEl)   { listEl.style.display = ''; listEl.innerHTML = ''; }

  loadAttendancePage();
}

// ─── Browser back/forward navigation ────────────────────────────────────────
window.addEventListener('popstate', () => {
  if (typeof currentPage !== 'undefined' && currentPage === 'attendance') {
    const code = _atdCodeFromPath();
    if (code) {
      atdOpenFlight(code);
    } else {
      atdBack();
    }
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function _atdCodeFromPath() {
  const m = window.location.pathname.match(/^\/dashboard\/attendance\/([A-Za-z0-9]+)$/i);
  return m ? m[1].toUpperCase() : null;
}
