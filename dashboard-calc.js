// ─── UTC CALCULATOR ────────────────────────────────────────────────────────────
const WORLD_ZONES = [
  { city: 'UTC',        tz: 'UTC' },
  { city: 'London',     tz: 'Europe/London' },
  { city: 'Paris',      tz: 'Europe/Paris' },
  { city: 'Dubai',      tz: 'Asia/Dubai' },
  { city: 'Mumbai',     tz: 'Asia/Kolkata' },
  { city: 'Singapore',  tz: 'Asia/Singapore' },
  { city: 'Tokyo',      tz: 'Asia/Tokyo' },
  { city: 'Sydney',     tz: 'Australia/Sydney' },
  { city: 'New York',   tz: 'America/New_York' },
  { city: 'Chicago',    tz: 'America/Chicago' },
  { city: 'Denver',     tz: 'America/Denver' },
  { city: 'Los Angeles',tz: 'America/Los_Angeles' },
  { city: 'Toronto',    tz: 'America/Toronto' },
  { city: 'São Paulo',  tz: 'America/Sao_Paulo' },
  { city: 'Buenos Aires',tz:'America/Argentina/Buenos_Aires' },
];

let calcClockInterval = null;
let calcWorldInterval  = null;
let calcCurrentUtcDate = null; // Date obj representing chosen UTC moment

function calcInit() {
  calcSetNow();
  // Tick clock every second
  if (calcClockInterval) clearInterval(calcClockInterval);
  calcClockInterval = setInterval(calcTickClock, 1000);
  calcTickClock();

  // Show user tz info
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  document.getElementById('calc-tz-name').textContent = userTz;
}

function calcTickClock() {
  const now = new Date();
  const hh  = String(now.getUTCHours()).padStart(2,'0');
  const mm  = String(now.getUTCMinutes()).padStart(2,'0');
  const ss  = String(now.getUTCSeconds()).padStart(2,'0');
  document.getElementById('calc-utc-clock').textContent = `${hh}:${mm}:${ss}`;

  const localStr = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const dateStr  = now.toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' });
  document.getElementById('calc-local-now').textContent = `Local: ${localStr}`;
}

function calcSetNow() {
  const now = new Date();
  // Set local time input
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  document.getElementById('calc-local-time').value = `${hh}:${mm}`;
  // Set date input
  const yyyy = now.getFullYear();
  const mo   = String(now.getMonth()+1).padStart(2,'0');
  const dd   = String(now.getDate()).padStart(2,'0');
  document.getElementById('calc-local-date').value = `${yyyy}-${mo}-${dd}`;
  calcConvert();
}

function calcAddHours(h) {
  const timeEl = document.getElementById('calc-local-time');
  if (!timeEl.value) { calcSetNow(); return; }
  const [hh, mm] = timeEl.value.split(':').map(Number);

  // Build a Date from the currently selected date (not today), to correctly handle midnight rollovers
  const dateEl = document.getElementById('calc-local-date');
  let base;
  if (dateEl.value) {
    base = new Date(`${dateEl.value}T${timeEl.value}:00`);
  } else {
    base = new Date();
    base.setHours(hh, mm, 0, 0);
  }

  base.setHours(base.getHours() + h);

  // Update time input
  timeEl.value = `${String(base.getHours()).padStart(2,'0')}:${String(base.getMinutes()).padStart(2,'0')}`;

  // Update date input to reflect any midnight crossings
  if (dateEl.value) {
    const yy = base.getFullYear();
    const mo = String(base.getMonth() + 1).padStart(2, '0');
    const dy = String(base.getDate()).padStart(2, '0');
    dateEl.value = `${yy}-${mo}-${dy}`;
  }

  calcConvert();
}

