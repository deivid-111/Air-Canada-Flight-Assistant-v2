// ─── DIAGNOSTICS ──────────────────────────────────────────────────────────────
async function loadDiagnostics() {
  const body = document.getElementById('dbg-body');
  body.innerHTML = '<div class="dbg-loading">↻ Fetching live data from bot…</div>';
  let d;
  try {
    d = await apiFetch('/api/debug');
  } catch(e) {
    logError('diag', e);
    body.innerHTML = `<div class="dbg-loading" style="color:var(--red)">⚠ ${escapeHtml(e.message)}</div>`;
    return;
  }

  function row(key, val, cls='') {
    return `<div class="dbg-row"><span class="dbg-key">${key}</span><span class="dbg-val ${cls}">${escapeHtml(String(val ?? '—'))}</span></div>`;
  }
  function badge(ok, okLabel='OK', failLabel='FAIL') {
    return ok
      ? `<span class="dbg-badge ok">${okLabel}</span>`
      : `<span class="dbg-badge error">${failLabel}</span>`;
  }
  function currentAssetInfo() {
    const scripts = [...document.querySelectorAll('script[src]')];
    const staticScripts = scripts
      .map(s => s.getAttribute('src') || '')
      .filter(src => src.includes('/static/'));
    const rows = staticScripts.map(src => {
      try {
        const url = new URL(src, window.location.origin);
        const file = url.pathname.split('/').pop() || url.pathname;
        const version = url.searchParams.get('v') || 'none';
        return { file, version, full: `${url.pathname}${url.search}` };
      } catch (_) {
        return { file: src, version: 'unknown', full: src };
      }
    });
    const versions = [...new Set(rows.map(r => r.version))];
    return { rows, versions };
  }

  // ── Bot card ─────────────────────────────────────────────────────────────────
  const bot = d.bot;
  const latOk = bot.latency_ms != null && bot.latency_ms < 200;
  let botHtml = `
    <div class="dbg-card">
      <div class="dbg-card-title">Bot Connection ${badge(bot.logged_in, 'ONLINE', 'OFFLINE')}</div>
      ${row('Logged in',      bot.logged_in ? '✓ Yes' : '✗ No', bot.logged_in ? 'ok' : 'error')}
      ${row('Bot name',       bot.bot_name)}
      ${row('Bot ID',         bot.bot_id)}
      ${row('Ready',          bot.is_ready ? '✓ Yes' : '✗ No', bot.is_ready ? 'ok' : 'warn')}
      ${row('Closed',         bot.is_closed ? '⚠ Yes' : '✓ No', bot.is_closed ? 'error' : 'ok')}
      ${row('Latency',        bot.latency_ms != null ? bot.latency_ms + ' ms' : '—', latOk ? 'ok' : bot.latency_ms > 400 ? 'error' : 'warn')}
      ${row('Guilds visible', bot.guild_count, bot.guild_count > 0 ? 'ok' : 'error')}
      ${row('Online members', d.online_members != null ? d.online_members : '—')}
    </div>`;

  // ── Latency trend card ───────────────────────────────────────────────────────
  const trend = d.latency_trend || [];
  let trendHtml = `<div class="dbg-card"><div class="dbg-card-title">Latency Trend (last ${trend.length} readings)</div>`;
  if (!trend.length) {
    trendHtml += `<div class="dbg-row"><span class="dbg-val" style="color:var(--dim)">No readings yet — recorded every minute</span></div>`;
  } else {
    const maxMs = Math.max(...trend.map(t => t.ms), 1);
    trendHtml += `<div style="display:flex;align-items:flex-end;gap:3px;height:60px;padding:8px 0">`;
    trend.forEach(t => {
      const h = Math.max(4, Math.round((t.ms / maxMs) * 52));
      const color = t.ms < 200 ? 'var(--green)' : t.ms < 400 ? 'var(--yellow)' : 'var(--red)';
      trendHtml += `<div title="${t.t}: ${t.ms}ms" style="flex:1;height:${h}px;background:${color};border-radius:2px 2px 0 0;min-width:6px;cursor:default"></div>`;
    });
    trendHtml += `</div>`;
    const avg = Math.round(trend.reduce((s,t)=>s+t.ms,0)/trend.length);
    const min = Math.min(...trend.map(t=>t.ms));
    const max = Math.max(...trend.map(t=>t.ms));
    trendHtml += row('Avg', avg + ' ms', avg < 200 ? 'ok' : 'warn');
    trendHtml += row('Min', min + ' ms', 'ok');
    trendHtml += row('Max', max + ' ms', max > 400 ? 'error' : max > 200 ? 'warn' : 'ok');
  }
  trendHtml += `</div>`;

  // ── Channel health card ──────────────────────────────────────────────────────
  const ch = d.channel_health || {};
  let chHtml = `<div class="dbg-card"><div class="dbg-card-title">Channel Reachability</div>`;
  ['log','public','announce'].forEach(label => {
    const c = ch[label] || {};
    const ok = c.reachable;
    const name = c.name ? `#${c.name}` : `ID ${c.id}`;
    const detail = c.reason || (ok ? '✓ Read + Send OK' : `read:${c.can_read?'✓':'✗'} send:${c.can_send?'✓':'✗'}`);
    chHtml += row(label.toUpperCase() + ' channel', `${name} — ${detail}`, ok ? 'ok' : 'error');
  });
  chHtml += `</div>`;

  // ── Background tasks ─────────────────────────────────────────────────────────
  const tasks = d.tasks || {};
  const lastFired = d.tasks_last_fired || {};
  let tasksHtml = `<div class="dbg-card"><div class="dbg-card-title">Background Tasks</div>`;
  Object.entries(tasks).forEach(([name, t]) => {
    const next = t.next_iteration ? new Date(t.next_iteration).toLocaleTimeString() : '—';
    const last = lastFired[name] ? new Date(lastFired[name]).toLocaleTimeString() : 'never';
    tasksHtml += `<div class="dbg-row" style="flex-direction:column;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;width:100%;gap:8px;align-items:center">
        <span class="dbg-key" style="flex:1">${name.replace(/_/g,' ')}</span>
        <span class="dbg-val ${t.running ? 'ok' : 'error'}">${t.running ? '✓ Running' : '✗ Stopped'}</span>
      </div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-top:2px">
        last fired: ${last} &nbsp;·&nbsp; next: ${next}
      </div>
    </div>`;
  });
  tasksHtml += `</div>`;

  // ── Active sessions card ─────────────────────────────────────────────────────
  const sessions = d.sessions || [];
  const blocklist = d.blocklist || [];
  let sessionsHtml = `<div class="dbg-card" style="grid-column:1/-1">
    <div class="dbg-card-title">Active Sessions (${sessions.length})${blocklist.length ? ` <span class="dbg-badge error">${blocklist.length} BLOCKED</span>` : ''}</div>`;
  if (!sessions.length) {
    sessionsHtml += `<div class="dbg-row"><span class="dbg-val" style="color:var(--dim)">No active sessions tracked</span></div>`;
  } else {
    sessions.forEach(s => {
      const roleColor = s.role === 'owner' ? 'var(--accent)' : s.role === 'manager' ? 'var(--blue)' : 'var(--green)';
      const idleStr = s.idle_minutes < 2 ? 'just now' : s.idle_minutes < 60 ? `${s.idle_minutes}m ago` : `${Math.round(s.idle_minutes/60)}h ago`;
      sessionsHtml += `<div class="dbg-row" style="flex-wrap:wrap;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-family:var(--mono);font-size:11px;color:var(--text);min-width:120px">${escapeHtml(s.username)}</span>
        <span style="font-family:var(--mono);font-size:10px;color:${roleColor};min-width:60px">${(s.role||'').toUpperCase()}</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--subtext);flex:1">
          Last seen: ${idleStr} &nbsp;|&nbsp; Session: ${s.session_age_h}h old &nbsp;|&nbsp; ID: ${s.user_id}
        </span>
        <button onclick="revokeSession('${s.user_id}','${escapeHtml(s.username)}')" style="font-family:var(--mono);font-size:10px;padding:3px 8px;background:var(--red);color:#fff;border:none;cursor:pointer;opacity:.7">FORCE LOGOUT</button>
      </div>`;
    });
  }
  // Blocklist viewer
  if (blocklist.length) {
    sessionsHtml += `<div class="dbg-card-title" style="margin-top:1rem">Blocklist (${blocklist.length})</div>`;
    blocklist.forEach(uid => {
      sessionsHtml += `<div class="dbg-row" style="gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-family:var(--mono);font-size:11px;color:var(--dim);flex:1">${uid} <span class="dbg-badge error">BLOCKED</span></span>
        <button onclick="unblockSession('${uid}','${uid}')" style="font-family:var(--mono);font-size:10px;padding:3px 8px;background:var(--green);color:#fff;border:none;cursor:pointer">UNBLOCK</button>
      </div>`;
    });
  }
  sessionsHtml += `</div>`;

  // ── Failed logins card ───────────────────────────────────────────────────────
  const failedLogins = d.failed_logins || [];
  let failedHtml = `<div class="dbg-card"><div class="dbg-card-title">Failed/Denied Logins (last hour, ${failedLogins.length})</div>`;
  if (!failedLogins.length) {
    failedHtml += `<div class="dbg-row"><span class="dbg-val ok">✓ None</span></div>`;
  } else {
    failedLogins.slice(-20).forEach(l => {
      failedHtml += `<div class="dbg-row" style="flex-direction:column;align-items:flex-start;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="font-family:var(--mono);font-size:9px;color:var(--dim)">[${escapeHtml(l.time||'')}] ${escapeHtml(l.user||'system')}</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--red)">${escapeHtml(l.action||'')}</span>
      </div>`;
    });
  }
  failedHtml += `</div>`;

  // ── System card ───────────────────────────────────────────────────────────────
  const sys = d.system || {};
  const memOk  = typeof sys.mem_rss_mb === 'number' && sys.mem_rss_mb < 500;
  const diskOk = typeof sys.disk_pct   === 'number' && sys.disk_pct   < 85;
  const cpuOk  = typeof sys.cpu_pct    === 'number' && sys.cpu_pct    < 80;
  let sysHtml = `
    <div class="dbg-card">
      <div class="dbg-card-title">System Resources</div>
      ${row('Platform',        sys.platform_full || sys.os)}
      ${row('Hostname',        sys.platform_node)}
      ${row('Architecture',    sys.platform_machine)}
      ${row('Python',          (sys.python_version||'') + ' (' + (sys.python_impl||'CPython') + ')')}
      ${row('Python build',    sys.python_build)}
      ${row('PID',             sys.pid)}
      ${row('Threads',         sys.threads)}
      ${row('Open files',      sys.open_files)}
      ${row('Process started', sys.process_start ? new Date(sys.process_start).toLocaleString() : '—')}
      ${row('Process uptime',  sys.process_uptime_h != null ? sys.process_uptime_h + 'h' : '—')}
      ${row('System uptime',   sys.uptime)}
      ${row('RSS memory',      sys.mem_rss_mb != null ? sys.mem_rss_mb + ' MB (' + (sys.mem_percent||'?') + '%)' : (sys.mem_mb||'—'), memOk ? 'ok' : 'warn')}
      ${row('Virtual memory',  sys.mem_vms_mb != null ? sys.mem_vms_mb + ' MB' : '—')}
      ${row('CPU (system)',     sys.cpu_pct    != null ? sys.cpu_pct    + '%'  : '—', cpuOk ? 'ok' : 'warn')}
      ${row('CPU (process)',    sys.cpu_pct_proc != null ? sys.cpu_pct_proc + '%' : '—')}
      ${row('CPU cores',       sys.cpu_count != null ? sys.cpu_count + ' logical / ' + (sys.cpu_count_phys||'?') + ' physical' : '—')}
      ${row('CPU freq',        sys.cpu_freq_mhz != null ? sys.cpu_freq_mhz + ' MHz' : '—')}
      ${row('Disk free',       sys.disk_free_gb != null ? sys.disk_free_gb + ' GB (' + sys.disk_pct + '% used)' : '—', diskOk ? 'ok' : 'warn')}
      ${row('Net sent',        sys.net_sent_mb  != null ? sys.net_sent_mb  + ' MB' : '—')}
      ${row('Net received',    sys.net_recv_mb  != null ? sys.net_recv_mb  + ' MB' : '—')}
      ${row('Disk read',       sys.disk_read_mb  != null ? sys.disk_read_mb  + ' MB' : '—')}
      ${row('Disk written',    sys.disk_write_mb != null ? sys.disk_write_mb + ' MB' : '—')}
      ${row('Working dir',     sys.cwd)}
      ${row('Script path',     sys.script_path)}
    </div>`;

  // Network interfaces
  let netHtml = '';
  if (sys.network_interfaces && Object.keys(sys.network_interfaces).length) {
    netHtml = `<div class="dbg-card"><div class="dbg-card-title">Network Interfaces</div>`;
    Object.entries(sys.network_interfaces).forEach(([iface, addrs]) => {
      if (addrs.length) netHtml += row(iface, addrs.join(' / '));
    });
    netHtml += `</div>`;
  }

  // ── Env card ──────────────────────────────────────────────────────────────────
  const env = d.env;
  let envHtml = `
    <div class="dbg-card">
      <div class="dbg-card-title">Environment / Config</div>
      ${row('GUILD_ID',            env.GUILD_ID)}
      ${row('HOSTER_ROLE',         env.HOSTER_ROLE)}
      ${row('MANAGER_ROLE',        env.MANAGER_ROLE)}
      ${row('INTEREST_ROLE',       env.INTEREST_ROLE)}
      ${row('FLIGHT_NOTIFY_ROLE',  env.FLIGHT_NOTIFY_ROLE)}
      ${row('FLIGHT_START_ROLE',   env.FLIGHT_START_ROLE)}
      ${row('LOG_CHANNEL_ID',      env.LOG_CHANNEL_ID)}
      ${row('PUBLIC_CHANNEL_ID',   env.PUBLIC_CHANNEL_ID)}
      ${row('ANNOUNCE_CHANNEL_ID', env.ANNOUNCE_CHANNEL_ID)}
      ${row('DASHBOARD_PORT',      env.DASHBOARD_PORT)}
      ${row('DB_FILE',             env.DB_FILE)}
      ${row('LOG_FILE',            env.LOG_FILE)}
      ${row('TOKEN set',           env.TOKEN_set          ? '✓ Yes' : '✗ No', env.TOKEN_set          ? 'ok' : 'error')}
      ${row('SECRET_KEY set',      env.SECRET_KEY_set     ? '✓ Yes' : '✗ No', env.SECRET_KEY_set     ? 'ok' : 'error')}
      ${row('SECRET_KEY default',  env.SECRET_KEY_default ? '⚠ YES — CHANGE IT' : '✓ No', env.SECRET_KEY_default ? 'warn' : 'ok')}
    </div>`;

  // ── Libraries card ────────────────────────────────────────────────────────────
  const libs = d.libs || {};
  let libsHtml = `<div class="dbg-card"><div class="dbg-card-title">Library Versions</div>
    ${row('discord.py', libs.discord_py_version || '—')}
    ${row('FastAPI',    libs.fastapi_version    || '—')}
    ${row('uvicorn',    libs.uvicorn_version    || '—')}
    ${row('httpx',      libs.httpx_version      || '—')}
    ${row('aiosqlite',  libs.aiosqlite_version  || '—')}
  </div>`;

  const assetInfo = currentAssetInfo();
  const versionSummary = assetInfo.versions.length === 1 ? assetInfo.versions[0] : assetInfo.versions.join(', ');
  let assetsHtml = `<div class="dbg-card" style="grid-column:1/-1">
    <div class="dbg-card-title">Frontend Asset Versions ${badge(assetInfo.versions.length === 1, 'CONSISTENT', 'MIXED')}</div>
    ${row('Current page', window.location.pathname)}
    ${row('Loaded asset version(s)', versionSummary || '—', assetInfo.versions.length === 1 ? 'ok' : 'warn')}
    ${row('Tracking method', 'dashboard.html script ?v= query params')}
    <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px;display:grid;gap:4px">
      ${assetInfo.rows.map(r => `
        <div class="dbg-row" style="padding:4px 0">
          <span class="dbg-key">${escapeHtml(r.file)}</span>
          <span class="dbg-val ${r.version === 'none' ? 'warn' : 'ok'}">${escapeHtml(r.version)}</span>
        </div>`).join('')}
    </div>
  </div>`;

  // ── Session card ──────────────────────────────────────────────────────────────
  const sess = d.session;
  let sessHtml = `
    <div class="dbg-card">
      <div class="dbg-card-title">Your Session</div>
      ${row('User ID',    sess.user_id)}
      ${row('Username',   sess.username)}
      ${row('is_hoster',  sess.is_hoster  ? '✓ Yes' : '✗ No', sess.is_hoster  ? 'ok' : 'warn')}
      ${row('is_manager', sess.is_manager ? '✓ Yes' : '✗ No', sess.is_manager ? 'ok' : 'warn')}
      ${row('is_owner',   sess.is_owner   ? '✓ Yes' : '✗ No', sess.is_owner   ? 'ok' : 'warn')}
    </div>`;

  // ── Database card ─────────────────────────────────────────────────────────────
  const db = d.db;
  const statuses = db.flight_statuses || {};
  const statusLines = Object.entries(statuses).map(([s,c]) => `${s}: ${c}`).join(' · ');
  let dbHtml = `
    <div class="dbg-card">
      <div class="dbg-card-title">Database ${badge(db.db_exists)}</div>
      ${row('File',             db.db_file)}
      ${row('Exists',           db.db_exists ? '✓ Yes' : '✗ No', db.db_exists ? 'ok' : 'error')}
      ${row('Size',             db.db_size_kb + ' KB')}
      ${row('Total keys',       db.total_keys)}
      ${row('Total flights',    db.flight_count)}
      ${row('Active flights',   db.active_count, db.active_count > 0 ? 'ok' : '')}
      ${row('Ended flights',    db.ended_count)}
      ${row('Status breakdown', statusLines || '—')}
      ${row('Unique hosts',     db.unique_hosts     ?? '—')}
      ${row('Unique routes',    db.unique_routes    ?? '—')}
      ${row('Unique aircraft',  db.unique_aircraft  ?? '—')}
      ${row('Flights with pax', db.flights_with_pax ?? '—')}
      ${row('Total passengers', db.total_pax        ?? '—')}
      ${row('Oldest flight',    db.oldest_flight_date || '—')}
      ${row('Newest flight',    db.newest_flight_date || '—')}
      ${row('Day msgs tracked', db.day_msgs_tracked ?? '—')}
      ${row('Blocklist size',   db.blocklist_size   ?? '—')}
      ${row('Log file',         db.log_exists ? '✓ exists' : '✗ not found', db.log_exists ? 'ok' : 'warn')}
      ${row('Log size',         db.log_size_kb != null ? db.log_size_kb + ' KB' : '—')}
      ${row('Log lines',        db.log_lines ?? '—')}
    </div>`;

  // ── Log summary ────────────────────────────────────────────────────────────────
  const ls = d.log_summary || {};
  let logSumHtml = `<div class="dbg-card"><div class="dbg-card-title">Log Summary (last 1000 entries)</div>
    ${row('✓ Success',  ls.ok    || 0, 'ok')}
    ${row('ℹ Info',     ls.info  || 0)}
    ${row('⚠ Warnings', ls.warn  || 0, (ls.warn  || 0) > 0 ? 'warn'  : '')}
    ${row('✗ Errors',   ls.error || 0, (ls.error || 0) > 0 ? 'error' : 'ok')}
  </div>`;

  // ── Day messages board ─────────────────────────────────────────────────────────
  const dayMsgs = d.day_msgs || [];
  let dayMsgsHtml = `<div class="dbg-card"><div class="dbg-card-title">Flight Board Messages (${dayMsgs.length})</div>`;
  if (!dayMsgs.length) {
    dayMsgsHtml += `<div class="dbg-row"><span class="dbg-val" style="color:var(--dim)">No day messages tracked</span></div>`;
  } else {
    dayMsgs.forEach(m => {
      const cls = m.is_past ? 'error' : m.is_today ? 'ok' : '';
      const tag = m.is_past ? ' [STALE]' : m.is_today ? ' [TODAY]' : ' [FUTURE]';
      dayMsgsHtml += row(m.date_fmt + tag, `msg: ${m.msg_id}`, cls);
    });
  }
  dayMsgsHtml += `</div>`;

  // ── Roles card ─────────────────────────────────────────────────────────────────
  let rolesHtml = '';
  if (d.roles && Object.keys(d.roles).length) {
    rolesHtml = `<div class="dbg-card"><div class="dbg-card-title">Role Resolution (target guild)</div>
      ${Object.entries(d.roles).map(([k,v]) =>
        row(k, v.found ? `✓ ${v.name} (${v.id})` : `✗ NOT FOUND (${v.id})`, v.found ? 'ok' : 'error')
      ).join('')}
    </div>`;
  } else {
    rolesHtml = `<div class="dbg-card">
      <div class="dbg-card-title">Role Resolution <span class="dbg-badge error">TARGET GUILD NOT FOUND</span></div>
      <div class="dbg-row"><span style="color:var(--red)">Bot cannot see guild ID ${escapeHtml(env.GUILD_ID)}</span></div>
    </div>`;
  }

  // ── Recent errors ──────────────────────────────────────────────────────────────
  let errorsHtml = '';
  if (d.recent_errors && d.recent_errors.length) {
    errorsHtml = `<div class="dbg-card" style="grid-column:1/-1">
      <div class="dbg-card-title">⚠ Recent Errors (${d.recent_errors.length})</div>`;
    d.recent_errors.forEach(e => {
      errorsHtml += `<div class="dbg-row" style="flex-direction:column;align-items:flex-start;gap:2px">
        <span class="dbg-key" style="color:var(--red)">[${escapeHtml(e.time||'')}] ${escapeHtml(e.user||'')}</span>
        <span class="dbg-val" style="color:var(--text);font-size:10px;text-align:left">${escapeHtml(e.action||'')}</span>
      </div>`;
    });
    errorsHtml += `</div>`;
  } else {
    errorsHtml = `<div class="dbg-card"><div class="dbg-card-title">Recent Errors</div>
      <div class="dbg-row"><span class="dbg-val ok">✓ No recent errors in log</span></div></div>`;
  }

  // ── Recent activity feed ───────────────────────────────────────────────────────
  let recentLogsHtml = `<div class="dbg-card" style="grid-column:1/-1">
    <div class="dbg-card-title">Recent Activity (last 20 log entries)</div>`;
  const allLogsArr = d.recent_logs || [];
  if (!allLogsArr.length) {
    recentLogsHtml += `<div class="dbg-row"><span class="dbg-val" style="color:var(--dim)">No log entries yet</span></div>`;
  } else {
    allLogsArr.forEach(l => {
      const lvlColor = {ok:'var(--green)',info:'var(--subtext)',warn:'var(--yellow)',error:'var(--red)'}[l.level||'info'] || 'var(--subtext)';
      recentLogsHtml += `<div class="dbg-row" style="gap:12px">
        <span style="font-family:var(--mono);font-size:9px;color:var(--dim);min-width:55px">${escapeHtml(l.time||'')}</span>
        <span style="font-family:var(--mono);font-size:9px;color:${lvlColor};min-width:40px;text-transform:uppercase">${escapeHtml(l.level||'info')}</span>
        <span style="font-family:var(--mono);font-size:9px;color:var(--subtext);min-width:80px">${escapeHtml(l.user||'')}</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--text);flex:1">${escapeHtml(l.action||'')}</span>
      </div>`;
    });
  }
  recentLogsHtml += `</div>`;

  // ── Guilds card ────────────────────────────────────────────────────────────────
  let guildsHtml = `<div class="dbg-card" style="grid-column:1/-1">
    <div class="dbg-card-title">Guilds the Bot Can See (${d.guilds.length})</div>`;
  if (!d.guilds.length) {
    guildsHtml += `<div class="dbg-row"><span style="color:var(--red)">⚠ Bot is not in any guild</span></div>`;
  } else {
    d.guilds.forEach(g => {
      const target = g.is_target_guild;
      guildsHtml += `
        <div class="dbg-row ${target?'dbg-target':''}" style="flex-wrap:wrap;gap:.5rem;padding:8px 0;border-bottom:1px solid var(--border)">
          <span class="dbg-key" style="min-width:160px">
            ${g.icon_url ? `<img src="${g.icon_url}" style="width:18px;height:18px;border-radius:50%;vertical-align:middle;margin-right:6px">` : ''}
            <span class="dbg-guild-name">${escapeHtml(g.name)}</span>
            ${target ? '<span class="dbg-badge ok" style="margin-left:6px">TARGET</span>' : ''}
          </span>
          <span class="dbg-val" style="text-align:left;flex:1;min-width:240px;font-size:10px;line-height:1.9">
            ID: ${g.id} &nbsp;·&nbsp; Owner: ${g.owner_id||'?'} &nbsp;·&nbsp; ${g.member_count} members<br>
            Boost: Level ${g.boost_level||0} (${g.boost_count||0} boosts) &nbsp;·&nbsp; Verification: ${g.verified||'?'}<br>
            Channels: ${g.text_channels||0} text · ${g.voice_channels||0} voice · ${g.categories||0} categories &nbsp;·&nbsp; Roles: ${g.total_roles||0}<br>
            Hosters: ${g.hoster_member_count??'?'} &nbsp;·&nbsp; Managers: ${g.manager_member_count??'?'}<br>
            Created: ${g.created_at ? new Date(g.created_at).toLocaleDateString() : '?'}<br>
            <span style="color:var(--dim)">
              log: ${g.channels.log.found ? '✓ #'+g.channels.log.name : '✗ NOT FOUND'} &nbsp;·&nbsp;
              public: ${g.channels.public.found ? '✓ #'+g.channels.public.name : '✗ NOT FOUND'} &nbsp;·&nbsp;
              announce: ${g.channels.announce.found ? '✓ #'+g.channels.announce.name : '✗ NOT FOUND'}
            </span>
          </span>
        </div>`;
    });
  }
  // ── Ping Stats ─────────────────────────────────────────────────────────────────
  let pingsHtml = `<div class="dbg-card" style="grid-column:1/-1"><div class="dbg-card-title">User Ping Stats</div>`;
  const pStats = d.ping_stats;
  if (!Array.isArray(pStats)) {
    pingsHtml += `<div class="dbg-row"><span class="dbg-val" style="color:var(--dim)">Waiting for backend...</span></div>`;
  } else {
    pStats.forEach(u => {
      const avatarHtml = u.avatar 
        ? `<img src="${escapeHtml(u.avatar)}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">`
        : `<div style="width:24px;height:24px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--dim)">?</div>`;
      
      pingsHtml += `<div class="dbg-row" style="align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)">
        ${avatarHtml}
        <span class="dbg-key" style="flex:1;font-size:13px">${escapeHtml(u.username)} <span style="font-size:10px;color:var(--dim);margin-left:6px">${u.user_id}</span></span>
        <span class="dbg-val ok" style="font-size:14px;font-weight:600">${u.count} <span style="font-size:10px;color:var(--dim);font-weight:normal">pings</span></span>
      </div>`;
    });
  }
  pingsHtml += `</div>`;

  guildsHtml += `</div>`;

  // ── Meal Week Rotation card ────────────────────────────────────────────────
  const _MEAL_MENUS = {
    A: { items: ['Smoked Salmon Root Vegetable Salad', 'American Burger with Fries or Chips', 'Roasted Lamb Rack with mint oil and side salad'] },
    B: { items: ['Caesar Salad with grilled chicken', 'Creamy Chicken Alfredo Pasta', 'Beef Lasagna with garlic bread'] },
    C: { items: ['Shrimp Cocktail Salad', 'Teriyaki Chicken with jasmine rice', 'Mushroom Ravioli in truffle cream sauce'] },
    D: { items: ['Burrata and cherry tomato salad', 'Herb-crusted salmon with roasted potatoes', "Shepherd's pie with rosemary gravy"] },
  };
  const _isoWeek = (() => {
    const now = new Date();
    const jan4 = new Date(now.getFullYear(), 0, 4);
    const startOfWeek1 = new Date(jan4);
    startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    return Math.floor((now - startOfWeek1) / (7 * 864e5)) + 1;
  })();
  const _weekLetter = ['A','B','C','D'][(_isoWeek - 1) % 4];
  const _nextLetter = ['A','B','C','D'][_isoWeek % 4];
  // Days until next Monday (start of next week)
  const _today = new Date();
  const _daysUntilMonday = ((8 - _today.getDay()) % 7) || 7;
  const _nextChange = new Date(_today); _nextChange.setDate(_today.getDate() + _daysUntilMonday);
  const _nextChangeStr = _nextChange.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
  const _weekColors = { A:'#e67e22', B:'#2980b9', C:'#27ae60', D:'#8e44ad' };
  const _wColor = _weekColors[_weekLetter];
  let mealWeekHtml = `
    <div class="dbg-card">
      <div class="dbg-card-title">
        🍽 Meal Rotation
        <span class="dbg-badge ok" style="background:${_wColor};font-size:13px;padding:4px 14px;letter-spacing:.12em">WEEK ${_weekLetter}</span>
      </div>
      ${row('ISO week number', `Week ${_isoWeek} of ${new Date().getFullYear()}`)}
      ${row('Active cycle', `Week ${_weekLetter}`, 'ok')}
      ${row('Next cycle', `Week ${_nextLetter} — starting ${_nextChangeStr}`)}
      <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
        <div style="font-family:var(--mono);font-size:9px;color:var(--subtext);letter-spacing:.08em;margin-bottom:8px">THIS WEEK'S MENU</div>
        ${_MEAL_MENUS[_weekLetter].items.map((item, i) =>
          `<div class="dbg-row" style="padding:5px 0;border-bottom:1px solid var(--border)">
            <span class="dbg-key" style="color:var(--dim)">${['Starter','Main','Dessert/Alt'][i] || 'Option ' + (i+1)}</span>
            <span class="dbg-val" style="color:var(--text)">${escapeHtml(item)}</span>
          </div>`
        ).join('')}
      </div>
      <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        ${['A','B','C','D'].map(w => `
          <div style="flex:1;min-width:100px;padding:6px 10px;border:1px solid ${w===_weekLetter ? _wColor : 'var(--border)'};
               background:${w===_weekLetter ? _wColor+'22' : 'var(--surface)'};border-radius:2px">
            <div style="font-family:var(--mono);font-size:10px;font-weight:700;color:${w===_weekLetter ? _wColor : 'var(--dim)'}">Week ${w}</div>
            <div style="font-family:var(--mono);font-size:9px;color:var(--subtext);margin-top:2px;line-height:1.5">
              ${_MEAL_MENUS[w].items.map(i => escapeHtml(i)).join('<br>')}
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  body.innerHTML = `<div class="dbg-grid">${botHtml}${trendHtml}${chHtml}${tasksHtml}${assetsHtml}${failedHtml}${sessionsHtml}${sysHtml}${netHtml}${envHtml}${libsHtml}${sessHtml}${dbHtml}${logSumHtml}${dayMsgsHtml}${rolesHtml}${errorsHtml}${recentLogsHtml}${pingsHtml}${guildsHtml}${mealWeekHtml}</div>`;

  // Load owner-only panels
  loadTestingMode();
  loadAutomation();

  // Load owner-only panels
  loadAutomation();

  // ── Guild switcher ──────────────────────────────────────────────────────────
  if (d.guilds && d.guilds.length > 1) {
    const grid = body.querySelector('.dbg-grid');
    let switcherHtml = `
      <div class="dbg-card" style="grid-column:1/-1" id="guild-switcher-card">
        <div class="dbg-card-title">⚙ Switch Active Server</div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--subtext);margin-bottom:.75rem;line-height:1.6">
          The bot is currently operating on the guild marked TARGET above.<br>
          Click a row below to switch. The change takes effect immediately (in-memory; restart resets to .env).
        </div>`;
    d.guilds.forEach(g => {
      const isTarget = g.is_target_guild;
      switcherHtml += `
        <div class="dbg-row" style="align-items:center;gap:.75rem;flex-wrap:wrap">
          <span class="dbg-key" style="flex:1;min-width:160px">
            <span class="dbg-guild-name">${escapeHtml(g.name)}</span>
            <span style="color:var(--dim);font-size:10px;margin-left:6px">${g.id}</span>
            ${isTarget ? '<span class="dbg-badge ok" style="margin-left:6px">ACTIVE</span>' : ''}
          </span>
          <span class="dbg-val" style="flex:0 0 auto">
            ${isTarget
              ? `<span style="font-family:var(--mono);font-size:10px;color:var(--green)">✓ Currently active</span>`
              : `<button class="dbg-switch-btn" onclick="setTargetGuild('${g.id}','${escapeHtml(g.name)}')"
                   style="font-family:var(--mono);font-size:10px;background:none;border:1px solid var(--blue);
                          color:var(--blue);padding:4px 10px;cursor:pointer;transition:all .15s"
                   onmouseover="this.style.background='var(--blue)';this.style.color='#fff'"
                   onmouseout="this.style.background='none';this.style.color='var(--blue)'">
                   Set as Target
                 </button>`
            }
          </span>
        </div>`;
    });
    switcherHtml += `</div>`;
    grid.insertAdjacentHTML('beforeend', switcherHtml);
  }
}

