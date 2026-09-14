// ─── SOUND ENGINE ─────────────────────────────────────────────────────────────
// All sounds generated via Web Audio API — no external files required.
// Respects a mute toggle stored in localStorage under 'aic_sounds'.

const SFX = (() => {
  let ctx = null;
  let muted = localStorage.getItem('aic_sounds') === 'off';

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ── Core primitives ──────────────────────────────────────────────────────────

  function tone({ freq = 440, type = 'sine', gain = 0.18, attack = 0.005, decay = 0.08, duration = 0.1, detune = 0 } = {}) {
    if (muted) return;
    const c   = getCtx();
    const osc = c.createOscillator();
    const env = c.createGain();

    osc.type    = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    if (detune) osc.detune.setValueAtTime(detune, c.currentTime);
    env.gain.setValueAtTime(0, c.currentTime);
    env.gain.linearRampToValueAtTime(gain, c.currentTime + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + attack + decay);

    osc.connect(env);
    env.connect(c.destination);
    osc.start(c.currentTime);
    osc.stop(c.currentTime + attack + decay + 0.01);
  }

  function noise({ gain = 0.06, attack = 0.001, decay = 0.06, highpass = 800 } = {}) {
    if (muted) return;
    const c      = getCtx();
    const buf    = c.createBuffer(1, c.sampleRate * 0.15, c.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = c.createBufferSource();
    src.buffer = buf;

    const hp  = c.createBiquadFilter();
    hp.type            = 'highpass';
    hp.frequency.value = highpass;

    const env = c.createGain();
    env.gain.setValueAtTime(0, c.currentTime);
    env.gain.linearRampToValueAtTime(gain, c.currentTime + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + attack + decay);

    src.connect(hp);
    hp.connect(env);
    env.connect(c.destination);
    src.start(c.currentTime);
  }

  // ── Named sounds ─────────────────────────────────────────────────────────────

  function tabClick() {
    // Short mechanical tick — low freq thump + very fast noise transient
    tone({ freq: 180, type: 'triangle', gain: 0.12, attack: 0.001, decay: 0.04 });
    noise({ gain: 0.03, attack: 0.001, decay: 0.025, highpass: 2000 });
  }

  function drawerOpen() {
    // Smooth upward swoop
    const c   = getCtx();
    if (muted) return;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, c.currentTime + 0.12);
    env.gain.setValueAtTime(0, c.currentTime);
    env.gain.linearRampToValueAtTime(0.1, c.currentTime + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.18);
    osc.connect(env); env.connect(c.destination);
    osc.start(c.currentTime); osc.stop(c.currentTime + 0.2);
  }

  function drawerClose() {
    // Mirror — downward swoop
    const c   = getCtx();
    if (muted) return;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(380, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, c.currentTime + 0.1);
    env.gain.setValueAtTime(0, c.currentTime);
    env.gain.linearRampToValueAtTime(0.08, c.currentTime + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.15);
    osc.connect(env); env.connect(c.destination);
    osc.start(c.currentTime); osc.stop(c.currentTime + 0.18);
  }

  function saveSuccess() {
    // Two-note confirm chime: root then fifth
    tone({ freq: 523.25, type: 'sine', gain: 0.14, attack: 0.005, decay: 0.22 });
    setTimeout(() => tone({ freq: 783.99, type: 'sine', gain: 0.10, attack: 0.005, decay: 0.28 }), 110);
  }

  function error() {
    // Low dissonant buzz — two slightly detuned sines
    tone({ freq: 130, type: 'sawtooth', gain: 0.10, attack: 0.002, decay: 0.14, detune: 0 });
    tone({ freq: 123, type: 'sawtooth', gain: 0.08, attack: 0.002, decay: 0.14, detune: 15 });
    noise({ gain: 0.04, attack: 0.001, decay: 0.08, highpass: 300 });
  }

  function flightAdded() {
    // Ascending three-note arpeggio — optimistic
    const notes = [392, 523.25, 659.25];
    notes.forEach((freq, i) => {
      setTimeout(() => tone({ freq, type: 'sine', gain: 0.12, attack: 0.005, decay: 0.2 }), i * 80);
    });
  }

  function statusChange() {
    // Single clean ding
    tone({ freq: 660, type: 'sine', gain: 0.12, attack: 0.003, decay: 0.35 });
  }

  function paxSave() {
    // Soft stamp thud
    tone({ freq: 260, type: 'triangle', gain: 0.10, attack: 0.001, decay: 0.07 });
    noise({ gain: 0.025, attack: 0.001, decay: 0.04, highpass: 600 });
  }

  // ── Mute control ─────────────────────────────────────────────────────────────

  function isMuted() { return muted; }

  function toggleMute() {
    muted = !muted;
    localStorage.setItem('aic_sounds', muted ? 'off' : 'on');
    _updateMuteBtn();
    if (!muted) tabClick(); // play a preview click on unmute
  }

  function _updateMuteBtn() {
    const btn = document.getElementById('sound-toggle');
    if (!btn) return;
    btn.textContent = muted ? '🔇' : '🔊';
    btn.title = muted ? 'Sounds off (click to enable)' : 'Sounds on (click to mute)';
    btn.style.opacity = muted ? '0.45' : '1';
  }

  return { tabClick, drawerOpen, drawerClose, saveSuccess, error, flightAdded, statusChange, paxSave, toggleMute, isMuted, _updateMuteBtn };
})();


