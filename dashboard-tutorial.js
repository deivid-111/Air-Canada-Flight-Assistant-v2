// ─── ONBOARDING TUTORIAL ─────────────────────────────────────────────────────

const TOUR_STEPS = [
  {
    title: "Welcome to the AIC Dashboard",
    body:  "This is your Flight Operations dashboard. Let's walk through everything you need to know, step by step.",
    target: null, position: 'center',
    before: () => { _tourHideDemoDrawer(); _tourHideSimModal(); switchPage('flights'); },
  },
  {
    title: "Navigation Tabs",
    body:  "These tabs give you access to every section — Flights, Calendar, UTC Calculator, My Analytics, and your Availability schedule.",
    target: '.page-tabs', position: 'bottom',
  },
  {
    title: "Flight Stats",
    body:  "A quick snapshot: active flights, on-time count, cancellations, and total ended flights. Updates automatically every 30 seconds.",
    target: '.stat-strip', position: 'bottom',
  },
  {
    title: "Creating a Flight",
    body:  "Click + Add Flight to schedule a new flight. Fill in the flight number (e.g. AC1234), route, departure and arrival airports, date, times, aircraft type, and terminal. Once created it appears in the table immediately.",
    target: '.btn-add', position: 'bottom', pulse: true,
  },
  {
    title: "Flight Table",
    body:  "All your active flights are listed here, grouped by date. Each row shows the code, flight number, route, times, aircraft, and status. Click any row to open the flight drawer.",
    target: '#flights-body', position: 'top',
  },
  {
    title: "The Flight Drawer",
    body:  "The drawer slides in from the right when you click a flight row. It's your full control panel for that flight — bot actions, editing details, recording passengers. Let's go through every section.",
    target: '#_tour_demo_drawer', position: 'drawer-left', pulse: false,
    before: () => { _tourHideSimModal(); _tourOpenDemoDrawer(); },
  },

  // ── Admin buttons overview ────────────────────────────────────────────────
  {
    title: "Admin Controls",
    body:  "These buttons trigger live bot actions in Discord. They affect what passengers see in real time. Use them in order as the flight progresses.",
    target: '#_tour_demo_drawer .admin-controls', position: 'drawer-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('.admin-controls'); },
  },

  // ── Not Started ──────────────────────────────────────────────────────────
  {
    title: "Not Started",
    body:  "Use this right after creating a flight. It updates the Discord embed to say 'Flight Not Started' so passengers know boarding hasn't opened yet. <strong>Always do this first.</strong>",
    target: '[data-tour="not_started"]', position: 'button-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('.admin-controls'); },
    sim: {
      title: "Not Started — what happens",
      content: `<div style="font-family:var(--mono);font-size:11px;color:var(--subtext);line-height:1.8">
        The bot immediately updates the flight embed in Discord to show:<br><br>
        <div style="background:var(--surface);border:1px solid var(--border);padding:10px 14px;font-size:11px">
          <div style="color:var(--accent);font-weight:700;margin-bottom:4px">AC 1234 · YYZ → CDG</div>
          <div style="color:var(--dim)">Status: <span style="color:var(--subtext)">Not Started</span></div>
          <div style="color:var(--dim)">Boarding has not opened yet.</div>
        </div><br>No confirmation is required — it fires immediately.
      </div>`
    }
  },

  // ── Start Flight ─────────────────────────────────────────────────────────
  {
    title: "Start Flight",
    body:  "When boarding opens, click this. A popup asks for the Roblox server link and spawn location. The bot posts the link in Discord and updates the embed. <strong>Requires: a server link.</strong>",
    target: '[data-tour="start_flight"]', position: 'button-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('.admin-controls'); },
    sim: {
      useRealModal: 'start-modal',
      title: "Start Flight popup",
      content: `<div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <div style="font-family:var(--mono);font-size:9px;color:var(--subtext);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">Server Link</div>
          <input value="https://www.roblox.com/games/..." disabled style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 10px;width:100%;outline:none;box-sizing:border-box;opacity:.7"/>
        </div>
        <div>
          <div style="font-family:var(--mono);font-size:9px;color:var(--subtext);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">Spawn Location</div>
          <input value="Gate B14" disabled style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 10px;width:100%;outline:none;box-sizing:border-box;opacity:.7"/>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button disabled style="font-family:var(--mono);font-size:11px;background:var(--accent);color:#fff;border:none;padding:7px 18px;opacity:.6">Start Flight</button>
          <button disabled style="font-family:var(--mono);font-size:11px;background:none;border:1px solid var(--border);color:var(--subtext);padding:7px 14px;opacity:.6">Cancel</button>
        </div>
      </div>`
    }
  },

  // ── Close Gates ──────────────────────────────────────────────────────────
  {
    title: "Close Gates",
    body:  "Once boarding ends and no more passengers can join, click this. The bot posts a gate-closed notice in the flight channel. Use it just before pushback.",
    target: '[data-tour="close_gates"]', position: 'button-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('.admin-controls'); },
    sim: {
      title: "Close Gates — what happens",
      content: `<div style="font-family:var(--mono);font-size:11px;color:var(--subtext);line-height:1.8">
        The bot posts this message in the flight channel:<br><br>
        <div style="background:var(--surface);border:1px solid var(--border);padding:10px 14px">
          <div style="color:var(--text);font-weight:700">Gates Closed</div>
          <div style="color:var(--dim);margin-top:4px">Boarding for AC 1234 has closed. The aircraft is preparing for departure.</div>
        </div><br>No confirmation required — fires immediately.
      </div>`
    }
  },

  // ── Send Reminder ────────────────────────────────────────────────────────
  {
    title: "Send Reminder",
    body:  "Sends a countdown ping to the flight channel. Paste a Discord timestamp like <code>&lt;t:1234567890:R&gt;</code> — the bot pings passengers with a live countdown. Use the UTC Calculator tab to generate timestamps.",
    target: '[data-tour="send_reminder"]', position: 'button-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('.admin-controls'); },
    sim: {
      useRealModal: 'remind-modal',
      title: "Send Reminder popup",
      content: `<div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <div style="font-family:var(--mono);font-size:9px;color:var(--subtext);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">Discord Timestamp</div>
          <input value="&lt;t:1234567890:R&gt;" disabled style="font-family:var(--mono);font-size:11px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 10px;width:100%;outline:none;box-sizing:border-box;opacity:.7"/>
          <div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-top:4px">Generate this in the UTC Calculator tab → Discord Timestamp Generator</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button disabled style="font-family:var(--mono);font-size:11px;background:var(--accent);color:#fff;border:none;padding:7px 18px;opacity:.6">Send Reminder</button>
          <button disabled style="font-family:var(--mono);font-size:11px;background:none;border:1px solid var(--border);color:var(--subtext);padding:7px 14px;opacity:.6">Cancel</button>
        </div>
      </div>`
    }
  },

  // ── Announce ─────────────────────────────────────────────────────────────
  {
    title: "Announce",
    body:  "Opens the announcement modal. Pick a pre-written template (delay, cancellation, reschedule, etc.) or write a custom message. Edit the text, then send it to the flight channel.",
    target: '[data-tour="announce"]', position: 'button-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('.admin-controls'); },
    sim: {
      title: "Announce modal",
      useRealModal: 'pfannounce-modal',
    }
  },

  // ── Handbook ─────────────────────────────────────────────────────────────
  {
    title: "FA Handbook",
    body:  "Downloads a pre-filled Flight Attendant Handbook .docx for this flight. Enter the FA name, departure gate, arrival local time, temperature, and any notes — the document is auto-completed and downloads instantly.",
    target: '[data-tour="handbook"]', position: 'button-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('.admin-controls'); },
    sim: {
      title: "FA Handbook modal",
      content: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-family:var(--mono);font-size:11px">
        <div><div style="font-size:9px;color:var(--subtext);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">FA Name</div><input value="Jane Smith" disabled style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:5px 8px;width:100%;outline:none;box-sizing:border-box;opacity:.7"/></div>
        <div><div style="font-size:9px;color:var(--subtext);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Type</div><input value="Long Haul" disabled style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:5px 8px;width:100%;outline:none;box-sizing:border-box;opacity:.7"/></div>
        <div><div style="font-size:9px;color:var(--subtext);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Gate</div><input value="B14" disabled style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:5px 8px;width:100%;outline:none;box-sizing:border-box;opacity:.7"/></div>
        <div><div style="font-size:9px;color:var(--subtext);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Temperature</div><input value="18°C" disabled style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:5px 8px;width:100%;outline:none;box-sizing:border-box;opacity:.7"/></div>
        <div style="grid-column:1/-1;margin-top:4px">
          <button disabled style="font-family:var(--mono);font-size:11px;background:var(--accent);color:#fff;border:none;padding:7px 18px;opacity:.6">⬇ Download</button>
        </div>
      </div>`
    }
  },

  // ── Refresh Embed ────────────────────────────────────────────────────────
  {
    title: "Refresh Embed",
    body:  "Forces the bot to re-post the flight embed in Discord with the latest data. <strong>Always click this after saving any changes</strong> — gate, status, server link — so Discord stays in sync.",
    target: '[data-tour="refresh_embed"]', position: 'button-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('.admin-controls'); },
    sim: {
      title: "Refresh Embed — what happens",
      content: `<div style="font-family:var(--mono);font-size:11px;color:var(--subtext);line-height:1.8">
        The bot deletes the old embed and posts a fresh one with all current data:<br><br>
        <div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);padding:10px 14px;font-size:11px">
          <div style="color:var(--accent);font-weight:700;margin-bottom:6px">✈ AC 1234 · YYZ → CDG</div>
          <div style="color:var(--dim)">Gate: <span style="color:var(--text)">B14</span> &nbsp;·&nbsp; Status: <span style="color:var(--green)">On-Time</span></div>
          <div style="color:var(--dim)">Departure: <span style="color:var(--text)">14:00 UTC</span></div>
        </div><br>Fires immediately. No confirmation needed.
      </div>`
    }
  },

  // ── Mark as Ended ────────────────────────────────────────────────────────
  {
    title: "Mark as Ended",
    body:  "Sets the flight to Ended once the aircraft parks at the gate. The flight moves to the Ended tab. After this, fill in the Post-Flight Report with passenger counts.",
    target: '[data-tour="mark_ended"]', position: 'button-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('.admin-controls'); },
    sim: {
      title: "Mark as Ended — what happens",
      content: `<div style="font-family:var(--mono);font-size:11px;color:var(--subtext);line-height:1.8">
        The flight status is set to <strong style="color:var(--green)">Ended</strong>.<br><br>
        It moves from the active table to the <strong>Ended</strong> tab.<br><br>
        A Post-Flight Report section appears at the bottom of the drawer where you can record:<br>
        <div style="background:var(--surface);border:1px solid var(--border);padding:10px 14px;margin-top:8px;font-size:11px">
          Passengers at gate · Passengers who joined · Passengers who remained · Notes
        </div>
      </div>`
    }
  },

  // ── Delete Flight ────────────────────────────────────────────────────────
  {
    title: "Delete Flight",
    body:  "Permanently removes the flight from the system. A confirmation popup shows the flight code. <strong>This cannot be undone</strong> — use only when necessary.",
    target: '[data-tour="delete_flight"]', position: 'button-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('.admin-controls'); },
    sim: {
      useRealModal: 'delete-modal',
      title: "Delete confirmation",
      content: `<div style="font-family:var(--mono);font-size:11px;color:var(--subtext);line-height:1.8">
        A confirmation popup appears:<br><br>
        <div style="background:rgba(255,23,68,.08);border:1px solid var(--red);padding:12px 14px;font-size:11px">
          <div style="color:var(--red);font-weight:700;margin-bottom:6px">⚠ This action cannot be undone.</div>
          <div>Delete flight <strong style="color:var(--text)">DEMO01</strong>?</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button disabled style="font-family:var(--mono);font-size:11px;background:var(--red);color:#fff;border:none;padding:7px 18px;opacity:.6">Delete</button>
          <button disabled style="font-family:var(--mono);font-size:11px;background:none;border:1px solid var(--border);color:var(--subtext);padding:7px 14px;opacity:.6">Cancel</button>
        </div>
      </div>`
    }
  },

  // ── Status ───────────────────────────────────────────────────────────────
  {
    title: "Flight Status & Meal Service",
    body:  "Update the flight status (On-Time, Delayed, Cancelled, Rescheduled) and meal service type. Change and click Save Changes at the bottom, then Refresh Embed so Discord reflects it.",
    target: '#_demo_d_status', position: 'drawer-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('#_demo_d_status'); },
  },

  // ── Crew ─────────────────────────────────────────────────────────────────
  {
    title: "Crew",
    body:  "Shows everyone assigned to this flight — host, co-host, and crew who signed up via the Discord crew signup thread (Pilot, Co-Pilot, Cabin Crew, Ground Crew, Backup).",
    target: '#_demo_crew', position: 'drawer-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('#_demo_crew'); },
  },

  // ── Departure gate ───────────────────────────────────────────────────────
  {
    title: "Departure Gate",
    body:  "Edit the departure gate here — type the gate number (e.g. B14) and click Save Changes. The embed updates after a Refresh Embed.",
    target: '#_demo_gate_dep', position: 'drawer-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('#_demo_gate_dep'); },
  },

  // ── Arrival gate ─────────────────────────────────────────────────────────
  {
    title: "Arrival Gate",
    body:  "Edit the arrival gate here if you know it ahead of time. Same process — edit, Save Changes, Refresh Embed.",
    target: '#_demo_gate_arr', position: 'drawer-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('#_demo_gate_arr'); },
  },

  // ── Server link ──────────────────────────────────────────────────────────
  {
    title: "Links & Server",
    body:  "The Roblox private server link lives here — also filled automatically when you use Start Flight. Add a Discord event link so passengers can find the event before boarding.",
    target: '#_demo_server_link', position: 'drawer-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('#_demo_server_link'); },
  },

  // ── Alerts ───────────────────────────────────────────────────────────────
  {
    title: "Alert Text",
    body:  "Freeform text shown on the flight embed. Use it for weather warnings, delay reasons, or anything passengers should know before boarding.",
    target: '#_demo_alerts', position: 'drawer-left',
    before: () => { _tourHideSimModal(); _demoScrollTo('#_demo_alerts'); },
  },

  // ── Save ─────────────────────────────────────────────────────────────────
  {
    title: "Save Changes",
    body:  "After editing any field in the drawer, click Save Changes. The button activates as soon as you make an edit. Always follow up with Refresh Embed so Discord stays in sync.",
    target: '#_demo_save_btn', position: 'drawer-left', pulse: true,
    before: () => { _tourHideSimModal(); _demoScrollTo('#_demo_save_btn'); },
  },

  // ── Calendar ─────────────────────────────────────────────────────────────
  {
    title: "Calendar Tab",
    body:  "A monthly view of all scheduled flights. Colour coded — green for on-time, yellow for delayed, red for cancelled, grey for ended. Click any chip to open that flight's drawer.",
    target: '#tab-calendar', position: 'bottom',
    before: () => { _tourHideSimModal(); _tourHideDemoDrawer(); switchPage('calendar'); },
  },

  // ── UTC Calculator ───────────────────────────────────────────────────────
  {
    title: "UTC Calculator",
    body:  "Convert your local time to UTC, generate Discord timestamps for Send Reminder, and check the world clock. Essential — all times on the dashboard are UTC.",
    target: '#tab-calc', position: 'bottom',
    before: () => switchPage('calc'),
  },

  // ── My Analytics ─────────────────────────────────────────────────────────
  {
    title: "My Analytics",
    body:  "Your personal stats — total flights, on-time rate, streaks, busiest month, and your full flight history. Co-hosted flights appear with a CO badge.",
    target: '#tab-my-analytics', position: 'bottom',
    before: () => switchPage('my-analytics'),
  },

  // ── Availability ─────────────────────────────────────────────────────────
  {
    title: "Availability Calendar",
    body:  "Mark which hours each week you can host. Click or drag to paint your schedule. Managers see this when planning flights — fill it in so they know when to schedule you.",
    target: '#tab-availability', position: 'bottom',
    before: () => switchPage('availability'),
  },

  // ── Co-host ──────────────────────────────────────────────────────────────
  {
    title: "Request Co-Host",
    body:  "When you open a flight you didn't create and aren't already on, a 'Request Co-Host' section appears at the bottom of the drawer. Use it to ask a manager to add you.",
    target: '#tab-flights', position: 'bottom',
    before: () => switchPage('flights'),
  },

  // ── Done ─────────────────────────────────────────────────────────────────
  {
    title: "You're all set! ✈",
    body:  "That's everything. The flow is: <strong>Create → Not Started → Start Flight → Close Gates → Mark as Ended</strong>. You can replay this tutorial any time using the <strong>? Help</strong> button in the header.",
    target: null, position: 'center',
    before: () => { _tourHideSimModal(); _tourHideDemoDrawer(); },
  },
];

// ─── Demo drawer ─────────────────────────────────────────────────────────────
function _tourOpenDemoDrawer() {
  if (typeof closeDrawer === 'function') closeDrawer();
  let demo = document.getElementById('_tour_demo_drawer');
  if (!demo) {
    demo = document.createElement('div');
    demo.id = '_tour_demo_drawer';
    demo.style.cssText = 'position:fixed;right:0;top:0;bottom:0;width:400px;background:var(--card);border-left:1px solid var(--border);z-index:99982;overflow-y:auto;padding-bottom:2rem;';
    demo.innerHTML = `
      <div style="padding:1rem 1.5rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:var(--card);z-index:2">
        <div>
          <div style="font-family:var(--cond,var(--mono));font-size:1.1rem;font-weight:700;color:var(--accent)">AC 1234</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--subtext)">YYZ → CDG &nbsp;·&nbsp; 2026-03-20</div>
        </div>
        <span style="font-family:var(--mono);font-size:9px;background:rgba(100,200,100,.12);border:1px solid var(--green);color:var(--green);padding:3px 10px;letter-spacing:.08em">DEMO</span>
      </div>
      <div class="admin-controls" style="display:flex;flex-wrap:wrap;gap:6px;padding:1rem 1.5rem 0.75rem">
        <button data-tour="not_started"   class="btn-admin success" style="pointer-events:none">⏸ Not Started</button>
        <button data-tour="start_flight"  class="btn-admin success" style="pointer-events:none">🛫 Start Flight</button>
        <button data-tour="close_gates"   class="btn-admin warn"    style="pointer-events:none">🔒 Close Gates</button>
        <button data-tour="send_reminder" class="btn-admin"         style="pointer-events:none">⏰ Send Reminder</button>
        <button data-tour="announce"      class="btn-admin"         style="pointer-events:none">📣 Announce</button>
        <button data-tour="handbook"      class="btn-admin"         style="pointer-events:none">📋 Handbook</button>
        <button data-tour="refresh_embed" class="btn-admin"         style="pointer-events:none">↺ Refresh Embed</button>
        <button data-tour="delete_flight" class="btn-admin danger"  style="pointer-events:none">🗑 Delete Flight</button>
        <button data-tour="mark_ended"    class="btn-admin full"    style="pointer-events:none">✅ Mark as Ended</button>
      </div>
      <div style="padding:0 1.5rem">
        <div style="border-top:1px solid var(--border);padding:1rem 0">
          <div style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--subtext);text-transform:uppercase;margin-bottom:8px">Flight Status</div>
          <select id="_demo_d_status" style="font-family:var(--mono);font-size:12px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 10px;width:48%;outline:none;pointer-events:none"><option>On-Time</option></select>
        </div>
        <div style="border-top:1px solid var(--border);padding:1rem 0" id="_demo_crew">
          <div style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--subtext);text-transform:uppercase;margin-bottom:8px">Crew</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--subtext)">Host: DemoHost &nbsp;·&nbsp; Co-Host: N/A</div>
        </div>
        <div style="border-top:1px solid var(--border);padding:1rem 0">
          <div style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--subtext);text-transform:uppercase;margin-bottom:8px">Departure</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div><div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-bottom:3px">Airport</div><div style="font-family:var(--mono);font-size:12px">Toronto Pearson</div></div>
            <div><div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-bottom:3px">Time</div><div style="font-family:var(--mono);font-size:12px">14:00</div></div>
            <div><div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-bottom:3px">Gate</div>
              <input id="_demo_gate_dep" value="B14" style="font-family:var(--mono);font-size:12px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;width:100%;outline:none;pointer-events:none;box-sizing:border-box"/></div>
          </div>
        </div>
        <div style="border-top:1px solid var(--border);padding:1rem 0">
          <div style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--subtext);text-transform:uppercase;margin-bottom:8px">Arrival</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div><div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-bottom:3px">Airport</div><div style="font-family:var(--mono);font-size:12px">Paris CDG</div></div>
            <div><div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-bottom:3px">Time</div><div style="font-family:var(--mono);font-size:12px">04:30</div></div>
            <div><div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-bottom:3px">Gate</div>
              <input id="_demo_gate_arr" value="A22" style="font-family:var(--mono);font-size:12px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;width:100%;outline:none;pointer-events:none;box-sizing:border-box"/></div>
          </div>
        </div>
        <div style="border-top:1px solid var(--border);padding:1rem 0">
          <div style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--subtext);text-transform:uppercase;margin-bottom:8px">Links & Server</div>
          <input id="_demo_server_link" placeholder="Roblox server link…" style="font-family:var(--mono);font-size:12px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 10px;width:100%;outline:none;box-sizing:border-box;pointer-events:none"/>
        </div>
        <div style="border-top:1px solid var(--border);padding:1rem 0">
          <div style="font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--subtext);text-transform:uppercase;margin-bottom:8px">Alert Text</div>
          <input id="_demo_alerts" value="Weather delay possible…" style="font-family:var(--mono);font-size:12px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 10px;width:100%;outline:none;box-sizing:border-box;pointer-events:none"/>
        </div>
        <div style="border-top:1px solid var(--border);padding:1rem 0;display:flex;gap:10px">
          <button id="_demo_save_btn" style="font-family:var(--mono);font-size:12px;background:var(--accent);color:#fff;border:none;padding:8px 20px;opacity:.45;pointer-events:none;cursor:default">Save Changes</button>
          <button style="font-family:var(--mono);font-size:12px;background:none;border:1px solid var(--border);color:var(--subtext);padding:8px 16px;pointer-events:none;cursor:default">Discard</button>
        </div>
      </div>`;
    document.body.appendChild(demo);
  }
  demo.style.display = '';
}

function _tourHideDemoDrawer() {
  const d = document.getElementById('_tour_demo_drawer');
  if (d) d.style.display = 'none';
}

function _demoScrollTo(selector) {
  const demo = document.getElementById('_tour_demo_drawer');
  if (!demo) return;
  setTimeout(() => {
    const el = demo.querySelector ? demo.querySelector(selector) : document.querySelector(selector);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

// ─── Simulated button modals ──────────────────────────────────────────────────
let _tourSimRealModalId = null;

function _tourShowSimModal(sim) {
  _tourHideSimModal();

  if (sim.useRealModal) {
    // Open the actual real modal — it renders in the correct position
    // The blocker (z-index 99988) sits below the modal (which is ~z-index 1000 typically)
    // so we need to temporarily raise the blocker above the modal, except the modal itself
    _tourSimRealModalId = sim.useRealModal;
    const modalId   = sim.useRealModal;
    const overlayId = modalId.replace('-modal', '-overlay');
    // Temporarily lower blocker so modal renders above it
    if (typeof openMiniModal === 'function') openMiniModal(modalId.replace('-modal',''));
    // Add simulated badge inside the modal header
    const modal = document.getElementById(modalId);
    if (modal) {
      // Remove existing badge if any
      modal.querySelector('._tour_sim_badge')?.remove();
      const header = modal.querySelector('.mini-modal-header');
      if (header) {
        const badge = document.createElement('span');
        badge.className = '_tour_sim_badge';
        badge.style.cssText = 'font-family:var(--mono);font-size:9px;color:var(--dim);background:var(--surface);padding:2px 7px;border:1px solid var(--border);margin-left:8px;pointer-events:none';
        badge.textContent = 'SIMULATED';
        header.appendChild(badge);
      }
      // Raise modal above blocker
      modal.style.zIndex = '99996';
      const overlay = document.getElementById(overlayId);
      if (overlay) overlay.style.zIndex = '99991';
    }
    return;
  }

  // Custom sim content
  const modal = document.createElement('div');
  modal.id = '_tour_sim_modal';
  modal.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99996;background:var(--card);border:1px solid var(--border);padding:0;width:min(400px,90vw);box-shadow:0 8px 24px rgba(0,0,0,.5);';
  modal.innerHTML = `
    <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <span style="font-family:var(--mono);font-size:11px;font-weight:700;color:var(--text)">${sim.title}</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--dim);background:var(--surface);padding:2px 7px;border:1px solid var(--border)">SIMULATED</span>
    </div>
    <div style="padding:14px">${sim.content}</div>`;
  document.body.appendChild(modal);
}

function _tourHideSimModal() {
  // Close real modal if one was opened as sim
  if (_tourSimRealModalId) {
    const modalId   = _tourSimRealModalId;
    const overlayId = modalId.replace('-modal', '-overlay');
    const modal   = document.getElementById(modalId);
    const overlay = document.getElementById(overlayId);
    if (modal) {
      modal.querySelector('._tour_sim_badge')?.remove();
      modal.style.zIndex = '';
      if (typeof closeMiniModal === 'function') closeMiniModal(modalId.replace('-modal',''));
    }
    if (overlay) overlay.style.zIndex = '';
    _tourSimRealModalId = null;
  }
  document.getElementById('_tour_sim_modal')?.remove();
}

// ─── Tour engine ─────────────────────────────────────────────────────────────
let _tourStep = 0, _tourOverlay = null, _tourBox = null, _tourSpot = null, _tourBlocker = null, _tourActive = false;

function tourShouldShow() { return localStorage.getItem('aic_tour_done') !== '1'; }
function tourMarkDone()   { localStorage.setItem('aic_tour_done', '1'); }

function tourStart() {
  if (_tourActive) return;
  _tourStep = 0; _tourActive = true;
  _buildTourDOM(); _renderStep();
}

function _buildTourDOM() {
  _tourBlocker = document.createElement('div');
  _tourBlocker.id = '_tour_blocker';
  _tourBlocker.style.cssText = 'position:fixed;inset:0;z-index:99988;cursor:not-allowed;';
  _tourBlocker.addEventListener('click',     e => e.stopPropagation(), true);
  _tourBlocker.addEventListener('mousedown', e => e.stopPropagation(), true);
  _tourBlocker.addEventListener('keydown',   e => { if (e.key !== 'Escape') e.stopPropagation(); }, true);
  document.body.appendChild(_tourBlocker);

  _tourOverlay = document.createElement('div');
  _tourOverlay.id = '_tour_overlay';
  _tourOverlay.style.cssText = 'position:fixed;inset:0;z-index:99989;pointer-events:none;background:rgba(0,0,0,0);transition:background .35s ease;';
  document.body.appendChild(_tourOverlay);

  _tourSpot = document.createElement('div');
  _tourSpot.id = '_tour_spot';
  _tourSpot.style.cssText = 'position:fixed;z-index:99990;pointer-events:none;border:2px solid var(--accent);border-radius:3px;box-shadow:0 0 0 9999px rgba(0,0,0,0.75);transition:all .35s cubic-bezier(.4,0,.2,1);opacity:0;';
  document.body.appendChild(_tourSpot);

  _tourBox = document.createElement('div');
  _tourBox.id = '_tour_box';
  _tourBox.style.cssText = 'position:fixed;z-index:99999;background:var(--card);border:1px solid var(--accent);padding:20px 22px;width:300px;box-shadow:0 8px 32px rgba(0,0,0,.6);transition:opacity .25s ease,transform .25s ease;opacity:0;transform:translateY(8px);';
  document.body.appendChild(_tourBox);
}

function _renderStep() {
  const step = TOUR_STEPS[_tourStep];
  if (!step) return;
  if (step.before) { try { step.before(); } catch(e) {} }
  setTimeout(() => _renderStepNow(step), step.before ? 340 : 0);
}

function _renderStepNow(step) {
  const total = TOUR_STEPS.length, isLast = _tourStep === total - 1;
  const prog  = Math.round((_tourStep / (total - 1)) * 100);

  // Show sim modal if step has one
  if (step.sim) {
    setTimeout(() => _tourShowSimModal(step.sim), 400);
  }

  _tourBox.innerHTML = `
    <div style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--accent);text-transform:uppercase;margin-bottom:8px">Step ${_tourStep + 1} of ${total}</div>
    <div style="font-family:var(--cond,var(--mono));font-size:14px;font-weight:700;color:var(--text);margin-bottom:10px;line-height:1.3">${step.title}</div>
    <div style="font-family:var(--mono);font-size:11px;color:var(--subtext);line-height:1.75;margin-bottom:16px">${step.body}</div>
    <div style="background:var(--border);height:2px;border-radius:2px;margin-bottom:16px">
      <div style="background:var(--accent);height:2px;border-radius:2px;width:${prog}%;transition:width .35s ease"></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center">
      ${(!isLast && _tourIsReplay) ? `<button id="_tour_skip" style="font-family:var(--mono);font-size:10px;color:var(--dim);background:none;border:none;cursor:pointer;padding:4px 0;letter-spacing:.06em" onmouseover="this.style.color='var(--subtext)'" onmouseout="this.style.color='var(--dim)'">Skip tutorial</button>` : '<span></span>'}
      <button id="_tour_next" style="font-family:var(--mono);font-size:11px;letter-spacing:.06em;background:var(--accent);color:#fff;border:none;padding:8px 20px;cursor:pointer" onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">${isLast ? 'Finish ✓' : 'Next →'}</button>
    </div>`;

  document.getElementById('_tour_next').onclick = () => _tourAdvance();
  document.getElementById('_tour_skip')?.addEventListener('click', () => {
    _tourStep = TOUR_STEPS.length - 1;
    _tourHideSimModal();
    _tourHideDemoDrawer();
    _tourBox.style.opacity = '0';
    setTimeout(() => { _tourBox.style.transform = 'translateY(8px)'; _renderStep(); }, 200);
  });

  // Target element — for data-tour selectors, ALWAYS use demo drawer
  let targetEl = null;
  if (step.target) {
    const demo = document.getElementById('_tour_demo_drawer');
    const demoVisible = demo && demo.style.display !== 'none';
    if (demoVisible && step.target.includes('data-tour')) {
      // Force demo drawer — real buttons have same attribute and confuse querySelector
      targetEl = demo.querySelector(step.target);
    } else if (demoVisible && step.target.startsWith('#_demo')) {
      targetEl = document.getElementById(step.target.slice(1));
    } else if (demoVisible && (step.target === '#_tour_demo_drawer' || step.target === '#_tour_demo_drawer .admin-controls')) {
      targetEl = step.target === '#_tour_demo_drawer' ? demo : demo.querySelector('.admin-controls');
    } else {
      targetEl = document.querySelector(step.target);
    }
    if (step.highlight) targetEl = step.highlight(targetEl) || targetEl;
  }

  if (targetEl) {
    _spotlightEl(targetEl);
    _positionBox(targetEl, step.position || 'bottom');
    _tourOverlay.style.background = 'transparent';
    _tourSpot.style.opacity = '1';
    _tourSpot.style.animation = step.pulse ? '_tour_pulse 1.4s ease-in-out infinite' : 'none';
  } else {
    _tourSpot.style.opacity = '0';
    _tourOverlay.style.background = 'rgba(0,0,0,0.75)';
    _centerBox();
  }

  _tourBox.style.opacity = '0'; _tourBox.style.transform = 'translateY(8px)';
  requestAnimationFrame(() => { _tourBox.style.opacity = '1'; _tourBox.style.transform = 'translateY(0)'; });
}

function _spotlightEl(el) {
  const r = el.getBoundingClientRect(), p = 6;
  _tourSpot.style.left   = (r.left   - p) + 'px';
  _tourSpot.style.top    = (r.top    - p) + 'px';
  _tourSpot.style.width  = (r.width  + p*2) + 'px';
  _tourSpot.style.height = (r.height + p*2) + 'px';
}

function _positionBox(el, pos) {
  const r = el.getBoundingClientRect();
  const bw = 300, pad = 12;
  const vw = window.innerWidth, vh = window.innerHeight;
  _tourBox.style.transform = 'translateY(0)';

  // drawer-left: tooltip left of the demo drawer, aligned to target
  if (pos === 'drawer-left') {
    const demo = document.getElementById('_tour_demo_drawer');
    const dw   = demo ? demo.offsetWidth : 400;
    const left = Math.max(pad, vw - dw - bw - 20);
    _tourBox.style.left = left + 'px';
    setTimeout(() => {
      const bh = _tourBox.offsetHeight;
      _tourBox.style.top = Math.max(pad, Math.min(r.top, vh - bh - pad)) + 'px';
    }, 30);
    return;
  }

  // button-left: tooltip + sim stacked below the admin controls, right-aligned to drawer
  if (pos === 'button-left') {
    const demo    = document.getElementById('_tour_demo_drawer');
    const adminEl = demo ? demo.querySelector('.admin-controls') : null;
    const anchor  = adminEl ? adminEl.getBoundingClientRect() : r;
    // Align right edge of tooltip with right edge of demo drawer
    const drawerRight = demo ? demo.getBoundingClientRect().right : vw;
    const left = Math.max(pad, drawerRight - bw);
    const topPos = anchor.bottom + 12;
    _tourBox.style.left      = left + 'px';
    _tourBox.style.top       = topPos + 'px';
    _tourBox.style.transform = 'none';
    // Sim modal centered on screen
    setTimeout(() => {
      const simEl = document.getElementById('_tour_sim_modal');
      if (simEl) {
        simEl.style.left      = '50%';
        simEl.style.top       = '50%';
        simEl.style.transform = 'translate(-50%, -50%)';
        simEl.style.width     = 'min(480px, 90vw)';
        simEl.style.maxHeight = '80vh';
        simEl.style.overflowY = 'auto';
      }
    }, 60);
    return;
  }
  if (pos === 'bottom') {
    _tourBox.style.top  = (r.bottom + 14) + 'px';
    _tourBox.style.left = Math.max(pad, Math.min(r.left, vw - bw - pad)) + 'px';
  } else if (pos === 'top') {
    setTimeout(() => {
      const bh = _tourBox.offsetHeight;
      _tourBox.style.top  = Math.max(pad, r.top - bh - 14) + 'px';
      _tourBox.style.left = Math.max(pad, Math.min(r.left, vw - bw - pad)) + 'px';
    }, 30);
  } else if (pos === 'left') {
    _tourBox.style.left = Math.max(pad, r.left - bw - 14) + 'px';
    _tourBox.style.top  = Math.max(pad, Math.min(r.top, vh - 260)) + 'px';
  }
}

function _centerBox() {
  _tourBox.style.left = '50%'; _tourBox.style.top = '50%';
  _tourBox.style.transform = 'translate(-50%,-50%) translateY(0)';
}

function _tourAdvance() {
  _tourStep++;
  if (_tourStep >= TOUR_STEPS.length) { _tourFinish(); return; }
  _tourHideSimModal();
  _tourBox.style.opacity = '0'; _tourBox.style.transform = 'translateY(-6px)';
  setTimeout(() => { _tourBox.style.transform = 'translateY(8px)'; _renderStep(); }, 200);
}

function _tourFinish() {
  tourMarkDone(); _tourActive = false;
  [_tourBox, _tourSpot, _tourOverlay, _tourBlocker].forEach(el => el?.remove());
  _tourBox = _tourSpot = _tourOverlay = _tourBlocker = null;
  _tourHideSimModal(); _tourHideDemoDrawer();
  switchPage('flights');
  showToast('Tutorial complete — welcome aboard! ✈');
}

// ── Styles ───────────────────────────────────────────────────────────────────
(function() {
  const s = document.createElement('style');
  s.textContent = `
    @keyframes _tour_pulse { 0%,100%{box-shadow:0 0 0 9999px rgba(0,0,0,.75),0 0 0 3px var(--accent)} 50%{box-shadow:0 0 0 9999px rgba(0,0,0,.75),0 0 0 8px rgba(229,57,53,.2)} }
    @keyframes _tour_fade_in { from{opacity:0;transform:translateY(-50%) translateX(8px)} to{opacity:1;transform:translateY(-50%) translateX(0)} }
  `;
  document.head.appendChild(s);
})();

// ── Hard-start ───────────────────────────────────────────────────────────────
let _tourIsReplay = false;

function tourHardStart() {
  localStorage.removeItem('aic_tour_done');
  _tourIsReplay = true;
  if (_tourActive) {
    [_tourBox, _tourSpot, _tourOverlay, _tourBlocker].forEach(el => el?.remove());
    _tourBox = _tourSpot = _tourOverlay = _tourBlocker = null;
    _tourHideDemoDrawer(); _tourHideSimModal(); _tourActive = false;
  }
  tourStart();
}

// ── Auto-start ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { if (tourShouldShow()) { _tourIsReplay = false; tourStart(); } }, 1800);
});