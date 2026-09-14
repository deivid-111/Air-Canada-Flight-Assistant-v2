// ─── HOSTS ────────────────────────────────────────────────────────────────────
let allHosts      = [];
let currentHostId = null;

async function loadHosts() {
  if (!sessionIsManager && !sessionIsOwner) return;
  document.getElementById('hosts-list').innerHTML = '<div class="hosts-empty">Loading…</div>';
  try {
    allHosts = await apiFetch('/api/hosts');
    renderHostList(allHosts);
  } catch(e) {
    logError('loadHosts', e);
    document.getElementById('hosts-list').innerHTML =
      `<div class="hosts-empty" style="color:var(--red)">⚠ ${e.message}</div>`;
  }
}

function filterHosts() {
  const q = document.getElementById('hosts-search').value.toLowerCase().trim();
  renderHostList(q ? allHosts.filter(h => h.username.toLowerCase().includes(q)) : allHosts);
}

function renderHostList(hosts) {
  const list = document.getElementById('hosts-list');
  if (!hosts.length) {
    list.innerHTML = '<div class="hosts-empty">No hosts found</div>';
    return;
  }
  list.innerHTML = hosts.map(h => `
    <div class="host-item${currentHostId === h.user_id ? ' active' : ''}" onclick="loadHostProfile('${h.user_id}')" ondblclick="addToComparison('${h.user_id}',event)" title="Click to view · Double-click to compare">
      <img class="host-item-avatar" src="${h.avatar}" alt="${escapeHtml(h.username)}"
           onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
      <div class="host-item-info">
        <div class="host-item-name">${escapeHtml(h.username)}</div>
        <div class="host-item-meta">${h.flight_count} flight${h.flight_count !== 1 ? 's' : ''}</div>
      </div>
      <div class="host-item-count">${h.flight_count}</div>
    </div>
  `).join('');
}

