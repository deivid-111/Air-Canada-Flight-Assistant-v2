
function _dashboardCodeFromPath() {
  const m = window.location.pathname.match(/^\/dashboard\/([A-Za-z0-9]+)$/);
  return m ? m[1].toUpperCase() : null;
}

function _setDashboardPathForCode(code) {
  const target = code ? `/dashboard/${encodeURIComponent(code)}` : '/dashboard';
  const currentPath = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
  if (currentPath === target) return;
  if (window.history && typeof window.history.pushState === 'function') {
    window.history.pushState({ flightCode: code || null }, '', target);
  } else {
    window.location.pathname = target;
  }
}

// ─── LOAD FLIGHTS ─────────────────────────────────────────────────────────────
async function loadFlights() {
  showLoading(true);
  try {
    const [flights, stats] = await Promise.all([
      apiFetch('/api/flights'),
      apiFetch('/api/stats')
    ]);
    // Split into active vs ended
    allFlights = flights.filter(f => f.status !== 'Ended');
    endedFlights = flights.filter(f => f.status === 'Ended');
    setApiStatus(true);
    updateStats(stats);
    // Respect whichever tab the user is currently on
    if (typeof activeFilter !== 'undefined' && activeFilter === 'ended') {
      renderEndedTable();
    } else {
      renderTable();
    }
    const pathCode = _dashboardCodeFromPath();
    if (pathCode && pathCode !== currentCode) openDrawer(pathCode);
  } catch (e) {
    logError('loadFlights', e);
    setApiStatus(false);
    showToast('Could not reach API — is utilities.py running?', true);
    const flightsBody = document.getElementById('flights-body');
    if (flightsBody) flightsBody.innerHTML = `
      <tr><td colspan="10">
        <div class="empty-state">
          <span class="empty-icon">⚠</span>
          <span>Could Not Reach API</span>
          <span style="font-size:9px;opacity:.6">Make sure utilities.py is running</span>
        </div>
      </td></tr>`;
  } finally {
    showLoading(false);
  }
}

// ─── LOAD LOGS ────────────────────────────────────────────────────────────────
async function loadLogs() {
  document.getElementById('logs-list').innerHTML = '<div class="logs-empty">Loading…</div>';
  try {
    const logs = await apiFetch('/api/logs?limit=300');
    allLogs = logs;
    filterLogs();
  } catch (e) {
    logError('loadLogs', e);
    document.getElementById('logs-list').innerHTML =
      `<div class="logs-empty" style="color:var(--red)">⚠ Failed to load logs — ${e.message}</div>`;
  }
}

function filterLogs() {
  const level = document.getElementById('log-filter').value;
  const source = document.getElementById('log-source').value;
  const q = (document.getElementById('log-search').value || '').toLowerCase();

  let entries = allLogs;
  if (level !== 'all') entries = entries.filter(l => l.level === level);
  if (source !== 'all') entries = entries.filter(l => (l.source || 'system') === source);
  if (q) entries = entries.filter(l =>
    (l.action || '').toLowerCase().includes(q) ||
    (l.user || '').toLowerCase().includes(q) ||
    (l.error_code || '').toLowerCase().includes(q)
  );

  // Update stats
  const counts = { error: 0, warn: 0, ok: 0, info: 0 };
  allLogs.forEach(l => { if (counts[l.level] !== undefined) counts[l.level]++; });
  const statsEl = document.getElementById('log-stats');
  if (allLogs.length) {
    statsEl.style.display = 'flex';
    document.getElementById('ls-errors').textContent = counts.error;
    document.getElementById('ls-warns').textContent = counts.warn;
    document.getElementById('ls-ok').textContent = counts.ok;
    document.getElementById('ls-info').textContent = counts.info;
    document.getElementById('ls-total').textContent = allLogs.length;
  }

  renderLogs(entries);
}

// Known user IDs → display names (populated from user_data host_user_id if available)
const KNOWN_USERS = window.__AIC_KNOWN_USERS__ || (window.__AIC_KNOWN_USERS__ = {});

function resolveUser(uid) {
  if (!uid || uid === 'system') return { label: 'System', isSystem: true };
  if (KNOWN_USERS[uid]) return { label: KNOWN_USERS[uid], isSystem: false };
  // Shorten long IDs to last 6 digits with a prefix indicator
  if (/^\d{10,}$/.test(uid)) return { label: `…${uid.slice(-6)}`, isSystem: false, title: uid };
  return { label: uid, isSystem: false };
}

