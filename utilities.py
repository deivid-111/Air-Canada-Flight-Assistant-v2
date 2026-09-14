# utilities.py — Air Canada PTFS Operations Bot

import json
import random
import string
import asyncio
import traceback
from typing import Optional
from pathlib import Path
import sqlite3
try:
    from docx import Document as _DocxDocument
    _DOCX_OK = True
except ImportError:
    _DOCX_OK = False
import httpx
import discord
from discord import TextStyle
from discord.ext import commands, tasks
from discord.ui import Modal, TextInput, Button, View, Select
from datetime import datetime, timezone, timedelta
import os
import sys
from discord import AllowedMentions

# Load .env if present (simple key=value parser, no dependency needed)
_env_path = Path(__file__).parent / ".env"
if _env_path.exists():
    for _line in _env_path.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

# Optional web dashboard (FastAPI). If not installed, dashboard is disabled.
try:
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse, FileResponse
    from fastapi.staticfiles import StaticFiles
    import uvicorn
    WEB_ENABLED = True
except ImportError:
    WEB_ENABLED = False

# -----------------------
# Config / Files / Globals  (read from environment / .env)
# -----------------------
SQLITE_DB_PATH = "user_data.db"
LOG_CHANNEL_ID   = int(os.environ.get("LOG_CHANNEL_ID",    "1473903552530481344"))
PUBLIC_CHANNEL_ID= int(os.environ.get("PUBLIC_CHANNEL_ID", "1473903427506540686"))
ANNOUNCE_CHANNEL_ID=int(os.environ.get("ANNOUNCE_CHANNEL_ID","1473903526915608616"))
EVENTS_CHANNEL_ID    = int(os.environ.get("EVENTS_CHANNEL_ID",    "0"))  # separate channel for events/gamenights
CREW_CHANNEL_ID      = int(os.environ.get("CREW_CHANNEL_ID",      "0"))  # channel where crew signup threads are created
EVENTS_INTEREST_ROLE = int(os.environ.get("EVENTS_INTEREST_ROLE", "0"))  # role pinged for events (0 = no ping)
HOSTER_ROLE      = int(os.environ.get("HOSTER_ROLE",       "1473903876100067461"))  # hoster role — dashboard access + appears in profiles
MANAGER_ROLE     = int(os.environ.get("MANAGER_ROLE",      "1473903917854363723"))  # manager role — analytics, hosts, logs
FOM_ROLE         = int(os.environ.get("FOM_ROLE",          "1402779479394357318"))  # regular FOM quota
FOI_TRAINEE_ROLE  = int(os.environ.get("FOI_TRAINEE_ROLE", "1402779479985881220"))  # FOI training quota
BOD_ROLE         = int(os.environ.get("BOD_ROLE",          "0"))                    # BOD role — everything except diagnostics
INTEREST_ROLE    = int(os.environ.get("INTEREST_ROLE",     "1465666265803653142"))
FLIGHT_NOTIFY_ROLE = int(os.environ.get("FLIGHT_NOTIFY_ROLE", str(INTEREST_ROLE)))  # schedules + reminders
FLIGHT_START_ROLE  = int(os.environ.get("FLIGHT_START_ROLE",  str(INTEREST_ROLE)))  # check-in/start announcements
GUILD_ID         = int(os.environ.get("GUILD_ID",          "1473903426789179426"))
OWNER_ID         = int(os.environ.get("OWNER_ID",          "767865431712333874"))
ADMIN_CHANNEL_ID = int(os.environ.get("ADMIN_CHANNEL_ID",  "0"))  # panel removed — no longer used
FONT_LIGHT       = os.environ.get("FONT_LIGHT",  "OpenSans-Light.ttf")
FONT_REGULAR     = os.environ.get("FONT_REGULAR","OpenSans-Regular.ttf")
LOG_FILE         = os.environ.get("LOG_FILE",    "utilities.log")
TOKEN            = os.environ.get("TOKEN",       "")
DASHBOARD_PORT   = int(os.environ.get("DASHBOARD_PORT"))

# -----------------------
# Rate Limit Interceptor
# -----------------------
RATE_LIMIT_WEBHOOK_URL = os.environ.get("RATE_LIMIT_WEBHOOK_URL", "")

# -----------------------
# Google Sheets Integration
# -----------------------
GOOGLE_SHEET_ID = os.environ.get("GOOGLE_SHEET_ID", "1VpLl_hsL0gajj2Ymp6GN-0dL_SK63ojYWp8aYc5puE8")
GOOGLE_CREDENTIALS_FILE = os.environ.get("GOOGLE_CREDENTIALS_FILE", "aic-dashboard-491018-36abc4d29fae.json")
HANDBOOK_DRIVE_FOLDER_ID = os.environ.get("HANDBOOK_DRIVE_FOLDER_ID", "1QHovQT4UsbxKKLB1bthpzPT6uSP5jPKN")
HANDBOOK_GOOGLE_OAUTH_CLIENT_FILE = os.environ.get("HANDBOOK_GOOGLE_OAUTH_CLIENT_FILE", "handbook-google-oauth-client.json")
HANDBOOK_GOOGLE_OAUTH_TOKEN_FILE = os.environ.get("HANDBOOK_GOOGLE_OAUTH_TOKEN_FILE", "handbook-google-oauth-token.json")

import aiohttp
_orig_aiohttp_request = aiohttp.ClientSession._request

async def _post_rate_limit_webhook(method: str, url: str, response: aiohttp.ClientResponse):
    """Sends a rich embed to the configured webhook containing 429 details."""
    try:
        headers = response.headers
        limit       = headers.get("X-RateLimit-Limit", "Unknown")
        remaining   = headers.get("X-RateLimit-Remaining", "Unknown")
        reset_after = headers.get("X-RateLimit-Reset-After", "Unknown")
        bucket      = headers.get("X-RateLimit-Bucket", "Unknown")
        scope       = headers.get("X-RateLimit-Scope", "Unknown")
        is_global   = headers.get("X-RateLimit-Global", "false").lower() == "true"
        retry_after = headers.get("Retry-After", "Unknown")

        embed = {
            "title": "⚠️ Discord API Rate Limit Hit (429)",
            "color": 0xFF0000 if is_global else 0xFFA500,
            "description": f"**Endpoint:** `{method} {url}`",
            "fields": [
                {"name": "Scope", "value": f"`{scope}`", "inline": True},
                {"name": "Global", "value": f"`{is_global}`", "inline": True},
                {"name": "Bucket", "value": f"`{bucket}`", "inline": True},
                {"name": "Limit", "value": f"`{limit}`", "inline": True},
                {"name": "Remaining", "value": f"`{remaining}`", "inline": True},
                {"name": "Reset After", "value": f"`{reset_after}s`", "inline": True},
                {"name": "Retry After", "value": f"`{retry_after}s`", "inline": True},
            ],
            "footer": {"text": "Air Canada PTFS Operations Bot"}
        }
        async with httpx.AsyncClient() as client:
            await client.post(RATE_LIMIT_WEBHOOK_URL, json={"embeds": [embed]})
    except Exception as e:
        print(f"Failed to send rate limit webhook: {e}")

async def _patched_aiohttp_request(self, method, str_or_url, **kwargs):
    response = await _orig_aiohttp_request(self, method, str_or_url, **kwargs)
    if response.status == 429 and RATE_LIMIT_WEBHOOK_URL:
        import asyncio
        asyncio.create_task(_post_rate_limit_webhook(method, str(str_or_url), response))
    return response

aiohttp.ClientSession._request = _patched_aiohttp_request


# -----------------------
# Bot Setup
# -----------------------
intents = discord.Intents.all()
intents.presences = False  # Disable presence tracking to save memory/CPU

bot = commands.Bot(
    command_prefix="a!",
    intents=intents,
    max_messages=50,  # Limit cached messages to save memory
    member_cache_flags=discord.MemberCacheFlags.all()  # Cache members without presence overhead
)
allowed_mentions = discord.AllowedMentions(roles=True, users=True, everyone=True)

# Latency trend and task fire tracking (module-level, accessed by tasks and /api/debug)
_latency_trend: list = []
_task_last_fired: dict = {}

# Feature flags — controls whether each background task actually does work
_feature_flags: dict = {
    "auto_reminder_flights":      True,
    "auto_end_flights":           True,
    "post_daily_schedule":        True,
    "post_weekly_monthly_report": True,
    "cleanup_old_day_messages":   True,
    "cleanup_crew_threads":       True,
    "flight_scheduling":          True,
}

# Feature config — configurable parameters per task
_feature_config: dict = {
    "auto_reminder_flights":      {"minutes_before": 120},
    "post_daily_schedule":        {"utc_hour": 0},
    "post_weekly_monthly_report": {"utc_hour": 0, "weekly_day": 0},  # 0=Mon
    "flight_scheduling":          {"max_scheduled_flights": 3, "advance_hours": 24},
    "cleanup_crew_threads":       {"hours_after_end": 48},
}

# Users tracked for ping diagnostics
TRACKED_PING_USERS = [
    767865431712333874, # Owner
    765969639519420436,
    931918746052870195,
    1026164861752840302
]

# Tab overrides — disabled tabs hidden for all non-owner users
# Keys are tab page names (e.g. "flights", "calendar"). True = visible (default), False = hidden.
_tab_overrides: dict = {}

# Update banner
_update_banner: dict | None = None

# -----------------------
# Internal concurrency primitives
# -----------------------
data_lock = asyncio.Lock()

# -----------------------
# Utilities
# -----------------------
def generate_ref_code(length: int = 7) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))

def safe_console_print(obj: str):
    """Write to log file only — no console output."""
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(obj + "\n")
    except Exception:
        pass  # silently ignore log write failures

def log_to_file(action: str, user: str = "system", level: str = "info"):
    """Write a structured JSON log entry for the dashboard logs viewer."""
    now = datetime.now(timezone.utc)
    entry = json.dumps({
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M:%S"),
        "user": user,
        "action": action,
        "level": level
    }, ensure_ascii=False)
    safe_console_print(entry)

def utc_iso_z(dt: Optional[datetime] = None) -> str:
    current = dt or datetime.now(timezone.utc)
    return current.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def generate_code(length=6):
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))

# -----------------------
# SQLite load/save
# user_data is kept as an in-memory dict (cache) for all existing code.
# A local SQLite file (data_user.db) is the persistent backing store.
# -----------------------
user_data = {}
def _db_conn_sync():
    """Return a synchronous SQLite connection."""
    con = sqlite3.connect(SQLITE_DB_PATH)
    con.execute("PRAGMA journal_mode=WAL")
    return con