async function setTargetGuild(guildId, guildName) {
  try {
    await apiFetch('/api/debug/set-guild', 'POST', { guild_id: guildId });
    showToast(`✓ Active server switched to ${guildName}`);
    loadDiagnostics();
    loadConfig();
  } catch(e) {
    logError('diag', e);
    showToast(`⚠ ${e.message}`, true);
  }
}

async function revokeSession(userId, username) {
  if (!confirm(`Force logout ${username}?`)) return;
  try {
    await apiFetch('/auth/sessions/revoke', 'POST', { user_id: userId, username });
    showToast(`✓ ${username} force logged out`);
    loadDiagnostics();
  } catch(e) { showToast(`⚠ ${e.message}`, true); }
}

async function unblockSession(userId, username) {
  try {
    await apiFetch('/auth/sessions/unblock', 'POST', { user_id: userId });
    showToast(`✓ ${username} unblocked`);
    loadDiagnostics();
  } catch(e) { showToast(`⚠ ${e.message}`, true); }
}

// ─── BOT CONFIG ───────────────────────────────────────────────────────────────
let _cfgData = null;

async function loadConfig() {
  const body = document.getElementById('cfg-body');
  if (!body) return;
  body.innerHTML = '<div class="dbg-loading">↻ Loading config…</div>';
  try {
    _cfgData = await apiFetch('/api/config');
  } catch(e) {
    logError('diag', e);
    body.innerHTML = `<div class="dbg-loading" style="color:var(--red)">⚠ ${escapeHtml(e.message)}</div>`;
    return;
  }

  const { current, roles, channels } = _cfgData;

  function roleSelect(id, currentId) {
    const noneSelected = !currentId || currentId === '0';
    const blankOpt = `<option value="0" ${noneSelected ? 'selected' : ''}>— Not set —</option>`;
    const opts = roles.map(r =>
      `<option value="${r.id}" ${r.id === currentId ? 'selected' : ''}>${escapeHtml(r.name)} (${r.id})</option>`
    ).join('');
    return `<select class="cfg-select" id="cfg-${id}">${blankOpt}${opts}</select>`;
  }

  function channelSelect(id, currentId) {
    const noneSelected = !currentId || currentId === '0';
    const blankOpt = `<option value="0" ${noneSelected ? 'selected' : ''}>— Not set —</option>`;
    const opts = channels.map(c =>
      `<option value="${c.id}" ${c.id === currentId ? 'selected' : ''}>#${escapeHtml(c.name)} (${c.id})</option>`
    ).join('');
    return `<select class="cfg-select" id="cfg-${id}">${blankOpt}${opts}</select>`;
  }

  function selfRolePublisher() {
    const roleOpts = roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    const channelOpts = channels.map(c => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
    const roleControl = roles.length ? `<select class="cfg-select" id="selfrole-role"><option value="">— Select role —</option>${roleOpts}</select>` : `<input class="cfg-select" id="selfrole-role" placeholder="Discord role ID" />`;
    const channelControl = channels.length ? `<select class="cfg-select" id="selfrole-channel"><option value="">— Select channel —</option>${channelOpts}</select>` : `<input class="cfg-select" id="selfrole-channel" placeholder="Discord channel ID" />`;
    return `<div class="cfg-card" style="margin-top:16px"><div class="cfg-card-title">🎟 POST A SELF-ROLE BUTTON</div>
      <div class="cfg-row"><span class="cfg-label">Role to Give</span>${roleControl}</div>
      <div class="cfg-row"><span class="cfg-label">Destination Channel</span>${channelControl}</div>
      <div class="cfg-row"><span class="cfg-label">Button Label</span><input class="cfg-select" id="selfrole-label" maxlength="80" value="Get Role" /></div>
      <div class="cfg-row"><span class="cfg-label">Message</span><textarea class="cfg-select" id="selfrole-message" rows="3" style="resize:vertical">Click the button below to receive the role.</textarea></div>
      <button class="cfg-save-btn" onclick="postSelfRoleButton()">POST ROLE BUTTON</button>
      <div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-top:8px">The bot must have Manage Roles and its Discord role must be above the role being assigned.</div>
    </div>`;
  }

  const fallbackInputs = !roles.length && !channels.length;

  if (fallbackInputs) {
    body.innerHTML = `
      <div style="font-family:var(--mono);font-size:11px;color:var(--yellow);margin:0 2rem 1rem;padding:8px 12px;border:1px solid rgba(255,200,0,.3);background:rgba(255,200,0,.05)">
        ⚠ Guild role/channel list unavailable — bot may still be connecting. Enter IDs manually below.
      </div>
      <div class="cfg-grid">
        <div class="cfg-card">
          <div class="cfg-card-title">🎭 Role Assignment</div>
          ${['HOSTER_ROLE','MANAGER_ROLE','BOD_ROLE','INTEREST_ROLE','FLIGHT_NOTIFY_ROLE','FLIGHT_START_ROLE','EVENTS_INTEREST_ROLE'].map(f =>
            `<div class="cfg-row"><span class="cfg-label">${f.replace(/_/g,' ')}</span>
             <input class="cfg-select" id="cfg-${f}" value="${current[f]||''}" placeholder="Role ID" style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 10px;width:100%;outline:none" /></div>`
          ).join('')}
        </div>
        <div class="cfg-card">
          <div class="cfg-card-title">📢 Channel Assignment</div>
          ${['LOG_CHANNEL_ID','PUBLIC_CHANNEL_ID','ANNOUNCE_CHANNEL_ID','EVENTS_CHANNEL_ID','CREW_CHANNEL_ID'].map(f =>
            `<div class="cfg-row"><span class="cfg-label">${f.replace(/_/g,' ')}</span>
             <input class="cfg-select" id="cfg-${f}" value="${current[f]||''}" placeholder="Channel ID" style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 10px;width:100%;outline:none" /></div>`
          ).join('')}
        </div>
      </div>
      <button class="cfg-save-btn" id="cfg-save-btn" onclick="saveConfig()">💾 SAVE CONFIGURATION</button>
      ${selfRolePublisher()}
    `;
    return;
  }

  body.innerHTML = `
    <div class="cfg-grid">
      <div class="cfg-card">
        <div class="cfg-card-title">🎭 Role Assignment</div>
        <div class="cfg-row"><span class="cfg-label">Hoster Role</span>${roleSelect('HOSTER_ROLE', current.HOSTER_ROLE)}</div>
        <div class="cfg-row"><span class="cfg-label">Manager Role</span>${roleSelect('MANAGER_ROLE', current.MANAGER_ROLE)}</div>
        <div class="cfg-row"><span class="cfg-label">BOD Role</span>${roleSelect('BOD_ROLE', current.BOD_ROLE)}</div>
        <div class="cfg-row"><span class="cfg-label">Interest / Pax Role</span>${roleSelect('INTEREST_ROLE', current.INTEREST_ROLE)}</div>
        <div class="cfg-row"><span class="cfg-label">Flight Notification Ping</span>${roleSelect('FLIGHT_NOTIFY_ROLE', current.FLIGHT_NOTIFY_ROLE)}</div>
        <div class="cfg-row"><span class="cfg-label">Flight Start Ping</span>${roleSelect('FLIGHT_START_ROLE', current.FLIGHT_START_ROLE)}</div>
        <div class="cfg-row"><span class="cfg-label">Events Interest Role</span>${roleSelect('EVENTS_INTEREST_ROLE', current.EVENTS_INTEREST_ROLE)}</div>
      </div>
      <div class="cfg-card">
        <div class="cfg-card-title">📢 Channel Assignment</div>
        <div class="cfg-row"><span class="cfg-label">Log Channel</span>${channelSelect('LOG_CHANNEL_ID', current.LOG_CHANNEL_ID)}</div>
        <div class="cfg-row"><span class="cfg-label">Public Schedule Channel</span>${channelSelect('PUBLIC_CHANNEL_ID', current.PUBLIC_CHANNEL_ID)}</div>
        <div class="cfg-row"><span class="cfg-label">Announcement Channel</span>${channelSelect('ANNOUNCE_CHANNEL_ID', current.ANNOUNCE_CHANNEL_ID)}</div>
        <div class="cfg-row"><span class="cfg-label">Events Channel</span>${channelSelect('EVENTS_CHANNEL_ID', current.EVENTS_CHANNEL_ID)}</div>
        <div class="cfg-row"><span class="cfg-label">Crew Signup Channel</span>${channelSelect('CREW_CHANNEL_ID', current.CREW_CHANNEL_ID)}</div>
      </div>
    </div>
    <button class="cfg-save-btn" id="cfg-save-btn" onclick="saveConfig()">💾 SAVE CONFIGURATION</button>
    ${selfRolePublisher()}
  `;
}

async function postSelfRoleButton() {
  const roleId = document.getElementById('selfrole-role')?.value || '';
  const channelId = document.getElementById('selfrole-channel')?.value || '';
  if (!roleId || !channelId) return showToast('Select a role and destination channel', true);
  try {
    const result = await apiFetch('/api/self-role-button', 'POST', {
      role_id: roleId, channel_id: channelId,
      label: document.getElementById('selfrole-label')?.value || 'Get Role',
      message: document.getElementById('selfrole-message')?.value || '',
    });
    showToast(`✓ Role button posted in #${result.channel}`);
  } catch (e) { showToast(`⚠ ${e.message}`, true); }
}

