// ─── UI EDITOR (Owner only — localStorage, affects only this browser) ────────

const UIE_KEY = 'aic_ui_overrides_v1';

const UIE_DEFAULTS = {
  '--bg':      '#050608',
  '--surface': '#0c0e14',
  '--card':    '#10131c',
  '--border':  '#1c2235',
  '--text':    '#d6daf0',
  '--subtext': '#6b7494',
  '--dim':     '#4a5275',
  '--accent':  '#c8102e',
  '--accent2': '#0055a5',
  '--green':   '#00e676',
  '--yellow':  '#ffd740',
  '--red':     '#ff1744',
  '--blue':    '#448aff',
};

const UIE_FONT_DEFAULTS = {
  '--mono': "'Share Tech Mono', monospace",
  '--cond': "'Barlow Condensed', sans-serif",
  '--sans': "'Barlow', sans-serif",
};

const UIE_MISC_DEFAULTS = {
  'logo-eyebrow': 'Air Canada — PTFS Operations',
  'logo-title':   'Application Dashboard',
  'scanlines':    true,
};

// Available Google Font options per slot
const MONO_FONTS = [
  { label: 'Share Tech Mono',  value: "'Share Tech Mono', monospace" },
  { label: 'Space Mono',       value: "'Space Mono', monospace" },
  { label: 'Fira Code',        value: "'Fira Code', monospace" },
  { label: 'JetBrains Mono',   value: "'JetBrains Mono', monospace" },
  { label: 'Courier New',      value: "'Courier New', monospace" },
  { label: 'IBM Plex Mono',    value: "'IBM Plex Mono', monospace" },
];
const COND_FONTS = [
  { label: 'Barlow Condensed', value: "'Barlow Condensed', sans-serif" },
  { label: 'Oswald',           value: "'Oswald', sans-serif" },
  { label: 'Bebas Neue',       value: "'Bebas Neue', cursive" },
  { label: 'Rajdhani',         value: "'Rajdhani', sans-serif" },
  { label: 'Exo 2',            value: "'Exo 2', sans-serif" },
  { label: 'Chakra Petch',     value: "'Chakra Petch', sans-serif" },
];
const SANS_FONTS = [
  { label: 'Barlow',           value: "'Barlow', sans-serif" },
  { label: 'Inter',            value: "'Inter', sans-serif" },
  { label: 'DM Sans',          value: "'DM Sans', sans-serif" },
  { label: 'Outfit',           value: "'Outfit', sans-serif" },
  { label: 'Plus Jakarta Sans',value: "'Plus Jakarta Sans', sans-serif" },
  { label: 'Nunito',           value: "'Nunito', sans-serif" },
];

// Google Fonts import IDs mapped from font names
const GFONT_IMPORTS = {
  'Space Mono':         'https://fonts.googleapis.com/css2?family=Space+Mono&display=swap',
  'Fira Code':          'https://fonts.googleapis.com/css2?family=Fira+Code&display=swap',
  'JetBrains Mono':     'https://fonts.googleapis.com/css2?family=JetBrains+Mono&display=swap',
  'IBM Plex Mono':      'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono&display=swap',
  'Oswald':             'https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&display=swap',
  'Bebas Neue':         'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap',
  'Rajdhani':           'https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&display=swap',
  'Exo 2':              'https://fonts.googleapis.com/css2?family=Exo+2:wght@300;400;600;700&display=swap',
  'Chakra Petch':       'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;600;700&display=swap',
  'Inter':              'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap',
  'DM Sans':            'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&display=swap',
  'Outfit':             'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500&display=swap',
  'Plus Jakarta Sans':  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500&display=swap',
  'Nunito':             'https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;600&display=swap',
};

// ── State ─────────────────────────────────────────────────────────────────────
let _uieColors = {};
let _uieFonts  = {};
let _uieMisc   = {};

// ── Bootstrap: apply saved overrides on page load ─────────────────────────────
(function uieBootstrap() {
  try {
    const raw = localStorage.getItem(UIE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.colors) {
      Object.entries(saved.colors).forEach(([k, v]) => {
        document.documentElement.style.setProperty(k, v);
      });
    }
    if (saved.fonts) {
      Object.entries(saved.fonts).forEach(([k, v]) => {
        document.documentElement.style.setProperty(k, v);
        _ensureFontImport(v);
      });
    }
    if (saved.misc) {
      _uieMisc = { ...UIE_MISC_DEFAULTS, ...saved.misc };
      if (saved.misc['logo-eyebrow'] != null) {
        const el = document.querySelector('.logo-eyebrow');
        if (el) el.textContent = saved.misc['logo-eyebrow'];
      }
      if (saved.misc['logo-title'] != null) {
        const el = document.querySelector('.logo-title');
        if (el) el.textContent = saved.misc['logo-title'];
      }
      if (saved.misc['scanlines'] === false) {
        document.body.classList.add('no-scanlines');
      }
    }

    // Restore theme class (specifically for Argentina effects)
    if (_uieColors['--bg'] === '#050b18') {
      document.body.classList.add('theme-argentina');
    }
  } catch(e) { /* silent */ }
})();

function _ensureFontImport(fontValue) {
  const match = fontValue.match(/'([^']+)'/);
  if (!match) return;
  const name = match[1];
  const url  = GFONT_IMPORTS[name];
  if (!url) return;
  const linkId = 'uie-font-' + name.replace(/\s/g, '-');
  if (!document.getElementById(linkId)) {
    const link = document.createElement('link');
    link.id   = linkId;
    link.rel  = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
  }
}