def _init_db_sync():
    """Create the DB table synchronously at startup."""
    con = _db_conn_sync()
    cur = con.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS kv (
            `key`   TEXT PRIMARY KEY,
            `value` TEXT NOT NULL
        )
    """)
    con.commit()
    cur.close()
    con.close()

async def load_user_data():
    """Load all rows from SQLite into the in-memory user_data dict."""
    global user_data
    try:
        _init_db_sync()
        async with data_lock:
            con = _db_conn_sync()
            cur = con.cursor()
            cur.execute("SELECT `key`, `value` FROM kv")
            rows = cur.fetchall()
            cur.close()
            con.close()
            user_data = {}
            for key, value in rows:
                try:
                    user_data[key] = json.loads(value)
                except Exception:
                    user_data[key] = value
        return True
    except Exception as e:
        safe_console_print(f"❌ Error loading DB: {e}")
        user_data = {}
        return False

# -----------------------
# Persistent config  (stored in DB under key "__config__")
# -----------------------
CONFIG_FIELDS = [
    "GUILD_ID", "HOSTER_ROLE", "MANAGER_ROLE", "BOD_ROLE", "INTEREST_ROLE",
    "FLIGHT_NOTIFY_ROLE", "FLIGHT_START_ROLE",
    "LOG_CHANNEL_ID", "PUBLIC_CHANNEL_ID", "ANNOUNCE_CHANNEL_ID", "EVENTS_CHANNEL_ID", "CREW_CHANNEL_ID", "EVENTS_INTEREST_ROLE",
]

def _load_user_data_sync():
    """Load all rows from SQLite synchronously at import time."""
    global user_data
    try:
        _init_db_sync()
        con = _db_conn_sync()
        cur = con.cursor()
        cur.execute("SELECT `key`, `value` FROM kv")
        rows = cur.fetchall()
        cur.close()
        con.close()
        user_data = {}
        for key, value in rows:
            try:
                user_data[key] = json.loads(value)
            except Exception:
                user_data[key] = value
    except Exception as _e:
        import sys; print(f"[WARN] sync DB load: {_e}", file=sys.stderr)
        user_data = {}

# Load DB synchronously so config is available immediately on startup
_load_user_data_sync()

_saved_feature_flags = user_data.get("__feature_flags__", {})
if isinstance(_saved_feature_flags, dict):
    for _key, _value in _saved_feature_flags.items():
        if _key in _feature_flags:
            _feature_flags[_key] = bool(_value)

_saved_feature_config = user_data.get("__feature_config__", {})
if isinstance(_saved_feature_config, dict):
    for _key, _params in _saved_feature_config.items():
        if isinstance(_params, dict):
            _feature_config.setdefault(_key, {}).update(_params)

_saved_tab_overrides = user_data.get("__tab_overrides__", {})
if isinstance(_saved_tab_overrides, dict):
    _tab_overrides.update(_saved_tab_overrides)

def apply_saved_config():
    """Read __config__ from user_data and overwrite the live globals."""
    cfg = user_data.get("__config__", {})
    if not cfg:
        return
    import sys
    _self = sys.modules[__name__]
    applied = []
    for field in CONFIG_FIELDS:
        raw = cfg.get(field)
        if raw is not None:
            try:
                setattr(_self, field, int(raw))
                os.environ[field] = str(raw)
                applied.append(field)
            except (ValueError, TypeError):
                pass
    if applied:
        import sys as _sys
        print(f"[CONFIG] Applied saved config: {', '.join(applied)}", file=_sys.stderr)

# Apply immediately — DB is already loaded above
apply_saved_config()

async def save_user_data(user_trigger_desc: Optional[str] = None, user=None):
    """Persist the entire in-memory user_data dict to SQLite."""
    try:
        async with data_lock:
            con = _db_conn_sync()
            cur = con.cursor()
            # Upsert every key
            for key, value in user_data.items():
                serialized = json.dumps(value, ensure_ascii=False)
                cur.execute(
                    "INSERT INTO kv (`key`, `value`) VALUES (?, ?) "
                    "ON CONFLICT(`key`) DO UPDATE SET `value` = excluded.value",
                    (key, serialized)
                )
            # Remove keys that no longer exist in user_data
            cur.execute("SELECT `key` FROM kv")
            db_keys = {row[0] for row in cur.fetchall()}
            mem_keys = set(user_data.keys())
            for orphan in db_keys - mem_keys:
                cur.execute("DELETE FROM kv WHERE `key` = ?", (orphan,))
            con.commit()
            cur.close()
            con.close()
        if user_trigger_desc and user:
            await log_action(user, f"Saved data ({user_trigger_desc})")
        return True
    except Exception as e:
        safe_console_print(f"❌ Error saving data to DB: {e}")
        return False

# -----------------------
# Logging
# -----------------------
def build_log_embed_object(username_mention: str, action_text: str, error_code: Optional[str] = None):
    embed_obj = {
        "content": "",
        "tts": False,
        "embeds": [
            {
                "id": 786967341,
                "description": "**Log**",
                "color": 13047318,
                "image": {
                    "url": "https://message.style/cdn/images/ea75ce6f1ccf8a29c0d92c39a5daf807711b498b1df7ae0cf143f660d75ca454.png"
                },
                "fields": [
                    {"id": 218727277, "name": "Username", "value": f"{username_mention}"},
                    {"id": 175659844, "name": "Action Performed", "value": f"```{action_text}```"}
                ]
            }
        ]
    }
    if error_code:
        embed_obj["embeds"][0]["fields"].append({
            "id": 30218311,
            "name": "Error Code",
            "value": f"`{error_code}`"
        })
    return embed_obj

async def log_action(user: discord.abc.User, action_text: str, error_code: Optional[str] = None, tb_text: Optional[str] = None):
    """Log to dashboard only — no Discord channel, no console output."""
    username_str = getattr(user, 'display_name', None) or getattr(user, 'name', None) or str(user)
    level = "error" if error_code or tb_text else "info"
    log_to_file(action_text + (f" [err:{error_code}]" if error_code else ""), user=username_str, level=level)
    if tb_text:
        log_to_file(f"Traceback: {tb_text[:500]}", user=username_str, level="error")

async def handle_exception_and_report(interaction: Optional[discord.Interaction], user: discord.abc.User, action_desc: str, exc: Exception):
    err_code = generate_ref_code(7)
    tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    try:
        if interaction:
            try:
                await interaction.followup.send(
                    f"⚠️ An internal error occurred. Please contact Deivid\nReference code: `{err_code}`",
                    ephemeral=True
                )
            except Exception:
                try:
                    await user.send(f"⚠️ An internal error occurred. Reference code: `{err_code}`")
                except Exception:
                    pass
    except Exception:
        pass
    try:
        await log_action(user, f"{action_desc} (FAILED)", error_code=err_code, tb_text=tb)
    except Exception as e:
        safe_console_print(f"❌ Failed to log error {err_code}: {e}")
        safe_console_print(tb)
    safe_console_print(f"❌ [{err_code}]")
    safe_console_print("Traceback:")
    safe_console_print(tb)

# -----------------------
# ─── NEW: Day-Grouped Public Embed ────────────────────────────────────────────
# -----------------------

AIRCRAFT_FULL_NAMES = {
    "B77W": "777-300ER",
    "B77L": "777-200LR",
    "A333": "A330-300",
    "B788": "787-8",
    "B789": "787-9",
    "A321": "A321-200",
    "B737": "737 MAX-8",
    "A223": "A220-300",
    "A320": "A320-200",
    "A319": "A319-100",
    "CR9":  "CRJ 900",
    "E75":  "Embraer 175",
    "DH4J": "Dash 8-400",
}

def aircraft_full_name(code: str) -> str:
    return AIRCRAFT_FULL_NAMES.get(code.upper(), code)

def format_date_ordinal(date_raw: str) -> str:
    try:
        dt = datetime.strptime(date_raw, "%d%m%Y")
        day = dt.day
        suffix = "th" if 11 <= day <= 13 else {1:"st",2:"nd",3:"rd"}.get(day % 10, "th")
        return f"{day}{suffix} {dt.strftime('%B')}"
    except Exception:
        return date_raw

def get_real_flights():
    """Return only real flight entries (skip session/pending keys)."""
    return {
        code: entry for code, entry in user_data.items()
        if isinstance(entry, dict)
        and "flight_number" in entry
        and not code.endswith("_pending")
        and len(code) == 6
    }

def get_quota_targets():
    cfg = user_data.get("__quota_config__", {})
    def target(key, default):
        try:
            return max(0, min(50, int(cfg.get(key, default))))
        except Exception:
            return default
    return {"som_target": target("som_target", 5), "fom_target": target("fom_target", 4)}

def _is_attendance_locked(entry: dict) -> bool:
    """Returns True if the flight ended more than 2 hours ago (attendance window closed)."""
    if entry.get("status") != "Ended":
        return False
    ended_at_str = entry.get("ended_at")
    if not ended_at_str:
        return False  # legacy flight with no timestamp — leave unlocked
    try:
        ended_at = datetime.fromisoformat(ended_at_str.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - ended_at).total_seconds() > 7200  # 2 hours
    except Exception:
        return False

def group_flights_by_date(flights: dict) -> dict:
    """Group flight entries by dep_date string (DDMMYYYY)."""
    grouped = {}
    for code, entry in flights.items():
        date_raw = entry.get("dep_date", "unknown")
        if date_raw not in grouped:
            grouped[date_raw] = []
        grouped[date_raw].append((code, entry))
    # Sort each day's list by dep_time
    for date_raw in grouped:
        grouped[date_raw].sort(key=lambda x: x[1].get("dep_time", "00:00"))
    return grouped

def format_date_display(date_raw: str) -> str:
    try:
        dt = datetime.strptime(date_raw, "%d%m%Y")
        return dt.strftime("%A, %d %B %Y")
    except Exception:
        return date_raw

def status_emoji(status: str) -> str:
    mapping = {
        "On–Time": "🟢",
        "Delayed": "🟡",
        "Cancelled": "🔴",
        "Rescheduled": "🔵",
    }
    return mapping.get(status, "⚪")

def build_day_embed(date_raw: str, flights_on_day: list) -> discord.Embed:
    """Build the flight board embed for a given day."""
    date_ordinal = format_date_ordinal(date_raw)
    embed = discord.Embed(
        title=f"<:AIC_Calendar:1419416309174636666>  {date_ordinal}",
        description=f"Displayed flights are hosted on the {date_ordinal}. To check more information about a flight, select it on the display menu down below.",
        color=13047318,
    )
    for code, entry in flights_on_day:
        flight_number    = entry.get("flight_number", "???")
        dep_code         = entry.get("dep_code", "???")
        arr_code         = entry.get("arr_code", "???")
        dep_time         = entry.get("dep_time", "?")
        aircraft_display = aircraft_full_name(entry.get("aircraft", "N/A"))
        embed.add_field(
            name=f"<:AIC_Takeoff:1419416267302899824> {flight_number}",
            value=(
                f"-# <:AIC_Route:1439504509926903838> Route: {dep_code} to {arr_code}\n"
                f"-# <:AIC_Clock:1419417053109944444> Departure time: {dep_time} UTC\n"
                f"-# <:AIC_Plane:1473800759173976325> Aircraft: {aircraft_display}\n\n"
            ),
            inline=True
        )
    embed.set_image(url="https://message.style/cdn/images/ea75ce6f1ccf8a29c0d92c39a5daf807711b498b1df7ae0cf143f660d75ca454.png")
    return embed


class DayScheduleView(View):
    """A View with a Select menu to pick a flight and see full details."""
    def __init__(self, flights_on_day: list, date_raw: str = ""):
        super().__init__(timeout=None)
        self.add_item(FlightSelectMenu(flights_on_day, date_raw=date_raw))


class FlightSelectMenu(Select):
    def __init__(self, flights_on_day: list, date_raw: str = ""):
        options = []
        for code, entry in flights_on_day[:25]:
            flight_number = entry.get("flight_number", code)
            dep_time      = entry.get("dep_time", "")
            options.append(discord.SelectOption(
                label=flight_number,
                value=code,
                description=f"Departure: {dep_time} UTC",
                emoji="<:AC_Dot:1439504671927570432>"
            ))
        # Use date-scoped custom_id so each day's message has a unique, stable ID
        cid = f"flight_select_{date_raw}" if date_raw else "flight_select_menu"
        super().__init__(
            placeholder="Select a flight to view details...",
            min_values=1,
            max_values=1,
            options=options,
            custom_id=cid
        )

    async def callback(self, interaction: discord.Interaction):
        code  = self.values[0]
        entry = user_data.get(code)
        if not entry:
            await interaction.response.send_message("⚠️ Flight not found.", ephemeral=True)
            return
        event_link = entry.get("event", {}).get("link", "N/A")
        if event_link and event_link != "N/A":
            # Direct user to the event link instead of showing an ephemeral embed
            view = discord.ui.View()
            view.add_item(discord.ui.Button(
                label="Open Event",
                url=event_link,
                style=discord.ButtonStyle.link,
                emoji="<:AIC_Link:1417212068028874865>"
            ))
            flight_number = entry.get("flight_number", code)
            await interaction.response.send_message(
                content=f"Click below to join **{flight_number}**:",
                view=view,
                ephemeral=True
            )
        else:
            embed = build_detail_embed(entry)
            await interaction.response.send_message(embed=embed, ephemeral=True)


def build_detail_embed(entry: dict) -> discord.Embed:
    """Full detail embed shown ephemerally when a user selects a flight."""
    dep_airport  = entry.get("dep_airport", "N/A")
    dep_code     = entry.get("dep_code", "N/A")
    dep_time     = entry.get("dep_time", "N/A")
    terminal     = entry.get("terminal", "N/A")
    dep_gate     = entry.get("gate", {}).get("dep", "N/A")
    arr_airport  = entry.get("arr_airport", "N/A")
    arr_code     = entry.get("arr_code", "N/A")
    arr_time     = entry.get("arr_time", "N/A")
    arr_gate     = entry.get("gate", {}).get("arr", "N/A")
    dep_date_raw = entry.get("dep_date", "N/A")
    try:
        dt     = datetime.strptime(dep_date_raw, "%d%m%Y")
        day    = dt.day
        suffix = "th" if 11 <= day <= 13 else {1:"st",2:"nd",3:"rd"}.get(day % 10, "th")
        dep_date_display = f"{day}{suffix} {dt.strftime('%B %Y')}"
    except Exception:
        dep_date_display = dep_date_raw
    aircraft_display = aircraft_full_name(entry.get("aircraft", "N/A"))
    meal         = entry.get("meal_service", "N/A")
    status       = entry.get("status", "N/A")
    host         = entry.get("host_user_id") or entry.get("host", "Unknown")
    alerts       = entry.get("alerts", "N/A")
    server_link  = entry.get("server", {}).get("link", "N/A")
    flight_number = entry.get("flight_number", "Unknown")

    embed = discord.Embed(
        description=f"# <:AIC_Takeoff:1419416267302899824> {flight_number}",
        color=13047318
    )
    embed.add_field(
        name="<:AIC_Takeoff:1419416267302899824> Departure",
        value=(
            f"> -# <:AIC_Location:1473809150206017596> {dep_airport}\n"
            f"> -# <:AIC_Airport:1419416394122006528> {dep_code}\n"
            f"> -# <:AIC_Clock:1419417053109944444> {dep_time}\n"
            f"> -# <:AIC_Airport:1419416394122006528> Terminal {terminal}\n"
            f"> -# <:AIC_BoardingPass:1419417172035240068> Gate {dep_gate}"
        ),
        inline=True
    )
    embed.add_field(
        name="<:AIC_Landing:1419416286546362388> Arrival",
        value=(
            f"> -# <:AIC_Location:1473809150206017596> {arr_airport}\n"
            f"> -# <:AIC_Airport:1419416394122006528> {arr_code}\n"
            f"> -# <:AIC_Clock:1419417053109944444> {arr_time}\n"
            f"> -# <:AIC_BoardingPass:1419417172035240068> Gate {arr_gate}"
        ),
        inline=True
    )
    embed.add_field(
        name="<:AIC_Information:1440775211082453002> Flight Information",
        value=(
            f"> -# <:AIC_Calendar:1419416309174636666> {dep_date_display}\n"
            f"> -# <:AIC_Seat:1419416588964335706> Aircraft: {aircraft_display}\n"
            f"> -# <:AIC_MealService:1419416320948306112> {meal}\n"
            f"> -# <:AIC_Status:1419416335271596242> Flight Status: {status}\n"
            f"> -# <:AIC_2:1419416360353796247> Host: <@{host}>\n"
            f"> -# <:AIC_Warning:1419416746514841743> Alerts: {alerts}\n\n"
            f"> -# <:AIC_Link:1417212068028874865> Server Link: {server_link}"
        ),
        inline=False
    )
    embed.set_image(url="https://message.style/cdn/images/ea75ce6f1ccf8a29c0d92c39a5daf807711b498b1df7ae0cf143f660d75ca454.png")
    return embed


async def post_or_update_day_schedule(guild: discord.Guild, date_raw: str):
    """
    Post or update the grouped embed for a given date in the public channel.
    - Message IDs are stored in user_data["_day_msgs"][date_raw] and persisted to DB.
    - If the date is already in the past (UTC), the message is never re-sent.
    - If the date just passed midnight, the cleanup task handles deletion.
    """
    public_ch = guild.get_channel(PUBLIC_CHANNEL_ID)
    if not public_ch:
        return

    # Only post/update for today UTC — never for past or future days
    try:
        flight_date = datetime.strptime(date_raw, "%d%m%Y").date()
        today_utc   = datetime.now(timezone.utc).date()
        if flight_date != today_utc:
            return   # not today — do not post or update
    except Exception:
        pass  # if date is malformed, fall through

    real_flights = get_real_flights()
    grouped = group_flights_by_date(real_flights)
    flights_on_day = grouped.get(date_raw, [])

    if not flights_on_day:
        return

    embed = build_day_embed(date_raw, flights_on_day)
    view  = DayScheduleView(flights_on_day, date_raw=date_raw)

    # Storage for day message IDs (DB-backed via user_data)
    if "_day_msgs" not in user_data:
        user_data["_day_msgs"] = {}

    existing_msg_id = user_data["_day_msgs"].get(date_raw)

    if existing_msg_id:
        try:
            msg = await fetch_message_with_retries(public_ch, int(existing_msg_id))
            if msg:
                await msg.edit(embed=embed, view=view)
                return
        except Exception:
            pass
        # Message gone — clear the stale ID so we send a fresh one
        del user_data["_day_msgs"][date_raw]
        await save_user_data()

    # Post new message
    msg = await public_ch.send(
        content=f"<@&{FLIGHT_NOTIFY_ROLE}>",
        embed=embed,
        view=view,
        allowed_mentions=allowed_mentions
    )
    user_data["_day_msgs"][date_raw] = str(msg.id)
    await save_user_data()


async def delete_day_schedule_message(guild: discord.Guild, date_raw: str):
    """Delete the public flight board message for a given date and remove it from DB."""
    public_ch = guild.get_channel(PUBLIC_CHANNEL_ID)
    if not public_ch:
        return

    if "_day_msgs" not in user_data:
        return

    msg_id = user_data["_day_msgs"].get(date_raw)
    if not msg_id:
        return

    try:
        msg = await fetch_message_with_retries(public_ch, int(msg_id))
        if msg:
            await msg.delete()
    except Exception:
        pass  # already deleted or missing — that's fine

    # Remove from DB regardless
    del user_data["_day_msgs"][date_raw]
    await save_user_data()


# -----------------------
# ─── WEB DASHBOARD API ────────────────────────────────────────────────────────
# -----------------------

def create_api():
    if not WEB_ENABLED:
        return None

    from auth import router as auth_router, require_auth, get_session, require_manager, require_owner

    app = FastAPI(title="AIC PTFS Dashboard API")

    import os as _os
    _static_dir = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "static")
    if _os.path.isdir(_static_dir):
        app.mount("/static", StaticFiles(directory=_static_dir), name="static")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount auth routes (/auth/login, /auth/callback, /auth/logout, /auth/me)
    app.include_router(auth_router)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/api/routes")
    async def list_routes():
        """Diagnostic: list every registered route on this app."""
        routes = []
        for r in app.routes:
            routes.append({
                "path":    getattr(r, "path", str(r)),
                "methods": sorted(getattr(r, "methods", None) or []),
                "name":    getattr(r, "name", ""),
            })
        routes.sort(key=lambda x: x["path"])
        auth_routes   = [r for r in routes if r["path"].startswith("/auth")]
        other_routes  = [r for r in routes if not r["path"].startswith("/auth")]
        from auth import router as _ar
        auth_router_routes = [
            {"path": getattr(r,"path","?"), "methods": sorted(getattr(r,"methods",None) or [])}
            for r in _ar.routes
        ]
        import sys
        auth_file = sys.modules.get("auth").__file__ if sys.modules.get("auth") else "not loaded"
        return {
            "total_routes": len(routes),
            "auth_routes_on_app": auth_routes,
            "auth_router_routes": auth_router_routes,
            "auth_module_file": auth_file,
            "all_routes": routes,
        }

    def serialize_entry(code: str, entry: dict) -> dict:
        """Convert a flight entry to a safe JSON-serializable dict for the API."""
        dep_date_raw = entry.get("dep_date", "")
        try:
            dt = datetime.strptime(dep_date_raw, "%d%m%Y")
            dep_date_display = dt.strftime("%Y-%m-%d")
        except Exception:
            dep_date_display = dep_date_raw

        return {
            "code": code,
            "flight_number": entry.get("flight_number", ""),
            "dep_city": entry.get("dep_city", ""),
            "arr_city": entry.get("arr_city", ""),
            "dep_code": entry.get("dep_code", ""),
            "arr_code": entry.get("arr_code", ""),
            "dep_airport": entry.get("dep_airport", ""),
            "arr_airport": entry.get("arr_airport", ""),
            "dep_time": entry.get("dep_time", ""),
            "arr_time": entry.get("arr_time", ""),
            "dep_date": dep_date_display,
            "dep_date_raw": dep_date_raw,
            "duration": entry.get("duration", ""),
            "terminal": entry.get("terminal", ""),
            "aircraft": entry.get("aircraft", ""),
            "meal_service": entry.get("meal_service", "N/A"),
            "status": entry.get("status", "N/A"),
            "gate_dep": entry.get("gate", {}).get("dep", "N/A"),
            "gate_arr": entry.get("gate", {}).get("arr", "N/A"),
            "alerts": entry.get("alerts", "N/A"),
            "server_link": entry.get("server", {}).get("link", "N/A"),
            "event_link": entry.get("event", {}).get("link", "N/A"),
            "host_user_id": entry.get("host_user_id", ""),
            "cohosts":      entry.get("cohosts", []),
            "crew":         entry.get("crew", {}),
            "created_at": entry.get("created_at", ""),
            "pax": entry.get("pax", None),
            "pax_joined": entry.get("pax_joined", None),
            "pax_remained": entry.get("pax_remained", None),
            "pax_notes": entry.get("pax_notes", ""),
            "final_status": entry.get("final_status", None),  # status captured before marking Ended
            "is_codeshare": entry.get("is_codeshare", False),
            "codeshare_flight": entry.get("codeshare_flight", ""),  # secondary flight number
        }

    from fastapi.responses import RedirectResponse as _Redirect

    def _file(name: str):
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), name)

    from fastapi import Response

    @app.api_route("/discord-health", methods=["GET", "HEAD"])
    async def discord_health():
        from fastapi import Response

        if bot.is_ready():
            return Response(status_code=200)

        return Response(status_code=503)

    @app.api_route("/health", methods=["GET", "HEAD"])
    async def health():
        return Response(status_code=200)

    @app.api_route("/db-health", methods=["GET", "HEAD"])
    async def db_health():
        from fastapi import Response
        try:
            con = _db_conn_sync()
            cur = con.cursor()
            cur.execute("SELECT 1")
            cur.close()
            con.close()
            return Response(status_code=200)
        except:
            return Response(status_code=503)
    
    @app.api_route("/oauth-health", methods=["GET", "HEAD"])
    async def oauth_health():
        from fastapi import Response

        try:
            if auth_router:
                return Response(status_code=200)

        except:
            pass

        return Response(status_code=503)

    @app.get("/")
    async def serve_root(request: Request):
        session = get_session(request)
        if not session or not session.get("has_role"):
            return _Redirect("/login.html", status_code=302)
        return FileResponse(_file("dashboard.html"), media_type="text/html")

    @app.get("/login.html")
    async def serve_login(request: Request):
        session = get_session(request)
        if session and session.get("has_role"):
            return _Redirect("/", status_code=302)
        return FileResponse(_file("login.html"), media_type="text/html")

    @app.get("/loading.html")
    async def serve_loading(request: Request):
        return FileResponse(_file("loading.html"), media_type="text/html")

    @app.get("/dashboard.html")
    async def serve_dashboard(request: Request):
        session = get_session(request)
        if not session or not session.get("has_role"):
            return _Redirect("/login.html", status_code=302)
        return FileResponse(_file("dashboard.html"), media_type="text/html")

    @app.get("/dashboard")
    async def serve_dashboard_clean(request: Request):
        session = get_session(request)
        if not session or not session.get("has_role"):
            return _Redirect("/login.html", status_code=302)
        return FileResponse(_file("dashboard.html"), media_type="text/html")

    @app.get("/dashboard/manager")
    async def serve_manager_dashboard(request: Request):
        session = get_session(request)
        if not session or not session.get("has_role"):
            return _Redirect("/login.html", status_code=302)
        if not (session.get("is_manager") or session.get("is_bod") or session.get("is_owner")):
            return _Redirect("/dashboard", status_code=302)
        return FileResponse(_file("dashboard-manager.html"), media_type="text/html")

    @app.get("/dashboard/owner")
    async def serve_owner_dashboard(request: Request):
        session = get_session(request)
        if not session or not session.get("has_role"):
            return _Redirect("/login.html", status_code=302)
        if not session.get("is_owner"):
            return _Redirect("/dashboard", status_code=302)
        return FileResponse(_file("dashboard-owner.html"), media_type="text/html")

    @app.get("/dashboard/staff")
    async def serve_staff_dashboard(request: Request):
        session = get_session(request)
        if not session or not session.get("has_role"):
            return _Redirect("/login.html", status_code=302)
        return FileResponse(_file("dashboard-staff.html"), media_type="text/html")

    @app.get("/dashboard/{code}")
    async def serve_dashboard_for_code(code: str, request: Request):
        session = get_session(request)
        if not session or not session.get("has_role"):
            return _Redirect("/login.html", status_code=302)
        if code.lower() in {"manager", "owner", "staff"}:
            return _Redirect(f"/dashboard/{code.lower()}", status_code=302)
        return FileResponse(_file("dashboard.html"), media_type="text/html")

    @app.get("/dashboard/attendance/{code}")
    async def serve_attendance_page(code: str, request: Request):
        session = get_session(request)
        if not session or not session.get("has_role"):
            return _Redirect("/login.html", status_code=302)
        return FileResponse(_file("dashboard.html"), media_type="text/html")

    @app.get("/api/flights")
    async def get_flights(request: Request, _session=None):
        require_auth(request)
        real = get_real_flights()
        return [serialize_entry(code, entry) for code, entry in real.items()]

    @app.get("/api/flights/{code}")
    async def get_flight(code: str, request: Request):
        require_auth(request)
        entry = user_data.get(code.upper())
        if not entry or "flight_number" not in entry:
            raise HTTPException(status_code=404, detail="Flight not found")
        return serialize_entry(code.upper(), entry)

    @app.patch("/api/flights/{code}")
    async def update_flight(code: str, request: Request):
        require_auth(request)
        code = code.upper()
        entry = user_data.get(code)
        if not entry or "flight_number" not in entry:
            raise HTTPException(status_code=404, detail="Flight not found")

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        # Allowed fields to update via API
        _upd_session = get_session(request)
        _is_privileged = isinstance(_upd_session, dict) and (
            _upd_session.get("is_owner") or _upd_session.get("is_manager") or _upd_session.get("is_bod")
        )
        field_map = {
            "status": lambda v: entry.update({"status": v}),
            "alerts": lambda v: entry.update({"alerts": v}),
            "meal_service": lambda v: entry.update({"meal_service": v}),
            "gate_dep": lambda v: entry.setdefault("gate", {}).update({"dep": v}),
            "gate_arr": lambda v: entry.setdefault("gate", {}).update({"arr": v}),
            "server_link": lambda v: entry.setdefault("server", {}).update({"link": v}),
            "event_link": lambda v: entry.setdefault("event", {}).update({"link": v}),
            "pax": lambda v: entry.update({"pax": v}),
            "pax_joined": lambda v: entry.update({"pax_joined": v}),
            "pax_remained": lambda v: entry.update({"pax_remained": v}),
            "pax_notes": lambda v: entry.update({"pax_notes": v}),
            "is_codeshare": lambda v: entry.update({"is_codeshare": bool(v)}),
            "codeshare_flight": lambda v: entry.update({"codeshare_flight": v}),
            "final_status": lambda v: entry.update({"final_status": v}) if v else None,
            "cohosts": lambda v: entry.update({"cohosts": [str(c).strip() for c in (v or []) if str(c).strip()]}),
        }
        if _is_privileged:
            field_map.update({
                "flight_number": lambda v: entry.update({"flight_number": v}),
                "dep_city":      lambda v: entry.update({"dep_city": v}),
                "arr_city":      lambda v: entry.update({"arr_city": v}),
                "dep_code":      lambda v: entry.update({"dep_code": v}),
                "arr_code":      lambda v: entry.update({"arr_code": v}),
                "dep_airport":   lambda v: entry.update({"dep_airport": v}),
                "arr_airport":   lambda v: entry.update({"arr_airport": v}),
                "dep_time":      lambda v: entry.update({"dep_time": v}),
                "arr_time":      lambda v: entry.update({"arr_time": v}),
                "duration":      lambda v: entry.update({"duration": v}),
                "terminal":      lambda v: entry.update({"terminal": v}),
                "aircraft":      lambda v: entry.update({"aircraft": v}),
                "host_user_id":  lambda v: entry.update({"host_user_id": str(v).strip()}) if v else None,
            })

        # Valid statuses (including Ended)
        # Normalise any dash variant → en-dash so stored values are consistent
        if "status" in body and body["status"] is not None:
            body["status"] = (
                str(body["status"])
                .replace("—", "–")   # em-dash → en-dash
                .replace("-", "–")         # hyphen  → en-dash
                .strip()
            )
        VALID_STATUSES = {"On–Time", "Delayed", "Cancelled", "Rescheduled", "N/A", "Ended"}
        if "status" in body and body["status"] not in VALID_STATUSES:
            raise HTTPException(status_code=422, detail=f"Invalid status received: {repr(body['status'])}")

        # Before setting status → Ended, snapshot the current meaningful status
        if body.get("status") == "Ended":
            prev = entry.get("status", "N/A")
            if prev in ("On–Time", "Delayed", "Cancelled", "Rescheduled"):
                entry["final_status"] = prev
            # Stamp ended_at only on first transition (so the 2h attendance window is accurate)
            if prev != "Ended":
                entry["ended_at"] = datetime.now(timezone.utc).isoformat() + "Z"

        updated = []
        for field, updater in field_map.items():
            if field in body:
                updater(body[field])
                updated.append(field)

        if updated:
            await save_user_data(user_trigger_desc=f"API update {code}: {updated}")
            session = get_session(request)
            session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
            log_to_file(f"Updated flight {code}: {', '.join(updated)}", user=session_username, level="ok")
            # Refresh Discord embeds (update flight embed only, do NOT repost the board)
            g = discord.utils.get(bot.guilds, id=GUILD_ID)
            if g:
                try:
                    await update_embeds_for_code(bot, code)
                except Exception:
                    pass

        return serialize_entry(code, entry)

    @app.post("/api/flights")
    async def create_flight(request: Request):
        require_auth(request)
        try:
            body = await request.json()
        except Exception as _e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON: {_e}")

        required = ["flight_number","dep_city","arr_city","dep_code","arr_code",
                    "dep_airport","arr_airport","dep_time","arr_time","dep_date",
                    "duration","aircraft","event_link"]
        missing = [f for f in required if not body.get(f)]
        if missing:
            raise HTTPException(status_code=422, detail=f"Missing fields: {missing}")

        code = generate_code()
        while code in user_data:
            code = generate_code()

        # Accept YYYY-MM-DD from the web form, store as DDMMYYYY
        dep_date_raw = body["dep_date"]
        try:
            dt = datetime.strptime(dep_date_raw, "%Y-%m-%d")
            dep_date_stored = dt.strftime("%d%m%Y")
        except Exception:
            dep_date_stored = dep_date_raw

        # ── Scheduled flight limit ───────────────────────────────────────
        _host_uid   = str(body.get("host_user_id", "")).strip()
        _sched_cfg  = _feature_config.get("flight_scheduling", {})
        _max_sched  = int(_sched_cfg.get("max_scheduled_flights", 3))
        _override_limit = bool(body.get("override_limit", False))
        if _host_uid and _max_sched > 0 and not _override_limit:
            try:
                _count = sum(
                    1 for _e in user_data.values()
                    if isinstance(_e, dict)
                    and "flight_number" in _e
                    and str(_e.get("host_user_id", "")) == _host_uid
                    and _e.get("status") not in ("Cancelled", "Ended")
                )
                if _count >= _max_sched:
                    raise HTTPException(
                        status_code=429,
                        detail=f"Flight limit reached: this host already has {_count} active flight(s) scheduled (max {_max_sched})."
                    )
            except HTTPException: raise
            except: pass

        # ── Blackout date check ───────────────────────────────────────────
        blackout_dates = user_data.get("__blackout__", [])
        # dep_date_stored is DDMMYYYY, convert to YYYY-MM-DD for comparison
        try:
            _bdt = datetime.strptime(dep_date_stored, "%d%m%Y")
            _bkey = _bdt.strftime("%Y-%m-%d")
            if _bkey in blackout_dates:
                raise HTTPException(
                    status_code=422,
                    detail=f"Cannot schedule flights on {_bkey} — this date is blacked out."
                )
        except HTTPException:
            raise
        except Exception:
            pass

        # ── Advance scheduling check (configurable) ────────────────────────
        _adv_hours = int(_feature_config.get("flight_scheduling", {}).get("advance_hours", 24))
        if _adv_hours > 0:
            try:
                from datetime import datetime as _dtadv
                dep_dt_check = _dtadv.strptime(dep_date_stored, "%d%m%Y")
                dep_h_adv, dep_m_adv = map(int, body["dep_time"].strip().split(":"))
                dep_full_dt = dep_dt_check.replace(hour=dep_h_adv, minute=dep_m_adv)
                now_utc = _dtadv.now().replace(tzinfo=None)
                hours_until = (dep_full_dt - now_utc).total_seconds() / 3600
                if hours_until < _adv_hours:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Flights must be scheduled at least {_adv_hours}h in advance."
                    )
            except HTTPException:
                raise
            except Exception:
                pass

        # ── 2-hour conflict check ──────────────────────────────────────────
        dep_time_check = body["dep_time"].strip()
        dep_date_check = dep_date_stored
        if dep_time_check and ":" in dep_time_check:
            try:
                from datetime import datetime as _dtc
                h, m = map(int, dep_time_check.split(":"))
                new_mins = h * 60 + m
                conflicts = []
                for ex_code, ex_entry in get_real_flights().items():
                    if ex_entry.get("dep_date") != dep_date_check:
                        continue
                    if ex_entry.get("status") == "Ended":
                        continue
                    ex_time = ex_entry.get("dep_time", "")
                    if not ex_time or ":" not in ex_time:
                        continue
                    eh, em = map(int, ex_time.split(":"))
                    ex_mins = eh * 60 + em
                    diff = abs(new_mins - ex_mins)
                    if diff < 120:
                        conflicts.append({
                            "code": ex_code,
                            "flight_number": ex_entry.get("flight_number", ex_code),
                            "dep_time": ex_time,
                            "gap_minutes": diff,
                        })
                if conflicts:
                    c = conflicts[0]
                    raise HTTPException(
                        status_code=409,
                        detail=f"CONFLICT: {c['flight_number']} departs at {c['dep_time']} — only {c['gap_minutes']} min gap (minimum 2 hours required)"
                    )
            except HTTPException:
                raise
            except Exception:
                pass

        entry = {
            "code": code,
            "flight_number": body["flight_number"].strip(),
            "dep_city":      body["dep_city"].strip(),
            "arr_city":      body["arr_city"].strip(),
            "dep_code":      body["dep_code"].strip().upper(),
            "arr_code":      body["arr_code"].strip().upper(),
            "dep_airport":   body["dep_airport"].strip(),
            "arr_airport":   body["arr_airport"].strip(),
            "dep_time":      body["dep_time"].strip(),
            "arr_time":      body["arr_time"].strip(),
            "dep_date":      dep_date_stored,
            "duration":      body["duration"].strip(),
            "terminal":      (body.get("terminal") or "N/A").strip() or "N/A",
            "aircraft":      body["aircraft"].strip().upper(),
            "host_user_id":  body.get("host_user_id", "").strip(),
            "gate":          {"dep": "N/A", "arr": "N/A"},
            "meal_service":  body.get("meal_service", "N/A"),
            "status":        "On–Time",
            "alerts":        "N/A",
            "server":        {"link": "N/A"},
            "event":         {"link": body.get("event_link", "N/A") or "N/A"},
            "is_codeshare":   bool(body.get("is_codeshare", False)),
            "codeshare_flight": (body.get("codeshare_flight") or "").strip(),
            "public_message_id":  None,
            "admin_message_id":   None,
            "created_at":    datetime.now(timezone.utc).isoformat() + "Z",
        }

        # Add crew signup slots to entry
        entry["crew"] = {
            "pilot":    None,   # user_id or None
            "copilot":  None,
            "cc":       [],     # up to 3
            "gc":       [],     # up to 3
            "backup":   [],     # unlimited
            "thread_id": None,  # Discord thread ID once created
            "message_id": None, # signup message ID in thread
        }

        user_data[code] = entry
        await save_user_data(user_trigger_desc=f"Dashboard created flight {code}")
        session = get_session(request)
        session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        log_to_file(f"Created flight {code} ({entry['flight_number']}) {entry['dep_code']}→{entry['arr_code']}", user=session_username, level="ok")

        # Create crew signup thread in Discord (fire-and-forget, errors logged not raised)
        try:
            asyncio.create_task(_create_crew_thread(code, entry))
        except Exception as _crew_ex:
            log_to_file(f"Could not schedule crew thread task: {_crew_ex}", level="warn")

        # (day schedule only posts at midnight)

        return serialize_entry(code, entry)

    @app.post("/api/flights/{code}/remind")
    async def send_reminder_api(code: str, request: Request):
        require_auth(request)
        code = code.upper()
        entry = user_data.get(code)
        if not entry or "flight_number" not in entry:
            raise HTTPException(status_code=404, detail="Flight not found")
        body = await request.json()
        timestamp_text = (body.get("timestamp") or "").strip()
        if not timestamp_text:
            raise HTTPException(status_code=422, detail="Missing 'timestamp' field")
        flight_number = entry.get("flight_number", "Unknown")
        event_link    = entry.get("event", {}).get("link", "N/A")
        msg_text = (
            f"# {flight_number} OPENS IN {timestamp_text}\n"
            f"<@&{FLIGHT_NOTIFY_ROLE}>\n\n"
            f"Please select \"interested\" if attending!\n\n"
            f"Event link: {event_link}"
        )
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if g:
            try:
                channel = g.get_channel(ANNOUNCE_CHANNEL_ID)
                if channel:
                    await channel.send(msg_text)
            except Exception as e:
                safe_console_print(f"Dashboard remind error: {e}")
        session = get_session(request)
        session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        log_to_file(f"Sent reminder for {code} ({entry.get('flight_number','?')}) — opens in {timestamp_text}", user=session_username, level="info")
        return {"sent": True, "code": code, "timestamp": timestamp_text}

    @app.post("/api/flights/{code}/start")
    async def start_flight_api(code: str, request: Request):
        require_auth(request)
        code = code.upper()
        entry = user_data.get(code)
        if not entry or "flight_number" not in entry:
            raise HTTPException(status_code=404, detail="Flight not found")
        body = await request.json()
        server_link    = (body.get("server_link") or "").strip()
        spawn_location = (body.get("spawn_location") or "").strip()
        if not server_link:
            raise HTTPException(status_code=422, detail="Missing 'server_link' field")
        entry["server"]["link"] = server_link
        await save_user_data(user_trigger_desc=f"Dashboard start flight {code}")
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if g:
            try:
                await update_embeds_for_code(bot, code)
            except Exception as e:
                safe_console_print(f"Dashboard start — embed update error: {e}")
            try:
                channel = g.get_channel(ANNOUNCE_CHANNEL_ID)
                if channel:
                    flight_number = entry.get("flight_number", "Unknown")
                    arr_city      = entry.get("arr_city", "Unknown")
                    announce_text = (
                        f"# {flight_number} to {arr_city} has begun check-in.\n"
                        f"<@&{FLIGHT_START_ROLE}>\n\n"
                        f"Please head to check-in at **{spawn_location or 'the airport'}**\n\n"
                        f"> <:AIC_Link:1417212068028874865> {server_link}"
                    )
                    msg = await channel.send(announce_text)
                    entry["announce_message_id"] = str(msg.id)
                    await save_user_data(user_trigger_desc=f"Dashboard announce start flight {code}")
            except Exception as e:
                safe_console_print(f"Dashboard start — announce error: {e}")
        session = get_session(request)
        session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        log_to_file(f"Started flight {code} ({entry.get('flight_number','?')}) — server: {server_link}", user=session_username, level="ok")
        return {"started": True, "code": code, "server_link": server_link}

    @app.delete("/api/flights/{code}")
    async def delete_flight(code: str, request: Request):
        require_auth(request)
        code = code.upper()
        if code not in user_data or "flight_number" not in user_data.get(code, {}):
            raise HTTPException(status_code=404, detail="Flight not found")
        flight_name = user_data[code].get("flight_number", code)
        del user_data[code]
        await save_user_data(user_trigger_desc=f"Dashboard deleted flight {code}")
        session = get_session(request)
        session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        log_to_file(f"Deleted flight {code} ({flight_name})", user=session_username, level="warn")
        return {"deleted": code}

    @app.get("/api/export/flights")
    async def export_flights_csv(request: Request):
        """Download all flights as CSV."""
        require_auth(request)
        import csv, io
        fields = ["code","flight_number","dep_date","dep_time","arr_time","duration",
                  "dep_city","dep_code","dep_airport","arr_city","arr_code","arr_airport",
                  "terminal","aircraft","meal_service","status","final_status",
                  "gate_dep","gate_arr","server_link","event_link","alerts",
                  "host_user_id","pax","pax_joined","pax_remained","pax_notes",
                  "is_codeshare","codeshare_flight","cohosts","created_at"]
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=fields, extrasaction='ignore', lineterminator='\n')
        writer.writeheader()
        status_filter = request.query_params.get("status", "")
        ACTIVE_STATUSES = {"On–Time", "Delayed", "Rescheduled", "N/A"}
        for code, entry in user_data.items():
            if not isinstance(entry, dict) or "flight_number" not in entry:
                continue
            s = entry.get("status","")
            if status_filter == "active"    and s not in ACTIVE_STATUSES: continue
            if status_filter and status_filter != "active" and s != status_filter: continue
            row = serialize_entry(code, entry)
            row["cohosts"] = " ".join(entry.get("cohosts", []))
            writer.writerow(row)
        from fastapi.responses import Response as _RespCSV
        return _RespCSV(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=flights_export.csv"}
        )

    # ── Co-host Requests ──────────────────────────────────────────────────────

    @app.get("/api/cohost-requests")
    async def get_cohost_requests(request: Request):
        require_auth(request)
        return {"requests": user_data.get("__cohost_requests__", {})}

    @app.post("/api/cohost-requests")
    async def submit_cohost_request(request: Request):
        session = require_auth(request)
        body = await request.json()
        flight_code = (body.get("flight_code") or "").strip().upper()
        note = (body.get("note") or "").strip()[:200]
        if not flight_code:
            raise HTTPException(status_code=422, detail="Missing flight_code")
        entry = user_data.get(flight_code)
        if not entry or "flight_number" not in entry:
            raise HTTPException(status_code=404, detail="Flight not found")
        requester_id = str(session.get("user_id", ""))
        if str(entry.get("host_user_id","")) == requester_id:
            raise HTTPException(status_code=400, detail="You are already the host of this flight")
        if requester_id in entry.get("cohosts", []):
            raise HTTPException(status_code=400, detail="You are already a co-host of this flight")
        req_id = f"{flight_code}_{requester_id}"
        requests_dict = user_data.setdefault("__cohost_requests__", {})
        if req_id in requests_dict and requests_dict[req_id].get("status") == "pending":
            raise HTTPException(status_code=400, detail="Request already pending")
        requests_dict[req_id] = {
            "flight_code":      flight_code,
            "flight_number":    entry.get("flight_number",""),
            "requester_id":     requester_id,
            "requester_name":   session.get("username","?"),
            "requester_avatar": session.get("avatar",""),
            "note":             note,
            "status":           "pending",
            "submitted_at":     datetime.now(timezone.utc).isoformat() + "Z",
        }
        await save_user_data(user_trigger_desc=f"Cohost request {req_id}")
        log_to_file(f"Co-host request: {session.get('username','?')} → {flight_code}", user=session.get("username","?"), level="info")
        return {"ok": True, "req_id": req_id}

    @app.post("/api/cohost-requests/{req_id}/approve")
    async def approve_cohost_request(req_id: str, request: Request):
        session = require_manager(request)
        requests_dict = user_data.get("__cohost_requests__", {})
        req = requests_dict.get(req_id)
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        flight_code = req["flight_code"]
        entry = user_data.get(flight_code)
        if not entry:
            raise HTTPException(status_code=404, detail="Flight no longer exists")
        cohosts = entry.setdefault("cohosts", [])
        if req["requester_id"] not in cohosts:
            cohosts.append(req["requester_id"])
        req["status"] = "approved"
        await save_user_data(user_trigger_desc=f"Cohost approved {req_id}")
        mgr = session.get("username","manager") if isinstance(session,dict) else "manager"
        log_to_file(f"Co-host approved: {req['requester_name']} → {flight_code}", user=mgr, level="ok")
        return {"ok": True}

    @app.post("/api/cohost-requests/{req_id}/deny")
    async def deny_cohost_request(req_id: str, request: Request):
        session = require_manager(request)
        requests_dict = user_data.get("__cohost_requests__", {})
        req = requests_dict.get(req_id)
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        req["status"] = "denied"
        await save_user_data(user_trigger_desc=f"Cohost denied {req_id}")
        mgr = session.get("username","manager") if isinstance(session,dict) else "manager"
        log_to_file(f"Co-host denied: {req.get('requester_name','?')} → {req.get('flight_code','?')}", user=mgr, level="warn")
        return {"ok": True}

    @app.delete("/api/cohost-requests/{req_id}")
    async def delete_cohost_request(req_id: str, request: Request):
        require_auth(request)
        requests_dict = user_data.get("__cohost_requests__", {})
        requests_dict.pop(req_id, None)
        await save_user_data(user_trigger_desc=f"Cohost request deleted {req_id}")
        return {"ok": True}

    # ── Availability ─────────────────────────────────────────────────────────

    @app.get("/api/availability")
    async def get_my_availability(request: Request):
        """Get the current user's weekly availability schedule."""
        session = require_auth(request)
        uid = str(session.get("user_id", ""))
        avail = user_data.get("__availability__", {})
        return {"slots": avail.get(uid, [])}

    @app.post("/api/availability")
    async def save_my_availability(request: Request):
        """Save the current user's weekly availability schedule."""
        session = require_auth(request)
        uid = str(session.get("user_id", ""))
        body = await request.json()
        slots = body.get("slots", [])
        # Validate: each slot must be "day:hour" where day 0-6, hour 0-23
        valid = []
        for s in slots:
            try:
                d, h = str(s).split(":")
                if 0 <= int(d) <= 6 and 0 <= int(h) <= 23:
                    valid.append(f"{int(d)}:{int(h)}")
            except Exception:
                pass
        avail = user_data.setdefault("__availability__", {})
        avail[uid] = valid
        await save_user_data(user_trigger_desc=f"Availability updated for {session.get('username','?')}")
        return {"slots": valid}

    @app.get("/api/availability/{user_id}")
    async def get_user_availability(user_id: str, request: Request):
        """Get any user's availability (manager/owner only)."""
        require_manager(request)
        avail = user_data.get("__availability__", {})
        return {"user_id": user_id, "slots": avail.get(str(user_id), [])}

    @app.post("/api/flights/{code}/refresh")
    async def refresh_embed(code: str, request: Request):
        """Refresh the Discord embed for a flight without any changes."""
        session = require_auth(request)
        code = code.upper()
        entry = user_data.get(code)
        if not entry or "flight_number" not in entry:
            raise HTTPException(status_code=404, detail="Flight not found")
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if g:
            try:
                await update_embeds_for_code(bot, code)
            except Exception as e:
                safe_console_print(f"Dashboard refresh embed error: {e}")
        # Log the action
        session_username = session.get("username", "Dashboard User") if isinstance(session, dict) else "Dashboard User"
        safe_console_print(json.dumps({
            "time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
            "user": session_username,
            "action": f"Refreshed Discord embed for {code}",
            "level": "ok"
        }))
        return {"refreshed": code}

    @app.post("/api/flights/{code}/close")
    async def close_flight_api(code: str, request: Request):
        """Close flight gates (set server link to Gate Closed)."""
        session = require_auth(request)
        code = code.upper()
        entry = user_data.get(code)
        if not entry or "flight_number" not in entry:
            raise HTTPException(status_code=404, detail="Flight not found")
        entry["server"]["link"] = "<:AIC_Locked:1409728733589405777> Gate Closed"
        await save_user_data(user_trigger_desc=f"Dashboard close flight {code}")
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if g:
            try:
                await update_embeds_for_code(bot, code)
                # Update announce message if present
                announce_ch = g.get_channel(ANNOUNCE_CHANNEL_ID)
                if announce_ch and entry.get("announce_message_id"):
                    try:
                        announce_msg = await fetch_message_with_retries(announce_ch, int(entry["announce_message_id"]))
                        if announce_msg:
                            flight_number = entry.get("flight_number", "Unknown")
                            arr_city = entry.get("arr_city", "Unknown")
                            await announce_msg.edit(
                                content=(
                                    f"# {flight_number} to {arr_city} has closed boarding.\n"
                                    f"<@&{INTEREST_ROLE}> \n\n<:AIC_Locked:1409728733589405777> Gate Closed"
                                )
                            )
                    except Exception as e:
                        safe_console_print(f"Dashboard close — announce edit error: {e}")
            except Exception as e:
                safe_console_print(f"Dashboard close flight error: {e}")
        session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        log_to_file(f"Closed gates for {code} ({entry.get('flight_number','?')})", user=session_username, level="warn")
        return {"closed": code}

    # ── Staff Briefing Attendance ─────────────────────────────────────────────

    @app.get("/api/flights/{code}/attendance")
    async def get_flight_attendance(code: str, request: Request):
        """Return the full crew roster + per-member attendance state for a flight."""
        session = require_auth(request)
        code = code.upper()
        entry = user_data.get(code)
        if not entry or "flight_number" not in entry:
            raise HTTPException(status_code=404, detail="Flight not found")

        user_id        = str(session.get("user_id", ""))
        host_id        = str(entry.get("host_user_id", ""))
        cohosts        = [str(c) for c in entry.get("cohosts", [])]
        is_host_or_cohost = (user_id == host_id or user_id in cohosts)
        is_privileged  = bool(session.get("is_manager") or session.get("is_bod") or session.get("is_owner"))

        locked   = _is_attendance_locked(entry)
        can_edit = (is_host_or_cohost or is_privileged) and not locked

        crew       = entry.get("crew", {})
        attendance = crew.get("attendance", {})

        roster = []

        def add_member(member_id, name, role_label):
            if not member_id:
                return
            mid  = str(member_id)
            atd  = attendance.get(mid, {})
            def _get_val(col):
                val = atd.get(col, "absent")
                if val is True: return "present"
                if val is False: return "absent"
                return val

            roster.append({
                "id":           mid,
                "name":         name or mid,
                "role":         role_label,
                "briefing":     _get_val("briefing"),
                "flight_start": _get_val("flight_start"),
                "flight_end":   _get_val("flight_end"),
                "debrief":      _get_val("debrief"),
            })

        def _get_id(obj):
            if isinstance(obj, dict): return str(obj.get("id", ""))
            return str(obj) if obj else ""

        def _get_name(obj):
            uid = ""
            if isinstance(obj, dict): uid = str(obj.get("id", ""))
            elif obj: uid = str(obj)

            if uid.isdigit():
                g = bot.get_guild(GUILD_ID)
                if g:
                    m = g.get_member(int(uid))
                    if m: return m.display_name
                u = bot.get_user(int(uid))
                if u: return u.display_name

            if isinstance(obj, dict): return str(obj.get("name") or obj.get("id") or "?")
            return str(obj) if obj else ""

        # Host & co-hosts
        add_member(entry.get("host_user_id"), entry.get("host_user_id"), "🧑‍✈️ Host")
        for ch_id in entry.get("cohosts", []):
            add_member(ch_id, ch_id, "👤 Co-Host")

        # Crew signup slots
        if crew.get("pilot"):
            add_member(_get_id(crew["pilot"]), _get_name(crew["pilot"]), "🧑‍✈️ Pilot")
        if crew.get("copilot"):
            add_member(_get_id(crew["copilot"]), _get_name(crew["copilot"]), "👨‍✈️ Co-Pilot")
        for m in crew.get("cc", []):
            add_member(_get_id(m), _get_name(m), "🛎️ Cabin Crew")
        for m in crew.get("gc", []):
            add_member(_get_id(m), _get_name(m), "🔧 Ground Crew")
        for m in crew.get("backup", []):
            add_member(_get_id(m), _get_name(m), "🔄 Backup")

        # Build lock_info so the frontend can show a countdown
        lock_info: dict = {"locked": locked}
        if entry.get("status") == "Ended" and entry.get("ended_at") and not locked:
            try:
                ended_at_dt = datetime.fromisoformat(entry["ended_at"].replace("Z", "+00:00"))
                secs_left   = 7200 - (datetime.now(timezone.utc) - ended_at_dt).total_seconds()
                lock_info["seconds_until_lock"] = max(0, int(secs_left))
            except Exception:
                pass

        return {
            "code":          code,
            "flight_number": entry.get("flight_number", ""),
            "dep_code":      entry.get("dep_code", ""),
            "arr_code":      entry.get("arr_code", ""),
            "dep_date":      entry.get("dep_date", ""),
            "status":        entry.get("status", ""),
            "can_edit":      can_edit,
            "lock_info":     lock_info,
            "roster":        roster,
        }

    async def sync_attendance_to_sheet(code: str):
        """Asynchronously push the roster for a given flight code to Google Sheets."""
        if not GOOGLE_SHEET_ID:
            return
        entry = user_data.get(code)
        if not entry:
            return

        crew       = entry.get("crew", {})
        attendance = crew.get("attendance", {})

        roster = []
        def add_member(member_id, name, role_label):
            if not member_id: return
            mid = str(member_id)
            atd = attendance.get(mid, {})
            def _get_val(col):
                val = atd.get(col, "absent")
                if val is True: return "present"
                if val is False: return "absent"
                return val.capitalize()
            roster.append([
                name or mid,
                role_label,
                _get_val("briefing"),
                _get_val("flight_start"),
                _get_val("flight_end"),
                _get_val("debrief")
            ])

        def _get_id(obj):
            if isinstance(obj, dict): return str(obj.get("id", ""))
            return str(obj) if obj else ""

        def _get_name(obj):
            uid = _get_id(obj)
            if uid.isdigit():
                g = bot.get_guild(GUILD_ID)
                if g:
                    m = g.get_member(int(uid))
                    if m: return m.display_name
                u = bot.get_user(int(uid))
                if u: return u.display_name
            if isinstance(obj, dict): return str(obj.get("name") or obj.get("id") or "?")
            return str(obj) if obj else ""

        add_member(entry.get("host_user_id"), entry.get("host_user_id"), "Host")
        for ch_id in entry.get("cohosts", []):
            add_member(ch_id, ch_id, "Co-Host")
        if crew.get("pilot"): add_member(_get_id(crew["pilot"]), _get_name(crew["pilot"]), "Pilot")
        if crew.get("copilot"): add_member(_get_id(crew["copilot"]), _get_name(crew["copilot"]), "Co-Pilot")
        for m in crew.get("cc", []): add_member(_get_id(m), _get_name(m), "Cabin Crew")
        for m in crew.get("gc", []): add_member(_get_id(m), _get_name(m), "Ground Crew")
        for m in crew.get("backup", []): add_member(_get_id(m), _get_name(m), "Backup")

        def _do_sync():
            try:
                import gspread
                from google.oauth2.service_account import Credentials
                import os
                if not os.path.exists(GOOGLE_CREDENTIALS_FILE):
                    log_to_file("Google Sheets Sync Failed: Credentials file not found.", level="warn")
                    return
                scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
                creds = Credentials.from_service_account_file(GOOGLE_CREDENTIALS_FILE, scopes=scopes)
                client = gspread.authorize(creds)
                sheet = client.open_by_key(GOOGLE_SHEET_ID)
                ws_name = code.upper()
                try:
                    ws = sheet.worksheet(ws_name)
                    is_new = False
                except gspread.exceptions.WorksheetNotFound:
                    ws = sheet.add_worksheet(title=ws_name, rows=100, cols=10)
                    is_new = True

                try:
                    # Always ensure the flight worksheet is hidden using the standard API batch_update
                    hide_req = {
                        'updateSheetProperties': {
                            'properties': {
                                'sheetId': ws.id,
                                'hidden': True
                            },
                            'fields': 'hidden'
                        }
                    }
                    sheet.batch_update({'requests': [hide_req]})
                except Exception as he:
                    log_to_file(f"Could not hide flight worksheet {ws_name}: {he}", level="warn")

                if is_new:
                    try:
                        # Protect the entire new flight worksheet
                        prot_req = {
                            "addProtectedRange": {
                                "protectedRange": {
                                    "range": {
                                        "sheetId": ws.id
                                    },
                                    "description": f"Protected Flight Sheet {ws_name}",
                                    "warningOnly": False
                                }
                            }
                        }
                        sheet.batch_update({"requests": [prot_req]})
                    except Exception as pe:
                        log_to_file(f"Could not protect flight worksheet {ws_name}: {pe}", level="warn")

                header = [["Staff Member", "Role", "Briefing", "Flight-Start", "Flight-End", "Debrief"]]
                data = header + roster
                ws.clear()
                ws.update('A1', data)

                import gspread_formatting as gsf
                if is_new:
                    # Freeze top row
                    gsf.set_frozen(ws, rows=1)
                    
                    # Set column widths for Staff Member and Role
                    gsf.set_column_width(ws, 'A', 200)
                    gsf.set_column_width(ws, 'B', 150)

                    # Bold header with dark background
                    header_fmt = gsf.cellFormat(
                        backgroundColor=gsf.color(0.1, 0.1, 0.1),
                        textFormat=gsf.textFormat(bold=True, foregroundColor=gsf.color(1, 1, 1)),
                        horizontalAlignment='CENTER'
                    )
                    gsf.format_cell_range(ws, 'A1:F1', header_fmt)

                    # Center data columns
                    gsf.format_cell_range(ws, 'C2:F100', gsf.cellFormat(horizontalAlignment='CENTER'))

                    # Conditional Formatting for Attendance States
                    rules = gsf.get_conditional_format_rules(ws)
                    rules.clear()
                    
                    rule_present = gsf.ConditionalFormatRule(
                        ranges=[gsf.GridRange.from_a1_range('C2:F100', ws)],
                        booleanRule=gsf.BooleanRule(
                            condition=gsf.BooleanCondition('TEXT_EQ', ['Present']),
                            format=gsf.cellFormat(backgroundColor=gsf.color(0.85, 0.95, 0.85), textFormat=gsf.textFormat(foregroundColor=gsf.color(0.1, 0.5, 0.1), bold=True))
                        )
                    )
                    rule_late = gsf.ConditionalFormatRule(
                        ranges=[gsf.GridRange.from_a1_range('C2:F100', ws)],
                        booleanRule=gsf.BooleanRule(
                            condition=gsf.BooleanCondition('TEXT_EQ', ['Late']),
                            format=gsf.cellFormat(backgroundColor=gsf.color(1.0, 0.95, 0.8), textFormat=gsf.textFormat(foregroundColor=gsf.color(0.6, 0.4, 0.0), bold=True))
                        )
                    )
                    rule_absent = gsf.ConditionalFormatRule(
                        ranges=[gsf.GridRange.from_a1_range('C2:F100', ws)],
                        booleanRule=gsf.BooleanRule(
                            condition=gsf.BooleanCondition('TEXT_EQ', ['Absent']),
                            format=gsf.cellFormat(backgroundColor=gsf.color(0.98, 0.85, 0.85), textFormat=gsf.textFormat(foregroundColor=gsf.color(0.7, 0.1, 0.1), bold=True))
                        )
                    )
                    
                    rules.append(rule_present)
                    rules.append(rule_late)
                    rules.append(rule_absent)
                    rules.save()
                    
                # --- NEW: DATABASE AGGREGATION ---
                try:
                    db_ws = sheet.worksheet("DATABASE")
                    db_is_new = False
                except gspread.exceptions.WorksheetNotFound:
                    db_ws = sheet.add_worksheet(title="DATABASE", rows=200, cols=20)
                    db_is_new = True
                    try:
                        # Protect the entire new DATABASE worksheet
                        req = {
                            "addProtectedRange": {
                                "protectedRange": {
                                    "range": {
                                        "sheetId": db_ws.id
                                    },
                                    "description": "Protected DATABASE Sheet",
                                    "warningOnly": False
                                }
                            }
                        }
                        sheet.batch_update({"requests": [req]})
                    except Exception as pe:
                        log_to_file(f"Could not protect DATABASE worksheet: {pe}", level="warn")

                stats = {}
                for fcode, f_entry in user_data.items():
                    if not isinstance(f_entry, dict) or "crew" not in f_entry: continue
                    if f_entry.get("status") != "Ended": continue  # Only count flights that have finished (status is Ended)
                    f_crew = f_entry["crew"]
                    f_atd = f_crew.get("attendance", {})
                    if not f_atd: continue  # Skip historical flights that do not have attendance tracking data
                    
                    # Skip flights where no real attendance was taken (everyone has default 'absent' or False values)
                    has_real_attendance = False
                    for uid, atd_details in f_atd.items():
                        if not isinstance(atd_details, dict): continue
                        for col, state in atd_details.items():
                            if state is True or str(state).lower() in ["present", "late"]:
                                has_real_attendance = True
                                break
                        if has_real_attendance:
                            break
                    if not has_real_attendance:
                        continue
                    
                    assigned_users = set()
                    if f_entry.get("host_user_id"): assigned_users.add(str(f_entry["host_user_id"]))
                    for ch in f_entry.get("cohosts", []): assigned_users.add(str(ch))
                    for k in ["pilot", "copilot"]:
                        uid = _get_id(f_crew.get(k))
                        if uid: assigned_users.add(uid)
                    for k in ["cc", "gc", "backup"]:
                        for m in f_crew.get(k, []):
                            uid = _get_id(m)
                            if uid: assigned_users.add(uid)

                    for uid in assigned_users:
                        if uid not in stats:
                            stats[uid] = {
                                "shifts": 0,
                                "present": 0,
                                "late": 0,
                                "absent": 0,
                                "briefing_present": 0, "briefing_late": 0, "briefing_absent": 0,
                                "flight_start_present": 0, "flight_start_late": 0, "flight_start_absent": 0,
                                "flight_end_present": 0, "flight_end_late": 0, "flight_end_absent": 0,
                                "debrief_present": 0, "debrief_late": 0, "debrief_absent": 0,
                                "name": _get_name(uid)
                            }
                        
                        stats[uid]["shifts"] += 1
                        user_atd = f_atd.get(uid, {})
                        
                        # Briefing
                        val = user_atd.get("briefing", "absent")
                        if val is True or str(val).lower() == "present":
                            stats[uid]["briefing_present"] += 1
                            stats[uid]["present"] += 1
                        elif str(val).lower() == "late":
                            stats[uid]["briefing_late"] += 1
                            stats[uid]["late"] += 1
                        else:
                            stats[uid]["briefing_absent"] += 1
                            stats[uid]["absent"] += 1
                            
                        # Flight Start
                        val = user_atd.get("flight_start", "absent")
                        if val is True or str(val).lower() == "present":
                            stats[uid]["flight_start_present"] += 1
                            stats[uid]["present"] += 1
                        elif str(val).lower() == "late":
                            stats[uid]["flight_start_late"] += 1
                            stats[uid]["late"] += 1
                        else:
                            stats[uid]["flight_start_absent"] += 1
                            stats[uid]["absent"] += 1
                            
                        # Flight End
                        val = user_atd.get("flight_end", "absent")
                        if val is True or str(val).lower() == "present":
                            stats[uid]["flight_end_present"] += 1
                            stats[uid]["present"] += 1
                        elif str(val).lower() == "late":
                            stats[uid]["flight_end_late"] += 1
                            stats[uid]["late"] += 1
                        else:
                            stats[uid]["flight_end_absent"] += 1
                            stats[uid]["absent"] += 1
                            
                        # Debrief
                        val = user_atd.get("debrief", "absent")
                        if val is True or str(val).lower() == "present":
                            stats[uid]["debrief_present"] += 1
                            stats[uid]["present"] += 1
                        elif str(val).lower() == "late":
                            stats[uid]["debrief_late"] += 1
                            stats[uid]["late"] += 1
                        else:
                            stats[uid]["debrief_absent"] += 1
                            stats[uid]["absent"] += 1

                db_header = [[
                    "Staff Member", "Total Flights", "Total Present (Phases)", "Total Late (Phases)", "Total Absent (Phases)", 
                    "Briefing Present", "Briefing Late", "Briefing Absent",
                    "Start Present", "Start Late", "Start Absent",
                    "End Present", "End Late", "End Absent",
                    "Debrief Present", "Debrief Late", "Debrief Absent",
                    "Present Rate", "Late Rate", "Absent Rate"
                ]]
                db_data = []
                sorted_stats = sorted(stats.values(), key=lambda x: (-x["shifts"], x["name"]))
                for s in sorted_stats:
                    shifts = s["shifts"]
                    if shifts == 0: shifts = 1
                    
                    total_p = shifts * 4
                    present_pct = f"{(s['present'] / total_p) * 100:.1f}%"
                    late_pct = f"{(s['late'] / total_p) * 100:.1f}%"
                    absent_pct = f"{(s['absent'] / total_p) * 100:.1f}%"
                    
                    db_data.append([
                        s["name"], 
                        s["shifts"], 
                        s["present"], 
                        s["late"], 
                        s["absent"],
                        s["briefing_present"], s["briefing_late"], s["briefing_absent"],
                        s["flight_start_present"], s["flight_start_late"], s["flight_start_absent"],
                        s["flight_end_present"], s["flight_end_late"], s["flight_end_absent"],
                        s["debrief_present"], s["debrief_late"], s["debrief_absent"],
                        present_pct,
                        late_pct,
                        absent_pct
                    ])
                
                db_ws.clear()
                db_ws.update('A1', db_header + db_data)
                
                if db_is_new:
                    gsf.set_frozen(db_ws, rows=1)
                    gsf.set_column_width(db_ws, 'A', 200)
                    for col in ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T']:
                        gsf.set_column_width(db_ws, col, 90)
                        
                    gsf.format_cell_range(db_ws, 'A1:T1', header_fmt)
                    gsf.format_cell_range(db_ws, 'B2:T200', gsf.cellFormat(horizontalAlignment='CENTER'))
                    
                    # Highlight present rate if low (< 80%)
                    present_rule = gsf.ConditionalFormatRule(
                        ranges=[gsf.GridRange.from_a1_range('R2:R200', db_ws)],
                        booleanRule=gsf.BooleanRule(
                            condition=gsf.BooleanCondition('CUSTOM_FORMULA', ['=VALUE(LEFT(R2, LEN(R2)-1)) < 80']),
                            format=gsf.cellFormat(backgroundColor=gsf.color(0.95, 0.98, 0.95), textFormat=gsf.textFormat(foregroundColor=gsf.color(0.1, 0.5, 0.1), bold=True))
                        )
                    )
                    # Highlight late rate if high (> 10%)
                    late_rule = gsf.ConditionalFormatRule(
                        ranges=[gsf.GridRange.from_a1_range('S2:S200', db_ws)],
                        booleanRule=gsf.BooleanRule(
                            condition=gsf.BooleanCondition('CUSTOM_FORMULA', ['=VALUE(LEFT(S2, LEN(S2)-1)) > 10']),
                            format=gsf.cellFormat(backgroundColor=gsf.color(1.0, 0.95, 0.8), textFormat=gsf.textFormat(foregroundColor=gsf.color(0.6, 0.4, 0.0), bold=True))
                        )
                    )
                    # Highlight absent rate if high (> 10%)
                    absent_rule = gsf.ConditionalFormatRule(
                        ranges=[gsf.GridRange.from_a1_range('T2:T200', db_ws)],
                        booleanRule=gsf.BooleanRule(
                            condition=gsf.BooleanCondition('CUSTOM_FORMULA', ['=VALUE(LEFT(T2, LEN(T2)-1)) > 10']),
                            format=gsf.cellFormat(backgroundColor=gsf.color(0.98, 0.85, 0.85), textFormat=gsf.textFormat(foregroundColor=gsf.color(0.7, 0.1, 0.1), bold=True))
                        )
                    )
                    db_rules = gsf.get_conditional_format_rules(db_ws)
                    db_rules.clear()
                    db_rules.append(present_rule)
                    db_rules.append(late_rule)
                    db_rules.append(absent_rule)
                    db_rules.save()
                # Remove LOOKUP worksheet if it exists to clean up
                try:
                    lk_ws = sheet.worksheet("LOOKUP")
                    sheet.del_worksheet(lk_ws)
                except Exception:
                    pass
            except Exception as e:
                log_to_file(f"Google Sheets Sync Error: {e}", level="warn")

        import asyncio
        await asyncio.to_thread(_do_sync)

    @app.patch("/api/flights/{code}/attendance")
    async def update_flight_attendance(code: str, request: Request):
        """Toggle one attendance checkbox for a specific staff member."""
        session = require_auth(request)
        code  = code.upper()
        entry = user_data.get(code)
        if not entry or "flight_number" not in entry:
            raise HTTPException(status_code=404, detail="Flight not found")

        # Hard lock 2h after flight ends
        if _is_attendance_locked(entry):
            raise HTTPException(
                status_code=403,
                detail="Attendance tracking closed — 2 hours have passed since this flight ended"
            )

        user_id   = str(session.get("user_id", ""))
        host_id   = str(entry.get("host_user_id", ""))
        cohosts   = [str(c) for c in entry.get("cohosts", [])]
        is_privileged = bool(session.get("is_manager") or session.get("is_bod") or session.get("is_owner"))

        if user_id != host_id and user_id not in cohosts and not is_privileged:
            raise HTTPException(status_code=403, detail="Only the host or co-host can update attendance")

        body      = await request.json()
        member_id = str(body.get("member_id", "")).strip()
        column    = body.get("column", "")
        state     = body.get("state", "absent")

        VALID_COLUMNS = {"briefing", "flight_start", "flight_end", "debrief"}
        if not member_id or column not in VALID_COLUMNS:
            raise HTTPException(status_code=422, detail="Invalid member_id or column")

        crew       = entry.setdefault("crew", {})
        attendance = crew.setdefault("attendance", {})
        member_atd = attendance.setdefault(member_id, {})
        member_atd[column] = state

        await save_user_data(user_trigger_desc=f"Attendance {code}/{member_id}/{column}={state}")
        session_username = session.get("username", "?") if isinstance(session, dict) else "?"
        log_to_file(
            f"Attendance: {code} / {member_id} / {column} = {state}",
            user=session_username, level="ok"
        )

        # Trigger background sync to Google Sheets
        import asyncio
        asyncio.create_task(sync_attendance_to_sheet(code))

        return {"ok": True}

    @app.get("/api/logs")

    async def get_logs(request: Request, limit: int = 300):
        """Return parsed log entries from the log file, newest first."""
        require_auth(request)
        import re as _re

        def _extract_json_at(s, start):
            depth, in_str, esc = 0, False, False
            for i in range(start, len(s)):
                c = s[i]
                if esc:
                    esc = False
                    continue
                if c == '\\' and in_str:
                    esc = True
                    continue
                if c == '"':
                    in_str = not in_str
                if not in_str:
                    if c == '{':
                        depth += 1
                    elif c == '}':
                        depth -= 1
                        if depth == 0:
                            return s[start:i+1], i+1
            return None, start

        entries = []
        try:
            if not os.path.exists(LOG_FILE):
                return [{"time": "—", "user": "system", "action": "Log file not found.", "level": "warn", "traceback": None}]

            with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
                content = f.read().replace('\r\n', '\n')

            # --- Pass 1: extract Discord embed JSON objects and raw chunks between them ---
            segments = []   # list of (kind, data)
            pos = 0
            while pos < len(content):
                m = _re.search(r'\{', content[pos:])
                if not m:
                    tail = content[pos:].strip()
                    if tail:
                        segments.append(('raw', tail))
                    break
                raw_before = content[pos: pos + m.start()].strip()
                if raw_before:
                    segments.append(('raw', raw_before))
                obj_start = pos + m.start()
                obj_str, end = _extract_json_at(content, obj_start)
                if obj_str:
                    try:
                        obj = json.loads(obj_str)
                        segments.append(('json', obj))
                    except Exception:
                        segments.append(('raw', obj_str))
                    pos = end
                else:
                    pos = obj_start + 1

            # --- Pass 2: convert segments into clean log entries ---
            # Collect tracebacks so we can attach them to the preceding error entry
            pending_tb = None

            for kind, data in segments:
                if kind == 'json':
                    # Check if it's one of our structured dashboard logs (has "action" key directly)
                    if isinstance(data, dict) and 'action' in data and 'user' in data:
                        level = data.get('level', 'info')
                        entries.append({
                            "date":  data.get('date', ''),
                            "time":  data.get('time', '—'),
                            "user":  data.get('user', 'system'),
                            "action": data['action'],
                            "level": level,
                            "traceback": None,
                            "source": "dashboard"
                        })
                    # Discord embed format
                    elif isinstance(data, dict) and 'embeds' in data and data['embeds']:
                        embed = data['embeds'][0]
                        fields_raw = embed.get('fields', [])
                        fields = {f['name']: f['value'] for f in fields_raw}

                        user_raw = fields.get('Username', 'system')
                        uid_match = _re.search(r'<@(\d+)>', user_raw)
                        uid = uid_match.group(1) if uid_match else user_raw

                        action = fields.get('Action Performed', '')
                        # Strip markdown code fences
                        action = _re.sub(r'^```\w*\n?|```$', '', action.strip()).strip()

                        error_code = fields.get('Error Code', None)
                        level = 'error' if error_code or 'FAILED' in action else 'info'

                        entry = {
                            "time": "—",
                            "user": uid,
                            "action": action,
                            "level": level,
                            "error_code": error_code,
                            "traceback": None,
                            "source": "bot"
                        }
                        entries.append(entry)
                    pending_tb = None

                elif kind == 'raw':
                    text = data.strip()
                    if not text:
                        continue

                    # Split into sub-blocks by blank lines
                    blocks = [b.strip() for b in _re.split(r'\n\s*\n', text) if b.strip()]
                    for block in blocks:
                        lines = block.split('\n')

                        # Identify block type
                        is_tb = any('Traceback' in l or 'File "' in l or 'Error:' in l for l in lines)
                        is_ref = _re.match(r'❌\s*\[', lines[0]) if lines else False

                        if is_ref:
                            # Error ref code line like "❌ [ABCDEFG]"
                            ref_match = _re.search(r'\[([A-Z0-9]{5,10})\]', lines[0])
                            ref = ref_match.group(1) if ref_match else '?'
                            # If we have a pending traceback, attach it to previous error entry
                            if entries:
                                entries[-1]['error_code'] = entries[-1].get('error_code') or ref
                            continue

                        if is_tb:
                            # Extract the key error line (last non-empty line of traceback)
                            error_line = ''
                            for l in reversed(lines):
                                l = l.strip()
                                if l and not l.startswith('File ') and not l.startswith('Traceback') and not l.startswith('During'):
                                    error_line = l
                                    break
                            # Attach traceback to last entry if it was an error
                            tb_text = '\n'.join(lines)
                            if entries and entries[-1]['level'] == 'error':
                                entries[-1]['traceback'] = tb_text
                                if error_line and not entries[-1].get('tb_summary'):
                                    entries[-1]['tb_summary'] = error_line
                            else:
                                entries.append({
                                    "time": "—",
                                    "user": "system",
                                    "action": error_line or "Unhandled exception",
                                    "level": "error",
                                    "traceback": tb_text,
                                    "source": "bot"
                                })
                            continue

                        # Plain raw lines — status messages, etc.
                        joined = ' '.join(l.strip() for l in lines if l.strip())
                        if not joined:
                            continue
                        level = 'info'
                        if '❌' in joined or 'Error' in joined or 'FAILED' in joined:
                            level = 'error'
                        elif '✅' in joined:
                            level = 'ok'
                        elif '⚠' in joined:
                            level = 'warn'
                        entries.append({
                            "time": "—",
                            "user": "system",
                            "action": joined[:400],
                            "level": level,
                            "traceback": None,
                            "source": "system"
                        })

        except Exception as e:
            import traceback as _tb
            entries = [{"time": "—", "user": "system", "action": f"Log parser error: {e}", "level": "error", "traceback": _tb.format_exc()}]

        # Reverse so newest entries come first, then limit
        entries.reverse()
        return entries[:limit]

    @app.get("/api/stats")
    async def get_stats(request: Request):
        require_auth(request)
        real = get_real_flights()
        total = len(real)
        statuses = {}
        for entry in real.values():
            s = entry.get("status", "N/A")
            statuses[s] = statuses.get(s, 0) + 1
        ended = statuses.get("Ended", 0)
        active_total = total - ended

        # Flights per month
        from collections import defaultdict
        monthly = defaultdict(int)
        routes  = defaultdict(int)
        aircraft_counts = defaultdict(int)
        host_counts = defaultdict(int)
        dep_hours   = defaultdict(int)
        dep_heatmap = {}
        for entry in real.values():
            date = entry.get("dep_date", "")       # DDMMYYYY
            if len(date) == 8:
                month_key = f"{date[4:8]}-{date[2:4]}"  # YYYY-MM
                monthly[month_key] += 1
            if entry.get("dep_code") and entry.get("arr_code"):
                routes[f"{entry['dep_code']}→{entry['arr_code']}"] += 1
            if entry.get("aircraft"):
                aircraft_counts[entry["aircraft"]] += 1
            if entry.get("host_user_id"):
                host_counts[entry["host_user_id"]] += 1
            dep_time = entry.get("dep_time", "")
            if dep_time and ":" in dep_time:
                try:
                    hour = int(dep_time.split(":")[0])
                    dep_hours[hour] += 1
                except ValueError:
                    pass
            # Heatmap: day-of-week × hour
            date_str = entry.get("dep_date", "")
            if dep_time and ":" in dep_time and len(date_str) == 8:
                try:
                    from datetime import datetime as _dt
                    dep_dt = _dt.strptime(date_str, "%d%m%Y")
                    dow  = dep_dt.weekday() + 1  # Mon=1..Sun=7 → remap to Sun=0
                    dow  = dep_dt.isoweekday() % 7  # Sun=0, Mon=1, ..., Sat=6
                    hour = int(dep_time.split(":")[0])
                    dep_heatmap[f"{dow}-{hour}"] = dep_heatmap.get(f"{dow}-{hour}", 0) + 1
                except Exception:
                    pass

        top_routes   = sorted(routes.items(),         key=lambda x: x[1], reverse=True)[:10]
        top_aircraft = sorted(aircraft_counts.items(), key=lambda x: x[1], reverse=True)[:10]
        top_hosts    = sorted(host_counts.items(),     key=lambda x: x[1], reverse=True)[:10]
        monthly_sorted = sorted(monthly.items())

        # Codeshare counts
        codeshare_count = sum(1 for e in real.values() if e.get("is_codeshare"))

        # Passenger retention stats
        retention_flights = [e for e in real.values()
                             if e.get("pax_joined") is not None and e.get("pax_remained") is not None
                             and e["pax_joined"] > 0]
        total_joined   = sum(e["pax_joined"]   for e in retention_flights)
        total_remained = sum(e["pax_remained"] for e in retention_flights)
        avg_retention  = round(total_remained / total_joined * 100, 1) if total_joined else None

        # Weekly passenger trend (pax per ISO week for ended flights with pax)
        weekly_pax  = defaultdict(int)
        monthly_pax = defaultdict(int)
        for entry in real.values():
            if entry.get("pax") is None:
                continue
            date_str = entry.get("dep_date", "")
            if len(date_str) != 8:
                continue
            try:
                from datetime import datetime as _dt2
                dt = _dt2.strptime(date_str, "%d%m%Y")
                week_key  = dt.strftime("%Y-W%W")
                month_key = dt.strftime("%Y-%m")
                weekly_pax[week_key]  += entry["pax"]
                monthly_pax[month_key] += entry["pax"]
            except Exception:
                pass

        # Route map: unique airports with lat/lon (well-known ones hardcoded, rest skipped)
        AIRPORT_COORDS = {
            "YYZ":(43.6777,-79.6248),"YVR":(49.1947,-123.1792),"YUL":(45.4706,-73.7408),
            "YYC":(51.1215,-114.0076),"YEG":(53.3097,-113.5827),"YOW":(45.3225,-75.6692),
            "JFK":(40.6413,-73.7781),"LAX":(33.9425,-118.4081),"ORD":(41.9742,-87.9073),
            "ATL":(33.6407,-84.4277),"DFW":(32.8998,-97.0403),"MIA":(25.7959,-80.2870),
            "SFO":(37.6213,-122.3790),"SEA":(47.4502,-122.3088),"BOS":(42.3656,-71.0096),
            "DEN":(39.8561,-104.6737),"LAS":(36.0840,-115.1537),"PHX":(33.4373,-112.0078),
            "LHR":(51.4700,-0.4543),"CDG":(49.0097,2.5479),"AMS":(52.3086,4.7639),
            "FRA":(50.0379,8.5622),"MAD":(40.4983,-3.5676),"BCN":(41.2971,2.0785),
            "FCO":(41.7999,12.2462),"MUC":(48.3537,11.7860),"ZUR":(47.4647,8.5492),
            "DXB":(25.2532,55.3657),"DOH":(25.2731,51.6086),"AUH":(24.4330,54.6511),
            "SIN":(1.3644,103.9915),"BKK":(13.6811,100.7472),"HKG":(22.3080,113.9185),
            "NRT":(35.7720,140.3929),"ICN":(37.4602,126.4407),"PEK":(40.0799,116.6031),
            "SYD":(-33.9399,151.1753),"MEL":(-37.6690,144.8410),"AKL":(-37.0082,174.7917),
            "GRU":(-23.4356,-46.4731),"EZE":(-34.8222,-58.5358),"BOG":(4.7016,-74.1469),
            "LIM":(-12.0219,-77.1143),"SCL":(-33.3930,-70.7858),"YHZ":(44.8808,-63.5086),
        }
        airport_nodes = {}
        route_edges   = []
        for route, count in routes.items():
            if "→" in route:
                dep, arr = route.split("→", 1)
                if dep in AIRPORT_COORDS: airport_nodes[dep] = AIRPORT_COORDS[dep]
                if arr in AIRPORT_COORDS: airport_nodes[arr] = AIRPORT_COORDS[arr]
                if dep in AIRPORT_COORDS and arr in AIRPORT_COORDS:
                    route_edges.append({"dep": dep, "arr": arr, "count": count})

        return {
            "total":        active_total,
            "ended":        ended,
            "accepted":     statuses.get("On\u2013Time", 0),
            "ontime":       statuses.get("On\u2013Time", 0),
            "delayed":      statuses.get("Delayed", 0),
            "denied":       statuses.get("Cancelled", 0),
            "pending":      statuses.get("N/A", 0) + statuses.get("Rescheduled", 0) + statuses.get("Delayed", 0),
            "statuses":     statuses,
            "monthly":      monthly_sorted,
            "top_routes":   top_routes,
            "top_aircraft": top_aircraft,
            "top_hosts":    top_hosts,
            "dep_hours":    sorted(dep_hours.items()),
            "dep_heatmap":  dep_heatmap,
            "weekly_pax":   sorted(weekly_pax.items()),
            "monthly_pax":  sorted(monthly_pax.items()),
            "airport_nodes": airport_nodes,
            "route_edges":   route_edges,
            "codeshare_count": codeshare_count,
            "avg_retention": avg_retention,
            "total_joined":  total_joined,
            "total_remained": total_remained,
        }

    @app.post("/api/announce")
    async def post_announcement(request: Request):
        """Send a free-form message to the announcement channel."""
        session = require_auth(request)
        body = await request.json()
        message = (body.get("message") or "").strip()
        if not message:
            raise HTTPException(status_code=422, detail="Missing 'message' field")
        sent = False
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if g:
            ch = g.get_channel(ANNOUNCE_CHANNEL_ID)
            if ch:
                await ch.send(message)
                sent = True
                session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
                log_to_file(f"Sent announcement: {message[:80]}", user=session_username, level="ok")
        if not sent:
            raise HTTPException(status_code=503, detail="Announcement channel not found — is the bot running?")
        return {"sent": True}

    @app.post("/api/announce-embed")
    async def post_announcement_embed(request: Request):
        """Send a rich embed to the announcement channel."""
        session = require_auth(request)
        body = await request.json()
        embed_data = body.get("embed", {})
        if not embed_data:
            raise HTTPException(status_code=422, detail="Missing embed data")
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if not g:
            raise HTTPException(status_code=503, detail="Bot not in guild")
        ch = g.get_channel(ANNOUNCE_CHANNEL_ID)
        if not ch:
            raise HTTPException(status_code=503, detail="Announcement channel not found")
        e = discord.Embed(
            title       = embed_data.get("title") or discord.utils.MISSING,
            description = embed_data.get("description") or discord.utils.MISSING,
            color       = embed_data.get("color", 0xe8001c),
        )
        if embed_data.get("author"):
            e.set_author(
                name     = embed_data["author"].get("name",""),
                icon_url = embed_data["author"].get("icon_url") or discord.utils.MISSING,
            )
        if embed_data.get("footer"):
            e.set_footer(text=embed_data["footer"].get("text",""))
        if embed_data.get("image"):
            e.set_image(url=embed_data["image"].get("url",""))
        try:
            await ch.send(embed=e)
        except discord.Forbidden:
            raise HTTPException(status_code=403, detail="Bot lacks permission to send in announcement channel")
        session_username = session.get("username","owner") if isinstance(session,dict) else "owner"
        log_to_file(f"Embed announcement sent: {embed_data.get('title','(no title)')}", user=session_username, level="ok")
        return {"sent": True}

    # ── Events ────────────────────────────────────────────────────────────────────

    EVENT_TYPES = {"gamenight", "meeting", "community", "other"}

    def serialize_event(eid: str, ev: dict) -> dict:
        return {
            "id":          eid,
            "title":       ev.get("title", ""),
            "type":        ev.get("type", "other"),
            "date":        ev.get("date", ""),       # YYYY-MM-DD
            "time":        ev.get("time", ""),       # HH:MM UTC
            "description": ev.get("description", ""),
            "discord_msg_id": ev.get("discord_msg_id", None),
            "created_at":  ev.get("created_at", ""),
        }

    def get_all_events() -> dict:
        return user_data.get("__events__", {})

    @app.get("/api/events")
    async def list_events(request: Request):
        require_auth(request)
        evs = get_all_events()
        return sorted(
            [serialize_event(k, v) for k, v in evs.items()],
            key=lambda e: (e["date"], e["time"])
        )

    @app.post("/api/events")
    async def create_event(request: Request):
        session = require_auth(request)
        body = await request.json()
        title = (body.get("title") or "").strip()
        date  = (body.get("date") or "").strip()
        time_ = (body.get("time") or "00:00").strip()
        etype = (body.get("type") or "other").strip().lower()
        desc  = (body.get("description") or "").strip()
        if not title or not date:
            raise HTTPException(status_code=422, detail="title and date are required")
        if etype not in EVENT_TYPES:
            etype = "other"

        eid = "EVT" + generate_code(6)
        while eid in get_all_events():
            eid = "EVT" + generate_code(6)

        ev = {
            "title": title,
            "type": etype,
            "date": date,
            "time": time_,
            "description": desc,
            "created_at": datetime.now(timezone.utc).isoformat() + "Z",
        }

        # Parse extra fields
        cohosts  = body.get("cohosts") or []    # list of discord user IDs
        duration = (body.get("duration") or "").strip()

        # Format date as "5th May 2026"
        def _ordinal(n):
            n = int(n)
            if 11 <= n <= 13: return f"{n}th"
            return f"{n}{['th','st','nd','rd','th','th','th','th','th','th'][n % 10]}"
        try:
            from datetime import datetime as _dt
            _d = _dt.strptime(date, "%Y-%m-%d")
            pretty_date = f"{_ordinal(_d.day)} {_d.strftime('%B %Y')}"
        except Exception:
            pretty_date = date

        type_labels_plain = {"gamenight": "Gamenight", "meeting": "Meeting",
                             "community": "Community Event", "other": "Event"}
        type_label = type_labels_plain.get(etype, "Event")

        # Creator mention from session
        creator_id = session.get("user_id") if isinstance(session, dict) else None
        creator_mention = f"<@{creator_id}>" if creator_id else "Unknown"

        # Cohost mentions
        cohost_str = " ".join(f"<@{uid}>" for uid in cohosts) if cohosts else "None"

        ev = {
            "title":      title,
            "type":       etype,
            "date":       date,
            "time":       time_,
            "description": desc,
            "duration":   duration,
            "cohosts":    cohosts,
            "creator_id": creator_id,
            "created_at": datetime.now(timezone.utc).isoformat() + "Z",
        }

        # Post to events channel
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if g:
            ch = g.get_channel(EVENTS_CHANNEL_ID) if EVENTS_CHANNEL_ID else None
            if ch:
                ping = ("<@&" + str(EVENTS_INTEREST_ROLE) + "\n") if EVENTS_INTEREST_ROLE else ""
                time_str = f"{time_} UTC" if time_ else "TBD"
                dur_str  = duration if duration else "TBD"
                msg_content = (
                    f"{ping}"
                    f"# Event: {title}\n"
                    f"<:AIC_Calendar:1419416309174636666> Date: {pretty_date}\n"
                    f"<:AIC_Options:1474821341231321311> Event Type: {type_label}\n"
                    f"<:AIC_2:1419416360353796247> Host: {creator_mention}\n"
                    f"<:AIC_Medal:1417214664202518528> Co-Host(s): {cohost_str}\n"
                    f"<:AIC_Clock:1419417053109944444> Time: {time_str}\n"
                    f"<:AIC_Clock:1419417053109944444> Duration: {dur_str}\n"
                    f"\n"
                    f"<:AIC_Information:1440775211082453002> Event Description:\n"
                    f"{desc or 'No description provided.'}"
                )
                try:
                    msg = await ch.send(
                        content=msg_content,
                        allowed_mentions=discord.AllowedMentions(roles=True, users=True),
                    )
                    ev["discord_msg_id"] = str(msg.id)
                except Exception as e:
                    safe_console_print(f"Event post error: {e}")

        if "__events__" not in user_data:
            user_data["__events__"] = {}
        user_data["__events__"][eid] = ev
        await save_user_data()
        session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        log_to_file(f"Created event {eid}: {title} on {date}", user=session_username, level="ok")
        return serialize_event(eid, ev)

    @app.delete("/api/events/{eid}")
    async def delete_event(eid: str, request: Request):
        session = require_auth(request)
        evs = get_all_events()
        if eid not in evs:
            raise HTTPException(status_code=404, detail="Event not found")
        del user_data["__events__"][eid]
        await save_user_data()
        session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        log_to_file(f"Deleted event {eid}", user=session_username, level="warn")
        return {"deleted": eid}

    # ── Host Profiles ──────────────────────────────────────────────────────────

    _hosts_cache      = {"members": [], "ts": 0}

    @app.get("/api/hosts/debug")
    async def debug_hosts(request: Request):
        """Detailed diagnostic for why /api/hosts may be failing."""
        require_manager(request)
        import time as _time
        report = {}

        # 1. Bot connectivity
        report["bot_guilds"] = [{"id": str(g.id), "name": g.name} for g in bot.guilds]
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        report["target_guild_found"] = g is not None
        report["target_guild_id"] = str(GUILD_ID)

        if not g:
            report["error"] = "Bot is not in the target guild"
            return report

        # 2. Role check
        hoster_role_obj = g.get_role(HOSTER_ROLE)
        report["hoster_role_id"]    = str(HOSTER_ROLE)
        report["hoster_role_found"] = hoster_role_obj is not None
        report["hoster_role_name"]  = hoster_role_obj.name if hoster_role_obj else None
        report["hoster_role_member_count"] = len(hoster_role_obj.members) if hoster_role_obj else 0

        # 3. Bot permissions
        me = g.me
        report["bot_user"] = str(me)
        perms = g.me.guild_permissions
        report["permissions"] = {
            "administrator":    perms.administrator,
            "manage_guild":     perms.manage_guild,
        }

        # 4. Cache status
        cache_age = _time.time() - _hosts_cache["ts"]
        report["cache_members"]   = len(_hosts_cache["members"])
        report["cache_age_secs"]  = round(cache_age, 1)
        report["cache_fresh"]     = cache_age < _HOSTS_CACHE_TTL

        # 5. Try a live Discord API call to /guilds/{id}/members with limit=1
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(
                    f"https://discord.com/api/v10/guilds/{GUILD_ID}/members",
                    headers={"Authorization": f"Bot {TOKEN}"},
                    params={"limit": 1},
                )
                report["discord_api_status"] = resp.status_code
                report["discord_api_headers"] = {
                    "x-ratelimit-remaining": resp.headers.get("x-ratelimit-remaining"),
                    "x-ratelimit-reset-after": resp.headers.get("x-ratelimit-reset-after"),
                    "retry-after": resp.headers.get("retry-after"),
                }
                if resp.status_code == 200:
                    batch = resp.json()
                    report["discord_api_ok"] = True
                    report["sample_member_count"] = len(batch)
                elif resp.status_code == 429:
                    report["discord_api_ok"] = False
                    report["error"] = "Discord rate limit hit"
                    try:
                        report["rate_limit_detail"] = resp.json()
                    except Exception:
                        pass
                else:
                    report["discord_api_ok"] = False
                    report["error"] = f"Discord returned HTTP {resp.status_code}"
                    try:
                        report["discord_error_body"] = resp.json()
                    except Exception:
                        report["discord_error_body"] = resp.text[:200]
            except Exception as e:
                report["discord_api_ok"] = False
                report["error"] = f"Request failed: {e}"

        return report
    _HOSTS_CACHE_TTL  = 120   # seconds

    @app.get("/api/hosts")
    async def get_hosts(request: Request):
        """
        Return all guild members who hold the HOSTER_ROLE.
        Cached for 120 s to avoid Discord 429 rate limits.
        """
        from auth import require_manager
        import time as _time
        require_manager(request)

        # Serve from cache if fresh
        if _time.time() - _hosts_cache["ts"] < _HOSTS_CACHE_TTL and _hosts_cache["members"]:
            real = get_real_flights()
            flight_counts: dict = {}
            for entry in real.values():
                hid = str(entry.get("host_user_id", ""))
                if hid:
                    flight_counts[hid] = flight_counts.get(hid, 0) + 1
            cached = [dict(m, flight_count=flight_counts.get(m["user_id"], 0)) for m in _hosts_cache["members"]]
            cached.sort(key=lambda x: x["flight_count"], reverse=True)
            return cached

        if not GUILD_ID:
            raise HTTPException(status_code=503, detail="GUILD_ID not configured")

        members = []
        after = 0          # snowflake pagination
        bot_token = TOKEN  # already loaded from env

        async with httpx.AsyncClient() as client:
            while True:
                params = {"limit": 1000}
                if after:
                    params["after"] = after
                resp = await client.get(
                    f"https://discord.com/api/v10/guilds/{GUILD_ID}/members",
                    headers={"Authorization": f"Bot {bot_token}"},
                    params=params,
                )
                if resp.status_code != 200:
                    raise HTTPException(status_code=502, detail=f"Discord API error: {resp.status_code}")
                batch = resp.json()
                if not batch:
                    break
                for m in batch:
                    role_ids = [str(r) for r in m.get("roles", [])]
                    if (str(HOSTER_ROLE) in role_ids or str(MANAGER_ROLE) in role_ids
                            or str(FOM_ROLE) in role_ids or str(FOI_TRAINEE_ROLE) in role_ids):
                        u = m.get("user", {})
                        uid = u.get("id", "")
                        avatar_hash = u.get("avatar") or m.get("avatar")
                        if avatar_hash:
                            avatar_url = f"https://cdn.discordapp.com/avatars/{uid}/{avatar_hash}.png"
                        else:
                            disc = int(u.get("discriminator", 0) or 0)
                            avatar_url = f"https://cdn.discordapp.com/embed/avatars/{disc % 5}.png"
                        members.append({
                            "user_id":    uid,
                            "username":   m.get("nick") or u.get("global_name") or u.get("username", "Unknown"),
                            "avatar":     avatar_url,
                            "joined_at":  m.get("joined_at", ""),
                            "roles": role_ids,
                            "is_manager": str(MANAGER_ROLE) in role_ids,
                            "is_fom": str(FOM_ROLE) in role_ids,
                            "is_foi_trainee": str(FOI_TRAINEE_ROLE) in role_ids,
                        })
                if len(batch) < 1000:
                    break
                after = batch[-1]["user"]["id"]

        # Annotate each member with their flight count from user_data
        real = get_real_flights()
        flight_counts = {}
        for entry in real.values():
            hid = str(entry.get("host_user_id", ""))
            if hid:
                flight_counts[hid] = flight_counts.get(hid, 0) + 1

        for m in members:
            m["flight_count"] = flight_counts.get(m["user_id"], 0)

        # Cache the raw member list (without flight counts so counts stay fresh)
        _hosts_cache["members"] = [{k: v for k, v in m.items() if k != "flight_count"} for m in members]
        _hosts_cache["ts"] = _time.time()
        members.sort(key=lambda x: x["flight_count"], reverse=True)
        return members

    # ── Flight operations quotas ─────────────────────────────────────────────
    def _quota_week_start(value=None):
        day = value or datetime.now(timezone.utc).date()
        return day - timedelta(days=day.weekday())

    def _quota_has_attendance(entry):
        attendance = entry.get("crew", {}).get("attendance", {})
        for member in attendance.values():
            if not isinstance(member, dict):
                continue
            for value in member.values():
                if value is True or str(value).lower() in ("present", "late"):
                    return True
        return False

    def _quota_week_flights(uid, start, end):
        eligible, excluded = [], []
        for code, entry in get_real_flights().items():
            if str(entry.get("host_user_id", "")) != str(uid):
                continue
            raw = entry.get("dep_date", "")
            try:
                dep = datetime.strptime(raw, "%d%m%Y").date()
            except Exception:
                continue
            if not (start <= dep < end):
                continue
            effective_status = entry.get("final_status") if entry.get("status") == "Ended" else entry.get("status")
            reasons = []
            if effective_status in ("Cancelled", "Rescheduled"):
                reasons.append(effective_status.lower())
            if entry.get("status") != "Ended":
                reasons.append("not completed")
            if not _quota_has_attendance(entry):
                reasons.append("attendance not logged")
            if entry.get("pax_joined") is None and entry.get("pax") is None:
                reasons.append("passengers not logged")
            item = {"code": code, "flight_number": entry.get("flight_number", code), "reasons": reasons}
            (excluded if reasons else eligible).append(item)
        return {"flights": len(eligible), "eligible": eligible, "excluded": excluded}

    def _quota_loa_for_week(state, start, end):
        periods = state.get("loa_periods", []) if isinstance(state, dict) else []
        if not isinstance(periods, list):
            return False
        for period in periods:
            if not isinstance(period, dict):
                continue
            try:
                loa_start = datetime.fromisoformat(str(period.get("start", ""))[:10]).date()
                loa_end = datetime.fromisoformat(str(period.get("end", ""))[:10]).date() if period.get("end") else None
            except Exception:
                continue
            if loa_start < end and (loa_end is None or loa_end >= start):
                return True
        return False

    def _quota_apply_monthly_reimbursement(state, today):
        current_month = today.strftime("%Y-%m")
        previous = state.get("last_reimbursement_month")
        if not previous:
            state["last_reimbursement_month"] = current_month
            return 0
        try:
            prev_year, prev_month = map(int, previous.split("-"))
            elapsed = (today.year - prev_year) * 12 + today.month - prev_month
        except Exception:
            elapsed = 0
        restored = min(max(0, elapsed), max(0, 10 - int(state.get("points", 10))))
        if restored:
            state["points"] = min(10, int(state.get("points", 10)) + restored)
        if elapsed > 0:
            state["last_reimbursement_month"] = current_month
        return restored

    def _process_quota_state(uid, target, current_week):
        states = user_data.setdefault("__quota_state__", {})
        state = states.get(str(uid))
        if not isinstance(state, dict):
            state = {}
            states[str(uid)] = state
        try:
            state["points"] = max(0, min(10, int(state.get("points", 10))))
        except Exception:
            state["points"] = 10
        if not isinstance(state.get("history"), list):
            state["history"] = []
        if not isinstance(state.get("loa_periods"), list):
            state["loa_periods"] = []
        try:
            datetime.fromisoformat(str(state.get("last_processed_week", ""))).date()
        except Exception:
            state["last_processed_week"] = current_week.isoformat()
        try:
            next_week = datetime.fromisoformat(state.get("last_processed_week", current_week.isoformat())).date() + timedelta(days=7)
        except Exception:
            next_week = current_week
        while next_week <= current_week:
            reviewed_week = next_week - timedelta(days=7)
            result = _quota_week_flights(uid, reviewed_week, next_week)
            exempt = _quota_loa_for_week(state, reviewed_week, next_week)
            met = result["flights"] >= target
            if not met and not exempt:
                state["points"] = max(0, int(state.get("points", 10)) - 1)
            state.setdefault("history", []).append({
                "week": reviewed_week.isoformat(), "flights": result["flights"],
                "target": target, "met": met, "exempt": exempt,
                "excluded": result["excluded"], "processed_at": datetime.now(timezone.utc).isoformat() + "Z",
            })
            state["history"] = state["history"][-26:]
            state["last_processed_week"] = next_week.isoformat()
            next_week += timedelta(days=7)
        return state

    def _quota_row(uid, username, target, role_label, week_start, manual=None):
        history = (user_data.get("__foi_training__", {}) if manual is None else manual)
        quota_managed = role_label != "FOI Trainee"
        weeks = []
        for offset in range(8):
            ws = week_start - timedelta(days=offset * 7)
            result = _quota_week_flights(uid, ws, ws + timedelta(days=7)) if quota_managed else {"flights": 0, "eligible": [], "excluded": []}
            weeks.append({"week": ws.isoformat(), **result})
        state = _process_quota_state(uid, target, week_start) if quota_managed else {"points": 10, "history": []}
        monthly_restored = _quota_apply_monthly_reimbursement(state, datetime.now(timezone.utc).date()) if quota_managed else 0
        points = int(state.get("points", 10))
        strikes = 2 if points <= 4 else 1 if points <= 7 else 0
        latest = state.get("history", [])[-1] if state.get("history") else None
        loa_active = _quota_loa_for_week(state, week_start, week_start + timedelta(days=7))
        return {"user_id": str(uid), "username": username, "role": role_label, "target": target,
                "points": points, "strikes": strikes, "terminated": points <= 1, "weeks": weeks,
                "latest_review": latest, "warning": bool(latest and not latest.get("met") and not latest.get("exempt")),
                "loa_active": loa_active, "loa_periods": state.get("loa_periods", []),
                "monthly_restored": monthly_restored, "last_reimbursement_month": state.get("last_reimbursement_month"),
                "foi_training": history.get(str(uid), {}) if isinstance(history, dict) else {}}

    @app.get("/api/quotas")
    async def get_quotas(request: Request):
        require_manager(request)
        hosts = await get_hosts(request)
        week_start = _quota_week_start()
        targets = get_quota_targets()
        rows = []
        row_errors = []
        foi_changed = False
        for member in hosts:
            try:
                if member.get("is_foi_trainee"):
                    training = user_data.setdefault("__foi_training__", {}).setdefault(str(member["user_id"]), {})
                    if not isinstance(training, dict):
                        training = {}
                        user_data["__foi_training__"][str(member["user_id"])] = training
                    if not training.get("started_at"):
                        training["started_at"] = datetime.now(timezone.utc).isoformat() + "Z"
                        foi_changed = True
                    rows.append(_quota_row(member["user_id"], member.get("username") or member["user_id"], 0, "FOI Trainee", week_start))
                elif member.get("is_manager"):
                    rows.append(_quota_row(member["user_id"], member.get("username") or member["user_id"], targets["som_target"], "SOM / Manager", week_start))
                elif member.get("is_fom"):
                    rows.append(_quota_row(member["user_id"], member.get("username") or member["user_id"], targets["fom_target"], "FOM / Regular", week_start))
            except Exception as exc:
                row_errors.append({"user_id": str(member.get("user_id", "")), "error": str(exc)})
                log_to_file(f"Quota row failed for {member.get('user_id', '?')}: {exc}", level="warn")
        await save_user_data(user_trigger_desc="Weekly quota review" if any(r.get("latest_review") for r in rows) else "FOI training initialized")
        rows.sort(key=lambda row: (not row.get("warning", False), str(row.get("role", "")), str(row.get("username", "")).lower()))
        return {"week_start": week_start.isoformat(), "reviewed_at": f"{week_start.isoformat()}T00:00:00Z", "targets": targets, "rows": rows, "row_errors": row_errors}

    @app.get("/api/quota-config")
    async def get_quota_config(request: Request):
        from auth import require_owner
        require_owner(request)
        return get_quota_targets()

    @app.patch("/api/quota-config")
    async def update_quota_config(request: Request):
        from auth import require_owner
        session = require_owner(request)
        body = await request.json()
        current = get_quota_targets()
        updated = {}
        for key in ("som_target", "fom_target"):
            raw = body.get(key, current[key])
            try:
                value = int(raw)
            except Exception:
                raise HTTPException(status_code=422, detail=f"{key} must be a whole number")
            if value < 0 or value > 50:
                raise HTTPException(status_code=422, detail=f"{key} must be between 0 and 50")
            updated[key] = value
        user_data["__quota_config__"] = updated
        await save_user_data(user_trigger_desc="Quota targets updated")
        owner_name = session.get("username", "owner") if isinstance(session, dict) else "owner"
        log_to_file(f"Quota targets updated: SOM {updated['som_target']} F/W, FOM {updated['fom_target']} F/W", user=owner_name, level="warn")
        return updated

    @app.patch("/api/quotas/{user_id}/foi")
    async def update_foi_training(user_id: str, request: Request):
        session = require_manager(request)
        body = await request.json()
        current = user_data.setdefault("__foi_training__", {}).setdefault(str(user_id), {})
        for key in ("regional", "short_haul", "long_haul"):
            if key in body:
                current[key] = bool(body[key])
        current["updated_at"] = datetime.now(timezone.utc).isoformat() + "Z"
        current["updated_by"] = session.get("username", "manager")
        await save_user_data(user_trigger_desc=f"FOI training updated for {user_id}")
        return current

    @app.patch("/api/quotas/{user_id}/admin")
    async def admin_update_quota(user_id: str, request: Request):
        from auth import require_owner
        session = require_owner(request)
        body = await request.json()
        action = str(body.get("action", "")).strip()
        states = user_data.setdefault("__quota_state__", {})
        state = states.get(str(user_id))
        if not isinstance(state, dict):
            state = {}
            states[str(user_id)] = state
        state.setdefault("points", 10)
        state.setdefault("last_processed_week", _quota_week_start().isoformat())
        if not isinstance(state.get("history"), list): state["history"] = []
        if not isinstance(state.get("loa_periods"), list): state["loa_periods"] = []
        now_date = datetime.now(timezone.utc).date()
        if action == "adjust_points":
            try:
                delta = int(body.get("delta", 0))
            except Exception:
                raise HTTPException(status_code=422, detail="Invalid point adjustment")
            if delta == 0 or abs(delta) > 10:
                raise HTTPException(status_code=422, detail="Point adjustment must be between -10 and 10")
            before = int(state.get("points", 10))
            state["points"] = max(0, min(10, before + delta))
            state.setdefault("manual_changes", []).append({"at": datetime.now(timezone.utc).isoformat() + "Z", "by": session.get("username", "owner"), "delta": delta, "before": before, "after": state["points"], "reason": str(body.get("reason", "")).strip()[:300]})
            message = f"Quota points changed {before} → {state['points']} for {user_id}"
        elif action == "start_loa":
            start_raw = str(body.get("start", now_date.isoformat())).strip() or now_date.isoformat()
            end_raw = str(body.get("end", "")).strip()
            try:
                start_date = datetime.fromisoformat(start_raw[:10]).date()
                end_date = datetime.fromisoformat(end_raw[:10]).date() if end_raw else None
            except Exception:
                raise HTTPException(status_code=422, detail="Invalid LOA date")
            if end_date and end_date < start_date:
                raise HTTPException(status_code=422, detail="LOA end cannot be before its start")
            periods = state.setdefault("loa_periods", [])
            for period in periods:
                if not period.get("end"):
                    period["end"] = start_date.isoformat()
            periods.append({"start": start_date.isoformat(), "end": end_date.isoformat() if end_date else None, "reason": str(body.get("reason", "")).strip()[:300], "created_by": session.get("username", "owner")})
            message = f"LOA started for {user_id} on {start_date.isoformat()}"
        elif action == "end_loa":
            active = next((period for period in reversed(state.setdefault("loa_periods", [])) if not period.get("end")), None)
            if not active:
                raise HTTPException(status_code=409, detail="This host does not have an active LOA")
            active["end"] = now_date.isoformat()
            active["ended_by"] = session.get("username", "owner")
            message = f"LOA ended for {user_id}"
        elif action == "remove_latest_loa":
            periods = state.setdefault("loa_periods", [])
            if not periods:
                raise HTTPException(status_code=404, detail="No LOA record to remove")
            periods.pop()
            message = f"Latest LOA record removed for {user_id}"
        else:
            raise HTTPException(status_code=422, detail="Unknown quota admin action")
        await save_user_data(user_trigger_desc=message)
        log_to_file(message, user=session.get("username", "owner"), level="warn")
        return {"ok": True, "state": state}

    @app.get("/api/hosts/{user_id}")
    async def get_host_profile(user_id: str, request: Request):
        """
        Full profile for one host: their flights, performance stats,
        and recent dashboard log entries.
        Managers/BOD/Owner can view anyone. Hosters can only view their own profile.
        """
        from auth import get_session
        session = get_session(request)
        if not session:
            raise HTTPException(status_code=401, detail="Not authenticated")
        session_user_id = session.get("user_id", "")
        is_manager = session.get("is_manager") or session.get("is_bod") or session.get("is_owner")
        if not is_manager and session_user_id != user_id:
            raise HTTPException(status_code=403, detail="Manager role required")

        real = get_real_flights()
        # All flights hosted by this user (including ended)
        all_flights_raw = {**real}
        # Also include ended (status == Ended) — real_flights already has them
        host_flights = [
            serialize_entry(code, entry)
            for code, entry in all_flights_raw.items()
            if str(entry.get("host_user_id", "")) == user_id
               or user_id in [str(c) for c in entry.get("cohosts", [])]
        ]
        # Tag each flight so we know if it was hosted or co-hosted
        for f in host_flights:
            f["_role"] = "host" if str(f.get("host_user_id","")) == user_id else "cohost"
        host_flights.sort(key=lambda f: f.get("dep_date") or "", reverse=True)

        # Performance stats
        total       = len(host_flights)
        ended       = [f for f in host_flights if f.get("status") == "Ended"]
        active      = [f for f in host_flights if f.get("status") != "Ended"]

        # For rate calculations: use final_status for ended flights, current status for active
        def effective_status(f):
            if f.get("status") == "Ended":
                return f.get("final_status")  # may be None if not captured
            return f.get("status")

        on_time   = [f for f in host_flights if effective_status(f) == "On\u2013Time"]
        cancelled = [f for f in host_flights if effective_status(f) == "Cancelled"]
        delayed   = [f for f in host_flights if effective_status(f) == "Delayed"]
        rescheduled = [f for f in host_flights if effective_status(f) == "Rescheduled"]

        # Rated = any flight we have a meaningful status for (active or ended-with-final_status)
        rated       = [f for f in host_flights if effective_status(f) in ("On\u2013Time", "Cancelled", "Delayed", "Rescheduled")]
        rated_total = len(rated)
        on_time_rate = round(len(on_time)   / rated_total * 100) if rated_total else None
        cancel_rate  = round(len(cancelled) / rated_total * 100) if rated_total else None
        delay_rate   = round(len(delayed)   / rated_total * 100) if rated_total else None

        # Passengers
        pax_flights = [f for f in host_flights if f.get("pax") is not None]
        total_pax   = sum(f["pax"] for f in pax_flights)
        avg_pax     = round(total_pax / len(pax_flights), 1) if pax_flights else None
        max_pax_flight = max(pax_flights, key=lambda f: f["pax"]) if pax_flights else None

        # Aircraft breakdown
        aircraft_counts = {}
        for f in host_flights:
            ac = f.get("aircraft")
            if ac:
                aircraft_counts[ac] = aircraft_counts.get(ac, 0) + 1
        fav_aircraft = max(aircraft_counts, key=aircraft_counts.get) if aircraft_counts else None

        # Route breakdown
        route_counts = {}
        for f in host_flights:
            if f.get("dep_code") and f.get("arr_code"):
                r = f"{f['dep_code']}\u2192{f['arr_code']}"
                route_counts[r] = route_counts.get(r, 0) + 1
        top_routes = sorted(route_counts.items(), key=lambda x: x[1], reverse=True)[:5]

        # Streaks — consecutive on-time flights (chronological)
        sorted_rated = sorted(rated, key=lambda f: f.get("dep_date") or "")
        current_streak = 0
        best_streak = 0
        tmp = 0
        for f in sorted_rated:
            if effective_status(f) == "On\u2013Time":
                tmp += 1
                best_streak = max(best_streak, tmp)
            else:
                tmp = 0
        # current streak = trailing on-times
        for f in reversed(sorted_rated):
            if effective_status(f) == "On\u2013Time":
                current_streak += 1
            else:
                break

        # Busiest month
        month_counts = {}
        for f in host_flights:
            date = f.get("dep_date", "")
            if date and len(date) == 10:  # YYYY-MM-DD from serialize
                month = date[:7]
                month_counts[month] = month_counts.get(month, 0) + 1
        busiest_month = max(month_counts, key=month_counts.get) if month_counts else None

        # First and most recent flight
        sorted_all = sorted(host_flights, key=lambda f: f.get("dep_date") or "")
        first_flight  = sorted_all[0]  if sorted_all else None
        latest_flight = sorted_all[-1] if sorted_all else None

        # Recent log entries for this user (match by user_id in log)
        log_entries = []
        try:
            if os.path.exists(LOG_FILE):
                with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                import re as _re
                # Find structured dashboard log entries matching this user_id
                for line in content.splitlines():
                    line = line.strip()
                    if not line.startswith("{"):
                        continue
                    try:
                        obj = json.loads(line)
                        if "action" in obj and "user" in obj:
                            log_entries.append(obj)
                    except Exception:
                        pass
                # Filter to entries where user matches username or user_id
                # We store username in logs; cross-reference via flights
                # Include all entries — frontend will filter by known username
        except Exception:
            pass

        return {
            "user_id":      user_id,
            "flights":      host_flights,
            "stats": {
                "total":           total,
                "active":          len(active),
                "ended":           len(ended),
                "rated_total":     rated_total,
                "on_time":         len(on_time),
                "cancelled":       len(cancelled),
                "delayed":         len(delayed),
                "rescheduled":     len(rescheduled),
                "on_time_rate":    on_time_rate,
                "cancel_rate":     cancel_rate,
                "delay_rate":      delay_rate,
                "total_pax":       total_pax,
                "avg_pax":         avg_pax,
                "max_pax":         max_pax_flight["pax"] if max_pax_flight else None,
                "max_pax_flight":  max_pax_flight["flight_number"] if max_pax_flight else None,
                "fav_aircraft":    fav_aircraft,
                "aircraft_counts": aircraft_counts,
                "top_routes":      top_routes,
                "best_streak":     best_streak,
                "current_streak":  current_streak,
                "busiest_month":   busiest_month,
                "busiest_month_count": month_counts.get(busiest_month, 0) if busiest_month else 0,
                "first_flight_date":  first_flight["dep_date"]  if first_flight  else None,
                "latest_flight_date": latest_flight["dep_date"] if latest_flight else None,
                "first_flight_number":  first_flight["flight_number"]  if first_flight  else None,
                "latest_flight_number": latest_flight["flight_number"] if latest_flight else None,
            },
            "logs": log_entries[-200:],
        }

    # ── Diagnostics ────────────────────────────────────────────────────────────

    @app.get("/api/debug")
    async def get_debug(request: Request):
        """Live diagnostic info — bot state, guilds, channels, roles. Owner-only."""
        from auth import require_owner, get_session as _gs
        require_owner(request)

        env_info = {
            "GUILD_ID":            str(GUILD_ID),
            "HOSTER_ROLE":         str(HOSTER_ROLE),
            "MANAGER_ROLE":        str(MANAGER_ROLE),
            "BOD_ROLE":           str(BOD_ROLE),
            "INTEREST_ROLE":       str(INTEREST_ROLE),
            "FLIGHT_NOTIFY_ROLE":  str(FLIGHT_NOTIFY_ROLE),
            "FLIGHT_START_ROLE":   str(FLIGHT_START_ROLE),
            "LOG_CHANNEL_ID":      str(LOG_CHANNEL_ID),
            "PUBLIC_CHANNEL_ID":   str(PUBLIC_CHANNEL_ID),
            "ANNOUNCE_CHANNEL_ID": str(ANNOUNCE_CHANNEL_ID),
            "EVENTS_CHANNEL_ID":   str(EVENTS_CHANNEL_ID),
            "EVENTS_INTEREST_ROLE": str(EVENTS_INTEREST_ROLE),
            "DASHBOARD_PORT":      str(DASHBOARD_PORT),
            "SQLITE_DB_PATH":      SQLITE_DB_PATH,
            "LOG_FILE":            LOG_FILE,
            "TOKEN_set":           bool(TOKEN),
            "SECRET_KEY_set":      bool(os.environ.get("SECRET_KEY")),
            "SECRET_KEY_default":  os.environ.get("SECRET_KEY", "") in (
                "", "change-me-please-use-a-long-random-string", "replace-me-with-a-long-random-string"
            ),
        }

        bot_info = {
            "logged_in":   bot.user is not None,
            "bot_name":    str(bot.user) if bot.user else None,
            "bot_id":      str(bot.user.id) if bot.user else None,
            "guild_count": len(bot.guilds),
        }

        guilds_info = []
        for g in bot.guilds:
            def ch_info(cid, _g=g):
                c = _g.get_channel(cid)
                return {"id": str(cid), "name": c.name if c else None, "found": c is not None}
            roles_sample = [{"id": str(r.id), "name": r.name}
                            for r in sorted(g.roles, key=lambda r: r.position, reverse=True)[:25]]
            guilds_info.append({
                "id":              str(g.id),
                "name":            g.name,
                "member_count":    g.member_count,
                "is_target_guild": g.id == GUILD_ID,
                "channels": {
                    "log":      ch_info(LOG_CHANNEL_ID),
                    "public":   ch_info(PUBLIC_CHANNEL_ID),
                    "announce": ch_info(ANNOUNCE_CHANNEL_ID),
                },
                "roles_sample": roles_sample,
            })

        role_check = {}
        target_guild = discord.utils.get(bot.guilds, id=GUILD_ID)
        if target_guild:
            for label, rid in [
                ("HOSTER_ROLE",  HOSTER_ROLE),
                ("MANAGER_ROLE", MANAGER_ROLE),
                ("INTEREST_ROLE", INTEREST_ROLE),
                ("FLIGHT_NOTIFY_ROLE", FLIGHT_NOTIFY_ROLE),
                ("FLIGHT_START_ROLE", FLIGHT_START_ROLE),
            ]:
                r = discord.utils.get(target_guild.roles, id=rid)
                role_check[label] = {"id": str(rid), "name": r.name if r else None, "found": r is not None}

        sess = _gs(request) or {}
        session_info = {
            "user_id":    sess.get("user_id"),
            "username":   sess.get("username"),
            "is_hoster":  sess.get("is_hoster"),
            "is_manager": sess.get("is_manager"),
            "is_owner":   sess.get("is_owner"),
        }

        real = get_real_flights()
        # Flight status breakdown
        flight_statuses = {}
        for entry in real.values():
            s = entry.get("status", "N/A")
            flight_statuses[s] = flight_statuses.get(s, 0) + 1

        _db_exists = os.path.exists(SQLITE_DB_PATH)
        db_info = {
            "total_keys":      len(user_data),
            "flight_count":    len(real),
            "db_path":         SQLITE_DB_PATH,
            "db_file":         os.path.basename(SQLITE_DB_PATH),
            "db_exists":       _db_exists,
            "db_size_kb":      round(os.path.getsize(SQLITE_DB_PATH) / 1024, 1) if _db_exists else 0,
            "db_type":         "SQLite",
            "flight_statuses": flight_statuses,
            "ended_count":     flight_statuses.get("Ended", 0),
            "active_count":    len(real) - flight_statuses.get("Ended", 0),
        }

        # System info
        import platform, time as _time
        try:
            import psutil
            proc     = psutil.Process()
            mem_mb   = round(proc.memory_info().rss / 1024 / 1024, 1)
            cpu_pct  = psutil.cpu_percent(interval=None)
            boot_ts  = psutil.boot_time()
            uptime_s = int(_time.time() - boot_ts)
            uptime_h = uptime_s // 3600
            uptime_m = (uptime_s % 3600) // 60
            uptime_str = f"{uptime_h}h {uptime_m}m"
            disk     = psutil.disk_usage(".")
            disk_free_gb = round(disk.free / 1024**3, 1)
            disk_pct = disk.percent
        except ImportError:
            mem_mb = cpu_pct = uptime_str = disk_free_gb = disk_pct = "psutil not installed"

        # Recent errors from log
        recent_errors = []
        try:
            if os.path.exists(LOG_FILE):
                with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
                    lines = f.read().splitlines()
                for line in reversed(lines[-500:]):
                    line = line.strip()
                    if not line.startswith("{"):
                        continue
                    try:
                        obj = json.loads(line)
                        if obj.get("level") == "error":
                            recent_errors.append(obj)
                            if len(recent_errors) >= 10:
                                break
                    except Exception:
                        pass
        except Exception:
            pass

        system_info = {
            "python_version": platform.python_version(),
            "os":             f"{platform.system()} {platform.release()}",
            "mem_mb":         mem_mb,
            "cpu_pct":        cpu_pct,
            "uptime":         uptime_str,
            "disk_free_gb":   disk_free_gb,
            "disk_pct":       disk_pct,
            "log_file":       LOG_FILE,
            "log_exists":     os.path.exists(LOG_FILE),
            "log_size_kb":    round(os.path.getsize(LOG_FILE) / 1024, 1) if os.path.exists(LOG_FILE) else 0,
        }

        # ── Bot latency & task info ──────────────────────────────────────────
        bot_info["latency_ms"] = round(bot.latency * 1000, 1) if bot.is_ready() else None
        bot_info["is_ready"]   = bot.is_ready()
        bot_info["is_closed"]  = bot.is_closed()
        # Background tasks
        task_info = {
            "track_latency":              {"running": track_latency.is_running(),              "next_iteration": str(track_latency.next_iteration)              if track_latency.is_running()              else None},
            "post_daily_schedule":        {"running": post_daily_schedule.is_running(),        "next_iteration": str(post_daily_schedule.next_iteration)        if post_daily_schedule.is_running()        else None},
            "auto_reminder_flights":      {"running": auto_reminder_flights.is_running(),      "next_iteration": str(auto_reminder_flights.next_iteration)      if auto_reminder_flights.is_running()      else None},
            "auto_end_flights":           {"running": auto_end_flights.is_running(),           "next_iteration": str(auto_end_flights.next_iteration)           if auto_end_flights.is_running()           else None},
            "cleanup_old_day_messages":   {"running": cleanup_old_day_messages.is_running(),   "next_iteration": str(cleanup_old_day_messages.next_iteration)   if cleanup_old_day_messages.is_running()   else None},
            "post_weekly_monthly_report": {"running": post_weekly_monthly_report.is_running(), "next_iteration": str(post_weekly_monthly_report.next_iteration) if post_weekly_monthly_report.is_running() else None},
            "cleanup_crew_threads":       {"running": cleanup_crew_threads.is_running(),       "next_iteration": str(cleanup_crew_threads.next_iteration)       if cleanup_crew_threads.is_running()       else None},
        }

        # ── Per-guild detail ─────────────────────────────────────────────────
        for g_info in guilds_info:
            gobj = discord.utils.get(bot.guilds, id=int(g_info["id"]))
            if gobj:
                # Channel counts
                text_channels  = len([c for c in gobj.channels if isinstance(c, discord.TextChannel)])
                voice_channels = len([c for c in gobj.channels if isinstance(c, discord.VoiceChannel)])
                categories     = len([c for c in gobj.channels if isinstance(c, discord.CategoryChannel)])
                # Role counts
                total_roles    = len(gobj.roles)
                # Boost info
                g_info["boost_level"]   = gobj.premium_tier
                g_info["boost_count"]   = gobj.premium_subscription_count or 0
                g_info["text_channels"] = text_channels
                g_info["voice_channels"]= voice_channels
                g_info["categories"]    = categories
                g_info["total_roles"]   = total_roles
                g_info["owner_id"]      = str(gobj.owner_id) if gobj.owner_id else None
                g_info["created_at"]    = gobj.created_at.isoformat() if gobj.created_at else None
                g_info["icon_url"]      = str(gobj.icon.url) if gobj.icon else None
                g_info["verified"]      = gobj.verification_level.name
                # Members with hoster/manager role (disabled for performance)
                g_info["hoster_member_count"]  = None
                g_info["manager_member_count"] = None

        # ── Detailed DB info ─────────────────────────────────────────────────
        # Oldest and newest flight
        real = get_real_flights()
        flight_dates = []
        for entry in real.values():
            d = entry.get("dep_date", "")
            if d and len(d) == 8:
                try:
                    flight_dates.append(datetime.strptime(d, "%d%m%Y"))
                except Exception:
                    pass
        db_info["oldest_flight_date"] = min(flight_dates).strftime("%Y-%m-%d") if flight_dates else None
        db_info["newest_flight_date"] = max(flight_dates).strftime("%Y-%m-%d") if flight_dates else None
        db_info["unique_hosts"]       = len({entry.get("host_user_id") for entry in real.values() if entry.get("host_user_id")})
        db_info["unique_routes"]      = len({f"{e.get('dep_code')}→{e.get('arr_code')}" for e in real.values() if e.get("dep_code") and e.get("arr_code")})
        db_info["unique_aircraft"]    = len({e.get("aircraft") for e in real.values() if e.get("aircraft")})
        db_info["flights_with_pax"]   = len([e for e in real.values() if e.get("pax") is not None])
        db_info["total_pax"]          = sum(e.get("pax") or 0 for e in real.values() if e.get("pax") is not None)
        db_info["day_msgs_tracked"]   = len(user_data.get("_day_msgs", {}))
        db_info["blocklist_size"]     = len(user_data.get("__blocklist__", []))
        # Log fields are displayed alongside database statistics in Diagnostics.
        db_info["log_exists"] = os.path.exists(LOG_FILE)
        db_info["log_size_kb"] = round(os.path.getsize(LOG_FILE) / 1024, 1) if db_info["log_exists"] else 0
        try:
            if db_info["log_exists"]:
                with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as _lf:
                    db_info["log_lines"] = sum(1 for _ in _lf)
            else:
                db_info["log_lines"] = 0
        except Exception:
            db_info["log_lines"] = None

        # ── Extended system info ─────────────────────────────────────────────
        import platform, time as _time
        try:
            import psutil
            proc = psutil.Process()
            # Memory details
            mem  = proc.memory_info()
            system_info["mem_rss_mb"]    = round(mem.rss  / 1024 / 1024, 1)
            system_info["mem_vms_mb"]    = round(mem.vms  / 1024 / 1024, 1)
            system_info["mem_percent"]   = round(proc.memory_percent(), 2)
            # CPU
            system_info["cpu_count"]     = psutil.cpu_count(logical=True)
            system_info["cpu_count_phys"]= psutil.cpu_count(logical=False)
            system_info["cpu_freq_mhz"]  = round(psutil.cpu_freq().current) if psutil.cpu_freq() else None
            system_info["cpu_pct_proc"]  = round(proc.cpu_percent(interval=0.1), 1)
            # Network IO
            net = psutil.net_io_counters()
            system_info["net_sent_mb"]   = round(net.bytes_sent   / 1024 / 1024, 1)
            system_info["net_recv_mb"]   = round(net.bytes_recv   / 1024 / 1024, 1)
            # Disk IO
            try:
                dio = psutil.disk_io_counters()
                system_info["disk_read_mb"]  = round(dio.read_bytes  / 1024 / 1024, 1)
                system_info["disk_write_mb"] = round(dio.write_bytes / 1024 / 1024, 1)
            except Exception:
                pass
            # Process details
            system_info["pid"]           = proc.pid
            system_info["threads"]       = proc.num_threads()
            system_info["open_files"]    = len(proc.open_files())
            system_info["process_start"] = datetime.fromtimestamp(proc.create_time()).isoformat()
            system_info["process_uptime_h"] = round((_time.time() - proc.create_time()) / 3600, 2)
            # All network interfaces
            addrs = psutil.net_if_addrs()
            system_info["network_interfaces"] = {
                iface: [a.address for a in addr_list if a.family.name in ("AF_INET", "AF_INET6")]
                for iface, addr_list in addrs.items()
            }
        except ImportError:
            pass

        system_info["python_impl"]       = platform.python_implementation()
        system_info["python_build"]      = platform.python_build()[1]
        system_info["platform_machine"]  = platform.machine()
        system_info["platform_node"]     = platform.node()
        system_info["platform_full"]     = platform.platform()
        system_info["cwd"]               = os.getcwd()
        system_info["script_path"]       = os.path.abspath(__file__) if "__file__" in dir() else "N/A"

        # ── discord.py library info ──────────────────────────────────────────
        lib_info = {
            "discord_py_version": discord.__version__,
            "fastapi_version":    None,
            "uvicorn_version":    None,
            "httpx_version":      None,
            "sqlite3_version":    sqlite3.sqlite_version,
        }
        try:
            import fastapi; lib_info["fastapi_version"] = fastapi.__version__
        except Exception: pass
        try:
            import uvicorn; lib_info["uvicorn_version"] = uvicorn.__version__
        except Exception: pass
        try:
            import httpx as _hx; lib_info["httpx_version"] = _hx.__version__
        except Exception: pass

        # ── Day message board status ─────────────────────────────────────────
        day_msgs = user_data.get("_day_msgs", {})
        today_utc = datetime.now(timezone.utc).date()
        day_msgs_detail = []
        for date_raw, msg_id in sorted(day_msgs.items()):
            try:
                dt = datetime.strptime(date_raw, "%d%m%Y").date()
                is_past = dt < today_utc
                is_today = dt == today_utc
            except Exception:
                dt = None; is_past = False; is_today = False
            day_msgs_detail.append({
                "date_raw": date_raw,
                "date_fmt": dt.isoformat() if dt else date_raw,
                "msg_id":   msg_id,
                "is_past":  is_past,
                "is_today": is_today,
            })

        # ── Recent log summary (all levels) ─────────────────────────────────
        log_summary = {"ok": 0, "info": 0, "warn": 0, "error": 0}
        recent_all_logs = []
        try:
            if os.path.exists(LOG_FILE):
                with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
                    raw_lines = f.read().splitlines()
                for line in reversed(raw_lines[-1000:]):
                    line = line.strip()
                    if not line.startswith("{"):
                        continue
                    try:
                        obj = json.loads(line)
                        lvl = obj.get("level", "info")
                        log_summary[lvl] = log_summary.get(lvl, 0) + 1
                        if len(recent_all_logs) < 20:
                            recent_all_logs.append(obj)
                    except Exception:
                        pass
        except Exception:
            pass

        # ── Live channel reachability ────────────────────────────────────────
        channel_health = {}
        target_g = discord.utils.get(bot.guilds, id=GUILD_ID)
        for label, cid in [("log", LOG_CHANNEL_ID), ("public", PUBLIC_CHANNEL_ID), ("announce", ANNOUNCE_CHANNEL_ID)]:
            ch = target_g.get_channel(cid) if target_g else None
            if not ch:
                channel_health[label] = {"id": str(cid), "reachable": False, "reason": "Channel not found"}
            else:
                perms = ch.permissions_for(target_g.me) if target_g and target_g.me else None
                can_send = perms.send_messages if perms else None
                can_read = perms.read_messages if perms else None
                channel_health[label] = {
                    "id": str(cid),
                    "name": ch.name,
                    "reachable": bool(can_send and can_read),
                    "can_send": bool(can_send),
                    "can_read": bool(can_read),
                }

        # ── Online member count ──────────────────────────────────────────────
        online_count = None

        # ── Active sessions + blocklist ──────────────────────────────────────
        try:
            from auth import _active_sessions, _blocklist
            import time as _t
            now_ts = int(_t.time())
            sessions_info = [
                {
                    "user_id":      s["user_id"],
                    "username":     s.get("username", "?"),
                    "role":         s.get("role", "?"),
                    "idle_minutes": round((now_ts - s.get("last_seen", now_ts)) / 60),
                    "session_age_h": round((now_ts - s.get("logged_in_at", now_ts)) / 3600, 1),
                }
                for s in _active_sessions.values()
            ]
            blocklist_detail = list(_blocklist)
        except Exception:
            sessions_info = []
            blocklist_detail = []

        # ── Failed login attempts (last hour from logs) ──────────────────────
        failed_logins = []
        try:
            if os.path.exists(LOG_FILE):
                cutoff = datetime.now(timezone.utc).timestamp() - 3600
                with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as _fl:
                    for line in _fl:
                        line = line.strip()
                        if not line.startswith("{"):
                            continue
                        try:
                            obj = json.loads(line)
                            if "fail" in (obj.get("action") or "").lower() or                                "no_role" in (obj.get("action") or "").lower() or                                "denied" in (obj.get("action") or "").lower():
                                failed_logins.append(obj)
                        except Exception:
                            pass
                failed_logins = failed_logins[-50:]
        except Exception:
            pass

        # ── Task last fired + feature flags ────────────────────────────────────
        try:
            tasks_last_fired = dict(_task_last_fired)
        except Exception:
            tasks_last_fired = {}
        try:
            feature_flags = dict(_feature_flags)
        except Exception:
            feature_flags = {}

        # ── Latency trend ────────────────────────────────────────────────────
        try:
            latency_trend = list(_latency_trend)
        except Exception:
            latency_trend = []

        return {
            "env":              env_info,
            "bot":              bot_info,
            "tasks":            task_info,
            "tasks_last_fired": tasks_last_fired,
            "feature_flags":    feature_flags,
            "latency_trend":    latency_trend,
            "channel_health":   channel_health,
            "online_members":   online_count,
            "sessions":         sessions_info,
            "active_session_count": len(sessions_info),
            "blocklist":        blocklist_detail,
            "failed_logins":    failed_logins,
            "guilds":           guilds_info,
            "roles":            role_check,
            "session":          session_info,
            "db":               db_info,
            "system":           system_info,
            "libs":             lib_info,
            "day_msgs":         day_msgs_detail,
            "log_summary":      log_summary,
            "recent_errors":    recent_errors,
            "recent_logs":      recent_all_logs,
            "ping_stats": [
                {
                    "user_id": str(uid),
                    "username": getattr(bot.get_user(uid), "name", f"User {uid}"),
                    "avatar": str(bot.get_user(uid).display_avatar.url) if bot.get_user(uid) and getattr(bot.get_user(uid), "display_avatar", None) else None,
                    "count": user_data.get("__ping_stats__", {}).get(str(uid), 0)
                }
                for uid in TRACKED_PING_USERS
            ]
        }

    @app.post("/api/debug/set-guild")
    async def set_guild(request: Request):
        """Switch the active GUILD_ID the bot operates on. Owner-only."""
        from auth import require_owner
        require_owner(request)

        body = await request.json()
        new_id_str = str(body.get("guild_id", "")).strip()
        if not new_id_str.isdigit():
            raise HTTPException(status_code=422, detail="guild_id must be a numeric string")

        new_id = int(new_id_str)
        target = discord.utils.get(bot.guilds, id=new_id)
        if target is None:
            raise HTTPException(status_code=404, detail="Bot is not in that guild")

        # Update the module-level globals so all subsequent operations use the new guild
        import sys
        _self = sys.modules[__name__]
        _self.GUILD_ID = new_id
        # Also patch the env so /api/debug reflects the change immediately
        os.environ["GUILD_ID"] = new_id_str

        return {"ok": True, "guild_id": new_id_str, "guild_name": target.name}

    # ── Bot config (roles + channels) ─────────────────────────────────────────

    @app.get("/api/config")
    async def get_config(request: Request):
        """Return current role/channel config + available options from the target guild. Owner-only."""
        from auth import require_owner
        require_owner(request)

        import sys
        _self = sys.modules[__name__]
        current = {
            "GUILD_ID":           str(_self.GUILD_ID),
            "HOSTER_ROLE":        str(_self.HOSTER_ROLE),
            "MANAGER_ROLE":       str(_self.MANAGER_ROLE),
            "BOD_ROLE":           str(_self.BOD_ROLE),
            "INTEREST_ROLE":      str(_self.INTEREST_ROLE),
            "FLIGHT_NOTIFY_ROLE": str(_self.FLIGHT_NOTIFY_ROLE),
            "FLIGHT_START_ROLE":  str(_self.FLIGHT_START_ROLE),
            "LOG_CHANNEL_ID":     str(_self.LOG_CHANNEL_ID),
            "PUBLIC_CHANNEL_ID":  str(_self.PUBLIC_CHANNEL_ID),
            "ANNOUNCE_CHANNEL_ID":str(_self.ANNOUNCE_CHANNEL_ID),
            "EVENTS_CHANNEL_ID":   str(_self.EVENTS_CHANNEL_ID),
            "CREW_CHANNEL_ID":     str(_self.CREW_CHANNEL_ID),
            "EVENTS_INTEREST_ROLE": str(_self.EVENTS_INTEREST_ROLE),
        }

        target = discord.utils.get(bot.guilds, id=_self.GUILD_ID)
        roles    = []
        channels = []
        if target:
            roles = [
                {"id": str(r.id), "name": r.name}
                for r in sorted(target.roles, key=lambda r: r.position, reverse=True)
                if r.name != "@everyone"
            ]
            channels = [
                {"id": str(c.id), "name": c.name}
                for c in sorted(target.channels, key=lambda c: c.name)
                if isinstance(c, discord.TextChannel)
            ]

        return {"current": current, "roles": roles, "channels": channels}

    @app.post("/api/config")
    async def save_config(request: Request):
        """Save role/channel config to DB and apply immediately. Owner-only."""
        from auth import require_owner
        require_owner(request)

        body = await request.json()
        import sys
        _self = sys.modules[__name__]

        allowed = {
            "HOSTER_ROLE", "MANAGER_ROLE", "BOD_ROLE", "INTEREST_ROLE", "FLIGHT_NOTIFY_ROLE", "FLIGHT_START_ROLE", "EVENTS_INTEREST_ROLE",
            "LOG_CHANNEL_ID", "PUBLIC_CHANNEL_ID", "ANNOUNCE_CHANNEL_ID", "EVENTS_CHANNEL_ID", "CREW_CHANNEL_ID",
        }
        updated = {}
        for field in allowed:
            raw = str(body.get(field, "")).strip()
            if raw and raw.isdigit():
                updated[field] = raw

        if not updated:
            raise HTTPException(status_code=422, detail="No valid fields provided")

        # Apply to live globals
        for field, raw in updated.items():
            setattr(_self, field, int(raw))
            os.environ[field] = raw

        # Persist to DB
        cfg = dict(user_data.get("__config__", {}))
        cfg.update(updated)
        cfg["GUILD_ID"] = str(_self.GUILD_ID)  # always persist current guild too
        user_data["__config__"] = cfg
        await save_user_data()

        return {"ok": True, "saved": updated}

    @app.post("/api/self-role-button")
    async def post_self_role_button(request: Request):
        from auth import require_owner
        session = require_owner(request)
        body = await request.json()
        role_id = str(body.get("role_id", "")).strip()
        channel_id = str(body.get("channel_id", "")).strip()
        label = str(body.get("label", "Get Role")).strip()[:80] or "Get Role"
        message = str(body.get("message", "Click the button below to receive the role.")).strip()[:1800]
        if not role_id.isdigit() or not channel_id.isdigit():
            raise HTTPException(status_code=422, detail="Select both a role and a channel")
        guild = bot.get_guild(GUILD_ID)
        role = guild.get_role(int(role_id)) if guild else None
        channel = guild.get_channel(int(channel_id)) if guild else None
        if not role:
            raise HTTPException(status_code=404, detail="Role not found")
        if not isinstance(channel, discord.TextChannel):
            raise HTTPException(status_code=404, detail="Text channel not found")
        view = discord.ui.View(timeout=None)
        view.add_item(discord.ui.Button(label=label, style=discord.ButtonStyle.primary, custom_id=f"selfrole:{role_id}"))
        try:
            sent = await channel.send(message or f"Click below to receive **{role.name}**.", view=view)
        except discord.Forbidden:
            raise HTTPException(status_code=403, detail="The bot cannot post in that channel")
        owner_name = session.get("username", "owner") if isinstance(session, dict) else "owner"
        log_to_file(f"Self-role button posted for @{role.name} in #{channel.name}", user=owner_name, level="ok")
        return {"ok": True, "message_id": str(sent.id), "role": role.name, "channel": channel.name}

    # ── Feature Flags ────────────────────────────────────────────────────────────

    @app.get("/api/features")
    async def get_features(request: Request):
        from auth import require_owner
        require_owner(request)
        return {"flags": dict(_feature_flags)}

    @app.get("/api/feature-config")
    async def get_feature_config(request: Request):
        from auth import require_owner
        require_owner(request)
        return {"config": dict(_feature_config)}

    @app.post("/api/feature-config")
    async def set_feature_config(request: Request):
        global _feature_config
        from auth import require_owner
        session = require_owner(request)
        body = await request.json()
        cfg = body.get("config", {})
        for key, params in cfg.items():
            if isinstance(params, dict):
                _feature_config.setdefault(key, {}).update(params)
            else:
                _feature_config[key] = params
        user_data["__feature_config__"] = dict(_feature_config)
        await save_user_data(user_trigger_desc="Feature config updated")
        username = session.get("username", "owner") if isinstance(session, dict) else "owner"
        log_to_file("Feature config updated", user=username, level="info")
        return {"config": dict(_feature_config)}

    # ── Automation controls ───────────────────────────────────────────────────

    _automation_labels = {
        "post_daily_schedule": "Daily schedule post",
        "auto_reminder_flights": "Pre-departure reminders",
        "auto_end_flights": "Auto-end flights",
        "post_weekly_monthly_report": "Weekly / monthly reports",
        "cleanup_old_day_messages": "Clean up old schedule messages",
    }

    def _automation_payload():
        result = {}
        for key, label in _automation_labels.items():
            config = dict(_feature_config.get(key, {}))
            if key == "post_daily_schedule":
                config["post_time_utc"] = f"{int(config.get('utc_hour', 0)):02d}:00"
            if key == "post_weekly_monthly_report":
                config["report_hour_utc"] = int(config.get("utc_hour", 0))
            result[key] = {
                "label": label,
                "enabled": bool(_feature_flags.get(key, True)),
                "description": "Configure this background automation.",
                **config,
            }
        return result

    @app.get("/api/automation")
    async def get_automation(request: Request):
        from auth import require_owner
        require_owner(request)
        return _automation_payload()

    @app.post("/api/automation")
    async def set_automation(request: Request):
        from auth import require_owner
        session = require_owner(request)
        body = await request.json()
        changed = []
        for key, updates in body.items():
            if key not in _automation_labels or not isinstance(updates, dict):
                continue
            if "enabled" in updates:
                _feature_flags[key] = bool(updates["enabled"])
            config = _feature_config.setdefault(key, {})
            for field, value in updates.items():
                if field == "enabled":
                    continue
                if key == "post_daily_schedule" and field == "post_time_utc":
                    try:
                        hour, minute = map(int, str(value).split(":"))
                        if not (0 <= hour <= 23 and 0 <= minute <= 59):
                            raise ValueError
                        config["utc_hour"] = hour
                    except ValueError:
                        raise HTTPException(status_code=422, detail="Post time must be a valid UTC time.")
                elif key == "post_weekly_monthly_report" and field == "report_hour_utc":
                    hour = int(value)
                    if not 0 <= hour <= 23:
                        raise HTTPException(status_code=422, detail="Report hour must be between 0 and 23.")
                    config["utc_hour"] = hour
                else:
                    config[field] = value
            changed.append(key)
        if not changed:
            raise HTTPException(status_code=422, detail="No valid automation settings provided.")
        user_data["__feature_flags__"] = dict(_feature_flags)
        user_data["__feature_config__"] = dict(_feature_config)
        await save_user_data(user_trigger_desc="Automation settings updated")
        username = session.get("username", "owner") if isinstance(session, dict) else "owner"
        log_to_file(f"Automation settings updated: {', '.join(changed)}", user=username, level="info")
        return _automation_payload()
    # ── Tab Overrides ─────────────────────────────────────────────────────────────

    @app.get("/api/tabs")
    async def get_tabs(request: Request):
        from auth import require_auth
        require_auth(request)
        return {"overrides": dict(_tab_overrides)}

    @app.post("/api/tabs")
    async def set_tabs(request: Request):
        global _tab_overrides
        from auth import require_owner, get_session
        require_owner(request)
        body = await request.json()
        overrides = body.get("overrides", {})
        _tab_overrides.update(overrides)
        user_data["__tab_overrides__"] = dict(_tab_overrides)
        await save_user_data(user_trigger_desc="Tab overrides updated")
        session = get_session(request)
        username = session.get("username", "owner") if session else "owner"
        changed = [f"{k}={'visible' if v else 'hidden'}" for k,v in overrides.items()]
        log_to_file(f"Tab overrides: {', '.join(changed)}", user=username, level="warn")
        return {"overrides": dict(_tab_overrides)}

    @app.post("/api/features")
    async def set_features(request: Request):
        global _feature_flags
        from auth import require_owner
        session = require_owner(request)
        body = await request.json()
        flags = body.get("flags", {})
        changed = []
        for key, val in flags.items():
            if key in _feature_flags:
                old_val = _feature_flags[key]
                _feature_flags[key] = bool(val)
                if old_val != bool(val):
                    changed.append(f"{key}={'ON' if val else 'OFF'}")
        user_data["__feature_flags__"] = dict(_feature_flags)
        await save_user_data(user_trigger_desc="Feature flags updated")
        if changed:
            username = session.get("username", "owner") if isinstance(session, dict) else "owner"
            log_to_file(f"Feature flags updated: {', '.join(changed)}", user=username, level="warn")
        return {"flags": dict(_feature_flags)}

    # ── Update Banner ─────────────────────────────────────────────────────────────

    @app.get("/api/banner")
    async def get_banner(request: Request):
        # Public — any authenticated user can read it
        from auth import require_auth
        require_auth(request)
        return {"banner": _update_banner}

    @app.post("/api/banner")
    async def set_banner(request: Request):
        global _update_banner
        from auth import require_owner
        session = require_owner(request)
        body = await request.json()
        message = (body.get("message") or "").strip()
        btype   = body.get("type", "info")
        if btype not in ("info", "warn", "ok"):
            btype = "info"
        if not message:
            _update_banner = None
            log_to_file("Update banner cleared", user=session.get("username","owner") if isinstance(session,dict) else "owner", level="info")
            return {"banner": None}
        _update_banner = {
            "message":      message,
            "type":         btype,
            "published_at": datetime.now(timezone.utc).isoformat(),
            "published_by": session.get("username","owner") if isinstance(session,dict) else "owner",
        }
        log_to_file(f"Update banner published: {message[:60]}", user=_update_banner["published_by"], level="ok")
        return {"banner": _update_banner}

    @app.delete("/api/banner")
    async def clear_banner(request: Request):
        global _update_banner
        from auth import require_owner
        require_owner(request)
        _update_banner = None
        return {"banner": None}

    # ── Blackout Dates ──────────────────────────────────────────────────────────

    @app.get("/api/blackout")
    async def get_blackout(request: Request):
        require_auth(request)
        return sorted(user_data.get("__blackout__", []))

    @app.post("/api/blackout")
    async def add_blackout(request: Request):
        session = require_auth(request)
        body = await request.json()
        date_str = (body.get("date") or "").strip()
        if not date_str:
            raise HTTPException(status_code=422, detail="Missing date")
        # Validate YYYY-MM-DD
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="Date must be YYYY-MM-DD")
        blackout = user_data.get("__blackout__", [])
        if date_str not in blackout:
            blackout.append(date_str)
            user_data["__blackout__"] = blackout
            await save_user_data()
        session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        log_to_file(f"Added blackout date {date_str}", user=session_username, level="warn")
        return {"blackout": sorted(blackout)}

    @app.delete("/api/blackout/{date_str}")
    async def remove_blackout(date_str: str, request: Request):
        session = require_auth(request)
        blackout = user_data.get("__blackout__", [])
        if date_str in blackout:
            blackout.remove(date_str)
            user_data["__blackout__"] = blackout
            await save_user_data()
        session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        log_to_file(f"Removed blackout date {date_str}", user=session_username, level="info")
        return {"blackout": sorted(blackout)}

    # ── Strikes ───────────────────────────────────────────────────────────────

    @app.get("/api/strikes")
    async def get_all_strikes(request: Request):
        require_manager(request)
        return user_data.get("__strikes__", {})

    @app.get("/api/strikes/{user_id}")
    async def get_user_strikes(user_id: str, request: Request):
        require_auth(request)
        return user_data.get("__strikes__", {}).get(user_id, [])

    @app.post("/api/strikes/{user_id}")
    async def add_strike(user_id: str, request: Request):
        session = require_manager(request)
        body    = await request.json()
        reason  = (body.get("reason") or "").strip()
        username = (body.get("username") or user_id).strip()
        if not reason:
            raise HTTPException(status_code=422, detail="Missing reason")
        strikes = user_data.setdefault("__strikes__", {})
        entries = strikes.setdefault(user_id, [])
        entries.append({
            "reason":    reason,
            "username":  username,
            "issued_at": datetime.now(timezone.utc).isoformat() + "Z",
            "issued_by": session.get("username","manager") if isinstance(session,dict) else "manager",
        })
        await save_user_data(user_trigger_desc=f"Strike issued to {user_id}")
        mgr = session.get("username","manager") if isinstance(session,dict) else "manager"
        log_to_file(f"Strike issued to {username} ({user_id}): {reason[:60]}", user=mgr, level="warn")
        return {"number": len(entries), "strikes": entries}

    @app.delete("/api/strikes/{user_id}/{idx}")
    async def remove_strike(user_id: str, idx: int, request: Request):
        session = require_manager(request)
        strikes = user_data.get("__strikes__", {})
        entries = strikes.get(user_id, [])
        if idx < 0 or idx >= len(entries):
            raise HTTPException(status_code=404, detail="Strike not found")
        removed = entries.pop(idx)
        if not entries:
            strikes.pop(user_id, None)
        await save_user_data(user_trigger_desc=f"Strike removed from {user_id}")
        mgr = session.get("username","manager") if isinstance(session,dict) else "manager"
        log_to_file(f"Strike removed from {user_id}: {removed.get('reason','')[:40]}", user=mgr, level="info")
        return {"ok": True}

    # ── Bot Presence ──────────────────────────────────────────────────────────

    PRESENCE_TYPES = {
        "playing":   discord.ActivityType.playing,
        "watching":  discord.ActivityType.watching,
        "listening": discord.ActivityType.listening,
        "competing": discord.ActivityType.competing,
    }

    @app.get("/api/presence")
    async def get_presence(request: Request):
        require_auth(request)
        return user_data.get("__presence__", {"type": "watching", "text": "the skies", "enabled": True})

    @app.post("/api/presence")
    async def set_presence(request: Request):
        session = require_auth(request)
        body = await request.json()
        ptype  = (body.get("type") or "watching").lower()
        ptext  = (body.get("text") or "").strip()
        enabled = bool(body.get("enabled", True))
        if ptype not in PRESENCE_TYPES:
            raise HTTPException(status_code=422, detail=f"Invalid type. Must be one of: {list(PRESENCE_TYPES)}")
        if not ptext:
            raise HTTPException(status_code=422, detail="text cannot be empty")
        presence_cfg = {"type": ptype, "text": ptext, "enabled": enabled}
        user_data["__presence__"] = presence_cfg
        await save_user_data()
        # Apply immediately
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if enabled:
            activity = discord.Activity(type=PRESENCE_TYPES[ptype], name=ptext)
            await bot.change_presence(activity=activity, status=discord.Status.online)
        else:
            await bot.change_presence(activity=None, status=discord.Status.online)
        session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        log_to_file(f"Bot presence set: {ptype} {ptext}", user=session_username, level="ok")
        return presence_cfg

    # ── Owner Settings ────────────────────────────────────────────────────────
    # A persistent key-value store for owner-only config (nudge messages, defaults, etc.)
    # Stored in user_data["__owner_settings__"]

    _OWNER_SETTINGS_DEFAULTS = {
        "nudge_threshold_days": 14,
        "nudge_message":        "Hey {username}! 👋 Just a friendly reminder from AIC management — we noticed you haven't hosted a flight in a while. We'd love to see you back in the skies! Let us know if you need anything. ✈",
        "nudge_dm_footer":      "— Air Canada PTFS Management",
        "bot_send_default_channel": "",   # channel ID, blank = first in list
        "owner_notepad":        "",
        # Templates tab
        "announce_templates":   [],
        "msg_reminder":         "",
        "msg_checkin":          "",
        "msg_boarding_closed":  "",
        "msg_auto_reminder":    "",
        "msg_event_post":       "",
    }

    @app.get("/api/owner-settings")
    async def get_owner_settings(request: Request):
        from auth import require_owner
        require_owner(request)
        defaults = dict(_OWNER_SETTINGS_DEFAULTS)
        stored   = user_data.get("__owner_settings__", {})
        defaults.update(stored)
        return defaults

    @app.post("/api/owner-settings")
    async def save_owner_settings(request: Request):
        from auth import require_owner
        require_owner(request)
        body = await request.json()
        stored = user_data.get("__owner_settings__", {})
        # Only update known keys
        for key in _OWNER_SETTINGS_DEFAULTS:
            if key in body:
                stored[key] = body[key]
        user_data["__owner_settings__"] = stored
        await save_user_data(user_trigger_desc="Owner settings updated")
        result = dict(_OWNER_SETTINGS_DEFAULTS)
        result.update(stored)
        return result

    # ── Flight Attendant Handbook ────────────────────────────────────────────────

    HANDBOOK_TEMPLATE_PATH = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "Air_Canada_PTFS_Flight_Attendant_Handbook__1_.docx"
    )
    HANDBOOK_SH_TEMPLATE_PATH = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "Air_Canada_PTFS_Flight_Attendant_Handbook_SH.docx"
    )
    SH_HANDBOOK_AIRCRAFT = ("A220", "A320", "B737", "CRJ", "Q400")

    def _handbook_aircraft_key(aircraft: str) -> str:
        value = "".join(ch for ch in (aircraft or "").upper() if ch.isalnum())
        aliases = {
            "A223": "A220",
            "CR9": "CRJ",
            "CRJ9": "CRJ",
            "CRJ900": "CRJ",
            "DH4": "Q400",
            "DH4J": "Q400",
            "DASH8400": "Q400",
            "DASH8Q400": "Q400",
        }
        if value in aliases:
            return aliases[value]
        for key in SH_HANDBOOK_AIRCRAFT:
            if key in value:
                return key
        return value

    def _select_handbook_template(aircraft: str) -> tuple[str, str]:
        aircraft_key = _handbook_aircraft_key(aircraft)
        if aircraft_key in SH_HANDBOOK_AIRCRAFT:
            return HANDBOOK_SH_TEMPLATE_PATH, "Short Haul"
        return HANDBOOK_TEMPLATE_PATH, "Long Haul"

    _HANDBOOK_DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]

    def _resolve_local_file(path: str) -> str:
        if os.path.isabs(path):
            return path
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), path)

    def _load_handbook_drive_credentials():
        token_file = _resolve_local_file(HANDBOOK_GOOGLE_OAUTH_TOKEN_FILE)
        if not os.path.exists(token_file):
            raise FileNotFoundError(f"{HANDBOOK_GOOGLE_OAUTH_TOKEN_FILE} is missing")

        try:
            from google.auth.transport.requests import Request as GoogleAuthRequest
            from google.oauth2.credentials import Credentials
        except ImportError as exc:
            raise RuntimeError("Google Drive OAuth dependencies are not installed") from exc

        creds = Credentials.from_authorized_user_file(token_file, _HANDBOOK_DRIVE_SCOPES)
        if creds.expired and creds.refresh_token:
            creds.refresh(GoogleAuthRequest())
            with open(token_file, "w", encoding="utf-8") as fh:
                fh.write(creds.to_json())
        if not creds.valid:
            raise RuntimeError("Google Drive OAuth token is invalid")
        return creds

    def _upload_handbook_to_drive(buf, filename: str) -> str:
        if not HANDBOOK_DRIVE_FOLDER_ID:
            raise RuntimeError("HANDBOOK_DRIVE_FOLDER_ID is not configured")

        try:
            from googleapiclient.discovery import build
            from googleapiclient.http import MediaIoBaseUpload
        except ImportError as exc:
            raise RuntimeError("Google Drive upload dependencies are not installed") from exc

        creds = _load_handbook_drive_credentials()
        service = build("drive", "v3", credentials=creds, cache_discovery=False)

        buf.seek(0)
        # ✅ Fix — convert to Google Docs on upload, gives a real docs.google.com/edit link
        media = MediaIoBaseUpload(
            buf,
            mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            resumable=False,
        )
        metadata = {
            "name": filename,
            "parents": [HANDBOOK_DRIVE_FOLDER_ID],
            "mimeType": "application/vnd.google-apps.document",  # ← convert to Google Doc
        }
        created = service.files().create(
            body=metadata,
            media_body=media,
            fields="id,webViewLink",
        ).execute()
        log_to_file(f"Handbook Drive file created: {filename} ({created.get('id', 'no-id')})", level="ok")
        service.permissions().create(
            fileId=created["id"],
            body={"type": "anyone", "role": "writer"},
            fields="id",
        ).execute()
        log_to_file(f"Handbook Drive permission set to anyone-writer: {filename} ({created.get('id', 'no-id')})", level="ok")
        buf.seek(0)
        return created.get("webViewLink", "")

    # 4-week rotating meal menu (A→B→C→D based on ISO week number)
    _MEAL_ROTATIONS = {
        'A': {
            # Signature – Breakfast (3 options)
            'sig_bfst_1':  'Smoked Salmon Root Vegetable Salad.',
            'sig_bfst_2':  'American Burger with Fries or Chips.',
            'sig_bfst_3':  'Roasted Lamb Rack with mint oil and side salad.',
            # Signature – Lunch/Dinner (2 lines)
            'sig_lunch_1': 'Smoked Salmon Root Vegetable Salad, American Burger with Fries or Chips, and Roasted Lamb Rack with mint oil and side salad.',
            'sig_lunch_2': 'Please let us know which you would prefer.',
            # Economy – Breakfast
            'eco_bfst':    'Smoked Salmon Root Vegetable Salad: house greens, smoked salmon, roasted root vegetables, and lemon dill dressing, served with a bread roll.',
            # Economy – Lunch/Dinner
            'eco_lunch':   'American Burger with Fries: a classic beef patty on a brioche bun with lettuce, tomato, and fries on the side.',
        },
        'B': {
            'sig_bfst_1':  'Caesar Salad with grilled chicken.',
            'sig_bfst_2':  'Creamy Chicken Alfredo Pasta.',
            'sig_bfst_3':  'Beef Lasagna with garlic bread.',
            'sig_lunch_1': 'Caesar Salad with grilled chicken, Creamy Chicken Alfredo Pasta, and Beef Lasagna with garlic bread.',
            'sig_lunch_2': 'Please let us know which you would prefer.',
            'eco_bfst':    'Caesar Salad with Grilled Chicken: crisp romaine, parmesan shavings, caesar dressing, and herb croutons, served with a warm bread roll.',
            'eco_lunch':   'Chicken Alfredo Pasta: grilled chicken with penne in a creamy Alfredo sauce, served with steamed broccoli.',
        },
        'C': {
            'sig_bfst_1':  'Shrimp Cocktail Salad.',
            'sig_bfst_2':  'Teriyaki Chicken with jasmine rice.',
            'sig_bfst_3':  'Mushroom Ravioli in truffle cream sauce.',
            'sig_lunch_1': 'Shrimp Cocktail Salad, Teriyaki Chicken with jasmine rice, and Mushroom Ravioli in truffle cream sauce.',
            'sig_lunch_2': 'Please let us know which you would prefer.',
            'eco_bfst':    'Shrimp Cocktail Salad: chilled shrimp, mixed greens, cocktail sauce, and lemon wedges, served with a bread roll.',
            'eco_lunch':   'Teriyaki Chicken with Jasmine Rice: glazed teriyaki chicken over steamed jasmine rice with stir-fried vegetables.',
        },
        'D': {
            'sig_bfst_1':  'Burrata and cherry tomato salad.',
            'sig_bfst_2':  'Herb-crusted salmon with roasted potatoes.',
            'sig_bfst_3':  "Shepherd's pie with rosemary gravy.",
            'sig_lunch_1': "Burrata and cherry tomato salad, Herb-crusted salmon with roasted potatoes, and Shepherd's pie with rosemary gravy.",
            'sig_lunch_2': 'Please let us know which you would prefer.',
            'eco_bfst':    'Burrata and Cherry Tomato Salad: fresh burrata, cherry tomatoes, basil oil, and sea salt flakes, served with a bread roll.',
            'eco_lunch':   "Herb-crusted Salmon with Roasted Potatoes: pan-seared herb salmon fillet with golden roasted potatoes and seasonal greens.",
        },
    }

    def _get_meal_week(override: str = "") -> str:
        """Return the active meal week letter (A/B/C/D)."""
        override = (override or "").strip().upper()
        if override in ('A', 'B', 'C', 'D'):
            return override
        from datetime import date as _date
        iso_week = _date.today().isocalendar()[1]  # 1-53
        return ('A', 'B', 'C', 'D')[(iso_week - 1) % 4]

    @app.get("/api/flights/{code}/handbook")
    async def download_handbook(
        code: str,
        request: Request,
        fa_name: str = "",
        arr_city_override: str = "",
        local_time: str = "",
        temperature: str = "",
        dep_gate: str = "",
        handbook_type: str = "Long Haul",
        extra_notes: str = "",
        meal_week: str = "",
        drive_only: bool = True,
    ):
        """Generate a filled FA handbook .docx for a given flight."""
        session = require_auth(request)
        session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        code = code.upper()
        log_to_file(f"Handbook requested for {code} (drive_only={drive_only})", user=session_username, level="info")
        if code not in user_data or "flight_number" not in user_data[code]:
            log_to_file(f"Handbook request failed for {code}: flight not found", user=session_username, level="warn")
            raise HTTPException(status_code=404, detail="Flight not found")

        if not _DOCX_OK:
            log_to_file(f"Handbook request failed for {code}: python-docx missing", user=session_username, level="warn")
            raise HTTPException(status_code=503, detail="python-docx not installed on server")

        entry = user_data[code]
        existing_drive_link = entry.get("handbook", {}).get("drive_link", "")
        if drive_only and existing_drive_link:
            log_to_file(f"Handbook cached redirect for {code}: {existing_drive_link}", user=session_username, level="ok")
            return {"drive_link": existing_drive_link, "cached": True}

        template, auto_handbook_type = _select_handbook_template(entry.get("aircraft", ""))
        if not os.path.exists(template):
            log_to_file(f"Handbook request failed for {code}: {auto_handbook_type} template missing", user=session_username, level="warn")
            raise HTTPException(status_code=503, detail=f"{auto_handbook_type} handbook template not found on server")
        log_to_file(
            f"Handbook generating for {code}: aircraft={entry.get('aircraft', '') or 'N/A'}, type={auto_handbook_type}",
            user=session_username,
            level="info"
        )

        fn    = entry.get("flight_number", code)
        dep   = entry.get("dep_code", "?")
        arr   = entry.get("arr_code", "?")
        dep_city = entry.get("dep_city", dep)
        arr_city = arr_city_override or entry.get("arr_city", arr)
        dep_time = entry.get("dep_time", "")

        # Host name from guild member cache
        host_uid = entry.get("host_user_id", "")
        host_name = "N/A"
        try:
            g = discord.utils.get(bot.guilds, id=GUILD_ID)
            if g and host_uid:
                m = g.get_member(int(host_uid))
                host_name = m.display_name if m else host_uid
        except Exception:
            pass

        gate   = dep_gate or entry.get("gate", {}).get("dep", "TBD")
        ltime  = local_time or "TBD"
        temp   = temperature or "TBD"
        fname  = fa_name or "FA"
        htype  = auto_handbook_type
        notes  = extra_notes or ""

        import io, copy
        from docx import Document

        doc = Document(template)

        def replace_in_para(para, replacements):
            for run in para.runs:
                for old, new in replacements.items():
                    if old in run.text:
                        run.text = run.text.replace(old, new)

        # Also handle split runs by rebuilding full paragraph text
        def replace_in_para_full(para, replacements):
            full = ''.join(r.text for r in para.runs)
            new_full = full
            for old, new in replacements.items():
                new_full = new_full.replace(old, new)
            if new_full != full and para.runs:
                para.runs[0].text = new_full
                for r in para.runs[1:]:
                    r.text = ''

        # Determine active meal week and load menu
        week_letter = _get_meal_week(meal_week)
        meals = _MEAL_ROTATIONS[week_letter]

        replacements = {
            'AC #':      fn,
            'Gate #':    gate,
            '##:##':     ltime,
            'My name is #': f'My name is {fname}',
            'Good morning #!': f'Good morning!',
            'Mr./Ms. #!': 'everyone!',
            'back home to #.': f'back home to {arr_city}.',
            '# degrees Celsius': f'{temp} degrees Celsius',
            'Handbook Type: Long Haul': f'Handbook Type: {htype}',
            'Handbook Type: Short Haul': f'Handbook Type: {htype}',
            'Flight Host Name:': f'Flight Host Name: {host_name}',
            'Extra notes:': f'Extra notes: {notes} [Meal Week {week_letter}]' if notes else f'Extra notes: Meal Week {week_letter}',
            # ── Signature Class Breakfast (3-option menu) ──
            'Our first selection is fluffy scrambled eggs with peameal bacon, roasted potatoes, and grilled tomatoes.': f'Our first selection is {meals["sig_bfst_1"]}',
            'Our second option is Greek yogurt with Canadian maple syrup, granola, and fresh seasonal berries.': f'Our second option is {meals["sig_bfst_2"]}',
            'And our third selection is freshly baked croissants and pastries, served with Canadian butter and seasonal preserves. Which would you prefer?': f'And our third selection is {meals["sig_bfst_3"]} Which would you prefer?',
            # ── Signature Class Lunch/Dinner ──
            'Of course! Today our menu features tomato and tarragon chicken, creamy cannelloni, and macaroni with aged cheese.': f'Of course! Today our menu features {meals["sig_lunch_1"]}',
            "We also have sweet bell pepper chicken, Shepherd's pie, butternut squash ravioli, and marinara meatballs. Which would you like?": meals["sig_lunch_2"],
            # ── Economy Class Breakfast ──
            'Today we have our Breakfast Burrito: scrambled eggs, cheddar cheese, diced ham, and sautéed peppers, served with salsa and fruit salad. Shall I bring that for you?': f'Today we have our {meals["eco_bfst"]} Shall I bring that for you?',
            # ── Economy Class Lunch/Dinner ──
            'Today we have Chicken Alfredo Pasta: grilled chicken with penne in a creamy Alfredo sauce, served with steamed broccoli. Shall I bring that for you?': f'Today we have {meals["eco_lunch"]} Shall I bring that for you?',
        }

        # Add flight number and route to the info block
        fn_replaced  = False
        route_replaced = False
        for para in doc.paragraphs:
            t = para.text.strip()
            if t == 'Flight Number:' and not fn_replaced:
                if para.runs:
                    para.runs[-1].text = f' {fn}'
                    fn_replaced = True
            elif t == 'Flight Route:' and not route_replaced:
                if para.runs:
                    para.runs[-1].text = f' {dep} - {arr}'
                    route_replaced = True
            else:
                replace_in_para_full(para, replacements)

        # Also replace in tables
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    for para in cell.paragraphs:
                        replace_in_para_full(para, replacements)

        buf = io.BytesIO()
        doc.save(buf)
        buf.seek(0)

        filename = f"FA_Handbook_{fn}_{dep}-{arr}.docx"
        drive_link = ""
        drive_error = ""
        try:
            log_to_file(f"Handbook Drive upload starting for {code}: {filename}", user=session_username, level="info")
            drive_link = _upload_handbook_to_drive(buf, filename)
            entry["handbook"] = {
                "drive_link": drive_link,
                "filename": filename,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "type": auto_handbook_type,
            }
            await save_user_data(user_trigger_desc=f"Handbook uploaded for {code}")
            log_to_file(f"Handbook Drive upload succeeded for {code}: {drive_link}", user=session_username, level="ok")
        except Exception as exc:
            drive_error = str(exc)
            log_to_file(f"Handbook Drive upload failed for {code}: {drive_error[:500]}", user=session_username, level="warn")
        finally:
            buf.seek(0)

        if drive_only:
            if drive_link:
                return {"drive_link": drive_link}
            log_to_file(f"Handbook drive-only request failed for {code}: {drive_error or 'unknown error'}", user=session_username, level="warn")
            raise HTTPException(status_code=502, detail=f"Drive upload failed: {drive_error or 'unknown error'}")

        from fastapi.responses import StreamingResponse
        headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
        if drive_link:
            headers["X-Google-Drive-Link"] = drive_link
        elif drive_error:
            headers["X-Google-Drive-Error"] = drive_error[:500].replace("\r", " ").replace("\n", " ")
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers=headers
        )

    # ── Crew Signup System ───────────────────────────────────────────────────
    CREW_SLOTS = {
        "pilot":   {"label": "Pilot",       "max": 1,    "required_role": 1414914011908145225},
        "copilot": {"label": "Co-Pilot",    "max": 1,    "required_role": 1414914011908145225},
        "cc":      {"label": "Cabin Crew",  "max": 3,    "required_role": 1414914009274122291},
        "gc":      {"label": "Ground Crew", "max": 2,    "required_role": 1414914014160617613},
        "backup":  {"label": "Backup",      "max": None, "required_role": 1260980880202006580},
    }

    def _find_crew_role_for_user(crew: dict, uid: str) -> tuple[str | None, dict | None]:
        for role_key, cfg in CREW_SLOTS.items():
            current = crew.get(role_key)
            if isinstance(current, list):
                if uid in current:
                    return role_key, cfg
            elif current == uid:
                return role_key, cfg
        return None, None

    def _remove_user_from_crew_role(crew: dict, role: str, uid: str) -> bool:
        current = crew.get(role)
        if isinstance(current, list):
            if uid not in current:
                return False
            crew[role] = [member_id for member_id in current if member_id != uid]
            return True
        if current != uid:
            return False
        crew[role] = None
        return True

    def _get_crew_removal_requests_store() -> dict:
        return user_data.setdefault("__crew_removal_requests__", {})

    def _can_review_crew_removal_request(session: dict, entry: dict) -> bool:
        if session.get("is_bod") or session.get("is_manager") or session.get("is_owner"):
            return True
        return str(entry.get("host_user_id", "")).strip() == str(session.get("user_id", "")).strip()

    def _can_manage_flight_crew(session: dict, entry: dict) -> bool:
        if session.get("is_bod") or session.get("is_manager") or session.get("is_owner"):
            return True
        return str(entry.get("host_user_id", "")).strip() == str(session.get("user_id", "")).strip()

    def _resolve_member_brief(uid):
        uid = str(uid or "").strip()
        if not uid:
            return {"id": "", "name": ""}
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if not g:
            return {"id": uid, "name": uid}
        m = g.get_member(int(uid)) if uid.isdigit() else None
        return {"id": uid, "name": m.display_name if m else uid}

    def _serialize_crew_for_dashboard(entry: dict) -> dict:
        crew = entry.get("crew", {})
        return {
            "pilot": _resolve_member_brief(crew.get("pilot")),
            "copilot": _resolve_member_brief(crew.get("copilot")),
            "cc": [_resolve_member_brief(u) for u in crew.get("cc", [])],
            "gc": [_resolve_member_brief(u) for u in crew.get("gc", [])],
            "backup": [_resolve_member_brief(u) for u in crew.get("backup", [])],
            "thread_id": crew.get("thread_id"),
            "message_id": crew.get("message_id"),
        }

    async def _refresh_crew_signup_message(code: str, entry: dict):
        crew = entry.get("crew", {})
        try:
            tid = crew.get("thread_id")
            mid = crew.get("message_id")
            if tid and mid:
                thread = bot.get_channel(int(tid))
                if thread is None:
                    thread = await bot.fetch_channel(int(tid))
                if thread:
                    msg_obj = await thread.fetch_message(int(mid))
                    new_text, new_items = _build_crew_message(code, entry)
                    new_view = discord.ui.View(timeout=None)
                    for item in new_items:
                        new_view.add_item(item)
                    await msg_obj.edit(content=new_text, view=new_view)
        except Exception as e:
            log_to_file(f"Crew message update failed for {code}: {e}", level="warn")

    class CrewRemovalRequestModal(Modal, title="Request Role Removal"):
        def __init__(self, code: str):
            super().__init__(timeout=300)
            self.code = code.upper()
            self.reason = TextInput(
                label="Why do you need to step off this role?",
                style=TextStyle.paragraph,
                placeholder="Explain the reason for your removal request...",
                required=True,
                max_length=500,
            )
            self.add_item(self.reason)

        async def on_submit(self, interaction: discord.Interaction):
            entry = user_data.get(self.code)
            if not entry or "flight_number" not in entry:
                await interaction.response.send_message("Flight not found.", ephemeral=True)
                return

            crew = entry.setdefault("crew", {})
            uid = str(interaction.user.id)
            role_key, cfg = _find_crew_role_for_user(crew, uid)
            if not role_key or not cfg:
                await interaction.response.send_message("You do not currently hold a crew role on this flight.", ephemeral=True)
                return

            req_id = generate_ref_code(8)
            avatar_url = getattr(interaction.user.display_avatar, "url", "")
            requests_dict = _get_crew_removal_requests_store()
            requests_dict[req_id] = {
                "request_id": req_id,
                "flight_code": self.code,
                "flight_number": entry.get("flight_number", self.code),
                "requester_id": uid,
                "requester_name": interaction.user.display_name,
                "requester_avatar": str(avatar_url) if avatar_url else "",
                "role": role_key,
                "role_label": cfg.get("label", role_key),
                "reason": str(self.reason.value).strip(),
                "status": "pending",
                "submitted_at": utc_iso_z(),
                "host_user_id": str(entry.get("host_user_id", "")).strip(),
            }
            user_data["__crew_removal_requests__"] = requests_dict
            await save_user_data(user_trigger_desc=f"Crew removal request submitted for {self.code}")
            log_to_file(
                f"Crew removal requested for {self.code} by {interaction.user.display_name} ({uid}) as {cfg.get('label', role_key)}",
                user=interaction.user.display_name,
                level="warn",
            )
            await interaction.response.send_message(
                f"Removal request submitted for **{cfg.get('label', role_key)}** on {entry.get('flight_number', self.code)}.",
                ephemeral=True,
            )

    def _build_crew_message(code: str, entry: dict) -> tuple:
        crew = entry.get("crew", {})
        fn   = entry.get("flight_number", code)
        dep  = entry.get("dep_code", "???")
        arr  = entry.get("arr_code", "???")
        date = entry.get("dep_date", "")
        time = entry.get("dep_time", "")
        try:
            from datetime import datetime as _dt
            d = _dt.strptime(date, "%d%m%Y")
            date_fmt = d.strftime("%d/%m")
        except Exception:
            date_fmt = date

        host_id    = entry.get("host_user_id")
        host_str   = f"<@{host_id}>" if host_id else "N/A"
        cohost_ids = entry.get("cohosts", [])
        cohost_str = ", ".join(f"<@{c}>" for c in cohost_ids) if cohost_ids else "N/A"
        event_link = entry.get("event", {}).get("link") or "N/A"

        pilot_str   = f"<@{crew.get('pilot')}>"   if crew.get("pilot")   else "N/A"
        copilot_str = f"<@{crew.get('copilot')}>" if crew.get("copilot") else "N/A"
        cc_list = crew.get("cc", [])
        gc_list = crew.get("gc", [])
        bk_list = crew.get("backup", [])
        cc_str  = ", ".join(f"<@{u}>" for u in cc_list) if cc_list else "N/A"
        gc_str  = ", ".join(f"<@{u}>" for u in gc_list) if gc_list else "N/A"
        bk_str  = ", ".join(f"<@{u}>" for u in bk_list) if bk_list else "N/A"

        msg = (
            f"## Crew Sign-Up — {fn}\n"
            f"**Route:** {dep} -> {arr}  |  **Date:** {date_fmt}  |  **Time:** {time} UTC\n\n"
            f"**In-Flight Roles**\n"
            f"Pilot: {pilot_str}\n"
            f"Co-Pilot: {copilot_str}\n"
            f"Cabin Crew ({len(cc_list)}/3): {cc_str}\n"
            f"Ground Crew ({len(gc_list)}/3): {gc_str}\n\n"
            f"**Misc Roles**\n"
            f"Backup: {bk_str}\n\n"
            f"**Host:** {host_str}\n"
            f"**Co-Host:** {cohost_str}\n\n"
            f"Use the controls below to sign up for a role or submit a removal request. You can only hold one role at a time.\n\n"
            f"**Event:** {event_link}\n"
            f"<@&1260980880202006580>"
        )

        # Build available options for claim menu (exclude full slots)
        claim_options = []
        for role_key, cfg in CREW_SLOTS.items():
            current   = crew.get(role_key)
            count_now = len(current) if isinstance(current, list) else (1 if current else 0)
            full      = cfg["max"] is not None and count_now >= cfg["max"]
            if not full:
                if cfg["max"] is not None:
                    desc = f"{count_now}/{cfg['max']} filled"
                else:
                    desc = f"{count_now} signed up"
                claim_options.append(discord.SelectOption(
                    label=cfg["label"],
                    value=role_key,
                    description=desc,
                ))

        # Claim select menu
        claim_select = discord.ui.Select(
            placeholder="Sign up for a role...",
            custom_id=f"crew:{code}:claim",
            options=claim_options if claim_options else [
                discord.SelectOption(label="All roles filled", value="none", description="No slots available")
            ],
            disabled=not claim_options,
            min_values=1,
            max_values=1,
            row=0,
        )

        removal_request_btn = discord.ui.Button(
            label="Removal Request",
            style=discord.ButtonStyle.danger,
            custom_id=f"crew:{code}:request_removal",
            row=1,
        )

        return msg, [claim_select, removal_request_btn]

    async def _create_crew_thread(code: str, entry: dict):
        try:
            g = discord.utils.get(bot.guilds, id=GUILD_ID)
            if not g:
                return
            ch = g.get_channel(CREW_CHANNEL_ID)
            if not ch:
                log_to_file("Crew thread: CREW_CHANNEL_ID not set or channel not found", level="warn")
                return
            fn   = entry.get("flight_number", code)
            dep  = entry.get("dep_code", "???")
            arr  = entry.get("arr_code", "???")
            time = entry.get("dep_time", "")
            date = entry.get("dep_date", "")
            try:
                from datetime import datetime as _dt
                d = _dt.strptime(date, "%d%m%Y")
                date_fmt = d.strftime("%d/%m")
            except Exception:
                date_fmt = date
            thread_name = f"{fn} | {dep} - {arr} | {date_fmt} | {time} UTC"
            msg_text, items = _build_crew_message(code, entry)
            view = discord.ui.View(timeout=None)
            for item in items:
                view.add_item(item)
            # Create a forum post or public thread depending on channel type
            if isinstance(ch, discord.ForumChannel):
                thread_with_msg = await ch.create_thread(
                    name=thread_name,
                    content=msg_text,
                    view=view,
                )
                thread     = thread_with_msg.thread
                signup_msg = thread_with_msg.message
            else:
                thread     = await ch.create_thread(
                    name=thread_name,
                    type=discord.ChannelType.public_thread,
                )
                signup_msg = await thread.send(content=msg_text, view=view)
            try:
                await signup_msg.pin()
            except Exception:
                pass  # pin failed silently (missing permissions etc)
            if code in user_data:
                crew = user_data[code].setdefault("crew", {})
                crew["thread_id"]  = str(thread.id)
                crew["message_id"] = str(signup_msg.id)
                await save_user_data(user_trigger_desc=f"Crew thread created for {code}")
            log_to_file(f"Crew signup thread created for {fn}", level="ok")
        except Exception as e:
            log_to_file(f"Crew thread creation failed for {code}: {e}", level="warn")

    if not getattr(bot, "_crew_interaction_registered", False):
        bot._crew_interaction_registered = True

        @bot.listen("on_interaction")
        async def handle_crew_interaction(interaction: discord.Interaction):
            custom_id = interaction.data.get("custom_id", "")
            if not custom_id.startswith("crew:"):
                return

            # Format: crew:{code}:claim or crew:{code}:request_removal
            parts = custom_id.split(":")
            if len(parts) != 3:
                return
            _, code, action = parts
            code = code.upper()

            if code not in user_data or "flight_number" not in user_data[code]:
                await interaction.response.send_message("Flight not found.", ephemeral=True)
                return

            entry  = user_data[code]
            crew   = entry.setdefault("crew", {})
            uid    = str(interaction.user.id)

            if action == "request_removal":
                role_key, _cfg = _find_crew_role_for_user(crew, uid)
                if not role_key:
                    await interaction.response.send_message("You do not currently hold a crew role on this flight.", ephemeral=True)
                    return
                await interaction.response.send_modal(CrewRemovalRequestModal(code))
                return

            values = interaction.data.get("values", [])
            role   = values[0] if values else None

            if not role or role == "none":
                await interaction.response.send_message("No role selected.", ephemeral=True)
                return

            cfg = CREW_SLOTS.get(role)
            if not cfg:
                await interaction.response.send_message("Unknown role.", ephemeral=True)
                return

            if action == "claim":
                # Verify user has the required Discord role
                required_role = cfg.get("required_role")
                if required_role:
                    member_roles = [r.id for r in interaction.user.roles]
                    if required_role not in member_roles:
                        role_name = cfg["label"]
                        await interaction.response.send_message(
                            f"You do not have the required role to sign up as **{role_name}**.",
                            ephemeral=True
                        )
                        return

                # Enforce one role per person — check if already in any role
                for rk, rv in crew.items():
                    if rk in ("thread_id", "message_id"):
                        continue
                    if isinstance(rv, list) and uid in rv:
                        await interaction.response.send_message(
                            f"You already have the **{CREW_SLOTS.get(rk, {}).get('label', rk)}** role. Unclaim it first.",
                            ephemeral=True
                        )
                        return
                    elif rv == uid:
                        await interaction.response.send_message(
                            f"You already have the **{CREW_SLOTS.get(rk, {}).get('label', rk)}** role. Unclaim it first.",
                            ephemeral=True
                        )
                        return

                current = crew.get(role)
                if isinstance(current, list):
                    if cfg["max"] is not None and len(current) >= cfg["max"]:
                        await interaction.response.send_message(f"**{cfg['label']}** is full.", ephemeral=True)
                        return
                    current.append(uid)
                    crew[role] = current
                else:
                    if current is not None:
                        await interaction.response.send_message(f"**{cfg['label']}** is already taken.", ephemeral=True)
                        return
                    crew[role] = uid
                await interaction.response.send_message(f"You signed up as **{cfg['label']}** on {entry['flight_number']}.", ephemeral=True)
            else:
                await interaction.response.send_message("Unknown crew action.", ephemeral=True)
                return

            entry["crew"] = crew
            user_data[code] = entry
            await save_user_data(user_trigger_desc=f"Crew signup updated for {code}")

            # Update the signup message
            await _refresh_crew_signup_message(code, entry)

    @app.get("/api/flights/{code}/crew")
    async def get_crew(code: str, request: Request):
        require_auth(request)
        code = code.upper()
        if code not in user_data or "flight_number" not in user_data[code]:
            raise HTTPException(status_code=404, detail="Flight not found")
        entry = user_data[code]
        crew  = entry.get("crew", {})
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        def resolve(uid):
            if not uid or not g: return {"id": uid, "name": str(uid)}
            m = g.get_member(int(uid)) if uid else None
            return {"id": uid, "name": m.display_name if m else str(uid)}
        return {
            "pilot":   resolve(crew.get("pilot")),
            "copilot": resolve(crew.get("copilot")),
            "cc":      [resolve(u) for u in crew.get("cc", [])],
            "gc":      [resolve(u) for u in crew.get("gc", [])],
            "backup":  [resolve(u) for u in crew.get("backup", [])],
            "thread_id":  crew.get("thread_id"),
            "message_id": crew.get("message_id"),
        }

    @app.get("/api/crew-removal-requests")
    async def get_crew_removal_requests(request: Request):
        session = require_auth(request)
        requests_dict = user_data.get("__crew_removal_requests__", {})
        visible = {}
        for req_id, item in requests_dict.items():
            flight_code = str(item.get("flight_code", "")).upper()
            entry = user_data.get(flight_code)
            if not isinstance(entry, dict) or "flight_number" not in entry:
                continue
            if not _can_review_crew_removal_request(session, entry):
                continue
            enriched = dict(item)
            enriched["host_user_id"] = str(entry.get("host_user_id", "")).strip()
            visible[req_id] = enriched
        return {"requests": visible}

    @app.get("/api/crew-management")
    async def get_crew_management(request: Request):
        session = require_auth(request)
        requests_dict = user_data.get("__crew_removal_requests__", {})
        flights = []

        for code, entry in user_data.items():
            if not isinstance(entry, dict) or "flight_number" not in entry:
                continue
            if not _can_manage_flight_crew(session, entry):
                continue

            flight_requests = []
            for req_id, item in requests_dict.items():
                if str(item.get("flight_code", "")).upper() != str(code).upper():
                    continue
                enriched = dict(item)
                enriched["request_id"] = req_id
                flight_requests.append(enriched)

            if entry.get("status") in ("Ended", "Cancelled") and not flight_requests:
                continue

            flight_requests.sort(
                key=lambda r: (
                    0 if r.get("status") == "pending" else 1,
                    str(r.get("submitted_at", "")),
                )
            )

            flights.append({
                "code": str(code).upper(),
                "flight_number": entry.get("flight_number", ""),
                "status": entry.get("status", "N/A"),
                "dep_date": entry.get("dep_date", ""),
                "dep_city": entry.get("dep_city", ""),
                "dep_code": entry.get("dep_code", ""),
                "arr_city": entry.get("arr_city", ""),
                "arr_code": entry.get("arr_code", ""),
                "host_user_id": str(entry.get("host_user_id", "")).strip(),
                "can_change_host": bool(session.get("is_manager") or session.get("is_bod") or session.get("is_owner")),
                "crew": _serialize_crew_for_dashboard(entry),
                "requests": flight_requests,
            })

        flights.sort(key=lambda f: (f.get("dep_date", ""), f.get("flight_number", ""), f.get("code", "")))
        return {"flights": flights}

    @app.patch("/api/flights/{code}/host")
    async def change_flight_host(code: str, request: Request):
        session = require_manager(request)
        code = code.upper()
        entry = user_data.get(code)
        if not isinstance(entry, dict) or "flight_number" not in entry:
            raise HTTPException(status_code=404, detail="Flight not found")
        body = await request.json()
        new_host = str(body.get("host_user_id", "")).strip()
        if not new_host.isdigit():
            raise HTTPException(status_code=422, detail="Select a valid Discord member")
        guild = bot.get_guild(GUILD_ID)
        member = guild.get_member(int(new_host)) if guild else None
        if not member:
            raise HTTPException(status_code=404, detail="Member not found in the configured server")
        old_host = str(entry.get("host_user_id", "")).strip()
        entry["host_user_id"] = new_host
        entry["cohosts"] = [str(uid) for uid in entry.get("cohosts", []) if str(uid) != new_host]
        await save_user_data(user_trigger_desc=f"Host changed for {code}")
        await _refresh_crew_signup_message(code, entry)
        reviewer = session.get("username", "manager") if isinstance(session, dict) else "manager"
        log_to_file(f"Flight {code} host changed from {old_host or 'none'} to {new_host}", user=reviewer, level="warn")
        return {"ok": True, "code": code, "host_user_id": new_host, "host_name": member.display_name}

    @app.get("/api/crew-members")
    async def get_crew_members(request: Request):
        require_auth(request)
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if not g:
            return {"members": []}
        members = []
        for m in g.members:
            if m.bot:
                continue
            role_ids = [r.id for r in m.roles]
            members.append({
                "user_id": str(m.id),
                "username": m.display_name or m.name,
                "avatar": str(m.display_avatar.url) if m.display_avatar else "",
                "is_hoster": bool(HOSTER_ROLE and HOSTER_ROLE in role_ids) or bool(FOM_ROLE and FOM_ROLE in role_ids) or bool(MANAGER_ROLE and MANAGER_ROLE in role_ids) or bool(BOD_ROLE and BOD_ROLE in role_ids) or m.id == OWNER_ID,
                "is_interest": bool(INTEREST_ROLE and INTEREST_ROLE in role_ids),
            })
        members.sort(key=lambda x: x.get("username", "").lower())
        return {"members": members}

    @app.post("/api/crew-removal-requests/{req_id}/approve")
    async def approve_crew_removal_request(req_id: str, request: Request):
        session = require_auth(request)
        requests_dict = user_data.get("__crew_removal_requests__", {})
        item = requests_dict.get(req_id)
        if not item:
            raise HTTPException(status_code=404, detail="Removal request not found")
        flight_code = str(item.get("flight_code", "")).upper()
        entry = user_data.get(flight_code)
        if not isinstance(entry, dict) or "flight_number" not in entry:
            raise HTTPException(status_code=404, detail="Flight not found")
        if not _can_review_crew_removal_request(session, entry):
            raise HTTPException(status_code=403, detail="You cannot review removal requests for this flight")
        if item.get("status") != "pending":
            raise HTTPException(status_code=409, detail="This removal request has already been processed")

        crew = entry.setdefault("crew", {})
        requester_id = str(item.get("requester_id", "")).strip()
        role = str(item.get("role", "")).strip()
        removed = _remove_user_from_crew_role(crew, role, requester_id)
        entry["crew"] = crew
        user_data[flight_code] = entry

        reviewer = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        item["status"] = "approved"
        item["reviewed_at"] = utc_iso_z()
        item["reviewed_by"] = reviewer
        item["review_action"] = "removed" if removed else "already_not_assigned"
        requests_dict[req_id] = item
        user_data["__crew_removal_requests__"] = requests_dict

        await save_user_data(user_trigger_desc=f"Crew removal request approved for {flight_code}")
        await _refresh_crew_signup_message(flight_code, entry)
        log_to_file(
            f"Crew removal approved for {flight_code}: {item.get('requester_name', requester_id)} removed from {item.get('role_label', role)}",
            user=reviewer,
            level="warn",
        )
        return {"ok": True, "removed": removed, "request": item}

    @app.post("/api/crew-removal-requests/{req_id}/deny")
    async def deny_crew_removal_request(req_id: str, request: Request):
        session = require_auth(request)
        requests_dict = user_data.get("__crew_removal_requests__", {})
        item = requests_dict.get(req_id)
        if not item:
            raise HTTPException(status_code=404, detail="Removal request not found")
        flight_code = str(item.get("flight_code", "")).upper()
        entry = user_data.get(flight_code)
        if not isinstance(entry, dict) or "flight_number" not in entry:
            raise HTTPException(status_code=404, detail="Flight not found")
        if not _can_review_crew_removal_request(session, entry):
            raise HTTPException(status_code=403, detail="You cannot review removal requests for this flight")
        if item.get("status") != "pending":
            raise HTTPException(status_code=409, detail="This removal request has already been processed")

        body = await request.json()
        denial_note = str(body.get("note", "")).strip()
        reviewer = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        item["status"] = "denied"
        item["reviewed_at"] = utc_iso_z()
        item["reviewed_by"] = reviewer
        item["denial_note"] = denial_note
        requests_dict[req_id] = item
        user_data["__crew_removal_requests__"] = requests_dict

        await save_user_data(user_trigger_desc=f"Crew removal request denied for {flight_code}")
        log_to_file(
            f"Crew removal denied for {flight_code}: {item.get('requester_name', item.get('requester_id', 'unknown'))} on {item.get('role_label', item.get('role', 'role'))}",
            user=reviewer,
            level="info",
        )
        return {"ok": True, "request": item}

    @app.post("/api/flights/{code}/crew")
    async def update_crew_mgr(code: str, request: Request):
        session = require_auth(request)
        code = code.upper()
        if code not in user_data or "flight_number" not in user_data[code]:
            raise HTTPException(status_code=404, detail="Flight not found")
        body  = await request.json()
        entry = user_data[code]
        if not _can_manage_flight_crew(session, entry):
            raise HTTPException(status_code=403, detail="You cannot manage crew for this flight")
        crew  = entry.setdefault("crew", {})
        role   = body.get("role")
        action = body.get("action")
        uid    = str(body.get("user_id", "")).strip()
        if role not in CREW_SLOTS or not uid:
            raise HTTPException(status_code=422, detail="Invalid role or user_id")
        if action == "assign":
            existing_role, _existing_cfg = _find_crew_role_for_user(crew, uid)
            if existing_role and existing_role != role:
                raise HTTPException(status_code=409, detail=f"User already assigned to {CREW_SLOTS.get(existing_role, {}).get('label', existing_role)}")
            current = crew.get(role)
            if isinstance(current, list):
                if uid not in current:
                    current.append(uid)
                crew[role] = current
            else:
                crew[role] = uid
        elif action == "remove":
            current = crew.get(role)
            if isinstance(current, list):
                crew[role] = [u for u in current if u != uid]
            else:
                if current == uid:
                    crew[role] = None
        else:
            raise HTTPException(status_code=422, detail="action must be assign or remove")
        entry["crew"] = crew
        user_data[code] = entry
        await save_user_data(user_trigger_desc=f"Crew manually updated for {code}")
        await _refresh_crew_signup_message(code, entry)
        return {"ok": True}

    @app.post("/api/post-flight-board")
    async def manual_post_flight_board(request: Request):
        """Manually post or refresh the flight board for a given date. Owner only."""
        from auth import require_owner
        require_owner(request)
        body = await request.json()
        date_str = body.get("date", "").strip()  # YYYY-MM-DD or blank = today

        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if not g:
            raise HTTPException(status_code=503, detail="Bot not in guild")

        # Convert date
        try:
            if date_str:
                dt = datetime.strptime(date_str, "%Y-%m-%d")
            else:
                dt = datetime.now(timezone.utc)
            date_raw = dt.strftime("%d%m%Y")
        except Exception:
            raise HTTPException(status_code=422, detail="Invalid date format (use YYYY-MM-DD)")

        public_ch = g.get_channel(PUBLIC_CHANNEL_ID)
        if not public_ch:
            raise HTTPException(status_code=503, detail="Public channel not found — check PUBLIC_CHANNEL_ID in config")

        # Build the board for that date (bypass today-only restriction)
        flights_for_date = [
            (code, entry) for code, entry in user_data.items()
            if isinstance(entry, dict) and "flight_number" in entry
            and entry.get("dep_date") == date_raw
            and entry.get("status") not in ("Cancelled",)
        ]
        flights_for_date.sort(key=lambda item: item[1].get("dep_time", ""))

        if not flights_for_date:
            raise HTTPException(status_code=404, detail=f"No flights found for {dt.strftime('%Y-%m-%d')}")

        embed = build_day_embed(date_raw, flights_for_date)
        view = DayScheduleView(flights_for_date, date_raw=date_raw)

        # Check if we already have a message for this date
        day_msgs = user_data.get("_day_msgs", {})
        existing_msg_id = day_msgs.get(date_raw)

        try:
            if existing_msg_id:
                try:
                    msg = await public_ch.fetch_message(int(existing_msg_id))
                    await msg.edit(embed=embed, view=view)
                    log_to_file(f"Flight board manually refreshed for {dt.strftime('%Y-%m-%d')}", level="ok")
                    return {"ok": True, "action": "updated", "message_id": existing_msg_id}
                except discord.NotFound:
                    pass  # message deleted, post new one

            msg = await public_ch.send(embed=embed, view=view)
            day_msgs[date_raw] = str(msg.id)
            user_data["_day_msgs"] = day_msgs
            await save_user_data(user_trigger_desc=f"Flight board manually posted for {dt.strftime('%Y-%m-%d')}")
            log_to_file(f"Flight board manually posted for {dt.strftime('%Y-%m-%d')}", level="ok")
            return {"ok": True, "action": "posted", "message_id": str(msg.id)}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # ── All guild channels ────────────────────────────────────────────────────
    @app.get("/api/channels")
    async def get_guild_channels(request: Request):
        """Return all text channels in the target guild, sorted by position."""
        from auth import require_owner
        require_owner(request)
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if not g:
            raise HTTPException(status_code=503, detail="Bot not in guild")
        channels = []
        for c in sorted(g.channels, key=lambda c: (getattr(c, 'position', 999))):
            if isinstance(c, discord.TextChannel):
                cat = c.category.name if c.category else "Uncategorized"
                channels.append({"id": str(c.id), "name": c.name, "category": cat})
        return {"channels": channels}

    # ── Inactive host radar ───────────────────────────────────────────────────
    @app.get("/api/inactive-hosts")
    async def get_inactive_hosts(request: Request):
        """Return hosts who haven't flown in N days (configurable via owner-settings)."""
        from auth import require_owner
        require_owner(request)

        settings  = user_data.get("__owner_settings__", {})
        threshold = int(settings.get("nudge_threshold_days", 14))
        now       = datetime.now(timezone.utc).replace(tzinfo=None)
        real      = get_real_flights()

        # Build map: host_user_id → most recent dep_date
        last_flight: dict = {}
        for entry in real.values():
            hid  = str(entry.get("host_user_id", "")).strip()
            date = entry.get("dep_date", "")
            if not hid or not date:
                continue
            try:
                dt = datetime.strptime(date, "%d%m%Y")
            except Exception:
                continue
            if hid not in last_flight or dt > last_flight[hid]["dt"]:
                last_flight[hid] = {
                    "dt":            dt,
                    "date_display":  dt.strftime("%Y-%m-%d"),
                    "flight_number": entry.get("flight_number", ""),
                    "dep_code":      entry.get("dep_code", ""),
                    "arr_code":      entry.get("arr_code", ""),
                }

        # Fetch host list from Discord
        bot_token = TOKEN
        members   = []
        after     = 0
        async with httpx.AsyncClient() as client:
            while True:
                params = {"limit": 1000}
                if after:
                    params["after"] = after
                resp = await client.get(
                    f"https://discord.com/api/v10/guilds/{GUILD_ID}/members",
                    headers={"Authorization": f"Bot {bot_token}"},
                    params=params,
                )
                if resp.status_code != 200:
                    break
                batch = resp.json()
                if not batch:
                    break
                for m in batch:
                    role_ids = [str(r) for r in m.get("roles", [])]
                    if str(HOSTER_ROLE) in role_ids:
                        u   = m.get("user", {})
                        uid = str(u.get("id", ""))
                        av  = u.get("avatar")
                        avatar_url = (
                            f"https://cdn.discordapp.com/avatars/{uid}/{av}.png"
                            if av else
                            f"https://cdn.discordapp.com/embed/avatars/{int(u.get('discriminator',0) or 0) % 5}.png"
                        )
                        members.append({
                            "user_id":  uid,
                            "username": m.get("nick") or u.get("global_name") or u.get("username", "Unknown"),
                            "avatar":   avatar_url,
                        })
                if len(batch) < 1000:
                    break
                after = batch[-1]["user"]["id"]

        inactive = []
        for m in members:
            uid = m["user_id"]
            if uid in last_flight:
                info = last_flight[uid]
                days = (now - info["dt"]).days
                if days >= threshold:
                    inactive.append({
                        **m,
                        "days_inactive":   days,
                        "last_flight_date": info["date_display"],
                        "last_flight_num":  info["flight_number"],
                        "last_route":       f"{info['dep_code']}→{info['arr_code']}" if info["dep_code"] else "",
                    })
            else:
                # Never flown — treat as maximally inactive
                inactive.append({
                    **m,
                    "days_inactive":    9999,
                    "last_flight_date": None,
                    "last_flight_num":  None,
                    "last_route":       None,
                })

        inactive.sort(key=lambda x: x["days_inactive"], reverse=True)
        return {"threshold_days": threshold, "inactive": inactive}

    # ── Nudge (DM a host) ─────────────────────────────────────────────────────
    @app.get("/api/nudge-log")
    async def get_nudge_log(request: Request):
        require_manager(request)
        log = user_data.get("__nudge_log__", {})
        return {"log": log}


    @app.post("/api/nudge/{user_id}")
    async def nudge_host(user_id: str, request: Request):
        """Send a DM to a host via the bot. Owner-only."""
        from auth import require_owner
        session = require_owner(request)
        body    = await request.json()

        settings = user_data.get("__owner_settings__", {})
        template = body.get("message") or settings.get("nudge_message") or _OWNER_SETTINGS_DEFAULTS["nudge_message"]
        footer   = settings.get("nudge_dm_footer") or _OWNER_SETTINGS_DEFAULTS["nudge_dm_footer"]
        username = body.get("username", "")

        # Substitute placeholders
        message = template.replace("{username}", username or "there")
        if footer:
            message = message + "\n\n" + footer

        try:
            member = await bot.get_guild(GUILD_ID).fetch_member(int(user_id))
            dm     = await member.create_dm()
            await dm.send(message)
        except discord.NotFound:
            raise HTTPException(status_code=404, detail="User not found in guild")
        except discord.Forbidden:
            raise HTTPException(status_code=403, detail="Cannot DM this user (DMs disabled or not in server)")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        session_username = session.get("username", "Owner") if isinstance(session, dict) else "Owner"
        log_to_file(f"Nudge DM sent to {username} ({user_id})", user=session_username, level="ok")

        # Track nudge timestamp so the UI can show "last nudged"
        nudge_log = user_data.get("__nudge_log__", {})
        nudge_log[user_id] = datetime.now(timezone.utc).isoformat() + "Z"
        user_data["__nudge_log__"] = nudge_log
        await save_user_data(user_trigger_desc=f"Nudge sent to {username}")

        return {"sent": True, "to": username or user_id}

    # ── Activity Feed ─────────────────────────────────────────────────────────
    @app.get("/api/activity-feed")
    async def get_activity_feed(request: Request):
        """Return last 5 messages from log + announce + public channels."""
        require_auth(request)
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if not g:
            raise HTTPException(status_code=503, detail="Bot not in guild")

        channel_ids = [
            (LOG_CHANNEL_ID,     "log"),
            (ANNOUNCE_CHANNEL_ID,"announce"),
            (PUBLIC_CHANNEL_ID,  "public"),
        ]
        messages = []
        for cid, cname in channel_ids:
            ch = g.get_channel(cid)
            if not ch:
                continue
            try:
                async for msg in ch.history(limit=5):
                    content = msg.content or ""
                    if not content and msg.embeds:
                        content = msg.embeds[0].description or msg.embeds[0].title or "[embed]"
                    messages.append({
                        "channel":      cname,
                        "channel_name": ch.name,
                        "author":       str(msg.author),
                        "content":      content,
                        "timestamp":    msg.created_at.isoformat() + "Z",
                    })
            except Exception:
                pass

        # Sort newest first, take top 8
        messages.sort(key=lambda m: m["timestamp"], reverse=True)
        return {"messages": messages[:8]}

    # ── Send message as bot ────────────────────────────────────────────────────
    @app.post("/api/bot-send")
    async def bot_send_message(request: Request):
        """Owner-only: send a freeform message to a chosen channel as the bot."""
        session = require_auth(request)
        if not getattr(session, "get", lambda k, d=None: None)("is_owner", False):
            # Also check via is_owner flag in session dict
            if not (isinstance(session, dict) and session.get("is_owner")):
                raise HTTPException(status_code=403, detail="Owner only")
        body    = await request.json()
        message = (body.get("message") or "").strip()
        channel_key = (body.get("channel") or "announce").strip()
        if not message:
            raise HTTPException(status_code=422, detail="Message is required")

        channel_map = {
            "announce": ANNOUNCE_CHANNEL_ID,
            "public":   PUBLIC_CHANNEL_ID,
            "log":      LOG_CHANNEL_ID,
            "events":   EVENTS_CHANNEL_ID,
        }
        # Accept either a named key OR a raw numeric channel ID
        if channel_key.isdigit():
            cid = int(channel_key)
        else:
            cid = channel_map.get(channel_key, ANNOUNCE_CHANNEL_ID)
        g   = discord.utils.get(bot.guilds, id=GUILD_ID)
        if not g:
            raise HTTPException(status_code=503, detail="Bot not in guild")
        ch = g.get_channel(cid)
        if not ch:
            raise HTTPException(status_code=404, detail=f"Channel not found (id={cid})")

        await ch.send(message)
        session_username = session.get("username", "Owner") if isinstance(session, dict) else "Owner"
        log_to_file(f"Bot-send to #{ch.name}: {message[:80]}", user=session_username, level="ok")
        return {"sent": True, "channel": ch.name}

    # ── Presence / status override ────────────────────────────────────────────
    @app.post("/api/presence/status")
    async def set_presence_status(request: Request):
        """Set the bot's online status dot (online/idle/dnd/invisible)."""
        session = require_auth(request)
        body    = await request.json()
        status_str = (body.get("status") or "online").lower()
        STATUS_MAP = {
            "online":    discord.Status.online,
            "idle":      discord.Status.idle,
            "dnd":       discord.Status.dnd,
            "invisible": discord.Status.invisible,
        }
        dstatus = STATUS_MAP.get(status_str, discord.Status.online)
        presence_cfg = user_data.get("__presence__", {})
        ptext = presence_cfg.get("text", "")
        ptype = presence_cfg.get("type", "playing")
        PRESENCE_TYPES = {
            "playing":   discord.ActivityType.playing,
            "watching":  discord.ActivityType.watching,
            "listening": discord.ActivityType.listening,
        }
        activity = discord.Activity(type=PRESENCE_TYPES.get(ptype, discord.ActivityType.playing), name=ptext) if ptext else None
        await bot.change_presence(activity=activity, status=dstatus)
        session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        log_to_file(f"Bot status set to {status_str}", user=session_username, level="ok")
        return {"status": status_str}

    # ── Presence rotation ─────────────────────────────────────────────────────
    @app.get("/api/presence/rotation")
    async def get_presence_rotation(request: Request):
        require_auth(request)
        cfg = user_data.get("__presence_rotation__", {"slots": [], "interval_minutes": 5})
        return cfg

    @app.post("/api/presence/rotation")
    async def set_presence_rotation(request: Request):
        session = require_auth(request)
        body = await request.json()
        slots    = [s.strip() for s in (body.get("slots") or []) if s.strip()][:5]
        interval = max(1, min(60, int(body.get("interval_minutes") or 5)))
        enabled  = bool(body.get("enabled", False))
        user_data["__presence_rotation__"] = {"slots": slots, "interval_minutes": interval, "enabled": enabled}
        await save_user_data(user_trigger_desc="Presence rotation updated")
        # Apply immediately
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if enabled and slots:
            try:
                type_str, _, text = slots[0].partition(":")
                atype = {
                    "watching":    discord.ActivityType.watching,
                    "listening":   discord.ActivityType.listening,
                    "playing":     discord.ActivityType.playing,
                    "competing":   discord.ActivityType.competing,
                }.get(type_str.lower(), discord.ActivityType.watching)
                await bot.change_presence(activity=discord.Activity(type=atype, name=text.strip()))
            except Exception as e:
                safe_console_print(f"Rotation apply error: {e}")
        else:
            # Restore static presence if rotation disabled
            pres = user_data.get("__presence__", {})
            if pres.get("text"):
                try:
                    type_str = pres.get("type", "watching")
                    atype = {
                        "watching":    discord.ActivityType.watching,
                        "listening":   discord.ActivityType.listening,
                        "playing":     discord.ActivityType.playing,
                        "competing":   discord.ActivityType.competing,
                    }.get(type_str.lower(), discord.ActivityType.watching)
                    status = discord.Status.online if pres.get("enabled", True) else discord.Status.invisible
                    await bot.change_presence(status=status, activity=discord.Activity(type=atype, name=pres["text"]))
                except Exception as e:
                    safe_console_print(f"Static presence restore error: {e}")
        return user_data["__presence_rotation__"]

    # ── System Health Check ───────────────────────────────────────────────────

    @app.get("/api/healthcheck")
    async def full_healthcheck(request: Request):
        """Owner-only comprehensive system health check."""
        from auth import require_owner, get_session as _gs
        require_owner(request)
        import time as _time
        import os as _os
        import platform as _platform
        import sys as _sys

        R = {}  # results dict
        now = datetime.now(timezone.utc)
        t0 = _time.monotonic()

        def ok(detail, **kw):  return {"ok": True,  "detail": detail, **kw}
        def err(detail, **kw): return {"ok": False, "detail": detail, **kw}

        # ── 1. Bot connection ───────────────────────────────────────────────
        try:
            ready     = bot.is_ready()
            closed    = bot.is_closed()
            lat_ms    = round(bot.latency * 1000, 1) if ready else None
            R["bot_connection"] = {
                "ok": ready and not closed,
                "detail": f"{lat_ms}ms" if ready else "Not ready",
                "latency_ms": lat_ms,
                "is_ready":   ready,
                "is_closed":  closed,
                "user":       str(bot.user) if bot.user else None,
                "bot_id":     str(bot.user.id) if bot.user else None,
            }
        except Exception as e:
            R["bot_connection"] = err(str(e))

        # ── 2. Guild ────────────────────────────────────────────────────────
        g = None
        try:
            g = discord.utils.get(bot.guilds, id=GUILD_ID)
            if g:
                R["guild"] = ok(
                    f"{g.name}",
                    member_count=None,
                    human_count=None,
                    bot_count=None,
                    online_count=None,
                    guild_id=str(g.id),
                    owner_id=str(g.owner_id) if g.owner_id else None,
                    created_at=str(g.created_at)[:10],
                    icon=str(g.icon.url) if g.icon else None,
                    boost_level=g.premium_tier,
                    boost_count=g.premium_subscription_count,
                )
            else:
                R["guild"] = err(f"Guild {GUILD_ID} not in bot's guilds")
        except Exception as e:
            R["guild"] = err(str(e))

        # ── 3. Bot permissions in guild ─────────────────────────────────────
        try:
            if g:
                me = g.me
                perms = me.guild_permissions
                missing = [p for p in ["manage_roles","send_messages","embed_links","read_message_history","mention_everyone"] if not getattr(perms, p, False)]
                R["bot_permissions"] = {
                    "ok": len(missing) == 0,
                    "detail": "All key perms granted" if not missing else f"Missing: {', '.join(missing)}",
                    "manage_roles":          perms.manage_roles,
                    "send_messages":         perms.send_messages,
                    "embed_links":           perms.embed_links,
                    "read_message_history":  perms.read_message_history,
                    "mention_everyone":      perms.mention_everyone,
                    "manage_messages":       perms.manage_messages,
                    "administrator":         perms.administrator,
                    "missing": missing,
                }
            else:
                R["bot_permissions"] = err("Guild unavailable")
        except Exception as e:
            R["bot_permissions"] = err(str(e))

        # ── 4–7. Channel checks ─────────────────────────────────────────────
        def ch_check(cid, label):
            if not cid:
                return {"ok": None, "detail": "Not configured", "configured": False}
            if not g:
                return err("Guild unavailable")
            try:
                ch = g.get_channel(cid)
                if not ch:
                    return err(f"ID {cid} not found in guild")
                perms = ch.permissions_for(g.me)
                missing = []
                if not perms.send_messages:  missing.append("send_messages")
                if not perms.embed_links:    missing.append("embed_links")
                if not perms.view_channel:   missing.append("view_channel")
                return {
                    "ok":           len(missing) == 0,
                    "detail":       f"#{ch.name}" + (f" — missing: {', '.join(missing)}" if missing else ""),
                    "channel_name": ch.name,
                    "channel_id":   str(ch.id),
                    "configured":   True,
                    "send_messages": perms.send_messages,
                    "embed_links":   perms.embed_links,
                    "view_channel":  perms.view_channel,
                    "missing_perms": missing,
                }
            except Exception as e:
                return err(str(e))

        R["channel_public"]   = ch_check(PUBLIC_CHANNEL_ID,   "public")
        R["channel_announce"] = ch_check(ANNOUNCE_CHANNEL_ID, "announce")
        R["channel_log"]      = ch_check(LOG_CHANNEL_ID,      "log")
        R["channel_events"]   = ch_check(EVENTS_CHANNEL_ID,   "events")

        # ── 8–12. Role checks ───────────────────────────────────────────────
        def role_check(rid, label):
            if not rid:
                return {"ok": None, "detail": "Not configured", "configured": False}
            if not g:
                return err("Guild unavailable")
            try:
                role = g.get_role(rid)
                if not role:
                    return err(f"Role ID {rid} not found in guild")
                hoistable = role.hoist
                mentionable = role.mentionable
                return ok(
                    f"@{role.name} ({len(role.members)} members)",
                    role_name=role.name,
                    role_id=str(role.id),
                    member_count=len(role.members),
                    configured=True,
                    hoistable=hoistable,
                    mentionable=mentionable,
                    color=str(role.color),
                )
            except Exception as e:
                return err(str(e))

        R["role_hoster"]   = role_check(HOSTER_ROLE,   "hoster")
        R["role_manager"]  = role_check(MANAGER_ROLE,  "manager")
        R["role_bod"]      = role_check(BOD_ROLE,       "bod")
        R["role_interest"] = role_check(INTEREST_ROLE, "interest")
        R["role_flight_notify"] = role_check(FLIGHT_NOTIFY_ROLE, "flight notification")
        R["role_flight_start"] = role_check(FLIGHT_START_ROLE, "flight start")
        R["role_events_interest"] = role_check(EVENTS_INTEREST_ROLE, "events_interest")

        # ── 13. Background tasks ────────────────────────────────────────────
        task_map = {
            "track_latency":              track_latency,
            "auto_reminder_flights":      auto_reminder_flights,
            "post_daily_schedule":        post_daily_schedule,
            "auto_end_flights":           auto_end_flights,
            "cleanup_old_day_messages":   cleanup_old_day_messages,
            "post_weekly_monthly_report": post_weekly_monthly_report,
            "weekly_quota_review":        weekly_quota_review,
            "monthly_quota_reimbursement": monthly_quota_reimbursement,
            "rotate_presence":            rotate_presence,
            "cleanup_crew_threads":       cleanup_crew_threads,
        }
        tasks_detail = {}
        for name, task in task_map.items():
            try:
                running  = task.is_running()
                last     = _task_last_fired.get(name)
                enabled  = _feature_flags.get(name, True)
                nxt      = str(task.next_iteration)[:19] if running and task.next_iteration else None
                tasks_detail[name] = {
                    "ok":         running or not enabled,
                    "running":    running,
                    "enabled":    enabled,
                    "last_fired": last,
                    "next_run":   nxt,
                    "detail":     ("Disabled" if not enabled else f"Running — last: {last or 'never'}" if running else "NOT RUNNING"),
                }
            except Exception as e:
                tasks_detail[name] = err(str(e))
        all_tasks_ok = all(v.get("ok") for v in tasks_detail.values())
        R["background_tasks"] = {
            "ok":     all_tasks_ok,
            "detail": "All tasks running" if all_tasks_ok else "Some tasks not running",
            "tasks":  tasks_detail,
        }

        # ── 14. Flight data ─────────────────────────────────────────────────
        try:
            flights = get_real_flights()
            all_f   = list(flights.values())
            active  = [f for f in all_f if f.get("status") not in ("Ended","Cancelled")]
            ended   = [f for f in all_f if f.get("status") == "Ended"]
            cancelled = [f for f in all_f if f.get("status") == "Cancelled"]
            no_host = [f.get("flight_number","?") for f in active if not f.get("host_user_id")]
            today   = now.strftime("%Y-%m-%d")
            today_flights = [f for f in active if f.get("dep_date","") == today]
            future  = [f for f in active if f.get("dep_date","") > today]
            R["flights"] = {
                "ok":     len(no_host) == 0,
                "detail": f"{len(active)} active, {len(ended)} ended, {len(cancelled)} cancelled",
                "total":       len(all_f),
                "active":      len(active),
                "ended":       len(ended),
                "cancelled":   len(cancelled),
                "today":       len(today_flights),
                "upcoming":    len(future),
                "missing_host": no_host,
            }
        except Exception as e:
            R["flights"] = err(str(e))

        # ── 15. Events ──────────────────────────────────────────────────────
        try:
            events = user_data.get("__events__", {})
            ev_list = list(events.values())
            upcoming_ev = [e for e in ev_list if e.get("date","") >= now.strftime("%Y-%m-%d")]
            R["events"] = ok(
                f"{len(ev_list)} total, {len(upcoming_ev)} upcoming",
                total=len(ev_list),
                upcoming=len(upcoming_ev),
            )
        except Exception as e:
            R["events"] = err(str(e))

        # ── 16. Data store ──────────────────────────────────────────────────
        try:
            suspensions   = user_data.get("__suspensions__", {})
            blackout      = user_data.get("__blackout__", [])
            blocklist     = user_data.get("__blocklist__", [])
            nudge_log     = user_data.get("__nudge_log__", {})
            day_msgs      = user_data.get("_day_msgs", {})
            owner_settings = user_data.get("__owner_settings__", {})
            presence      = user_data.get("__presence__", {})
            rotation      = user_data.get("__presence_rotation__", {})
            config        = user_data.get("__config__", {})

            R["data_store"] = ok(
                f"SQLite {SQLITE_DB_PATH}",
                db_path=SQLITE_DB_PATH,
                suspensions=len(suspensions),
                blackout_dates=len(blackout),
                blocklist=len(blocklist),
                nudge_log_entries=len(nudge_log),
                day_messages_cached=len(day_msgs),
                owner_settings_keys=len(owner_settings),
                presence_configured=bool(presence.get("text")),
                rotation_enabled=bool(rotation.get("enabled")),
                rotation_slots=len(rotation.get("slots", [])),
            )
        except Exception as e:
            R["data_store"] = err(str(e))

        # ── 17. Active sessions ─────────────────────────────────────────────
        try:
            from auth import _active_sessions, _blocklist as _bl
            import time as _t2
            now_ts = int(_t2.time())
            sessions = list(_active_sessions.values())
            stale = [s for s in sessions if now_ts - s.get("last_seen", now_ts) > 3600]
            R["sessions"] = ok(
                f"{len(sessions)} active session(s)",
                total=len(sessions),
                stale_1h=len(stale),
                blocked=len(_bl),
                users=[{"user_id": s.get("user_id"), "username": s.get("username","?"), "role": s.get("role","?"), "idle_min": round((now_ts - s.get("last_seen", now_ts))/60)} for s in sessions],
            )
        except Exception as e:
            R["sessions"] = err(str(e))

        # ── 18. Log file ─────────────────────────────────────────────────────
        try:
            log_exists = _os.path.exists(LOG_FILE)
            log_size   = round(_os.path.getsize(LOG_FILE) / 1024, 1) if log_exists else 0
            log_lines  = 0
            errors_1h  = 0
            last_entry = None
            if log_exists:
                cutoff = (now - timedelta(hours=1)).isoformat()
                with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as _lf:
                    for ln in _lf:
                        ln = ln.strip()
                        if not ln.startswith("{"): continue
                        log_lines += 1
                        try:
                            obj = json.loads(ln)
                            last_entry = obj.get("timestamp") or obj.get("ts")
                            if (obj.get("timestamp","") or "") > cutoff:
                                if obj.get("level","").lower() in ("error","critical") or "error" in (obj.get("action","").lower()):
                                    errors_1h += 1
                        except Exception:
                            pass
            R["log_file"] = {
                "ok":       log_exists,
                "detail":   f"{log_size}KB, {log_lines} entries" if log_exists else "File not found",
                "exists":   log_exists,
                "size_kb":  log_size,
                "entries":  log_lines,
                "errors_1h": errors_1h,
                "last_entry": last_entry,
                "path":     LOG_FILE,
            }
        except Exception as e:
            R["log_file"] = err(str(e))

        # ── 19. Bot presence state ──────────────────────────────────────────
        try:
            pres = user_data.get("__presence__", {})
            rot  = user_data.get("__presence_rotation__", {})
            if rot.get("enabled") and rot.get("slots"):
                mode   = "rotation"
                detail = f"Rotation ON — {len(rot['slots'])} slots every {rot.get('interval_minutes',5)}min"
            elif pres.get("text"):
                mode   = "static"
                detail = f"Static: {pres.get('type','watching')} '{pres.get('text','')}'  ({'enabled' if pres.get('enabled',True) else 'DISABLED'})"
            else:
                mode   = "none"
                detail = "No presence configured"
            current_activity = str(bot.activity) if bot.activity else "None"
            current_status   = str(bot.status)   if bot.status   else "unknown"
            R["presence"] = ok(detail,
                mode=mode,
                current_activity=current_activity,
                current_status=current_status,
                rotation_index=_rotation_index if rot.get("enabled") else None,
            )
        except Exception as e:
            R["presence"] = err(str(e))

        # ── 20. Latency trend ───────────────────────────────────────────────
        try:
            trend = list(_latency_trend)
            if trend:
                values = [t.get("ms", 0) for t in trend if isinstance(t, dict)]
                avg_ms = round(sum(values) / len(values), 1) if values else None
                max_ms = max(values) if values else None
                min_ms = min(values) if values else None
                high_latency = sum(1 for v in values if v > 500)
                R["latency_trend"] = ok(
                    f"avg {avg_ms}ms (last {len(values)} samples)",
                    samples=len(values),
                    avg_ms=avg_ms,
                    max_ms=max_ms,
                    min_ms=min_ms,
                    high_count=high_latency,
                    recent=trend[-5:],
                )
            else:
                R["latency_trend"] = ok("No samples yet", samples=0)
        except Exception as e:
            R["latency_trend"] = err(str(e))

        # ── 21. Feature flags ───────────────────────────────────────────────
        try:
            flags = dict(_feature_flags)
            disabled = [k for k, v in flags.items() if not v]
            R["feature_flags"] = ok(
                f"{len(flags)} flags, {len(disabled)} disabled",
                flags=flags,
                disabled=disabled,
            )
        except Exception as e:
            R["feature_flags"] = err(str(e))

        # ── 22. System resources ────────────────────────────────────────────
        try:
            import resource as _res
            mem_mb = round(_res.getrusage(_res.RUSAGE_SELF).ru_maxrss / 1024, 1)
        except Exception:
            mem_mb = None
        try:
            proc_uptime = None
            if _os.path.exists("/proc/uptime"):
                with open("/proc/uptime") as _f:
                    proc_uptime = round(float(_f.read().split()[0]) / 3600, 1)
        except Exception:
            proc_uptime = None
        R["system"] = ok(
            f"Python {_sys.version.split()[0]} | {_platform.system()} {_platform.release()}",
            python_version=_sys.version.split()[0],
            platform=_platform.system(),
            os_release=_platform.release(),
            cwd=_os.getcwd(),
            pid=_os.getpid(),
            mem_mb=mem_mb,
            uptime_h=proc_uptime,
        )

        # ── 23. Guild voice channels ────────────────────────────────────────
        try:
            if g:
                vcs = g.voice_channels
                occupied = [vc for vc in vcs if len(vc.members) > 0]
                total_in_voice = sum(len(vc.members) for vc in occupied)
                R["voice_channels"] = ok(
                    f"{len(occupied)}/{len(vcs)} occupied, {total_in_voice} members in voice",
                    total_vcs=len(vcs),
                    occupied=len(occupied),
                    members_in_voice=total_in_voice,
                    channels=[{"name": vc.name, "members": len(vc.members)} for vc in occupied],
                )
            else:
                R["voice_channels"] = err("Guild unavailable")
        except Exception as e:
            R["voice_channels"] = err(str(e))

        # ── 24. Recent flight activity ──────────────────────────────────────
        try:
            flights_all = get_real_flights()
            now_str = now.strftime("%Y-%m-%d")
            week_ago = (now - timedelta(days=7)).strftime("%Y-%m-%d")
            week_flights   = [f for f in flights_all.values() if f.get("dep_date","") >= week_ago]
            hosts_this_week = len(set(f.get("host_user_id") for f in week_flights if f.get("host_user_id")))
            in_progress    = [f for f in flights_all.values() if f.get("status") == "In Progress"]
            R["flight_activity"] = ok(
                f"{len(week_flights)} flights this week by {hosts_this_week} hosts",
                flights_this_week=len(week_flights),
                hosts_active_week=hosts_this_week,
                in_progress=len(in_progress),
                in_progress_codes=[f.get("flight_number","?") for f in in_progress],
            )
        except Exception as e:
            R["flight_activity"] = err(str(e))

        # ── 25. Blackout dates ──────────────────────────────────────────────
        try:
            blackout = sorted(user_data.get("__blackout__", []))
            upcoming_bo = [d for d in blackout if d >= now.strftime("%Y-%m-%d")]
            R["blackout_dates"] = ok(
                f"{len(blackout)} total, {len(upcoming_bo)} upcoming",
                total=len(blackout),
                upcoming=len(upcoming_bo),
                dates=blackout,
            )
        except Exception as e:
            R["blackout_dates"] = err(str(e))

        # ── 26. Suspensions ─────────────────────────────────────────────────
        try:
            suspensions = user_data.get("__suspensions__", {})
            R["suspensions"] = ok(
                f"{len(suspensions)} active suspension(s)",
                count=len(suspensions),
                users=[{"user_id": k, "username": v.get("username","?"), "reason": v.get("reason","?"), "at": v.get("at","")} for k,v in suspensions.items()],
            )
        except Exception as e:
            R["suspensions"] = err(str(e))

        # ── 27. Day messages cache ──────────────────────────────────────────
        try:
            day_msgs = user_data.get("_day_msgs", {})
            stale_dm = [d for d in day_msgs if d < (now - timedelta(days=7)).strftime("%Y-%m-%d")]
            R["day_messages"] = ok(
                f"{len(day_msgs)} cached message IDs",
                total=len(day_msgs),
                stale=len(stale_dm),
                dates=sorted(day_msgs.keys()),
            )
        except Exception as e:
            R["day_messages"] = err(str(e))

        # ── 28. Nudge log ───────────────────────────────────────────────────
        try:
            nudge_log = user_data.get("__nudge_log__", {})
            recent_nudge = max(nudge_log.values()) if nudge_log else None
            R["nudge_log"] = ok(
                f"{len(nudge_log)} hosts nudged",
                total_nudged=len(nudge_log),
                most_recent=recent_nudge,
            )
        except Exception as e:
            R["nudge_log"] = err(str(e))

        # ── 29. Config / owner settings ─────────────────────────────────────
        try:
            settings = user_data.get("__owner_settings__", {})
            R["owner_settings"] = ok(
                f"{len(settings)} setting(s) configured",
                keys=list(settings.keys()),
                has_nudge_message=bool(settings.get("nudge_message")),
                has_announce_templates=bool(settings.get("announce_templates")),
                has_bot_templates=bool(settings.get("bot_templates")),
            )
        except Exception as e:
            R["owner_settings"] = err(str(e))

        # ── 30. Healthcheck response time ────────────────────────────────────
        elapsed_ms = round((_time.monotonic() - t0) * 1000, 1)

        # ── Summary ──────────────────────────────────────────────────────────
        def is_fail(v):
            return isinstance(v, dict) and v.get("ok") is False
        failed = [k for k, v in R.items() if is_fail(v)]
        warnings = [k for k, v in R.items() if isinstance(v, dict) and v.get("ok") is None]
        passed = len(R) - len(failed) - len(warnings)

        return {
            "timestamp":       now.isoformat() + "Z",
            "response_ms":     elapsed_ms,
            "summary": {
                "total":    len(R),
                "passed":   passed,
                "warnings": len(warnings),
                "failed":   len(failed),
                "score":    f"{passed}/{len(R)-len(warnings)}",
            },
            "failed":  failed,
            "checks":  R,
        }


    # ── Suspensions ───────────────────────────────────────────────────────────

    @app.get("/api/suspensions")
    async def get_suspensions(request: Request):
        require_manager(request)
        return {"suspensions": user_data.get("__suspensions__", {})}

    @app.post("/api/suspensions/{user_id}")
    async def add_suspension(user_id: str, request: Request):
        require_manager(request)
        body = await request.json()
        reason   = (body.get("reason") or "No reason provided").strip()
        username = (body.get("username") or user_id).strip()
        avatar   = (body.get("avatar") or "").strip()
        session  = get_session(request)
        by       = session.get("username", "Manager") if isinstance(session, dict) else "Manager"
        user_data.setdefault("__suspensions__", {})[user_id] = {
            "user_id":  user_id,
            "username": username,
            "avatar":   avatar,
            "reason":   reason,
            "by":       by,
            "at":       datetime.now(timezone.utc).isoformat() + "Z",
        }
        await save_user_data(user_trigger_desc=f"Suspended {username}")
        await log_action(bot.user, f"🔴 Suspended {username} ({user_id}): {reason}")
        return {"ok": True}

    @app.delete("/api/suspensions/{user_id}")
    async def remove_suspension(user_id: str, request: Request):
        require_manager(request)
        suspensions = user_data.get("__suspensions__", {})
        suspensions.pop(user_id, None)
        user_data["__suspensions__"] = suspensions
        await save_user_data(user_trigger_desc=f"Suspension removed for {user_id}")
        await log_action(bot.user, f"🟢 Suspension lifted for {user_id}")
        return {"ok": True}

    # ── Guild Members ─────────────────────────────────────────────────────────

    @app.get("/api/guild-members")
    async def get_guild_members(request: Request):
        require_manager(request)
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if not g:
            return {"members": []}
        members = []
        for m in g.members:
            if m.bot:
                continue
            role_ids = [r.id for r in m.roles]
            role_name = "none"
            if m.id == OWNER_ID:
                role_name = "owner"
            elif MANAGER_ROLE and MANAGER_ROLE in role_ids:
                role_name = "manager"
            elif BOD_ROLE and BOD_ROLE in role_ids:
                role_name = "bod"
            elif HOSTER_ROLE and HOSTER_ROLE in role_ids:
                role_name = "hoster"
            elif INTEREST_ROLE and INTEREST_ROLE in role_ids:
                role_name = "interest"
            _sus = str(m.id) in user_data.get("__suspensions__", {})
            members.append({
                "user_id":      str(m.id),
                "username":     m.display_name or m.name,
                "avatar":       str(m.display_avatar.url) if m.display_avatar else "",
                "joined_at":    m.joined_at.isoformat() if m.joined_at else None,
                "role":         role_name,
                "is_owner":     m.id == OWNER_ID,
                "is_manager":   role_name == "manager",
                "is_bod":       role_name == "bod",
                "is_hoster":    role_name in ("hoster", "manager", "bod", "owner"),
                "is_suspended": _sus,
                "suspended":    _sus,
            })
        members.sort(key=lambda x: (
            ["owner","manager","bod","hoster","interest","none"].index(x["role"])
            if x["role"] in ["owner","manager","bod","hoster","interest","none"] else 99
        ))
        return {"members": members}

    @app.post("/api/guild-members/{user_id}/role")
    async def set_member_role(user_id: str, request: Request):
        require_manager(request)
        body      = await request.json()
        action    = body.get("action", "")   # "grant" or "revoke"
        role_type = body.get("role", "")     # "hoster", "manager", "bod"
        # Support legacy combined strings like "grant_hoster"
        if "_" in action and not role_type:
            parts = action.split("_", 1)
            action, role_type = parts[0], parts[1]
        g = discord.utils.get(bot.guilds, id=GUILD_ID)
        if not g:
            raise HTTPException(status_code=503, detail="Guild not available")
        member = g.get_member(int(user_id))
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")
        role_id_map = {"hoster": HOSTER_ROLE, "manager": MANAGER_ROLE, "bod": BOD_ROLE}
        if action not in ("grant", "revoke") or role_type not in role_id_map:
            raise HTTPException(status_code=422, detail=f"Unknown action/role: {action}/{role_type}")
        role_id = role_id_map[role_type]
        grant   = action == "grant"
        if not role_id:
            raise HTTPException(status_code=422, detail=f"{role_type} role not configured")
        role = g.get_role(role_id)
        if not role:
            raise HTTPException(status_code=404, detail="Role not found in guild")
        try:
            if grant:
                await member.add_roles(role, reason=f"Dashboard: {action}")
            else:
                await member.remove_roles(role, reason=f"Dashboard: {action}")
        except discord.Forbidden:
            raise HTTPException(status_code=403, detail="Bot lacks permission to manage roles")
        await log_action(bot.user, f"Role {action}_{role_type} for {member.display_name} ({user_id})")
        return {"ok": True}


    # ── Changelog banner ──────────────────────────────────────────────────────
    _changelog_banner: dict = {}

    @app.get("/api/changelog")
    async def get_changelog(request: Request):
        require_auth(request)
        return _changelog_banner or {}

    @app.post("/api/changelog")
    async def set_changelog(request: Request):
        session = require_auth(request)
        if not (isinstance(session, dict) and session.get("is_owner")):
            raise HTTPException(status_code=403, detail="Owner only")
        body = await request.json()
        text = (body.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="text is required")
        _changelog_banner.clear()
        _changelog_banner["text"] = text
        _changelog_banner["published_at"] = datetime.now(timezone.utc).isoformat() + "Z"
        return _changelog_banner

    @app.delete("/api/changelog")
    async def delete_changelog(request: Request):
        session = require_auth(request)
        if not (isinstance(session, dict) and session.get("is_owner")):
            raise HTTPException(status_code=403, detail="Owner only")
        _changelog_banner.clear()
        return {"cleared": True}

    return app


