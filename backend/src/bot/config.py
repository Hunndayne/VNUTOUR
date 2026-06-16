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
        self.support_channel_id = self._safe_int(os.getenv("SUPPORT_ROLE"))
        # Team categories (support multiple category IDs to bypass 50-channels/category limit)
        # Accept both uppercase and legacy lowercase keys for compatibility.
        def _g(key: str):
            v = os.getenv(key)
            return self._safe_int(v) if v else None

        # Single legacy key
        legacy_single = _g("CATEGORYIDFORTEAM") or _g("categoryIDforTeam")

        # Multi-category support up to 4 (extendable later)
        multi_keys = [
            _g("CATEGORYIDFORTEAM1") or _g("categoryIDforTeam1"),
            _g("CATEGORYIDFORTEAM2") or _g("categoryIDforTeam2"),
            _g("CATEGORYIDFORTEAM3") or _g("categoryIDforTeam3"),
            _g("CATEGORYIDFORTEAM4") or _g("categoryIDforTeam4"),
        ]
        self.team_category_ids = [cid for cid in multi_keys if cid] or ([legacy_single] if legacy_single else [])
        # Backward-compat: keep single id for places that still reference it
        self.team_category_id = self.team_category_ids[0] if self.team_category_ids else None
        
        # FFmpeg configuration
        self.ffmpeg_exe = os.getenv("FFMPEG_EXE") or "ffmpeg"
        
        # Bot prefix
        self.prefix = "!"

        # Intents
        self.intents = {
            "message_content": True,
            "members": True,
            "guilds": True,
            "voice_states": True
        }

        # MongoDB configuration (optional but recommended)
        # MongoDB connection string is stored under key `MongoDB` in .env
        self.mongodb_uri = os.getenv("MongoDB")
        self.mongodb_db = os.getenv("MONGODB_DB_NAME", "vnutour")

        # Google Sheets sync configuration
        self.google_sheet_api_key = os.getenv("GoogleSheetAPI")
        self.google_sheet_id = os.getenv("GoogleSheetID")
        self.google_sheet_range = os.getenv("GOOGLE_SHEET_RANGE", "A1:K")
        # Optional: Service Account credentials for private sheets
        # Either provide path to JSON file or base64-encoded JSON content
        self.google_credentials_json = os.getenv("GOOGLE_CREDENTIALS_JSON")
        self.google_credentials_base64 = os.getenv("GOOGLE_CREDENTIALS_BASE64")
        # Optional: Specific worksheet/tab name (otherwise use first tab or specify in range like Sheet1!A1:K)
        self.google_sheet_tab = os.getenv("GOOGLE_SHEET_TAB")
        # sync interval: default 60s, minimum 30s
        try:
            interval = int(os.getenv("SHEET_SYNC_INTERVAL", "60"))
        except ValueError:
            interval = 60
        self.sheet_sync_interval = max(30, interval)
    
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