async function saveConfig() {
  const btn = document.getElementById('cfg-save-btn');
  if (btn) btn.disabled = true;
  const fields = ['HOSTER_ROLE','MANAGER_ROLE','BOD_ROLE','INTEREST_ROLE','FLIGHT_NOTIFY_ROLE','FLIGHT_START_ROLE','EVENTS_INTEREST_ROLE','LOG_CHANNEL_ID','PUBLIC_CHANNEL_ID','ANNOUNCE_CHANNEL_ID','EVENTS_CHANNEL_ID','CREW_CHANNEL_ID'];
  const payload = {};
  for (const f of fields) {
    const el = document.getElementById(`cfg-${f}`);
    if (el) payload[f] = el.value;
  }
  try {
    await apiFetch('/api/config', 'POST', payload);
    showToast('✓ Configuration saved and applied');
    loadConfig();
  } catch(e) {
    logError('diag', e);
    showToast(`⚠ ${e.message}`, true);
    if (btn) btn.disabled = false;
  }
}

// ─── AUTOMATION CONFIG ────────────────────────────────────────────────────────

let _automationCfg = null;

async function loadAutomation() {
  const panel = document.getElementById('automation-panel');
  if (!panel) return;
  const body = document.getElementById('automation-body');
  if (body) body.innerHTML = '<div class="dbg-loading">↻ Loading…</div>';
  try {
    _automationCfg = await apiFetch('/api/automation');
    panel.style.display = '';
    renderAutomation();
  } catch(e) {
    // Not owner — keep hidden
    if (panel) panel.style.display = 'none';
  }
}

