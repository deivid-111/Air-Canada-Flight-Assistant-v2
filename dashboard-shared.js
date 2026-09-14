// ─── SHARED UTILITIES (used by manager + owner dashboards) ───────────────────

// ─── SESSION STATE (globals set by each page's init after /auth/me) ──────────
var sessionUserId   = '';
var sessionUserName = '';
var sessionIsHoster  = false;
var sessionIsManager = false;
var sessionIsBod     = false;
var sessionIsOwner   = false;

async function apiFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, isErr = false) {
  let t = document.getElementById('_toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_toast';
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;font-family:var(--mono);font-size:12px;padding:10px 18px;border:1px solid;max-width:340px;pointer-events:none;transition:opacity .3s';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background  = isErr ? 'rgba(255,23,68,.15)' : 'rgba(0,230,118,.1)';
  t.style.borderColor = isErr ? 'var(--red)' : 'var(--green)';
  t.style.color       = isErr ? 'var(--red)' : 'var(--green)';
  t.style.opacity     = '1';
  clearTimeout(t._hide);
  t._hide = setTimeout(() => t.style.opacity = '0', 3000);
}

function setApiStatus(online) {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (dot)  dot.style.background  = online ? 'var(--green)' : 'var(--red)';
  if (text) text.textContent      = online ? 'Online' : 'Offline';
}

function toggleTheme() {
  document.body.classList.toggle('light-mode');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = document.body.classList.contains('light-mode') ? '🌙' : '☀';
  localStorage.setItem('aic_theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
}

// Apply saved theme on load
if (localStorage.getItem('aic_theme') === 'light') {
  document.body.classList.add('light-mode');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = '🌙';
}