function calcConvert() {
  const timeVal = document.getElementById('calc-local-time').value;
  const dateVal = document.getElementById('calc-local-date').value;
  if (!timeVal) {
    document.getElementById('calc-result-time').textContent = '—';
    document.getElementById('calc-result-date').textContent = '—';
    calcCurrentUtcDate = null;
    calcUpdateWorld(null);
    return;
  }

  const [lh, lm] = timeVal.split(':').map(Number);

  // Build a local Date representing the chosen local time
  let localDate;
  if (dateVal) {
    localDate = new Date(`${dateVal}T${timeVal}:00`);
  } else {
    localDate = new Date();
    localDate.setHours(lh, lm, 0, 0);
  }

  calcCurrentUtcDate = localDate;

  // UTC time result
  const uh = String(localDate.getUTCHours()).padStart(2,'0');
  const um = String(localDate.getUTCMinutes()).padStart(2,'0');
  document.getElementById('calc-result-time').textContent = `${uh}:${um}`;

  // UTC date result
  const ud = localDate.toLocaleDateString('en-CA', { timeZone:'UTC', weekday:'short', year:'numeric', month:'short', day:'numeric' });
  document.getElementById('calc-result-date').textContent = ud;

  // Offset label
  const offsetMins = -localDate.getTimezoneOffset();
  const sign   = offsetMins >= 0 ? '+' : '−';
  const oH     = String(Math.floor(Math.abs(offsetMins)/60)).padStart(2,'0');
  const oM     = String(Math.abs(offsetMins)%60).padStart(2,'0');
  const label  = offsetMins === 0 ? 'exactly 0 hours (you\'re in UTC!)' : `${sign}${oH}:${oM}`;
  document.getElementById('calc-offset-label').textContent = label;

  calcUpdateWorld(localDate);
}

function calcReverse() {
  const utcVal = document.getElementById('calc-utc-in').value;
  if (!utcVal) {
    document.getElementById('calc-reverse-result').textContent = '—';
    document.getElementById('calc-reverse-strip').textContent = 'Enter a UTC time above';
    return;
  }
  const [uh, um] = utcVal.split(':').map(Number);
  const d = new Date();
  d.setUTCHours(uh, um, 0, 0);

  const lh = String(d.getHours()).padStart(2,'0');
  const lm = String(d.getMinutes()).padStart(2,'0');
  document.getElementById('calc-reverse-result').textContent = `${lh}:${lm}`;

  const offsetMins = -d.getTimezoneOffset();
  const sign = offsetMins >= 0 ? '+' : '−';
  const oH = String(Math.floor(Math.abs(offsetMins)/60)).padStart(2,'0');
  const oM = String(Math.abs(offsetMins)%60).padStart(2,'0');
  document.getElementById('calc-reverse-strip').innerHTML =
    `UTC ${utcVal} = <strong>${lh}:${lm} local time</strong> &nbsp;(UTC${sign}${oH}:${oM})`;
}

// ─── DISCORD TIMESTAMP GENERATOR ──────────────────────────────────────────────
const DTS_FORMATS = [
  { flag: 't', label: 'Short Time',  example: '9:00 PM' },
  { flag: 'T', label: 'Long Time',   example: '9:00:00 PM' },
  { flag: 'd', label: 'Short Date',  example: '01/01/2025' },
  { flag: 'D', label: 'Long Date',   example: 'January 1, 2025' },
  { flag: 'f', label: 'Date & Time', example: 'Jan 1, 2025 9:00 PM' },
  { flag: 'F', label: 'Full',        example: 'Wednesday, January 1, 2025 9:00 PM' },
  { flag: 'R', label: 'Relative',    example: 'in 2 hours' },
];

function dtsSetNow() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth()+1).padStart(2,'0');
  const dd   = String(now.getDate()).padStart(2,'0');
  const hh   = String(now.getHours()).padStart(2,'0');
  const min  = String(now.getMinutes()).padStart(2,'0');
  document.getElementById('dts-date').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('dts-time').value = `${hh}:${min}`;
  dtsGenerate();
}