function renderAutomation() {
  const body = document.getElementById('automation-body');
  if (!body || !_automationCfg) return;

  const mono = "font-family:var(--mono);font-size:11px";
  const label = (txt) => `<div style="${mono};color:var(--subtext);font-size:10px;letter-spacing:.08em;margin-bottom:5px;text-transform:uppercase">${txt}</div>`;
  const input = (id, val, type='text', extra='') =>
    `<input id="${id}" type="${type}" value="${escapeHtml(String(val ?? ''))}"
      style="${mono};background:var(--surface);border:1px solid var(--border);color:var(--text);
             padding:6px 10px;width:100%;outline:none;box-sizing:border-box" ${extra} />`;
  const textarea = (id, val) =>
    `<textarea id="${id}" rows="4"
      style="${mono};font-size:10px;background:var(--surface);border:1px solid var(--border);
             color:var(--text);padding:6px 10px;width:100%;outline:none;box-sizing:border-box;
             resize:vertical;line-height:1.5">${escapeHtml(String(val ?? ''))}</textarea>`;

  function statusBadge(enabled) {
    return enabled
      ? `<span class="dbg-badge ok" style="font-size:10px;padding:3px 10px;letter-spacing:.1em">● ENABLED</span>`
      : `<span class="dbg-badge error" style="font-size:10px;padding:3px 10px;letter-spacing:.1em">○ DISABLED</span>`;
  }

  function toggleBtn(taskKey, enabled) {
    return enabled
      ? `<button onclick="automationToggle('${taskKey}', false)"
           class="btn-ghost" style="font-size:10px;padding:4px 12px;color:var(--red);border-color:var(--red)">
           Disable</button>`
      : `<button onclick="automationToggle('${taskKey}', true)"
           class="btn-ghost" style="font-size:10px;padding:4px 12px;color:var(--green);border-color:var(--green)">
           Enable</button>`;
  }

  function card(taskKey, headerExtra, fieldsHtml) {
    const cfg = _automationCfg[taskKey] || {};
    const enabled = cfg.enabled !== false;
    return `
      <div class="dbg-card" id="auto-card-${taskKey}" style="grid-column:1/-1">
        <div class="dbg-card-title" style="justify-content:space-between;align-items:center">
          <div style="display:flex;align-items:center;gap:10px">
            <span>${escapeHtml(cfg.label || taskKey)}</span>
            ${statusBadge(enabled)}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            ${headerExtra}
            ${toggleBtn(taskKey, enabled)}
          </div>
        </div>
        <div style="padding:14px;display:flex;flex-direction:column;gap:10px;opacity:${enabled ? '1' : '0.5'};pointer-events:${enabled ? 'auto' : 'none'}">
          <div style="${mono};font-size:10px;color:var(--dim);line-height:1.6">${escapeHtml(cfg.description || '')}</div>
          ${fieldsHtml}
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
            <button onclick="automationSaveCard('${taskKey}')"
              class="btn-ghost" style="font-size:10px;padding:5px 16px;color:var(--green);border-color:var(--green)">
              💾 Save Changes
            </button>
          </div>
        </div>
      </div>`;
  }

  // ── Daily Schedule ─────────────────────────────────────────────────────────
  const ds = _automationCfg.post_daily_schedule || {};
  const dailyCard = card('post_daily_schedule', '', `
    <div>
      ${label('Post Time (UTC)')}
      ${input('auto-post_daily_schedule-post_time_utc', ds.post_time_utc || '00:00', 'time')}
      <div style="${mono};font-size:9px;color:var(--dim);margin-top:4px">
        Time at which today's flight schedule embed is posted to the public channel each day.
      </div>
    </div>
  `);

  // ── Pre-Departure Reminder ─────────────────────────────────────────────────
  const ar = _automationCfg.auto_reminder_flights || {};
  const reminderCard = card('auto_reminder_flights', '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        ${label('Minutes Before Departure')}
        ${input('auto-auto_reminder_flights-minutes_before', ar.minutes_before ?? 30, 'number', 'min="1" max="120"')}
        <div style="${mono};font-size:9px;color:var(--dim);margin-top:4px">
          Reminder fires within ±5 min of this target.
        </div>
      </div>
    </div>
    <div>
      ${label('Message Template')}
      ${textarea('auto-auto_reminder_flights-message', ar.message || '')}
      <div style="${mono};font-size:9px;color:var(--dim);margin-top:4px;line-height:1.6">
        Available placeholders: <span style="color:var(--blue)">{flight_number}</span>
        <span style="color:var(--blue)">{arr_city}</span>
        <span style="color:var(--blue)">{minutes}</span>
        <span style="color:var(--blue)">{interest_role}</span>
        <span style="color:var(--blue)">{event_link}</span>
        <span style="color:var(--blue)">{code}</span>
      </div>
    </div>
  `);

  // ── Auto-End Flights ───────────────────────────────────────────────────────
  const aeCard = card('auto_end_flights', '', `
    <div style="${mono};font-size:10px;color:var(--dim)">
      No configurable options — when enabled, any flight whose arrival time (UTC) has passed is automatically marked Ended and its Discord embed updated.
    </div>
  `);

  // ── Weekly / Monthly Reports ───────────────────────────────────────────────
  const rp = _automationCfg.post_weekly_monthly_report || {};
  const weeklyEnabled  = rp.weekly_enabled  !== false;
  const monthlyEnabled = rp.monthly_enabled !== false;
  const reportCard = card('post_weekly_monthly_report', '', `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:start">
      <div>
        ${label('Report Hour (UTC)')}
        ${input('auto-post_weekly_monthly_report-report_hour_utc', rp.report_hour_utc ?? 0, 'number', 'min="0" max="23"')}
      </div>
      <div>
        ${label('Weekly Report')}
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:6px">
          <input type="checkbox" id="auto-post_weekly_monthly_report-weekly_enabled"
            ${weeklyEnabled ? 'checked' : ''} style="width:14px;height:14px;cursor:pointer" />
          <span style="${mono};font-size:11px;color:var(--text)">Enabled (every Monday)</span>
        </label>
      </div>
      <div>
        ${label('Monthly Report')}
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:6px">
          <input type="checkbox" id="auto-post_weekly_monthly_report-monthly_enabled"
            ${monthlyEnabled ? 'checked' : ''} style="width:14px;height:14px;cursor:pointer" />
          <span style="${mono};font-size:11px;color:var(--text)">Enabled (1st of month)</span>
        </label>
      </div>
    </div>
    <div style="${mono};font-size:9px;color:var(--dim)">
      Reports are posted to the <strong style="color:var(--subtext)">log channel</strong>. The hour applies to both weekly and monthly triggers.
    </div>
  `);

  // ── Cleanup Old Day Messages ───────────────────────────────────────────────
  const cuCard = card('cleanup_old_day_messages', '', `
    <div style="${mono};font-size:10px;color:var(--dim)">
      No configurable options — when enabled, day-schedule Discord messages are automatically deleted once their date has passed in UTC.
    </div>
  `);

  body.innerHTML = `<div class="dbg-grid" style="margin:0 2rem 2rem">${dailyCard}${reminderCard}${aeCard}${reportCard}${cuCard}</div>`;
}

async function automationToggle(taskKey, enable) {
  try {
    _automationCfg = await apiFetch('/api/automation', 'POST', { [taskKey]: { enabled: enable } });
    renderAutomation();
    showToast(`${enable ? '✓ Enabled' : '○ Disabled'}: ${_automationCfg[taskKey]?.label || taskKey}`);
  } catch(e) {
    logError('automationToggle', e);
    showToast(`⚠ ${e.message}`, true);
  }
}

async function automationSaveCard(taskKey) {
  const cfg = _automationCfg[taskKey] || {};
  const updates = {};

  // Collect all inputs/textareas with id prefix auto-{taskKey}-{field}
  const prefix = `auto-${taskKey}-`;
  document.querySelectorAll(`[id^="${prefix}"]`).forEach(el => {
    const field = el.id.slice(prefix.length);
    if (el.type === 'checkbox') {
      updates[field] = el.checked;
    } else if (el.type === 'number') {
      updates[field] = Number(el.value);
    } else {
      updates[field] = el.value;
    }
  });

  if (!Object.keys(updates).length) {
    showToast('Nothing to save');
    return;
  }

  try {
    _automationCfg = await apiFetch('/api/automation', 'POST', { [taskKey]: updates });
    renderAutomation();
    showToast(`✓ ${_automationCfg[taskKey]?.label || taskKey} saved`);
  } catch(e) {
    logError('automationSaveCard', e);
    showToast(`⚠ ${e.message}`, true);
  }
}


// ─── TESTING MODE ─────────────────────────────────────────────────────────────
let _tmCfg = null;
let _tmCountdownTimer = null;

async function loadTestingMode() {
  // This dashboard has no server-side Discord-output sandbox. Keep the unfinished
  // test harness hidden rather than offering controls that could imply safe output.
  const panel = document.getElementById('testing-mode-panel');
  if (panel) panel.style.display = 'none';
}
function _tmStartCountdown() {
  if (_tmCountdownTimer) clearInterval(_tmCountdownTimer);
  if (!_tmCfg?.active || !_tmCfg?.expires_in_s) return;
  let remaining = _tmCfg.expires_in_s;
  _tmCountdownTimer = setInterval(() => {
    remaining--;
    const el = document.getElementById('tm-countdown');
    if (!el) { clearInterval(_tmCountdownTimer); return; }
    if (remaining <= 0) {
      clearInterval(_tmCountdownTimer);
      el.textContent = 'Expired';
      loadTestingMode(); // refresh state
      return;
    }
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    el.textContent = h > 0
      ? `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`
      : `${m}m ${String(s).padStart(2,'0')}s`;
  }, 1000);
}

function renderTestingMode() {
  const body = document.getElementById('tm-body');
  if (!body || !_tmCfg) return;
  const active = _tmCfg.active;
  const mono = "font-family:var(--mono);font-size:11px";
  const labelStyle = `${mono};font-size:10px;color:var(--subtext);letter-spacing:.08em;display:block;margin-bottom:5px;text-transform:uppercase`;
  const inputStyle = `${mono};background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 10px;width:100%;outline:none;box-sizing:border-box`;

  const statusBadge = active
    ? `<span class="dbg-badge warn" style="font-size:11px;padding:4px 14px;letter-spacing:.12em;font-weight:700">⚠ ACTIVE</span>`
    : `<span class="dbg-badge" style="font-size:11px;padding:4px 14px;letter-spacing:.12em;color:var(--dim);border-color:var(--dim)">○ INACTIVE</span>`;

  const countdown = active && _tmCfg.expires_in_s != null
    ? `<span style="${mono};font-size:10px;color:var(--yellow)">Auto-off in <span id="tm-countdown">…</span></span>`
    : '';

  body.innerHTML = `
    <div style="padding:1.25rem 1.5rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;background:${active ? 'rgba(255,215,0,.04)' : 'var(--surface)'}">
      <div style="display:flex;align-items:center;gap:14px">
        ${statusBadge}
        ${countdown}
        ${active ? `<span style="${mono};font-size:10px;color:var(--dim)">All Discord output → test channels · All pings → test role · Login locked to owner</span>` : ''}
      </div>
      <div style="display:flex;gap:8px">
        ${active
          ? `<button onclick="tmToggle(false)" class="btn-ghost" style="font-size:11px;padding:5px 16px;color:var(--green);border-color:var(--green)">✓ Disable Testing Mode</button>`
          : `<button onclick="tmShowEnable()" class="btn-ghost" style="font-size:11px;padding:5px 16px;color:var(--yellow);border-color:var(--yellow)">⚠ Enable Testing Mode</button>`
        }
      </div>
    </div>

    ${!active ? `
    <div id="tm-enable-form" style="display:none;padding:1.25rem 1.5rem;border-bottom:1px solid var(--border)">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:14px">
        <div>
          <label style="${labelStyle}">Test Announce Channel ID</label>
          <input id="tm-test_announce_channel_id" value="${escapeHtml(_tmCfg.test_announce_channel_id||'')}" style="${inputStyle}" placeholder="Channel ID" />
        </div>
        <div>
          <label style="${labelStyle}">Test Public Channel ID</label>
          <input id="tm-test_public_channel_id" value="${escapeHtml(_tmCfg.test_public_channel_id||'')}" style="${inputStyle}" placeholder="Channel ID" />
        </div>
        <div>
          <label style="${labelStyle}">Test Log Channel ID</label>
          <input id="tm-test_log_channel_id" value="${escapeHtml(_tmCfg.test_log_channel_id||'')}" style="${inputStyle}" placeholder="Channel ID" />
        </div>
        <div>
          <label style="${labelStyle}">Test Role ID (replaces all pings)</label>
          <input id="tm-test_role_id" value="${escapeHtml(_tmCfg.test_role_id||'')}" style="${inputStyle}" placeholder="Role ID" />
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:16px">
        <div style="display:flex;align-items:center;gap:8px">
          <label style="${labelStyle};margin:0">Auto-disable after</label>
          <input id="tm-expire_hours" type="number" value="2" min="0.25" max="24" step="0.25"
            style="${inputStyle};width:80px" />
          <span style="${mono};color:var(--subtext)">hours</span>
        </div>
        <button onclick="tmToggle(true)" class="btn-ghost" style="font-size:11px;padding:5px 20px;color:var(--yellow);border-color:var(--yellow);margin-left:auto">
          ⚠ Activate Testing Mode
        </button>
        <button onclick="tmHideEnable()" class="btn-ghost" style="font-size:11px;padding:5px 14px">Cancel</button>
      </div>
    </div>` : ''}

    <!-- Manual trigger buttons -->
    <div style="padding:1rem 1.5rem;border-bottom:1px solid var(--border)">
      <div style="${mono};font-size:10px;color:var(--subtext);letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px">Manual Task Triggers</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${[
          ['post_daily_schedule',         '📅 Post Daily Schedule'],
          ['auto_reminder_flights',       '⏰ Run Reminder Check'],
          ['auto_end_flights',            '🏁 Run Auto-End Check'],
          ['post_weekly_monthly_report',  '📊 Post Report Now'],
          ['cleanup_old_day_messages',    '🗑 Cleanup Old Messages'],
        ].map(([key, label]) => `
          <button onclick="tmTriggerTask('${key}')" class="btn-ghost"
            style="font-size:10px;padding:5px 12px;color:var(--blue);border-color:var(--blue)">
            ${label}
          </button>`).join('')}
      </div>
    </div>

    <!-- Fake flight generator -->
    <div style="padding:1rem 1.5rem;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div>
        <div style="${mono};font-size:10px;color:var(--subtext);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">Fake Flight Generator</div>
        <div style="${mono};font-size:10px;color:var(--dim)">Creates TST-XXXX · AC9999 · YYZ→YUL · departing in 45 min</div>
      </div>
      <button onclick="tmGenerateFlight()" class="btn-ghost"
        style="font-size:11px;padding:5px 16px;color:var(--accent);border-color:var(--accent);margin-left:auto">
        ✈ Generate Test Flight
      </button>
    </div>

    <!-- Dry-run log -->
    <div style="padding:1rem 1.5rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="${mono};font-size:10px;color:var(--subtext);letter-spacing:.1em;text-transform:uppercase">Intercept Log — Messages Sent</div>
        <div style="display:flex;gap:8px">
          <button onclick="tmRefreshLog()" class="btn-ghost" style="font-size:10px;padding:3px 10px">↻ Refresh</button>
          <button onclick="tmClearLog()" class="btn-ghost" style="font-size:10px;padding:3px 10px;color:var(--red);border-color:var(--red)">✕ Clear</button>
        </div>
      </div>
      <div id="tm-dry-run-log" style="max-height:240px;overflow-y:auto;background:var(--bg);border:1px solid var(--border)">
        <div style="${mono};font-size:10px;color:var(--dim);padding:12px 14px">Loading…</div>
      </div>
    </div>
  `;

  // Load dry-run log immediately
  tmRefreshLog();

  // Restart countdown if active
  if (active && _tmCfg.expires_in_s != null) {
    _tmStartCountdown();
  }
}

function tmShowEnable() {
  const f = document.getElementById('tm-enable-form');
  if (f) f.style.display = '';
}
function tmHideEnable() {
  const f = document.getElementById('tm-enable-form');
  if (f) f.style.display = 'none';
}

async function tmToggle(enable) {
  const payload = { enable };
  if (enable) {
    const fields = ['test_announce_channel_id','test_public_channel_id','test_log_channel_id','test_role_id'];
    fields.forEach(f => {
      const el = document.getElementById(`tm-${f}`);
      if (el) payload[f] = el.value.trim() || null;
    });
    const expEl = document.getElementById('tm-expire_hours');
    if (expEl) payload.expire_hours = parseFloat(expEl.value) || 2;

    if (!confirm(`Enable Testing Mode?\n\n• All Discord output → test channels\n• All pings → test role\n• All other sessions will be logged out\n• Auto-disables in ${payload.expire_hours}h\n\nContinue?`)) return;
  } else {
    if (!confirm('Disable Testing Mode? Dashboard will return to normal operation.')) return;
  }

  try {
    _tmCfg = await apiFetch('/api/testing-mode', 'POST', payload);
    renderTestingMode();
    _updateTestingBanner();
    showToast(enable ? '⚠ Testing Mode ACTIVE' : '✓ Testing Mode disabled');
  } catch(e) {
    logError('tmToggle', e);
    showToast(`⚠ ${e.message}`, true);
  }
}

async function tmTriggerTask(taskKey) {
  try {
    const res = await apiFetch(`/api/automation/trigger/${taskKey}`, 'POST', {});
    showToast(`✓ Triggered: ${taskKey.replace(/_/g,' ')}`);
    setTimeout(() => tmRefreshLog(), 1500); // let it run then refresh log
  } catch(e) {
    logError('tmTriggerTask', e);
    showToast(`⚠ ${e.message}`, true);
  }
}

async function tmGenerateFlight() {
  try {
    const flight = await apiFetch('/api/flights/generate-test', 'POST', {});
    showToast(`✈ Test flight created: ${flight.code} (AC9999 YYZ→YUL)`);
    if (typeof loadFlights === 'function') loadFlights();
  } catch(e) {
    logError('tmGenerateFlight', e);
    showToast(`⚠ ${e.message}`, true);
  }
}

async function tmRefreshLog() {
  const el = document.getElementById('tm-dry-run-log');
  if (!el) return;
  try {
    const data = await apiFetch('/api/testing-mode/dry-run-log');
    const entries = data.entries || [];
    if (!entries.length) {
      el.innerHTML = `<div style="font-family:var(--mono);font-size:10px;color:var(--dim);padding:12px 14px">No messages intercepted yet.</div>`;
      return;
    }
    el.innerHTML = entries.map(e => `
      <div style="display:grid;grid-template-columns:60px 80px 1fr;gap:8px;padding:6px 14px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:10px">
        <span style="color:var(--dim)">${escapeHtml(e.ts)}</span>
        <span style="color:var(--blue);text-transform:uppercase">#${escapeHtml(e.channel)}</span>
        <span style="color:var(--text);word-break:break-all">${escapeHtml(e.preview)}</span>
      </div>`).join('');
  } catch(e) {
    el.innerHTML = `<div style="font-family:var(--mono);font-size:10px;color:var(--red);padding:12px 14px">Failed to load log</div>`;
  }
}

async function tmClearLog() {
  try {
    await apiFetch('/api/testing-mode/dry-run-log', 'DELETE', null);
    tmRefreshLog();
    showToast('✓ Intercept log cleared');
  } catch(e) {
    showToast(`⚠ ${e.message}`, true);
  }
}

// ─── TESTING MODE HEADER BANNER ──────────────────────────────────────────────
async function _checkTestingBanner() {
  try {
    const cfg = await apiFetch('/api/testing-mode');
    _tmCfg = cfg;
    _updateTestingBanner();
  } catch(e) {
    // Not owner — no banner
  }
}

function _updateTestingBanner() {
  const active = _tmCfg?.active;
  let banner = document.getElementById('testing-mode-banner');
  if (!active) {
    if (banner) banner.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'testing-mode-banner';
    document.body.insertBefore(banner, document.body.firstChild);
  }
  banner.className = 'testing-mode-banner';
  banner.innerHTML = `
    <span>⚠ TESTING MODE ACTIVE — Discord output redirected to test channels</span>
    <button onclick="if(confirm('Disable Testing Mode?')){tmToggle(false)}" 
      style="margin-left:16px;font-family:var(--mono);font-size:10px;background:rgba(0,0,0,.3);
             border:1px solid rgba(255,255,255,.3);color:#fff;padding:3px 10px;cursor:pointer">
      Disable
    </button>
  `;
}
