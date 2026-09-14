let _bannerDismissed = false; // must be at top — checkBanner refs it on load

// ─── COLUMN SORT ─────────────────────────────────────────────────────────────
let sortCol = 'dep_date';
let sortDir = 'asc';

function toggleSort(col) {
  if (sortCol === col) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortCol = col;
    sortDir = 'asc';
  }
  // Update icons
  ['code', 'flight', 'route', 'dep_date', 'dep_time', 'arr_time', 'aircraft', 'status'].forEach(c => {
    const el = document.getElementById('si-' + c);
    if (el) el.textContent = sortCol === c ? (sortDir === 'asc' ? '↑' : '↓') : '';
  });
  // Respect current view — don't jump back to active when on ended tab
  if (typeof activeFilter !== 'undefined' && activeFilter === 'ended') {
    renderEndedTable();
  } else {
    renderTable();
  }
}

function getSortVal(f, col) {
  switch (col) {
    case 'code': return f.code || '';
    case 'flight': return f.flight_number || '';
    case 'route': return `${f.dep_code}${f.arr_code}` || '';
    case 'dep_date': return f.dep_date || '';
    case 'dep_time': return f.dep_time || '';
    case 'arr_time': return f.arr_time || '';
    case 'aircraft': return f.aircraft || '';
    case 'status': return f.status || '';
    default: return '';
  }
}

