let quotaAdminRows = [];

async function loadQuotaAdmin() {
  const list = document.getElementById('quota-admin-list');
  if (!list) return;
  list.innerHTML = '<div class="dbg-loading">Loading quota records…</div>';
  try {
    const [data, config] = await Promise.all([apiFetch('/api/quotas'), apiFetch('/api/quota-config')]);
    const som = document.getElementById('quota-som-target'), fom = document.getElementById('quota-fom-target');
    if (som) som.value = config.som_target;
    if (fom) fom.value = config.fom_target;
    quotaAdminRows = (data.rows || []).filter(row => row.target > 0);
    renderQuotaAdmin();
  } catch (e) { list.innerHTML = `<div style="font-family:var(--mono);font-size:11px;color:var(--red)">⚠ ${escapeHtml(e.message)}</div>`; }
}

async function saveQuotaTargets() {
  const som = Number(document.getElementById('quota-som-target')?.value);
  const fom = Number(document.getElementById('quota-fom-target')?.value);
  if (!Number.isInteger(som) || !Number.isInteger(fom) || som < 0 || fom < 0 || som > 50 || fom > 50) return showToast('Targets must be whole numbers between 0 and 50', true);
  try {
    await apiFetch('/api/quota-config', 'PATCH', {som_target:som, fom_target:fom});
    showToast('Weekly quota targets saved');
    await loadQuotaAdmin();
  } catch (e) { showToast('⚠ ' + e.message, true); }
}

function renderQuotaAdmin() {
  const list = document.getElementById('quota-admin-list');
  if (!quotaAdminRows.length) { list.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--dim)">No quota-managed hosts found.</div>'; return; }
  list.innerHTML = quotaAdminRows.map(row => {
    const periods = row.loa_periods || [], latest = periods.length ? periods[periods.length - 1] : null;
    return `<div style="background:var(--card);border:1px solid ${row.loa_active ? 'var(--blue)' : 'var(--border)'};padding:14px 16px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><b style="font-family:var(--mono);font-size:13px">${escapeHtml(row.username)}</b><span style="font-family:var(--mono);font-size:9px;color:var(--subtext)">${escapeHtml(row.role)}</span>${row.loa_active ? '<span style="font-family:var(--mono);font-size:9px;color:var(--blue);border:1px solid var(--blue);padding:2px 7px">ON LOA</span>' : ''}<span style="margin-left:auto;font-family:var(--mono);font-size:13px;color:${row.points <= 1 ? 'var(--red)' : row.points <= 7 ? 'var(--yellow)' : 'var(--green)'}">${row.points}/10 POINTS</span></div>
      ${latest ? `<div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-top:7px">Latest LOA: ${escapeHtml(latest.start || '?')} → ${escapeHtml(latest.end || 'active')}${latest.reason ? ` · ${escapeHtml(latest.reason)}` : ''}</div>` : ''}
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px"><button class="action-btn" onclick="adjustQuotaPoints('${row.user_id}',1)">+ Add Point</button><button class="action-btn" onclick="adjustQuotaPoints('${row.user_id}',-1)">− Remove Point</button>${row.loa_active ? `<button class="action-btn" style="color:var(--green);border-color:var(--green)" onclick="endQuotaLoa('${row.user_id}')">End LOA</button>` : `<button class="action-btn" style="color:var(--blue);border-color:var(--blue)" onclick="startQuotaLoa('${row.user_id}')">Start LOA</button>`}${latest ? `<button class="action-btn" style="color:var(--red);border-color:var(--red)" onclick="removeLatestQuotaLoa('${row.user_id}')">Remove Latest LOA Record</button>` : ''}</div>
    </div>`;
  }).join('');
}

async function quotaAdminAction(uid, payload, success) {
  try { await apiFetch(`/api/quotas/${uid}/admin`, 'PATCH', payload); showToast(success); await loadQuotaAdmin(); }
  catch (e) { showToast('⚠ ' + e.message, true); }
}
function adjustQuotaPoints(uid, delta) {
  const reason = prompt(`Reason for ${delta > 0 ? 'adding' : 'removing'} one quota point:`, '') ?? null;
  if (reason === null) return;
  quotaAdminAction(uid, {action:'adjust_points', delta, reason}, `Quota point ${delta > 0 ? 'added' : 'removed'}`);
}
function startQuotaLoa(uid) {
  const today = new Date().toISOString().slice(0,10);
  const start = prompt('LOA start date (YYYY-MM-DD):', today); if (start === null) return;
  const end = prompt('Optional LOA end date (YYYY-MM-DD), or leave blank:', ''); if (end === null) return;
  const reason = prompt('LOA reason (optional):', '') ?? '';
  quotaAdminAction(uid, {action:'start_loa', start, end, reason}, 'LOA started');
}
function endQuotaLoa(uid) { if (confirm('End this host’s LOA today?')) quotaAdminAction(uid, {action:'end_loa'}, 'LOA ended'); }
function removeLatestQuotaLoa(uid) { if (confirm('Remove the latest LOA record? This is intended for correcting mistakes.')) quotaAdminAction(uid, {action:'remove_latest_loa'}, 'LOA record removed'); }