# -----------------------
# Views / Modals — Discord button-driven admin controls
# (flight creation is handled entirely through the web dashboard)
# -----------------------

# -----------------------
# Generate Image (ticket)
# -----------------------
def generate_ticket(data):
    from PIL import Image, ImageDraw, ImageFont
    try:
        base = Image.open("image.png").convert("RGBA")
    except FileNotFoundError:
        raise FileNotFoundError("Base image `image.png` not found!")

    draw = ImageDraw.Draw(base)

    font_light = ImageFont.truetype(FONT_LIGHT, 15)
    font_light_FlightNr = ImageFont.truetype(FONT_LIGHT, 12)
    font_regular = ImageFont.truetype(FONT_REGULAR, 15)
    small_light = ImageFont.truetype(FONT_LIGHT, 11)

    try:
        date_obj = datetime.strptime(data["dep_date"], "%d%m%Y")
        day_str = date_obj.strftime("Departing %a %d %b %Y")
    except Exception:
        day_str = f"Departing {data.get('dep_date','?')}"

    draw.text((93, 38), day_str, font=font_light, fill="black")
    draw.text((93, 59), f"{data.get('dep_city','?')} to {data.get('arr_city','?')}", font=small_light, fill="black")

    dep_time = data.get("dep_time", "?")
    dep_city = data.get("dep_city", "?")
    dep_code = data.get("dep_code", "?")
    dep_terminal = data.get("terminal", "?")
    dep_airport = data.get("dep_airport", "?")

    draw.text((75, 105), dep_time, font=font_light, fill="black")
    draw.text((150, 105), dep_city, font=font_regular, fill="black")
    draw.text((150 + draw.textlength(dep_city + " ", font=font_regular), 105), dep_code, font=font_light, fill="black")
    draw.text((150, 125), f"Terminal {dep_terminal} • {dep_airport}", font=small_light, fill="black")

    flight_number = data.get("flight_number", "?")
    duration = data.get("duration", "?")
    draw.text((170, 148), f"{flight_number} | Operated by Air Canada", font=font_light_FlightNr, fill="black")
    draw.text((170, 168.6), f"Duration: {duration}", font=small_light, fill="black")

    arr_time = data.get("arr_time", "?")
    arr_city = data.get("arr_city", "?")
    arr_code = data.get("arr_code", "?")
    arr_airport = data.get("arr_airport", "?")

    draw.text((75, 200), arr_time, font=font_light, fill="black")
    draw.text((150, 200), arr_city, font=font_regular, fill="black")
    draw.text((150 + draw.textlength(arr_city + " ", font=font_regular), 200), arr_code, font=font_light, fill="black")
    draw.text((150, 220), arr_airport, font=small_light, fill="black")

    try:
        plane_path = os.path.join("aircraft", f"{data['aircraft']}.png")
        plane_img = Image.open(plane_path).convert("RGBA")
        max_w, max_h = 175, 170
        plane_img.thumbnail((max_w, max_h), Image.LANCZOS)
        box_x, box_y = 500, 145
        box_w, box_h = 175, 70
        offset_x = box_x + (box_w - plane_img.width) // 2
        offset_y = box_y + (box_h - plane_img.height) // 2
        base.paste(plane_img, (offset_x, offset_y), plane_img)
        plane_names = {
            "B77W": "Boeing 777-300ER", "B77L": "Boeing 777-200LR", "A333": "Airbus A330-300",
            "B788": "Boeing 787-8", "B789": "Boeing 787-9", "A321": "Airbus A321-200",
            "B737": "Boeing 737 MAX-8", "A223": "Airbus A220-300", "A320": "Airbus A320-200",
            "A319": "Airbus A319-100", "CR9": "CRJ 900", "E75": "Embraer 175",
            "DH4J": "De Havilland Dash 8-400"
        }
        plane_name = plane_names.get(data.get("aircraft"), data.get("aircraft"))
        draw.text((offset_x, offset_y + plane_img.height + 5), plane_name, font=font_regular, fill="black")
    except FileNotFoundError:
        draw.text((650, 200), f"{data.get('aircraft', '?')} (image missing)", font=font_regular, fill="red")

    out_path = f"ticket_{data.get('flight_number', 'unknown')}.png"
    base.save(out_path)
    # image size debug removed
    return out_path


