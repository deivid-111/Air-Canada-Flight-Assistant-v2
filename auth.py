import os
import hmac
import json
import time
import base64
import hashlib
import urllib.parse
import httpx

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse, HTMLResponse

# ── Config ────────────────────────────────────────────────────────────────────
CLIENT_ID       = os.environ.get("DISCORD_CLIENT_ID", "")
CLIENT_SECRET   = os.environ.get("DISCORD_CLIENT_SECRET", "")
REDIRECT_URI    = os.environ.get("DISCORD_REDIRECT_URI")
SECRET_KEY      = os.environ.get("SECRET_KEY", "change-me-please-use-a-long-random-string")
HOSTER_ROLE     = int(os.environ.get("HOSTER_ROLE",   "1473903876100067461"))  # Flights + Calendar
MANAGER_ROLE    = int(os.environ.get("MANAGER_ROLE",  "1473903917854363723"))  # + Analytics, Hosts, Logs
BOD_ROLE        = int(os.environ.get("BOD_ROLE",       "0"))                    # BOD — everything except diagnostics
GUILD_ID        = int(os.environ.get("GUILD_ID",      "1473903426789179426"))
OWNER_ID        = "767865431712333874"  # full access including Diagnostics

DISCORD_API     = "https://discord.com/api/v10"
OAUTH_SCOPES    = "identify guilds.members.read"
SESSION_TTL     = 60 * 60 * 24

router = APIRouter()

# ── Bot reference (injected at startup) ──────────────────────────────────────
# Set by calling auth.set_bot(bot) inside on_ready in utilities.py / bot runner.
# Never import utilities here — it triggers asyncio.run() and crashes FastAPI.
_bot_instance = None

def set_bot(bot) -> None:
    """Called once by the bot runner after on_ready fires."""
    global _bot_instance
    _bot_instance = bot

# ── Session tracking (in-memory) ─────────────────────────────────────────────
# Maps user_id → { username, avatar, role, logged_in_at, last_seen }
# Updated on every login and every authenticated request.
_active_sessions: dict[str, dict] = {}

# Blocklist — user_ids that are force-logged-out. Cleared on bot restart.
# Persistent blocklist (survives restart) stored in DB via utilities user_data.
_blocklist: set[str] = set()

def _auth_debug(message: str):
    """Print lightweight auth/permission diagnostics to the console and log file."""
    ts = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
    line = f"[AUTH DEBUG {ts} UTC] {message}"
    try:
        print(line, flush=True)
    except Exception:
        pass
    try:
        from utilities import log_to_file
        log_to_file(line, user="auth", level="warn")
    except Exception:
        pass

def _load_blocklist():
    """Load persisted blocklist from utilities user_data on startup."""
    try:
        from utilities import user_data
        for uid in user_data.get("__blocklist__", []):
            _blocklist.add(str(uid))
    except Exception:
        pass

def _save_blocklist():
    """Persist blocklist to utilities user_data."""
    try:
        import asyncio
        from utilities import user_data, save_user_data
        user_data["__blocklist__"] = list(_blocklist)
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(save_user_data(user_trigger_desc="blocklist update"))
        else:
            loop.run_until_complete(save_user_data(user_trigger_desc="blocklist update"))
    except Exception:
        pass

# ── Session helpers ───────────────────────────────────────────────────────────

def _sign(payload: dict) -> str:
    raw   = json.dumps(payload, separators=(",", ":")).encode()
    b64   = base64.urlsafe_b64encode(raw).decode()
    sig   = hmac.new(SECRET_KEY.encode(), b64.encode(), hashlib.sha256).hexdigest()
    return f"{b64}.{sig}"