// ── Render the editor UI ──────────────────────────────────────────────────────
function uiEditorInit() {
  try {
    const raw = localStorage.getItem(UIE_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    _uieColors = { ...UIE_DEFAULTS,      ...(saved.colors || {}) };
    _uieFonts  = { ...UIE_FONT_DEFAULTS, ...(saved.fonts  || {}) };
    _uieMisc   = { ...UIE_MISC_DEFAULTS, ...(saved.misc   || {}) };
  } catch(e) {
    _uieColors = { ...UIE_DEFAULTS };
    _uieFonts  = { ...UIE_FONT_DEFAULTS };
    _uieMisc   = { ...UIE_MISC_DEFAULTS };
  }

  _renderColorSection('uie-colors', [
    { var: '--bg',      label: 'Background' },
    { var: '--surface', label: 'Surface' },
    { var: '--card',    label: 'Card' },
    { var: '--border',  label: 'Border' },
    { var: '--text',    label: 'Text' },
    { var: '--subtext', label: 'Subtext' },
    { var: '--dim',     label: 'Dim / Muted' },
  ]);

  _renderColorSection('uie-accents', [
    { var: '--accent',  label: 'Accent (primary)' },
    { var: '--accent2', label: 'Accent 2 (blue)' },
  ]);

  _renderColorSection('uie-status', [
    { var: '--green',  label: 'Green / On-Time' },
    { var: '--yellow', label: 'Yellow / Delayed' },
    { var: '--red',    label: 'Red / Cancelled' },
    { var: '--blue',   label: 'Blue / Info' },
  ]);

  _renderFontSection();
  _renderMiscSection();
}

function _renderColorSection(containerId, vars) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = vars.map(({ var: v, label }) => {
    const hex = _uieColors[v] || '#000000';
    return `<div class="uie-row">
      <span class="uie-label">${label}<br><span style="color:var(--dim);font-size:9px">${v}</span></span>
      <div class="uie-color-wrap">
        <input type="color" value="${hex}" oninput="uieColorInput(this,'${v}')" id="uie-clr${v}" />
        <input type="text"  value="${hex}" class="uie-hex" maxlength="7"
               oninput="uieHexInput(this,'${v}')" id="uie-hex${v}" />
      </div>
    </div>`;
  }).join('');
}

function _renderFontSection() {
  const el = document.getElementById('uie-fonts');
  if (!el) return;

  const mkSelect = (cssVar, options, currentVal) => {
    const opts = options.map(o =>
      `<option value="${o.value}" ${o.value === currentVal ? 'selected' : ''}>${o.label}</option>`
    ).join('');
    return `<select class="uie-font-select" onchange="uieFontChange(this,'${cssVar}')">${opts}</select>`;
  };

  el.innerHTML = `
    <div class="uie-row">
      <span class="uie-label">Mono<br><span style="color:var(--dim);font-size:9px">--mono</span></span>
      ${mkSelect('--mono', MONO_FONTS, _uieFonts['--mono'])}
    </div>
    <div class="uie-row">
      <span class="uie-label">Condensed<br><span style="color:var(--dim);font-size:9px">--cond</span></span>
      ${mkSelect('--cond', COND_FONTS, _uieFonts['--cond'])}
    </div>
    <div class="uie-row">
      <span class="uie-label">Sans-Serif<br><span style="color:var(--dim);font-size:9px">--sans</span></span>
      ${mkSelect('--sans', SANS_FONTS, _uieFonts['--sans'])}
    </div>
  `;
}

// ── Preset groups for the dropdown ────────────────────────────────────────────
const UIE_PRESET_GROUPS = [
  {
    label: 'Defaults',
    presets: ['dark', 'light'],
  },
  {
    label: 'Dark Variants',
    presets: ['midnight', 'abyss', 'obsidian', 'void', 'noir', 'carbon'],
  },
  {
    label: 'Retro & Specialty',
    presets: ['vaporwave', 'cyberpunk', 'nord', 'matrix', 'synthwave', 'solarized-dark', 'monokai', 'gameboy'],
  },
  {
    label: 'Nature & Tones',
    presets: ['tundra', 'sahara', 'jungle', 'ocean'],
  },
  {
    label: 'Luxury & Premium',
    presets: ['onyx-gold', 'platinum'],
  },
  {
    label: 'High Contrast',
    presets: ['neon-burn', 'whiteout'],
  },
  {
    label: 'Coloured Dark',
    presets: ['terminal', 'slate', 'crimson', 'sapphire', 'ember', 'aurora', 'cobalt', 'forest', 'rust'],
  },
  {
    label: 'Pink & Rose',
    presets: ['bubblegum', 'sakura', 'neon-pink', 'rose-noir', 'flamingo', 'cotton-candy'],
  },
  {
    label: 'World Themes',
    presets: ['argentina'],
  },
  {
    label: 'Airline Themed',
    presets: ['aircanada', 'lufthansa', 'britishairways', 'emirates', 'delta', 'united', 'singapore', 'airfrance', 'cathay', 'qantas', 'aerolineas-argentinas', 'westjet', 'klm', 'qatar', 'latam'],
  },
  {
    label: 'Light Variants',
    presets: ['paper', 'frost', 'cream', 'blush'],
  },
];