# -----------------------
# Admin panel modals / selects / helpers
# -----------------------

class SetGatesModal(Modal, title="Set Gates (1-2 chars each)"):
    dep_gate = TextInput(label="Departure Gate (1-2 chars)", placeholder="A1", style=TextStyle.short, max_length=2)
    arr_gate = TextInput(label="Arrival Gate (1-2 chars)", placeholder="B2", style=TextStyle.short, max_length=2)

    def __init__(self, code: str):
        super().__init__()
        self.code = code

    async def on_submit(self, interaction: discord.Interaction):
        if not interaction.response.is_done():
            await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            await log_action(interaction.user, f"SetGatesModal submitted for {self.code}")
        except Exception:
            pass
        code = self.code
        entry = user_data.get(code)
        if not entry:
            await interaction.followup.send("\u26a0\ufe0f Flight code not found.", ephemeral=True)
            return
        entry["gate"]["dep"] = self.dep_gate.value.strip() or "N/A"
        entry["gate"]["arr"] = self.arr_gate.value.strip() or "N/A"
        try:
            await save_user_data(user_trigger_desc=f"Set gates for {code}", user=interaction.user)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "save_user_data in SetGatesModal", e)
        try:
            await update_embeds_for_code(interaction.client, code)
            await interaction.followup.send("Gates updated.", ephemeral=True)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "updating embeds after SetGatesModal", e)