// Patch renderTable to respect sort
const _origRenderTable = renderTable;
function renderTable() {
  const rows = getFiltered();
  const body = document.getElementById('flights-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="10"><div class="empty-state"><span class="empty-icon">✈</span><span>No flights match filters</span></div></td></tr>`;
    return;
  }

  // Sort rows
  const sorted = [...rows].sort((a, b) => {
    const va = getSortVal(a, sortCol);
    const vb = getSortVal(b, sortCol);
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // If sorting by date, still group by date
  if (sortCol === 'dep_date') {
    const grouped = {};
    sorted.forEach(f => {
      const d = f.dep_date || 'Unknown';
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push(f);
    });
    const sortedDates = Object.keys(grouped).sort((a, b) => {
      const cmp = new Date(a) - new Date(b);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    let html = '';
    sortedDates.forEach(date => {
      html += `<tr class="date-group-header"><td colspan="10">${formatDateLabel(date)}</td></tr>`;
      grouped[date].forEach(f => { html += buildRow(f); });
    });
    body.innerHTML = html;
  } else {
    // Flat sort — no date grouping
    body.innerHTML = sorted.map(f => buildRow(f)).join('');
  }
}

// ─── PASSENGER TREND CHART ────────────────────────────────────────────────────
let paxTrendMode = 'weekly';
let paxTrendData = { weekly: [], monthly: [] };

function setPaxTrend(mode) {
  paxTrendMode = mode;
  document.getElementById('pax-trend-weekly').style.opacity = mode === 'weekly' ? '1' : '.5';
  document.getElementById('pax-trend-monthly').style.opacity = mode === 'monthly' ? '1' : '.5';
  renderPaxTrend();
}

function renderPaxTrend() {
  const el = document.getElementById('an-pax-trend');
  if (!el) return;
  const data = paxTrendData[paxTrendMode] || [];
  if (!data.length) {
    el.innerHTML = '<div style="color:var(--dim);font-family:var(--mono);font-size:11px;padding:8px 0">No passenger data yet</div>';
    return;
  }

  const vals = data.map(([, v]) => v);
  const max = Math.max(...vals, 1);
  const W = 28; // bar width px
  const H = 100;
  const gap = 4;
  const totalW = data.length * (W + gap);

  let svg = `<svg viewBox="0 0 ${totalW} ${H + 28}" style="width:100%;max-width:${totalW * 2}px;height:${H + 28}px;overflow:visible">`;
  data.forEach(([label, val], i) => {
    const x = i * (W + gap);
    const bh = Math.max(2, Math.round((val / max) * H));
    const y = H - bh;
    const col = 'var(--accent)';
    svg += `<rect x="${x}" y="${y}" width="${W}" height="${bh}" fill="${col}" fill-opacity=".85" rx="2">
      <title>${label}: ${val} pax</title></rect>`;
    svg += `<text x="${x + W / 2}" y="${H + 12}" text-anchor="middle" font-family="var(--mono)" font-size="7" fill="var(--subtext)">${label.replace(/^\d{4}-/, '')}</text>`;
    svg += `<text x="${x + W / 2}" y="${y - 3}" text-anchor="middle" font-family="var(--mono)" font-size="8" fill="var(--text)">${val}</text>`;
  });
  svg += '</svg>';
  el.innerHTML = svg;
}

// ─── ROUTE MAP ────────────────────────────────────────────────────────────────
function renderRouteMap(nodes, edges) {
  const container = document.getElementById('an-route-map');
  if (!container) return;

  const emptyEl = document.getElementById('an-route-map-empty');
  if (!nodes || !Object.keys(nodes).length) {
    if (emptyEl) emptyEl.textContent = 'No route data with known airports yet';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const isDark = !document.body.classList.contains('light');
  const bgCol = isDark ? '#080b12' : '#dce6f0';
  const landCol = isDark ? '#1c2235' : '#c2ccd8';
  const landStroke = isDark ? '#2a3148' : '#9faab8';
  const textCol = isDark ? '#d0d8f0' : '#1a1d2e';
  const dotStroke = isDark ? '#080b12' : '#ffffff';
  const gridCol = isDark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,30,0.07)';

  // Determine bbox from airport coords — expand to show context
  const allLats = Object.values(nodes).map(v => v[0]);
  const allLons = Object.values(nodes).map(v => v[1]);
  let minLat = Math.min(...allLats), maxLat = Math.max(...allLats);
  let minLon = Math.min(...allLons), maxLon = Math.max(...allLons);

  // Always show at least a meaningful region; pad generously
  const latSpan = Math.max(maxLat - minLat, 30);
  const lonSpan = Math.max(maxLon - minLon, 50);
  minLat = Math.max(-85, minLat - latSpan * 0.35);
  maxLat = Math.min(85, maxLat + latSpan * 0.35);
  minLon = Math.max(-180, minLon - lonSpan * 0.25);
  maxLon = Math.min(180, maxLon + lonSpan * 0.25);

  const W = 1000, H = 460;

  function proj(lat, lon) {
    const x = ((lon - minLon) / (maxLon - minLon)) * (W - 20) + 10;
    const y = ((maxLat - lat) / (maxLat - minLat)) * (H - 20) + 10;
    return [+x.toFixed(1), +y.toFixed(1)];
  }

  // Convert lat/lon array [lat,lon, lat,lon...] to SVG path — clipped to bbox
  function path(...coords) {
    const pts = [];
    for (let i = 0; i < coords.length; i += 2) {
      const lat = coords[i], lon = coords[i + 1];
      if (lat < minLat - 5 && coords[i + 2] < minLat - 5) continue;
      if (lat > maxLat + 5 && coords[i + 2] > maxLat + 5) continue;
      const [x, y] = proj(lat, lon);
      pts.push(pts.length === 0 ? `M${x},${y}` : `L${x},${y}`);
    }
    return pts.length > 2 ? pts.join(' ') + ' Z' : '';
  }

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="width:100%;height:100%;display:block">`);
  parts.push(`<rect width="${W}" height="${H}" fill="${bgCol}"/>`);

  // Grid lines
  for (let lo = -180; lo <= 180; lo += 20) {
    if (lo < minLon || lo > maxLon) continue;
    const [x] = proj(0, lo);
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${gridCol}" stroke-width="1"/>`);
  }
  for (let la = -80; la <= 80; la += 20) {
    if (la < minLat || la > maxLat) continue;
    const [, y] = proj(la, 0);
    parts.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${gridCol}" stroke-width="1"/>`);
  }

  // ── Continent shapes (much more accurate lat/lon outlines) ──
  // North America
  const nAm = path(
    71, -141, 70, -132, 60, -137, 55, -130, 48, -124, 46, -124, 42, -124,
    38, -123, 35, -121, 32, -117, 30, -110, 25, -97, 21, -90, 16, -87,
    15, -83, 8, -77, 8, -77, 9, -79, 9, -83, 16, -87, 21, -90, 25, -80,
    25, -80, 30, -80, 35, -75, 40, -74, 44, -66, 47, -53, 52, -56,
    58, -62, 60, -64, 63, -68, 70, -68, 72, -80, 72, -95, 68, -108,
    70, -120, 72, -128, 72, -141, 71, -141
  );

  // Alaska
  const alaska = path(60, -141, 58, -137, 55, -131, 55, -160, 60, -165, 62, -165, 65, -168, 70, -163, 71, -156, 70, -141, 60, -141);

  // Central America (thin strip)
  const cAm = path(21, -90, 16, -87, 15, -83, 9, -79, 9, -83, 11, -84, 14, -87, 16, -90, 21, -90);

  // South America
  const sAm = path(
    12, -72, 10, -62, 8, -60, 6, -60, 2, -50, -1, -48, -5, -35,
    -10, -37, -15, -39, -23, -43, -27, -48, -34, -53, -38, -57,
    -42, -63, -55, -65, -55, -68, -44, -65, -38, -57, -30, -50,
    -20, -40, -10, -37, -5, -35, -3, -40, 2, -50, 6, -60, 8, -60,
    10, -62, 12, -72
  );

  // Europe (much more detailed)
  const eur = path(
    71, 26, 68, 18, 65, 14, 60, 5, 58, 5, 57, 8, 56, 10, 55, 15,
    54, 18, 54, 22, 56, 21, 58, 22, 60, 25, 62, 24, 64, 26, 66, 26,
    68, 20, 70, 20, 71, 26
  );
  const eurMain = path(
    36, -5, 38, -9, 43, -9, 44, -8, 44, -1, 47, -2, 48, -5, 51, -5,
    51, 2, 52, 4, 53, 5, 54, 8, 55, 10, 56, 10, 57, 8, 58, 5,
    60, 5, 60, 11, 58, 12, 57, 12, 56, 12, 55, 12, 54, 12, 54, 18,
    52, 21, 50, 18, 48, 17, 47, 16, 46, 14, 46, 13, 44, 15, 42, 13,
    40, 18, 38, 16, 38, 15, 37, 15, 37, 13, 38, 13, 37, 10,
    36, 5, 36, -5
  );
  const iberia = path(44, -9, 43, -9, 38, -9, 36, -5, 36, 2, 40, 4, 43, 3, 44, 0, 45, -1, 44, -9);
  const ukIre = path(60, -1, 58, 0, 53, 0, 51, -5, 53, -4, 55, -5, 58, -5, 60, -1);
  const scand = path(71, 26, 68, 18, 65, 14, 62, 5, 58, 5, 57, 8, 56, 10, 58, 12, 60, 11,
    60, 5, 65, 14, 68, 18, 71, 26);

  // Africa
  const afr = path(
    37, 10, 37, 37, 30, 32, 15, 42, 11, 43, 2, 42, -1, 40, -10, 40,
    -18, 36, -26, 33, -35, 18, -34, 26, -26, 33, -18, 36,
    -11, 40, 2, 42, 11, 43, 15, 42, 30, 32, 37, 37, 37, 10
  );
  const afr2 = path(
    37, 10, 35, 5, 28, -13, 20, -17, 15, -17, 10, -15, 5, -3, 2, 2,
    2, 10, 4, 8, 10, 0, 15, -2, 20, 0, 28, 0, 35, 5, 37, 10
  );

  // Asia (mainland)
  const asia = path(
    71, 26, 71, 60, 71, 105, 71, 140, 60, 140, 50, 140, 45, 130,
    40, 122, 35, 120, 30, 120, 22, 114, 18, 110, 10, 105, 1, 104,
    1, 103, 5, 100, 13, 100, 20, 93, 22, 90, 20, 80, 22, 70,
    25, 57, 12, 44, 30, 32, 37, 37, 37, 50, 40, 50, 45, 40,
    42, 50, 45, 60, 55, 60, 55, 80, 60, 75, 65, 60, 71, 60, 71, 26
  );
  const midEast = path(37, 37, 30, 32, 22, 38, 15, 42, 11, 43, 22, 57, 25, 57, 22, 70, 20, 80, 22, 70, 25, 57, 22, 57, 12, 44, 37, 37);
  const india = path(22, 68, 28, 65, 32, 70, 28, 80, 22, 90, 8, 77, 8, 80, 22, 90, 28, 80, 32, 70, 28, 65, 22, 68);
  const seAsia = path(10, 105, 13, 100, 20, 93, 18, 110, 10, 105);

  // Japan
  const japan = path(45, 142, 43, 145, 40, 141, 37, 136, 34, 136, 33, 131, 36, 132, 38, 141, 41, 141, 43, 141, 45, 142);

  // Australia
  const aus = path(
    -16, 129, -14, 130, -13, 136, -12, 136, -14, 143, -18, 147,
    -28, 153, -34, 151, -38, 146, -38, 140, -35, 136, -34, 120,
    -22, 114, -18, 122, -16, 129
  );
  const nz1 = path(-36, 174, -38, 176, -46, 168, -44, 170, -36, 174);
  const nz2 = path(-40, 175, -43, 172, -46, 168, -44, 170, -40, 175);

  // Greenland
  const greenland = path(83, -45, 76, -18, 70, -22, 60, -44, 60, -48, 66, -54, 76, -68, 83, -45);

  // Draw all land
  [nAm, alaska, cAm, sAm, eurMain, iberia, ukIre, eur, scand, afr, afr2,
    asia, midEast, india, seAsia, japan, aus, nz1, nz2, greenland
  ].forEach(d => {
    if (d) parts.push(`<path d="${d}" fill="${landCol}" stroke="${landStroke}" stroke-width="0.8" stroke-linejoin="round"/>`);
  });

  // ── Route arcs ──
  const maxCount = edges.length ? Math.max(...edges.map(e => e.count)) : 1;
  edges.forEach(e => {
    const dep = nodes[e.dep], arr = nodes[e.arr];
    if (!dep || !arr) return;
    const [x1, y1] = proj(dep[0], dep[1]);
    const [x2, y2] = proj(arr[0], arr[1]);
    const t = e.count / maxCount;
    const sw = (0.8 + t * 2.8).toFixed(1);
    const op = (0.25 + t * 0.7).toFixed(2);
    const cx = ((x1 + x2) / 2).toFixed(1);
    const cy = ((y1 + y2) / 2 - Math.min(55, Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) * 0.15)).toFixed(1);
    const tip = `${e.dep} → ${e.arr}  ·  ${e.count} flight${e.count !== 1 ? 's' : ''}`;
    parts.push(`<path d="M${x1},${y1} Q${cx},${cy} ${x2},${y2}" fill="none" stroke="#c8102e" stroke-width="${sw}" stroke-opacity="${op}" stroke-linecap="round" data-tip="${tip}" class="rm-interactive"/>`);
  });

  // ── Airport dots + labels ──
  Object.entries(nodes).forEach(([code, coords]) => {
    const [x, y] = proj(coords[0], coords[1]);
    parts.push(`<circle cx="${x}" cy="${y}" r="5" fill="#c8102e" stroke="${dotStroke}" stroke-width="1.5" data-tip="${code}" class="rm-interactive" style="cursor:crosshair"/>`);
    parts.push(`<text x="${x}" y="${y - 9}" text-anchor="middle" font-size="8.5" font-family="monospace" font-weight="700" fill="${textCol}" style="pointer-events:none">${code}</text>`);
  });

  parts.push('</svg>');
  container.innerHTML = parts.join('');

  // ── Tooltip ──
  let tip = document.getElementById('rm-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'rm-tooltip';
    tip.style.cssText = 'position:fixed;background:#0f1117;color:#d6daf0;font-family:monospace;font-size:11px;padding:6px 12px;border:1px solid #c8102e;border-radius:3px;pointer-events:none;display:none;z-index:9999;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.4)';
    document.body.appendChild(tip);
  }
  container.querySelectorAll('.rm-interactive').forEach(el => {
    el.addEventListener('mouseenter', function () { tip.textContent = this.dataset.tip; tip.style.display = 'block'; });
    el.addEventListener('mousemove', function (ev) { tip.style.left = (ev.clientX + 16) + 'px'; tip.style.top = (ev.clientY - 36) + 'px'; });
    el.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
  });
}


// ─── HOST COMPARISON ─────────────────────────────────────────────────────────
let compareSlots = [null, null];
let compareData = [null, null];

async function addToComparison(userId, e) {
  if (e) e.stopPropagation();
  // Fill left first, then right, then cycle
  const slot = compareSlots[0] === null ? 0 : compareSlots[1] === null ? 1 : 0;
  if (compareSlots[slot] === userId) return;
  compareSlots[slot] = userId;

  try {
    const profile = await apiFetch(`/api/hosts/${userId}`);
    compareData[slot] = { profile, member: allHosts.find(h => h.user_id === userId) };
    renderComparison();
    document.getElementById('host-compare-panel').style.display = '';
  } catch (err) {
    logError('loadComparison', err);
    showToast('Failed to load comparison: ' + err.message, true);
  }
}

function clearComparison() {
  compareSlots = [null, null];
  compareData = [null, null];
  document.getElementById('host-compare-panel').style.display = 'none';
}

function renderComparison() {
  ['hc-left', 'hc-right'].forEach((id, i) => {
    const el = document.getElementById(id);
    const dat = compareData[i];
    if (!dat) { el.innerHTML = '<div style="color:var(--dim);font-family:var(--mono);font-size:11px;padding:1rem">Double-click a host to compare</div>'; return; }
    const { profile, member } = dat;
    const s = profile.stats;
    const pct = v => v != null ? v + '%' : '—';
    const fmt = v => v != null ? v : '—';

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:1rem">
        <img src="${member?.avatar || ''}" style="width:36px;height:36px;border-radius:50%" onerror="this.style.display='none'"/>
        <div>
          <div style="font-family:var(--mono);font-size:13px;color:var(--text)">${escapeHtml(member?.username || 'Unknown')}</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--subtext)">${s.total} flights total</div>
        </div>
      </div>
      ${hcRow('Total Flights', s.total, s.total)}
      ${hcRow('Active', s.active, s.active)}
      ${hcRow('Ended', s.ended, s.ended)}
      ${hcRow('On-Time Rate', pct(s.on_time_rate), s.on_time_rate, true)}
      ${hcRow('Cancel Rate', pct(s.cancel_rate), s.cancel_rate, true, true)}
      ${hcRow('Delay Rate', pct(s.delay_rate), s.delay_rate, true, true)}
      ${hcRow('Best Streak', fmt(s.best_streak), s.best_streak)}
      ${hcRow('Avg Passengers', fmt(s.avg_pax), s.avg_pax)}
      ${hcRow('Total Passengers', fmt(s.total_pax), s.total_pax)}
      ${hcRow('Fav Aircraft', fmt(s.fav_aircraft), 0)}
      <div style="font-family:var(--mono);font-size:10px;color:var(--subtext);margin-top:1rem">Top Routes</div>
      ${(s.top_routes || []).slice(0, 3).map(([r, c]) => `<div style="font-family:var(--mono);font-size:10px;color:var(--text);padding:2px 0">${r} <span style="color:var(--dim)">${c}×</span></div>`).join('')}`;
  });

  // Highlight better values
  if (compareData[0] && compareData[1]) {
    const metrics = ['on_time_rate', 'total', 'avg_pax', 'total_pax', 'best_streak'];
    metrics.forEach(m => {
      const v0 = compareData[0].profile.stats[m] ?? -1;
      const v1 = compareData[1].profile.stats[m] ?? -1;
      // visual highlight handled by hcRow with direct color
    });
  }
}

function hcRow(label, display, numVal, higherBetter = true, lowerBetter = false) {
  return `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:10px">
    <span style="color:var(--subtext)">${label}</span>
    <span style="color:var(--text)">${display}</span>
  </div>`;
}

// ─── HEATMAP TOOLTIP ENHANCEMENT ─────────────────────────────────────────────
// Already handled via SVG <title> tooltips in renderHeatmap; no extra JS needed.

// ─── WORLD CLOCK CITY EDITOR ─────────────────────────────────────────────────
const ALL_ZONES = [
  { city: 'UTC', tz: 'UTC' }, { city: 'London', tz: 'Europe/London' }, { city: 'Paris', tz: 'Europe/Paris' },
  { city: 'Berlin', tz: 'Europe/Berlin' }, { city: 'Amsterdam', tz: 'Europe/Amsterdam' },
  { city: 'Madrid', tz: 'Europe/Madrid' }, { city: 'Rome', tz: 'Europe/Rome' },
  { city: 'Moscow', tz: 'Europe/Moscow' }, { city: 'Dubai', tz: 'Asia/Dubai' },
  { city: 'Mumbai', tz: 'Asia/Kolkata' }, { city: 'Dhaka', tz: 'Asia/Dhaka' },
  { city: 'Bangkok', tz: 'Asia/Bangkok' }, { city: 'Singapore', tz: 'Asia/Singapore' },
  { city: 'Hong Kong', tz: 'Asia/Hong_Kong' }, { city: 'Tokyo', tz: 'Asia/Tokyo' },
  { city: 'Seoul', tz: 'Asia/Seoul' }, { city: 'Sydney', tz: 'Australia/Sydney' },
  { city: 'Auckland', tz: 'Pacific/Auckland' }, { city: 'Honolulu', tz: 'Pacific/Honolulu' },
  { city: 'Anchorage', tz: 'America/Anchorage' }, { city: 'Los Angeles', tz: 'America/Los_Angeles' },
  { city: 'Denver', tz: 'America/Denver' }, { city: 'Chicago', tz: 'America/Chicago' },
  { city: 'New York', tz: 'America/New_York' }, { city: 'Toronto', tz: 'America/Toronto' },
  { city: 'Halifax', tz: 'America/Halifax' }, { city: 'São Paulo', tz: 'America/Sao_Paulo' },
  { city: 'Buenos Aires', tz: 'America/Argentina/Buenos_Aires' },
  { city: 'Lima', tz: 'America/Lima' }, { city: 'Bogotá', tz: 'America/Bogota' },
  { city: 'Mexico City', tz: 'America/Mexico_City' }, { city: 'Lagos', tz: 'Africa/Lagos' },
  { city: 'Nairobi', tz: 'Africa/Nairobi' }, { city: 'Cairo', tz: 'Africa/Cairo' },
  { city: 'Casablanca', tz: 'Africa/Casablanca' },
];

let activeZones = [...WORLD_ZONES]; // start with defaults

function openZoneEditor() {
  const modal = document.getElementById('zone-editor-modal');
  if (modal) { modal.style.display = 'flex'; renderZoneEditor(); return; }
  // Create modal if not exists
  const m = document.createElement('div');
  m.id = 'zone-editor-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';
  m.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);width:420px;max-height:80vh;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border)">
        <span style="font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--subtext)">EDIT WORLD CLOCKS</span>
        <button onclick="document.getElementById('zone-editor-modal').style.display='none'" style="margin-left:auto;background:none;border:none;color:var(--subtext);cursor:pointer;font-size:16px">✕</button>
      </div>
      <div style="padding:12px 18px;border-bottom:1px solid var(--border)">
        <input id="zone-search" type="text" placeholder="Search city..." oninput="renderZoneEditor()" style="width:100%;font-family:var(--mono);font-size:11px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 10px;outline:none;box-sizing:border-box" />
      </div>
      <div id="zone-editor-list" style="overflow-y:auto;flex:1;padding:8px 0"></div>
      <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
        <button onclick="resetZones()" class="btn-ghost" style="font-family:var(--mono);font-size:10px;padding:5px 14px">Reset</button>
        <button onclick="applyZones()" class="btn-primary" style="font-family:var(--mono);font-size:10px;padding:5px 14px">Apply</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  renderZoneEditor();
}

function renderZoneEditor() {
  const q = (document.getElementById('zone-search')?.value || '').toLowerCase();
  const list = document.getElementById('zone-editor-list');
  if (!list) return;
  const filtered = ALL_ZONES.filter(z => !q || z.city.toLowerCase().includes(q) || z.tz.toLowerCase().includes(q));
  list.innerHTML = filtered.map(z => {
    const active = activeZones.some(a => a.tz === z.tz);
    return `<div onclick="toggleZone('${z.tz}','${escapeHtml(z.city)}')" style="display:flex;align-items:center;gap:10px;padding:8px 18px;cursor:pointer;border-bottom:1px solid var(--border)${active ? ';background:rgba(200,16,46,.07)' : ''}">
      <span style="width:14px;height:14px;border:1px solid var(--border);background:${active ? 'var(--accent)' : 'none'};display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:10px">${active ? '✓' : ''}</span>
      <span style="font-family:var(--mono);font-size:11px;color:var(--text)">${escapeHtml(z.city)}</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--subtext);margin-left:auto">${z.tz}</span>
    </div>`;
  }).join('');
}

function toggleZone(tz, city) {
  const idx = activeZones.findIndex(z => z.tz === tz);
  if (idx >= 0) activeZones.splice(idx, 1);
  else activeZones.push({ city, tz });
  renderZoneEditor();
}

function resetZones() {
  activeZones = [...WORLD_ZONES];
  renderZoneEditor();
}

function applyZones() {
  // Rebuild WORLD_ZONES equivalent
  WORLD_ZONES.length = 0;
  activeZones.forEach(z => WORLD_ZONES.push(z));
  document.getElementById('zone-editor-modal').style.display = 'none';
  calcUpdateWorld(calcCurrentUtcDate);
}

// ─── DTS LIVE PREVIEW ─────────────────────────────────────────────────────────
const DTS_PREVIEW_FORMATS = {
  t: d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  T: d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  d: d => d.toLocaleDateString([], { month: '2-digit', day: '2-digit', year: 'numeric' }),
  D: d => d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }),
  f: d => d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  F: d => d.toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  R: d => {
    const diff = d - Date.now(); const abs = Math.abs(diff) / 1000; const fut = diff > 0;
    if (abs < 60) return fut ? 'in a few seconds' : 'a few seconds ago';
    if (abs < 3600) return `${fut ? 'in ' : ''}${Math.round(abs / 60)} minutes${fut ? '' : ' ago'}`;
    if (abs < 86400) return `${fut ? 'in ' : ''}${Math.round(abs / 3600)} hours${fut ? '' : ' ago'}`;
    return `${fut ? 'in ' : ''}${Math.round(abs / 86400)} days${fut ? '' : ' ago'}`;
  },
};

// ─── SESSION MANAGEMENT ──────────────────────────────────────────────────────
async function revokeSession(userId, username) {
  if (!confirm(`Force-logout ${username}? They will be immediately signed out and blocked from logging in again until you unblock them.`)) return;
  try {
    await apiFetch('/auth/sessions/revoke', 'POST', { user_id: userId, username });
    showToast(`✓ ${username} has been force-logged out`);
    loadDiagnostics(); // refresh
  } catch (e) {
    logError('dashboard-extras.js', e);
    showToast(`❌ ${e.message}`, true);
  }
}

async function unblockSession(userId, username) {
  try {
    await apiFetch('/auth/sessions/unblock', 'POST', { user_id: userId });
    showToast(`✓ ${username} has been unblocked`);
    loadDiagnostics();
  } catch (e) {
    logError('dashboard-extras.js', e);
    showToast(`❌ ${e.message}`, true);
  }
}

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────────
// Ctrl+S  — Save open drawer / add flight modal
// Ctrl+N  — New flight (open add modal)
// Ctrl+F  — Focus flight search
// Ctrl+1-6 — Switch tabs
// Escape  — Close any open drawer / modal

const SHORTCUT_TABS = ['flights', 'calendar', 'analytics', 'hosts', 'logs', 'calc'];

document.addEventListener('keydown', function (e) {
  const tag = document.activeElement?.tagName?.toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';

  // Escape — always works
  if (e.key === 'Escape') {
    // Close drawer if open
    if (document.getElementById('drawer')?.classList.contains('open')) {
      closeDrawer(); return;
    }
    // Close add-flight modal if open
    if (document.getElementById('add-modal')?.classList.contains('open')) {
      closeAddFlight(); return;
    }
    return;
  }

  // Ctrl/Cmd combos
  if (e.ctrlKey || e.metaKey) {
    switch (e.key) {

      case 's':
      case 'S':
        e.preventDefault();
        // Save drawer changes if drawer open
        if (document.getElementById('drawer')?.classList.contains('open')) {
          const saveBtn = document.getElementById('save-btn');
          if (saveBtn && !saveBtn.disabled) { saveChanges(); }
        }
        // Submit add-flight modal if open
        else if (document.getElementById('add-modal')?.classList.contains('open')) {
          submitAddFlight();
        }
        break;

      case 'n':
      case 'N':
        if (!typing) {
          e.preventDefault();
          // Only if on flights page and has permission
          if (typeof openAddFlight === 'function') openAddFlight();
        }
        break;

      case 'f':
      case 'F':
        e.preventDefault();
        const searchEl = document.getElementById('flight-search') || document.getElementById('hosts-search');
        if (searchEl) { searchEl.focus(); searchEl.select(); }
        break;

      case '1': case '2': case '3': case '4': case '5': case '6':
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        const tabName = SHORTCUT_TABS[idx];
        const tabEl = tabName ? document.getElementById(`tab-${tabName}`) : null;
        if (tabEl && tabEl.style.display !== 'none') switchPage(tabName);
        break;
    }
    return;
  }

  // Non-modifier shortcuts (only when not typing)
  if (!typing) {
    // nothing extra for now — reserved for future
  }
});

// Show shortcut hints in tooltips on tab buttons
document.addEventListener('DOMContentLoaded', () => {
  SHORTCUT_TABS.forEach((tab, i) => {
    const el = document.getElementById(`tab-${tab}`);
    if (el) el.title = `Ctrl+${i + 1}`;
  });
});
// ─── EXPORT FLIGHTS ───────────────────────────────────────────────────────────
function exportFlightsCSV() {
  const all = [...allFlights, ...endedFlights];
  if (!all.length) { showToast('No flights to export', true); return; }
  const headers = ['Code', 'Flight', 'Route', 'Dep City', 'Arr City', 'Date', 'Dep Time', 'Arr Time', 'Aircraft', 'Status', 'Final Status', 'Passengers Joined', 'Passengers Remained', 'Retention', 'Notes'];
  const rows = all.map(f => {
    const ret = (f.pax_joined > 0 && f.pax_remained != null)
      ? Math.round(f.pax_remained / f.pax_joined * 100) + '%' : '';
    return [
      f.code, f.flight_number, `${f.dep_code}→${f.arr_code}`,
      f.dep_city, f.arr_city, f.dep_date, f.dep_time, f.arr_time,
      f.aircraft, f.status, f.final_status || '',
      f.pax_joined ?? '', f.pax_remained ?? '', ret, f.pax_notes || ''
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aic-flights-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`✅ Exported ${all.length} flights to CSV`);
}

function exportFlightsJSON() {
  const all = [...allFlights, ...endedFlights];
  if (!all.length) { showToast('No flights to export', true); return; }
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aic-flights-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`✅ Exported ${all.length} flights to JSON`);
}

// ─── BLACKOUT DATES ───────────────────────────────────────────────────────────
let _blackoutDates = [];

async function loadBlackoutDates() {
  const list = document.getElementById('blackout-list');
  const err = document.getElementById('blackout-error');
  if (err) err.style.display = 'none';
  if (list) list.innerHTML = '<div style="color:var(--dim);font-family:var(--mono);font-size:11px">Loading…</div>';
  try {
    _blackoutDates = await apiFetch('/api/blackout');
    // Sync calendar view (loadCalBlackoutDates lives in dashboard-calendar.js)
    if (typeof _calSyncBlackouts === 'function') _calSyncBlackouts(_blackoutDates);
    if (list) renderBlackoutList();
  } catch (e) {
    if (list) list.innerHTML = `<div style="color:var(--red);font-family:var(--mono);font-size:11px">⚠ ${e.message}</div>`;
  }
}

function renderBlackoutList() {
  const list = document.getElementById('blackout-list');
  if (!list) return;
  if (!_blackoutDates.length) {
    list.innerHTML = '<div style="color:var(--dim);font-family:var(--mono);font-size:11px;padding:8px 0">No blackout dates set</div>';
    return;
  }
  list.innerHTML = _blackoutDates.map(d => {
    const label = new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const isPast = new Date(d + 'T12:00:00Z') < new Date();
    return `<div style="display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-family:var(--mono);font-size:12px;color:${isPast ? 'var(--dim)' : 'var(--text)'};flex:1">${label}${isPast ? ' <span style="color:var(--dim);font-size:10px">(past)</span>' : ''}</span>
      <button onclick="removeBlackout('${d}')" style="font-family:var(--mono);font-size:10px;padding:3px 8px;background:none;border:1px solid var(--red);color:var(--red);cursor:pointer">Remove</button>
    </div>`;
  }).join('');
}

async function addBlackoutDate() {
  const inp = document.getElementById('blackout-input');
  const err = document.getElementById('blackout-error');
  if (!inp || !inp.value) { if (err) { err.textContent = '⚠ Select a date'; err.style.display = ''; } return; }
  if (err) err.style.display = 'none';
  try {
    const res = await apiFetch('/api/blackout', 'POST', { date: inp.value });
    _blackoutDates = res.blackout;
    if (typeof _calSyncBlackouts === 'function') _calSyncBlackouts(_blackoutDates);
    renderBlackoutList();
    inp.value = '';
    showToast(`🚫 Blackout set for ${inp.value || res.blackout.slice(-1)[0]}`);
  } catch (e) {
    if (err) { err.textContent = '⚠ ' + e.message; err.style.display = ''; }
  }
}

async function removeBlackout(date) {
  try {
    const res = await apiFetch(`/api/blackout/${date}`, 'DELETE');
    _blackoutDates = res.blackout;
    if (typeof _calSyncBlackouts === 'function') _calSyncBlackouts(_blackoutDates);
    renderBlackoutList();
    showToast(`✅ Blackout removed for ${date}`);
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// ─── BOT PRESENCE ─────────────────────────────────────────────────────────────
async function loadBotPresence() {
  const typeEl = document.getElementById('presence-type');
  const textEl = document.getElementById('presence-text');
  const enEl = document.getElementById('presence-enabled');
  if (!typeEl) return;
  try {
    const p = await apiFetch('/api/presence');
    typeEl.value = p.type || 'watching';
    textEl.value = p.text || '';
    enEl.checked = p.enabled !== false;
    setPresenceMode('static');
  } catch (e) {
    // silently ignore — non-critical
  }
}

async function saveBotPresence() {
  const typeEl = document.getElementById('presence-type');
  const textEl = document.getElementById('presence-text');
  const enEl = document.getElementById('presence-enabled');
  const errEl = document.getElementById('presence-error');
  if (errEl) errEl.style.display = 'none';
  if (!textEl.value.trim()) {
    if (errEl) { errEl.textContent = '⚠ Status text cannot be empty'; errEl.style.display = ''; }
    return;
  }
  try {
    await apiFetch('/api/presence', 'POST', {
      type: typeEl.value,
      text: textEl.value.trim(),
      enabled: enEl.checked,
    });
    showToast(`✅ Bot status updated: ${typeEl.value} ${textEl.value.trim()}`);
  } catch (e) {
    if (errEl) { errEl.textContent = '⚠ ' + e.message; errEl.style.display = ''; }
    else showToast('Error: ' + e.message, true);
  }
}

// ─── PRESENCE LIVE PREVIEW ────────────────────────────────────────────────────
(function () {
  window.updatePresencePreview = function updatePresencePreview() {
    const typeEl = document.getElementById('presence-type');
    const textEl = document.getElementById('presence-text');
    const enEl = document.getElementById('presence-enabled');
    const prev = document.getElementById('presence-preview');
    if (!prev || !typeEl || !textEl) return;
    if (!enEl.checked) { prev.textContent = '(no status)'; prev.style.color = 'var(--dim)'; return; }
    const labels = { playing: 'Playing', watching: 'Watching', listening: 'Listening to', competing: 'Competing in' };
    const text = textEl.value.trim() || '…';
    prev.textContent = `${labels[typeEl.value] || typeEl.value} ${text}`;
    prev.style.color = 'var(--subtext)';
  }
  // Attach listeners once DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    ['presence-type', 'presence-text', 'presence-enabled'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updatePresencePreview);
      if (el) el.addEventListener('change', updatePresencePreview);
    });
  });
})();

// ─── FEATURE FLAGS ────────────────────────────────────────────────────────────
const FEATURE_LABELS = {
  auto_reminder_flights: 'Departure reminders',
  auto_end_flights: 'Auto-end flights on arrival',
  post_daily_schedule: 'Daily schedule post',
  post_weekly_monthly_report: 'Weekly / monthly report',
  cleanup_old_day_messages: 'Auto-cleanup stale board messages',
  flight_scheduling: 'Flight scheduling rules',
};

const FEATURE_CONFIG_SCHEMA = {
  auto_reminder_flights: [
    { key: 'minutes_before', label: 'Minutes before departure', type: 'number', min: 5, max: 480 },
  ],
  flight_scheduling: [
    { key: 'max_scheduled_flights', label: 'Max active flights per host (0 = unlimited)', type: 'number', min: 0, max: 20 },
    { key: 'advance_hours', label: 'Min hours in advance to schedule (0 = off)', type: 'number', min: 0, max: 168 },
  ],
  post_daily_schedule: [
    { key: 'utc_hour', label: 'Post at UTC hour (0–23)', type: 'number', min: 0, max: 23 },
  ],
  post_weekly_monthly_report: [
    { key: 'utc_hour', label: 'Post at UTC hour (0–23)', type: 'number', min: 0, max: 23 },
    { key: 'weekly_day', label: 'Weekly report day (0=Mon … 6=Sun)', type: 'number', min: 0, max: 6 },
  ],
};

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let _featureFlags = {};
let _featureConfig = {};

async function loadFeatureFlags() {
  const body = document.getElementById('feature-flags-body');
  if (!body) return;
  try {
    const [fr, cr] = await Promise.all([apiFetch('/api/features'), apiFetch('/api/feature-config')]);
    _featureFlags = fr.flags || {};
    _featureConfig = cr.config || {};
    renderFeatureFlags();
  } catch (e) {
    body.innerHTML = `<div style="color:var(--red);font-family:var(--mono);font-size:11px">⚠ ${escapeHtml(e.message)}</div>`;
  }
}

function renderFeatureFlags() {
  const body = document.getElementById('feature-flags-body');
  if (!body) return;
  body.innerHTML = Object.entries(_featureFlags).map(([key, val]) => {
    const label = FEATURE_LABELS[key] || key.replace(/_/g, ' ');
    const schema = FEATURE_CONFIG_SCHEMA[key] || [];
    const cfg = _featureConfig[key] || {};

    const configInputs = schema.map(s => {
      const curVal = cfg[s.key] ?? '';
      let display = curVal;
      if (s.key === 'weekly_day') display = WEEKDAY_NAMES[curVal] ? `${curVal} — ${WEEKDAY_NAMES[curVal]}` : curVal;
      return `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;padding-left:52px">
        <span style="font-family:var(--mono);font-size:10px;color:var(--subtext);min-width:220px">${s.label}</span>
        <input type="number" min="${s.min}" max="${s.max}" value="${curVal}"
          id="ffc-${key}-${s.key}"
          oninput="_featureConfig['${key}'] = _featureConfig['${key}'] || {}; _featureConfig['${key}']['${s.key}'] = +this.value; ${s.key === 'weekly_day' ? `document.getElementById('ffc-day-label-${key}').textContent = WEEKDAY_NAMES[this.value] || ''` : ''}"
          style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:4px 8px;width:60px;outline:none" />
        ${s.key === 'weekly_day' ? `<span id="ffc-day-label-${key}" style="font-family:var(--mono);font-size:10px;color:var(--subtext)">${WEEKDAY_NAMES[curVal] || ''}</span>` : ''}
        ${s.key === 'minutes_before' ? `<span style="font-family:var(--mono);font-size:10px;color:var(--dim)">min before departure</span>` : ''}
        ${s.key === 'utc_hour' ? `<span style="font-family:var(--mono);font-size:10px;color:var(--dim)">:00 UTC</span>` : ''}
      </div>`;
    }).join('');

    return `<div style="padding:10px 14px;background:var(--surface);border:1px solid var(--border);margin-bottom:2px">
      <div style="display:flex;align-items:center;gap:14px">
        <label style="position:relative;display:inline-block;width:36px;height:20px;flex-shrink:0;cursor:pointer">
          <input type="checkbox" id="ff-${key}" ${val ? 'checked' : ''}
            onchange="_featureFlags['${key}']=this.checked;_updateFlagRow('${key}')"
            style="opacity:0;width:0;height:0;position:absolute" />
          <span style="position:absolute;cursor:pointer;inset:0;border-radius:20px;transition:.2s;
            background:${val ? 'var(--green)' : 'var(--border)'};" id="ff-track-${key}">
            <span style="position:absolute;height:14px;width:14px;left:${val ? '19px' : '3px'};bottom:3px;border-radius:50%;
              background:#fff;transition:.2s" id="ff-thumb-${key}"></span>
          </span>
        </label>
        <span style="font-family:var(--mono);font-size:11px;color:var(--text);flex:1">${label}</span>
        <span id="ff-status-${key}" style="font-family:var(--mono);font-size:10px;color:${val ? 'var(--green)' : 'var(--dim)'}">
          ${val ? 'ENABLED' : 'PAUSED'}
        </span>
      </div>
      ${configInputs}
    </div>`;
  }).join('');
}

function _updateFlagRow(key) {
  const val = _featureFlags[key];
  const track = document.getElementById(`ff-track-${key}`);
  const thumb = document.getElementById(`ff-thumb-${key}`);
  const status = document.getElementById(`ff-status-${key}`);
  if (track) track.style.background = val ? 'var(--green)' : 'var(--border)';
  if (thumb) thumb.style.left = val ? '19px' : '3px';
  if (status) { status.textContent = val ? 'ENABLED' : 'PAUSED'; status.style.color = val ? 'var(--green)' : 'var(--dim)'; }
}

async function saveFeatureFlags() {
  try {
    await Promise.all([
      apiFetch('/api/features', 'POST', { flags: _featureFlags }),
      apiFetch('/api/feature-config', 'POST', { config: _featureConfig }),
    ]);
    const saved = document.getElementById('feature-flags-saved');
    if (saved) { saved.style.display = 'inline'; setTimeout(() => saved.style.display = 'none', 2500); }
    showToast('✅ Feature flags & config updated');
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// ─── UPDATE BANNER ────────────────────────────────────────────────────────────
const BANNER_COLORS = {
  info: { bg: 'rgba(68,138,255,.12)', border: 'rgba(68,138,255,.4)', text: '#c8d8ff', icon: 'ℹ' },
  warn: { bg: 'rgba(255,215,64,.1)', border: 'rgba(255,215,64,.4)', text: '#ffe89a', icon: '⚠' },
  ok: { bg: 'rgba(0,230,118,.1)', border: 'rgba(0,230,118,.35)', text: '#a0ffd0', icon: '✓' },
};

async function checkBanner() {
  if (_bannerDismissed) return;
  try {
    const res = await apiFetch('/api/banner');
    const b = res.banner;
    const el = document.getElementById('update-banner');
    if (!el) return;
    if (!b || !b.message) { el.style.display = 'none'; return; }
    const c = BANNER_COLORS[b.type] || BANNER_COLORS.info;
    el.style.cssText = `display:flex;position:sticky;top:0;z-index:9999;padding:10px 20px;align-items:center;gap:12px;font-family:var(--mono);font-size:12px;background:${c.bg};border-bottom:1px solid ${c.border};color:${c.text}`;
    document.getElementById('update-banner-icon').textContent = c.icon;
    document.getElementById('update-banner-msg').textContent = b.message;
    document.getElementById('update-banner-by').textContent = `— ${b.published_by}, ${new Date(b.published_at + 'Z').toLocaleTimeString()}`;
  } catch (e) { /* non-critical, silent */ }
}

function dismissBanner() {
  _bannerDismissed = true;
  const el = document.getElementById('update-banner');
  if (el) el.style.display = 'none';
}

// Poll for banner every 60s
setInterval(checkBanner, 60000);

async function publishBanner() {
  const msg = document.getElementById('banner-message')?.value?.trim();
  const type = document.getElementById('banner-type')?.value || 'info';
  if (!msg) { showToast('⚠ Enter a message first', true); return; }
  try {
    const res = await apiFetch('/api/banner', 'POST', { message: msg, type });
    showToast('📢 Banner published to all users');
    _bannerDismissed = false;
    renderBannerCurrent(res.banner);
    checkBanner();
  } catch (e) { showToast('Error: ' + e.message, true); }
}

async function clearBanner() {
  try {
    await apiFetch('/api/banner', 'DELETE');
    showToast('✅ Banner cleared');
    renderBannerCurrent(null);
    const el = document.getElementById('update-banner');
    if (el) el.style.display = 'none';
  } catch (e) { showToast('Error: ' + e.message, true); }
}

function renderBannerCurrent(b) {
  const el = document.getElementById('banner-current');
  if (!el) return;
  if (!b) {
    el.style.display = 'none';
    el.textContent = 'No active banner';
    return;
  }
  const c = BANNER_COLORS[b.type] || BANNER_COLORS.info;
  el.style.cssText = `display:block;padding:10px 14px;border:1px solid ${c.border};background:${c.bg};font-family:var(--mono);font-size:11px;color:${c.text}`;
  el.innerHTML = `<strong>${c.icon} ACTIVE:</strong> ${escapeHtml(b.message)}<br><span style="opacity:.6;font-size:10px">Published by ${escapeHtml(b.published_by)} at ${new Date(b.published_at + 'Z').toLocaleString()}</span>`;
}

async function loadBannerPublisher() {
  try {
    const res = await apiFetch('/api/banner');
    renderBannerCurrent(res.banner);
    if (res.banner?.message) {
      const msgEl = document.getElementById('banner-message');
      const typeEl = document.getElementById('banner-type');
      if (msgEl) msgEl.value = res.banner.message;
      if (typeEl) typeEl.value = res.banner.type;
    }
  } catch (e) { /* silent */ }
}

// ─── TAB MANAGER ─────────────────────────────────────────────────────────────
const TAB_MANAGER_TABS = [
  { page: 'flights', label: 'Flights', alwaysVisible: true },
  { page: 'crew-requests', label: 'Crew Requests', alwaysVisible: false },
  { page: 'calendar', label: 'Calendar', alwaysVisible: false },
  { page: 'my-analytics', label: 'My Analytics', alwaysVisible: false },
  { page: 'availability', label: 'Availability', alwaysVisible: false },
  { page: 'calc', label: 'UTC Calculator', alwaysVisible: false },
];

let _tabOverrides = {};

async function loadTabManager() {
  const body = document.getElementById('tab-manager-body');
  if (!body) return;
  try {
    const res = await apiFetch('/api/tabs');
    _tabOverrides = res.overrides || {};
    renderTabManager();
  } catch (e) {
    body.innerHTML = `<div style="color:var(--red);font-family:var(--mono);font-size:11px">⚠ ${escapeHtml(e.message)}</div>`;
  }
}

function renderTabManager() {
  const body = document.getElementById('tab-manager-body');
  if (!body) return;
  body.innerHTML = TAB_MANAGER_TABS.map(t => {
    const isVisible = _tabOverrides[t.page] !== false;
    const disabled = t.alwaysVisible;
    return `<div style="display:flex;align-items:center;gap:14px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);margin-bottom:2px;opacity:${disabled ? '.45' : '1'}">
      <label style="position:relative;display:inline-block;width:36px;height:20px;flex-shrink:0;cursor:${disabled ? 'not-allowed' : 'pointer'}">
        <input type="checkbox" id="tm-${t.page}" ${isVisible ? 'checked' : ''} ${disabled ? 'disabled' : ''}
          onchange="_tabOverrides['${t.page}']=this.checked;_updateTabRow('${t.page}')"
          style="opacity:0;width:0;height:0;position:absolute" />
        <span style="position:absolute;cursor:${disabled ? 'not-allowed' : 'pointer'};inset:0;border-radius:20px;transition:.2s;
          background:${isVisible ? 'var(--green)' : 'var(--border)'};" id="tm-track-${t.page}">
          <span style="position:absolute;height:14px;width:14px;left:${isVisible ? '19px' : '3px'};bottom:3px;border-radius:50%;
            background:#fff;transition:.2s" id="tm-thumb-${t.page}"></span>
        </span>
      </label>
      <span style="font-family:var(--mono);font-size:11px;color:var(--text);flex:1">${t.label}</span>
      <span id="tm-status-${t.page}" style="font-family:var(--mono);font-size:10px;color:${isVisible ? 'var(--green)' : 'var(--red)'}">
        ${disabled ? 'ALWAYS ON' : isVisible ? 'VISIBLE' : 'HIDDEN'}
      </span>
    </div>`;
  }).join('');
}

function _updateTabRow(page) {
  const val = _tabOverrides[page] !== false;
  const track = document.getElementById(`tm-track-${page}`);
  const thumb = document.getElementById(`tm-thumb-${page}`);
  const status = document.getElementById(`tm-status-${page}`);
  if (track) track.style.background = val ? 'var(--green)' : 'var(--border)';
  if (thumb) thumb.style.left = val ? '19px' : '3px';
  if (status) { status.textContent = val ? 'VISIBLE' : 'HIDDEN'; status.style.color = val ? 'var(--green)' : 'var(--red)'; }
}

async function saveTabManager() {
  try {
    await apiFetch('/api/tabs', 'POST', { overrides: _tabOverrides });
    const saved = document.getElementById('tab-manager-saved');
    if (saved) { saved.style.display = 'inline'; setTimeout(() => saved.style.display = 'none', 2500); }
    showToast('✅ Tab visibility updated — reload to see changes');
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// Called on init — hides tabs disabled server-side (skipped for owner)
async function applyTabOverrides() {
  try {
    const res = await apiFetch('/api/tabs');
    const overrides = res.overrides || {};
    Object.entries(overrides).forEach(([page, visible]) => {
      if (!visible) {
        const tab = document.getElementById(`tab-${page}`);
        if (tab) tab.dataset.serverDisabled = 'true'; // mark so showTab doesn't re-show it
      }
    });
  } catch (e) { /* non-critical */ }
}
// ─── BOT UPTIME CLOCK ─────────────────────────────────────────────────────────
let _botStartTs = null; // Unix seconds, set from /api/debug

function startUptimeClock() {
  // Fetch bot start time once, then tick every second
  apiFetch('/api/debug').then(data => {
    if (data && data.system && data.system.process_start) {
      _botStartTs = Date.parse(data.system.process_start) / 1000;
    }
  }).catch(() => { });
  setInterval(_tickUptime, 1000);
  _tickUptime();
}

function _tickUptime() {
  const pill = document.getElementById('bot-uptime-pill');
  if (!pill) return;
  if (!_botStartTs) { pill.textContent = 'BOT ···'; return; }
  const elapsed = Math.floor(Date.now() / 1000 - _botStartTs);
  const d = Math.floor(elapsed / 86400);
  const h = Math.floor((elapsed % 86400) / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  pill.textContent = d > 0
    ? `BOT UP ${d}d ${h}h ${m}m`
    : `BOT UP ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  pill.style.color = elapsed < 300 ? 'var(--yellow)' : 'var(--green)';
}

// ─── MOTD (auto-generated daily greeting) ─────────────────────────────────────
const _MOTD_LINES = [
  "Run a tight ship. You're the one holding it all together.",
  "Every great operation starts with one person who gives a damn.",
  "Today is a good day to fly.",
  "Check your logs. Stay sharp. Lead well.",
  "The tower never sleeps — neither does a good owner.",
  "Clear skies are earned, not given.",
  "Your crew is counting on you. You've got this.",
  "Discipline on the ground. Excellence in the air.",
  "One flight at a time. One decision at a time.",
  "The best captains never stop learning.",
];

async function loadMotd() {
  const greeting = document.getElementById('motd-greeting');
  const body = document.getElementById('motd-body');
  const dateEl = document.getElementById('motd-date');
  const uptimeEl = document.getElementById('motd-uptime');
  if (!greeting) return;

  // Date + greeting
  const now = new Date();
  const h = now.getUTCHours();
  const tod = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  dateEl.textContent = `${days[now.getUTCDay()]} · ${months[now.getUTCMonth()]} ${now.getUTCDate()}, ${now.getUTCFullYear()} UTC`;

  // Deterministic daily quote (changes each day, same all day)
  const daySeed = now.getUTCFullYear() * 1000 + now.getUTCMonth() * 31 + now.getUTCDate();
  const quote = _MOTD_LINES[daySeed % _MOTD_LINES.length];

  // Fetch live stats for summary line
  try {
    const [stats, dbg] = await Promise.all([
      apiFetch('/api/stats').catch(() => null),
      apiFetch('/api/debug').catch(() => null),
    ]);

    const active = stats ? (stats.total || 0) : '?';
    const ended = stats ? (stats.ended || 0) : '?';
    const online = dbg ? (dbg.online_members || '?') : '?';
    const latency = dbg && dbg.bot && dbg.bot.latency_ms != null ? `${dbg.bot.latency_ms}ms` : '?';

    // Uptime from process_start
    if (dbg && dbg.system && dbg.system.process_start) {
      _botStartTs = Date.parse(dbg.system.process_start) / 1000;
      const el = Math.floor(Date.now() / 1000 - _botStartTs);
      const ud = Math.floor(el / 86400), uh = Math.floor((el % 86400) / 3600), um = Math.floor((el % 3600) / 60);
      uptimeEl.textContent = ud > 0 ? `Bot up ${ud}d ${uh}h ${um}m` : `Bot up ${uh}h ${um}m`;
      uptimeEl.style.color = 'var(--green)';
    }

    body.innerHTML =
      `${active} active flight${active === 1 ? '' : 's'} &nbsp;·&nbsp; ` +
      `${ended} completed &nbsp;·&nbsp; ` +
      `${online} online in server &nbsp;·&nbsp; ` +
      `Ping ${latency}<br>` +
      `<span style="color:var(--dim);font-size:10px;font-style:italic;margin-top:2px;display:block">"${quote}"</span>`;
  } catch (e) {
    body.textContent = quote;
  }

  greeting.textContent = tod;
}

// ─── DISCORD ACTIVITY FEED ────────────────────────────────────────────────────
async function loadActivityFeed() {
  const container = document.getElementById('activity-feed');
  if (!container) return;
  container.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--dim);padding:1rem;text-align:center">Loading...</div>';
  try {
    const entries = await apiFetch('/api/logs?limit=14');
    if (!entries.length) {
      container.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--dim);padding:1rem;text-align:center">No recent audit activity</div>';
      return;
    }
    container.innerHTML = entries.map(item => {
      const ts = item.date && item.time ? `${item.date} ${item.time} UTC` : 'Unknown time';
      const levelColor = item.level === 'error' ? 'var(--red)' : item.level === 'warn' ? 'var(--yellow)' : item.level === 'ok' ? 'var(--green)' : 'var(--dim)';
      const preview = escapeHtml((item.action || '').slice(0, 180));
      return `<div style="background:var(--surface);border:1px solid var(--border);padding:8px 10px;display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-family:var(--mono);font-size:9px;letter-spacing:.08em;color:${levelColor};text-transform:uppercase">${escapeHtml((item.level || 'info').toUpperCase())}</span>
          <span style="font-family:var(--mono);font-size:9px;color:var(--dim)">${ts}</span>
        </div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--subtext);line-height:1.5">${preview}${(item.action || '').length > 180 ? '...' : ''}</div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--dim)">${escapeHtml(item.user || 'system')}</div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div style="font-family:var(--mono);font-size:11px;color:var(--red);padding:1rem;text-align:center">Error: ${escapeHtml(e.message || 'Failed to load')}</div>`;
  }
}

// Auto-refresh activity feed every 30s when on home page
setInterval(() => {
  if (document.getElementById('page-home') && document.getElementById('page-home').style.display !== 'none') {
    loadActivityFeed();
  }
}, 30000);

// ─── SEND MESSAGE AS BOT ──────────────────────────────────────────────────────
async function sendBotMessage() {
  const channel = document.getElementById('bot-send-channel').value;
  const msg = (document.getElementById('bot-send-msg').value || '').trim();
  const status = document.getElementById('bot-send-status');
  if (!msg) { _botSendStatus('⚠ Message is empty', 'var(--yellow)'); return; }
  _botSendStatus('Sending…', 'var(--subtext)');
  try {
    await apiFetch('/api/bot-send', 'POST', { channel, message: msg });
    document.getElementById('bot-send-msg').value = '';
    _botSendStatus('✅ Sent!', 'var(--green)');
    setTimeout(() => { if (status) status.style.display = 'none'; }, 3000);
    loadActivityFeed(); // refresh feed to show the sent message
  } catch (e) {
    _botSendStatus('❌ ' + (e.message || 'Failed'), 'var(--red)');
  }
}
function _botSendStatus(text, color) {
  const el = document.getElementById('bot-send-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
  el.style.display = 'inline';
}

// ─── USER MANAGER ─────────────────────────────────────────────────────────────
// ─── USER MANAGER ─────────────────────────────────────────────────────────────

let _gmCache = [];   // guild members cache
let _gmFilter = '';  // search filter

async function loadUserManager() {
  const body = document.getElementById('user-manager-body');
  if (!body) return;
  body.innerHTML = '<div class="dbg-loading">Loading…</div>';
  try {
    const [sessData, suspData, gmData] = await Promise.all([
      apiFetch('/auth/sessions'),
      apiFetch('/api/suspensions'),
      apiFetch('/api/guild-members'),
    ]);
    // guild-members returns {members:[...]}
    _gmCache = (gmData && Array.isArray(gmData.members)) ? gmData.members
      : Array.isArray(gmData) ? gmData : [];
    // Merge suspension info into cache from suspData
    // Backend returns {suspensions: {uid: {...}}}
    const _suspMap = (suspData && suspData.suspensions) ? suspData.suspensions : (suspData || {});
    _gmCache.forEach(m => {
      if (_suspMap[m.user_id]) {
        m.is_suspended = true;
        m.susp_reason = _suspMap[m.user_id].reason || '';
        m.susp_by = _suspMap[m.user_id].suspended_by || '?';
      }
    });
    _renderUserManager(body, sessData, suspData);
  } catch (e) {
    body.innerHTML = `
      <div style="font-family:var(--mono);font-size:12px;color:var(--red);padding:2rem;line-height:1.8">
        <div style="font-size:13px;margin-bottom:.5rem">⚠ Failed to load User Manager</div>
        <div style="color:var(--subtext);font-size:11px">${escapeHtml(e.message)}</div>
        <div style="margin-top:1rem;font-size:10px;color:var(--dim)">
          Try: <a href="/api/guild-members" target="_blank" style="color:var(--accent)">/api/guild-members</a> ·
          <a href="/api/suspensions" target="_blank" style="color:var(--accent)">/api/suspensions</a> ·
          <a href="/auth/sessions" target="_blank" style="color:var(--accent)">/auth/sessions</a>
        </div>
      </div>`;
  }
}

function _renderUserManager(body, sessData, suspData) {
  const sessions = sessData.sessions || [];
  const blocked = sessData.blocked || [];
  // Backend returns {suspensions: {uid: {...}}}
  const susp = (suspData && suspData.suspensions) ? suspData.suspensions : (suspData || {});

  let html = `<div style="display:flex;flex-direction:column;gap:2rem;max-width:1100px">`;

  // ── Active Sessions ────────────────────────────────────────────────────────
  html += `<div>
    <div class="section-header" style="margin-bottom:1rem">
      <span class="section-label">Active Sessions</span><div class="section-line"></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px">`;

  if (!sessions.length) {
    html += `<div style="font-family:var(--mono);font-size:11px;color:var(--dim);padding:.5rem">No active sessions</div>`;
  } else {
    for (const s of sessions) {
      const avatarUrl = s.avatar || `https://cdn.discordapp.com/embed/avatars/0.png`;
      const isCurrent = s.is_current;
      const idleLabel = s.idle_minutes < 1 ? 'active now'
        : s.idle_minutes < 60 ? `idle ${s.idle_minutes}m`
          : `idle ${Math.round(s.idle_minutes / 60)}h`;
      const roleColor = s.role === 'owner' ? 'var(--accent)' : s.role === 'manager' ? '#f0b232' : s.role === 'bod' ? '#b47aff' : 'var(--subtext)';
      const isSusp = s.user_id in susp;
      html += `
        <div style="background:var(--card);border:1px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'};padding:10px 12px;display:flex;align-items:center;gap:10px;position:relative">
          ${isCurrent ? `<div style="position:absolute;top:4px;right:6px;font-family:var(--mono);font-size:8px;color:var(--accent);letter-spacing:.05em">YOU</div>` : ''}
          <img src="${avatarUrl}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"
               style="width:36px;height:36px;border-radius:50%;flex-shrink:0;border:2px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'}">
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--mono);font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${escapeHtml(s.username || s.user_id)}
              ${isSusp ? `<span style="color:var(--red);font-size:9px;margin-left:4px">SUSPENDED</span>` : ''}
            </div>
            <div style="font-family:var(--mono);font-size:9px;margin-top:2px;display:flex;gap:6px;flex-wrap:wrap">
              <span style="color:${roleColor}">${s.role || 'hoster'}</span>
              <span style="color:var(--dim)">${idleLabel}</span>
              <span style="color:var(--dim)">session ${s.session_age_h}h</span>
            </div>
          </div>
          ${!isCurrent ? `
          <div style="display:flex;flex-direction:column;gap:4px">
            <button class="action-btn" style="color:var(--accent);border-color:var(--accent);font-size:9px"
                    onclick="impersonateUser('${s.user_id}','${escapeHtml(s.username || s.user_id)}')">👤 Act As</button>
            <button class="action-btn" style="color:var(--red);border-color:var(--red);font-size:9px"
                    onclick="userRevoke('${s.user_id}','${escapeHtml(s.username || s.user_id)}')">Revoke</button>
            <button class="action-btn" style="font-size:9px"
                    onclick="userBlock('${s.user_id}','${escapeHtml(s.username || s.user_id)}')">Block</button>
          </div>` : ''}
        </div>`;
    }
  }
  html += `</div></div>`;

  // ── Blocklist ──────────────────────────────────────────────────────────────
  html += `<div>
    <div class="section-header" style="margin-bottom:1rem">
      <span class="section-label">Dashboard Blocklist</span><div class="section-line"></div>
    </div>`;
  if (!blocked.length) {
    html += `<div style="font-family:var(--mono);font-size:11px;color:var(--dim);padding:.5rem">Blocklist is empty</div>`;
  } else {
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px">`;
    for (const b of blocked) {
      const bid = b.id || b;
      // Try to find avatar from guild cache
      const gm = _gmCache.find(m => m.user_id === bid);
      const avatarUrl = gm?.avatar || `https://cdn.discordapp.com/embed/avatars/0.png`;
      const uname = gm?.username || bid;
      html += `
        <div style="background:var(--card);border:1px solid var(--border);border-left:2px solid var(--red);padding:10px 12px;display:flex;align-items:center;gap:10px">
          <img src="${avatarUrl}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"
               style="width:30px;height:30px;border-radius:50%;flex-shrink:0;opacity:.7">
          <div style="flex:1;font-family:var(--mono);font-size:11px;color:var(--subtext)">${escapeHtml(uname)}</div>
          <button class="action-btn" style="color:var(--green);border-color:var(--green);font-size:9px"
                  onclick="userUnblock('${bid}')">Unblock</button>
        </div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;

  // ── Host Suspensions ───────────────────────────────────────────────────────
  const suspEntries = Object.entries(susp);
  html += `<div>
    <div class="section-header" style="margin-bottom:1rem">
      <span class="section-label">Flight Suspensions</span><div class="section-line"></div>
    </div>
    <p style="font-family:var(--mono);font-size:10px;color:var(--dim);margin-bottom:12px">Suspended hosts can still log in but cannot create new flights.</p>`;
  if (!suspEntries.length) {
    html += `<div style="font-family:var(--mono);font-size:11px;color:var(--dim);padding:.5rem">No suspended hosts</div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:6px;max-width:700px">`;
    for (const [uid, info] of suspEntries) {
      const gm = _gmCache.find(m => m.user_id === uid);
      const avatarUrl = info.avatar || gm?.avatar || `https://cdn.discordapp.com/embed/avatars/0.png`;
      const uname = info.username || gm?.username || uid;
      const when = info.suspended_at ? new Date(info.suspended_at).toLocaleDateString() : '?';
      html += `
        <div style="background:var(--card);border:1px solid var(--border);border-left:2px solid #f0b232;padding:10px 14px;display:flex;align-items:center;gap:12px">
          <img src="${avatarUrl}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"
               style="width:32px;height:32px;border-radius:50%;flex-shrink:0">
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--mono);font-size:12px;color:var(--text)">${escapeHtml(uname)}</div>
            <div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-top:2px">
              ${escapeHtml(info.reason || 'No reason')} · by ${escapeHtml(info.suspended_by || '?')} · ${when}
            </div>
          </div>
          <button class="action-btn" style="color:var(--green);border-color:var(--green);font-size:9px"
                  onclick="userUnsuspend('${uid}')">Lift</button>
        </div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;

  // ── Role Manager ───────────────────────────────────────────────────────────
  html += `<div>
    <div class="section-header" style="margin-bottom:1rem">
      <span class="section-label">Role Manager</span><div class="section-line"></div>
    </div>
    <p style="font-family:var(--mono);font-size:10px;color:var(--dim);margin-bottom:12px">Grant or revoke the Hoster role. Managers/BOD roles must be changed in Discord directly.</p>
    <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
      <input type="text" id="gm-search" placeholder="Search members…" oninput="_gmFilterRender()"
             style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 10px;width:220px;outline:none">
      <label style="font-family:var(--mono);font-size:10px;color:var(--subtext);display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="gm-hosters-only" onchange="_gmFilterRender()" checked> Hosters only
      </label>
    </div>
    <div id="gm-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:6px;max-height:500px;overflow-y:auto;padding-right:4px"></div>
  </div>`;

  html += `</div>`;
  body.innerHTML = html;
  _gmFilterRender();
}

function _gmFilterRender() {
  const q = (document.getElementById('gm-search')?.value || '').toLowerCase();
  const hostersOnly = document.getElementById('gm-hosters-only')?.checked;
  const list = document.getElementById('gm-list');
  if (!list) return;
  const susp = {};
  // Re-read suspensions from rendered page isn't ideal — use cached
  let filtered = _gmCache.filter(m => {
    if (hostersOnly && !m.is_hoster) return false;
    if (q && !m.username.toLowerCase().includes(q)) return false;
    return true;
  });
  if (!filtered.length) {
    list.innerHTML = `<div style="font-family:var(--mono);font-size:11px;color:var(--dim);padding:.5rem">No members found</div>`;
    return;
  }
  // Sort: hosters first, then alpha
  filtered.sort((a, b) => (b.is_hoster - a.is_hoster) || a.username.localeCompare(b.username));
  list.innerHTML = filtered.map(m => {
    const badges = [
      m.is_owner ? `<span style="background:var(--accent);color:#fff;font-size:7px;padding:1px 5px">OWNER</span>` : '',
      m.is_bod ? `<span style="background:#b47aff;color:#fff;font-size:7px;padding:1px 5px">BOD</span>` : '',
      m.is_manager ? `<span style="background:#f0b232;color:#000;font-size:7px;padding:1px 5px">MGR</span>` : '',
      m.is_hoster ? `<span style="background:var(--green);color:#000;font-size:7px;padding:1px 5px">HOSTER</span>` : '',
      m.is_suspended ? `<span style="background:var(--red);color:#fff;font-size:7px;padding:1px 5px">SUSP</span>` : '',
    ].filter(Boolean).join('');
    return `
      <div style="background:var(--card);border:1px solid var(--border);padding:8px 10px;display:flex;align-items:center;gap:8px">
        <img src="${m.avatar}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"
             style="width:30px;height:30px;border-radius:50%;flex-shrink:0">
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--mono);font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(m.username)}</div>
          <div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:3px">${badges || '<span style="font-family:var(--mono);font-size:8px;color:var(--dim)">no roles</span>'}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0">
          ${m.is_hoster
        ? `<button class="action-btn" style="color:var(--red);border-color:var(--red);font-size:8px;padding:3px 7px"
                       onclick="gmSetRole('${m.user_id}','${escapeHtml(m.username)}','revoke')">- Hoster</button>`
        : `<button class="action-btn" style="color:var(--green);border-color:var(--green);font-size:8px;padding:3px 7px"
                       onclick="gmSetRole('${m.user_id}','${escapeHtml(m.username)}','grant')">+ Hoster</button>`
      }
          ${m.is_suspended
        ? `<button class="action-btn" style="color:var(--green);border-color:var(--green);font-size:8px;padding:3px 7px"
                       onclick="userUnsuspend('${m.user_id}')">Lift</button>`
        : `<button class="action-btn" style="color:#f0b232;border-color:#f0b232;font-size:8px;padding:3px 7px"
                       onclick="gmSuspendPrompt('${m.user_id}','${escapeHtml(m.username)}','${m.avatar}')">Suspend</button>`
      }
        </div>
      </div>`;
  }).join('');
}

async function gmSetRole(userId, username, action) {
  const verb = action === 'grant' ? 'Grant Hoster role to' : 'Revoke Hoster role from';
  if (!confirm(`${verb} ${username}?`)) return;
  try {
    await apiFetch(`/api/guild-members/${userId}/role`, 'POST', { action });
    showToast(action === 'grant' ? `✅ Hoster granted to ${username}` : `🚫 Hoster revoked from ${username}`);
    // Update cache
    const m = _gmCache.find(m => m.user_id === userId);
    if (m) m.is_hoster = action === 'grant';
    _gmFilterRender();
  } catch (e) { showToast('Error: ' + e.message, true); }
}

function gmSuspendPrompt(userId, username, avatar) {
  const reason = prompt(`Suspend ${username} from creating flights.

Reason (optional):`);
  if (reason === null) return;
  apiFetch(`/api/suspensions/${userId}`, 'POST', { reason, username, avatar })
    .then(() => {
      showToast(`⚠ ${username} suspended from flights`);
      const m = _gmCache.find(m => m.user_id === userId);
      if (m) m.is_suspended = true;
      _gmFilterRender();
      loadUserManager(); // refresh full panel for suspension list
    })
    .catch(e => showToast('⚠ ' + e.message, true));
}

async function userUnsuspend(userId) {
  try {
    await apiFetch(`/api/suspensions/${userId}`, 'DELETE');
    showToast('✅ Suspension lifted');
    const m = _gmCache.find(m => m.user_id === userId);
    if (m) m.is_suspended = false;
    loadUserManager();
  } catch (e) { showToast('Error: ' + e.message, true); }
}

async function userRevoke(userId, name) {
  if (!confirm(`Revoke session for ${name}?`)) return;
  try {
    await apiFetch('/auth/sessions/revoke', 'POST', { user_id: userId });
    showToast(`✅ Session revoked for ${name}`);
    loadUserManager();
  } catch (e) { showToast('Error: ' + e.message, true); }
}
async function userBlock(id, name) {
  if (!confirm(`Block ${name} from logging in?`)) return;
  try {
    await apiFetch('/auth/sessions/revoke', 'POST', { user_id: id });
    showToast(`🚫 ${name} blocked`);
    loadUserManager();
  } catch (e) { showToast('Error: ' + e.message, true); }
}
async function userUnblock(id) {
  try {
    await apiFetch('/auth/sessions/unblock', 'POST', { user_id: id });
    showToast(`✅ Unblocked`);
    loadUserManager();
  } catch (e) { showToast('Error: ' + e.message, true); }
}


// ─── IMPERSONATION ────────────────────────────────────────────────────────────
async function impersonateUser(userId, username) {
  if (!confirm(`Act as ${username}?\n\nYou will see the dashboard as this user. All actions will be performed under their account.\n\nA red banner will remind you. Click "Stop Impersonating" to return.`)) return;
  try {
    const res = await apiFetch(`/auth/impersonate/${userId}`, 'POST', {});
    showToast(`👤 Now acting as ${res.username}`);
    setTimeout(() => window.location.href = '/dashboard', 800);
  } catch (e) { showToast('Error: ' + e.message, true); }
}

async function stopImpersonation() {
  try {
    await apiFetch('/auth/impersonate-stop', 'POST', {});
    window.location.href = '/dashboard/owner';
  } catch (e) {
    window.location.href = '/dashboard/owner';
  }
}

// Show impersonation banner if currently acting as another user
(async function checkImpersonation() {
  try {
    const me = await apiFetch('/auth/me');
    if (me.impersonated_by) {
      const banner = document.getElementById('impersonate-banner');
      const nameEl = document.getElementById('impersonate-name');
      if (banner) banner.style.display = 'flex';
      if (nameEl) nameEl.textContent = me.username || me.user_id;
    }
  } catch (e) { }
})();

// ─── BOT PRESENCE / STATUS ────────────────────────────────────────────────────
async function setOnlineStatus(status) {
  try {
    await apiFetch('/api/presence/status', 'POST', { status });
    showToast(`✅ Status set to ${status}`);
  } catch (e) { showToast('Error: ' + e.message, true); }
}

// ─── PRESENCE MODE + ROTATION ─────────────────────────────────────────────────
let _rotationSlots = [];
let _presenceMode = 'static';

const PTYPE_LABELS = { playing: '🎮 Playing', watching: '📺 Watching', listening: '🎵 Listening to', competing: '🏆 Competing in' };

function setPresenceMode(mode) {
  _presenceMode = mode;
  const sp = document.getElementById('presence-static-panel');
  const rp = document.getElementById('presence-rotation-panel');
  const bs = document.getElementById('pmode-static');
  const br = document.getElementById('pmode-rotation');
  if (sp) sp.style.display = mode === 'static' ? '' : 'none';
  if (rp) rp.style.display = mode === 'rotation' ? '' : 'none';
  if (bs) { bs.style.background = mode === 'static' ? 'var(--accent)' : 'transparent'; bs.style.color = mode === 'static' ? '#fff' : 'var(--subtext)'; }
  if (br) { br.style.background = mode === 'rotation' ? 'var(--accent)' : 'transparent'; br.style.color = mode === 'rotation' ? '#fff' : 'var(--subtext)'; }
}

async function loadRotation() {
  try {
    const data = await apiFetch('/api/presence/rotation');
    _rotationSlots = (data.slots || []);
    const interval = data.interval_minutes || 5;
    const inp = document.getElementById('rotation-interval');
    if (inp) inp.value = interval;
    if (data.enabled) setPresenceMode('rotation');
    renderRotationSlots();
  } catch (e) { }
}

function toggleRotationEnabled() { /* state driven by pill toggle now */ }

function renderRotationSlots() {
  const container = document.getElementById('rotation-slots');
  if (!container) return;
  container.innerHTML = _rotationSlots.map((s, i) => {
    const m = String(s).match(/^(\w+):(.*)$/);
    const selType = m ? m[1] : 'watching';
    const selText = m ? m[2] : s;
    const opts = ['playing', 'watching', 'listening', 'competing'].map(v =>
      `<option value="${v}"${v === selType ? ' selected' : ''}>${PTYPE_LABELS[v]}</option>`
    ).join('');
    return `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
      <select onchange="_rotSlotType(${i},this.value)"
        style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:5px 6px;outline:none;flex-shrink:0">
        ${opts}
      </select>
      <input value="${escapeHtml(selText)}" oninput="_rotSlotText(${i},this.value)" placeholder="status text"
        style="flex:1;font-family:var(--mono);font-size:12px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 8px;outline:none" />
      <button onclick="removeRotationSlot(${i})" style="background:none;border:1px solid var(--red);color:var(--red);padding:4px 8px;cursor:pointer;font-size:11px">✕</button>
    </div>`;
  }).join('');
}

function _rotSlotType(i, type) {
  const m = String(_rotationSlots[i]).match(/^\w+:(.*)$/);
  const text = m ? m[1] : _rotationSlots[i];
  _rotationSlots[i] = type + ':' + text;
}
function _rotSlotText(i, text) {
  const m = String(_rotationSlots[i]).match(/^(\w+):/);
  const type = m ? m[1] : 'watching';
  _rotationSlots[i] = type + ':' + text;
}

function addRotationSlot() {
  if (_rotationSlots.length >= 5) { showToast('Max 5 slots', true); return; }
  _rotationSlots.push('watching:');
  renderRotationSlots();
}
function removeRotationSlot(i) {
  _rotationSlots.splice(i, 1);
  renderRotationSlots();
}
async function saveRotation() {
  const interval = parseInt(document.getElementById('rotation-interval')?.value) || 5;
  const enabled = _presenceMode === 'rotation';
  try {
    const filledSlots = _rotationSlots.filter(s => String(s).replace(/^\w+:/, '').trim());
    await apiFetch('/api/presence/rotation', 'POST', { slots: filledSlots, interval_minutes: interval, enabled });
    const el = document.getElementById('rotation-saved');
    if (el) { el.style.display = 'inline'; setTimeout(() => el.style.display = 'none', 2000); }
    showToast('✅ Rotation saved');
  } catch (e) { showToast('Error: ' + e.message, true); }
}
// ─── UNIFIED TEMPLATES EDITOR ─────────────────────────────────────────────────

// ── Announce templates (flight announce modal) ─────────────────────────────
const AT_DEFAULTS = [
  { name: 'Departure Time Correction', category: 'Schedule Update', text: '## Schedule Update\n:AIC_Clock: Dear passengers, the departure time for flight {flight_number} is displayed incorrectly. The correct time is HH:MM UTC.\nWe apologize for any inconvenience caused.' },
  { name: 'Departure Date Correction', category: 'Schedule Update', text: '## Schedule Update\n:AIC_Calendar: Dear passengers, the departure date for flight {flight_number} is displayed incorrectly on the flight information board. The correct date is DDth Month YYYY.\nWe apologize for any inconvenience caused.' },
  { name: 'Flight Cancellation', category: 'Service Update', text: '## Service Update\n:AIC_Status: Dear passengers, flight {flight_number} operating service to {arr_city}, has been cancelled due to REASON. We sincerely apologize for the inconvenience. This cancellation is the result of unforeseen circumstances beyond our control.\nWe appreciate your understanding and look forward to welcoming you on a future flight.' },
  { name: 'Flight Delay', category: 'Service Update', text: '## Service Update\n:AIC_Warning: Dear passengers, flight {flight_number} operating service to {arr_city}, has been delayed. The updated departure time is HH:MM UTC\nWe apologize for any inconvenience caused.' },
  { name: 'Flight Rescheduled', category: 'Service Update', text: '## Service Update\n:AIC_Calendar: Dear passengers, flight {flight_number} operating service to {arr_city}, has been rescheduled. The new operating date and time are DDth Month YYYY.\nWe apologize for any inconvenience caused.' },
  { name: 'Duplicate Notification Apology', category: 'Notification Notice', text: '## Notification Notice\n:AIC_User: Dear passengers, We apologize for the duplicate notification you may have received. Some members of our staff are currently undergoing training.\nWe regret the inconvenience and are taking measures to ensure this does not occur again.' },
];

// ── Bot message templates (auto-posted by the bot) ─────────────────────────
const BT_DEFAULTS = [
  { key: 'msg_reminder', label: 'Flight Opens Reminder', hint: '{flight_number}  {timestamp}  {interest_role}  {event_link}', text: '# {flight_number} OPENS IN {timestamp}\n<@&{interest_role}>\n\nPlease select "interested" if attending!\n\nEvent link: {event_link}' },
  { key: 'msg_checkin', label: 'Check-in Opened', hint: '{flight_number}  {arr_city}  {interest_role}  {spawn_location}  {server_link}', text: '# {flight_number} to {arr_city} has begun check-in.\n<@&{interest_role}>\n\nPlease head to check-in at **{spawn_location}**\n\n> <:AIC_Link:1417212068028874865> {server_link}' },
  { key: 'msg_boarding_closed', label: 'Boarding Closed', hint: '{flight_number}  {arr_city}  {interest_role}', text: '# {flight_number} to {arr_city} has closed boarding.\n<@&{interest_role}> \n\n<:AIC_Locked:1409728733589405777> Gate Closed' },
  { key: 'msg_auto_reminder', label: 'Auto Departure Reminder', hint: '{flight_number}  {arr_city}  {interest_role}  {dep_unix}  {event_link}', text: '# {flight_number} to {arr_city} — departing <t:{dep_unix}:R>!\n<@&{interest_role}>\n\nCheck-in opens soon. Make sure you\'re ready.\n> <:AIC_Link:1417212068028874865> {event_link}' },
  { key: 'msg_event_post', label: 'Event Announcement', hint: '{title}  {date}  {type}  {host}  {cohosts}  {time}  {duration}  {description}', text: '# Event: {title}\n<:AIC_Calendar:1419416309174636666> Date: {date}\n<:AIC_Options:1474821341231321311> Event Type: {type}\n<:AIC_2:1419416360353796247> Host: {host}\n<:AIC_Medal:1417214664202518528> Co-Host(s): {cohosts}\n<:AIC_Clock:1419417053109944444> Time: {time}\n<:AIC_Clock:1419417053109944444> Duration: {duration}\n\n<:AIC_Information:1440775211082453002> Event Description:\n{description}' },
];

let _atTemplates = [];
let _btTemplates = [];  // [{key, label, hint, text}]
let _atOpen = -1;
let _btOpen = -1;

async function loadTemplatesPage() {
  try {
    const s = await apiFetch('/api/owner-settings');
    // Announce templates
    _atTemplates = (Array.isArray(s.announce_templates) && s.announce_templates.length)
      ? s.announce_templates
      : JSON.parse(JSON.stringify(AT_DEFAULTS));
    // Bot message templates
    _btTemplates = BT_DEFAULTS.map(d => ({
      ...d,
      text: s[d.key] || d.text,
    }));
  } catch (e) {
    _atTemplates = JSON.parse(JSON.stringify(AT_DEFAULTS));
    _btTemplates = BT_DEFAULTS.map(d => ({ ...d }));
  }
  _atOpen = -1; _btOpen = -1;
  atRender(); btRender();
}

// ── Announce template rendering ────────────────────────────────────────────
function atRender() {
  const list = document.getElementById('at-list');
  if (!list) return;
  list.innerHTML = _atTemplates.map((t, i) => {
    const open = _atOpen === i;
    return `
    <div style="border:1px solid var(--border);overflow:hidden">
      <div onclick="atToggle(${i})" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;background:var(--card);user-select:none;transition:background .15s" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='var(--card)'">
        <span style="font-family:var(--mono);font-size:10px;color:var(--dim);width:16px">${open ? '▾' : '▸'}</span>
        <span style="font-family:var(--mono);font-size:12px;color:var(--text);flex:1">${escHtml(t.name)}</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--subtext)">${escHtml(t.category)}</span>
        <button onclick="event.stopPropagation();atDelete(${i})" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:12px;padding:0 2px" title="Delete">✕</button>
      </div>
      ${open ? `
      <div style="padding:12px 14px;background:var(--surface);display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--border)">
        <div style="display:flex;gap:8px">
          <input value="${escHtml(t.name)}" oninput="_atTemplates[${i}].name=this.value;atRefreshTitle(${i})"
            placeholder="Name" style="flex:1;font-family:var(--mono);font-size:11px;background:var(--card);border:1px solid var(--border);color:var(--text);padding:5px 8px;outline:none">
          <input value="${escHtml(t.category)}" oninput="_atTemplates[${i}].category=this.value"
            placeholder="Category" style="width:160px;font-family:var(--mono);font-size:11px;background:var(--card);border:1px solid var(--border);color:var(--text);padding:5px 8px;outline:none">
        </div>
        <textarea rows="5" oninput="_atTemplates[${i}].text=this.value"
          style="font-family:var(--mono);font-size:12px;background:var(--card);border:1px solid var(--border);color:var(--text);padding:8px 10px;outline:none;resize:vertical;line-height:1.6;width:100%;box-sizing:border-box"
        >${escHtml(t.text)}</textarea>
        <div style="font-family:var(--mono);font-size:10px;color:var(--dim)">Variables: <code>{flight_number}</code> <code>{arr_city}</code></div>
        <div style="display:flex;gap:6px">
          <button onclick="atMove(${i},-1)" style="background:none;border:1px solid var(--border);color:var(--subtext);padding:3px 10px;cursor:pointer;font-size:11px">↑ Move up</button>
          <button onclick="atMove(${i},1)"  style="background:none;border:1px solid var(--border);color:var(--subtext);padding:3px 10px;cursor:pointer;font-size:11px">↓ Move down</button>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');
}

function atRefreshTitle(i) {
  // Update the visible name in the collapsed header without full re-render
  atRender();
}

function atToggle(i) {
  _atOpen = _atOpen === i ? -1 : i;
  atRender();
}

function atMove(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= _atTemplates.length) return;
  [_atTemplates[i], _atTemplates[j]] = [_atTemplates[j], _atTemplates[i]];
  _atOpen = j;
  atRender();
}

function atDelete(i) {
  if (!confirm(`Delete "${_atTemplates[i].name}"?`)) return;
  _atTemplates.splice(i, 1);
  if (_atOpen >= _atTemplates.length) _atOpen = -1;
  atRender();
}

function atAddTemplate() {
  _atTemplates.push({ name: 'New Template', category: 'General', text: '' });
  _atOpen = _atTemplates.length - 1;
  atRender();
  setTimeout(() => document.getElementById('at-list')?.lastElementChild?.scrollIntoView({ behavior: 'smooth' }), 50);
}

// ── Bot message template rendering ────────────────────────────────────────
function btRender() {
  const list = document.getElementById('bt-list');
  if (!list) return;
  list.innerHTML = _btTemplates.map((t, i) => {
    const open = _btOpen === i;
    return `
    <div style="border:1px solid var(--border);overflow:hidden">
      <div onclick="btToggle(${i})" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;background:var(--card);user-select:none;transition:background .15s" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='var(--card)'">
        <span style="font-family:var(--mono);font-size:10px;color:var(--dim);width:16px">${open ? '▾' : '▸'}</span>
        <span style="font-family:var(--mono);font-size:12px;color:var(--text);flex:1">${escHtml(t.label)}</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--subtext)">${escHtml(t.key)}</span>
      </div>
      ${open ? `
      <div style="padding:12px 14px;background:var(--surface);display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--border)">
        <textarea rows="5" oninput="_btTemplates[${i}].text=this.value"
          style="font-family:var(--mono);font-size:12px;background:var(--card);border:1px solid var(--border);color:var(--text);padding:8px 10px;outline:none;resize:vertical;line-height:1.6;width:100%;box-sizing:border-box"
        >${escHtml(t.text)}</textarea>
        <div style="font-family:var(--mono);font-size:10px;color:var(--dim)">Variables: <code>${escHtml(t.hint)}</code></div>
        <button onclick="btReset(${i})" style="align-self:flex-start;background:none;border:1px solid var(--border);color:var(--subtext);padding:3px 10px;cursor:pointer;font-size:11px">↺ Reset this one</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function btToggle(i) {
  _btOpen = _btOpen === i ? -1 : i;
  btRender();
}

function btReset(i) {
  if (!confirm(`Reset "${_btTemplates[i].label}" to its original default?`)) return;
  _btTemplates[i].text = BT_DEFAULTS[i].text;
  btRender();
}

// ── Save / reset all ───────────────────────────────────────────────────────
async function saveAllTemplates() {
  const payload = { announce_templates: _atTemplates };
  _btTemplates.forEach(t => { payload[t.key] = t.text; });
  try {
    const saved = await apiFetch('/api/owner-settings', 'POST', payload);
    _atTemplates = Array.isArray(saved.announce_templates) && saved.announce_templates.length
      ? saved.announce_templates
      : JSON.parse(JSON.stringify(AT_DEFAULTS));
    _btTemplates = BT_DEFAULTS.map(d => ({
      ...d,
      text: saved[d.key] ?? d.text,
    }));
    atRender();
    btRender();
    const el = document.getElementById('tmpl-saved');
    if (el) { el.style.display = 'inline'; setTimeout(() => el.style.display = 'none', 2500); }
    showToast('✅ Templates saved');
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

function resetAllTemplates() {
  if (!confirm('Reset ALL templates (both sections) to their original defaults?')) return;
  _atTemplates = JSON.parse(JSON.stringify(AT_DEFAULTS));
  _btTemplates = BT_DEFAULTS.map(d => ({ ...d }));
  _atOpen = -1; _btOpen = -1;
  atRender(); btRender();
  showToast('↺ Defaults restored — click Save to apply');
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── CHANGELOG ────────────────────────────────────────────────────────────────
async function loadChangelogCurrent() {
  try {
    const data = await apiFetch('/api/changelog');
    if (!data || !data.text) return;
    // Try to split back into title / body
    const lines = data.text.split('\n');
    const titleEl = document.getElementById('changelog-title');
    const bodyEl = document.getElementById('changelog-body');
    if (titleEl) titleEl.value = lines[0] || '';
    if (bodyEl) bodyEl.value = lines.slice(1).join('\n').replace(/^\n/, '');
    const cur = document.getElementById('changelog-current');
    if (cur) { cur.style.display = ''; cur.textContent = 'Active: ' + (lines[0] || data.text.slice(0, 60)); }
  } catch (e) { }
}
async function publishChangelog() {
  const title = (document.getElementById('changelog-title')?.value || '').trim();
  const body = (document.getElementById('changelog-body')?.value || '').trim();
  const version = (document.getElementById('changelog-version')?.value || '').trim();
  if (!body) { showToast('⚠ Changelog content is empty', true); return; }
  const parts = [];
  if (title) parts.push(title + (version ? '  ' + version : ''));
  parts.push(body);
  const text = parts.join('\n');
  try {
    await apiFetch('/api/changelog', 'POST', { text });
    showToast('✅ Changelog published — users will see it on next load');
    const cur = document.getElementById('changelog-current');
    if (cur) { cur.style.display = ''; cur.textContent = 'Active: ' + (title || body.slice(0, 60)); }
  } catch (e) { showToast('Error: ' + e.message, true); }
}
async function clearChangelog() {
  try {
    await apiFetch('/api/changelog', 'DELETE');
    ['changelog-title', 'changelog-body', 'changelog-version'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const cur = document.getElementById('changelog-current');
    if (cur) { cur.style.display = 'none'; }
    showToast('✅ Changelog cleared');
  } catch (e) { showToast('Error: ' + e.message, true); }
}
function previewChangelog() {
  const title = (document.getElementById('changelog-title')?.value || '').trim();
  const body = (document.getElementById('changelog-body')?.value || '').trim();
  const version = (document.getElementById('changelog-version')?.value || '').trim();
  if (!body) { showToast('⚠ Nothing to preview', true); return; }
  _showChangelogModal(body, title, version);
}
function _showChangelogModal(text, title, version) {
  const overlay = document.getElementById('changelog-overlay');
  const modal = document.getElementById('changelog-modal');
  if (!overlay || !modal) return;
  const titleEl = modal.querySelector('#cl-modal-title');
  const verEl = modal.querySelector('#cl-modal-version');
  const bodyEl = modal.querySelector('#cl-modal-body');
  if (titleEl) titleEl.textContent = title || 'Changelog';
  if (verEl) verEl.textContent = version || '';
  if (bodyEl) {
    const lines = text.split('\n').map(l => {
      const t = l.trim();
      if (t.startsWith('+')) return `<div style="color:var(--green);font-family:var(--mono);font-size:13px;padding:2px 0">${escapeHtml(t)}</div>`;
      if (t.startsWith('*')) return `<div style="color:var(--yellow);font-family:var(--mono);font-size:13px;padding:2px 0">${escapeHtml(t)}</div>`;
      if (t.startsWith('-')) return `<div style="color:var(--red);font-family:var(--mono);font-size:13px;padding:2px 0">${escapeHtml(t)}</div>`;
      return `<div style="font-family:var(--mono);font-size:13px;color:var(--text);padding:2px 0">${escapeHtml(t)}</div>`;
    }).join('');
    bodyEl.innerHTML = lines;
  }
  if (overlay) overlay.style.display = '';
  if (modal) modal.style.display = '';
}
function dismissChangelog() {
  const overlay = document.getElementById('changelog-overlay');
  const modal = document.getElementById('changelog-modal');
  if (overlay) overlay.style.display = 'none';
  if (modal) modal.style.display = 'none';
  sessionStorage.setItem('aic_changelog_seen', '1');
}
async function checkChangelog() {
  if (sessionStorage.getItem('aic_changelog_seen')) return;
  try {
    const data = await apiFetch('/api/changelog');
    if (data && data.text) {
      const lines = data.text.split('\n');
      _showChangelogModal(lines.slice(1).join('\n') || data.text, lines[0], '');
    }
  } catch (e) { }
}

async function loadChannels() {
  const sel = document.getElementById('bot-send-channel');
  if (!sel) return;
  try {
    const data = await apiFetch('/api/channels');
    _guildChannels = data.channels || [];
    if (!_guildChannels.length) {
      sel.innerHTML = '<option value="">No channels found</option>';
      return;
    }
    // Group by category
    const cats = {};
    _guildChannels.forEach(c => {
      if (!cats[c.category]) cats[c.category] = [];
      cats[c.category].push(c);
    });
    let html = '';
    Object.entries(cats).forEach(([cat, chs]) => {
      html += `<optgroup label="${escapeHtml(cat)}">`;
      chs.forEach(c => {
        html += `<option value="${c.id}">#${escapeHtml(c.name)}</option>`;
      });
      html += '</optgroup>';
    });
    sel.innerHTML = html;

    // Restore saved default channel if set
    const settings = await apiFetch('/api/owner-settings').catch(() => ({}));
    if (settings.bot_send_default_channel) {
      sel.value = settings.bot_send_default_channel;
    }
  } catch (e) {
    if (sel) sel.innerHTML = '<option value="">Failed to load — check bot</option>';
  }
}

