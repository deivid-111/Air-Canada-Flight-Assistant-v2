# utilities.py — Air Canada PTFS Operations Bot

import json
import random
import string
import asyncio
import traceback
from typing import Optional
from pathlib import Path
import discord
from discord import TextStyle
from discord.ext import commands
from discord.ui import Modal, TextInput, Button, View, Select
from datetime import datetime
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
    import uvicorn
    WEB_ENABLED = True
except ImportError:
    WEB_ENABLED = False

# -----------------------
# Config / Files / Globals  (read from environment / .env)
# -----------------------
DATA_FILE        = os.environ.get("DATA_FILE",        "user_data.json")
LOG_CHANNEL_ID   = int(os.environ.get("LOG_CHANNEL_ID",   "1289388932970184756"))
PUBLIC_CHANNEL_ID= int(os.environ.get("PUBLIC_CHANNEL_ID","1289381713239080960"))
ANNOUNCE_CHANNEL_ID=int(os.environ.get("ANNOUNCE_CHANNEL_ID","1289388913827385364"))
ROLE_REQUIRED    = int(os.environ.get("ROLE_REQUIRED",    "1286900172919672873"))
INTEREST_ROLE    = int(os.environ.get("INTEREST_ROLE",    "1286900760398925835"))
ADMIN_CHANNEL_ID = int(os.environ.get("ADMIN_CHANNEL_ID", "1473780252378529957"))
FONT_LIGHT       = os.environ.get("FONT_LIGHT",  "OpenSans-Light.ttf")
FONT_REGULAR     = os.environ.get("FONT_REGULAR","OpenSans-Regular.ttf")
LOG_FILE         = os.environ.get("LOG_FILE",    "utilities.log")
TOKEN            = os.environ.get("TOKEN",       "")
DASHBOARD_PORT   = int(os.environ.get("DASHBOARD_PORT", "8080"))

# -----------------------
# Bot Setup
# -----------------------
intents = discord.Intents.all()
bot = commands.Bot(command_prefix="a!", intents=intents)
allowed_mentions = discord.AllowedMentions(roles=True, users=True, everyone=True)

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
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            print(obj)
            f.write(obj + "\n")
    except Exception:
        print(obj)

def log_to_file(action: str, user: str = "system", level: str = "info"):
    """Write a structured JSON log entry for the dashboard logs viewer."""
    entry = json.dumps({
        "time": datetime.utcnow().strftime("%H:%M:%S"),
        "user": user,
        "action": action,
        "level": level
    }, ensure_ascii=False)
    safe_console_print(entry)

def generate_code(length=6):
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))

# -----------------------
# JSON load/save
# -----------------------
user_data = {}

async def load_user_data():
    global user_data
    try:
        if os.path.exists(DATA_FILE):
            async with data_lock:
                with open(DATA_FILE, "r", encoding="utf-8") as f:
                    user_data = json.load(f)
        else:
            user_data = {}
        return True
    except Exception as e:
        safe_console_print(f"❌ Error loading data file: {e}")
        user_data = {}
        return False

asyncio.get_event_loop().run_until_complete(load_user_data())