function humanizeAction(action) {
  // Clean up noisy action strings
  return action
    .replace(/^Saved user_data\.json:\s*/, '')  // strip verbose prefix
    .replace(/```/g, '')
    .trim();
}

function levelIcon(level) {
  return { error: '✕', warn: '⚠', ok: '✓', info: '·' }[level] || '·';
}

function renderLogs(entries) {
  const list = document.getElementById('logs-list');

  if (!entries.length) {
    list.innerHTML = '<div class="logs-empty">No log entries match the current filters.</div>';
    return;
  }

  list.innerHTML = entries.map((l, idx) => {
    const user = resolveUser(l.user);
    const action = humanizeAction(l.action || '');
    const level = l.level || 'info';
    const source = l.source || 'system';
    const hasTb = !!(l.traceback);
    const sourceLabel = { bot: 'Bot', dashboard: 'Web', system: 'Sys' }[source] || source;

    // Build the detail panel content
    const detailRows = [
      ['Level', level.toUpperCase()],
      ['Source', sourceLabel],
      ['User', l.user && l.user !== 'system' ? l.user : '—'],
      ['Time', (l.time && l.time !== '—') ? l.time : '—'],
      l.error_code ? ['Error Ref', l.error_code] : null,
      l.tb_summary ? ['Exception', l.tb_summary] : null,
    ].filter(Boolean);

    const detailGridHtml = detailRows.map(([k, v]) =>
      `<span class="log-detail-key">${k}</span><span class="log-detail-val">${escapeHtml(String(v))}</span>`
    ).join('');

    const fullActionHtml = action.length > 80
      ? `<div style="margin-top:8px"><span class="log-detail-key" style="display:block;margin-bottom:4px">Full Message</span><span class="log-detail-val full-action">${escapeHtml(action)}</span></div>`
      : '';

    const tbHtml = hasTb
      ? `<span class="log-detail-tb-label">Traceback</span><div class="log-detail-tb">${escapeHtml(l.traceback)}</div>`
      : '';

    return `<div class="log-entry level-${level} source-${source}" id="le-${idx}" onclick="toggleLogEntry(${idx})">
      <div class="log-cell log-cell-level">
        <span class="log-level-badge">${level.toUpperCase()}</span>
        <div class="log-source-dot" title="${source}"></div>
      </div>
      <div class="log-cell log-cell-user">
        <span class="log-user-label">${sourceLabel}</span>
        <span class="log-user-val${user.isSystem ? ' is-system' : ''}" title="${l.user || ''}">${escapeHtml(user.label)}</span>
        ${l.time && l.time !== '—' ? `<span class="log-source-tag">${l.time}</span>` : ''}
      </div>
      <div class="log-cell log-cell-action">
        <span class="log-action-text">${escapeHtml(action.slice(0, 120))}${action.length > 120 ? '…' : ''}</span>
        ${l.tb_summary ? `<span class="log-tb-summary">↳ ${escapeHtml(l.tb_summary)}</span>` : ''}
      </div>
      <div class="log-cell log-cell-expand" id="le-arr-${idx}">▾</div>
      <div class="log-detail" id="ld-${idx}">
        <div class="log-detail-grid">${detailGridHtml}</div>
        ${fullActionHtml}
        ${tbHtml}
      </div>
    </div>`;
  }).join('');
}

function toggleLogEntry(idx) {
  const el = document.getElementById(`le-${idx}`);
  const arr = document.getElementById(`le-arr-${idx}`);
  if (!el) return;
  const opening = !el.classList.contains('expanded');
  el.classList.toggle('expanded', opening);
  if (arr) arr.textContent = opening ? '▴' : '▾';
}

// kept for backwards compat
function toggleTb(idx) { toggleLogEntry(idx); }

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── STATUS INDICATOR ─────────────────────────────────────────────────────────
function setApiStatus(online) {
  apiOnline = online;
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  if (online) {
    if (dot) dot.classList.remove('err');
    if (txt) txt.textContent = 'API Connected';
  } else {
    if (dot) dot.classList.add('err');
    if (txt) txt.textContent = 'API Unreachable — Check Server';
  }
}

// ─── STATS ────────────────────────────────────────────────────────────────────
function updateStats(stats) {
  const _s = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  _s('stat-total', stats.total);
  _s('stat-accepted', stats.ontime ?? stats.accepted ?? 0);
  _s('stat-delayed', stats.delayed ?? 0);
  _s('stat-denied', stats.denied);
  _s('stat-ended', stats.ended ?? 0);
}

// ─── FILTER ───────────────────────────────────────────────────────────────────
function setFilter(f, btn) {
  activeFilter = f;
  document.querySelectorAll('#flights-subnav button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (f === 'ended') renderEndedTable();
  else renderTable();
}

function applySearch() {
  if (activeFilter === 'ended') renderEndedTable();
  else renderTable();
}

function getFiltered() {
  const by = document.getElementById('search-by').value;
  const q = document.getElementById('search-input').value.toLowerCase().trim();
  let rows = allFlights;

  if (activeFilter !== 'all' && activeFilter !== 'ended') {
    const map = { ontime: 'On–Time', delayed: 'Delayed', cancelled: 'Cancelled' };
    const val = map[activeFilter] || '';
    rows = rows.filter(f => (f.status || 'N/A').toLowerCase() === val.toLowerCase());
  }

  if (q) {
    rows = rows.filter(f => {
      if (by === 'code') return f.code.toLowerCase().includes(q);
      if (by === 'flight') return (f.flight_number || '').toLowerCase().includes(q);
      if (by === 'route') return (`${f.dep_code}${f.arr_code}`).toLowerCase().includes(q);
      return true;
    });
  }
  return rows;
}

// ─── RENDER TABLE (active flights) ────────────────────────────────────────────
function renderTable() {
  const rows = getFiltered();
  const body = document.getElementById('flights-body');

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="10"><div class="empty-state"><span class="empty-icon">✈</span><span>No flights match filters</span></div></td></tr>`;
    return;
  }

  const grouped = {};
  rows.forEach(f => {
    const d = f.dep_date || 'Unknown Date';
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(f);
  });

  const sortedDates = Object.keys(grouped).sort((a, b) => new Date(a) - new Date(b));

  let html = '';
  sortedDates.forEach(date => {
    const label = formatDateLabel(date);
    html += `<tr class="date-group-header"><td colspan="10">${label}</td></tr>`;
    grouped[date].forEach(f => { html += buildRow(f); });
  });

  body.innerHTML = html;
}