// ─── INACTIVE HOST RADAR ──────────────────────────────────────────────────────
async function loadInactiveHosts() {
  const body = document.getElementById('inactive-radar-body');
  const label = document.getElementById('radar-threshold-label');
  if (!body) return;
  body.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--dim);padding:1rem;text-align:center;grid-column:1/-1">Loading…</div>';
  try {
    const data = await apiFetch('/api/inactive-hosts');
    const list = data.inactive || [];
    if (label) label.textContent = `— flagging hosts inactive ≥${data.threshold_days} days`;

    if (!list.length) {
      body.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--green);padding:1rem;text-align:center;grid-column:1/-1">✅ All hosts have flown recently</div>';
      return;
    }

    // Fetch nudge log to show "last nudged"
    const settings = await apiFetch('/api/owner-settings').catch(() => ({}));
    const nudgeLog = {};
    try {
      const nl = await apiFetch('/api/nudge-log').catch(() => ({ log: {} }));
      Object.assign(nudgeLog, nl.log || {});
    } catch (e) { }

    body.innerHTML = list.map(h => {
      const days = h.days_inactive >= 9999 ? 'Never flown' : `${h.days_inactive}d inactive`;
      const daysCol = h.days_inactive >= 30 ? 'var(--red)' : h.days_inactive >= 14 ? 'var(--yellow)' : 'var(--subtext)';
      const lastFlt = h.last_flight_date
        ? `Last: ${h.last_flight_num || '?'} (${h.last_route || '?'}) · ${h.last_flight_date}`
        : 'No flights on record';
      const nudgedAt = nudgeLog[h.user_id]
        ? `Nudged ${new Date(nudgeLog[h.user_id]).toLocaleDateString()}`
        : '';
      return `
        <div style="background:var(--surface);border:1px solid var(--border);padding:10px 12px;display:flex;align-items:center;gap:10px">
          <img src="${h.avatar}" style="width:34px;height:34px;border-radius:50%;flex-shrink:0;object-fit:cover"
               onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--mono);font-size:12px;color:var(--text);display:flex;align-items:center;gap:8px">
              ${escapeHtml(h.username)}
              <span style="font-family:var(--mono);font-size:9px;color:${daysCol};padding:2px 6px;border:1px solid ${daysCol}">${days}</span>
            </div>
            <div style="font-family:var(--mono);font-size:10px;color:var(--dim);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(lastFlt)}</div>
            ${nudgedAt ? `<div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-top:2px">📨 ${nudgedAt}</div>` : ''}
          </div>
          <button class="action-btn" onclick="openNudgeModal('${h.user_id}','${escapeHtml(h.username)}')"
                  style="font-size:10px;flex-shrink:0;white-space:nowrap">📨 Nudge</button>
        </div>`;
    }).join('');
  } catch (e) {
    body.innerHTML = `<div style="font-family:var(--mono);font-size:11px;color:var(--red);padding:1rem;grid-column:1/-1">⚠ ${escapeHtml(e.message)}</div>`;
  }
}

// Nudge modal — shows editable message before sending
let _nudgeTarget = null;

function openNudgeModal(userId, username) {
  _nudgeTarget = { userId, username };
  // Use a simple prompt-style overlay injected into body if it doesn't exist
  let overlay = document.getElementById('nudge-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'nudge-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99997;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);width:min(520px,92vw);padding:1.5rem;display:flex;flex-direction:column;gap:14px">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:.15em;color:var(--subtext);text-transform:uppercase">Send Nudge DM</div>
        <div id="nudge-target-line" style="font-family:var(--mono);font-size:12px;color:var(--text)"></div>
        <div>
          <label style="font-family:var(--mono);font-size:10px;color:var(--subtext);display:block;margin-bottom:5px">MESSAGE</label>
          <textarea id="nudge-msg-text" rows="7"
            style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:8px 10px;width:100%;outline:none;box-sizing:border-box;resize:vertical;line-height:1.6"></textarea>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;align-items:center">
          <span id="nudge-send-status" style="font-family:var(--mono);font-size:11px;display:none"></span>
          <button class="btn-ghost" onclick="closeNudgeModal()" style="font-size:12px;padding:7px 16px">Cancel</button>
          <button class="btn-primary" onclick="submitNudge()" style="font-size:12px;padding:7px 20px">📨 Send DM</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }

  overlay.style.display = 'flex';
  document.getElementById('nudge-target-line').textContent = `To: ${username} (${userId})`;

  // Load default message from settings
  apiFetch('/api/owner-settings').then(s => {
    const ta = document.getElementById('nudge-msg-text');
    if (ta) ta.value = (s.nudge_message || '').replace('{username}', username);
  }).catch(() => { });
}

function closeNudgeModal() {
  const overlay = document.getElementById('nudge-overlay');
  if (overlay) overlay.style.display = 'none';
  _nudgeTarget = null;
}

async function submitNudge() {
  if (!_nudgeTarget) return;
  const msg = document.getElementById('nudge-msg-text')?.value?.trim();
  const status = document.getElementById('nudge-send-status');
  if (!msg) { _nudgeStatus('⚠ Message is empty', 'var(--yellow)'); return; }
  _nudgeStatus('Sending…', 'var(--subtext)');
  try {
    await apiFetch(`/api/nudge/${_nudgeTarget.userId}`, 'POST', {
      message: msg,
      username: _nudgeTarget.username,
    });
    _nudgeStatus('✅ Sent!', 'var(--green)');
    setTimeout(() => { closeNudgeModal(); loadInactiveHosts(); }, 1500);
  } catch (e) {
    _nudgeStatus('❌ ' + (e.message || 'Failed — DMs may be disabled'), 'var(--red)');
  }
}

function _nudgeStatus(text, color) {
  const el = document.getElementById('nudge-send-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
  el.style.display = 'inline';
}

// ─── OWNER SETTINGS ───────────────────────────────────────────────────────────
async function loadOwnerSettings() {
  try {
    const s = await apiFetch('/api/owner-settings');
    const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
    set('os-nudge-threshold', s.nudge_threshold_days);
    set('os-nudge-message', s.nudge_message);
    set('os-nudge-footer', s.nudge_dm_footer);
    set('os-notepad', s.owner_notepad);
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

async function saveOwnerSettings() {
  const g = id => { const el = document.getElementById(id); return el ? el.value : null; };
  const payload = {
    nudge_threshold_days: parseInt(g('os-nudge-threshold')) || 14,
    nudge_message: g('os-nudge-message'),
    nudge_dm_footer: g('os-nudge-footer'),
    owner_notepad: g('os-notepad'),
  };

  // Also save current bot-send channel as default
  const chanSel = document.getElementById('bot-send-channel');
  if (chanSel && chanSel.value) payload.bot_send_default_channel = chanSel.value;

  try {
    await apiFetch('/api/owner-settings', 'POST', payload);
    const saved = document.getElementById('os-saved');
    if (saved) { saved.style.display = 'inline'; setTimeout(() => saved.style.display = 'none', 2500); }
    showToast('✅ Settings saved');
    // Refresh radar with new threshold
    if (document.getElementById('page-home')?.style.display !== 'none') {
      loadInactiveHosts();
    }
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// ─── FLIGHT CONTROL ───────────────────────────────────────────────────────────

let _fctlData = null;
let _fctlCode = null;

async function fctlLoad() {
  const inp = document.getElementById('fctl-code-input');
  const err = document.getElementById('fctl-lookup-err');
  const editor = document.getElementById('fctl-editor');
  const code = (inp?.value || '').trim().toUpperCase();
  if (!code) return;
  err.style.display = 'none';
  editor.style.display = 'none';
  editor.innerHTML = '<div class="dbg-loading">Loading…</div>';
  editor.style.display = '';
  try {
    const f = await apiFetch(`/api/flights/${code}`);
    _fctlData = f;
    _fctlCode = code;
    _fctlRender(editor, f, code);
  } catch (e) {
    editor.style.display = 'none';
    err.textContent = e.message.includes('404') ? `No flight found for code "${code}"` : '⚠ ' + e.message;
    err.style.display = '';
  }
}

function _fctlRender(container, f, code) {
  const statusOpts = ['On\u2013Time', 'Delayed', 'Cancelled', 'Rescheduled', 'N/A', 'Ended'];
  const isEnded = f.status === 'Ended';

  const field = (label, id, val, type = 'text', extra = '') =>
    `<div>
      <label style="font-family:var(--mono);font-size:9px;color:var(--subtext);letter-spacing:.08em;display:block;margin-bottom:4px">${label}</label>
      <input type="${type}" id="fctl-${id}" value="${escapeHtml(String(val ?? ''))}" ${extra}
             style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 8px;width:100%;outline:none;box-sizing:border-box">
    </div>`;

  const select = (label, id, val, opts) =>
    `<div>
      <label style="font-family:var(--mono);font-size:9px;color:var(--subtext);letter-spacing:.08em;display:block;margin-bottom:4px">${label}</label>
      <select id="fctl-${id}" style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 8px;width:100%;outline:none">
        ${opts.map(o => `<option value="${escapeHtml(o)}" ${o === val ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
      </select>
    </div>`;

  const textarea = (label, id, val) =>
    `<div>
      <label style="font-family:var(--mono);font-size:9px;color:var(--subtext);letter-spacing:.08em;display:block;margin-bottom:4px">${label}</label>
      <textarea id="fctl-${id}" rows="2"
             style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 8px;width:100%;outline:none;box-sizing:border-box;resize:vertical">${escapeHtml(String(val ?? ''))}</textarea>
    </div>`;

  const g2 = (...fields) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${fields.join('')}</div>`;
  const g3 = (...fields) => `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">${fields.join('')}</div>`;

  const statusColor = { 'On\u2013Time': 'var(--green)', 'Delayed': '#f0b232', 'Cancelled': 'var(--red)', 'Rescheduled': '#b47aff', 'Ended': 'var(--dim)', 'N/A': 'var(--subtext)' };

  container.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);padding:1.25rem;display:flex;flex-direction:column;gap:1.25rem">

      <!-- Header -->
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="font-family:var(--mono);font-size:18px;color:var(--text);font-weight:600">${escapeHtml(f.flight_number || code)}</div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--subtext)">${escapeHtml(f.dep_city || '?')} → ${escapeHtml(f.arr_city || '?')}</div>
        <div style="font-family:var(--mono);font-size:11px;padding:2px 8px;border:1px solid ${statusColor[f.status] || 'var(--border)'};color:${statusColor[f.status] || 'var(--subtext)'}">${escapeHtml(f.status || 'N/A')}</div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-left:auto">CODE: ${escapeHtml(code)}</div>
      </div>

      <!-- Core fields -->
      <div>
        <div style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--dim);margin-bottom:8px;text-transform:uppercase">Flight Details</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${g2(field('FLIGHT NUMBER', 'flight_number', f.flight_number), select('STATUS', 'status', f.status, statusOpts))}
          ${g2(field('DEP CITY', 'dep_city', f.dep_city), field('ARR CITY', 'arr_city', f.arr_city))}
          ${g3(field('DEP CODE', 'dep_code', f.dep_code), field('ARR CODE', 'arr_code', f.arr_code), field('AIRCRAFT', 'aircraft', f.aircraft))}
          ${g2(field('DEP AIRPORT', 'dep_airport', f.dep_airport), field('ARR AIRPORT', 'arr_airport', f.arr_airport))}
          ${g3(field('DEP TIME (UTC)', 'dep_time', f.dep_time), field('ARR TIME (UTC)', 'arr_time', f.arr_time), field('DURATION', 'duration', f.duration))}
          ${g2(field('TERMINAL', 'terminal', f.terminal), field('MEAL SERVICE', 'meal_service', f.meal_service))}
          ${g2(field('DEP GATE', 'gate_dep', f.gate_dep), field('ARR GATE', 'gate_arr', f.gate_arr))}
        </div>
      </div>

      <!-- Links & alerts -->
      <div>
        <div style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--dim);margin-bottom:8px;text-transform:uppercase">Links & Alerts</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${field('SERVER LINK', 'server_link', f.server_link)}
          ${field('EVENT LINK', 'event_link', f.event_link)}
          ${textarea('ALERTS', 'alerts', f.alerts)}
        </div>
      </div>

      <!-- PAX -->
      <div>
        <div style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--dim);margin-bottom:8px;text-transform:uppercase">Passenger Data</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${g3(field('CAPACITY', 'pax', f.pax, 'number'), field('JOINED', 'pax_joined', f.pax_joined, 'number'), field('REMAINED', 'pax_remained', f.pax_remained, 'number'))}
          ${textarea('PAX NOTES', 'pax_notes', f.pax_notes)}
        </div>
      </div>

      <!-- Codeshare -->
      <div>
        <div style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--dim);margin-bottom:8px;text-transform:uppercase">Codeshare</div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center">
          <label style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11px;color:var(--subtext);cursor:pointer">
            <input type="checkbox" id="fctl-is_codeshare" ${f.is_codeshare ? 'checked' : ''} style="cursor:pointer"> Codeshare flight
          </label>
          ${field('CODESHARE FLIGHT NUMBER', 'codeshare_flight', f.codeshare_flight)}
        </div>
      </div>

      <!-- Actions -->
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:4px;border-top:1px solid var(--border)">
        <button class="btn-primary" onclick="fctlSave()" style="font-size:12px;padding:8px 22px">💾 Save Changes</button>
        <button class="btn-ghost" onclick="fctlDelete()" style="font-size:12px;padding:8px 16px;color:var(--red);border-color:var(--red)">🗑 Delete Flight</button>
        <span id="fctl-save-status" style="font-family:var(--mono);font-size:11px;display:none"></span>
      </div>

    </div>`;
}

function _fctlVal(id) {
  const el = document.getElementById(`fctl-${id}`);
  if (!el) return undefined;
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') { const v = el.value.trim(); return v === '' ? null : Number(v); }
  return el.value.trim();
}

async function fctlSave() {
  if (!_fctlCode) return;
  const status = document.getElementById('fctl-save-status');
  status.style.display = '';
  status.style.color = 'var(--subtext)';
  status.textContent = 'Saving…';
  const body = {
    flight_number: _fctlVal('flight_number'),
    dep_city: _fctlVal('dep_city'),
    arr_city: _fctlVal('arr_city'),
    dep_code: _fctlVal('dep_code'),
    arr_code: _fctlVal('arr_code'),
    dep_airport: _fctlVal('dep_airport'),
    arr_airport: _fctlVal('arr_airport'),
    dep_time: _fctlVal('dep_time'),
    arr_time: _fctlVal('arr_time'),
    duration: _fctlVal('duration'),
    terminal: _fctlVal('terminal'),
    aircraft: _fctlVal('aircraft'),
    meal_service: _fctlVal('meal_service'),
    status: _fctlVal('status'),
    gate_dep: _fctlVal('gate_dep'),
    gate_arr: _fctlVal('gate_arr'),
    server_link: _fctlVal('server_link'),
    event_link: _fctlVal('event_link'),
    alerts: _fctlVal('alerts'),
    pax: _fctlVal('pax'),
    pax_joined: _fctlVal('pax_joined'),
    pax_remained: _fctlVal('pax_remained'),
    pax_notes: _fctlVal('pax_notes'),
    is_codeshare: _fctlVal('is_codeshare'),
    codeshare_flight: _fctlVal('codeshare_flight'),
  };
  try {
    await apiFetch(`/api/flights/${_fctlCode}`, 'PATCH', body);
    status.style.color = 'var(--green)';
    status.textContent = '✔ Saved';
    setTimeout(() => status.style.display = 'none', 2500);
    showToast(`✅ Flight ${_fctlCode} updated`);
  } catch (e) {
    status.style.color = 'var(--red)';
    status.textContent = '⚠ ' + e.message;
  }
}

async function fctlDelete() {
  if (!_fctlCode) return;
  const f = _fctlData;
  if (!confirm(`Permanently delete flight ${f?.flight_number || _fctlCode} (${_fctlCode})?\n\nThis cannot be undone.`)) return;
  try {
    await apiFetch(`/api/flights/${_fctlCode}`, 'DELETE');
    showToast(`🗑 Flight ${_fctlCode} deleted`);
    document.getElementById('fctl-editor').style.display = 'none';
    document.getElementById('fctl-code-input').value = '';
    _fctlData = null; _fctlCode = null;
  } catch (e) { showToast('Error: ' + e.message, true); }
}

// ─── MANAGER ACTIONS ──────────────────────────────────────────────────────────

async function mgrActionsInit() {
  mgrLoadBlackout();
  mgrLoadCohostRequests();
}

// Flight control (reuses same render as owner fctl but scoped to mgr- IDs)
async function mgrFctlLoad() {
  const inp = document.getElementById('mgr-fctl-input');
  const err = document.getElementById('mgr-fctl-err');
  const editor = document.getElementById('mgr-fctl-editor');
  const code = (inp?.value || '').trim().toUpperCase();
  if (!code) return;
  err.style.display = 'none';
  editor.innerHTML = '<div class="dbg-loading">Loading…</div>';
  editor.style.display = '';
  try {
    const f = await apiFetch(`/api/flights/${code}`);
    _mgrFctlRender(editor, f, code);
  } catch (e) {
    editor.style.display = 'none';
    err.textContent = e.message.includes('404') ? `No flight found for "${code}"` : '⚠ ' + e.message;
    err.style.display = '';
  }
}

function _mgrFctlRender(container, f, code) {
  const statusOpts = ['On\u2013Time', 'Delayed', 'Cancelled', 'Rescheduled', 'N/A', 'Ended'];
  const statusColor = { 'On\u2013Time': 'var(--green)', 'Delayed': '#f0b232', 'Cancelled': 'var(--red)', 'Rescheduled': '#b47aff', 'Ended': 'var(--dim)', 'N/A': 'var(--subtext)' };
  const field = (label, id, val, type = 'text') =>
    `<div>
      <label style="font-family:var(--mono);font-size:9px;color:var(--subtext);letter-spacing:.08em;display:block;margin-bottom:4px">${label}</label>
      <input type="${type}" id="mfctl-${id}" value="${escapeHtml(String(val ?? ''))}"
             style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 8px;width:100%;outline:none;box-sizing:border-box">
    </div>`;
  const sel = (label, id, val, opts) =>
    `<div><label style="font-family:var(--mono);font-size:9px;color:var(--subtext);letter-spacing:.08em;display:block;margin-bottom:4px">${label}</label>
    <select id="mfctl-${id}" style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 8px;width:100%;outline:none">
      ${opts.map(o => `<option value="${escapeHtml(o)}" ${o === val ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
    </select></div>`;
  const g2 = (...fields) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${fields.join('')}</div>`;
  const g3 = (...fields) => `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">${fields.join('')}</div>`;
  const textarea = (label, id, val) =>
    `<div><label style="font-family:var(--mono);font-size:9px;color:var(--subtext);letter-spacing:.08em;display:block;margin-bottom:4px">${label}</label>
    <textarea id="mfctl-${id}" rows="2" style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 8px;width:100%;outline:none;box-sizing:border-box;resize:vertical">${escapeHtml(String(val ?? ''))}</textarea></div>`;

  container.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);padding:1.25rem;display:flex;flex-direction:column;gap:1.25rem">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="font-family:var(--mono);font-size:18px;color:var(--text);font-weight:600">${escapeHtml(f.flight_number || code)}</div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--subtext)">${escapeHtml(f.dep_city || '?')} \u2192 ${escapeHtml(f.arr_city || '?')}</div>
        <div style="font-family:var(--mono);font-size:11px;padding:2px 8px;border:1px solid ${statusColor[f.status] || 'var(--border)'};color:${statusColor[f.status] || 'var(--subtext)'}">${escapeHtml(f.status || 'N/A')}</div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-left:auto">CODE: ${escapeHtml(code)}</div>
      </div>
      <div>
        <div style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--dim);margin-bottom:8px;text-transform:uppercase">Flight Details</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${g2(field('FLIGHT NUMBER', 'flight_number', f.flight_number), sel('STATUS', 'status', f.status, statusOpts))}
          ${g2(field('DEP CITY', 'dep_city', f.dep_city), field('ARR CITY', 'arr_city', f.arr_city))}
          ${g3(field('DEP CODE', 'dep_code', f.dep_code), field('ARR CODE', 'arr_code', f.arr_code), field('AIRCRAFT', 'aircraft', f.aircraft))}
          ${g2(field('DEP AIRPORT', 'dep_airport', f.dep_airport), field('ARR AIRPORT', 'arr_airport', f.arr_airport))}
          ${g3(field('DEP TIME (UTC)', 'dep_time', f.dep_time), field('ARR TIME (UTC)', 'arr_time', f.arr_time), field('DURATION', 'duration', f.duration))}
          ${g2(field('TERMINAL', 'terminal', f.terminal), field('MEAL SERVICE', 'meal_service', f.meal_service))}
          ${g2(field('DEP GATE', 'gate_dep', f.gate_dep), field('ARR GATE', 'gate_arr', f.gate_arr))}
        </div>
      </div>
      <div>
        <div style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--dim);margin-bottom:8px;text-transform:uppercase">Links & Alerts</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${field('SERVER LINK', 'server_link', f.server_link)}
          ${field('EVENT LINK', 'event_link', f.event_link)}
          ${textarea('ALERTS', 'alerts', f.alerts)}
        </div>
      </div>
      <div>
        <div style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--dim);margin-bottom:8px;text-transform:uppercase">Passenger Data</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${g3(field('CAPACITY', 'pax', f.pax, 'number'), field('JOINED', 'pax_joined', f.pax_joined, 'number'), field('REMAINED', 'pax_remained', f.pax_remained, 'number'))}
          ${textarea('PAX NOTES', 'pax_notes', f.pax_notes)}
        </div>
      </div>
      <div>
        <div style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--dim);margin-bottom:8px;text-transform:uppercase">Host Assignment</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div>
            <label style="font-family:var(--mono);font-size:9px;color:var(--subtext);letter-spacing:.08em;display:block;margin-bottom:4px">HOST (Discord User ID)</label>
            <div style="display:flex;gap:8px">
              <input id="mfctl-host_user_id" value="${escapeHtml(f.host_user_id || '')}" placeholder="Discord user ID"
                style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 8px;flex:1;outline:none" />
              <select id="mfctl-host_picker" onchange="document.getElementById('mfctl-host_user_id').value=this.value;this.value=''"
                style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 8px;outline:none;max-width:200px">
                <option value="">— Pick from hosts —</option>
                ${(typeof allHosts !== 'undefined' ? allHosts : []).map(h => `<option value="${escapeHtml(h.user_id)}">${escapeHtml(h.username)}</option>`).join('')}
              </select>
            </div>
            <div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-top:4px">Pick from the dropdown or paste a Discord ID directly. Stats will count toward the new host.</div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;color:var(--subtext);cursor:pointer">
            <input type="checkbox" id="mfctl-override_limit" style="cursor:pointer">
            Override flight limit — allow this host to exceed their scheduled flight cap
          </label>
        </div>
      </div>
      <div>
        <div style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--dim);margin-bottom:8px;text-transform:uppercase">Codeshare & Co-hosts</div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center;margin-bottom:8px">
          <label style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11px;color:var(--subtext);cursor:pointer">
            <input type="checkbox" id="mfctl-is_codeshare" ${f.is_codeshare ? 'checked' : ''} style="cursor:pointer"> Codeshare flight
          </label>
          ${field('CODESHARE FLIGHT NUMBER', 'codeshare_flight', f.codeshare_flight)}
        </div>
        ${field('CO-HOSTS (space-separated Discord IDs)', 'cohosts', (f.cohosts || []).join(' '))}
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:4px;border-top:1px solid var(--border)">
        <button class="btn-primary" onclick="mgrFctlSave('${code}')" style="font-size:12px;padding:8px 22px">💾 Save Changes</button>
        <button class="btn-ghost" onclick="mgrFctlAction('${code}','close')" style="font-size:11px;padding:7px 14px">🔒 Close</button>
        <button class="btn-ghost" onclick="mgrFctlAction('${code}','remind')" style="font-size:11px;padding:7px 14px">🔔 Remind</button>
        <button class="btn-ghost" onclick="mgrFctlAction('${code}','start')" style="font-size:11px;padding:7px 14px">🚀 Start</button>
        <span id="mfctl-save-status" style="font-family:var(--mono);font-size:11px;display:none;align-self:center"></span>
      </div>
    </div>`;
}

async function mgrFctlSave(code) {
  const v = id => {
    const el = document.getElementById(`mfctl-${id}`);
    if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') { const x = el.value.trim(); return x === '' ? null : Number(x); }
    return el.value.trim();
  };
  const st = document.getElementById('mfctl-save-status');
  st.style.display = ''; st.style.color = 'var(--subtext)'; st.textContent = 'Saving…';
  try {
    const cohostsRaw = v('cohosts') || '';
    const hostId = document.getElementById('mfctl-host_user_id')?.value.trim() || undefined;
    const overrideLimit = document.getElementById('mfctl-override_limit')?.checked || false;
    await apiFetch(`/api/flights/${code}`, 'PATCH', {
      ...(hostId ? { host_user_id: hostId } : {}),
      override_limit: overrideLimit,
      flight_number: v('flight_number'),
      dep_city: v('dep_city'), arr_city: v('arr_city'),
      dep_code: v('dep_code'), arr_code: v('arr_code'),
      dep_airport: v('dep_airport'), arr_airport: v('arr_airport'),
      dep_time: v('dep_time'), arr_time: v('arr_time'),
      duration: v('duration'), terminal: v('terminal'),
      aircraft: v('aircraft'), meal_service: v('meal_service'),
      status: v('status'),
      gate_dep: v('gate_dep'), gate_arr: v('gate_arr'),
      server_link: v('server_link'), event_link: v('event_link'),
      alerts: v('alerts'),
      pax: v('pax'), pax_joined: v('pax_joined'),
      pax_remained: v('pax_remained'), pax_notes: v('pax_notes'),
      is_codeshare: v('is_codeshare'), codeshare_flight: v('codeshare_flight'),
      cohosts: cohostsRaw.split(/\s+/).filter(Boolean),
    });
    st.style.color = 'var(--green)'; st.textContent = '\u2714 Saved';
    setTimeout(() => st.style.display = 'none', 2500);
    showToast(`\u2705 Flight ${code} updated`);
  } catch (e) { st.style.color = 'var(--red)'; st.textContent = '\u26a0 ' + e.message; }
}

async function mgrFctlAction(code, action) {
  const endpoints = { close: `/api/flights/${code}/close`, remind: `/api/flights/${code}/remind`, start: `/api/flights/${code}/start` };
  try {
    await apiFetch(endpoints[action], 'POST', {});
    showToast(`✅ ${action} sent for ${code}`);
  } catch (e) { showToast('Error: ' + e.message, true); }
}

// ─── COHOST REQUEST FROM MAIN DRAWER ──────────────────────────────────────────
async function submitCohostRequest() {
  const code = window.currentCode;
  if (!code) return;
  const note = document.getElementById('d-cohost-note')?.value.trim() || '';
  const msgEl = document.getElementById('d-cohost-req-msg');
  try {
    await apiFetch('/api/cohost-requests', 'POST', { flight_code: code, note });
    if (msgEl) { msgEl.style.display = ''; msgEl.style.color = 'var(--green)'; msgEl.textContent = '✅ Request submitted — awaiting manager approval'; }
    const noteEl = document.getElementById('d-cohost-note');
    if (noteEl) noteEl.value = '';
    // Hide the button so they can't double-submit
    const btn = document.querySelector('#d-cohost-req-section button');
    if (btn) btn.disabled = true;
  } catch (e) {
    if (msgEl) { msgEl.style.display = ''; msgEl.style.color = 'var(--red)'; msgEl.textContent = '⚠ ' + e.message; }
  }
}

// Called from openDrawer in dashboard-flights.js to show/hide the cohost request section
function _updateCohostReqSection(flight) {
  const section = document.getElementById('d-cohost-req-section');
  if (!section) return;
  const myId = String((typeof sessionUserId !== 'undefined' ? sessionUserId : '') || window.sessionUserId || '');
  const hostId = String(flight?.host_user_id || '');
  const cohosts = (flight?.cohosts || []).map(String);
  const isHost = myId && myId === hostId;
  const isCohost = myId && cohosts.includes(myId);
  const isEnded = flight?.status === 'Ended' || flight?.status === 'Cancelled';
  const show = myId && !isHost && !isCohost && !isEnded;
  section.style.display = show ? '' : 'none';

  // Remove any leftover debug element
  const dbgEl = document.getElementById('d-cohost-debug');
  if (dbgEl) dbgEl.remove();

  // Reset message
  const msgEl = document.getElementById('d-cohost-req-msg');
  if (msgEl) { msgEl.style.display = 'none'; msgEl.textContent = ''; }
  const btn = section.querySelector('button');
  if (btn) btn.disabled = false;
}

// ─── CO-HOST REQUESTS ─────────────────────────────────────────────────────────
async function mgrLoadCohostRequests() {
  const list = document.getElementById('mgr-cohost-list');
  const badge = document.getElementById('mgr-cohost-badge');
  if (!list) return;
  list.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--dim)">Loading…</div>';
  try {
    const data = await apiFetch('/api/cohost-requests');
    const reqs = Object.values(data.requests || {});
    const pending = reqs.filter(r => r.status === 'pending');
    if (badge) {
      badge.textContent = pending.length > 0 ? `${pending.length} pending` : '';
      badge.style.display = pending.length > 0 ? '' : 'none';
    }
    if (!reqs.length) {
      list.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--dim);padding:4px 0">No co-host requests</div>';
      return;
    }
    // Sort: pending first, then by date
    reqs.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return new Date(b.submitted_at) - new Date(a.submitted_at);
    });
    const statusColor = { pending: '#f0b232', approved: 'var(--green)', denied: 'var(--red)' };
    list.innerHTML = reqs.map(r => {
      const req_id = `${r.flight_code}_${r.requester_id}`;
      const when = r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : '?';
      const avatar = r.requester_avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
      return `
        <div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid ${statusColor[r.status] || 'var(--dim)'};padding:10px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <img src="${avatar}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"
               style="width:28px;height:28px;border-radius:50%;flex-shrink:0">
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--mono);font-size:11px;color:var(--text)">${escapeHtml(r.requester_name || r.requester_id)}</div>
            <div style="font-family:var(--mono);font-size:9px;color:var(--subtext);margin-top:2px">
              Flight <strong>${escapeHtml(r.flight_code)}</strong> · ${escapeHtml(r.flight_number || '?')} · ${when}
              ${r.note ? ` · <em style="color:var(--dim)">"${escapeHtml(r.note)}"</em>` : ''}
            </div>
          </div>
          <span style="font-family:var(--mono);font-size:9px;padding:2px 7px;border:1px solid ${statusColor[r.status] || 'var(--dim)'};color:${statusColor[r.status] || 'var(--dim)'}">${r.status.toUpperCase()}</span>
          ${r.status === 'pending' ? `
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button class="action-btn" style="color:var(--green);border-color:var(--green);font-size:9px;padding:3px 10px"
                      onclick="mgrCohostApprove('${escapeHtml(req_id)}')">Approve</button>
              <button class="action-btn" style="color:var(--red);border-color:var(--red);font-size:9px;padding:3px 10px"
                      onclick="mgrCohostDeny('${escapeHtml(req_id)}')">Deny</button>
            </div>` : `
            <button class="action-btn" style="font-size:9px;padding:3px 8px;opacity:.5"
                    onclick="mgrCohostDelete('${escapeHtml(req_id)}')">Remove</button>`}
        </div>`;
    }).join('');
  } catch (e) {
    if (list) list.innerHTML = `<div style="font-family:var(--mono);font-size:11px;color:var(--red)">Error: ${escapeHtml(e.message)}</div>`;
  }
}

async function mgrCohostApprove(req_id) {
  try {
    await apiFetch(`/api/cohost-requests/${req_id}/approve`, 'POST', {});
    showToast('✅ Co-host approved');
    mgrLoadCohostRequests();
  } catch (e) { showToast('Error: ' + e.message, true); }
}
async function mgrCohostDeny(req_id) {
  if (!confirm('Deny this co-host request?')) return;
  try {
    await apiFetch(`/api/cohost-requests/${req_id}/deny`, 'POST', {});
    showToast('Request denied');
    mgrLoadCohostRequests();
  } catch (e) { showToast('Error: ' + e.message, true); }
}
async function mgrCohostDelete(req_id) {
  try {
    await apiFetch(`/api/cohost-requests/${req_id}`, 'DELETE');
    mgrLoadCohostRequests();
  } catch (e) { showToast('Error: ' + e.message, true); }
}

// ─── ANNOUNCE BUILDER ─────────────────────────────────────────────────────────
function annPreview() {
  const title = document.getElementById('ann-title')?.value || '';
  const author = document.getElementById('ann-author')?.value || '';
  const desc = document.getElementById('ann-desc')?.value || '';
  const footer = document.getElementById('ann-footer')?.value || '';
  const color = '#' + (document.getElementById('ann-color')?.value || 'e8001c').replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
  const box = document.getElementById('ann-preview-box');
  if (box) box.style.borderLeftColor = color;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('ann-prev-author', author);
  set('ann-prev-title', title);
  set('ann-prev-desc', desc);
  set('ann-prev-footer', footer);
}

async function annSend() {
  const title = document.getElementById('ann-title')?.value.trim() || '';
  const author = document.getElementById('ann-author')?.value.trim() || '';
  const desc = document.getElementById('ann-desc')?.value.trim() || '';
  const footer = document.getElementById('ann-footer')?.value.trim() || '';
  const color = parseInt((document.getElementById('ann-color')?.value || 'e8001c'), 16);
  const st = document.getElementById('ann-status');

  if (!title && !desc) { showToast('⚠ Enter a title or description', true); return; }

  if (st) { st.style.display = ''; st.style.color = 'var(--subtext)'; st.textContent = 'Sending…'; }
  try {
    await apiFetch('/api/announce-embed', 'POST', {
      embed: {
        title, description: desc, author: author ? { name: author } : null,
        footer: footer ? { text: footer } : null, color: isNaN(color) ? 0xe8001c : color
      }
    });
    if (st) { st.style.color = 'var(--green)'; st.textContent = '✔ Sent!'; setTimeout(() => st.style.display = 'none', 3000); }
    showToast('📣 Announcement sent!');
  } catch (e) {
    if (st) { st.style.color = 'var(--red)'; st.textContent = '⚠ ' + e.message; }
    showToast('Error: ' + e.message, true);
  }
}

function annClear() {
  ['ann-title', 'ann-author', 'ann-desc', 'ann-footer'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const cp = document.getElementById('ann-color-picker');
  const ci = document.getElementById('ann-color');
  if (cp) cp.value = '#e8001c';
  if (ci) ci.value = 'e8001c';
  annPreview();
}

// Banner
async function mgrPublishBanner() {
  const msg = document.getElementById('mgr-banner-msg')?.value.trim();
  const type = document.getElementById('mgr-banner-type')?.value || 'info';
  if (!msg) { showToast('⚠ Enter a message first', true); return; }
  try {
    await apiFetch('/api/banner', 'POST', { message: msg, type });
    showToast('📢 Banner published');
  } catch (e) { showToast('Error: ' + e.message, true); }
}
async function mgrClearBanner() {
  try {
    await apiFetch('/api/banner', 'DELETE');
    showToast('✅ Banner cleared');
  } catch (e) { showToast('Error: ' + e.message, true); }
}

// Bot send
async function mgrBotSend() {
  const msg = document.getElementById('mgr-bot-msg')?.value.trim();
  const ch = document.getElementById('mgr-bot-channel')?.value || 'announce';
  const st = document.getElementById('mgr-bot-status');
  if (!msg) { showToast('⚠ Enter a message', true); return; }
  st.style.display = ''; st.style.color = 'var(--subtext)'; st.textContent = 'Sending…';
  try {
    await apiFetch('/api/bot-send', 'POST', { message: msg, channel: ch });
    st.style.color = 'var(--green)'; st.textContent = '✔ Sent';
    document.getElementById('mgr-bot-msg').value = '';
    setTimeout(() => st.style.display = 'none', 2500);
  } catch (e) { st.style.color = 'var(--red)'; st.textContent = '⚠ ' + e.message; }
}

// Blackout
let _mgrBlackout = [];
async function mgrLoadBlackout() {
  const list = document.getElementById('mgr-blackout-list');
  if (!list) return;
  try {
    _mgrBlackout = await apiFetch('/api/blackout');
    _mgrRenderBlackout();
  } catch (e) { if (list) list.innerHTML = `<span style="font-family:var(--mono);font-size:11px;color:var(--red)">${e.message}</span>`; }
}
function _mgrRenderBlackout() {
  const list = document.getElementById('mgr-blackout-list');
  if (!list) return;
  if (!_mgrBlackout.length) { list.innerHTML = '<span style="font-family:var(--mono);font-size:11px;color:var(--dim)">No blackout dates</span>'; return; }
  list.innerHTML = _mgrBlackout.map(d => `
    <div style="display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-left:2px solid var(--red);padding:5px 10px">
      <span style="font-family:var(--mono);font-size:11px;color:var(--text)">${escapeHtml(d)}</span>
      <button class="action-btn" style="font-size:9px;color:var(--red);border-color:var(--red)" onclick="mgrRemoveBlackout('${escapeHtml(d)}')">✕</button>
    </div>`).join('');
}
async function mgrAddBlackout() {
  const inp = document.getElementById('mgr-blackout-input');
  const err = document.getElementById('mgr-blackout-err');
  const val = inp?.value?.trim();
  if (!val) return;
  err.style.display = 'none';
  try {
    const res = await apiFetch('/api/blackout', 'POST', { date: val });
    _mgrBlackout = res.blackout || _mgrBlackout;
    _mgrRenderBlackout();
    inp.value = '';
    showToast(`🚫 ${val} blocked`);
  } catch (e) { err.textContent = '⚠ ' + e.message; err.style.display = ''; }
}
async function mgrRemoveBlackout(date) {
  try {
    const res = await apiFetch(`/api/blackout/${date}`, 'DELETE');
    _mgrBlackout = res.blackout || _mgrBlackout.filter(d => d !== date);
    _mgrRenderBlackout();
    showToast(`✅ ${date} unblocked`);
  } catch (e) { showToast('Error: ' + e.message, true); }
}

// ─── MANAGER STRIKES ──────────────────────────────────────────────────────────

let _strikeHosts = [];

async function mgrStrikesInit() {
  // Load hosts for dropdown
  const sel = document.getElementById('strike-host-select');
  try {
    _strikeHosts = await apiFetch('/api/hosts');
    if (sel) {
      sel.innerHTML = '<option value="">Select host…</option>' +
        _strikeHosts.map(h => `<option value="${h.user_id}" data-name="${escapeHtml(h.username)}">${escapeHtml(h.username)}</option>`).join('');
    }
  } catch (e) { if (sel) sel.innerHTML = '<option>Error loading hosts</option>'; }
  _mgrRenderStrikes();
}

async function _mgrRenderStrikes() {
  const list = document.getElementById('strikes-list');
  if (!list) return;
  list.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--dim)">Loading…</div>';
  try {
    const all = await apiFetch('/api/strikes');
    const entries = Object.entries(all);
    if (!entries.length) {
      list.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--dim)">No strikes issued</div>';
      return;
    }
    list.innerHTML = entries.map(([uid, strikes]) => {
      const host = _strikeHosts.find(h => h.user_id === uid);
      const name = strikes[0]?.username || host?.username || uid;
      const avatar = host?.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
      const count = strikes.length;
      const color = count >= 3 ? 'var(--red)' : count === 2 ? '#f0b232' : 'var(--subtext)';
      return `
        <div style="background:var(--card);border:1px solid var(--border);border-left:3px solid ${color};padding:12px 14px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <img src="${avatar}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"
                 style="width:28px;height:28px;border-radius:50%">
            <div style="font-family:var(--mono);font-size:12px;color:var(--text);font-weight:600">${escapeHtml(name)}</div>
            <div style="font-family:var(--mono);font-size:10px;color:${color};margin-left:auto">${count} strike${count !== 1 ? 's' : ''}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            ${strikes.map((s, i) => `
              <div style="display:flex;align-items:center;gap:8px;background:var(--surface);padding:6px 10px">
                <span style="font-family:var(--mono);font-size:9px;color:${color};font-weight:600;min-width:20px">#${s.number || i + 1}</span>
                <span style="font-family:var(--mono);font-size:11px;color:var(--text);flex:1">${escapeHtml(s.reason || 'No reason')}</span>
                <span style="font-family:var(--mono);font-size:9px;color:var(--dim)">${s.issued_by || '?'} · ${s.issued_at ? new Date(s.issued_at).toLocaleDateString() : ''}</span>
                <button class="action-btn" style="font-size:8px;color:var(--red);border-color:var(--red)"
                        onclick="mgrRemoveStrike('${uid}',${i})">✕</button>
              </div>`).join('')}
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div style="font-family:var(--mono);font-size:11px;color:var(--red)">Error: ${escapeHtml(e.message)}</div>`;
  }
}

async function mgrIssueStrike() {
  const sel = document.getElementById('strike-host-select');
  const reason = document.getElementById('strike-reason')?.value.trim();
  const st = document.getElementById('strike-status');
  const uid = sel?.value;
  const username = sel?.options[sel.selectedIndex]?.dataset.name || uid;
  if (!uid) { showToast('⚠ Select a host first', true); return; }
  if (!reason) { showToast('⚠ Enter a reason', true); return; }
  if (!confirm(`Issue a strike to ${username}?\n\nReason: ${reason}\n\nThis will DM them automatically.`)) return;
  st.style.display = ''; st.style.color = 'var(--subtext)'; st.textContent = 'Issuing…';
  try {
    const result = await apiFetch(`/api/strikes/${uid}`, 'POST', { reason, username });
    st.style.color = 'var(--green)'; st.textContent = `✔ Strike #${result.number} issued`;
    document.getElementById('strike-reason').value = '';
    _mgrRenderStrikes();
    setTimeout(() => st.style.display = 'none', 3000);
  } catch (e) { st.style.color = 'var(--red)'; st.textContent = '⚠ ' + e.message; }
}