async def save_user_data(user_trigger_desc: Optional[str] = None, user=None):
    try:
        async with data_lock:
            if os.path.exists(DATA_FILE):
                try:
                    bak_name = DATA_FILE + ".bak"
                    with open(DATA_FILE, "r", encoding="utf-8") as original:
                        with open(bak_name, "w", encoding="utf-8") as bak:
                            bak.write(original.read())
                except Exception as e:
                    safe_console_print(f"❌ Could not create backup: {e}")
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(user_data, f, indent=4, ensure_ascii=False)
        if user_trigger_desc and user:
            await log_action(user, f"Saved user_data.json: {user_trigger_desc}")
        return True
    except Exception as e:
        safe_console_print(f"❌ Error saving user data: {e}")
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
    username_mention = f"<@{user.id}>" if hasattr(user, "id") else str(user)
    username_str = getattr(user, 'display_name', None) or getattr(user, 'name', None) or str(user)
    embed_obj = build_log_embed_object(username_mention, action_text, error_code)
    # Write structured log for dashboard
    level = "error" if error_code or tb_text else "info"
    log_to_file(action_text + (f" [err:{error_code}]" if error_code else ""), user=username_str, level=level)
    try:
        log_ch = None
        for g in bot.guilds:
            ch = g.get_channel(LOG_CHANNEL_ID)
            if ch:
                log_ch = ch
                break
        if log_ch:
            e = discord.Embed(description=embed_obj["embeds"][0]["description"], color=embed_obj["embeds"][0]["color"])
            e.set_image(url=embed_obj["embeds"][0]["image"]["url"])
            for fld in embed_obj["embeds"][0]["fields"]:
                e.add_field(name=fld["name"], value=fld["value"], inline=False)
            try:
                await log_ch.send(embed=e)
            except Exception as send_exc:
                safe_console_print(f"❌ Could not send log embed: {send_exc}")
    except Exception as e:
        safe_console_print(f"❌ Unexpected error in log_action: {e}")

    try:
        pretty = json.dumps(embed_obj, ensure_ascii=False, indent=2)
        safe_console_print(pretty)
        if tb_text:
            safe_console_print("Traceback:")
            safe_console_print(tb_text)
    except Exception as e:
        safe_console_print(f"❌ Error writing log: {e}")

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
    "B77W": "Boeing 777-300ER", "B77L": "Boeing 777-200LR", "A333": "Airbus A330-300",
    "B788": "Boeing 787-8", "B789": "Boeing 787-9", "A321": "Airbus A321-200",
    "B737": "Boeing 737 MAX-8", "A223": "Airbus A220-300", "A320": "Airbus A320-200",
    "A319": "Airbus A319-100", "CR9": "CRJ-900", "E75": "Embraer 175",
    "DH4J": "De Havilland Dash 8-400"
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
        title="<:AIC_Calendar:1419416309174636666>  Flight Board",
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
    def __init__(self, flights_on_day: list):
        super().__init__(timeout=None)
        self.add_item(FlightSelectMenu(flights_on_day))