function dtsGenerate() {
  const dateVal = document.getElementById('dts-date').value;
  const timeVal = document.getElementById('dts-time').value;
  const results = document.getElementById('dts-results');
  const empty   = document.getElementById('dts-empty');
  const tagsEl  = document.getElementById('dts-tags');
  const unixEl  = document.getElementById('dts-unix');

  if (!dateVal || !timeVal) {
    results.style.display = 'none';
    empty.style.display = '';
    return;
  }

  // Parse as local time → unix timestamp
  const localDt = new Date(`${dateVal}T${timeVal}:00`);
  if (isNaN(localDt.getTime())) {
    results.style.display = 'none';
    empty.style.display = '';
    return;
  }

  const unix = Math.floor(localDt.getTime() / 1000);
  unixEl.textContent = unix;
  results.style.display = '';
  empty.style.display = 'none';

  const selectedFlag = document.getElementById('dts-format').value;
  tagsEl.innerHTML = DTS_FORMATS.map(f => {
    const tag = `<t:${unix}:${f.flag}>`;
    const isSelected = f.flag === selectedFlag;
    return `<div class="dts-tag-card${isSelected?' selected':''}" onclick="dtsCopy('${tag}', this)" title="Click to copy" style="${isSelected?'border-color:var(--accent);background:var(--card)':''}">
      <div class="dts-tag-code">${escapeHtml(tag)}</div>
      <div class="dts-tag-label">${f.label}</div>
    </div>`;
  }).join('');

  // Live preview
  const previewEl = document.getElementById('dts-preview');
  if (previewEl && DTS_PREVIEW_FORMATS[selectedFlag]) {
    try { previewEl.textContent = DTS_PREVIEW_FORMATS[selectedFlag](localDt); }
    catch(e) { previewEl.textContent = '—'; }
  }
}

async function dtsCopy(text, el) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = el.querySelector('.dts-tag-label').textContent;
    el.querySelector('.dts-tag-label').textContent = '✓ Copied!';
    el.style.borderColor = 'var(--green)';
    setTimeout(() => {
      el.querySelector('.dts-tag-label').textContent = orig;
      el.style.borderColor = '';
    }, 1500);
  } catch(e) {
    showToast('Could not copy to clipboard', true);
  }
}

function calcUpdateWorld(refDate) {
  const grid = document.getElementById('calc-world-grid');
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const base = refDate || new Date();

  grid.innerHTML = WORLD_ZONES.map(zone => {
    const timeStr = base.toLocaleTimeString('en-GB', {
      timeZone: zone.tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    // Compute offset from UTC for this zone
    const utcMs  = base.getTime();
    const zoneDateStr = base.toLocaleString('en-CA', { timeZone: zone.tz,
      year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
    // Rough offset display
    const utcTimeStr = base.toLocaleTimeString('en-GB', { timeZone:'UTC', hour:'2-digit', minute:'2-digit', hour12:false });
    const isLocal = zone.tz === userTz;
    const isUtc   = zone.tz === 'UTC';

    // Compute offset hours by comparing zone time vs UTC time
    const zoneDate  = new Date(base.toLocaleString('en-US', { timeZone: zone.tz }));
    const utcDate2  = new Date(base.toLocaleString('en-US', { timeZone: 'UTC' }));
    const diffMins  = Math.round((zoneDate - utcDate2) / 60000);
    const sign      = diffMins >= 0 ? '+' : '−';
    const dH        = String(Math.floor(Math.abs(diffMins)/60)).padStart(2,'0');
    const dM        = String(Math.abs(diffMins)%60).padStart(2,'0');
    const offsetStr = isUtc ? 'UTC' : `UTC${sign}${dH}:${dM}`;

    return `<div class="calc-world-item${isLocal ? ' is-local' : ''}">
      <div class="calc-world-city">${zone.city}${isLocal ? ' ★' : ''}</div>
      <div class="calc-world-time">${timeStr}</div>
      <div class="calc-world-offset">${offsetStr}</div>
    </div>`;
  }).join('');
}