class SetAlertsModal(Modal, title="Set Alerts (free text)"):
    alert_text = TextInput(label="Alerts (text)", placeholder="Weather delay possible...", style=TextStyle.long)

    def __init__(self, code: str):
        super().__init__()
        self.code = code

    async def on_submit(self, interaction: discord.Interaction):
        if not interaction.response.is_done():
            await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            await log_action(interaction.user, f"SetAlertsModal submitted for {self.code}")
        except Exception:
            pass
        code = self.code
        entry = user_data.get(code)
        if not entry:
            await interaction.followup.send("\u26a0\ufe0f Flight code not found.", ephemeral=True)
            return
        entry["alerts"] = self.alert_text.value.strip() or "N/A"
        try:
            await save_user_data(user_trigger_desc=f"Set alerts for {code}", user=interaction.user)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "save_user_data in SetAlertsModal", e)
        try:
            await update_embeds_for_code(interaction.client, code)
            await interaction.followup.send("Alerts updated.", ephemeral=True)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "updating embeds after SetAlertsModal", e)


class SendReminderModal(Modal, title="Send Reminder (timestamp)"):
    timestamp = TextInput(label="Timestamp text", placeholder="e.g. 2025-09-20 13:00 UTC", style=TextStyle.short)

    def __init__(self, code: str):
        super().__init__()
        self.code = code

    async def on_submit(self, interaction: discord.Interaction):
        if not interaction.response.is_done():
            await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            await log_action(interaction.user, f"SendReminderModal submitted for {self.code}")
        except Exception:
            pass
        code = self.code
        entry = user_data.get(code)
        if not entry:
            await interaction.followup.send("\u26a0\ufe0f Flight code not found.", ephemeral=True)
            return
        guild = interaction.guild
        channel = guild.get_channel(ANNOUNCE_CHANNEL_ID)
        if not channel:
            await interaction.followup.send("\u26a0\ufe0f Announcement channel not found.", ephemeral=True)
            return
        timestamp_text = self.timestamp.value.strip()
        flight_number = entry.get("flight_number", "Unknown")
        event_link = entry.get("event", {}).get("link", "N/A")
        announce_msg = (
            f"# {flight_number} OPENS IN {timestamp_text}\n"
            f"<@&{FLIGHT_NOTIFY_ROLE}>\n\n"
            f'Please select "interested" if attending!\n\n'
            f"Event link: {event_link}"
        )
        try:
            await channel.send(announce_msg)
            await log_action(interaction.user, f"SendReminder: posted opens-in for {code} at {timestamp_text}")
            await interaction.followup.send("Reminder announced.", ephemeral=True)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "posting reminder message", e)