function _renderMiscSection() {
  const el = document.getElementById('uie-misc');
  if (!el) return;

  // Build grouped <optgroup> options for presets dropdown
  const groupOptions = UIE_PRESET_GROUPS.map(group => {
    const opts = group.presets.map(p => {
      const label = p.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return `<option value="${p}">${label}</option>`;
    }).join('');
    return `<optgroup label="${group.label}">${opts}</optgroup>`;
  }).join('');

  el.innerHTML = `
    <div class="uie-misc-row">
      <label>Logo eyebrow text</label>
      <input type="text" id="uie-misc-eyebrow"
             value="${escapeHtml(_uieMisc['logo-eyebrow'] || '')}"
             oninput="uieMiscText(this,'logo-eyebrow')" style="width:220px" />
    </div>
    <div class="uie-misc-row">
      <label>Logo title text</label>
      <input type="text" id="uie-misc-title"
             value="${escapeHtml(_uieMisc['logo-title'] || '')}"
             oninput="uieMiscText(this,'logo-title')" style="width:220px" />
    </div>
    <div class="uie-misc-row">
      <label>Scanline overlay</label>
      <input type="checkbox" id="uie-misc-scanlines"
             ${_uieMisc['scanlines'] !== false ? 'checked' : ''}
             onchange="uieMiscScanlines(this)" />
    </div>
    <div class="uie-misc-row" style="margin-top:8px;border-top:1px solid var(--border);flex-direction:column;align-items:flex-start;gap:8px">
      <label style="color:var(--subtext)">PRESETS</label>
      <div style="display:flex;gap:8px;align-items:center;width:100%">
        <select id="uie-preset-select" class="uie-font-select" style="flex:1"
                onchange="uiePresetFromDropdown(this)">
          <option value="">— select a preset —</option>
          ${groupOptions}
        </select>
        <button class="btn-ghost" style="font-size:10px;padding:4px 12px;white-space:nowrap"
                onclick="uieApplySelectedPreset()">Apply</button>
      </div>
      <div id="uie-preset-preview" style="font-family:var(--mono);font-size:9px;color:var(--dim);min-height:12px"></div>
    </div>
  `;
}

function uiePresetFromDropdown(select) {
  const name = select.value;
  if (!name) {
    const preview = document.getElementById('uie-preset-preview');
    if (preview) preview.textContent = '';
    return;
  }
  // Show accent swatch preview
  const preset = UIE_PRESETS[name];
  const preview = document.getElementById('uie-preset-preview');
  if (preview && preset) {
    const swatches = ['--bg','--surface','--accent','--accent2','--green','--yellow','--red']
      .map(v => `<span style="display:inline-block;width:14px;height:14px;border-radius:2px;background:${preset[v] || '#333'};margin-right:2px;vertical-align:middle"></span>`)
      .join('');
    preview.innerHTML = swatches + `<span style="margin-left:6px;vertical-align:middle">${name}</span>`;
  }
}

function uieApplySelectedPreset() {
  const select = document.getElementById('uie-preset-select');
  if (!select || !select.value) return;
  uiePreset(select.value);
  // Reset dropdown to placeholder after apply
  select.value = '';
  const preview = document.getElementById('uie-preset-preview');
  if (preview) preview.textContent = '';
}

// ── Input handlers ────────────────────────────────────────────────────────────
function uieColorInput(picker, cssVar) {
  const hex = picker.value;
  _uieColors[cssVar] = hex;
  const hexInput = document.getElementById('uie-hex' + cssVar);
  if (hexInput) hexInput.value = hex;
  document.documentElement.style.setProperty(cssVar, hex);
}

function uieHexInput(input, cssVar) {
  let val = input.value.trim();
  if (!val.startsWith('#')) val = '#' + val;
  if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
  _uieColors[cssVar] = val;
  const picker = document.getElementById('uie-clr' + cssVar);
  if (picker) picker.value = val;
  document.documentElement.style.setProperty(cssVar, val);
}

function uieFontChange(select, cssVar) {
  const val = select.value;
  _uieFonts[cssVar] = val;
  document.documentElement.style.setProperty(cssVar, val);
  _ensureFontImport(val);
}

function uieMiscText(input, key) {
  _uieMisc[key] = input.value;
  if (key === 'logo-eyebrow') {
    const el = document.querySelector('.logo-eyebrow');
    if (el) el.textContent = input.value;
  }
  if (key === 'logo-title') {
    const el = document.querySelector('.logo-title');
    if (el) el.textContent = input.value;
  }
}

function uieMiscScanlines(checkbox) {
  _uieMisc['scanlines'] = checkbox.checked;
  if (checkbox.checked) {
    document.body.classList.remove('no-scanlines');
  } else {
    document.body.classList.add('no-scanlines');
  }
}

