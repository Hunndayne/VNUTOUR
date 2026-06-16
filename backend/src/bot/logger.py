"""
Bot logging system
"""
import discord
from discord.ext import commands
from datetime import datetime, timezone
import traceback


class BotLogger:
    """Handles bot logging to Discord channels and console"""
    
    def __init__(self, bot):
        self.bot = bot
        self.log_channel_id = bot.config.log_channel_id
    
    async def log(self, message: str):
        """Log message to Discord channel and console"""
        # Console log
        print(f"[LOG] {message}")
        
        # Discord channel log
        if self.log_channel_id is None:
            return
            
        try:
            channel = self.bot.get_channel(self.log_channel_id)
            if channel is None:
                channel = await self.bot.fetch_channel(self.log_channel_id)
            
            await channel.send(message)
        except Exception as e:
            print(f"[LOG ERROR] Không thể gửi log đến Discord: {e}")
    
    async def log_member_join(self, member: discord.Member):
        """Log when a member joins"""
        log_msg = (
            f"👋 **Thành viên mới:** {member.mention} (`{member.id}`)\n"
            f"**Tài khoản tạo:** {member.created_at.strftime('%d/%m/%Y %H:%M:%S')}\n"
            f"**Tham gia lúc:** {member.joined_at.strftime('%d/%m/%Y %H:%M:%S') if member.joined_at else 'Không xác định'}"
        )
        await self.log(log_msg)
    
    async def log_member_leave(self, member: discord.Member):
        """Log when a member leaves"""
        log_msg = (
            f"👋 **Thành viên rời:** {member.mention} (`{member.id}`)\n"
            f"**Tham gia lúc:** {member.joined_at.strftime('%d/%m/%Y %H:%M:%S') if member.joined_at else 'Không xác định'}\n"
            f"**Rời lúc:** {datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M:%S')}"
        )
        await self.log(log_msg)
    
    async def log_message_edit(self, before: discord.Message, after: discord.Message):
        """Log when a message is edited"""
        log_msg = (
            f"✏️ **Tin nhắn được chỉnh sửa**\n"
            f"**Người gửi:** {after.author.mention} (`{after.author.id}`)\n"
            f"**Kênh:** {after.channel.mention}\n"
            f"**[Nhảy tới tin nhắn]({after.jump_url})**\n\n"
            f"**Trước:**\n```\n{before.content}\n```\n"
            f"**Sau:**\n```\n{after.content}\n```"
        )
        await self.log(log_msg)
    
    async def log_message_delete(self, message: discord.Message):
        """Log when a message is deleted"""
        log_msg = (
            f"🗑️ **Tin nhắn bị xóa**\n"
            f"**Người gửi:** {message.author.mention} (`{message.author.id}`)\n"
            f"**Kênh:** {message.channel.mention}\n"
            f"**Nội dung:**\n```\n{message.content}\n```"
        )
        await self.log(log_msg)