class StartFlightModal(Modal, title="Start Flight (server link + spawn location)"):
    server_link    = TextInput(label="Server Link", placeholder="server link URL", style=TextStyle.short)
    spawn_location = TextInput(label="Spawn Location (public notice)", placeholder="Spawn Location", style=TextStyle.short)

    def __init__(self, code: str):
        super().__init__()
        self.code = code

    async def on_submit(self, interaction: discord.Interaction):
        if not interaction.response.is_done():
            await interaction.response.defer(ephemeral=True, thinking=True)
        code = self.code
        try:
            await log_action(interaction.user, f"StartFlightModal submitted for {code}")
        except Exception:
            pass
        entry = user_data.get(code)
        if not entry:
            await interaction.followup.send("\u26a0\ufe0f Flight code not found.", ephemeral=True)
            return
        entry["server"]["link"] = self.server_link.value.strip() or "N/A"
        spawn_location = self.spawn_location.value.strip()
        try:
            await save_user_data(user_trigger_desc=f"Start flight {code}", user=interaction.user)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "save_user_data in StartFlightModal", e)
        try:
            await update_embeds_for_code(interaction.client, code)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "update_embeds_for_code in StartFlightModal", e)
        guild = interaction.guild
        channel = guild.get_channel(ANNOUNCE_CHANNEL_ID)
        if channel:
            flight_number = entry.get("flight_number", "Unknown")
            arr_city      = entry.get("arr_city", "Unknown")
            server_link   = entry["server"]["link"]
            announce_text = (
                f"# {flight_number} to {arr_city} has begun check-in.\n"
                f"<@&{FLIGHT_START_ROLE}>\n\n"
                f"Please head to check-in at **{spawn_location}**\n\n"
                f"> <:AIC_Link:1417212068028874865> {server_link}"
            )
            try:
                msg = await channel.send(announce_text)
                entry["announce_message_id"] = str(msg.id)
                await save_user_data(user_trigger_desc=f"Announce start flight {code}", user=interaction.user)
                await log_action(interaction.user, f"StartFlight: announced check-in for {code}")
            except Exception as e:
                await handle_exception_and_report(interaction, interaction.user, "posting start flight announce", e)
        try:
            await interaction.followup.send("Flight started and server link set.", ephemeral=True)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "send confirmation after StartFlightModal", e)