// ─── INJECT MUTE BUTTON INTO HEADER ──────────────────────────────────────────
(function injectMuteButton() {
  const themeBtn = document.getElementById('theme-toggle');
  if (!themeBtn) return;
  const btn = document.createElement('button');
  btn.id        = 'sound-toggle';
  btn.className = 'theme-toggle'; // reuse existing styles
  btn.onclick   = SFX.toggleMute;
  themeBtn.insertAdjacentElement('afterend', btn);
  SFX._updateMuteBtn();
})();


// ─── HOOK INTO EXISTING FUNCTIONS ────────────────────────────────────────────
// Wrap non-destructively — original functions are preserved and called normally.

// Tab switching — guard in case switchPage is overridden by page-specific script
if (typeof switchPage === 'function') {
  const _origSwitchPage = switchPage;
  window.switchPage = function(page) {
    SFX.tabClick();
    return _origSwitchPage(page);
  };
}

// Drawer open/close — only available on main flights dashboard
if (typeof openDrawer === 'function') {
  const _origOpenDrawer = openDrawer;
  window.openDrawer = function(code) {
    SFX.drawerOpen();
    return _origOpenDrawer(code);
  };
}

if (typeof closeDrawer === 'function') {
  const _origCloseDrawer = closeDrawer;
  window.closeDrawer = function() {
    SFX.drawerClose();
    return _origCloseDrawer();
  };
}

// Toast — detect success vs error from the isErr flag
function _wireToastSfx() {
  if (window._sfxToastWrapped || typeof showToast !== 'function') return;
  const _origShowToast = showToast;
  window.showToast = function(msg, isErr = false) {
    if (isErr) {
      SFX.error();
    } else {
      // Distinguish save confirmations from general info toasts
      if (msg.includes('updated') || msg.includes('saved') || msg.includes('Saved')) {
        SFX.saveSuccess();
      } else if (msg.includes('added') || msg.includes('created') || msg.includes('Added')) {
        SFX.flightAdded();
      } else if (msg.includes('status') || msg.includes('Ended') || msg.includes('moved')) {
        SFX.statusChange();
      } else if (msg.includes('Passenger') || msg.includes('pax') || msg.includes('count')) {
        SFX.paxSave();
      } else {
        // Generic positive feedback — subtle single ding
        SFX.statusChange();
      }
    }
    return _origShowToast(msg, isErr);
  };
  window._sfxToastWrapped = true;
}

_wireToastSfx();
window.addEventListener('load', _wireToastSfx);

// Page-tab clicks (the nav buttons) — they already go through switchPage,
// but also add a direct listener for the subnav filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => SFX.tabClick());
});