// ── Presets ───────────────────────────────────────────────────────────────────
const UIE_PRESETS = {

  // ── Defaults ─────────────────────────────────────────────────────────────────
  dark: {
    '--bg': '#050608', '--surface': '#0c0e14', '--card': '#10131c',
    '--border': '#1c2235', '--text': '#d6daf0', '--subtext': '#6b7494',
    '--dim': '#4a5275', '--accent': '#c8102e', '--accent2': '#0055a5',
    '--green': '#00e676', '--yellow': '#ffd740', '--red': '#ff1744', '--blue': '#448aff',
  },
  light: {
    '--bg': '#f5f6fa', '--surface': '#ffffff', '--card': '#ffffff',
    '--border': '#e3e6f0', '--text': '#0d0f18', '--subtext': '#505570',
    '--dim': '#9fa6c0', '--accent': '#b81b1b', '--accent2': '#1847d1',
    '--green': '#157a3a', '--yellow': '#8a3d0a', '--red': '#b81b1b', '--blue': '#1847d1',
  },

  // ── Dark variants ─────────────────────────────────────────────────────────────
  midnight: {
    '--bg': '#020510', '--surface': '#060d1f', '--card': '#0b1428',
    '--border': '#142040', '--text': '#c8d8f8', '--subtext': '#5870a8',
    '--dim': '#334470', '--accent': '#3a7aff', '--accent2': '#00cfff',
    '--green': '#00e5aa', '--yellow': '#ffd060', '--red': '#ff4060', '--blue': '#60a8ff',
  },
  abyss: {
    '--bg': '#000000', '--surface': '#050505', '--card': '#0a0a0a',
    '--border': '#181818', '--text': '#e8e8e8', '--subtext': '#555555',
    '--dim': '#333333', '--accent': '#ff2d55', '--accent2': '#0a84ff',
    '--green': '#30d158', '--yellow': '#ffd60a', '--red': '#ff453a', '--blue': '#0a84ff',
  },
  obsidian: {
    '--bg': '#080808', '--surface': '#101010', '--card': '#161616',
    '--border': '#222222', '--text': '#f0f0f0', '--subtext': '#666666',
    '--dim': '#3a3a3a', '--accent': '#e8a000', '--accent2': '#c87000',
    '--green': '#00d68f', '--yellow': '#ffcc00', '--red': '#ff3b30', '--blue': '#5ac8fa',
  },
  void: {
    '--bg': '#03000a', '--surface': '#07001a', '--card': '#0e002e',
    '--border': '#1a0050', '--text': '#e0d0ff', '--subtext': '#7050a0',
    '--dim': '#3a1a6a', '--accent': '#b060ff', '--accent2': '#6020d0',
    '--green': '#40ffb0', '--yellow': '#ffd040', '--red': '#ff3060', '--blue': '#60a0ff',
  },
  noir: {
    '--bg': '#0a0a08', '--surface': '#121210', '--card': '#1a1a18',
    '--border': '#2a2a28', '--text': '#ede8d8', '--subtext': '#7a7060',
    '--dim': '#404038', '--accent': '#d4a843', '--accent2': '#8a6a20',
    '--green': '#7acc60', '--yellow': '#e8c840', '--red': '#cc4433', '--blue': '#6090c0',
  },
  carbon: {
    '--bg': '#0e0e0e', '--surface': '#181818', '--card': '#202020',
    '--border': '#303030', '--text': '#f2f2f2', '--subtext': '#888888',
    '--dim': '#505050', '--accent': '#00ff99', '--accent2': '#00cc77',
    '--green': '#00ff99', '--yellow': '#ffee44', '--red': '#ff4422', '--blue': '#33aaff',
  },

  // ── Retro & Specialty ───────────────────────────────────────────────────────
  vaporwave: {
    '--bg': '#120422', '--surface': '#1a0633', '--card': '#240b45',
    '--border': '#3d156b', '--text': '#ffffff', '--subtext': '#ff71ce',
    '--dim': '#b967ff', '--accent': '#01cdfe', '--accent2': '#ff71ce',
    '--green': '#05ffa1', '--yellow': '#fff685', '--red': '#ff4911', '--blue': '#01cdfe',
  },
  cyberpunk: {
    '--bg': '#000000', '--surface': '#050505', '--card': '#101010',
    '--border': '#fcee0a', '--text': '#fcee0a', '--subtext': '#00f0ff',
    '--dim': '#ff003c', '--accent': '#fcee0a', '--accent2': '#00f0ff',
    '--green': '#00f0ff', '--yellow': '#fcee0a', '--red': '#ff003c', '--blue': '#00f0ff',
  },
  nord: {
    '--bg': '#2e3440', '--surface': '#3b4252', '--card': '#434c5e',
    '--border': '#4c566a', '--text': '#eceff4', '--subtext': '#d8dee9',
    '--dim': '#a3be8c', '--accent': '#88c0d0', '--accent2': '#81a1c1',
    '--green': '#a3be8c', '--yellow': '#ebcb8b', '--red': '#bf616a', '--blue': '#81a1c1',
  },
  matrix: {
    '--bg': '#000000', '--surface': '#050505', '--card': '#0a0a0a',
    '--border': '#003b00', '--text': '#00ff41', '--subtext': '#008f11',
    '--dim': '#003b00', '--accent': '#00ff41', '--accent2': '#008f11',
    '--green': '#00ff41', '--yellow': '#ccff00', '--red': '#ff0000', '--blue': '#003b00',
  },
  synthwave: {
    '--bg': '#1a0633', '--surface': '#240b45', '--card': '#2d1254',
    '--border': '#4a1b8a', '--text': '#ffffff', '--subtext': '#ff71ce',
    '--dim': '#b967ff', '--accent': '#f3ea5f', '--accent2': '#01cdfe',
    '--green': '#05ffa1', '--yellow': '#f3ea5f', '--red': '#ff0055', '--blue': '#01cdfe',
  },
  'solarized-dark': {
    '--bg': '#002b36', '--surface': '#073642', '--card': '#002b36',
    '--border': '#586e75', '--text': '#839496', '--subtext': '#657b83',
    '--dim': '#586e75', '--accent': '#268bd2', '--accent2': '#d33682',
    '--green': '#859900', '--yellow': '#b58900', '--red': '#dc322f', '--blue': '#268bd2',
  },
  monokai: {
    '--bg': '#272822', '--surface': '#3e3d32', '--card': '#272822',
    '--border': '#49483e', '--text': '#f8f8f2', '--subtext': '#75715e',
    '--dim': '#49483e', '--accent': '#f92672', '--accent2': '#66d9ef',
    '--green': '#a6e22e', '--yellow': '#e6db74', '--red': '#ae81ff', '--blue': '#66d9ef',
  },
  gameboy: {
    '--bg': '#0f380f', '--surface': '#306230', '--card': '#8bac0f',
    '--border': '#9bbc0f', '--text': '#0f380f', '--subtext': '#306230',
    '--dim': '#8bac0f', '--accent': '#0f380f', '--accent2': '#306230',
    '--green': '#8bac0f', '--yellow': '#9bbc0f', '--red': '#0f380f', '--blue': '#306230',
  },

  // ── Nature & Tones ──────────────────────────────────────────────────────────
  tundra: {
    '--bg': '#1c1e26', '--surface': '#232530', '--card': '#2e303e',
    '--border': '#3b3e51', '--text': '#e0e0e0', '--subtext': '#9194a2',
    '--dim': '#6b6f81', '--accent': '#6cb6eb', '--accent2': '#e3eaf2',
    '--green': '#81b29a', '--yellow': '#f2cc8f', '--red': '#e07a5f', '--blue': '#3d5a80',
  },
  sahara: {
    '--bg': '#1a110a', '--surface': '#2d1b0e', '--card': '#3d2b1f',
    '--border': '#4d3b2f', '--text': '#f5e6d3', '--subtext': '#c4a484',
    '--dim': '#8b5e3c', '--accent': '#e67e22', '--accent2': '#d35400',
    '--green': '#27ae60', '--yellow': '#f1c40f', '--red': '#c0392b', '--blue': '#2980b9',
  },
  jungle: {
    '--bg': '#050f05', '--surface': '#0a1a0a', '--card': '#102610',
    '--border': '#1a3b1a', '--text': '#e0f0e0', '--subtext': '#4a7a4a',
    '--dim': '#244a24', '--accent': '#27ae60', '--accent2': '#2ecc71',
    '--green': '#2ecc71', '--yellow': '#f1c40f', '--red': '#e74c3c', '--blue': '#3498db',
  },
  ocean: {
    '--bg': '#001219', '--surface': '#005f73', '--card': '#0a9396',
    '--border': '#94d2bd', '--text': '#e9d8a6', '--subtext': '#ee9b00',
    '--dim': '#ca6702', '--accent': '#005f73', '--accent2': '#94d2bd',
    '--green': '#94d2bd', '--yellow': '#e9d8a6', '--red': '#ae2012', '--blue': '#005f73',
  },

  // ── Luxury & Premium ────────────────────────────────────────────────────────
  'onyx-gold': {
    '--bg': '#050505', '--surface': '#0f0f0f', '--card': '#161616',
    '--border': '#262626', '--text': '#f5f5f5', '--subtext': '#a6a6a6',
    '--dim': '#525252', '--accent': '#d4af37', '--accent2': '#aa8800',
    '--green': '#c5a028', '--yellow': '#d4af37', '--red': '#800000', '--blue': '#000080',
  },
  platinum: {
    '--bg': '#0a0b10', '--surface': '#141620', '--card': '#1e2230',
    '--border': '#2e3440', '--text': '#e5e9f0', '--subtext': '#8186a0',
    '--dim': '#4c566a', '--accent': '#e5e9f0', '--accent2': '#88c0d0',
    '--green': '#a3be8c', '--yellow': '#ebcb8b', '--red': '#bf616a', '--blue': '#81a1c1',
  },

  // ── High Contrast ───────────────────────────────────────────────────────────
  'neon-burn': {
    '--bg': '#000000', '--surface': '#000000', '--card': '#000000',
    '--border': '#ffffff', '--text': '#ffffff', '--subtext': '#00ff00',
    '--dim': '#ff00ff', '--accent': '#ffff00', '--accent2': '#00ffff',
    '--green': '#00ff00', '--yellow': '#ffff00', '--red': '#ff0000', '--blue': '#0000ff',
  },
  whiteout: {
    '--bg': '#ffffff', '--surface': '#f5f5f5', '--card': '#ffffff',
    '--border': '#000000', '--text': '#000000', '--subtext': '#555555',
    '--dim': '#999999', '--accent': '#000000', '--accent2': '#333333',
    '--green': '#00aa00', '--yellow': '#aa8800', '--red': '#aa0000', '--blue': '#0000aa',
  },

  // ── Coloured Dark ───────────────────────────────────────────────────────────
  terminal: {
    '--bg': '#020a02', '--surface': '#071007', '--card': '#0c160c',
    '--border': '#1a2e1a', '--text': '#a0ffb0', '--subtext': '#3d7a4a',
    '--dim': '#244a2a', '--accent': '#00e640', '--accent2': '#00cc88',
    '--green': '#00ff60', '--yellow': '#d4ff40', '--red': '#ff4040', '--blue': '#40ffcc',
  },
  slate: {
    '--bg': '#0d1117', '--surface': '#161b22', '--card': '#1c2230',
    '--border': '#2a3344', '--text': '#e6edf3', '--subtext': '#7d8590',
    '--dim': '#3a4455', '--accent': '#f78166', '--accent2': '#58a6ff',
    '--green': '#3fb950', '--yellow': '#d29922', '--red': '#f85149', '--blue': '#58a6ff',
  },
  crimson: {
    '--bg': '#0a0205', '--surface': '#150308', '--card': '#1e040c',
    '--border': '#350818', '--text': '#f0d8dc', '--subtext': '#8a4455',
    '--dim': '#4a2030', '--accent': '#ff1a44', '--accent2': '#cc0030',
    '--green': '#00e676', '--yellow': '#ffd740', '--red': '#ff5252', '--blue': '#ff80ab',
  },
  sapphire: {
    '--bg': '#020610', '--surface': '#040d20', '--card': '#061530',
    '--border': '#0c2248', '--text': '#d0e8ff', '--subtext': '#4878b0',
    '--dim': '#1a3a6a', '--accent': '#00aaff', '--accent2': '#0066cc',
    '--green': '#00e5ff', '--yellow': '#ffe066', '--red': '#ff4488', '--blue': '#44aaff',
  },
  ember: {
    '--bg': '#0c0600', '--surface': '#180c00', '--card': '#221200',
    '--border': '#3a1e00', '--text': '#ffe8c8', '--subtext': '#a06030',
    '--dim': '#5a3010', '--accent': '#ff7700', '--accent2': '#cc4400',
    '--green': '#88dd44', '--yellow': '#ffcc00', '--red': '#ff3300', '--blue': '#44aacc',
  },
  aurora: {
    '--bg': '#030a0a', '--surface': '#061414', '--card': '#0a1e1e',
    '--border': '#103030', '--text': '#c8ffe8', '--subtext': '#3a8a70',
    '--dim': '#1a4a38', '--accent': '#00ffcc', '--accent2': '#00cc99',
    '--green': '#00ff88', '--yellow': '#aaff44', '--red': '#ff4488', '--blue': '#44ccff',
  },
  cobalt: {
    '--bg': '#040810', '--surface': '#080f20', '--card': '#0d1730',
    '--border': '#162540', '--text': '#d8e8ff', '--subtext': '#4a6aaa',
    '--dim': '#2a3a66', '--accent': '#4488ff', '--accent2': '#2255dd',
    '--green': '#44ddaa', '--yellow': '#ffdd44', '--red': '#ff4466', '--blue': '#6699ff',
  },
  forest: {
    '--bg': '#030a04', '--surface': '#071208', '--card': '#0c1a0e',
    '--border': '#142818', '--text': '#d0f0d8', '--subtext': '#4a7a55',
    '--dim': '#224a2a', '--accent': '#44cc66', '--accent2': '#228844',
    '--green': '#66ff88', '--yellow': '#ccff44', '--red': '#ff4455', '--blue': '#44ccbb',
  },
  rust: {
    '--bg': '#0a0602', '--surface': '#160c04', '--card': '#1e1008',
    '--border': '#2e1a0c', '--text': '#f0dcc8', '--subtext': '#8a6040',
    '--dim': '#4a2e18', '--accent': '#cc5500', '--accent2': '#ff8833',
    '--green': '#88cc44', '--yellow': '#ffaa00', '--red': '#ff3300', '--blue': '#44aacc',
  },

  // ── Pink & Rose ───────────────────────────────────────────────────────────────
  bubblegum: {
    '--bg': '#08020a', '--surface': '#110516', '--card': '#18091f',
    '--border': '#2e0d3d', '--text': '#fce8ff', '--subtext': '#b060cc',
    '--dim': '#5a1a70', '--accent': '#ff1aaa', '--accent2': '#cc0088',
    '--green': '#44ffaa', '--yellow': '#ffee44', '--red': '#ff3366', '--blue': '#aa44ff',
  },
  sakura: {
    '--bg': '#0c0608', '--surface': '#160d10', '--card': '#1e1218',
    '--border': '#341820', '--text': '#fce8ec', '--subtext': '#a06070',
    '--dim': '#5a2a35', '--accent': '#ff6688', '--accent2': '#cc3355',
    '--green': '#88ddaa', '--yellow': '#ffcc88', '--red': '#ff4466', '--blue': '#bb88ff',
  },
  'neon-pink': {
    '--bg': '#040204', '--surface': '#0a040a', '--card': '#100610',
    '--border': '#220a22', '--text': '#ffe0f8', '--subtext': '#cc44aa',
    '--dim': '#660055', '--accent': '#ff00cc', '--accent2': '#ff44ff',
    '--green': '#00ffcc', '--yellow': '#ffff00', '--red': '#ff0066', '--blue': '#44ddff',
  },
  'rose-noir': {
    '--bg': '#080506', '--surface': '#100a0c', '--card': '#180e12',
    '--border': '#2a161c', '--text': '#f0dce0', '--subtext': '#806068',
    '--dim': '#3a2428', '--accent': '#e05070', '--accent2': '#aa2244',
    '--green': '#70cc88', '--yellow': '#ddbb66', '--red': '#ee4466', '--blue': '#8899ee',
  },
  flamingo: {
    '--bg': '#0c0504', '--surface': '#180a08', '--card': '#220e0c',
    '--border': '#3a1614', '--text': '#ffecea', '--subtext': '#bb5555',
    '--dim': '#5a2020', '--accent': '#ff5577', '--accent2': '#ff8866',
    '--green': '#66dd88', '--yellow': '#ffcc44', '--red': '#ff3344', '--blue': '#66aaff',
  },
  'cotton-candy': {
    '--bg': '#07060c', '--surface': '#0f0c18', '--card': '#161224',
    '--border': '#261c3a', '--text': '#f8eeff', '--subtext': '#9980cc',
    '--dim': '#4a3370', '--accent': '#ff88cc', '--accent2': '#cc66ff',
    '--green': '#88ffcc', '--yellow': '#ffeeaa', '--red': '#ff66aa', '--blue': '#88ccff',
  },

  // ── World Themes ────────────────────────────────────────────────────────────
  argentina: {
    '--bg': '#050b18', '--surface': '#0a1428', '--card': '#0c1c38',
    '--border': '#74acdf', '--text': '#ffffff', '--subtext': '#a0c0e0',
    '--dim': '#4a5a7a', '--accent': '#74acdf', '--accent2': '#f6b40e',
    '--green': '#2a9d8f', '--yellow': '#f6b40e', '--red': '#e76f51', '--blue': '#0077b6',
  },

  // ── Airline themed ────────────────────────────────────────────────────────────
  'aerolineas-argentinas': {
    '--bg': '#050a14', '--surface': '#0c1626', '--card': '#101e30',
    '--border': '#005aa9', '--text': '#ffffff', '--subtext': '#a0c8e8',
    '--dim': '#406080', '--accent': '#005aa9', '--accent2': '#ffcc00',
    '--green': '#00a651', '--yellow': '#ffcc00', '--red': '#ed1c24', '--blue': '#005aa9',
  },
  westjet: {
    '--bg': '#002f5d', '--surface': '#003a70', '--card': '#004a8f',
    '--border': '#00a3ad', '--text': '#ffffff', '--subtext': '#00a3ad',
    '--dim': '#005aa9', '--accent': '#00a3ad', '--accent2': '#007fa3',
    '--green': '#2ecc71', '--yellow': '#f1c40f', '--red': '#e74c3c', '--blue': '#3498db',
  },
  klm: {
    '--bg': '#ffffff', '--surface': '#f0f8ff', '--card': '#ffffff',
    '--border': '#00a1de', '--text': '#003a70', '--subtext': '#00a1de',
    '--dim': '#91d2ef', '--accent': '#00a1de', '--accent2': '#003a70',
    '--green': '#2ecc71', '--yellow': '#f1c40f', '--red': '#e74c3c', '--blue': '#00a1de',
  },
  qatar: {
    '--bg': '#5c0632', '--surface': '#7a0843', '--card': '#940a52',
    '--border': '#ffffff', '--text': '#ffffff', '--subtext': '#e0d0d8',
    '--dim': '#3d0421', '--accent': '#ffffff', '--accent2': '#5c0632',
    '--green': '#2ecc71', '--yellow': '#f1c40f', '--red': '#e74c3c', '--blue': '#3498db',
  },
  latam: {
    '--bg': '#1b1464', '--surface': '#251c8a', '--card': '#2f24b0',
    '--border': '#e41c3d', '--text': '#ffffff', '--subtext': '#e41c3d',
    '--dim': '#100c3b', '--accent': '#e41c3d', '--accent2': '#ffffff',
    '--green': '#2ecc71', '--yellow': '#f1c40f', '--red': '#e74c3c', '--blue': '#3498db',
  },
  aircanada: {
    '--bg': '#050608', '--surface': '#0c0e14', '--card': '#10131c',
    '--border': '#1c2235', '--text': '#d6daf0', '--subtext': '#6b7494',
    '--dim': '#4a5275', '--accent': '#c8102e', '--accent2': '#0055a5',
    '--green': '#00e676', '--yellow': '#ffd740', '--red': '#ff1744', '--blue': '#448aff',
  },
  lufthansa: {
    '--bg': '#020408', '--surface': '#060c18', '--card': '#0c1428',
    '--border': '#142038', '--text': '#d8e8f8', '--subtext': '#5878a8',
    '--dim': '#2a3f60', '--accent': '#ffcc00', '--accent2': '#0050aa',
    '--green': '#00cc66', '--yellow': '#ffcc00', '--red': '#ff3333', '--blue': '#3388ff',
  },
  britishairways: {
    '--bg': '#02040c', '--surface': '#06091a', '--card': '#0c1028',
    '--border': '#141c3a', '--text': '#e0e8f8', '--subtext': '#5060a0',
    '--dim': '#282f55', '--accent': '#eb2226', '--accent2': '#0a1f6e',
    '--green': '#00b86e', '--yellow': '#f0c400', '--red': '#eb2226', '--blue': '#4488ff',
  },
  emirates: {
    '--bg': '#060402', '--surface': '#100800', '--card': '#180c00',
    '--border': '#2a1400', '--text': '#f8ecd0', '--subtext': '#a07840',
    '--dim': '#5a3c10', '--accent': '#cc2222', '--accent2': '#d4a800',
    '--green': '#44cc66', '--yellow': '#d4a800', '--red': '#cc2222', '--blue': '#4488cc',
  },
  delta: {
    '--bg': '#02040a', '--surface': '#060b18', '--card': '#0a1025',
    '--border': '#101a38', '--text': '#dce6f8', '--subtext': '#4a6090',
    '--dim': '#243050', '--accent': '#e31837', '--accent2': '#003366',
    '--green': '#00aa55', '--yellow': '#ffbb00', '--red': '#e31837', '--blue': '#0055bb',
  },
  united: {
    '--bg': '#020408', '--surface': '#050a14', '--card': '#08101e',
    '--border': '#101828', '--text': '#d8e4f4', '--subtext': '#4a6488',
    '--dim': '#243250', '--accent': '#005daa', '--accent2': '#1a3a6a',
    '--green': '#00aa66', '--yellow': '#ffcc22', '--red': '#cc2222', '--blue': '#0077cc',
  },
  singapore: {
    '--bg': '#040208', '--surface': '#0c0618', '--card': '#140a22',
    '--border': '#220f38', '--text': '#f0e8ff', '--subtext': '#8060a8',
    '--dim': '#402860', '--accent': '#f0a000', '--accent2': '#1a0066',
    '--green': '#00dd88', '--yellow': '#f0a000', '--red': '#ee2244', '--blue': '#6644ff',
  },
  airfrance: {
    '--bg': '#020408', '--surface': '#050b18', '--card': '#091328',
    '--border': '#101e40', '--text': '#e0eaff', '--subtext': '#4a6aaa',
    '--dim': '#1e3060', '--accent': '#002f87', '--accent2': '#006fc8',
    '--green': '#00bb88', '--yellow': '#ffcc44', '--red': '#dd2244', '--blue': '#3388ee',
  },
  cathay: {
    '--bg': '#020806', '--surface': '#051210', '--card': '#091c18',
    '--border': '#102c28', '--text': '#d0f0e8', '--subtext': '#3a7a6a',
    '--dim': '#1a4a3e', '--accent': '#006c5a', '--accent2': '#00a880',
    '--green': '#00dd88', '--yellow': '#ffcc44', '--red': '#ff4455', '--blue': '#44aacc',
  },
  qantas: {
    '--bg': '#070202', '--surface': '#120404', '--card': '#1a0606',
    '--border': '#2e0c0c', '--text': '#fff0f0', '--subtext': '#aa4444',
    '--dim': '#5a1818', '--accent': '#ee1111', '--accent2': '#ff5533',
    '--green': '#44cc66', '--yellow': '#ffcc22', '--red': '#ff1111', '--blue': '#4488ff',
  },

  // ── Light variants ────────────────────────────────────────────────────────────
  paper: {
    '--bg': '#faf8f4', '--surface': '#f4f0e8', '--card': '#eeead8',
    '--border': '#d8d0b8', '--text': '#1a1408', '--subtext': '#6a5a40',
    '--dim': '#aaa090', '--accent': '#cc3300', '--accent2': '#0044aa',
    '--green': '#226622', '--yellow': '#886600', '--red': '#cc3300', '--blue': '#0044aa',
  },
  frost: {
    '--bg': '#f0f4f8', '--surface': '#e8eef5', '--card': '#dde5ee',
    '--border': '#c4d0de', '--text': '#0a1828', '--subtext': '#4a6080',
    '--dim': '#8aa0b8', '--accent': '#0055cc', '--accent2': '#0088ff',
    '--green': '#007744', '--yellow': '#886600', '--red': '#cc1122', '--blue': '#0055cc',
  },
  cream: {
    '--bg': '#fdf8f2', '--surface': '#f8f1e6', '--card': '#f2e8d8',
    '--border': '#e0d0b8', '--text': '#1a1008', '--subtext': '#7a6040',
    '--dim': '#b8a888', '--accent': '#cc4411', '--accent2': '#886622',
    '--green': '#336622', '--yellow': '#886600', '--red': '#cc2200', '--blue': '#224488',
  },
  blush: {
    // Light pink with dusty rose accents — clean and delicate
    '--bg': '#fdf4f6', '--surface': '#faeaee', '--card': '#f5dfe5',
    '--border': '#e8c8d0', '--text': '#1a080c', '--subtext': '#8a4455',
    '--dim': '#cc99aa', '--accent': '#cc2244', '--accent2': '#aa1166',
    '--green': '#226644', '--yellow': '#886611', '--red': '#cc1133', '--blue': '#334488',
  },
};