class MealServiceSelect(Select):
    def __init__(self, code: str, default: str = None):
        options = [
            discord.SelectOption(label="Meal Service",    value="Meal Service",    default=(default == "Meal Service")),
            discord.SelectOption(label="Snack Service",   value="Snack Service",   default=(default == "Snack Service")),
            discord.SelectOption(label="No Meal Service", value="No Meal Service", default=(default == "No Meal Service")),
        ]
        super().__init__(placeholder="Select meal service", min_values=1, max_values=1,
                         options=options, custom_id=f"meal_select:{code}")
        self.code = code

    async def callback(self, interaction: discord.Interaction):
        code  = self.code
        entry = user_data.get(code)
        if not entry:
            await interaction.response.send_message("\u26a0\ufe0f Flight code not found.", ephemeral=True)
            return
        entry["meal_service"] = self.values[0]
        try:
            await save_user_data(user_trigger_desc=f"Set meal service for {code} to {self.values[0]}", user=interaction.user)
            await interaction.response.send_message(f"Meal service set to {self.values[0]}.", ephemeral=True)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "meal service callback", e)


class StatusSelect(Select):
    def __init__(self, code: str, default: str = None):
        options = [
            discord.SelectOption(label="On\u2013Time",   value="On\u2013Time",   default=(default == "On\u2013Time")),
            discord.SelectOption(label="Delayed",     value="Delayed",     default=(default == "Delayed")),
            discord.SelectOption(label="Cancelled",   value="Cancelled",   default=(default == "Cancelled")),
            discord.SelectOption(label="Rescheduled", value="Rescheduled", default=(default == "Rescheduled")),
            discord.SelectOption(label="Ended",       value="Ended",       default=(default == "Ended")),
        ]
        super().__init__(placeholder="Select status", min_values=1, max_values=1,
                         options=options, custom_id=f"status_select:{code}")
        self.code = code

    async def callback(self, interaction: discord.Interaction):
        code  = self.code
        entry = user_data.get(code)
        if not entry:
            await interaction.response.send_message("\u26a0\ufe0f Flight code not found.", ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True)
        entry["status"] = self.values[0]
        try:
            await save_user_data(user_trigger_desc=f"Set status for {code} to {self.values[0]}", user=interaction.user)
            await interaction.followup.send(f"Status set to {self.values[0]}.", ephemeral=True)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "status select callback", e)