async function mgrRemoveStrike(uid, idx) {
  if (!confirm('Remove this strike?')) return;
  try {
    await apiFetch(`/api/strikes/${uid}/${idx}`, 'DELETE');
    showToast('✅ Strike removed');
    _mgrRenderStrikes();
  } catch (e) { showToast('⚠ ' + e.message, true); }
}

// ─── OWNER BLACKOUT CALENDAR ──────────────────────────────────────────────────
let _ownerCalYear = new Date().getFullYear();
let _ownerCalMonth = new Date().getMonth();
let _ownerBlackout = new Set();

async function loadCalendar() {
  try {
    const raw = await apiFetch('/api/blackout');
    const arr = Array.isArray(raw) ? raw : (raw.blackout || []);
    _ownerBlackout = new Set(arr);
    calRender();
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

function calGoToday() {
  _ownerCalYear = new Date().getFullYear();
  _ownerCalMonth = new Date().getMonth();
  calRender();
}

function calNav(dir) {
  _ownerCalMonth += dir;
  if (_ownerCalMonth > 11) { _ownerCalMonth = 0; _ownerCalYear++; }
  if (_ownerCalMonth < 0) { _ownerCalMonth = 11; _ownerCalYear--; }
  calRender();
}

function calRender() {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const label = document.getElementById('cal-month-label');
  if (label) label.textContent = `${MONTHS[_ownerCalMonth]} ${_ownerCalYear}`;

  const grid = document.getElementById('cal-grid');
  if (!grid) return;

  const firstDay = new Date(_ownerCalYear, _ownerCalMonth, 1).getDay();
  const daysInMonth = new Date(_ownerCalYear, _ownerCalMonth + 1, 0).getDate();
  const offset = (firstDay + 6) % 7; // Mon-based

  let html = DAYS.map(d =>
    `<div style="color:var(--dim);padding:4px 0;font-size:9px;letter-spacing:.06em">${d}</div>`
  ).join('');

  for (let i = 0; i < offset; i++) html += '<div></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${_ownerCalYear}-${String(_ownerCalMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isBlackout = _ownerBlackout.has(dateStr);
    const today = new Date();
    const isToday = today.getFullYear() === _ownerCalYear && today.getMonth() === _ownerCalMonth && today.getDate() === d;
    html += `<div onclick="calToggle('${dateStr}')" style="
      padding:6px 0;cursor:pointer;border-radius:3px;text-align:center;
      background:${isBlackout ? '#b5001a' : isToday ? 'rgba(68,138,255,.15)' : 'var(--surface)'};
      color:${isBlackout ? '#fff' : isToday ? 'var(--accent)' : 'var(--text)'};
      border:2px solid ${isBlackout ? '#e8001c' : isToday ? 'var(--accent)' : 'var(--border)'};
      font-size:11px;font-weight:${isBlackout ? '700' : 'normal'};transition:background .15s"
      title="${isBlackout ? 'Click to remove blackout' : 'Click to add blackout'}">${d}</div>`;
  }
  grid.innerHTML = html;

  const list = document.getElementById('cal-list');
  if (!list) return;
  const sorted = [..._ownerBlackout].sort();
  if (!sorted.length) {
    list.innerHTML = `<div style="font-family:var(--mono);font-size:11px;color:var(--dim)">No blackout dates set</div>`;
    return;
  }
  list.innerHTML = sorted.map(d => `
    <div style="display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-left:2px solid var(--red);padding:6px 10px">
      <span style="font-family:var(--mono);font-size:11px;color:var(--text);flex:1">${d}</span>
      <button class="action-btn" style="color:var(--red);border-color:var(--red);font-size:9px" onclick="calToggle('${d}')">Remove</button>
    </div>`).join('');
}

async function calToggle(dateStr) {
  try {
    if (_ownerBlackout.has(dateStr)) {
      await apiFetch(`/api/blackout/${dateStr}`, 'DELETE');
      _ownerBlackout.delete(dateStr);
      showToast(`✅ ${dateStr} removed from blackout`);
    } else {
      await apiFetch('/api/blackout', 'POST', { date: dateStr });
      _ownerBlackout.add(dateStr);
      showToast(`🚫 ${dateStr} marked as blackout`);
    }
    calRender();
  } catch (e) { showToast('Error: ' + e.message, true); }
}


// ─── AVAILABILITY CALENDAR ────────────────────────────────────────────────────
const AVAIL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let _availSlots = new Set();  // "day:hour" strings
let _availDragging = false;
let _availDragVal = null; // true = painting, false = erasing

async function loadAvailability() {
  try {
    const data = await apiFetch('/api/availability');
    _availSlots = new Set(data.slots || []);
  } catch (e) {
    _availSlots = new Set();
  }
  _renderAvailGrid();
}

function _renderAvailGrid() {
  const grid = document.getElementById('avail-grid');
  if (!grid) return;

  let html = '';

  // Header row: empty corner + day names
  html += `<div></div>`;
  AVAIL_DAYS.forEach(d => {
    html += `<div style="font-family:var(--mono);font-size:9px;letter-spacing:.06em;color:var(--subtext);text-align:center;padding:4px 0;text-transform:uppercase">${d}</div>`;
  });

  // Hour rows
  for (let h = 0; h < 24; h++) {
    const label = String(h).padStart(2, '0') + ':00';
    html += `<div style="font-family:var(--mono);font-size:9px;color:var(--dim);text-align:right;padding-right:6px;line-height:22px">${label}</div>`;
    for (let d = 0; d < 7; d++) {
      const key = `${d}:${h}`;
      const on = _availSlots.has(key);
      html += `<div
        data-key="${key}"
        onmousedown="availCellDown(event,'${key}')"
        onmouseenter="availCellEnter('${key}')"
        style="height:22px;border-radius:2px;cursor:pointer;transition:background .1s;
               background:${on ? '#1a4731' : 'var(--surface)'};
               border:1px solid ${on ? 'var(--green)' : 'var(--border)'}"
        title="${AVAIL_DAYS[d]} ${label}"></div>`;
    }
  }

  grid.innerHTML = html;
  _updateAvailCount();

  // Mouse up anywhere = stop drag
  document.removeEventListener('mouseup', availDragStop);
  document.addEventListener('mouseup', availDragStop);
}

function availCellDown(e, key) {
  e.preventDefault();
  _availDragging = true;
  _availDragVal = !_availSlots.has(key); // toggle direction
  _availToggle(key);
}

function availCellEnter(key) {
  if (!_availDragging) return;
  if (_availDragVal) _availSlots.add(key);
  else _availSlots.delete(key);
  const el = document.querySelector(`[data-key="${key}"]`);
  if (el) {
    el.style.background = _availDragVal ? '#1a4731' : 'var(--surface)';
    el.style.borderColor = _availDragVal ? 'var(--green)' : 'var(--border)';
  }
  _updateAvailCount();
}

function availDragStop() { _availDragging = false; }

function _availToggle(key) {
  if (_availDragVal) _availSlots.add(key);
  else _availSlots.delete(key);
  const el = document.querySelector(`[data-key="${key}"]`);
  if (el) {
    el.style.background = _availDragVal ? '#1a4731' : 'var(--surface)';
    el.style.borderColor = _availDragVal ? 'var(--green)' : 'var(--border)';
  }
  _updateAvailCount();
}

function _updateAvailCount() {
  const el = document.getElementById('avail-count');
  if (el) el.textContent = _availSlots.size;
}

async function saveAvailability() {
  try {
    await apiFetch('/api/availability', 'POST', { slots: [..._availSlots] });
    const el = document.getElementById('avail-saved');
    if (el) { el.style.display = 'inline'; setTimeout(() => el.style.display = 'none', 2500); }
    showToast('✅ Availability saved');
  } catch (e) { showToast('Error: ' + e.message, true); }
}

function clearAvailability() {
  if (!confirm('Clear your entire availability schedule?')) return;
  _availSlots.clear();
  _renderAvailGrid();
}

// ─── AVAILABILITY GRID (read-only, for manager host profile) ──────────────────
async function loadHostAvailability(userId, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--dim);padding:8px 0">Loading…</div>';
  try {
    const data = await apiFetch(`/api/availability/${userId}`);
    const slots = new Set(data.slots || []);
    if (!slots.size) {
      container.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--dim);padding:8px 0">No availability set</div>';
      return;
    }
    let html = `<div style="display:grid;grid-template-columns:36px repeat(7,1fr);gap:1px;font-size:8px">`;
    // Header
    html += '<div></div>';
    AVAIL_DAYS.forEach(d => {
      html += `<div style="font-family:var(--mono);color:var(--subtext);text-align:center;padding:2px 0">${d}</div>`;
    });
    for (let h = 0; h < 24; h++) {
      html += `<div style="font-family:var(--mono);color:var(--dim);text-align:right;padding-right:4px;line-height:14px">${String(h).padStart(2, '0')}</div>`;
      for (let d = 0; d < 7; d++) {
        const on = slots.has(`${d}:${h}`);
        html += `<div style="height:14px;border-radius:1px;background:${on ? '#1a4731' : 'var(--surface)'};border:1px solid ${on ? 'var(--green)' : 'var(--border)'}" title="${AVAIL_DAYS[d]} ${String(h).padStart(2, '0')}:00"></div>`;
      }
    }
    html += `</div><div style="font-family:var(--mono);font-size:10px;color:var(--subtext);margin-top:6px">${slots.size} hours/week available</div>`;
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div style="font-family:var(--mono);font-size:11px;color:var(--dim);padding:8px 0">Could not load availability</div>`;
  }
}


// ─── CREW SIGNUP PANEL ────────────────────────────────────────────────────────
const CREW_SLOT_DEFS = [
  { key: 'host', label: '🧑‍✈️ Host', max: 1, list: false },
  { key: 'cohost', label: '👤 Co-Host', max: 1, list: false },
  { key: 'pilot', label: '🧑‍✈️ Pilot', max: 1, list: false },
  { key: 'copilot', label: '👨‍✈️ Co-Pilot', max: 1, list: false },
  { key: 'cc', label: '🛎️ Cabin Crew', max: 3, list: true },
  { key: 'gc', label: '🔧 Ground Crew', max: 2, list: true },
  { key: 'backup', label: '🔄 Backup', max: null, list: true },
];

async function loadCrewPanel(code, flight) {
  const body = document.getElementById('d-crew-body');
  const threadLink = document.getElementById('d-crew-thread-link');
  if (!body) return;

  body.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--dim)">Loading crew…</div>';

  try {
    const crew = await apiFetch(`/api/flights/${code}/crew`);

    // Thread link
    if (threadLink && crew.thread_id) {
      threadLink.href = `https://discord.com/channels/${crew.guild_id || ''}/${crew.thread_id}`;
      threadLink.style.display = '';
    }

    // Build display rows
    const hostMember = (typeof allHosts !== 'undefined' ? allHosts : []).find(h => h.user_id === flight?.host_user_id);
    const hostName = hostMember ? hostMember.username : (flight?.host_user_id || 'N/A');
    const cohostIds = flight?.cohosts || [];
    const cohostNames = cohostIds.map(id => {
      const m = (typeof allHosts !== 'undefined' ? allHosts : []).find(h => h.user_id === id);
      return m ? m.username : id;
    });

    const row = (label, val, filled, max) => {
      const countStr = max != null ? ` <span style="color:var(--dim)">(${filled}/${max})</span>` : ` <span style="color:var(--dim)">(${filled})</span>`;
      return `<div style="display:flex;align-items:baseline;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="font-family:var(--mono);font-size:10px;color:var(--subtext);min-width:100px;flex-shrink:0">${label}${countStr}</span>
        <span style="font-family:var(--mono);font-size:11px;color:var(--text);flex:1">${val || '<span style="color:var(--dim)">N/A</span>'}</span>
      </div>`;
    };

    const nameOrId = u => u?.name || u?.id || '?';

    let html = '';
    html += row('🧑‍✈️ Host', hostName, 1, 1);
    html += row('👤 Co-Host', cohostNames.join(', ') || null, cohostNames.length, 1);
    html += row('🧑‍✈️ Pilot', nameOrId(crew.pilot), crew.pilot ? 1 : 0, 1);
    html += row('👨‍✈️ Co-Pilot', nameOrId(crew.copilot), crew.copilot ? 1 : 0, 1);
    html += row('🛎️ Cabin Crew', crew.cc.map(nameOrId).join(', ') || null, crew.cc.length, 3);
    html += row('🔧 Ground Crew', crew.gc.map(nameOrId).join(', ') || null, crew.gc.length, 3);
    html += row('🔄 Backup', crew.backup.map(nameOrId).join(', ') || null, crew.backup.length, null);

    body.innerHTML = html;

  } catch (e) {
    body.innerHTML = `<div style="font-family:var(--mono);font-size:11px;color:var(--dim)">Crew data unavailable</div>`;
  }
}