function uiePreset(name) {
  const preset = UIE_PRESETS[name];
  if (!preset) return;

  // Clear previous theme classes
  document.body.classList.forEach(cls => {
    if (cls.startsWith('theme-')) document.body.classList.remove(cls);
  });
  document.body.classList.add('theme-' + name);

  // Special overrides
  if (name === 'argentina') {
    _uieMisc['logo-eyebrow'] = 'REPÚBLICA ARGENTINA';
    const el = document.querySelector('.logo-eyebrow');
    if (el) el.textContent = 'REPÚBLICA ARGENTINA';
  }

  Object.entries(preset).forEach(([k, v]) => {
    _uieColors[k] = v;
    document.documentElement.style.setProperty(k, v);
    const picker = document.getElementById('uie-clr' + k);
    const hex    = document.getElementById('uie-hex' + k);
    if (picker) picker.value = v;
    if (hex)    hex.value    = v;
  });
  const displayName = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  showToast(`✓ Preset "${displayName}" applied — hit SAVE to keep it`);
}

// ── Save / Reset / Export ─────────────────────────────────────────────────────
function uiEditorSave() {
  try {
    const data = { colors: { ..._uieColors }, fonts: { ..._uieFonts }, misc: { ..._uieMisc } };
    localStorage.setItem(UIE_KEY, JSON.stringify(data));
    const savedEl = document.getElementById('ui-editor-saved');
    if (savedEl) {
      savedEl.style.display = 'inline';
      setTimeout(() => { savedEl.style.display = 'none'; }, 2500);
    }
    showToast('✅ UI overrides saved');
  } catch(e) {
    logError('uiEditorSave', e);
    showToast('❌ Save failed: ' + e.message, true);
  }
}

