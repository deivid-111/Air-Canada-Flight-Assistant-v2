// ─── CONFIG ──────────────────────────────────────────────────────────────────
const API_BASE = '';

async function apiFetch(path, method = 'GET', body = null) {
  const opts = {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };

  if (body) opts.body = JSON.stringify(body);

  const baseUrl = API_BASE + path;
  const url = method === 'GET'
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}_=${Date.now()}`
    : baseUrl;
  const res = await fetch(url, opts);

  console.log("URL:", url);
  console.log("Status:", res.status);
  console.log("Content-Type:", res.headers.get("content-type"));

  const text = await res.text();
  console.log("First 200 chars:", text.slice(0, 200));

  const contentType = res.headers.get('content-type') || '';
  let data = null;
  if (text && contentType.includes('application/json')) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      // A malformed JSON response is handled below with a useful error.
    }
  }

  if (!res.ok) {
    const message = data?.detail || data?.message || `HTTP ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }

  if (data !== null) return data;
  throw new Error(`Expected JSON from ${path}, but received ${contentType || 'an unknown response type'}.`);
}

// ─── STATE ───────────────────────────────────────────────────────────────────
let allFlights  = [];
let endedFlights = [];
let allLogs     = [];
let activeFilter = 'all';
let currentCode  = null;
let isDirty      = false;
let apiOnline    = false;
let currentPage  = 'flights';

// ─── ERROR LOG (must be declared before global error handlers) ────────────────
const _errLog = [];

// ─── GLOBAL ERROR HANDLERS ───────────────────────────────────────────────────
window.addEventListener('error', ev => {
  logError(`uncaught @ ${ev.filename?.split('/').pop() || '?'}:${ev.lineno}`, ev.error || ev.message);
});
window.addEventListener('unhandledrejection', ev => {
  logError('unhandledPromise', ev.reason || 'Unknown rejection');
});

// ─── CLOCK ───────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2,'0');
  const mm = String(now.getUTCMinutes()).padStart(2,'0');
  const ss = String(now.getUTCSeconds()).padStart(2,'0');
  const clockEl = document.getElementById('clock');
  if (clockEl) clockEl.textContent = `${hh}:${mm}:${ss} UTC`;
}
setInterval(updateClock, 1000);
updateClock();

// ─── ERROR LOGGER ────────────────────────────────────────────────────────────
function logError(context, error) {
  const ts  = new Date().toISOString().replace('T',' ').slice(0,19);
  const msg = error instanceof Error
    ? `${error.message}${error.stack ? '\n  ' + error.stack.split('\n').slice(1,3).join('\n  ') : ''}`
    : String(error);
  const entry = { ts, context, msg };
  _errLog.unshift(entry); // newest first
  if (_errLog.length > 100) _errLog.pop();
  console.error(`[${ts}] [${context}]`, error);

  // If error panel is in DOM, update it immediately
  _renderErrorLog();

  // Also flash the Diagnostics tab label briefly so you know something happened
  const diagTab = document.getElementById('tab-debug');
  if (diagTab && !diagTab.dataset.errFlash) {
    const orig = diagTab.textContent;
    diagTab.style.color = 'var(--red)';
    diagTab.dataset.errFlash = '1';
    setTimeout(() => { diagTab.style.color = ''; delete diagTab.dataset.errFlash; }, 3000);
  }
}

function _renderErrorLog() {
  const el = document.getElementById('client-error-entries');
  if (!el) return;
  if (!_errLog.length) {
    el.style.color = 'var(--subtext)';
    el.innerHTML = 'No errors logged.';
    return;
  }
  el.style.color = '';
  el.innerHTML = _errLog.map(e => `
    <div style="border-bottom:1px solid var(--border);padding:6px 0;line-height:1.5">
      <span style="color:var(--dim)">${e.ts}</span>
      <span style="color:var(--accent);margin:0 8px">[${e.context}]</span>
      <span style="color:var(--red);white-space:pre-wrap">${e.msg}</span>
    </div>`).join('');
}

function clearErrorLog() {
  _errLog.length = 0;
  _renderErrorLog();
}

// Re-render error log when diagnostics tab is opened
// _origSwitchPage reserved for future use — not used currently

// ─── PAGE SWITCHING ───────────────────────────────────────────────────────────
function switchPage(page) {
  currentPage = page;
  document.getElementById('page-flights').style.display   = page === 'flights'   ? '' : 'none';
  const crewReqPage = document.getElementById('page-crew-requests'); if (crewReqPage) crewReqPage.style.display = page === 'crew-requests' ? '' : 'none';
  const logsPage = document.getElementById('page-logs'); if (logsPage) logsPage.style.display = page === 'logs' ? '' : 'none';
  const calcPage = document.getElementById('page-calc'); if (calcPage) calcPage.style.display = page === 'calc' ? '' : 'none';
  const calPage = document.getElementById('page-calendar'); if (calPage) calPage.style.display = page === 'calendar' ? '' : 'none';
  const maPage = document.getElementById('page-my-analytics'); if (maPage) maPage.style.display = page === 'my-analytics' ? '' : 'none';
  const avPage = document.getElementById('page-availability'); if (avPage) avPage.style.display = page === 'availability' ? '' : 'none';
  const analyticsPage = document.getElementById('page-analytics'); if (analyticsPage) analyticsPage.style.display = page === 'analytics' ? '' : 'none';
  const hostsPage = document.getElementById('page-hosts'); if (hostsPage) hostsPage.style.display = page === 'hosts' ? '' : 'none';
  const debugPage = document.getElementById('page-debug'); if (debugPage) debugPage.style.display = page === 'debug' ? '' : 'none';
  const cuPage = document.getElementById('page-customize'); if (cuPage) cuPage.style.display = page === 'customize' ? '' : 'none';
  const flightsSubnav = document.getElementById('flights-subnav'); if (flightsSubnav) flightsSubnav.style.display = page === 'flights' ? '' : 'none';
  const atdPage = document.getElementById('page-attendance'); if (atdPage) atdPage.style.display = page === 'attendance' ? '' : 'none';
  document.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.getElementById(`tab-${page}`); if (activeTab) activeTab.classList.add('active');
  if (page === 'logs')      loadLogs();
  if (page === 'calc')      calcInit();
  if (page === 'calendar')  renderCalendar();
  if (page === 'crew-requests' && typeof loadCrewRemovalRequests === 'function') loadCrewRemovalRequests();
  if (page === 'my-analytics') loadMyAnalytics();
  if (page === 'availability')  loadAvailability();
  if (page === 'analytics') renderAnalytics();
  if (page === 'hosts')     loadHosts();
  if (page === 'debug')     {
    loadDiagnostics(); loadConfig(); _renderErrorLog();
    const _prp = document.getElementById('presence-panel');
    if (_prp) _prp.style.display = sessionIsOwner ? '' : 'none';
    if (sessionIsOwner) loadBotPresence();
    const _ffp = document.getElementById('feature-flags-panel');
    if (_ffp) { _ffp.style.display = sessionIsOwner ? '' : 'none'; if (sessionIsOwner) loadFeatureFlags(); }
    const _bpp = document.getElementById('banner-publisher-panel');
    if (_bpp) { _bpp.style.display = sessionIsOwner ? '' : 'none'; if (sessionIsOwner) loadBannerPublisher(); }
  }
  if (page === 'customize') uiEditorInit();
  if (page === 'attendance' && typeof loadAttendancePage === 'function') loadAttendancePage();
}