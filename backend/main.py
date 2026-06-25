"""
VnuTourBot - Discord Bot for VNU Tour Management
Main entry point.

Can start:
- Django API only
- Django API + Discord bot

Set RUN_DISCORD_BOT=1 to enable the bot. Default is API-only for local dev.
"""
import asyncio
import sys
import os
import subprocess
import signal
from pathlib import Path


# Ensure console uses UTF-8 to avoid UnicodeEncodeError on Windows terminals
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from src.bot import VnuTourBot


def _should_run_bot() -> bool:
    return os.getenv("RUN_DISCORD_BOT", "0").lower() in {"1", "true", "yes", "on"}


def _start_django_if_enabled():
    """Start Django dev server in background if DJANGO_AUTOSTART is enabled.

    Returns a subprocess.Popen or None.
    """
    if os.getenv("DJANGO_AUTOSTART", "1").lower() not in {"1", "true", "yes", "on"}:
        return None

    try:
        repo_root = Path(__file__).resolve().parent
        manage_py = repo_root / "webapi" / "manage.py"
        if not manage_py.exists():
            print("[WEB] Skip: webapi/manage.py not found")
            return None
        host = os.getenv("DJANGO_HOST", "0.0.0.0")
        port = os.getenv("DJANGO_PORT", "8080")
        env = os.environ.copy()
        env.setdefault("DJANGO_SETTINGS_MODULE", "serverapi.settings")
        # Ensure DB schema is up to date before starting
        migrate_cmd = [sys.executable, str(manage_py), "migrate", "--noinput"]
        try:
            subprocess.check_call(migrate_cmd, cwd=str(repo_root), env=env)
        except Exception as ex:
            print(f"[WEB] migrate failed (continuing): {ex}")

        cmd = [sys.executable, str(manage_py), "runserver", f"{host}:{port}", "--noreload"]
        print(f"[WEB] Starting Django API at http://{host}:{port} ...")
        proc = subprocess.Popen(cmd, cwd=str(repo_root), env=env)
        return proc
    except Exception as e:
        print(f"[WEB] Failed to start Django: {e}")
        return None


def main():
    """Main function"""
    dj_proc = None
    try:
        # Start web API in background
        dj_proc = _start_django_if_enabled()

        if not _should_run_bot():
            print("[MAIN] RUN_DISCORD_BOT is off. Django API is running without Discord bot.")
            if dj_proc is None:
                print("[MAIN] Nothing else to run. Exiting.")
                return
            dj_proc.wait()
            return

        # Create and run bot
        bot = VnuTourBot()
        print("[MAIN] Starting VnuTourBot ...")
        bot.run_bot()

    except KeyboardInterrupt:
        print("\n[MAIN] Stopped by user")
    except Exception as e:
        print(f"[MAIN] Error while running bot: {e}")
        raise
    finally:
        # Cleanup Django process if running
        if dj_proc and dj_proc.poll() is None:
            try:
                if os.name == "nt":
                    dj_proc.terminate()
                else:
                    dj_proc.send_signal(signal.SIGTERM)
            except Exception:
                pass


if __name__ == '__main__':
    main()