// ─── RENDER ENDED TABLE (shown when "Ended" filter active) ────────────────────
function renderEndedTable() {
  const body = document.getElementById('flights-body');
  const q = document.getElementById('search-input').value.toLowerCase().trim();
  const by = document.getElementById('search-by').value;

  let rows = [...endedFlights];

  // Apply search filter
  if (q) rows = rows.filter(f => {
    if (by === 'code') return f.code.toLowerCase().includes(q);
    if (by === 'flight') return (f.flight_number || '').toLowerCase().includes(q);
    if (by === 'route') return (`${f.dep_code}${f.arr_code}`).toLowerCase().includes(q);
    return true;
  });

  // Apply column sort (same logic as renderTable)
  rows.sort((a, b) => {
    const va = getSortVal(a, sortCol);
    const vb = getSortVal(b, sortCol);
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="10"><div class="empty-state"><span class="empty-icon">✓</span><span>${endedFlights.length ? 'No ended flights match search' : 'No ended flights yet'}</span></div></td></tr>`;
    return;
  }

  let html = `<tr class="date-group-header"><td colspan="10">Ended Flights — ${endedFlights.length} total</td></tr>`;
  rows.forEach(f => { html += buildEndedRow(f); });
  body.innerHTML = html;
}

// renderEnded kept for backwards compat (no-op now)
function renderEnded() { }

function formatDateLabel(dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00Z');
    return d.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  } catch { return dateStr; }
}

function statusBadge(s) {
  const map = {
    'On–Time': 'ontime',
    'Delayed': 'delayed',
    'Cancelled': 'cancel',
    'Rescheduled': 'resched',
    'Ended': 'na',
  };
  const cls = map[s] || 'na';
  return `<span class="badge ${cls}"><span class="badge-dot"></span>${s || 'N/A'}</span>`;
}

function buildRow(f) {
  const alerts = (f.alerts && f.alerts !== 'N/A') ? f.alerts : null;
  return `<tr onclick="openDrawer('${f.code}')">
    <td class="mono">${f.code}</td>
    <td><span class="flight-num">${f.flight_number || '—'}</span></td>
    <td><span class="route">${f.dep_code || '?'}<span>→</span>${f.arr_code || '?'}</span></td>
    <td class="mono">${f.dep_date || '—'}</td>
    <td class="mono">${f.dep_time || '—'}</td>
    <td class="mono">${f.arr_time || '—'}</td>
    <td class="mono">${f.aircraft || '—'}</td>
    <td>${statusBadge(f.status)}</td>
    <td class="alerts-cell ${alerts ? '' : 'na'}">${alerts || 'N/A'}</td>
    <td>
      <button class="action-btn" onclick="event.stopPropagation(); openDrawer('${f.code}')">Edit</button>
    </td>
  </tr>`;
}

function buildEndedRow(f) {
  return `<tr class="ended-row" onclick="openDrawer('${f.code}')">
    <td class="mono">${f.code}</td>
    <td><span class="flight-num">${f.flight_number || '—'}</span></td>
    <td><span class="route">${f.dep_code || '?'}<span>→</span>${f.arr_code || '?'}</span></td>
    <td class="mono">${f.dep_date || '—'}</td>
    <td class="mono">${f.dep_time || '—'}</td>
    <td class="mono">${f.arr_time || '—'}</td>
    <td class="mono">${f.aircraft || '—'}</td>
    <td>${statusBadge('Ended')}</td>
    <td class="alerts-cell na">—</td>
    <td>
      <button class="action-btn" onclick="event.stopPropagation(); openDrawer('${f.code}')">View</button>
    </td>
  </tr>`;
}

// ─── DRAWER ───────────────────────────────────────────────────────────────────
function updateRetentionPreview() {
  const j = parseInt(document.getElementById('d-pax-joined')?.value || '', 10);
  const r = parseInt(document.getElementById('d-pax-remained')?.value || '', 10);
  const el = document.getElementById('d-retention-preview');
  if (!el) return;
  if (!isNaN(j) && j > 0 && !isNaN(r)) {
    const pct = Math.round(r / j * 100);
    const color = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)';
    el.style.color = color;
    el.textContent = `${pct}%  (${r} of ${j})`;
  } else {
    el.style.color = 'var(--subtext)';
    el.textContent = '—';
  }
}

function openDrawer(code) {
  const f = [...allFlights, ...endedFlights].find(x => x.code === code);
  if (!f) return;
  currentCode = code;
  _setDashboardPathForCode(code);
  isDirty = false;
  document.getElementById('save-btn').disabled = true;

  document.getElementById('d-flight-num').textContent = f.flight_number || '—';
  document.getElementById('d-route').textContent = `${f.dep_city || f.dep_code} → ${f.arr_city || f.arr_code}  ·  ${f.dep_date || ''}`;
  const statusSel = document.getElementById('d-status');
  if (statusSel) statusSel.value = f.status || 'N/A';
  document.getElementById('d-meal').value = f.meal_service || 'N/A';
  document.getElementById('d-dep-airport').textContent = f.dep_airport || '—';
  document.getElementById('d-dep-time').textContent = f.dep_time || '—';
  document.getElementById('d-terminal').textContent = f.terminal || '—';
  document.getElementById('d-gate-dep').value = f.gate_dep || '';
  document.getElementById('d-arr-airport').textContent = f.arr_airport || '—';
  document.getElementById('d-arr-time').textContent = f.arr_time || '—';
  document.getElementById('d-gate-arr').value = f.gate_arr || '';
  document.getElementById('d-aircraft').textContent = f.aircraft || '—';
  document.getElementById('d-server-link').value = f.server_link !== 'N/A' ? (f.server_link || '') : '';
  document.getElementById('d-event-link').value = f.event_link !== 'N/A' ? (f.event_link || '') : '';
  document.getElementById('d-alerts').value = f.alerts !== 'N/A' ? (f.alerts || '') : '';
  document.getElementById('d-pax').value = f.pax != null ? f.pax : '';
  document.getElementById('d-pax-joined').value = f.pax_joined != null ? f.pax_joined : '';
  document.getElementById('d-pax-remained').value = f.pax_remained != null ? f.pax_remained : '';
  document.getElementById('d-pax-notes').value = f.pax_notes || '';
  // Populate final_status selector
  const finalStatusSel = document.getElementById('d-final-status');
  if (finalStatusSel) finalStatusSel.value = f.final_status || '';

  updateRetentionPreview();

  const isEnded = f.status === 'Ended';

  // Post-flight section: only show for ended flights
  const pfSection = document.getElementById('d-postflight-section');
  if (pfSection) pfSection.style.display = isEnded ? '' : 'none';

  // For ended flights: lock status/meal (read-only), show final_status label
  const mealSel = document.getElementById('d-meal');
  if (isEnded) {
    // Show the final_status in the status field (what it was BEFORE ended)
    // and lock it so saving won't overwrite to On-Time accidentally
    const displayStatus = f.final_status || 'Ended';
    if (statusSel) {
      statusSel.value = displayStatus;
      statusSel.disabled = true;
      statusSel.title = 'Status locked for ended flights — set via Final Status field';
    }
    if (mealSel) { mealSel.disabled = false; } // meal can still be edited
  } else {
    if (statusSel) {
      statusSel.disabled = false;
      statusSel.title = '';
    }
  }

  // Load crew signup section
  loadCrewPanel(code, f);

  // Expose for cross-file access
  window.currentCode = code;

  // Show/hide co-host request section based on viewer's role
  if (typeof _updateCohostReqSection === 'function') _updateCohostReqSection(f);

  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}

function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
  const statusSel = document.getElementById('d-status');
  if (statusSel) { statusSel.disabled = false; statusSel.title = ''; }
  currentCode = null;
  _setDashboardPathForCode('');
}

function markDirty() {
  isDirty = true;
  document.getElementById('save-btn').disabled = false;
}

function setSaving(isSaving) {
  const btn = document.getElementById('save-btn');
  const banner = document.getElementById('drawer-saving-banner');
  const closeBtn = document.getElementById('drawer-close-btn');
  const overlay = document.getElementById('drawer-overlay');

  if (isSaving) {
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
    if (banner) banner.style.display = 'flex';
    if (closeBtn) closeBtn.disabled = true;
    if (overlay) overlay.style.pointerEvents = 'none';
  } else {
    if (btn) { btn.textContent = 'Save Changes'; }
    if (banner) banner.style.display = 'none';
    if (closeBtn) closeBtn.disabled = false;
    if (overlay) overlay.style.pointerEvents = '';
  }
}

async function saveChanges() {
  if (!currentCode) return;
  const joinedRaw = document.getElementById('d-pax-joined').value;
  const remainedRaw = document.getElementById('d-pax-remained').value;
  const pax_joined = joinedRaw !== '' ? parseInt(joinedRaw, 10) : null;
  const pax_remained = remainedRaw !== '' ? parseInt(remainedRaw, 10) : null;
  const f = [...allFlights, ...endedFlights].find(x => x.code === currentCode);
  const isEndedFlight = f && f.status === 'Ended';
  const finalStatusEl = document.getElementById('d-final-status');
  const statusSel = document.getElementById('d-status');
  const payload = {
    status: isEndedFlight ? 'Ended' : (statusSel ? statusSel.value : (f?.status || 'On–Time')),
    ...(isEndedFlight && finalStatusEl && finalStatusEl.value
      ? { final_status: finalStatusEl.value } : {}),
    meal_service: document.getElementById('d-meal').value,
    gate_dep: document.getElementById('d-gate-dep').value || 'N/A',
    gate_arr: document.getElementById('d-gate-arr').value || 'N/A',
    server_link: document.getElementById('d-server-link').value || 'N/A',
    event_link: document.getElementById('d-event-link').value || 'N/A',
    alerts: document.getElementById('d-alerts').value || 'N/A',
    pax: pax_joined,   // keep legacy field = joined count
    pax_joined,
    pax_remained,
    pax_notes: document.getElementById('d-pax-notes').value.trim() || '',
  };

  try {
    setSaving(true);
    const updated = await apiFetch(`/api/flights/${currentCode}`, 'PATCH', payload);
    const idx = allFlights.findIndex(x => x.code === currentCode);
    if (idx !== -1) allFlights[idx] = updated;
    const eidx = endedFlights.findIndex(x => x.code === currentCode);
    if (eidx !== -1) endedFlights[eidx] = updated;
    isDirty = false;
    renderTable();
    renderEnded();
    showToast(`✅  ${currentCode} updated successfully`);
    closeDrawer();
  } catch (e) {
    logError('saveChanges', e);
    showToast(`Failed to save — ${e.message}`, true);
  } finally {
    setSaving(false);
    document.getElementById('save-btn').disabled = isDirty ? false : true;
  }
}

// ─── ADMIN ACTIONS ────────────────────────────────────────────────────────────
async function adminAction(action) {
  if (!currentCode) return;
  const code = currentCode;

  try {
    showLoading(true);
    if (action === 'not_started') {
      await apiFetch(`/api/flights/${code}`, 'PATCH', { server_link: 'Flight Not Started' });
      showToast(`✅ Server link set to "Flight Not Started"`);
    } else if (action === 'close_flight') {
      await apiFetch(`/api/flights/${code}/close`, 'POST', {});
      showToast(`🔒 ${code} — Gates closed`);
    }
    await loadFlights();
  } catch (e) {
    logError('adminAction', e);
    showToast(`❌ Action failed: ${e.message}`, true);
  } finally {
    showLoading(false);
  }
}

async function refreshDiscordEmbed() {
  if (!currentCode) return;
  const code = currentCode;
  try {
    showLoading(true);
    await apiFetch(`/api/flights/${code}/refresh`, 'POST', {});
    showToast(`↺ Discord embed refreshed for ${code}`);
  } catch (e) {
    logError('refreshDiscordEmbed', e);
    showToast(`❌ Refresh failed: ${e.message}`, true);
  } finally {
    showLoading(false);
  }
}

async function markFlightEnded() {
  if (!currentCode) return;
  const code = currentCode;
  try {
    showLoading(true);
    await apiFetch(`/api/flights/${code}`, 'PATCH', { status: 'Ended' });
    showToast(`✅ ${code} moved to Ended`);
    closeDrawer();
    await loadFlights();
  } catch (e) {
    logError('markFlightEnded', e);
    showToast(`❌ Failed: ${e.message}`, true);
  } finally {
    showLoading(false);
  }
}

function confirmDeleteFlight() {
  if (!currentCode) return;
  document.getElementById('delete-confirm-code').textContent = currentCode;
  openMiniModal('delete');
}

async function submitDeleteFlight() {
  if (!currentCode) return;
  const code = currentCode;
  closeMiniModal('delete');
  try {
    showLoading(true);
    await apiFetch(`/api/flights/${code}`, 'DELETE');
    allFlights = allFlights.filter(f => f.code !== code);
    endedFlights = endedFlights.filter(f => f.code !== code);
    renderTable();
    renderEnded();
    showToast(`🗑 ${code} deleted permanently`);
    closeDrawer();
  } catch (e) {
    logError('submitDeleteFlight', e);
    showToast(`❌ Delete failed: ${e.message}`, true);
  } finally {
    showLoading(false);
  }
}

// Start Flight modal
function openStartFlight() {
  document.getElementById('sm-server-link').value = '';
  document.getElementById('sm-spawn').value = '';
  openMiniModal('start');
}

async function submitStartFlight() {
  const serverLink = document.getElementById('sm-server-link').value.trim();
  const spawnLocation = document.getElementById('sm-spawn').value.trim();
  if (!serverLink) { showToast('⚠ Server link is required', true); return; }
  closeMiniModal('start');
  try {
    showLoading(true);
    await apiFetch(`/api/flights/${currentCode}/start`, 'POST', { server_link: serverLink, spawn_location: spawnLocation });
    showToast(`🛫 ${currentCode} — flight started!`);
    await loadFlights();
  } catch (e) {
    logError('unhandled', e);
    showToast(`❌ Failed: ${e.message}`, true);
  } finally {
    showLoading(false);
  }
}

// Send Reminder modal
function openSendReminder() {
  document.getElementById('sm-remind-time').value = '';
  openMiniModal('remind');
}

async function submitSendReminder() {
  const ts = document.getElementById('sm-remind-time').value.trim();
  if (!ts) { showToast('⚠ Enter a time value', true); return; }
  closeMiniModal('remind');
  try {
    showLoading(true);
    await apiFetch(`/api/flights/${currentCode}/remind`, 'POST', { timestamp: ts });
    showToast(`📣 Reminder sent: opens in ${ts}`);
  } catch (e) {
    logError('unhandled', e);
    showToast(`❌ Failed: ${e.message}`, true);
  } finally {
    showLoading(false);
  }
}

// ─── GLOBAL ANNOUNCE (top bar) ────────────────────────────────────────────────
function openGlobalAnnounce() {
  document.getElementById('ga-msg').value = '';
  openMiniModal('gannounce');
  setTimeout(() => document.getElementById('ga-msg').focus(), 100);
}

async function submitGlobalAnnounce() {
  const msg = document.getElementById('ga-msg').value.trim();
  if (!msg) { showToast('⚠ Message cannot be empty', true); return; }
  closeMiniModal('gannounce');
  try {
    showLoading(true);
    await apiFetch('/api/announce', 'POST', { message: msg });
    showToast('📣 Announcement sent to Discord!');
  } catch (e) {
    logError('unhandled', e);
    showToast(`❌ Failed: ${e.message}`, true);
  } finally {
    showLoading(false);
  }
}

// ─── PER-FLIGHT ANNOUNCE SYSTEM ───────────────────────────────────────────────
const ANNOUNCE_TEMPLATES = [
  {
    name: 'Departure Time Correction',
    category: 'Schedule Update',
    build: (f) => `## Schedule Update\n<:AIC_Clock:1416206442482110555> Dear passengers, the departure time for flight ${f.flight_number} is displayed incorrectly. The correct time is HH:MM UTC.\nWe apologize for any inconvenience caused.`,
  },
  {
    name: 'Departure Date Correction',
    category: 'Schedule Update',
    build: (f) => `## Schedule Update\n<:AIC_Calendar:1419198165923528794> Dear passengers, the departure date for flight ${f.flight_number} is displayed incorrectly on the flight information board. The correct date is DDth Month YYYY.\nWe apologize for any inconvenience caused.`,
  },
  {
    name: 'Flight Cancellation',
    category: 'Service Update',
    build: (f) => `## Service Update\n<:AIC_Status:1419199743145545779> Dear passengers, flight ${f.flight_number} operating service to ${f.arr_city || 'DESTINATION'}, has been cancelled due to REASON. We sincerely apologize for the inconvenience. This cancellation is the result of unforeseen circumstances beyond our control.\nWe appreciate your understanding and look forward to welcoming you on a future flight.`,
  },
  {
    name: 'Flight Delay',
    category: 'Service Update',
    build: (f) => `## Service Update\n<:AIC_Warning:1416198985558917240> Dear passengers, flight ${f.flight_number} operating service to ${f.arr_city || 'DESTINATION'}, has been delayed. The updated departure time is HH:MM UTC\nWe apologize for any inconvenience caused.`,
  },
  {
    name: 'Flight Rescheduled',
    category: 'Service Update',
    build: (f) => `## Service Update\n<:AIC_Calendar:1419198165923528794> Dear passengers, flight ${f.flight_number} operating service to ${f.arr_city || 'DESTINATION'}, has been rescheduled. The new operating date and time are DDth Month YYYY.\nWe apologize for any inconvenience caused.`,
  },
  {
    name: 'Duplicate Notification Apology',
    category: 'Notification Notice',
    build: (f) => `## Notification Notice\n<:AIC_User:1409728720914354306> Dear passengers, We apologize for the duplicate notification you may have received. Some members of our staff are currently undergoing training and are still becoming familiar with system procedures.\nWe regret the inconvenience and are taking measures to ensure this does not occur again.`,
  },
];

let paCurrentFlight = null;
let paActiveTab = 'templates';
let paSelectedTemplate = -1;

function openFlightAnnounce() {
  if (!currentCode) return;
  const f = [...allFlights, ...endedFlights].find(x => x.code === currentCode);
  paCurrentFlight = f;
  paSelectedTemplate = -1;

  document.getElementById('pa-flight-code').textContent = f ? f.code : '—';
  document.getElementById('pa-flight-num').textContent = f ? (f.flight_number || '—') : '—';

  // Reset to templates tab
  document.querySelectorAll('.announce-tab').forEach((b, i) => b.classList.toggle('active', i === 0));
  document.querySelectorAll('.announce-pane').forEach((p, i) => p.classList.toggle('active', i === 0));
  paActiveTab = 'templates';

  document.getElementById('pa-template-text').value = '';
  document.getElementById('pa-template-editor').style.display = 'none';
  document.getElementById('pa-custom-text').value = '';

  _ensureAnnounceTemplates().then(() => renderTemplateList(f));
  openMiniModal('pfannounce');
}

let _atTemplatesLoaded = false;

function _getAnnounceTemplates() {
  // Use saved templates from extras.js if already loaded
  if (typeof _atTemplates !== 'undefined' && _atTemplates.length) return _atTemplates;
  return ANNOUNCE_TEMPLATES.map(t => ({ name: t.name, category: t.category, text: t.build({ flight_number: '{flight_number}', arr_city: '{arr_city}' }) }));
}

async function _ensureAnnounceTemplates() {
  // If _atTemplates not yet loaded, fetch from API now
  if (typeof _atTemplates !== 'undefined' && _atTemplates.length) return;
  try {
    const s = await apiFetch('/api/owner-settings');
    if (typeof _atTemplates !== 'undefined' && Array.isArray(s.announce_templates) && s.announce_templates.length) {
      _atTemplates = s.announce_templates;
    }
  } catch (e) { /* silent — fall back to hardcoded */ }
}

function renderTemplateList(f) {
  const list = document.getElementById('template-list');
  const templates = _getAnnounceTemplates();
  list.innerHTML = templates.map((t, i) => {
    // Support both hardcoded {build(f)} and saved {text} formats
    const raw = typeof t.build === 'function' ? t.build(f) : (t.text || '');
    const filled = raw.replace(/\{flight_number\}/g, f?.flight_number || '').replace(/\{arr_city\}/g, f?.arr_city || '');
    const preview = filled.split('\n')[0].replace(/^## /, '');
    return `<div class="template-item" id="tmpl-${i}" onclick="selectTemplate(${i})">
      <span class="template-name">${escapeHtml(t.category)} — ${escapeHtml(t.name)}</span>
      <span class="template-preview">${escapeHtml(preview.slice(0, 72))}…</span>
    </div>`;
  }).join('');
}

function selectTemplate(idx) {
  paSelectedTemplate = idx;
  document.querySelectorAll('.template-item').forEach((el, i) => el.classList.toggle('selected', i === idx));
  const templates = _getAnnounceTemplates();
  const t = templates[idx];
  const f = paCurrentFlight;
  const raw = typeof t.build === 'function' ? t.build(f) : (t.text || '');
  const msg = raw.replace(/\{flight_number\}/g, f?.flight_number || '').replace(/\{arr_city\}/g, f?.arr_city || '');
  const ta = document.getElementById('pa-template-text');
  ta.value = msg;
  document.getElementById('pa-template-editor').style.display = 'block';
  ta.focus();
  ta.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function switchAnnounceTab(tab, btn) {
  paActiveTab = tab;
  document.querySelectorAll('.announce-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.announce-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('pa-pane-' + tab).classList.add('active');
  if (tab === 'custom') setTimeout(() => document.getElementById('pa-custom-text').focus(), 80);
}

async function submitFlightAnnounce() {
  let msg = '';
  if (paActiveTab === 'templates') {
    msg = document.getElementById('pa-template-text').value.trim();
    if (!msg) { showToast('⚠ Select and edit a template first', true); return; }
  } else {
    msg = document.getElementById('pa-custom-text').value.trim();
    if (!msg) { showToast('⚠ Message cannot be empty', true); return; }
  }
  closeMiniModal('pfannounce');
  try {
    showLoading(true);
    await apiFetch('/api/announce', 'POST', { message: msg, flight_code: currentCode });
    showToast('📣 Announcement sent to Discord!');
  } catch (e) {
    logError('unhandled', e);
    showToast(`❌ Failed: ${e.message}`, true);
  } finally {
    showLoading(false);
  }
}

// ─── MINI MODAL HELPERS ───────────────────────────────────────────────────────
function openMiniModal(name) {
  document.getElementById(`${name}-overlay`).classList.add('open');
  document.getElementById(`${name}-modal`).classList.add('open');
}

function closeMiniModal(name) {
  document.getElementById(`${name}-overlay`).classList.remove('open');
  document.getElementById(`${name}-modal`).classList.remove('open');
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function showLoading(v) {
  const bar = document.getElementById('loading-bar');
  if (bar) bar.style.display = v ? 'block' : 'none';
}

function showToast(msg, isErr = false) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
// Session vars declared in dashboard-shared.js — just assign here
// (var/let re-declaration guard: only declare if not already defined)
if (typeof sessionUserId === 'undefined') var sessionUserId = '';
if (typeof sessionUserName === 'undefined') var sessionUserName = '';
if (typeof sessionIsHoster === 'undefined') var sessionIsHoster = false;
if (typeof sessionIsManager === 'undefined') var sessionIsManager = false;
if (typeof sessionIsBod === 'undefined') var sessionIsBod = false;
if (typeof sessionIsOwner === 'undefined') var sessionIsOwner = false;

async function init() {
  try {
    const me = await fetch('/auth/me', { credentials: 'include' }).then(r => r.json());
    if (me.authenticated) {
      sessionUserId = me.user_id || '';
      sessionUserName = me.username || '';
      sessionIsHoster = me.is_hoster || false;
      sessionIsManager = me.is_manager || false;
      sessionIsBod = me.is_bod || false;
      sessionIsOwner = me.is_owner || false;
      const chip = document.getElementById('user-chip');
      if (chip) chip.style.display = 'flex';
      const avatar = document.getElementById('user-avatar');
      if (avatar) { avatar.src = me.avatar || ''; avatar.alt = me.username || ''; }
      const userName = document.getElementById('user-name');
      if (userName) userName.textContent = me.username || '';

      // Tab visibility by role:
      // BOD: everything except Diagnostics
      // Manager: Flights, Calendar, Events, Analytics, Hosts, Logs, My Analytics, UTC Calc
      // Hoster: Flights, Calendar, My Analytics, UTC Calc

      const showTab = (id, visible) => {
        const el = document.getElementById(id);
        if (!el) return;
        // Owner always sees everything regardless of tab overrides
        if (sessionIsOwner) { el.style.display = visible ? '' : 'none'; return; }
        // Non-owners: respect server-side disabled flag
        if (el.dataset.serverDisabled === 'true') { el.style.display = 'none'; return; }
        el.style.display = visible ? '' : 'none';
      };

      // Events tab — BOD, Manager, Owner only
      showTab('tab-crew-requests', sessionIsHoster || sessionIsManager || sessionIsBod || sessionIsOwner);
      // Attendance tab — visible to all hosters and above
      showTab('tab-attendance', sessionIsHoster || sessionIsManager || sessionIsBod || sessionIsOwner);
      const crewInboxWrap = document.getElementById('crew-inbox-wrap');
      if (crewInboxWrap) {
        crewInboxWrap.style.display = (sessionIsHoster || sessionIsManager || sessionIsBod || sessionIsOwner) ? 'block' : 'none';
      }

      // Start background polling for crew removal requests (updates badge)
      if ((sessionIsHoster || sessionIsManager || sessionIsBod || sessionIsOwner) && typeof startCrewPolling === 'function') {
        startCrewPolling();
      }

      // Analytics, Hosts, Logs now live in /dashboard/manager — always hide on main
      showTab('tab-analytics', false);
      showTab('tab-hosts', false);
      showTab('tab-logs', false);

      // My Analytics + Availability — everyone with any role
      showTab('tab-my-analytics', true);
      showTab('tab-availability', true);

      // Diagnostics + Customize now live in /dashboard/owner — always hide on main
      showTab('tab-debug', false);
      showTab('tab-customize', false);

      // Top-bar dashboard shortcut buttons
      const btnManager = document.getElementById('btn-manager-dash');
      const btnOwner = document.getElementById('btn-owner-dash');
      // Owner sees both buttons; managers/BOD see only manager button
      if (btnOwner) btnOwner.style.display = sessionIsOwner ? '' : 'none';
      if (btnManager) btnManager.style.display = (sessionIsManager || sessionIsBod || sessionIsOwner) ? '' : 'none';

      // Blackout dates panel — Manager, BOD, Owner (inside Calendar page)

      // Bot presence panel — Owner only (inside Diagnostics page)
      const prp = document.getElementById('presence-panel');
      if (prp) prp.style.display = sessionIsOwner ? '' : 'none';
    }
  } catch (e) {
    logError('init/session', e);
  }
  setApiStatus(false);
  applyTabOverrides();
  loadFlights();
  setInterval(loadFlights, 30000);
  checkBanner();

  // Auto-open attendance detail if URL is /dashboard/attendance/{CODE}
  if (window.location.pathname.startsWith('/dashboard/attendance/')) {
    const _atdParts = window.location.pathname.split('/');
    const _atdCode = _atdParts[_atdParts.length - 1].toUpperCase();
    if (_atdCode && typeof switchPage === 'function' && typeof atdOpenFlight === 'function') {
      switchPage('attendance');
      atdOpenFlight(_atdCode);
    }
  }
}
// Only auto-init on the main dashboard, not on manager/owner pages
if (!window._isSubDashboard) init();

window.addEventListener('popstate', () => {
  const pathCode = _dashboardCodeFromPath();
  if (pathCode) {
    openDrawer(pathCode);
  } else if (currentCode) {
    closeDrawer();
  }
});

// ─── ADD FLIGHT ───────────────────────────────────────────────────────────────
const AF_FIELDS = ['af-fn', 'af-date', 'af-dur', 'af-dcity', 'af-dcode',
  'af-dairport', 'af-dtime', 'af-acity', 'af-acode',
  'af-aairport', 'af-atime', 'af-host', 'af-event', 'af-codeshare-fn'];

function openAddFlight() {
  AF_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('af-ac').selectedIndex = 0;
  document.getElementById('af-meal').value = 'N/A';
  document.getElementById('af-host').value = sessionUserId;
  const csBox = document.getElementById('af-codeshare'); if (csBox) csBox.checked = false;
  document.getElementById('add-error').style.display = 'none';
  document.getElementById('add-overlay').classList.add('open');
  document.getElementById('add-modal').classList.add('open');
  document.getElementById('af-fn').focus();
}

function closeAddFlight() {
  document.getElementById('add-overlay').classList.remove('open');
  document.getElementById('add-modal').classList.remove('open');
}

async function submitAddFlight() {
  const g = id => document.getElementById(id).value.trim();
  const errEl = document.getElementById('add-error');
  errEl.style.display = 'none';

  const payload = {
    flight_number: g('af-fn'),
    aircraft: g('af-ac'),
    dep_date: g('af-date'),
    duration: g('af-dur'),
    dep_city: g('af-dcity'),
    dep_code: g('af-dcode').toUpperCase(),
    dep_airport: g('af-dairport'),
    dep_time: g('af-dtime'),
    terminal: 'N/A',
    arr_city: g('af-acity'),
    arr_code: g('af-acode').toUpperCase(),
    arr_airport: g('af-aairport'),
    arr_time: g('af-atime'),
    status: 'On–Time',
    meal_service: g('af-meal'),
    host_user_id: g('af-host'),
    event_link: g('af-event'),
    is_codeshare: document.getElementById('af-codeshare')?.checked || false,
    codeshare_flight: g('af-codeshare-fn'),
  };

  const required = {
    'Flight Number': payload.flight_number,
    'Aircraft': payload.aircraft,
    'Date': payload.dep_date,
    'Duration': payload.duration,
    'Dep City': payload.dep_city,
    'Dep Code': payload.dep_code,
    'Dep Airport': payload.dep_airport,
    'Dep Time': payload.dep_time,
    'Arr City': payload.arr_city,
    'Arr Code': payload.arr_code,
    'Arr Airport': payload.arr_airport,
    'Arr Time': payload.arr_time,
    'Event Link': payload.event_link,
  };

  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    errEl.textContent = '⚠ Missing: ' + missing.join(', ');
    errEl.style.display = 'block';
    return;
  }

  try {
    showLoading(true);
    const created = await apiFetch('/api/flights', 'POST', payload);
    allFlights.push(created);
    renderTable();
    closeAddFlight();
    showToast(`✅  ${created.flight_number} created — code: ${created.code}`);
    const stats = await apiFetch('/api/stats');
    updateStats(stats);
  } catch (e) {
    // 409 = scheduling conflict — show the detail message
    if (e.status === 409 || (e.message && e.message.includes('CONFLICT'))) {
      errEl.innerHTML = '⚠️ <strong>Scheduling Conflict</strong><br>' + (e.message || 'Less than 2 hours between flights');
    } else {
      errEl.textContent = '❌ ' + (e.message || 'Server error — check console');
    }
    errEl.style.display = 'block';
  } finally {
    showLoading(false);
  }
}

// ─── THEME TOGGLE ─────────────────────────────────────────────────────────────
function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  document.getElementById('theme-toggle').textContent = isLight ? '🌙' : '☀';
  localStorage.setItem('aic_theme', isLight ? 'light' : 'dark');
}
(function () {
  if (localStorage.getItem('aic_theme') === 'light') {
    document.body.classList.add('light');
    document.getElementById('theme-toggle').textContent = '🌙';
  }
})();