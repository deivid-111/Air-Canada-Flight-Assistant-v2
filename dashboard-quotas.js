let quotaRows = [];
async function loadQuotas() {
  const box = document.getElementById('quotas-list');
  if (!box) return;
  box.innerHTML = '<div style="font-family:var(--mono);color:var(--subtext)">Loading…</div>';
  try {
    const data = await apiFetch('/api/quotas'); quotaRows = data.rows || [];
    document.getElementById('quota-status').innerHTML = `Weekly review: <b>${data.reviewed_at}</b> · SOM target: <b>${data.targets?.som_target ?? 5} F/W</b> · FOM target: <b>${data.targets?.fom_target ?? 4} F/W</b> · Only completed flights with attendance and passenger logs count.`;
    renderQuotas();
  } catch (e) { box.innerHTML = `<div style="color:var(--red);font-family:var(--mono)">⚠ ${escapeHtml(e.message)}</div>`; }
}
function quotaFlightDetails(week) {
  const excluded = week?.excluded || [];
  if (!excluded.length) return '';
  return `<details style="margin-top:10px"><summary style="font-family:var(--mono);font-size:10px;color:var(--yellow);cursor:pointer">${excluded.length} flight${excluded.length === 1 ? '' : 's'} excluded this week</summary><div style="display:grid;gap:5px;margin-top:7px">${excluded.map(f => `<div style="font-family:var(--mono);font-size:10px;color:var(--subtext);padding:6px 8px;border-left:2px solid var(--yellow);background:var(--surface)"><b style="color:var(--text)">${escapeHtml(f.flight_number || f.code)}</b> — ${escapeHtml((f.reasons || []).join(', '))}</div>`).join('')}</div></details>`;
}
function traineeCard(r) {
  const t = r.foi_training || {}, defs = [['regional','Regional','Short regional operation'],['short_haul','Short Haul','Completed correctly'],['long_haul','Long Haul','Completed correctly']];
  const done = defs.filter(([key]) => !!t[key]).length, started = t.started_at ? new Date(t.started_at) : null;
  const due = started && !Number.isNaN(started.getTime()) ? new Date(started.getTime() + 21 * 86400000) : null;
  const complete = done === 3, overdue = !complete && due && due.getTime() < Date.now();
  return `<div style="border:1px solid ${overdue ? 'var(--red)' : complete ? 'var(--green)' : 'var(--border)'};background:var(--card);padding:16px"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div><b style="font-family:var(--mono);font-size:14px">${escapeHtml(r.username)}</b><div style="font-family:var(--mono);font-size:9px;color:var(--subtext);margin-top:3px">FOI TRAINEE · 3-WEEK PROGRAM</div></div><div style="margin-left:auto;font-family:var(--mono);font-size:12px;color:${overdue ? 'var(--red)' : complete ? 'var(--green)' : 'var(--accent)'}">${complete ? '✓ COMPLETE' : overdue ? '⚠ OVERDUE' : `${done}/3 COMPLETE`}</div></div><div style="height:5px;background:var(--surface);margin:13px 0 14px;overflow:hidden"><div style="height:100%;width:${done / 3 * 100}%;background:${complete ? 'var(--green)' : 'var(--accent)'}"></div></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px">${defs.map(([key,label,desc], idx) => `<button onclick="setFoi('${r.user_id}','${key}',${!t[key]})" style="text-align:left;padding:11px;border:1px solid ${t[key] ? 'var(--green)' : 'var(--border)'};background:${t[key] ? 'rgba(32,180,110,.08)' : 'var(--surface)'};color:var(--text);cursor:pointer"><span style="display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;margin-right:7px;border:1px solid ${t[key] ? 'var(--green)' : 'var(--dim)'};color:${t[key] ? 'var(--green)' : 'var(--dim)'};font-family:var(--mono)">${t[key] ? '✓' : idx + 1}</span><b style="font-family:var(--mono);font-size:11px">${label}</b><span style="display:block;margin:5px 0 0 29px;font-family:var(--mono);font-size:9px;color:var(--subtext)">${desc}</span></button>`).join('')}</div><div style="font-family:var(--mono);font-size:9px;color:${overdue ? 'var(--red)' : 'var(--dim)'};margin-top:10px">${due ? `Deadline: ${due.toISOString().slice(0,10)} at ${due.toISOString().slice(11,16)} UTC` : 'Deadline begins when training is first tracked.'}</div></div>`;
}
function quotaCard(r) {
  const week = r.weeks?.[0] || {flights:0, excluded:[]}, review = r.latest_review;
  return `<div style="border:1px solid ${r.warning ? 'var(--red)' : r.loa_active ? 'var(--blue)' : 'var(--border)'};border-left:4px solid ${r.warning ? 'var(--red)' : r.loa_active ? 'var(--blue)' : 'var(--accent)'};background:var(--card);padding:14px 16px"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><b style="font-family:var(--mono);font-size:13px">${escapeHtml(r.username)}</b><span style="font-family:var(--mono);font-size:10px;color:var(--subtext)">${r.role}</span>${r.loa_active ? '<span style="font-family:var(--mono);font-size:9px;color:var(--blue);border:1px solid var(--blue);padding:2px 7px">LOA · QUOTA PAUSED</span>' : ''}<span style="margin-left:auto;font-family:var(--mono);color:${r.terminated?'var(--red)':r.points<=7?'var(--yellow)':'var(--green)'}">${r.points}/10 POINTS</span></div>${r.warning ? `<div style="margin-top:10px;padding:8px 10px;background:rgba(220,45,65,.09);color:var(--red);font-family:var(--mono);font-size:10px">⚠ MISSED WEEKLY QUOTA — ${review?.flights || 0}/${r.target} eligible flights for week of ${escapeHtml(review?.week || '')}. Dashboard notice only.</div>` : ''}<div style="font-family:var(--mono);font-size:11px;color:var(--subtext);margin-top:10px">Current week: <b style="color:var(--text)">${week.flights}/${r.target}</b> eligible flights · Review runs Monday at 00:00 UTC · +1 point each calendar month</div>${quotaFlightDetails(week)}</div>`;
}
function renderQuotas() {
  const box = document.getElementById('quotas-list');
  if (!quotaRows.length) { box.innerHTML = '<div style="font-family:var(--mono);color:var(--subtext)">No matching SOM, FOM, or FOI trainee members found.</div>'; return; }
  const warnings = quotaRows.filter(r => r.warning), trainees = quotaRows.filter(r => r.role === 'FOI Trainee'), regular = quotaRows.filter(r => r.role !== 'FOI Trainee');
  box.innerHTML = `${warnings.length ? `<div style="padding:12px 14px;border:1px solid var(--red);background:rgba(220,45,65,.08);font-family:var(--mono);font-size:11px;color:var(--red)">⚠ ${warnings.length} team member${warnings.length === 1 ? '' : 's'} missed the latest weekly quota. No Discord warning was sent.</div>` : ''}${trainees.map(traineeCard).join('')}${regular.map(quotaCard).join('')}`;
}
async function setFoi(uid, key, value) {
  try { await apiFetch(`/api/quotas/${uid}/foi`, 'PATCH', {[key]:value}); await loadQuotas(); } catch(e) { alert(e.message); loadQuotas(); }
}