function uiEditorReset() {
  if (!confirm('Reset ALL UI overrides to default? This cannot be undone.')) return;
  localStorage.removeItem(UIE_KEY);
  const allVars = [...Object.keys(UIE_DEFAULTS), ...Object.keys(UIE_FONT_DEFAULTS)];
  allVars.forEach(v => document.documentElement.style.removeProperty(v));
  const eyebrow = document.querySelector('.logo-eyebrow');
  const title   = document.querySelector('.logo-title');
  if (eyebrow) eyebrow.textContent = UIE_MISC_DEFAULTS['logo-eyebrow'];
  if (title)   title.textContent   = UIE_MISC_DEFAULTS['logo-title'];
  document.body.classList.remove('no-scanlines');
  document.body.classList.forEach(cls => {
    if (cls.startsWith('theme-')) document.body.classList.remove(cls);
  });
  uiEditorInit();
  showToast('↺ UI reset to defaults');
}

function uiEditorExport() {
  const lines = [':root {'];
  Object.entries(_uieColors).forEach(([k, v]) => lines.push(`  ${k}: ${v};`));
  Object.entries(_uieFonts).forEach(([k, v])  => lines.push(`  ${k}: ${v};`));
  lines.push('}');
  const css = lines.join('\n');
  navigator.clipboard.writeText(css).then(() => {
    showToast('📋 CSS copied to clipboard');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = css;
    ta.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:400px;height:200px;z-index:99999;font-family:monospace;font-size:11px';
    document.body.appendChild(ta);
    ta.select();
    showToast('Select all and copy ↑');
    setTimeout(() => ta.remove(), 8000);
  });
}