class FlightSelectMenu(Select):
    def __init__(self, flights_on_day: list):
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
        super().__init__(
            placeholder="Select a flight to view details...",
            min_values=1,
            max_values=1,
            options=options,
            custom_id="flight_select_menu"
        )

    async def callback(self, interaction: discord.Interaction):
        code  = self.values[0]
        entry = user_data.get(code)
        if not entry:
            await interaction.response.send_message("⚠️ Flight not found.", ephemeral=True)
            return
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
    Stores the message ID in user_data["_day_msgs"][date_raw].
    """
    public_ch = guild.get_channel(PUBLIC_CHANNEL_ID)
    if not public_ch:
        return

    real_flights = get_real_flights()
    grouped = group_flights_by_date(real_flights)
    flights_on_day = grouped.get(date_raw, [])

    if not flights_on_day:
        return

    embed = build_day_embed(date_raw, flights_on_day)
    view = DayScheduleView(flights_on_day)

    # Storage for day message IDs
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

    # Post new message
    msg = await public_ch.send(
        content=f"<@&{INTEREST_ROLE}>",
        embed=embed,
        view=view,
        allowed_mentions=allowed_mentions
    )
    user_data["_day_msgs"][date_raw] = str(msg.id)
    await save_user_data()


# -----------------------
# ─── WEB DASHBOARD API ────────────────────────────────────────────────────────
# -----------------------

def create_api():
    if not WEB_ENABLED:
        return None

    from auth import router as auth_router, require_auth, get_session

    app = FastAPI(title="AIC PTFS Dashboard API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount auth routes (/auth/login, /auth/callback, /auth/logout, /auth/me)
    app.include_router(auth_router)

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
            "created_at": entry.get("created_at", ""),
        }

    from fastapi.responses import RedirectResponse as _Redirect

    def _file(name: str):
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), name)

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

    @app.get("/dashboard.html")
    async def serve_dashboard(request: Request):
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

        body = await request.json()

        # Allowed fields to update via API
        field_map = {
            "status": lambda v: entry.update({"status": v}),
            "alerts": lambda v: entry.update({"alerts": v}),
            "meal_service": lambda v: entry.update({"meal_service": v}),
            "gate_dep": lambda v: entry.setdefault("gate", {}).update({"dep": v}),
            "gate_arr": lambda v: entry.setdefault("gate", {}).update({"arr": v}),
            "server_link": lambda v: entry.setdefault("server", {}).update({"link": v}),
            "event_link": lambda v: entry.setdefault("event", {}).update({"link": v}),
        }

        # Valid statuses (including Ended)
        VALID_STATUSES = {"On–Time", "Delayed", "Cancelled", "Rescheduled", "N/A", "Ended"}
        if "status" in body and body["status"] not in VALID_STATUSES:
            raise HTTPException(status_code=422, detail=f"Invalid status: {body['status']}")

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
            # Refresh Discord embeds
            for g in bot.guilds:
                try:
                    await update_embeds_for_code(bot, code)
                    dep_date = entry.get("dep_date")
                    if dep_date:
                        await post_or_update_day_schedule(g, dep_date)
                    break
                except Exception:
                    pass

        return serialize_entry(code, entry)

    @app.post("/api/flights")
    async def create_flight(request: Request):
        require_auth(request)
        body = await request.json()

        required = ["flight_number","dep_city","arr_city","dep_code","arr_code",
                    "dep_airport","arr_airport","dep_time","arr_time","dep_date",
                    "duration","terminal","aircraft"]
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
            "terminal":      body["terminal"].strip(),
            "aircraft":      body["aircraft"].strip().upper(),
            "host_user_id":  body.get("host_user_id", "").strip(),
            "gate":          {"dep": "N/A", "arr": "N/A"},
            "meal_service":  body.get("meal_service", "N/A"),
            "status":        body.get("status", "N/A"),
            "alerts":        "N/A",
            "server":        {"link": "N/A"},
            "event":         {"link": body.get("event_link", "N/A") or "N/A"},
            "public_message_id":  None,
            "admin_message_id":   None,
            "created_at":    datetime.utcnow().isoformat() + "Z",
        }

        user_data[code] = entry
        await save_user_data(user_trigger_desc=f"Dashboard created flight {code}")
        session = get_session(request)
        session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
        log_to_file(f"Created flight {code} ({entry['flight_number']}) {entry['dep_code']}→{entry['arr_code']}", user=session_username, level="ok")

        for g in bot.guilds:
            try:
                await post_or_update_day_schedule(g, dep_date_stored)
            except Exception:
                pass
            try:
                admin_ch = g.get_channel(ADMIN_CHANNEL_ID)
                if admin_ch:
                    admin_embed = build_embeds_from_entry(entry, admin_view=True)
                    admin_view  = make_admin_view(code)
                    admin_msg   = await admin_ch.send(embed=admin_embed, view=admin_view)
                    entry["admin_message_id"] = str(admin_msg.id)
                    await save_user_data(user_trigger_desc=f"Dashboard auto-posted admin panel for {code}")
            except Exception as e:
                safe_console_print(f"Dashboard: could not post admin panel for {code}: {e}")
            break

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
            f"<@&{INTEREST_ROLE}>\n\n"
            f"Please select \"interested\" if attending!\n\n"
            f"Event link: {event_link}"
        )
        for g in bot.guilds:
            try:
                channel = g.get_channel(ANNOUNCE_CHANNEL_ID)
                if channel:
                    await channel.send(msg_text)
            except Exception as e:
                safe_console_print(f"Dashboard remind error: {e}")
            break
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
        for g in bot.guilds:
            try:
                await update_embeds_for_code(bot, code)
                await post_or_update_day_schedule(g, entry.get("dep_date", ""))
            except Exception as e:
                safe_console_print(f"Dashboard start — embed update error: {e}")
        for g in bot.guilds:
            try:
                channel = g.get_channel(ANNOUNCE_CHANNEL_ID)
                if channel:
                    flight_number = entry.get("flight_number", "Unknown")
                    arr_city      = entry.get("arr_city", "Unknown")
                    announce_text = (
                        f"# {flight_number} to {arr_city} has begun check-in.\n"
                        f"<@&{INTEREST_ROLE}>\n\n"
                        f"Please head to check-in at **{spawn_location or 'the airport'}**\n\n"
                        f"> <:AIC_Link:1417212068028874865> {server_link}"
                    )
                    msg = await channel.send(announce_text)
                    entry["announce_message_id"] = str(msg.id)
                    await save_user_data(user_trigger_desc=f"Dashboard announce start flight {code}")
            except Exception as e:
                safe_console_print(f"Dashboard start — announce error: {e}")
            break
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

    @app.post("/api/flights/{code}/refresh")
    async def refresh_embed(code: str, request: Request):
        """Refresh the Discord embed for a flight without any changes."""
        session = require_auth(request)
        code = code.upper()
        entry = user_data.get(code)
        if not entry or "flight_number" not in entry:
            raise HTTPException(status_code=404, detail="Flight not found")
        for g in bot.guilds:
            try:
                await update_embeds_for_code(bot, code)
                dep_date = entry.get("dep_date")
                if dep_date:
                    await post_or_update_day_schedule(g, dep_date)
                break
            except Exception as e:
                safe_console_print(f"Dashboard refresh embed error: {e}")
        # Log the action
        session_username = session.get("username", "Dashboard User") if isinstance(session, dict) else "Dashboard User"
        safe_console_print(json.dumps({
            "time": datetime.utcnow().strftime("%H:%M:%S"),
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
        for g in bot.guilds:
            try:
                await update_embeds_for_code(bot, code)
                await post_or_update_day_schedule(g, entry.get("dep_date", ""))
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
                break
            except Exception as e:
                safe_console_print(f"Dashboard close flight error: {e}")
        return {"closed": code}

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
                            "time": data.get('time', '—'),
                            "user": data.get('user', 'system'),
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
        return {
            "total": active_total,
            "ended": ended,
            "accepted": statuses.get("On–Time", 0),
            "denied": statuses.get("Cancelled", 0),
            "pending": statuses.get("N/A", 0) + statuses.get("Rescheduled", 0) + statuses.get("Delayed", 0),
            "statuses": statuses
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
        for g in bot.guilds:
            ch = g.get_channel(ANNOUNCE_CHANNEL_ID)
            if ch:
                await ch.send(message)
                sent = True
                session_username = session.get("username", "Dashboard") if isinstance(session, dict) else "Dashboard"
                log_to_file(f"Sent announcement: {message[:80]}", user=session_username, level="ok")
                break
        if not sent:
            raise HTTPException(status_code=503, detail="Announcement channel not found — is the bot running?")
        return {"sent": True}

    return app


# -----------------------
# Views / Modals — existing code preserved exactly
# -----------------------

class ConfirmView(View):
    def __init__(self, user_id, next_modal_cls, current_modal_cls, is_last_step=False):
        super().__init__(timeout=120)
        self.user_id = user_id
        self.next_modal_cls = next_modal_cls
        self.current_modal_cls = current_modal_cls
        self.is_last_step = is_last_step

    @discord.ui.button(label="Yes ✅", style=discord.ButtonStyle.success)
    async def yes_button(self, interaction: discord.Interaction, button: Button):
        try:
            await log_action(interaction.user, "Pressed ConfirmView Yes button")
        except Exception:
            pass

        if interaction.user.id != self.user_id:
            await interaction.followup.send("This is not for you!", ephemeral=True)
            return

        if self.is_last_step:
            try:
                entry = user_data.get(str(self.user_id))
                if entry is None:
                    await interaction.followup.send("⚠️ No data found for your session.", ephemeral=True)
                    return

                code = generate_code()
                while code in user_data:
                    code = generate_code()

                flight_entry = {
                    "code": code,
                    "host_user_id": self.user_id,
                    **entry,
                    "gate": {"dep": "N/A", "arr": "N/A"},
                    "meal_service": "N/A",
                    "status": "N/A",
                    "alerts": "N/A",
                    "server": {"link": "N/A"},
                    "event": {"link": "N/A"},
                    "public_message_id": None,
                    "admin_message_id": None,
                    "created_at": datetime.utcnow().isoformat() + "Z"
                }

                user_data[code] = flight_entry
                user_data[str(self.user_id) + "_pending"] = entry
                await save_user_data(user_trigger_desc=f"Finalize flight {code}", user=interaction.user)

                from PIL import Image, ImageDraw, ImageFont
                filepath = None
                try:
                    filepath = generate_ticket(entry)
                    await log_action(interaction.user, f"Ticket image created: {filepath}")
                except Exception as img_exc:
                    await handle_exception_and_report(interaction, interaction.user, "generate_ticket", img_exc)

                try:
                    if not interaction.response.is_done():
                        await interaction.response.send_message(f"Saved! Your flight code is `{code}`. Here is your flight ticket:", ephemeral=True)
                    else:
                        await interaction.followup.send(f"Saved! Your flight code is `{code}`. Here is your flight ticket:", ephemeral=True)
                    if filepath:
                        await interaction.followup.send(file=discord.File(filepath))
                except Exception as send_exc:
                    await handle_exception_and_report(interaction, interaction.user, "sending ticket file", send_exc)
            except Exception as e:
                await handle_exception_and_report(interaction, interaction.user, "ConfirmView Yes finalization", e)
        else:
            try:
                await interaction.response.send_modal(self.next_modal_cls())
            except Exception as e:
                await handle_exception_and_report(interaction, interaction.user, "opening next modal from ConfirmView", e)

    @discord.ui.button(label="No ❌", style=discord.ButtonStyle.danger)
    async def no_button(self, interaction: discord.Interaction, button: Button):
        try:
            await log_action(interaction.user, "Pressed ConfirmView No button")
        except Exception:
            pass

        if interaction.user.id != self.user_id:
            await interaction.followup.send("This is not for you!", ephemeral=True)
            return
        try:
            await interaction.response.send_modal(self.current_modal_cls())
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "re-opening modal from ConfirmView No", e)


class FlightDetailsModal1(Modal, title="Flight Details (1/3)"):
    flight_number = TextInput(label="Flight Number", placeholder="AC8810, AC8815", style=TextStyle.short)
    dep_city = TextInput(label="Departure City", placeholder="Toronto, Vancouver, Montreal", style=TextStyle.short)
    dep_date = TextInput(label="Departure Date (DDMMYYYY)", placeholder="20092025", style=TextStyle.short)
    terminal = TextInput(label="Terminal", placeholder="1, 2, 3", style=TextStyle.short)
    aircraft = TextInput(label="Aircraft (code)", placeholder="B77W, A333, B789, A321", style=TextStyle.short)

    async def on_submit(self, interaction: discord.Interaction):
        try:
            await log_action(interaction.user, "Submitted FlightDetailsModal1")
        except Exception:
            pass

        uid = interaction.user.id
        user_data[str(uid)] = {
            "flight_number": self.flight_number.value.strip(),
            "dep_city": self.dep_city.value.strip(),
            "dep_date": self.dep_date.value.strip(),
            "terminal": self.terminal.value.strip(),
            "aircraft": self.aircraft.value.strip(),
        }
        try:
            await save_user_data(user_trigger_desc="Step 1 modal submitted", user=interaction.user)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "save_user_data after FlightDetailsModal1", e)

        summary = (
            f"**Step 1 Summary:**\n"
            f"Flight Number: {self.flight_number.value}\n"
            f"Departure City: {self.dep_city.value}\n"
            f"Date: {self.dep_date.value}\n"
            f"Terminal: {self.terminal.value}\n"
            f"Aircraft: {self.aircraft.value}\n\n"
            f"Is this correct?"
        )
        try:
            await interaction.response.send_message(
                summary,
                view=ConfirmView(uid, FlightDetailsModal2, FlightDetailsModal1, is_last_step=False),
                ephemeral=True
            )
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "sending summary after FlightDetailsModal1", e)


class FlightDetailsModal2(Modal, title="Flight Details (2/3)"):
    arr_city = TextInput(label="Arrival City", placeholder="Montreal, Calgary, Ottawa", style=TextStyle.short)
    dep_airport = TextInput(label="Departure Airport", placeholder="Toronto Pearson International Airport", style=TextStyle.short)
    duration = TextInput(label="Flight Duration", placeholder="0h 45m, 1h 10m, 0h 30m", style=TextStyle.short)
    dep_time = TextInput(label="Departure Time", placeholder="10:30, 18:15, 21:30", style=TextStyle.short)

    async def on_submit(self, interaction: discord.Interaction):
        try:
            await log_action(interaction.user, "Submitted FlightDetailsModal2")
        except Exception:
            pass

        uid = interaction.user.id
        session_key = str(uid)
        if session_key not in user_data:
            await interaction.response.send_message("⚠️ Missing Step 1 data. Please start again.", ephemeral=True)
            return

        user_data[session_key].update({
            "arr_city": self.arr_city.value.strip(),
            "dep_airport": self.dep_airport.value.strip(),
            "duration": self.duration.value.strip(),
            "dep_time": self.dep_time.value.strip()
        })
        try:
            await save_user_data(user_trigger_desc="Step 2 modal submitted", user=interaction.user)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "save_user_data after FlightDetailsModal2", e)

        summary = (
            f"**Step 2 Summary:**\n"
            f"Arrival City: {self.arr_city.value}\n"
            f"Departure Airport: {self.dep_airport.value}\n"
            f"Duration: {self.duration.value}\n"
            f"Departure Time: {self.dep_time.value}\n\n"
            f"Is this correct?"
        )
        try:
            await interaction.response.send_message(
                summary,
                view=ConfirmView(uid, FlightDetailsModal3, FlightDetailsModal2, is_last_step=False),
                ephemeral=True
            )
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "sending summary after FlightDetailsModal2", e)


class FlightDetailsModal3(Modal, title="Flight Details (3/3)"):
    dep_code = TextInput(label="Departure Airport Code", placeholder="YYZ, YUL, YHZ, FRA", style=TextStyle.short)
    arr_code = TextInput(label="Arrival Airport Code", placeholder="YYZ, YUL, YHZ, FRA", style=TextStyle.short)
    arr_airport = TextInput(label="Arrival Airport", placeholder="Montréal–Trudeau International Airport", style=TextStyle.short)
    arr_time = TextInput(label="Arrival Time", placeholder="11:15, 19:30, 22:15", style=TextStyle.short)

    async def on_submit(self, interaction: discord.Interaction):
        try:
            await log_action(interaction.user, "Submitted FlightDetailsModal3")
        except Exception:
            pass

        uid = interaction.user.id
        session_key = str(uid)
        if session_key not in user_data:
            await interaction.response.send_message("⚠️ Missing Step 1/2 data. Please start again.", ephemeral=True)
            return

        user_data[session_key].update({
            "dep_code": self.dep_code.value.strip(),
            "arr_code": self.arr_code.value.strip(),
            "arr_airport": self.arr_airport.value.strip(),
            "arr_time": self.arr_time.value.strip()
        })
        try:
            await save_user_data(user_trigger_desc="Step 3 modal submitted", user=interaction.user)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "save_user_data after FlightDetailsModal3", e)

        summary = (
            f"**Step 3 Summary:**\n"
            f"Departure Code: {self.dep_code.value}\n"
            f"Arrival Code: {self.arr_code.value}\n"
            f"Arrival Airport: {self.arr_airport.value}\n"
            f"Arrival Time: {self.arr_time.value}\n\n"
            f"Is this correct?"
        )
        try:
            await interaction.response.send_message(
                summary,
                view=ConfirmView(uid, None, FlightDetailsModal3, is_last_step=True),
                ephemeral=True
            )
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "sending summary after FlightDetailsModal3", e)


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
    safe_console_print(str(base.size))
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
            dep_date = entry.get("dep_date")
            if dep_date and interaction.guild:
                await post_or_update_day_schedule(interaction.guild, dep_date)
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
            if interaction.guild:
                await post_or_update_day_schedule(interaction.guild, entry.get("dep_date", ""))
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
            f"<@&{INTEREST_ROLE}>\n\n"
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
            if interaction.guild:
                await post_or_update_day_schedule(interaction.guild, entry.get("dep_date", ""))
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
                f"<@&{INTEREST_ROLE}>\n\n"
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
            admin_ch = interaction.client.get_channel(ADMIN_CHANNEL_ID)
            if admin_ch and entry.get("admin_message_id"):
                admin_msg = await fetch_message_with_retries(admin_ch, int(entry["admin_message_id"]))
                if admin_msg:
                    await admin_msg.edit(
                        embed=build_embeds_from_entry(entry, admin_view=True),
                        view=make_admin_view(code)
                    )
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
            admin_ch = interaction.client.get_channel(ADMIN_CHANNEL_ID)
            if admin_ch and entry.get("admin_message_id"):
                admin_msg = await fetch_message_with_retries(admin_ch, int(entry["admin_message_id"]))
                if admin_msg:
                    await admin_msg.edit(
                        embed=build_embeds_from_entry(entry, admin_view=True),
                        view=make_admin_view(code)
                    )
            if interaction.guild:
                await post_or_update_day_schedule(interaction.guild, entry.get("dep_date", ""))
            await interaction.followup.send(f"Status set to {self.values[0]}.", ephemeral=True)
        except Exception as e:
            await handle_exception_and_report(interaction, interaction.user, "status select callback", e)


def make_admin_view(code: str):
    v     = View(timeout=None)
    entry = user_data.get(code)
    v.add_item(Button(label="Set Departure & Arrival Gate", style=discord.ButtonStyle.primary,   custom_id=f"set_gates:{code}",    row=0))
    v.add_item(Button(label="Set Alerts",                   style=discord.ButtonStyle.success,   custom_id=f"set_alerts:{code}",   row=1))
    v.add_item(Button(label="Send Reminder",                style=discord.ButtonStyle.danger,    custom_id=f"send_reminder:{code}",row=1))
    v.add_item(Button(label="Flight Not Started",           style=discord.ButtonStyle.secondary, custom_id=f"not_started:{code}",  row=2))
    v.add_item(Button(label="Start Flight",                 style=discord.ButtonStyle.success,   custom_id=f"start_flight:{code}", row=2))
    v.add_item(Button(label="Close Flight",                 style=discord.ButtonStyle.danger,    custom_id=f"close_flight:{code}", row=2))
    meal_select     = MealServiceSelect(code, default=entry.get("meal_service") if entry else None)
    meal_select.row = 3
    v.add_item(meal_select)
    status_select     = StatusSelect(code, default=entry.get("status") if entry else None)
    status_select.row = 4
    v.add_item(status_select)
    return v


def build_embeds_from_entry(entry: dict, admin_view: bool = False) -> discord.Embed:
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
    if admin_view:
        embed.description = (embed.description or "") + "\n-# Administrator View"
    return embed


async def fetch_message_with_retries(channel, message_id: int, attempts: int = 3, delay: float = 0.5):
    for i in range(attempts):
        try:
            return await channel.fetch_message(message_id)
        except Exception:
            await asyncio.sleep(delay * (i + 1))
    return None


async def update_embeds_for_code(client: commands.Bot, code: str):
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
                        await msg.edit(embed=build_embeds_from_entry(entry, admin_view=False))
                except Exception:
                    pass
            adm_ch = g.get_channel(ADMIN_CHANNEL_ID)
            if adm_ch and entry.get("admin_message_id"):
                try:
                    adm_msg = await fetch_message_with_retries(adm_ch, int(entry["admin_message_id"]))
                    if adm_msg:
                        await adm_msg.edit(
                            embed=build_embeds_from_entry(entry, admin_view=True),
                            view=make_admin_view(code)
                        )
                except Exception:
                    pass
            break
    except Exception as e:
        safe_console_print(f"Error updating embeds: {e}")


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
                if interaction.guild:
                    await post_or_update_day_schedule(interaction.guild, entry.get("dep_date", ""))
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
@bot.event
async def on_ready():
    try:
        await bot.tree.sync()
    except Exception as e:
        safe_console_print(f"Warning: could not sync commands: {e}")
    print(f"✅ Logged in as {bot.user}")

    if WEB_ENABLED:
        api = create_api()
        config = uvicorn.Config(api, host="localhost", port=DASHBOARD_PORT, log_level="warning")
        server = uvicorn.Server(config)
        asyncio.create_task(server.serve())
        print(f"✅ Dashboard API running on http://0.0.0.0:{DASHBOARD_PORT}")
    else:
        print("⚠️  FastAPI/uvicorn not installed — dashboard API disabled. Run: pip install fastapi uvicorn")


bot.run(TOKEN)