// ─── MANUAL FLIGHT BOARD POST ─────────────────────────────────────────────────
async function postFlightBoard() {
  const dateEl = document.getElementById('board-post-date');
  const statusEl = document.getElementById('board-post-status');
  const date = dateEl ? dateEl.value : '';

  if (statusEl) { statusEl.style.display = ''; statusEl.style.color = 'var(--subtext)'; statusEl.textContent = 'Posting…'; }

  try {
    const res = await apiFetch('/api/post-flight-board', 'POST', { date });
    const msg = res.action === 'updated' ? '✅ Flight board refreshed' : '✅ Flight board posted';
    if (statusEl) { statusEl.style.color = 'var(--green)'; statusEl.textContent = msg; }
    showToast(msg);
  } catch (e) {
    if (statusEl) { statusEl.style.color = 'var(--red)'; statusEl.textContent = '⚠ ' + e.message; }
    showToast('Error: ' + e.message, true);
  }
}


// ─── FA HANDBOOK GENERATOR ────────────────────────────────────────────────────
function openHandbookModal() {
  if (!currentCode) return;
  const f = [...allFlights, ...endedFlights].find(x => x.code === currentCode);

  // Pre-fill gate from flight data
  const gateEl = document.getElementById('hb-gate');
  if (gateEl && f?.gate_dep && f.gate_dep !== 'N/A') gateEl.value = f.gate_dep;

  const typeEl = document.getElementById('hb-auto-type');
  if (typeEl) typeEl.textContent = getAutoHandbookType(f?.aircraft);

  openMiniModal('handbook');
  setTimeout(() => document.getElementById('hb-fa-name')?.focus(), 80);
}