async function loadHostProfile(userId) {
  currentHostId = userId;
  filterHosts(); // re-render list to update active highlight

  const member = allHosts.find(h => h.user_id === userId);

  // Reveal panel, show skeleton values
  document.getElementById('host-profile-empty').style.display   = 'none';
  document.getElementById('host-profile-content').style.display = '';
  document.getElementById('hp-avatar').src         = member?.avatar || '';
  document.getElementById('hp-name').textContent   = member?.username || '…';
  document.getElementById('hp-id').textContent     = `ID: ${userId}`;
  document.getElementById('hp-joined').textContent = member?.joined_at
    ? `Joined server: ${formatJoinDate(member.joined_at)}` : '';
  ['hp-total','hp-ontime-rate','hp-cancel-rate','hp-delay-rate','hp-avg-pax',
   'hp-ended','hp-total-pax','hp-active','hp-best-streak','hp-cur-streak',
   'hp-fav-ac','hp-busiest-month']
    .forEach(id => { const el = document.getElementById(id); if(el) el.textContent = '…'; });
  document.getElementById('hp-flights-body').innerHTML  =
    '<tr><td colspan="7" style="color:var(--dim);text-align:center;padding:1rem;font-family:var(--mono);font-size:11px">Loading…</td></tr>';
  document.getElementById('hp-activity-list').innerHTML =
    '<div class="hosts-empty">Loading…</div>';

  try {
    const profile = await apiFetch(`/api/hosts/${userId}`);
    const s = profile.stats;

    const fmt = v => v != null ? v : '—';
    const pct = v => v != null ? v + '%' : '—';

    document.getElementById('hp-total').textContent        = fmt(s.total);
    document.getElementById('hp-ended').textContent        = fmt(s.ended);
    document.getElementById('hp-active').textContent       = fmt(s.active);
    document.getElementById('hp-avg-pax').textContent      = fmt(s.avg_pax);
    document.getElementById('hp-total-pax').textContent    = s.total_pax || '—';
    document.getElementById('hp-best-streak').textContent  = s.best_streak ? s.best_streak + ' ✈' : '—';
    document.getElementById('hp-cur-streak').textContent   = s.current_streak ? s.current_streak + ' ✈' : '—';
    document.getElementById('hp-fav-ac').textContent       = fmt(s.fav_aircraft);
    document.getElementById('hp-busiest-month').textContent     = fmt(s.busiest_month);
    document.getElementById('hp-busiest-month-sub').textContent = s.busiest_month ? s.busiest_month_count + ' flights' : '';

    // Rates — show N/A if no rated flights at all, with sub-label showing sample size
    const ratedLabel = s.rated_total ? `from ${s.rated_total} rated` : 'no data yet';
    document.getElementById('hp-ontime-rate').textContent  = pct(s.on_time_rate);
    document.getElementById('hp-ontime-sub').textContent   = ratedLabel;
    document.getElementById('hp-cancel-rate').textContent  = pct(s.cancel_rate);
    document.getElementById('hp-cancel-sub').textContent   = ratedLabel;
    document.getElementById('hp-delay-rate').textContent   = pct(s.delay_rate);
    document.getElementById('hp-delay-sub').textContent    = ratedLabel;

    // Extra info grid
    const infoGrid = document.getElementById('hp-info-grid');
    const infoRow = (label, val) => `
      <div style="background:var(--card);padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-family:var(--mono);font-size:10px;color:var(--subtext);letter-spacing:.08em">${label}</span>
        <span style="font-family:var(--mono);font-size:11px;color:var(--text)">${val}</span>
      </div>`;
    infoGrid.innerHTML = [
      infoRow('First flight', s.first_flight_date  ? `${s.first_flight_number} · ${s.first_flight_date}`  : '—'),
      infoRow('Latest flight', s.latest_flight_date ? `${s.latest_flight_number} · ${s.latest_flight_date}` : '—'),
      infoRow('Max passengers', s.max_pax != null ? `${s.max_pax} pax on ${s.max_pax_flight}` : '—'),
      infoRow('On-Time count', `${s.on_time} / ${s.rated_total || 0} rated flights`),
      infoRow('Cancelled', s.cancelled + ' flight' + (s.cancelled !== 1 ? 's' : '')),
      infoRow('Delayed', s.delayed + ' flight' + (s.delayed !== 1 ? 's' : '')),
      infoRow('Rescheduled', s.rescheduled + ' flight' + (s.rescheduled !== 1 ? 's' : '')),
      infoRow('Completion rate', s.total ? Math.round(s.ended / s.total * 100) + '%' : '—'),
    ].join('');

    // Top routes
    const routesEl = document.getElementById('hp-routes-list');
    if (s.top_routes && s.top_routes.length) {
      routesEl.innerHTML = s.top_routes.map(([route, count]) =>
        `<div class="an-route-row"><span class="an-route-codes">${route}</span><span class="an-route-count">${count}×</span></div>`
      ).join('');
    } else {
      routesEl.innerHTML = '<div style="color:var(--dim);font-family:var(--mono);font-size:11px;padding-bottom:.5rem">No route data</div>';
    }

    // Flights table
    const tbody = document.getElementById('hp-flights-body');
    if (!profile.flights.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="color:var(--dim);text-align:center;padding:1rem;font-family:var(--mono);font-size:11px">No flights hosted yet</td></tr>';
    } else {
      tbody.innerHTML = profile.flights.map(f => {
        const displayStatus = f.status === 'Ended' && f.final_status
          ? `${statusBadge('Ended')} <span style="font-size:9px;color:var(--subtext)">(was ${f.final_status})</span>`
          : statusBadge(f.status);
        return `
        <tr onclick="switchPage('flights');setTimeout(()=>openDrawer('${f.code}'),80)" style="cursor:pointer">
          <td>${f.code}</td>
          <td>${f.flight_number || '—'}</td>
          <td>${f.dep_code || '?'} → ${f.arr_code || '?'}</td>
          <td>${f.dep_date || '—'}</td>
          <td>${f.aircraft || '—'}</td>
          <td>${displayStatus}</td>
          <td>${f.pax != null ? f.pax : '—'}</td>
        </tr>`;
      }).join('');
    }

    // Availability grid (manager view)
    if (typeof loadHostAvailability === 'function') {
      loadHostAvailability(userId, 'hp-availability');
    }

    // Activity
    const username = member?.username || '';
    const relevant = profile.logs
      .filter(l => l.user && (
        l.user === username ||
        l.user === userId ||
        (username && l.user.toLowerCase().includes(username.toLowerCase()))
      ))
      .reverse()
      .slice(0, 50);

    const actEl = document.getElementById('hp-activity-list');
    if (!relevant.length) {
      actEl.innerHTML = '<div class="hosts-empty">No dashboard activity found for this host</div>';
    } else {
      actEl.innerHTML = relevant.map(l => `
        <div class="hp-activity-item">
          <span class="hp-activity-time">${l.time && l.time !== '—' ? l.time : '—'}</span>
          <span class="hp-activity-action">${escapeHtml(l.action || '')}</span>
          <span class="hp-activity-level ${l.level || 'info'}">${(l.level || 'info').toUpperCase()}</span>
        </div>`).join('');
    }

  } catch(e) {
    logError('dashboard-hosts.js', e);
    showToast(`❌ Failed to load profile: ${e.message}`, true);
  }
}

function formatJoinDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-CA', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  } catch { return iso; }
}


// ─── MY ANALYTICS ─────────────────────────────────────────────────────────────
async function loadMyAnalytics() {
  const errEl = document.getElementById('ma-error');
  if (errEl) errEl.style.display = 'none';

  // Set username label
  const nameEl = document.getElementById('my-analytics-username');
  if (nameEl && sessionUserId) nameEl.textContent = sessionUserName || sessionUserId;

  // Need user ID from session
  if (!sessionUserId) {
    if (errEl) { errEl.textContent = '⚠ Not logged in'; errEl.style.display = ''; }
    return;
  }

  const tbody = document.getElementById('ma-flights-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="color:var(--dim);text-align:center;padding:1.5rem;font-family:var(--mono);font-size:11px">Loading…</td></tr>';

  const _set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '—'; };

  try {
    const profile = await apiFetch(`/api/hosts/${sessionUserId}`);
    const s = profile.stats;
    const fmt = v => v != null ? v : '—';
    const pct = v => v != null ? v + '%' : '—';

    _set('ma-total',        fmt(s.total));
    _set('ma-ended',        fmt(s.ended));
    _set('ma-active',       fmt(s.active));
    _set('ma-total-pax',    fmt(s.total_pax));
    _set('ma-avg-pax',      fmt(s.avg_pax));
    _set('ma-ontime',       pct(s.on_time_rate));
    _set('ma-cancel',       pct(s.cancel_rate));
    _set('ma-delay',        pct(s.delay_rate));
    _set('ma-best-streak',  s.best_streak  ? s.best_streak  + ' ✈' : '—');
    _set('ma-cur-streak',   s.current_streak ? s.current_streak + ' ✈' : '—');
    _set('ma-fav-ac',       fmt(s.fav_aircraft));
    _set('ma-busiest-month', fmt(s.busiest_month));
    _set('ma-busiest-sub',  s.busiest_month ? s.busiest_month_count + ' flights' : '');

    const ratedLabel = s.rated_total ? `from ${s.rated_total} rated` : 'no data yet';
    _set('ma-ontime-sub',  ratedLabel);
    _set('ma-cancel-sub',  ratedLabel);
    _set('ma-delay-sub',   ratedLabel);

    _set('ma-first-flight',  s.first_flight_date  ? `${s.first_flight_number} · ${s.first_flight_date}`  : '—');
    _set('ma-latest-flight', s.latest_flight_date ? `${s.latest_flight_number} · ${s.latest_flight_date}` : '—');

    // Flight history table
    if (tbody) {
      if (!profile.flights || !profile.flights.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:var(--dim);text-align:center;padding:1.5rem;font-family:var(--mono);font-size:11px">No flights yet</td></tr>';
      } else {
        tbody.innerHTML = profile.flights.map(f => {
          const statusDisplay = (f.status === 'Ended' ? (f.final_status || 'Ended') : f.status) || '—';
          const sCls = {'On–Time':'ontime','Delayed':'delayed','Cancelled':'cancelled','Rescheduled':'rescheduled','Ended':'ended','N/A':'na'}[statusDisplay] || 'na';
          const isCohost = f._role === 'cohost';
          const roleBadge = isCohost
            ? `<span style="font-family:var(--mono);font-size:9px;padding:1px 5px;background:rgba(180,122,255,.15);border:1px solid #b47aff;color:#b47aff;margin-left:4px">CO</span>`
            : '';
          return `<tr style="${isCohost ? 'opacity:.85' : ''}">
            <td style="font-family:var(--mono);font-size:11px">${f.code}${roleBadge}</td>
            <td>${f.flight_number || '—'}</td>
            <td>${f.dep_code || '?'} → ${f.arr_code || '?'}</td>
            <td>${f.dep_date || '—'}</td>
            <td>${f.aircraft || '—'}</td>
            <td><span class="badge ${sCls}" style="font-size:10px">${statusDisplay}</span></td>
            <td>${f.pax != null ? f.pax : '—'}</td>
          </tr>`;
        }).join('');
      }
    }
  } catch(e) {
    logError('loadMyAnalytics', e);
    if (errEl) { errEl.textContent = `⚠ ${e.message}`; errEl.style.display = ''; }
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red);text-align:center;padding:1rem;font-family:var(--mono);font-size:11px">⚠ ${e.message}</td></tr>`;
  }
}