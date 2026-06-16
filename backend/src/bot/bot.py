"""
Main bot class
"""
import discord
from discord.ext import commands
from .config import BotConfig
from .logger import BotLogger
from ..utils import MongoManager
from .sync import SheetSyncer


class VnuTourBot(commands.Bot):
    """Main bot class with commands support"""
    
    def __init__(self):
        config = BotConfig()
        super().__init__(
            command_prefix=config.prefix,
            intents=config.get_intents(),
            help_command=None
        )
        
        self.config = config
        self.logger = BotLogger(self)
        self.prefix = config.prefix
        self.mongo = None
        self.sheet_syncer = None
        
        # Initialize components
        self._setup_events()
        self._setup_commands()

        # Initialize MongoDB if configured
        try:
            if self.config.mongodb_uri:
                self.mongo = MongoManager(self.config.mongodb_uri, self.config.mongodb_db)
                print("[DB] Kết nối MongoDB thành công")
            else:
                print("[DB] Chưa cấu hình MongoDB (bỏ qua)")
        except Exception as e:
            print(f"[DB ERROR] Không thể kết nối MongoDB: {e}")
    
    def _setup_events(self):
        """Setup bot event handlers"""
        from ..events import setup_events
        setup_events(self)
    
    def _setup_commands(self):
        """Setup bot commands"""
        from ..commands import setup_commands
        setup_commands(self)
        
        # Setup slash commands
        from ..commands import setup_slash_commands
        setup_slash_commands(self)
        
    
    async def setup_hook(self):
        """Called when the bot is starting up"""
        await self.logger.log("Bot đang khởi động...")
        
        # Setup Google Sheet sync as Cog
        try:
            from .sheet_cog import setup_sheet_sync
            await setup_sheet_sync(self)
        except Exception as e:
            print(f"[SHEET SYNC] Không thể khởi tạo Cog: {e}")
        
        # Sync slash commands with Discord
        try:
            synced = await self.tree.sync()
            await self.logger.log(f"Đã đồng bộ {len(synced)} slash command(s)")
            print(f"[BOT] Đã đồng bộ {len(synced)} slash command(s)")
        except Exception as e:
            await self.logger.log(f"Lỗi đồng bộ slash commands: {e}")
            print(f"[BOT ERROR] Lỗi đồng bộ slash commands: {e}")
    
    async def on_ready(self):
        """Called when the bot is ready"""
        await self.logger.log(f"Bot đã sẵn sàng! Đăng nhập với tên: {self.user}")
        print(f"[BOT] Đã đăng nhập với tên: {self.user}")
        
        # Set bot status
        await self.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.watching,
                name="!help để xem lệnh"
            )
        )
    
    async def on_command_error(self, ctx, error):
        """Global command error handler"""
        if isinstance(error, commands.CommandNotFound):
            return  # Ignore unknown commands
        
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ Bạn không có quyền sử dụng lệnh này!")
            return
        
        if isinstance(error, commands.UserInputError):
            await ctx.send(f"❌ **Lỗi đầu vào:** {str(error)}")
            return
        
        # Log other errors
        error_msg = f"Lỗi trong lệnh {ctx.command}: {error}"
        await self.logger.log(error_msg)
        print(f"[COMMAND ERROR] {error_msg}")
        
        # Send user-friendly error message
        await ctx.send("❌ **Đã xảy ra lỗi!** Vui lòng thử lại sau.")
    
    async def on_error(self, event_method: str, *args, **kwargs):
        """Global error handler"""
        import traceback
        error_msg = f"Lỗi trong event {event_method}: {traceback.format_exc()}"
        await self.logger.log(error_msg)
        print(f"[ERROR] {error_msg}")
    
    def run_bot(self):
        """Start the bot"""
        try:
            self.run(self.config.token)
        except Exception as e:
            print(f"[FATAL ERROR] Không thể khởi động bot: {e}")
            raise