function getAutoHandbookType(aircraft) {
  const value = String(aircraft || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const aliases = { A223: 'A220', CR9: 'CRJ', CRJ9: 'CRJ', CRJ900: 'CRJ', DH4: 'Q400', DH4J: 'Q400', DASH8400: 'Q400', DASH8Q400: 'Q400' };
  const key = aliases[value] || value;
  return ['A220', 'A320', 'B737', 'CRJ', 'Q400'].some(ac => key.includes(ac)) ? 'Short Haul' : 'Long Haul';
}

async function downloadHandbook() {
  if (!currentCode) return;
  const params = new URLSearchParams({
    fa_name: document.getElementById('hb-fa-name')?.value || '',
    dep_gate: document.getElementById('hb-gate')?.value || '',
    arr_city_override: document.getElementById('hb-arr-city')?.value || '',
    local_time: document.getElementById('hb-local-time')?.value || '',
    temperature: document.getElementById('hb-temp')?.value || '',
    extra_notes: document.getElementById('hb-notes')?.value || '',
    meal_week: document.getElementById('hb-meal-week')?.value || '',
    drive_only: 'true',
  });

  try {
    showLoading(true);
    const res = await fetch(`/api/flights/${currentCode}/handbook?${params}`, {
      credentials: 'include'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.drive_link) throw new Error('Drive link missing from response');
    closeMiniModal('handbook');
    showToast('Handbook uploaded to Drive');
    window.location.href = data.drive_link;
  } catch (e) {
    showToast('Error: ' + e.message, true);
  } finally {
    showLoading(false);
  }
}

let _crewManageFlights = [];
let _crewManageAddTarget = null;
let _crewPollInterval = null;
let _crewLastPendingCount = -1;   // -1 = not yet loaded (suppress first toast)
const _CREW_POLL_INTERVAL_MS = 30000; // poll every 30 seconds

// ─── CREW INBOX ICON + POLLING ────────────────────────────────────────────────

function _getCrewPendingCount(flights) {
  return (flights || _crewManageFlights).reduce((sum, f) =>
    sum + (f.requests || []).filter(r => r.status === 'pending').length, 0);
}

function _getCrewPendingRequests(flights) {
  const pending = [];
  (flights || _crewManageFlights).forEach(f => {
    (f.requests || []).filter(r => r.status === 'pending').forEach(r => {
      pending.push({ ...r, flight_number: f.flight_number, flight_code: f.code, dep_code: f.dep_code, arr_code: f.arr_code });
    });
  });
  // Sort newest first
  pending.sort((a, b) => {
    const at = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
    const bt = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
    return bt - at;
  });
  return pending;
}

function _updateCrewTabBadge(count) {
  // Update inbox icon badge
  const badge = document.getElementById('crew-inbox-count');
  if (badge) {
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
  // Also update the inbox dropdown content if it's open
  const dropdown = document.getElementById('crew-inbox-dropdown');
  if (dropdown && dropdown.style.display !== 'none') {
    _renderCrewInboxList();
  }
}

function _renderCrewInboxList() {
  const list = document.getElementById('crew-inbox-list');
  if (!list) return;
  const pending = _getCrewPendingRequests();
  if (!pending.length) {
    list.innerHTML = '<div style="padding:16px 10px;font-family:var(--mono);font-size:11px;color:var(--dim);text-align:center">No pending requests</div>';
    return;
  }
  list.innerHTML = pending.slice(0, 10).map(r => {
    const when = r.submitted_at ? _timeAgo(new Date(r.submitted_at)) : '';
    const roleLabel = r.role_label || r.role || 'role';
    return `
      <div onclick="switchPage('crew-requests');closeCrewInbox()" style="padding:10px 10px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s"
           onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='none'">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:6px;height:6px;border-radius:50%;background:#e8001c;flex-shrink:0"></span>
          <span style="font-family:var(--mono);font-size:11px;color:var(--text);flex:1">${escapeHtml(r.requester_name || r.requester_id || '?')}</span>
          <span style="font-family:var(--mono);font-size:9px;color:var(--dim)">${when}</span>
        </div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--subtext);margin-top:4px;padding-left:14px">
          Removal from <strong>${escapeHtml(roleLabel)}</strong> on ${escapeHtml(r.flight_number || r.flight_code || '?')}
        </div>
        ${r.reason ? `<div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-top:3px;padding-left:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px">"${escapeHtml(r.reason)}"</div>` : ''}
      </div>`;
  }).join('') + (pending.length > 10
    ? `<div style="padding:8px 10px;font-family:var(--mono);font-size:9px;color:var(--dim);text-align:center">+ ${pending.length - 10} more</div>`
    : '');
}

function _timeAgo(date) {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function toggleCrewInbox() {
  const dd = document.getElementById('crew-inbox-dropdown');
  if (!dd) return;
  if (dd.style.display === 'none') {
    _renderCrewInboxList();
    dd.style.display = '';
  } else {
    dd.style.display = 'none';
  }
}

function closeCrewInbox() {
  const dd = document.getElementById('crew-inbox-dropdown');
  if (dd) dd.style.display = 'none';
}

// Close inbox dropdown when clicking outside
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('crew-inbox-wrap');
  if (wrap && !wrap.contains(e.target)) {
    closeCrewInbox();
  }
});

async function _crewPollForRequests() {
  try {
    const data = await apiFetch('/api/crew-management');
    const flights = Array.isArray(data.flights) ? data.flights : [];
    const newCount = flights.reduce((sum, f) =>
      sum + (f.requests || []).filter(r => r.status === 'pending').length, 0);

    _updateCrewTabBadge(newCount);

    // Show toast if new pending requests appeared (skip first load)
    if (_crewLastPendingCount >= 0 && newCount > _crewLastPendingCount) {
      const diff = newCount - _crewLastPendingCount;
      showToast(`🔔 ${diff} new crew removal request${diff > 1 ? 's' : ''} pending`, false);
    }
    _crewLastPendingCount = newCount;

    // Stash latest flights for inbox dropdown rendering
    _crewManageFlights = flights;

    // If the crew-requests page is active, silently refresh the view
    const crewPage = document.getElementById('page-crew-requests');
    if (crewPage && crewPage.style.display !== 'none') {
      applyCrewFilters();
    }
  } catch (e) { /* silent poll failure */ }
}

function startCrewPolling() {
  if (_crewPollInterval) return;
  // Do an immediate check
  _crewPollForRequests();
  _crewPollInterval = setInterval(_crewPollForRequests, _CREW_POLL_INTERVAL_MS);
}

function stopCrewPolling() {
  if (_crewPollInterval) {
    clearInterval(_crewPollInterval);
    _crewPollInterval = null;
  }
}

// ─── FILTER / SORT LOGIC ──────────────────────────────────────────────────────

function applyCrewFilters() {
  const statusFilter = document.getElementById('crew-filter-status')?.value || 'active';
  const requestFilter = document.getElementById('crew-filter-requests')?.value || 'all';
  const sortMode = document.getElementById('crew-sort')?.value || 'newest';
  const searchRaw = (document.getElementById('crew-search')?.value || '').trim().toLowerCase();

  let filtered = [..._crewManageFlights];

  // 1. Flight status filter
  if (statusFilter === 'active') {
    filtered = filtered.filter(f => f.status && f.status !== 'Ended');
  } else if (statusFilter === 'ended') {
    filtered = filtered.filter(f => f.status === 'Ended');
  }

  // 2. Request filter
  if (requestFilter === 'pending') {
    filtered = filtered.filter(f => (f.requests || []).some(r => r.status === 'pending'));
  } else if (requestFilter === 'has-requests') {
    filtered = filtered.filter(f => (f.requests || []).length > 0);
  } else if (requestFilter === 'no-requests') {
    filtered = filtered.filter(f => (f.requests || []).length === 0);
  }

  // 3. Text search
  if (searchRaw) {
    filtered = filtered.filter(f => {
      const haystack = [
        f.flight_number, f.code, f.dep_code, f.arr_code, f.status, f.dep_date,
        ...(f.requests || []).map(r => r.requester_name || r.requester_id || ''),
        ...(f.requests || []).map(r => r.reason || ''),
      ].join(' ').toLowerCase();
      return haystack.includes(searchRaw);
    });
  }

  // 4. Sort
  filtered.sort((a, b) => {
    if (sortMode === 'pending-first') {
      const aPending = (a.requests || []).filter(r => r.status === 'pending').length;
      const bPending = (b.requests || []).filter(r => r.status === 'pending').length;
      if (bPending !== aPending) return bPending - aPending;
    }
    if (sortMode === 'flight-date') {
      // Parse DDMMYYYY to comparable value
      const parseDate = (raw) => {
        if (!raw || raw.length !== 8) return 0;
        return parseInt(raw.slice(4, 8) + raw.slice(2, 4) + raw.slice(0, 2), 10);
      };
      return parseDate(b.dep_date) - parseDate(a.dep_date);
    }
    if (sortMode === 'oldest') {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return aTime - bTime;
    }
    // Default: newest first
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  });

  // Update counter
  const countEl = document.getElementById('crew-filter-count');
  if (countEl) {
    const total = _crewManageFlights.length;
    countEl.textContent = filtered.length === total
      ? `${total} flight${total !== 1 ? 's' : ''}`
      : `${filtered.length} of ${total} flight${total !== 1 ? 's' : ''}`;
  }

  // Render with the filtered list
  _renderCrewManagementFlightsFiltered(filtered);
}

function _renderCrewManagementFlightsFiltered(flights) {
  const list = document.getElementById('crew-removal-request-list');
  const badge = document.getElementById('crew-removal-request-badge');
  if (!list) return;

  const pendingCount = _getCrewPendingCount(_crewManageFlights);  // badge always reflects ALL data
  if (badge) {
    badge.textContent = pendingCount > 0 ? `${pendingCount} pending` : '';
    badge.style.display = pendingCount > 0 ? '' : 'none';
  }
  _updateCrewTabBadge(pendingCount);

  if (!flights.length) {
    list.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--dim);padding:4px 0">No flights match the current filters</div>';
    return;
  }

  list.innerHTML = flights.map(flight => {
    const requests = Array.isArray(flight.requests) ? flight.requests : [];
    const requestHtml = requests.length
      ? requests.map(_crewManageRequestCard).join('')
      : '<div style="font-family:var(--mono);font-size:10px;color:var(--dim)">No removal requests for this flight</div>';
    const roleRows = _crewManageRoleDefs().map(roleDef => _crewManageRoleRow(flight, roleDef)).join('');
    return `
      <div style="background:var(--surface);border:1px solid var(--border);padding:14px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-family:var(--mono);font-size:12px;color:var(--text)"><strong>${escapeHtml(flight.flight_number || flight.code)}</strong> <span style="color:var(--accent)">(${escapeHtml(flight.code)})</span></div>
            <div style="font-family:var(--mono);font-size:10px;color:var(--subtext);margin-top:3px">${escapeHtml(_crewManageFlightSubtitle(flight))}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${flight.can_change_host ? `<button class="action-btn" onclick="openChangeHostModal('${escapeHtml(flight.code)}','${escapeHtml(flight.host_user_id || '')}')">Change Host</button>` : ''}
            <a class="action-btn" href="/dashboard/${encodeURIComponent(flight.code)}" style="text-decoration:none">Open Flight</a>
          </div>
        </div>

        <div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--subtext);letter-spacing:.08em;margin-bottom:6px">CURRENT CREW</div>
          ${roleRows}
        </div>
        <div style="display:flex;justify-content:flex-end">
          <button class="action-btn" onclick="openCrewAddModal('${escapeHtml(flight.code)}')">Add Crew</button>
        </div>

        <div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--subtext);letter-spacing:.08em;margin-bottom:6px">REMOVAL REQUESTS</div>
          <div style="display:grid;gap:8px">${requestHtml}</div>
        </div>
      </div>`;
  }).join('');
}

function _crewManageRoleDefs() {
  return CREW_SLOT_DEFS.filter(def => !['host', 'cohost'].includes(def.key));
}

function _crewManageAssignedList(crew, role) {
  const val = crew?.[role];
  if (Array.isArray(val)) return val;
  return val && val.id ? [val] : [];
}

function _crewManageRoleLabel(role) {
  const def = CREW_SLOT_DEFS.find(item => item.key === role);
  return def ? def.label : role;
}

function _crewManageFlightSubtitle(flight) {
  return `${flight.dep_code || '?'} -> ${flight.arr_code || '?'} | ${flight.dep_date || '?'} | ${flight.status || 'N/A'}`;
}

function _crewManageRequestCard(req) {
  const statusColor = { pending: '#f0b232', approved: 'var(--green)', denied: 'var(--red)' };
  const when = req.submitted_at ? new Date(req.submitted_at).toLocaleString() : '?';
  const reviewedAt = req.reviewed_at ? new Date(req.reviewed_at) : null;
  const reviewedLabel = reviewedAt && !Number.isNaN(reviewedAt.getTime()) ? ` on ${escapeHtml(reviewedAt.toLocaleString())}` : '';
  const noteLine = req.status === 'denied' && req.denial_note
    ? `<div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-top:4px">Denial note: ${escapeHtml(req.denial_note)}</div>`
    : '';
  const reviewLine = req.reviewed_by
    ? `<div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-top:4px">Reviewed by ${escapeHtml(req.reviewed_by)}${reviewedLabel}</div>`
    : '';
  return `
    <div style="background:var(--bg);border:1px solid var(--border);border-left:3px solid ${statusColor[req.status] || 'var(--dim)'};padding:10px 12px;display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <div style="font-family:var(--mono);font-size:11px;color:var(--text)">${escapeHtml(req.requester_name || req.requester_id)} requested removal from <strong>${escapeHtml(req.role_label || req.role || 'role')}</strong></div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--subtext);margin-top:3px">${when}</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--text);margin-top:8px;line-height:1.6">${escapeHtml(req.reason || 'No reason provided')}</div>
        ${noteLine}
        ${reviewLine}
      </div>
      <span style="font-family:var(--mono);font-size:9px;padding:2px 7px;border:1px solid ${statusColor[req.status] || 'var(--dim)'};color:${statusColor[req.status] || 'var(--dim)'}">${escapeHtml((req.status || 'unknown').toUpperCase())}</span>
      ${req.status === 'pending' ? `
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="action-btn" style="color:var(--green);border-color:var(--green);font-size:9px;padding:3px 10px"
                  onclick="approveCrewRemovalRequest('${escapeHtml(req.request_id || '')}')">Approve</button>
          <button class="action-btn" style="color:var(--red);border-color:var(--red);font-size:9px;padding:3px 10px"
                  onclick="denyCrewRemovalRequest('${escapeHtml(req.request_id || '')}')">Deny</button>
        </div>` : ''}
    </div>`;
}

function _crewManageRoleRow(flight, roleDef) {
  const assigned = _crewManageAssignedList(flight.crew, roleDef.key);
  const chips = assigned.length
    ? assigned.map(member => `
        <span style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--surface);padding:4px 8px;font-family:var(--mono);font-size:10px;color:var(--text)">
          ${escapeHtml(member.name || member.id || '?')}
          <button onclick="removeCrewMember('${escapeHtml(flight.code)}','${escapeHtml(roleDef.key)}','${escapeHtml(member.id || '')}')"
                  style="background:none;border:none;color:var(--red);cursor:pointer;font-family:var(--mono);font-size:10px;padding:0">x</button>
        </span>`)
      .join('')
    : '<span style="font-family:var(--mono);font-size:10px;color:var(--dim)">Nobody assigned</span>';

  return `
    <div style="display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="font-family:var(--mono);font-size:10px;color:var(--subtext)">${escapeHtml(roleDef.label)} <span style="color:var(--dim)">(${assigned.length}/${roleDef.max == null ? '∞' : roleDef.max})</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${chips}</div>
    </div>`;
}

function _renderCrewManagementFlights() {
  // Delegate to the filter/sort system which handles rendering
  applyCrewFilters();
}

async function loadCrewRemovalRequests() {
  const list = document.getElementById('crew-removal-request-list');
  if (!list) return;
  list.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--dim)">Loading crew management...</div>';
  try {
    const data = await apiFetch('/api/crew-management');
    _crewManageFlights = Array.isArray(data.flights) ? data.flights : [];
    const newCount = _getCrewPendingCount(_crewManageFlights);
    if (_crewLastPendingCount < 0) _crewLastPendingCount = newCount;  // initialize on first load
    _updateCrewTabBadge(newCount);
    applyCrewFilters();
  } catch (e) {
    list.innerHTML = `<div style="font-family:var(--mono);font-size:11px;color:var(--red)">Error: ${escapeHtml(e.message)}</div>`;
  }
}

async function approveCrewRemovalRequest(reqId) {
  try {
    const res = await apiFetch(`/api/crew-removal-requests/${reqId}/approve`, 'POST', {});
    showToast(res.removed ? 'Crew member removed' : 'Request approved');
    loadCrewRemovalRequests();
    if (currentCode) loadCrewPanel(currentCode, [...allFlights, ...endedFlights].find(x => x.code === currentCode));
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

async function denyCrewRemovalRequest(reqId) {
  const note = prompt('Optional denial note:', '') || '';
  try {
    await apiFetch(`/api/crew-removal-requests/${reqId}/deny`, 'POST', { note });
    showToast('Request denied');
    loadCrewRemovalRequests();
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

function openCrewAddModal(code) {
  _crewManageAddTarget = code;
  const roleEl = document.getElementById('crm-modal-role');
  const userIdEl = document.getElementById('crm-modal-userid');
  const targetEl = document.getElementById('crm-modal-target');
  if (roleEl) {
    roleEl.innerHTML = _crewManageRoleDefs().map(roleDef =>
      `<option value="${escapeHtml(roleDef.key)}">${escapeHtml(roleDef.label)}</option>`
    ).join('');
  }
  if (userIdEl) userIdEl.value = '';
  if (targetEl) targetEl.textContent = code || '—';
  openMiniModal('crmadd');
  setTimeout(() => document.getElementById('crm-modal-userid')?.focus(), 80);
}

async function submitCrewAddModal() {
  const code = _crewManageAddTarget;
  const roleEl = document.getElementById('crm-modal-role');
  const userIdEl = document.getElementById('crm-modal-userid');
  if (!code || !roleEl || !userIdEl || !userIdEl.value.trim()) {
    showToast('Enter a user ID first', true);
    return;
  }
  try {
    await apiFetch(`/api/flights/${code}/crew`, 'POST', {
      action: 'assign',
      role: roleEl.value,
      user_id: userIdEl.value.trim(),
    });
    closeMiniModal('crmadd');
    showToast('Crew updated');
    await loadCrewRemovalRequests();
    if (currentCode === code) loadCrewPanel(currentCode, [...allFlights, ...endedFlights].find(x => x.code === currentCode));
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

async function removeCrewMember(code, role, userId) {
  try {
    await apiFetch(`/api/flights/${code}/crew`, 'POST', {
      action: 'remove',
      role,
      user_id: userId,
    });
    showToast('Crew member removed');
    await loadCrewRemovalRequests();
    if (currentCode === code) loadCrewPanel(currentCode, [...allFlights, ...endedFlights].find(x => x.code === currentCode));
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

let _changeHostCode = '';
async function openChangeHostModal(code, currentHostId) {
  _changeHostCode = code;
  const select = document.getElementById('chost-member');
  const target = document.getElementById('chost-target');
  if (target) target.textContent = code;
  if (select) select.innerHTML = '<option value="">Loading members…</option>';
  openMiniModal('chost');
  try {
    const data = await apiFetch('/api/crew-members');
    const members = (data.members || []).filter(m => m.is_hoster);
    select.innerHTML = members.map(m => `<option value="${escapeHtml(m.user_id)}" ${String(m.user_id) === String(currentHostId) ? 'selected' : ''}>${escapeHtml(m.username)} (${escapeHtml(m.user_id)})</option>`).join('');
  } catch (e) { showToast('Could not load hosts: ' + e.message, true); }
}

async function submitChangeHost() {
  const select = document.getElementById('chost-member');
  if (!_changeHostCode || !select?.value) return showToast('Select a host', true);
  try {
    const result = await apiFetch(`/api/flights/${_changeHostCode}/host`, 'PATCH', {host_user_id: select.value});
    closeMiniModal('chost');
    showToast(`Host changed to ${result.host_name}`);
    await loadCrewRemovalRequests();
  } catch (e) { showToast('Error: ' + e.message, true); }
}