def build_embeds_from_entry(entry: dict) -> discord.Embed:
    dep_airport   = entry.get("dep_airport", "N/A")
    dep_code_val  = entry.get("dep_code", "N/A")
    dep_time      = entry.get("dep_time", "N/A")
    terminal      = entry.get("terminal", "N/A")
    dep_gate      = entry.get("gate", {}).get("dep", "N/A")
    arr_airport   = entry.get("arr_airport", "N/A")
    arr_code_val  = entry.get("arr_code", "N/A")
    arr_time      = entry.get("arr_time", "N/A")
    arr_gate      = entry.get("gate", {}).get("arr", "N/A")
    dep_date_raw  = entry.get("dep_date", "N/A")
    try:
        dt = datetime.strptime(dep_date_raw, "%d%m%Y")
        dep_date_display = dt.strftime("%a, %d %b %Y")
    except Exception:
        dep_date_display = dep_date_raw
    aircraft      = entry.get("aircraft", "N/A")
    meal          = entry.get("meal_service", "N/A")
    status        = entry.get("status", "N/A")
    host          = entry.get("host_user_id") or entry.get("host", "Unknown")
    alerts        = entry.get("alerts", "N/A")
    server_link   = entry.get("server", {}).get("link", "N/A")
    event_link    = entry.get("event",  {}).get("link", "N/A")
    flight_number = entry.get("flight_number", "Unknown")

    embed = discord.Embed(
        title=flight_number,
        description=f"# [{flight_number}]({event_link})" if event_link != "N/A" else flight_number,
        color=13047318
    )
    dep_value  = (f">>> <:AIC_Takeoff:1409728645093785620> {dep_airport} **{dep_code_val}**\n"
                  f"<:AIC_Clock:1416206442482110555> {dep_time}\n"
                  f"<:AIC_Airport:1409728649845800992> Terminal {terminal}\n"
                  f"<:AIC_BoardingPass:1409728642799505460> Gate {dep_gate}\n")
    arr_value  = (f">>> <:AIC_Landing:1409728647371165736> {arr_airport} **{arr_code_val}**\n"
                  f"<:AIC_Clock:1416206442482110555> {arr_time}\n"
                  f"<:AIC_BoardingPass:1409728642799505460> Gate {arr_gate}\n    ** ** ")
    info_value = (f">  <:AIC_Calendar:1419198165923528794> {dep_date_display}\n"
                  f"> <:AIC_Seat:1409728800073187422> {aircraft}\n"
                  f"> <:AIC_MealService:1419199319436693666> {meal}\n"
                  f"> <:AIC_Status:1419199743145545779> **Status**: {status}\n"
                  f"> <:AIC_Crown:1409728805177655367> Host: <@{host}>\n"
                  f"> <:AIC_Warning:1416198985558917240> Alerts: {alerts}\n\n"
                  f"> <:AIC_Link:1409728713716928572> Server Link: **{server_link}**")
    embed.add_field(name="Departure",          value=dep_value,  inline=True)
    embed.add_field(name="Arrival",            value=arr_value,  inline=True)
    embed.add_field(name="Flight Information", value=info_value, inline=False)
    embed.set_image(url="https://message.style/cdn/images/ea75ce6f1ccf8a29c0d92c39a5daf807711b498b1df7ae0cf143f660d75ca454.png")
    embed.set_footer(text="All times are set in UTC")
    return embed


async def fetch_message_with_retries(channel, message_id: int, attempts: int = 3, delay: float = 0.5):
    for i in range(attempts):
        try:
            return await channel.fetch_message(message_id)
        except Exception:
            await asyncio.sleep(delay * (i + 1))
    return None


async def update_embeds_for_code(client: commands.Bot, code: str):
    """Refresh the public Discord embed for a flight. Admin panel has been removed."""
    entry = user_data.get(code)
    if not entry:
        return
    try:
        for g in client.guilds:
            pub_ch = g.get_channel(PUBLIC_CHANNEL_ID)
            if pub_ch and entry.get("public_message_id"):
                try:
                    msg = await fetch_message_with_retries(pub_ch, int(entry["public_message_id"]))
                    if msg:
                        await msg.edit(embed=build_embeds_from_entry(entry))
                except Exception:
                    pass
            break
    except Exception as e:
        safe_console_print(f"Error updating embed: {e}")


# -----------------------
# Component interactions handler
# -----------------------
@bot.event
async def on_interaction(interaction: discord.Interaction):
    try:
        if interaction.type != discord.InteractionType.component:
            return
        cid = interaction.data.get("custom_id") or ""
        if ":" not in cid:
            return
        action, code = cid.split(":", 1)
        if action == "crew":
            return  # handled by the dedicated Crew Requests listener
        if action == "selfrole":
            await interaction.response.defer(ephemeral=True, thinking=True)
            if not code.isdigit() or not interaction.guild:
                await interaction.followup.send("This role button is no longer valid.", ephemeral=True)
                return
            role = interaction.guild.get_role(int(code))
            member = interaction.user
            if not role or not isinstance(member, discord.Member):
                await interaction.followup.send("This role is no longer available.", ephemeral=True)
                return
            if role in member.roles:
                await interaction.followup.send(f"You already have **{role.name}**.", ephemeral=True)
                return
            try:
                await member.add_roles(role, reason="Self-role button")
                await interaction.followup.send(f"You now have **{role.name}**.", ephemeral=True)
            except discord.Forbidden:
                await interaction.followup.send("I cannot assign that role. Check my role position and permissions.", ephemeral=True)
            except discord.HTTPException as exc:
                log_to_file(f"Self-role assignment failed for {member.id} / {role.id}: {exc}", level="warn")
                await interaction.followup.send("Discord could not assign the role. Please try again or check the bot permissions.", ephemeral=True)
            return
        code = code.upper()

        try:
            await log_action(interaction.user, f"Pressed component: {action} for code {code}")
        except Exception:
            pass

        # Handle detail button (public)
        if action == "detail":
            entry = user_data.get(code)
            if not entry:
                await interaction.response.send_message("⚠️ Flight not found.", ephemeral=True)
                return
            embed = build_detail_embed(entry)
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        if action == "set_gates":
            await interaction.response.send_modal(SetGatesModal(code))
            return
        if action == "set_alerts":
            await interaction.response.send_modal(SetAlertsModal(code))
            return
        if action == "send_reminder":
            await interaction.response.send_modal(SendReminderModal(code))
            return
        if action == "not_started":
            entry = user_data.get(code)
            if not entry:
                await interaction.followup.send("⚠️ Flight code not found.", ephemeral=True)
                return
            await interaction.response.defer(ephemeral=True)
            entry["server"]["link"] = "Flight Not Started"
            try:
                await save_user_data(user_trigger_desc=f"Set Server Link 'Flight Not Started' for {code}", user=interaction.user)
                await update_embeds_for_code(interaction.client, code)
                await interaction.followup.send("Server Link set to 'Flight Not Started'.", ephemeral=True)
            except Exception as e:
                await handle_exception_and_report(interaction, interaction.user, "not_started button handler", e)
            return
        if action == "start_flight":
            await interaction.response.send_modal(StartFlightModal(code))
            return
        if action == "close_flight":
            entry = user_data.get(code)
            if not entry:
                await interaction.followup.send("⚠️ Flight code not found.", ephemeral=True)
                return
            await interaction.response.defer(ephemeral=True)
            entry["server"]["link"] = "<:AIC_Locked:1409728733589405777> Gate Closed"
            try:
                await save_user_data(user_trigger_desc=f"Close flight {code}", user=interaction.user)
                await update_embeds_for_code(interaction.client, code)
            except Exception as e:
                await handle_exception_and_report(interaction, interaction.user, "close_flight save/update", e)
            announce_ch = interaction.client.get_channel(ANNOUNCE_CHANNEL_ID)
            if announce_ch and entry.get("announce_message_id"):
                try:
                    announce_msg = await fetch_message_with_retries(announce_ch, int(entry["announce_message_id"]))
                    if announce_msg:
                        flight_number = entry.get("flight_number", "Unknown")
                        arr_city = entry.get("arr_city", "Unknown")
                        await announce_msg.edit(
                            content=(
                                f"# {flight_number} to {arr_city} has closed boarding.\n"
                                f"<@&{INTEREST_ROLE}> \n\n<:AIC_Locked:1409728733589405777> Gate Closed"
                            )
                        )
                except Exception as e:
                    safe_console_print(f"Error editing announce message for close_flight: {e}")
            try:
                await interaction.followup.send("Flight closed.", ephemeral=True)
            except Exception as e:
                await handle_exception_and_report(interaction, interaction.user, "send confirmation after close_flight", e)
            return

    except Exception as e:
        safe_console_print("on_interaction error:")
        safe_console_print(traceback.format_exc())


# -----------------------
# Bot Start
# -----------------------
@tasks.loop(minutes=1)
async def track_latency():
    """Record bot latency every minute for trend display in diagnostics."""
    global _latency_trend, _task_last_fired
    if bot.is_ready():
        ms = round(bot.latency * 1000, 1)
        _latency_trend.append({"t": datetime.now(timezone.utc).strftime("%H:%M"), "ms": ms})
        if len(_latency_trend) > 20:
            _latency_trend = _latency_trend[-20:]
        _task_last_fired["track_latency"] = datetime.now(timezone.utc).isoformat()


@tasks.loop(minutes=1)
async def post_daily_schedule():
    """
    Every minute: check if it's 00:00 UTC. If so, post the day-schedule embed
    for today in the public channel (one embed per day, only for today's flights).
    """
    global _task_last_fired
    if not _feature_flags.get("post_daily_schedule", True): return
    _task_last_fired["post_daily_schedule"] = datetime.now(timezone.utc).isoformat()
    now = datetime.now(timezone.utc)
    _sched_hour = int(_feature_config.get("post_daily_schedule", {}).get("utc_hour", 0))
    if now.hour != _sched_hour or now.minute != 0:
        return

    g = discord.utils.get(bot.guilds, id=GUILD_ID)
    if not g:
        return

    today_raw = now.strftime("%d%m%Y")
    try:
        await post_or_update_day_schedule(g, today_raw)
        # daily schedule posted
    except Exception as e:
        safe_console_print(f"post_daily_schedule error: {e}")


@tasks.loop(minutes=1)
async def auto_reminder_flights():
    """
    Every minute: check if any active flight departs in 115-125 min (~2 hours out).
    If so, and no reminder has been sent yet, ping the announce channel with a Discord timestamp.
    """
    global _task_last_fired
    import calendar as _calendar
    if not _feature_flags.get("auto_reminder_flights", True): return
    _task_last_fired["auto_reminder_flights"] = datetime.now(timezone.utc).isoformat()
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    real = get_real_flights()
    g = discord.utils.get(bot.guilds, id=GUILD_ID)
    if not g:
        return

    for code, entry in real.items():
        if entry.get("status") in ("Ended", "Cancelled"):
            continue
        if entry.get("reminder_sent"):
            continue
        dep_date_raw = entry.get("dep_date", "")
        dep_time_raw = entry.get("dep_time", "")
        if not dep_date_raw or not dep_time_raw or ":" not in dep_time_raw:
            continue
        try:
            dep_dt = datetime.strptime(dep_date_raw, "%d%m%Y")
            h, m = map(int, dep_time_raw.split(":"))
            dep_dt = dep_dt.replace(hour=h, minute=m)
        except Exception:
            continue
        mins_until = (dep_dt - now_utc).total_seconds() / 60
        _remind_min = int(_feature_config.get("auto_reminder_flights", {}).get("minutes_before", 120))
        if (_remind_min - 5) <= mins_until <= (_remind_min + 5):
            flight_number = entry.get("flight_number", code)
            event_link    = entry.get("event", {}).get("link", "N/A")
            arr_city      = entry.get("arr_city", "")
            dep_unix      = _calendar.timegm(dep_dt.timetuple())
            try:
                ch = g.get_channel(ANNOUNCE_CHANNEL_ID)
                if ch:
                    msg = (
                        f"# {flight_number} to {arr_city} — departing <t:{dep_unix}:R>!\n"
                        f"<@&{FLIGHT_NOTIFY_ROLE}>\n\n"
                        f"Check-in opens soon. Make sure you\'re ready.\n"
                        f"> <:AIC_Link:1417212068028874865> {event_link}"
                    )
                    await ch.send(msg, allowed_mentions=allowed_mentions)
                    entry["reminder_sent"] = True
                    await save_user_data(user_trigger_desc=f"Auto 2hr reminder for {code}")
                    # reminder sent
                    _task_last_fired["auto_reminder_flights"] = datetime.now(timezone.utc).isoformat()
            except Exception as e:
                safe_console_print(f"Auto reminder error {code}: {e}")


@tasks.loop(minutes=1)
async def auto_end_flights():
    """
    Every minute: check if any active flight's arrival time has passed (UTC).
    If so, set status → Ended (capturing final_status first) and update Discord.
    dep_date format: DDMMYYYY, arr_time format: HH:MM
    """
    global _task_last_fired
    if not _feature_flags.get("auto_end_flights", True): return
    _task_last_fired["auto_end_flights"] = datetime.now(timezone.utc).isoformat()
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    real    = get_real_flights()
    to_end  = []

    for code, entry in real.items():
        if entry.get("status") == "Ended":
            continue

        dep_date_raw = entry.get("dep_date", "")
        arr_time_raw = entry.get("arr_time", "")
        if not dep_date_raw or not arr_time_raw or arr_time_raw in ("N/A", ""):
            continue

        try:
            dep_date = datetime.strptime(dep_date_raw, "%d%m%Y").date()
            arr_h, arr_m = map(int, arr_time_raw.split(":"))
        except Exception:
            continue

        # Build the arrival datetime — if arr_time is earlier than dep_time it's next day
        dep_time_raw = entry.get("dep_time", "00:00")
        try:
            dep_h, dep_m = map(int, dep_time_raw.split(":"))
        except Exception:
            dep_h, dep_m = 0, 0

        arr_dt = datetime(dep_date.year, dep_date.month, dep_date.day, arr_h, arr_m)
        if arr_h * 60 + arr_m <= dep_h * 60 + dep_m:
            # Arrival is next calendar day
            from datetime import timedelta
            arr_dt += timedelta(days=1)

        if now_utc >= arr_dt:
            to_end.append((code, entry))

    if not to_end:
        return

    g = discord.utils.get(bot.guilds, id=GUILD_ID)
    for code, entry in to_end:
        # Snapshot final_status before marking Ended
        prev = entry.get("status", "N/A")
        if prev in ("On–Time", "Delayed", "Cancelled", "Rescheduled"):
            entry["final_status"] = prev
        entry["status"] = "Ended"
        # flight auto-ended

    await save_user_data(user_trigger_desc=f"Auto-ended {len(to_end)} flight(s)")

    if g:
        for code, entry in to_end:
            try:
                await update_embeds_for_code(bot, code)
            except Exception as e:
                safe_console_print(f"Auto-end embed error {code}: {e}")
        # (day schedule only posts at midnight)


def _scheduled_quota_eligible_count(uid, start, end):
    count = 0
    for entry in get_real_flights().values():
        if str(entry.get("host_user_id", "")) != str(uid):
            continue
        try:
            dep = datetime.strptime(entry.get("dep_date", ""), "%d%m%Y").date()
        except Exception:
            continue
        if not (start <= dep < end):
            continue
        effective = entry.get("final_status") if entry.get("status") == "Ended" else entry.get("status")
        if entry.get("status") != "Ended" or effective in ("Cancelled", "Rescheduled"):
            continue
        attendance = entry.get("crew", {}).get("attendance", {})
        has_attendance = any(
            value is True or str(value).lower() in ("present", "late")
            for member in attendance.values() if isinstance(member, dict)
            for value in member.values()
        )
        has_passengers = entry.get("pax_joined") is not None or entry.get("pax") is not None
        if has_attendance and has_passengers:
            count += 1
    return count

def _scheduled_quota_on_loa(state, start, end):
    for period in state.get("loa_periods", []):
        try:
            loa_start = datetime.fromisoformat(str(period.get("start", ""))[:10]).date()
            loa_end = datetime.fromisoformat(str(period.get("end", ""))[:10]).date() if period.get("end") else None
        except Exception:
            continue
        if loa_start < end and (loa_end is None or loa_end >= start):
            return True
    return False

@tasks.loop(minutes=1)
async def weekly_quota_review():
    """Persist quota point changes once each Monday at 00:00 UTC; sends no messages."""
    now = datetime.now(timezone.utc)
    if now.weekday() != 0 or now.hour != 0:
        return
    current_week = now.date()
    marker = current_week.isoformat()
    if user_data.get("__quota_last_run__") == marker:
        return
    guild = bot.get_guild(GUILD_ID)
    if not guild:
        return
    previous_week = current_week - timedelta(days=7)
    states = user_data.setdefault("__quota_state__", {})
    targets = get_quota_targets()
    for member in guild.members:
        role_ids = {role.id for role in member.roles}
        if FOI_TRAINEE_ROLE in role_ids:
            continue
        target = targets["som_target"] if MANAGER_ROLE in role_ids else targets["fom_target"] if FOM_ROLE in role_ids else None
        if target is None:
            continue
        state = states.setdefault(str(member.id), {"points": 10, "history": []})
        if state.get("last_processed_week") == marker:
            continue
        flights = _scheduled_quota_eligible_count(member.id, previous_week, current_week)
        met = flights >= target
        exempt = _scheduled_quota_on_loa(state, previous_week, current_week)
        if not met and not exempt:
            state["points"] = max(0, int(state.get("points", 10)) - 1)
        state.setdefault("history", []).append({"week": previous_week.isoformat(), "flights": flights, "target": target, "met": met, "exempt": exempt, "processed_at": now.isoformat() + "Z"})
        state["history"] = state["history"][-26:]
        state["last_processed_week"] = marker
    user_data["__quota_last_run__"] = marker
    await save_user_data(user_trigger_desc=f"Weekly quota review {marker}")

@tasks.loop(minutes=1)
async def monthly_quota_reimbursement():
    """Restore one quota point per calendar month; sends no messages."""
    now = datetime.now(timezone.utc)
    if now.day != 1 or now.hour != 0:
        return
    marker = now.strftime("%Y-%m")
    if user_data.get("__quota_reimbursement_run__") == marker:
        return
    changed = 0
    for state in user_data.setdefault("__quota_state__", {}).values():
        if not isinstance(state, dict):
            continue
        previous = state.get("last_reimbursement_month")
        if previous and previous != marker and int(state.get("points", 10)) < 10:
            state["points"] = min(10, int(state.get("points", 10)) + 1)
            changed += 1
        state["last_reimbursement_month"] = marker
    user_data["__quota_reimbursement_run__"] = marker
    await save_user_data(user_trigger_desc=f"Monthly quota reimbursement {marker}: {changed} restored")

@tasks.loop(hours=1)
async def post_weekly_monthly_report():
    """
    Posts a weekly report every Monday at 00:00 UTC and
    a monthly report on the 1st of each month at 00:00 UTC.
    """
    global _task_last_fired
    if not _feature_flags.get("post_weekly_monthly_report", True): return
    _task_last_fired["post_weekly_monthly_report"] = datetime.now(timezone.utc).isoformat()
    now = datetime.now(timezone.utc)
    _rep_hour = int(_feature_config.get("post_weekly_monthly_report", {}).get("utc_hour", 0))
    _rep_day  = int(_feature_config.get("post_weekly_monthly_report", {}).get("weekly_day", 0))
    is_monday_midnight  = (now.weekday() == _rep_day and now.hour == _rep_hour and now.minute < 60)
    is_month_start      = (now.day == 1               and now.hour == _rep_hour and now.minute < 60)

    if not is_monday_midnight and not is_month_start:
        return

    g = discord.utils.get(bot.guilds, id=GUILD_ID)
    if not g:
        return
    log_ch = g.get_channel(LOG_CHANNEL_ID)
    if not log_ch:
        return

    real = get_real_flights()

    def flights_in_range(start, end):
        result = []
        for code, entry in real.items():
            date_raw = entry.get("dep_date", "")
            try:
                dt = datetime.strptime(date_raw, "%d%m%Y")
                if start <= dt < end:
                    result.append((code, entry))
            except Exception:
                pass
        return result

    from datetime import timedelta

    if is_monday_midnight:
        # Weekly: last 7 days
        end   = datetime(now.year, now.month, now.day)
        start = end - timedelta(days=7)
        label = f"Weekly Report — {start.strftime('%b %d')} to {(end - timedelta(days=1)).strftime('%b %d, %Y')}"
        period_flights = flights_in_range(start, end)
        color = 0x0055a5
    else:
        # Monthly: last month
        first_this_month = datetime(now.year, now.month, 1)
        last_month_end   = first_this_month - timedelta(days=1)
        start = datetime(last_month_end.year, last_month_end.month, 1)
        end   = first_this_month
        label = f"Monthly Report — {start.strftime('%B %Y')}"
        period_flights   = flights_in_range(start, end)
        color = 0xc8102e

    total     = len(period_flights)
    on_time_n = sum(1 for _, e in period_flights if e.get("status") == "On–Time" or e.get("final_status") == "On–Time")
    cancelled = sum(1 for _, e in period_flights if e.get("status") == "Cancelled" or e.get("final_status") == "Cancelled")
    delayed   = sum(1 for _, e in period_flights if e.get("status") == "Delayed"   or e.get("final_status") == "Delayed")
    ended     = sum(1 for _, e in period_flights if e.get("status") == "Ended")
    pax_total = sum(e.get("pax") or 0 for _, e in period_flights if e.get("pax") is not None)

    rated = on_time_n + cancelled + delayed
    ontime_rate = f"{round(on_time_n/rated*100)}%" if rated else "N/A"
    cancel_rate = f"{round(cancelled/rated*100)}%" if rated else "N/A"

    # Top host
    host_counts = {}
    for _, e in period_flights:
        hid = e.get("host_user_id", "")
        if hid:
            host_counts[hid] = host_counts.get(hid, 0) + 1
    top_host_id    = max(host_counts, key=host_counts.get) if host_counts else None
    top_host_count = host_counts[top_host_id] if top_host_id else 0

    # Top route
    route_counts = {}
    for _, e in period_flights:
        if e.get("dep_code") and e.get("arr_code"):
            r = f"{e['dep_code']}→{e['arr_code']}"
            route_counts[r] = route_counts.get(r, 0) + 1
    top_route = max(route_counts, key=route_counts.get) if route_counts else None
    top_route_count = route_counts[top_route] if top_route else 0

    embed = discord.Embed(title=f"📊 {label}", color=color)
    embed.add_field(name="Flights Scheduled", value=str(total), inline=True)
    embed.add_field(name="Flights Ended",     value=str(ended), inline=True)
    embed.add_field(name="Total Passengers",  value=str(pax_total) if pax_total else "N/A", inline=True)
    embed.add_field(name="On-Time Rate",  value=ontime_rate, inline=True)
    embed.add_field(name="Cancel Rate",   value=cancel_rate, inline=True)
    embed.add_field(name="Delayed",       value=str(delayed), inline=True)
    if top_route:
        embed.add_field(name="Top Route", value=f"{top_route} ({top_route_count}×)", inline=True)
    if top_host_id:
        embed.add_field(name="Most Active Host", value=f"<@{top_host_id}> ({top_host_count} flights)", inline=True)
    embed.set_footer(text="Air Canada PTFS — Automated Report")
    embed.timestamp = datetime.now(timezone.utc)

    try:
        await log_ch.send(embed=embed)
        # report posted
    except Exception as e:
        safe_console_print(f"Report post error: {e}")


@tasks.loop(minutes=1)
async def cleanup_old_day_messages():
    """
    Every minute: check if any stored day-schedule message belongs to a past UTC date.
    If so, delete the Discord message and remove it from DB.
    """
    global _task_last_fired
    if not _feature_flags.get("cleanup_old_day_messages", True): return
    _task_last_fired["cleanup_old_day_messages"] = datetime.now(timezone.utc).isoformat()
    if "_day_msgs" not in user_data:
        return

    today_utc = datetime.now(timezone.utc).date()
    g = discord.utils.get(bot.guilds, id=GUILD_ID)
    if not g:
        return

    stale = [
        date_raw for date_raw in list(user_data["_day_msgs"].keys())
        if _date_is_past(date_raw, today_utc)
    ]

    for date_raw in stale:
        try:
            await delete_day_schedule_message(g, date_raw)
            # day message cleaned
        except Exception as e:
            safe_console_print(f"Cleanup error for {date_raw}: {e}")


def _date_is_past(date_raw: str, today_utc) -> bool:
    """Return True if date_raw (DDMMYYYY) is strictly before today_utc."""
    try:
        return datetime.strptime(date_raw, "%d%m%Y").date() < today_utc
    except Exception:
        return False


@tasks.loop(minutes=30)
async def cleanup_crew_threads():
    """
    Every 30 minutes: check all ended flights. If a flight has been ended
    for longer than the configured threshold (default 48h), delete its
    crew signup thread from Discord and clear the thread_id from the entry.
    """
    global _task_last_fired
    if not _feature_flags.get("cleanup_crew_threads", True):
        return
    _task_last_fired["cleanup_crew_threads"] = datetime.now(timezone.utc).isoformat()

    threshold_hours = int(_feature_config.get("cleanup_crew_threads", {}).get("hours_after_end", 48))
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    g = discord.utils.get(bot.guilds, id=GUILD_ID)
    if not g:
        return

    cleaned = 0
    for code, entry in list(user_data.items()):
        if not isinstance(entry, dict) or "flight_number" not in entry:
            continue
        if entry.get("status") != "Ended":
            continue
        crew = entry.get("crew", {})
        thread_id = crew.get("thread_id")
        if not thread_id:
            continue

        # Determine when the flight ended: use arrival datetime
        dep_date_raw = entry.get("dep_date", "")
        arr_time_raw = entry.get("arr_time", "")
        if not dep_date_raw or not arr_time_raw or ":" not in arr_time_raw:
            continue
        try:
            dep_date = datetime.strptime(dep_date_raw, "%d%m%Y").date()
            arr_h, arr_m = map(int, arr_time_raw.split(":"))
            dep_time_raw = entry.get("dep_time", "00:00")
            dep_h, dep_m = map(int, dep_time_raw.split(":")) if ":" in dep_time_raw else (0, 0)
            arr_dt = datetime(dep_date.year, dep_date.month, dep_date.day, arr_h, arr_m)
            # If arrival is earlier than departure, it crosses midnight
            if arr_h * 60 + arr_m <= dep_h * 60 + dep_m:
                arr_dt += timedelta(days=1)
        except Exception:
            continue

        hours_since_end = (now_utc - arr_dt).total_seconds() / 3600
        if hours_since_end < threshold_hours:
            continue

        # Delete the thread from Discord
        try:
            thread = bot.get_channel(int(thread_id))
            if thread is None:
                try:
                    thread = await bot.fetch_channel(int(thread_id))
                except Exception:
                    thread = None
            if thread:
                await thread.delete()
        except Exception as e:
            log_to_file(f"Crew thread delete failed for {code} (thread {thread_id}): {e}", level="warn")
            continue

        # Clear thread/message IDs from the entry
        crew["thread_id"] = None
        crew["message_id"] = None
        entry["crew"] = crew
        cleaned += 1
        log_to_file(f"Crew thread deleted for {code} ({entry.get('flight_number', '?')}) — {round(hours_since_end)}h after end", level="ok")

    if cleaned:
        await save_user_data(user_trigger_desc=f"Cleaned up {cleaned} crew thread(s)")


# Optional: set DASHBOARD_PUBLIC_URL in your .env to show the real URL on startup
# e.g. DASHBOARD_PUBLIC_URL=https://your-tunnel.trycloudflare.com
DASHBOARD_PUBLIC_URL = os.environ.get("DASHBOARD_PUBLIC_URL", "").strip().rstrip("/")

_rotation_index = 0

@tasks.loop(minutes=1)
async def rotate_presence():
    global _rotation_index, _task_last_fired
    _task_last_fired["rotate_presence"] = datetime.now(timezone.utc).isoformat()
    cfg = user_data.get("__presence_rotation__", {})
    if not cfg.get("enabled"):
        return
    slots = cfg.get("slots", [])
    if not slots:
        return
    interval = max(1, int(cfg.get("interval_minutes", 5)))
    now = datetime.now(timezone.utc)
    # Only fire on interval boundaries
    if now.minute % interval != 0:
        return
    _rotation_index = (_rotation_index + 1) % len(slots)
    slot = slots[_rotation_index]
    type_str, _, text = slot.partition(":")
    atype = {
        "watching":    discord.ActivityType.watching,
        "listening":   discord.ActivityType.listening,
        "playing":     discord.ActivityType.playing,
        "competing":   discord.ActivityType.competing,
    }.get(type_str.lower(), discord.ActivityType.watching)
    try:
        await bot.change_presence(activity=discord.Activity(type=atype, name=text.strip()))
        # presence rotated
        await log_action(bot.user, f"Presence rotated → {type_str}: {text.strip()}")
    except Exception as e:
        safe_console_print(f"rotate_presence error: {e}")


@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return

    if message.mentions:
        stats = user_data.get("__ping_stats__", {})
        changed = False
        for user in message.mentions:
            if user.id in TRACKED_PING_USERS:
                uid_str = str(user.id)
                stats[uid_str] = stats.get(uid_str, 0) + 1
                changed = True
        
        if changed:
            user_data["__ping_stats__"] = stats

    await bot.process_commands(message)


@bot.event
async def on_ready():
    # ── Startup banner ────────────────────────────────────────────────────────
    import platform as _plat, datetime as _dt
    sep = "─" * 52
    print(f"\n{'═' * 52}")
    print(f"  ✈  AIC PTFS Flight Operations Bot")
    print(sep)
    print(f"  Bot      : {bot.user} (ID: {bot.user.id})")
    print(f"  Server   : {_plat.node()}  ({_plat.system()} {_plat.release()})")
    print(f"  Python   : {_plat.python_version()}")
    print(f"  Started  : {_dt.datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print(f"  Guilds   : {len(bot.guilds)}")
    print(sep)

    if WEB_ENABLED:
        api = create_api()
        config = uvicorn.Config(api, host="0.0.0.0", port=DASHBOARD_PORT, log_level="warning")
        server = uvicorn.Server(config)
        asyncio.create_task(server.serve())
        local_url  = f"http://localhost:{DASHBOARD_PORT}"
        public_url = DASHBOARD_PUBLIC_URL or "(set DASHBOARD_PUBLIC_URL in .env)"
        print(f"  Dashboard: {local_url}")
        print(f"  Public   : {public_url}")
    else:
        print(f"  Dashboard: ⚠  disabled (pip install fastapi uvicorn)")
    print(f"{'═' * 52}\n")

    # Re-apply saved config now that user_data is fully loaded
    apply_saved_config()

    # Load persisted blocklist into auth module
    try:
        from auth import _load_blocklist
        _load_blocklist()
        # blocklist loaded
    except Exception as e:
        safe_console_print(f"Blocklist load error: {e}")

    # Backfill final_status for old ended flights that predate the feature
    _backfill_count = 0
    for _code, _entry in list(user_data.items()):
        if (isinstance(_entry, dict) and _entry.get("status") == "Ended"
                and not _entry.get("final_status")
                and len(_code) == 6 and "flight_number" in _entry):
            # We don't know what it was — mark as On–Time as default for old flights
            # (most flights ended cleanly). Managers can correct via drawer.
            _entry["final_status"] = "On–Time"
            _backfill_count += 1
    if _backfill_count:
        import asyncio as _asyncio
        _asyncio.create_task(save_user_data(user_trigger_desc=f"Backfilled final_status for {_backfill_count} ended flights"))
        safe_console_print(f"✅ Backfilled final_status for {_backfill_count} ended flights (defaulted to On–Time)")

    # Re-register persistent views for all active day-schedule messages
    # so interactions work after a bot restart
    if "_day_msgs" in user_data:
        today_utc = datetime.now(timezone.utc).date()
        real = get_real_flights()
        grouped = group_flights_by_date(real)
        for date_raw in list(user_data["_day_msgs"].keys()):
            try:
                if _date_is_past(date_raw, today_utc):
                    continue
                flights_on_day = grouped.get(date_raw, [])
                if flights_on_day:
                    bot.add_view(DayScheduleView(flights_on_day, date_raw=date_raw))
            except Exception as e:
                safe_console_print(f"Could not re-register view for {date_raw}: {e}")
    print("✅ Persistent views re-registered")

    # Restore bot presence from DB
    presence_cfg = user_data.get("__presence__", {"type": "watching", "text": "the skies", "enabled": True})
    if presence_cfg.get("enabled", True):
        _ptype = {
            "playing":   discord.ActivityType.playing,
            "watching":  discord.ActivityType.watching,
            "listening": discord.ActivityType.listening,
            "competing": discord.ActivityType.competing,
        }.get(presence_cfg.get("type", "watching"), discord.ActivityType.watching)
        try:
            await bot.change_presence(
                activity=discord.Activity(type=_ptype, name=presence_cfg.get("text", "the skies")),
                status=discord.Status.online
            )
            safe_console_print(f"✅ Bot presence restored: {presence_cfg['type']} {presence_cfg['text']}")
        except Exception as e:
            safe_console_print(f"Presence restore error: {e}")

    # Start background tasks
    if not track_latency.is_running():
        track_latency.start()
    if not auto_reminder_flights.is_running():
        auto_reminder_flights.start()
    if not post_daily_schedule.is_running():
        post_daily_schedule.start()
    if not auto_end_flights.is_running():
        auto_end_flights.start()
    if not cleanup_old_day_messages.is_running():
        cleanup_old_day_messages.start()
    if not post_weekly_monthly_report.is_running():
        post_weekly_monthly_report.start()
    if not weekly_quota_review.is_running():
        weekly_quota_review.start()
    if not monthly_quota_reimbursement.is_running():
        monthly_quota_reimbursement.start()
    if not rotate_presence.is_running():
        rotate_presence.start()
    if not cleanup_crew_threads.is_running():
        cleanup_crew_threads.start()
    print("✅ Background tasks started (auto-end flights, cleanup day messages, reports, crew thread cleanup)")

    import auth
    auth.set_bot(bot)

bot.run(TOKEN)
