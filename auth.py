# auth.py — Discord OAuth2 for AIC PTFS Dashboard
# Handles login, callback, session validation, and role enforcement.
#
# Required env vars (in .env):
#   DISCORD_CLIENT_ID      — your app's client ID  (discord.com/developers)
#   DISCORD_CLIENT_SECRET  — your app's client secret
#   DISCORD_REDIRECT_URI   — must match exactly what's set in your Discord app
#                            e.g. http://localhost:8080/auth/callback
#   SECRET_KEY             — any long random string for signing session tokens
#   ROLE_REQUIRED          — the Discord role ID that grants dashboard access

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
REDIRECT_URI    = os.environ.get("DISCORD_REDIRECT_URI", "http://localhost:8080/auth/callback")
SECRET_KEY      = os.environ.get("SECRET_KEY", "change-me-please-use-a-long-random-string")
ROLE_REQUIRED   = int(os.environ.get("ROLE_REQUIRED", "1286900172919672873"))
GUILD_ID        = int(os.environ.get("GUILD_ID", "0"))   # set in .env — needed to fetch member roles

DISCORD_API     = "https://discord.com/api/v10"
OAUTH_SCOPES    = "identify guilds.members.read"
SESSION_TTL     = 60 * 60 * 24  # 24 hours

router = APIRouter()

# ── Session helpers ───────────────────────────────────────────────────────────
# Sessions are signed JSON blobs stored in an HttpOnly cookie.
# No server-side session store needed — the signature proves authenticity.

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
        return payload
    except Exception:
        return None

def get_session(request: Request) -> dict | None:
    token = request.cookies.get("aic_session")
    if not token:
        return None
    return _verify(token)

def require_auth(request: Request) -> dict:
    """Call inside a route to enforce login + role. Raises 401 on failure."""
    session = get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not session.get("has_role"):
        raise HTTPException(status_code=403, detail="Missing required role")
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

# ── OAuth routes ──────────────────────────────────────────────────────────────

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
        return RedirectResponse("/login.html?error=user_failed")
    user = user_resp.json()
    user_id = int(user["id"])

    # Fetch guild member to check role
    has_role = False
    if GUILD_ID:
        async with httpx.AsyncClient() as client:
            member_resp = await client.get(
                f"{DISCORD_API}/users/@me/guilds/{GUILD_ID}/member",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if member_resp.status_code == 200:
            member = member_resp.json()
            has_role = str(ROLE_REQUIRED) in [str(r) for r in member.get("roles", [])]

    avatar = user.get("avatar")
    avatar_url = (
        f"https://cdn.discordapp.com/avatars/{user_id}/{avatar}.png"
        if avatar else
        f"https://cdn.discordapp.com/embed/avatars/{int(user.get('discriminator', 0)) % 5}.png"
    )

    session_payload = {
        "user_id":   str(user_id),
        "username":  user.get("global_name") or user.get("username", "Unknown"),
        "avatar":    avatar_url,
        "has_role":  has_role,
    }

    if not has_role:
        return RedirectResponse("/login.html?error=no_role", status_code=302)

    response = RedirectResponse("/", status_code=302)
    set_session_cookie(response, session_payload)
    return response


@router.get("/auth/logout")
async def auth_logout():
    response = RedirectResponse("/login.html", status_code=302)
    response.delete_cookie("aic_session", path="/")
    return response


@router.get("/auth/me")
async def auth_me(request: Request):
    """Returns the current session as JSON — used by the dashboard JS."""
    session = get_session(request)
    if not session:
        return JSONResponse({"authenticated": False})
    return JSONResponse({
        "authenticated": True,
        "has_role":      session.get("has_role", False),
        "user_id":       session.get("user_id"),
        "username":      session.get("username"),
        "avatar":        session.get("avatar"),
    })