// ─── ANALYTICS ────────────────────────────────────────────────────────────────
async function renderAnalytics() {
  // Always fetch fresh flights + stats so analytics is correct even on first tab switch
  let stats = null;
  try {
    const [flights, s] = await Promise.all([
      apiFetch('/api/flights'),
      apiFetch('/api/stats'),
    ]);
    // Keep global arrays in sync so drawer/table stay consistent
    allFlights   = flights.filter(f => f.status !== 'Ended');
    endedFlights = flights.filter(f => f.status === 'Ended');
    stats = s;
  } catch(e) {
    logError('renderAnalytics/fetch', e);
  }

  const all   = [...allFlights, ...endedFlights];
  const ended = endedFlights;

  // Overview
  const totalPax   = ended.reduce((s, f) => s + (f.pax != null ? f.pax : 0), 0);
  const paxFlights = ended.filter(f => f.pax != null).length;
  const avgPax     = paxFlights ? (totalPax / paxFlights).toFixed(1) : '—';
  const endedCount = ended.length;
  const totalCount = stats ? (stats.total + stats.ended) : all.length;
  

  // On-time / cancel rate:
  // For ended flights: use final_status if captured, otherwise skip (unknown outcome)
  // For active flights: use status directly
  // Exclude pure N/A and flights with no meaningful status
  const effectiveStatus = f => {
    if (f.status === 'Ended') return f.final_status || null; // null = unknown, excluded from rated
    return f.status;
  };
  const RATED_STATUSES = ['On–Time', 'Cancelled', 'Delayed', 'Rescheduled'];
  const rated      = all.filter(f => RATED_STATUSES.includes(effectiveStatus(f)));
  const onTimeN    = all.filter(f => effectiveStatus(f) === 'On–Time').length;
  const cancelN    = all.filter(f => effectiveStatus(f) === 'Cancelled').length;
  const delayN     = all.filter(f => effectiveStatus(f) === 'Delayed').length;
  const onTimeRate = rated.length ? Math.round(onTimeN  / rated.length * 100) + '%' : '—';
  const cancelRate = rated.length ? Math.round(cancelN  / rated.length * 100) + '%' : '—';
  const delayRate  = rated.length ? Math.round(delayN   / rated.length * 100) + '%' : '—';

  const _set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  _set('an-total',       totalCount);
  _set('an-ended',       endedCount);
  _set('an-pax-total',   totalPax || '—');
  _set('an-pax-avg',     avgPax);
  _set('an-ontime-rate', onTimeRate);
  _set('an-cancel-rate', cancelRate);
  _set('an-delay-rate',      delayRate);
  _set('an-retention-rate',  stats && stats.avg_retention != null ? stats.avg_retention + '%' : '—');
  _set('an-codeshare-count', stats ? (stats.codeshare_count || 0) : '—');

  // Status bars
  const statusCfg = [
    { key: 'On–Time',    color: 'var(--green)'  },
    { key: 'Delayed',    color: 'var(--yellow)' },
    { key: 'Cancelled',  color: 'var(--red)'    },
    { key: 'Rescheduled',color: 'var(--blue)'   },
    { key: 'Ended',      color: 'var(--dim)'    },
    { key: 'N/A',        color: 'var(--subtext)'},
  ];
  const statusCounts = stats ? stats.statuses : {};
  if (!stats) all.forEach(f => { const s = f.status || 'N/A'; statusCounts[s] = (statusCounts[s] || 0) + 1; });
  const maxStat = Math.max(...Object.values(statusCounts), 1);
  document.getElementById('an-status-bars').innerHTML = statusCfg.map(({ key, color }) => {
    const count = statusCounts[key] || 0;
    const pct   = Math.round((count / maxStat) * 100);
    return `<div class="an-bar-wrap">
      <div class="an-bar-label"><span>${key}</span><span>${count}</span></div>
      <div class="an-bar-track"><div class="an-bar-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  }).join('');

  // Aircraft bars
  const acEntries = stats ? stats.top_aircraft : (() => {
    const c = {}; all.forEach(f => { if (f.aircraft) c[f.aircraft] = (c[f.aircraft]||0)+1; });
    return Object.entries(c).sort((a,b)=>b[1]-a[1]);
  })();
  const maxAc = acEntries[0]?.[1] || 1;
  document.getElementById('an-aircraft-bars').innerHTML = acEntries.map(([code, count]) => {
    const pct = Math.round((count / maxAc) * 100);
    return `<div class="an-bar-wrap">
      <div class="an-bar-label"><span>${code}</span><span>${count}</span></div>
      <div class="an-bar-track"><div class="an-bar-fill" style="width:${pct}%;background:var(--accent2)"></div></div>
    </div>`;
  }).join('') || '<div style="color:var(--dim);font-family:var(--mono);font-size:11px">No data yet</div>';

  // Top routes
  const routeEntries = stats ? stats.top_routes : (() => {
    const c = {}; all.forEach(f => { if (f.dep_code&&f.arr_code) { const r=`${f.dep_code}→${f.arr_code}`; c[r]=(c[r]||0)+1; } });
    return Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,8);
  })();
  document.getElementById('an-routes-list').innerHTML = routeEntries.slice(0,10).map(([route, count]) =>
    `<div class="an-route-row"><span class="an-route-codes">${route}</span><span class="an-route-count">${count} flight${count !== 1 ? 's' : ''}</span></div>`
  ).join('') || '<div style="color:var(--dim);font-family:var(--mono);font-size:11px">No data yet</div>';

  // Top hosts by flight count
  const hostEntries = stats ? stats.top_hosts : [];
  const maxHost = hostEntries[0]?.[1] || 1;
  document.getElementById('an-hosts-bars').innerHTML = hostEntries.slice(0,8).map(([uid, count]) => {
    const pct   = Math.round((count / maxHost) * 100);
    const label = uid.length > 10 ? uid.slice(0,6)+'…' : uid;
    return `<div class="an-bar-wrap">
      <div class="an-bar-label"><span style="font-size:10px">${label}</span><span>${count}</span></div>
      <div class="an-bar-track"><div class="an-bar-fill" style="width:${pct}%;background:var(--blue)"></div></div>
    </div>`;
  }).join('') || '<div style="color:var(--dim);font-family:var(--mono);font-size:11px">No data yet</div>';

  // Pax trend + route map
  paxTrendData.weekly  = stats ? (stats.weekly_pax  || []) : [];
  paxTrendData.monthly = stats ? (stats.monthly_pax || []) : [];
  renderPaxTrend();
  if (stats && stats.airport_nodes) renderRouteMap(stats.airport_nodes, stats.route_edges || []);

  // Peak departure hours — 7×24 heatmap
  const heatmapData = stats ? stats.dep_heatmap : null; // { "0-14": 3, "2-9": 1, ... } day-hour → count
  const heatEl = document.getElementById('an-heatmap');
  if (!heatmapData || !Object.keys(heatmapData).length) {
    heatEl.innerHTML = '<div style="color:var(--dim);font-family:var(--mono);font-size:11px">No data yet</div>';
  } else {
    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const HOURS = Array.from({length:24}, (_,i) => i);
    // find max for color scaling
    const vals = Object.values(heatmapData);
    const hmMax = Math.max(...vals, 1);

    let html = '<div style="display:grid;grid-template-columns:36px repeat(24,1fr);gap:2px;min-width:600px">';
    // Header row — hours
    html += '<div></div>';
    HOURS.forEach(h => {
      html += `<div style="font-family:var(--mono);font-size:8px;color:var(--subtext);text-align:center;padding-bottom:3px">${String(h).padStart(2,'0')}</div>`;
    });
    // Day rows
    DAYS.forEach((day, d) => {
      html += `<div style="font-family:var(--mono);font-size:9px;color:var(--subtext);display:flex;align-items:center;justify-content:flex-end;padding-right:6px">${day}</div>`;
      HOURS.forEach(h => {
        const key = `${d}-${h}`;
        const count = heatmapData[key] || 0;
        const intensity = count ? Math.max(0.12, count / hmMax) : 0;
        const bg = count ? `rgba(200,16,46,${intensity.toFixed(2)})` : 'var(--border)';
        const tip = count ? `${day} ${String(h).padStart(2,'0')}:00 — ${count} flight${count!==1?'s':''}` : `${day} ${String(h).padStart(2,'0')}:00 — no flights`;
        html += `<div data-htip="${tip}" class="hm-cell" style="height:18px;background:${bg};border-radius:2px;cursor:default"></div>`;
      });
    });
    html += '</div>';
    // Legend
    html += '<div style="display:flex;align-items:center;gap:8px;margin-top:10px;font-family:var(--mono);font-size:9px;color:var(--subtext)">';
    html += '<span>Less</span>';
    [0.08,0.2,0.4,0.65,1.0].forEach(v => {
      html += `<div style="width:14px;height:14px;background:rgba(200,16,46,${v});border-radius:2px"></div>`;
    });
    html += '<span>More</span></div>';
    heatEl.innerHTML = html;

    // JS hover tooltip via event delegation on parent (avoids issues with tiny cells + re-render)
    let hmTip = document.getElementById('hm-tooltip');
    if (!hmTip) {
      hmTip = document.createElement('div');
      hmTip.id = 'hm-tooltip';
      hmTip.style.cssText = 'position:fixed;background:#0f1117;color:#d6daf0;font-family:monospace;font-size:11px;padding:5px 11px;border:1px solid #c8102e;border-radius:3px;pointer-events:none;display:none;z-index:9999;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,0.5)';
      document.body.appendChild(hmTip);
    }
    // Use event delegation — one listener on parent, check target
    heatEl.onmousemove = function(ev) {
      const cell = ev.target.closest('.hm-cell');
      if (cell) {
        hmTip.textContent = cell.dataset.htip;
        hmTip.style.display = 'block';
        hmTip.style.left = (ev.clientX + 14) + 'px';
        hmTip.style.top  = (ev.clientY - 34) + 'px';
      } else {
        hmTip.style.display = 'none';
      }
    };
    heatEl.onmouseleave = function() { hmTip.style.display = 'none'; };
  }

  // Flights per month — vertical bar chart
  const monthEntries = stats ? stats.monthly : [];
  const maxMonth = Math.max(...monthEntries.map(([,c])=>c), 1);
  document.getElementById('an-monthly-bars').innerHTML = monthEntries.map(([month, count]) => {
    const pct   = Math.round((count / maxMonth) * 100);
    const label = month.slice(0,7); // YYYY-MM
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;min-width:28px">
      <span style="font-family:var(--mono);font-size:9px;color:var(--subtext)">${count}</span>
      <div style="width:100%;height:${pct}%;min-height:3px;background:var(--accent2);transition:height .3s"></div>
      <span style="font-family:var(--mono);font-size:8px;color:var(--dim);writing-mode:vertical-rl;transform:rotate(180deg)">${label}</span>
    </div>`;
  }).join('') || '<div style="color:var(--dim);font-family:var(--mono);font-size:11px">No data yet</div>';

  // Passenger log table (ended flights) — most recent first
  const paxBody = document.getElementById('an-pax-body');
  const endedSorted = [...ended].sort((a, b) => {
    const da = a.dep_date || ''; const db = b.dep_date || '';
    return da < db ? 1 : da > db ? -1 : 0;
  });
  if (!endedSorted.length) {
    paxBody.innerHTML = '<tr><td colspan="7" style="color:var(--dim);text-align:center;padding:1rem;font-family:var(--mono);font-size:11px">No ended flights yet</td></tr>';
    return;
  }
  try { paxBody.innerHTML = endedSorted.map(f => {
    const retention = (f.pax_joined > 0 && f.pax_remained != null)
      ? Math.round(f.pax_remained / f.pax_joined * 100) + '%' : '—';
    const retColor = (f.pax_joined > 0 && f.pax_remained != null)
      ? (f.pax_remained/f.pax_joined >= 0.8 ? 'var(--green)' : f.pax_remained/f.pax_joined >= 0.5 ? 'var(--yellow)' : 'var(--red)') : 'var(--subtext)';
    const statusDisplay = f.final_status || f.status || '—';
    const sCls = {'On–Time':'ontime','Delayed':'delayed','Cancelled':'cancelled','Rescheduled':'rescheduled','Ended':'ended','N/A':'na'}[statusDisplay] || 'na';
    return `<tr>
      <td style="font-family:var(--mono);font-size:11px">${f.code}</td>
      <td>${f.flight_number||'—'}${f.is_codeshare&&f.codeshare_flight?`<br><span style="font-size:10px;color:var(--dim)">${f.codeshare_flight}</span>`:''}</td>
      <td>${f.dep_code||'?'} → ${f.arr_code||'?'}</td>
      <td>${f.dep_date||'—'}</td>
      <td>${f.aircraft||'—'}</td>
      <td>${f.is_codeshare?'<span class="badge rescheduled" style="font-size:10px">Codeshare</span>':'—'}</td>
      <td><span class="badge ${sCls}" style="font-size:10px">${statusDisplay}</span></td>
      <td><input class="pax-input" type="number" min="0" max="999" style="width:54px"
        value="${f.pax_joined!=null?f.pax_joined:''}" placeholder="—"
        id="pax-joined-${f.code}" onchange="savePaxRetention('${f.code}')" /></td>
      <td><input class="pax-input" type="number" min="0" max="999" style="width:54px"
        value="${f.pax_remained!=null?f.pax_remained:''}" placeholder="—"
        id="pax-remained-${f.code}" onchange="savePaxRetention('${f.code}')" /></td>
      <td style="font-weight:600;color:${retColor}">${retention}</td>
      <td style="color:var(--subtext);font-size:11px">${f.pax_notes||'—'}</td>
    </tr>`;
  }).join('');
  } catch(e) { logError('renderAnalytics/paxTable', e); paxBody.innerHTML = `<tr><td colspan="11" style="color:var(--red);padding:1rem;font-family:var(--mono);font-size:11px">⚠ Render error: ${e.message}</td></tr>`; }

  // Retention summary bar
  const retF = ended.filter(f => f.pax_joined > 0 && f.pax_remained != null);
  const sumEl = document.getElementById('an-retention-summary');
  if (retF.length && sumEl) {
    const totJ = retF.reduce((a,f)=>a+f.pax_joined,0);
    const totR = retF.reduce((a,f)=>a+f.pax_remained,0);
    const avgR = Math.round(totR/totJ*100);
    const col  = avgR>=80?'var(--green)':avgR>=50?'var(--yellow)':'var(--red)';
    sumEl.style.display = 'flex';
    sumEl.innerHTML = `<span>Total Joined: <strong>${totJ}</strong></span>
      <span>Total Remained: <strong>${totR}</strong></span>
      <span>Avg Retention: <strong style="color:${col}">${avgR}%</strong></span>
      <span style="color:var(--dim)">(${retF.length} flights)</span>`;
  }
}

async function savePaxRetention(code) {
  const jEl = document.getElementById(`pax-joined-${code}`);
  const rEl = document.getElementById(`pax-remained-${code}`);
  if (!jEl || !rEl) return;
  const pax_joined   = jEl.value !== '' ? parseInt(jEl.value, 10) : null;
  const pax_remained = rEl.value !== '' ? parseInt(rEl.value, 10) : null;
  try {
    const updated = await apiFetch(`/api/flights/${code}`, 'PATCH',
      { pax: pax_joined, pax_joined, pax_remained });
    const idx = endedFlights.findIndex(x => x.code === code);
    if (idx !== -1) endedFlights[idx] = { ...endedFlights[idx], ...updated };
    showToast(`✅ Pax saved for ${code}`);
    renderAnalytics();
  } catch(e) {
    logError('savePaxRetention', e);
    showToast(`❌ Pax save failed: ${e.message}`, true);
  }
}