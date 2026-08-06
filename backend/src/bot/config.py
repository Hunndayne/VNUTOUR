"""
Bot configuration management
"""
import os
from pathlib import Path
from dotenv import load_dotenv


class BotConfig:
    """Bot configuration class"""
    
    def __init__(self):
        # Load environment variables
        load_dotenv(Path(__file__).parent.parent.parent / ".env")
        
        # Bot token
        self.token = os.getenv("DISCORD_TOKEN")
        if not self.token:
            raise RuntimeError("Thiếu DISCORD_TOKEN trong .env")
        
        # Channel IDs
        self.welcome_channel_id = self._safe_int(os.getenv("WELCOME_CHANNEL_ID"))
        self.log_channel_id = self._safe_int(os.getenv("LOG_CHANNEL_ID"))
        self.support_channel_id = self._safe_int(os.getenv("SUPPORT_CHANNEL_ID"))
        self.start_here_channel_id = self._safe_int(os.getenv("START_HERE_CHANNEL_ID"))
        self.rules_channel_id = self._safe_int(os.getenv("RULES_CHANNEL_ID"))
        # Prefer a comma-separated list; retain the old numbered keys only so
        # an existing server can be migrated without recreating categories.
        def _g(key: str):
            v = os.getenv(key)
            return self._safe_int(v) if v else None

        configured_categories = [
            self._safe_int(value.strip())
            for value in os.getenv("TEAM_CATEGORY_IDS", "").split(",")
            if value.strip()
        ]
        legacy_categories = [
            _g("CATEGORYIDFORTEAM1") or _g("categoryIDforTeam1"),
            _g("CATEGORYIDFORTEAM2") or _g("categoryIDforTeam2"),
            _g("CATEGORYIDFORTEAM3") or _g("categoryIDforTeam3"),
            _g("CATEGORYIDFORTEAM4") or _g("categoryIDforTeam4"),
            _g("CATEGORYIDFORTEAM") or _g("categoryIDforTeam"),
        ]
        self.team_category_ids = [cid for cid in configured_categories if cid] or [
            cid for cid in legacy_categories if cid
        ]
        self.team_category_id = self.team_category_ids[0] if self.team_category_ids else None
        
        # FFmpeg configuration
        self.ffmpeg_exe = os.getenv("FFMPEG_EXE") or "ffmpeg"
        
        # Bot prefix
        self.prefix = os.getenv("DISCORD_COMMAND_PREFIX", "!")

        # Intents
        self.intents = {
            "message_content": True,
            "members": True,
            "guilds": True,
            "voice_states": True
        }

        # PostgreSQL-backed web integration
        self.guild_id = self._safe_int(os.getenv("DISCORD_GUILD_ID"))
        self.web_base_url = (os.getenv("WEB_BASE_URL") or "").rstrip("/")
        try:
            interval = int(os.getenv("DISCORD_SYNC_INTERVAL", "10"))
        except ValueError:
            interval = 10
        self.discord_sync_interval = max(5, interval)
    
    def _safe_int(self, value: str) -> int:
        """Safely convert string to int"""
        try:
            return int(value) if value else None
        except (ValueError, TypeError):
            return None
    
    def get_intents(self):
        """Get Discord intents configuration"""
        import discord
        intents = discord.Intents.default()
        for key, value in self.intents.items():
            setattr(intents, key, value)
        return intents

