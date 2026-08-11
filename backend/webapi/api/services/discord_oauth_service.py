"""Discord OAuth2 + guild lookup for the web "Connect Discord" button.

The heavy lifting of the link itself stays in ``discord_service`` — this module
only speaks HTTP to Discord: exchange the authorization code, read the authorized
user, and (with the bot token) check whether that user is actually in the guild.
The scope is ``identify`` only; we never ask to join the server on the user's
behalf, so a participant must join the server themselves first.
"""

from __future__ import annotations

import os

import requests

DISCORD_API = "https://discord.com/api/v10"
OAUTH_SCOPE = "identify"
_HTTP_TIMEOUT = 10


class DiscordOAuthError(Exception):
    """Carries a stable ``code`` the view maps to an HTTP response."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _client_id() -> str | None:
    return (os.getenv("DISCORD_CLIENT_ID") or "").strip() or None


def _client_secret() -> str | None:
    return (os.getenv("DISCORD_CLIENT_SECRET") or "").strip() or None


def allowed_redirect_uris() -> list[str]:
    raw = os.getenv("DISCORD_OAUTH_REDIRECT_URIS") or ""
    return [uri.strip() for uri in raw.split(",") if uri.strip()]


def invite_url() -> str | None:
    return (os.getenv("DISCORD_INVITE_URL") or "").strip() or None


def is_configured() -> bool:
    """OAuth can run only with a client id, secret, and at least one redirect."""
    return bool(_client_id() and _client_secret() and allowed_redirect_uris())


def oauth_config() -> dict:
    """Public, non-secret bits the frontend needs to build the authorize URL."""
    return {
        "configured": is_configured(),
        "client_id": _client_id(),
        "scope": OAUTH_SCOPE,
        "invite_url": invite_url(),
    }


def _display_name(user: dict) -> str | None:
    """Prefer the @handle; keep the legacy ``name#1234`` form when it still applies."""
    username = (user.get("username") or "").strip()
    if not username:
        return (user.get("global_name") or "").strip() or None
    discriminator = str(user.get("discriminator") or "0")
    if discriminator not in ("", "0"):
        return f"{username}#{discriminator}"
    return username


def exchange_code(code: str, redirect_uri: str) -> str:
    """Trade an authorization code for an access token; return the token string."""
    if not is_configured():
        raise DiscordOAuthError("discord_oauth_not_configured")
    if redirect_uri not in allowed_redirect_uris():
        raise DiscordOAuthError("redirect_uri_not_allowed")

    try:
        resp = requests.post(
            f"{DISCORD_API}/oauth2/token",
            data={
                "client_id": _client_id(),
                "client_secret": _client_secret(),
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=_HTTP_TIMEOUT,
        )
    except requests.RequestException:
        raise DiscordOAuthError("discord_unreachable")

    if resp.status_code != 200:
        # Bad/expired/reused code, or redirect mismatch on Discord's side.
        raise DiscordOAuthError("invalid_code")

    token = (resp.json() or {}).get("access_token")
    if not token:
        raise DiscordOAuthError("invalid_code")
    return token


def fetch_discord_user(access_token: str) -> dict:
    """Read the authorized user; return ``{id, username, display}``."""
    try:
        resp = requests.get(
            f"{DISCORD_API}/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=_HTTP_TIMEOUT,
        )
    except requests.RequestException:
        raise DiscordOAuthError("discord_unreachable")

    if resp.status_code != 200:
        raise DiscordOAuthError("discord_user_fetch_failed")

    data = resp.json() or {}
    user_id = data.get("id")
    if not user_id:
        raise DiscordOAuthError("discord_user_fetch_failed")
    return {
        "id": int(user_id),
        "username": data.get("username") or "",
        "display": _display_name(data),
    }


def lookup_guild_member(discord_id: int) -> dict:
    """Is ``discord_id`` in the configured guild? Uses the bot token.

    Returns ``{"configured": bool, "in_guild": bool|None, "display": str|None}``.
    ``in_guild`` is ``None`` when we cannot tell (bot token/guild not set, or
    Discord unreachable) so the caller can degrade gracefully rather than claim
    the user is missing.
    """
    bot_token = (os.getenv("DISCORD_TOKEN") or "").strip()
    guild_id = (os.getenv("DISCORD_GUILD_ID") or "").strip()
    if not bot_token or not guild_id:
        return {"configured": False, "in_guild": None, "display": None}

    try:
        resp = requests.get(
            f"{DISCORD_API}/guilds/{guild_id}/members/{int(discord_id)}",
            headers={"Authorization": f"Bot {bot_token}"},
            timeout=_HTTP_TIMEOUT,
        )
    except (requests.RequestException, ValueError):
        return {"configured": True, "in_guild": None, "display": None}

    if resp.status_code == 200:
        data = resp.json() or {}
        user = data.get("user") or {}
        display = data.get("nick") or _display_name(user)
        return {"configured": True, "in_guild": True, "display": display}
    if resp.status_code == 404:
        return {"configured": True, "in_guild": False, "display": None}
    # 401/403/429/5xx — we simply don't know.
    return {"configured": True, "in_guild": None, "display": None}