def _verify(token: str) -> dict | None:
    try:
        b64, sig = token.rsplit(".", 1)
        expected = hmac.new(SECRET_KEY.encode(), b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(base64.urlsafe_b64decode(b64))
        if payload.get("exp", 0) < time.time():
            return None
        # Check blocklist
        if str(payload.get("user_id", "")) in _blocklist:
            return None
        # Update last_seen for tracked sessions
        uid = str(payload.get("user_id", ""))
        if uid and uid in _active_sessions:
            _active_sessions[uid]["last_seen"] = int(time.time())
        return payload
    except Exception:
        return None

def get_session(request: Request) -> dict | None:
    token = request.cookies.get("aic_session")
    if not token:
        return None
    return _verify(token)

def require_auth(request: Request) -> dict:
    """Enforce login + at least hoster or manager or owner. Raises 401/403 on failure."""
    session = get_session(request)
    if not session:
        _auth_debug("Denied access: no valid session cookie present")
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not (session.get("is_hoster") or session.get("is_manager") or session.get("is_bod") or session.get("is_owner")):
        _auth_debug(
            "Denied access: session missing required role flags "
            f"(user_id={session.get('user_id')}, username={session.get('username')}, "
            f"is_hoster={session.get('is_hoster')}, is_manager={session.get('is_manager')}, "
            f"is_bod={session.get('is_bod')}, is_owner={session.get('is_owner')})"
        )
        raise HTTPException(status_code=403, detail="Missing required role")
    return session

def require_manager(request: Request) -> dict:
    """Enforce login + manager or owner. Raises 403 otherwise."""
    session = require_auth(request)
    if not (session.get("is_manager") or session.get("is_owner")):
        raise HTTPException(status_code=403, detail="Manager role required")
    return session

def require_bod(request: Request) -> dict:
    """Enforce login + BOD, manager, or owner."""
    session = require_auth(request)
    if not (session.get("is_bod") or session.get("is_manager") or session.get("is_owner")):
        raise HTTPException(status_code=403, detail="BOD role required")
    return session

def require_owner(request: Request) -> dict:
    """Enforce login + owner only."""
    session = get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not session.get("is_owner"):
        raise HTTPException(status_code=403, detail="Owner access required")
    return session

def set_session_cookie(response, payload: dict):
    payload["exp"] = int(time.time()) + SESSION_TTL
    token = _sign(payload)
    response.set_cookie(
        key="aic_session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_TTL,
        path="/"
    )

async def _resolve_roles_via_bot(user_id: int) -> tuple[bool, bool, bool]:
    """
    Fallback role lookup using the running bot's guild member data.
    Uses _bot_instance injected via set_bot() — never imports utilities directly,
    as that triggers asyncio.run() which crashes inside FastAPI's event loop.
    """
    try:
        if _bot_instance is None or not _bot_instance.is_ready():
            _auth_debug(f"Bot fallback skipped: bot not injected or not ready (user_id={user_id})")
            return False, False, False

        import discord as _discord
        guild = _discord.utils.get(_bot_instance.guilds, id=GUILD_ID)
        if not guild:
            _auth_debug(
                f"Bot fallback: guild {GUILD_ID} not found — "
                f"bot is in guilds: {[g.id for g in _bot_instance.guilds]}"
            )
            return False, False, False

        member = guild.get_member(user_id)
        if member is None:
            try:
                member = await guild.fetch_member(user_id)
            except Exception as e:
                _auth_debug(f"Bot fallback: fetch_member failed for user_id={user_id}: {e}")
                return False, False, False

        role_ids = [r.id for r in member.roles]
        fb_hoster  = HOSTER_ROLE in role_ids
        fb_manager = MANAGER_ROLE in role_ids
        fb_bod     = bool(BOD_ROLE) and BOD_ROLE in role_ids
        _auth_debug(
            f"Bot fallback: resolved roles for user_id={user_id}: role_ids={role_ids}, "
            f"hoster={fb_hoster}, manager={fb_manager}, bod={fb_bod}"
        )
        return fb_hoster, fb_manager, fb_bod


    except Exception as e:
        _auth_debug(f"Bot fallback: unexpected error for user_id={user_id}: {e}")
        return False, False, False

# ── OAuth routes ──────────────────────────────────────────────────────────────

@router.get("/auth/version")
async def auth_version():
    """Version check — confirms new auth.py is loaded."""
    return {"version": "2.0", "routes": ["switchable", "switch", "impersonate"]}


@router.get("/auth/login")
async def auth_login(request: Request):
    """Redirect the browser to Discord's OAuth2 consent screen."""
    if not CLIENT_ID:
        return HTMLResponse(
            "<h2>OAuth not configured</h2>"
            "<p>Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI in your .env file.</p>",
            status_code=503
        )
    params = urllib.parse.urlencode({
        "client_id":     CLIENT_ID,
        "redirect_uri":  REDIRECT_URI,
        "response_type": "code",
        "scope":         OAUTH_SCOPES,
    })
    return RedirectResponse(f"https://discord.com/oauth2/authorize?{params}")


@router.get("/auth/callback")
async def auth_callback(request: Request, code: str = None, error: str = None):
    """Discord redirects here after the user authorises (or denies)."""
    if error or not code:
        return RedirectResponse("/login.html?error=cancelled")

    # Exchange code for access token
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            f"{DISCORD_API}/oauth2/token",
            data={
                "client_id":     CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "grant_type":    "authorization_code",
                "code":          code,
                "redirect_uri":  REDIRECT_URI,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if token_resp.status_code != 200:
        return RedirectResponse("/login.html?error=token_failed")
    tokens = token_resp.json()
    access_token = tokens["access_token"]

    # Fetch user identity
    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            f"{DISCORD_API}/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if user_resp.status_code != 200:
        _auth_debug(f"OAuth user fetch failed: status={user_resp.status_code}")
        return RedirectResponse("/login.html?error=user_failed")
    user = user_resp.json()
    user_id = int(user["id"])

    is_owner   = str(user_id) == OWNER_ID
    is_hoster  = False
    is_manager = False
    is_bod     = False
    member_lookup_ok = False

    if GUILD_ID:
        async with httpx.AsyncClient() as client:
            member_resp = await client.get(
                f"{DISCORD_API}/users/@me/guilds/{GUILD_ID}/member",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if member_resp.status_code != 200:
            _auth_debug(
                f"OAuth guild member lookup failed for user_id={user_id}: "
                f"status={member_resp.status_code}"
            )
        if member_resp.status_code == 200:
            member = member_resp.json()
            member_roles = [str(r) for r in member.get("roles", [])]
            is_hoster  = str(HOSTER_ROLE)  in member_roles
            is_manager = str(MANAGER_ROLE) in member_roles
            is_bod     = BOD_ROLE and str(BOD_ROLE) in member_roles
            member_lookup_ok = True
            _auth_debug(
                f"OAuth roles for user_id={user_id}: roles={member_roles}, "
                f"hoster_match={is_hoster}, manager_match={is_manager}, bod_match={bool(is_bod)}"
            )

    if GUILD_ID and (not member_lookup_ok or not (is_hoster or is_manager or is_bod)):
        fb_hoster, fb_manager, fb_bod = await _resolve_roles_via_bot(user_id)
        is_hoster  = is_hoster  or fb_hoster
        is_manager = is_manager or fb_manager
        is_bod     = is_bod     or fb_bod
        _auth_debug(
            f"Bot fallback roles for user_id={user_id}: "
            f"hoster={fb_hoster}, manager={fb_manager}, bod={fb_bod}"
        )

    # Elevated staff should inherit normal dashboard access even if they do not
    # also hold the base hoster role explicitly.
    if is_manager or is_bod:
        is_hoster = True

    # Owner always gets full access regardless of Discord roles
    if is_owner:
        is_hoster  = True
        is_manager = True
        is_bod     = True

    # Must have at least one role (or be owner) to enter
    if not is_hoster and not is_manager and not is_bod and not is_owner:
        _auth_debug(
            f"Login denied for user_id={user_id}: no matching dashboard role "
            f"(HOSTER_ROLE={HOSTER_ROLE}, MANAGER_ROLE={MANAGER_ROLE}, BOD_ROLE={BOD_ROLE}, "
            f"is_owner={is_owner})"
        )
        return RedirectResponse("/login.html?error=no_role", status_code=302)

    avatar = user.get("avatar")
    avatar_url = (
        f"https://cdn.discordapp.com/avatars/{user_id}/{avatar}.png"
        if avatar else
        f"https://cdn.discordapp.com/embed/avatars/{int(user.get('discriminator', 0)) % 5}.png"
    )

    session_payload = {
        "user_id":    str(user_id),
        "username":   user.get("global_name") or user.get("username", "Unknown"),
        "avatar":     avatar_url,
        "is_hoster":  is_hoster,
        "is_manager": is_manager,
        "is_bod":     is_bod,
        "is_owner":   is_owner,
        # has_role kept for any existing require_auth() calls in utilities.py
        "has_role":   True,
    }

    # Log the session start + track in active sessions
    role_tag = "owner" if is_owner else ("bod" if is_bod else ("manager" if is_manager else "hoster"))
    try:
        from utilities import log_to_file
        log_to_file(f"Session started [{role_tag}]", user=session_payload["username"], level="info")
    except Exception:
        pass

    _active_sessions[str(user_id)] = {
        "user_id":      str(user_id),
        "username":     session_payload["username"],
        "avatar":       avatar_url,
        "role":         role_tag,
        "logged_in_at": int(time.time()),
        "last_seen":    int(time.time()),
    }

    response = RedirectResponse("/loading.html", status_code=302)
    set_session_cookie(response, session_payload)
    return response


@router.get("/auth/logout")
async def auth_logout(request: Request):
    session = get_session(request)
    if session:
        uid = str(session.get("user_id", ""))
        _active_sessions.pop(uid, None)
        try:
            from utilities import log_to_file
            log_to_file("Session ended (logout)", user=session.get("username", uid), level="info")
        except Exception:
            pass
    response = RedirectResponse("/login.html", status_code=302)
    response.delete_cookie("aic_session", path="/")
    return response


@router.get("/auth/sessions")
async def list_sessions(request: Request):
    """List all tracked active sessions. Owner only."""
    session = get_session(request)
    if not session or not session.get("is_owner"):
        raise HTTPException(status_code=403, detail="Owner access required")
    now = int(time.time())
    sessions = []
    for uid, s in _active_sessions.items():
        sessions.append({
            **s,
            "is_blocked":    uid in _blocklist,
            "is_current":    uid == str(session.get("user_id", "")),
            "idle_minutes":  round((now - s.get("last_seen", now)) / 60),
            "session_age_h": round((now - s.get("logged_in_at", now)) / 3600, 1),
        })
    sessions.sort(key=lambda s: s.get("last_seen", 0), reverse=True)
    return JSONResponse({"sessions": sessions, "blocked": list(_blocklist)})


@router.post("/auth/sessions/revoke")
async def revoke_session(request: Request):
    """Force-logout a user by adding them to the blocklist. Owner only."""
    session = get_session(request)
    if not session or not session.get("is_owner"):
        raise HTTPException(status_code=403, detail="Owner access required")
    body = await request.json()
    target_uid = str(body.get("user_id", ""))
    if not target_uid:
        raise HTTPException(status_code=422, detail="Missing user_id")
    owner_uid = str(session.get("user_id", ""))
    if target_uid == owner_uid:
        raise HTTPException(status_code=400, detail="Cannot revoke your own session")
    _blocklist.add(target_uid)
    _active_sessions.pop(target_uid, None)
    _save_blocklist()
    try:
        from utilities import log_to_file
        target_name = body.get("username", target_uid)
        log_to_file(f"Force-logged out {target_name} ({target_uid})", user=session.get("username", owner_uid), level="warn")
    except Exception:
        pass
    return JSONResponse({"revoked": target_uid})


@router.post("/auth/sessions/unblock")
async def unblock_session(request: Request):
    """Remove a user from the blocklist so they can log in again. Owner only."""
    session = get_session(request)
    if not session or not session.get("is_owner"):
        raise HTTPException(status_code=403, detail="Owner access required")
    body = await request.json()
    target_uid = str(body.get("user_id", ""))
    if not target_uid:
        raise HTTPException(status_code=422, detail="Missing user_id")
    _blocklist.discard(target_uid)
    _save_blocklist()
    try:
        from utilities import log_to_file
        log_to_file(f"Unblocked user {target_uid}", user=session.get("username", "owner"), level="info")
    except Exception:
        pass
    return JSONResponse({"unblocked": target_uid})


@router.get("/auth/me")
async def auth_me(request: Request):
    """Returns the current session as JSON — used by the dashboard JS."""
    session = get_session(request)
    if not session:
        return JSONResponse({"authenticated": False})
    return JSONResponse({
        "authenticated":   True,
        "is_hoster":       session.get("is_hoster",  False),
        "is_manager":      session.get("is_manager", False),
        "is_bod":          session.get("is_bod",     False),
        "is_owner":        session.get("is_owner",   False),
        "user_id":         session.get("user_id"),
        "username":        session.get("username"),
        "avatar":          session.get("avatar"),
        "impersonated_by": session.get("impersonated_by"),
    })


@router.post("/auth/impersonate/{user_id}")
async def impersonate_user(user_id: str, request: Request):
    """Owner-only: create a session cookie for any guild member."""
    session = get_session(request)
    if not session or not session.get("is_owner"):
        raise HTTPException(status_code=403, detail="Owner access required")

    try:
        from utilities import bot, GUILD_ID, HOSTER_ROLE, MANAGER_ROLE, BOD_ROLE, OWNER_ID, log_to_file
        import discord as _discord
        g = _discord.utils.get(bot.guilds, id=GUILD_ID)
        if not g:
            raise HTTPException(status_code=503, detail="Bot not in guild")
        # Try cache first, then fetch from Discord API if not cached
        member = g.get_member(int(user_id))
        if not member:
            try:
                member = await g.fetch_member(int(user_id))
            except Exception:
                raise HTTPException(status_code=404, detail="Member not found in guild")

        role_ids    = [r.id for r in member.roles]
        is_owner    = str(member.id) == str(OWNER_ID)
        is_manager  = MANAGER_ROLE in role_ids
        is_bod      = BOD_ROLE and BOD_ROLE in role_ids
        is_hoster   = HOSTER_ROLE in role_ids or is_manager or is_bod or is_owner
        avatar_hash = member.display_avatar.url if member.display_avatar else \
                      f"https://cdn.discordapp.com/embed/avatars/0.png"

        payload = {
            "user_id":      str(member.id),
            "username":     member.display_name or member.name,
            "avatar":       str(avatar_hash),
            "is_hoster":    is_hoster,
            "is_manager":   is_manager,
            "is_bod":       bool(is_bod),
            "is_owner":     is_owner,
            "has_role":     True,
            "impersonated_by": str(session.get("user_id")),
        }

        owner_name = session.get("username", "owner")
        log_to_file(
            f"Impersonating {payload['username']} ({user_id})",
            user=owner_name, level="warn"
        )

        response = JSONResponse({"ok": True, "username": payload["username"], "redirect": "/"})
        set_session_cookie(response, payload)
        return response

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.post("/auth/impersonate-stop")
async def stop_impersonation(request: Request):
    """Restore the original owner session after impersonation."""
    session = get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    impersonated_by = session.get("impersonated_by")
    if not impersonated_by:
        raise HTTPException(status_code=400, detail="Not currently impersonating")

    # Re-mint the owner's own session
    try:
        from utilities import bot, GUILD_ID, HOSTER_ROLE, MANAGER_ROLE, BOD_ROLE, OWNER_ID, log_to_file
        import discord as _discord
        g = _discord.utils.get(bot.guilds, id=GUILD_ID)
        owner_member = g.get_member(int(impersonated_by)) if g else None
        if not owner_member:
            # Fall back — just redirect to login
            response = RedirectResponse("/auth/login", status_code=302)
            response.delete_cookie("aic_session", path="/")
            return response

        payload = {
            "user_id":    str(owner_member.id),
            "username":   owner_member.display_name or owner_member.name,
            "avatar":     str(owner_member.display_avatar.url),
            "is_hoster":  True,
            "is_manager": True,
            "is_bod":     True,
            "is_owner":   True,
            "has_role":   True,
        }
        log_to_file("Stopped impersonation", user=payload["username"], level="info")
        response = JSONResponse({"ok": True, "redirect": "/dashboard/owner"})
        set_session_cookie(response, payload)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))