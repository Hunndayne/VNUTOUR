"""
Slash commands for the bot
"""
import discord
from discord import app_commands
from discord.ext import commands
from ..utils.nicknames import build_nickname, try_set_nickname
from ..music.player import get_player, ensure_voice, after_play_callback, force_cleanup_ffmpeg_source
from ..music.ytdlp_handler import ytdlp_extract, build_ffmpeg_options
import asyncio
import threading
from datetime import datetime, timezone


class VolumeControlledAudioSource(discord.FFmpegPCMAudio):
    """Custom audio source with volume control"""
    
    def __init__(self, source, volume=1.0, **kwargs):
        super().__init__(source, **kwargs)
        self._volume = volume
    
    @property
    def volume(self):
        return self._volume
    
    @volume.setter
    def volume(self, value):
        self._volume = max(0.0, min(2.0, value))
    
    def read(self):
        """Read audio data with volume applied"""
        data = super().read()
        if data and self._volume != 1.0:
            # Apply volume by scaling the audio data
            import array
            audio_array = array.array('h', data)
            for i in range(len(audio_array)):
                audio_array[i] = int(audio_array[i] * self._volume)
            data = audio_array.tobytes()
        return data


def setup_slash_commands(bot):
    """Setup all slash commands"""
    
    # Music Commands Group
    @bot.tree.command(name="play", description="Phát nhạc từ YouTube")
    @app_commands.describe(query="Tên bài hát hoặc URL YouTube")
    async def play_slash(interaction: discord.Interaction, query: str):
        """Phát nhạc từ YouTube"""
        try:
            # Defer the response since this might take a while
            await interaction.response.defer()
            
            # Create a mock context for compatibility with existing functions
            class MockContext:
                def __init__(self, interaction):
                    self.guild = interaction.guild
                    self.channel = interaction.channel
                    self.author = interaction.user
                    self.message = interaction
                    
                async def send(self, content=None, embed=None):
                    if interaction.response.is_done():
                        return await interaction.followup.send(content=content, embed=embed)
                    else:
                        return await interaction.response.send_message(content=content, embed=embed)
            
            ctx = MockContext(interaction)
            
            # Ensure bot is in voice channel
            vc = await ensure_voice(ctx.message)
            
            # Get or create player
            player = get_player(ctx.guild.id)
            player.text_channel_id = ctx.channel.id
            
            # Show searching message
            await interaction.followup.send(f"🔍 **Đang tìm kiếm:** {query}")
            
            try:
                # Extract track info
                track = await ytdlp_extract(query, ctx.author.id)
                
                # Add to queue
                player.add_track(track)
                
                # Update message
                await interaction.followup.send(f"✅ **Đã thêm vào queue:** {track.title}")
                
                # Start playing if not already playing
                if not vc.is_playing():
                    asyncio.create_task(play_next(ctx.guild, vc, player))
                    
            except Exception as e:
                await interaction.followup.send(f"❌ **Lỗi:** {str(e)}")
                
        except Exception as e:
            if not interaction.response.is_done():
                await interaction.response.send_message(f"❌ **Lỗi:** {str(e)}")
            else:
                await interaction.followup.send(f"❌ **Lỗi:** {str(e)}")
    
    @bot.tree.command(name="skip", description="Bỏ qua bài hát hiện tại")
    async def skip_slash(interaction: discord.Interaction):
        """Bỏ qua bài hát hiện tại"""
        try:
            vc = interaction.guild.voice_client
            if not vc or not vc.is_connected():
                await interaction.response.send_message("❌ Bot không ở trong voice channel")
                return
            
            if vc.is_playing():
                # Stop current track and trigger next
                vc.stop()
                await interaction.response.send_message("⏭️ **Đã bỏ qua bài hát hiện tại**")
                
                # Get player and play next track
                player = get_player(interaction.guild.id)
                if player.queue:
                    await interaction.followup.send("🔄 **Đang chuyển sang bài tiếp theo...**")
                    asyncio.create_task(play_next(interaction.guild, vc, player))
                else:
                    await interaction.followup.send("📭 **Queue đã hết, không còn bài nào để phát**")
            else:
                await interaction.response.send_message("❌ Không có gì đang phát")
                
        except Exception as e:
            await interaction.response.send_message(f"❌ **Lỗi:** {str(e)}")
    
    @bot.tree.command(name="queue", description="Hiển thị queue nhạc")
    async def queue_slash(interaction: discord.Interaction):
        """Hiển thị queue nhạc"""
        try:
            player = get_player(interaction.guild.id)
            queue_info = player.get_queue_info()
            
            if player.now_playing:
                now_playing = f"🎵 **Đang phát:** {player.now_playing.title}\n\n"
            else:
                now_playing = ""
            
            await interaction.response.send_message(f"{now_playing}{queue_info}")
            
        except Exception as e:
            await interaction.response.send_message(f"❌ **Lỗi:** {str(e)}")
    
    @bot.tree.command(name="stop", description="Dừng phát nhạc và rời voice channel")
    async def stop_slash(interaction: discord.Interaction):
        """Dừng phát nhạc và rời voice channel"""
        try:
            vc = interaction.guild.voice_client
            if not vc or not vc.is_connected():
                await interaction.response.send_message("❌ Bot không ở trong voice channel")
                return
            
            # Clear queue and stop
            player = get_player(interaction.guild.id)
            player.clear_queue()
            player.skip_current()
            
            # Disconnect
            await vc.disconnect()
            await interaction.response.send_message("⏹️ **Đã dừng phát nhạc và rời voice channel**")
            
        except Exception as e:
            await interaction.response.send_message(f"❌ **Lỗi:** {str(e)}")
    
    @bot.tree.command(name="volume", description="Điều chỉnh âm lượng (0-200%)")
    @app_commands.describe(level="Mức âm lượng từ 0 đến 200 (%)")
    async def volume_slash(interaction: discord.Interaction, level: int):
        """Điều chỉnh âm lượng (0-200%)"""
        try:
            if not 0 <= level <= 200:
                await interaction.response.send_message("❌ Âm lượng phải từ 0% đến 200%")
                return
            
            player = get_player(interaction.guild.id)
            # Convert percentage to decimal (0-2.0)
            volume_decimal = level / 100.0
            player.set_volume(volume_decimal)
            
            # Apply volume to currently playing audio if any
            vc = interaction.guild.voice_client
            if vc and vc.is_playing() and player.now_playing:
                # Use our custom volume control
                if hasattr(vc.source, 'volume'):
                    vc.source.volume = volume_decimal
                    await interaction.response.send_message(f"🔊 **Âm lượng đã được đặt thành:** {level}% (áp dụng ngay lập tức)")
                else:
                    # Fallback to FFmpeg method if source doesn't support volume
                    await apply_volume_from_current_position(vc, player, volume_decimal)
                    await interaction.response.send_message(f"🔊 **Âm lượng đã được đặt thành:** {level}% (đang áp dụng...)")
            else:
                await interaction.response.send_message(f"🔊 **Âm lượng đã được đặt thành:** {level}%")
            
        except Exception as e:
            await interaction.response.send_message(f"❌ **Lỗi:** {str(e)}")
    
    # Admin Commands
    @bot.tree.command(name="ping", description="Kiểm tra độ trễ của bot")
    async def ping_slash(interaction: discord.Interaction):
        """Kiểm tra độ trễ của bot"""
        latency = round(bot.latency * 1000)
        await interaction.response.send_message(f"🏓 **Pong!** Độ trễ: {latency}ms")
    
    @bot.tree.command(name="info", description="Thông tin về bot")
    async def info_slash(interaction: discord.Interaction):
        """Thông tin về bot"""
        embed = discord.Embed(
            title="🤖 **VnuTourBot**",
            description="Bot quản lý tour VNU với chức năng âm nhạc",
            color=0x00ff00
        )
        
        embed.add_field(
            name="📊 **Thống kê**",
            value=f"Servers: {len(bot.guilds)}\nUsers: {len(bot.users)}",
            inline=True
        )
        
        embed.add_field(
            name="🏓 **Độ trễ**",
            value=f"{round(bot.latency * 1000)}ms",
            inline=True
        )
        
        embed.add_field(
            name="🐍 **Phiên bản**",
            value=f"discord.py {discord.__version__}",
            inline=True
        )
        
        embed.set_footer(text="VnuTourBot v1.0")
        await interaction.response.send_message(embed=embed)
    
    @bot.tree.command(name="clear", description="Xóa tin nhắn (chỉ admin)")
    @app_commands.describe(amount="Số lượng tin nhắn cần xóa")
    @app_commands.default_permissions(manage_messages=True)
    async def clear_slash(interaction: discord.Interaction, amount: int):
        """Xóa tin nhắn (chỉ admin)"""
        try:
            if amount < 1 or amount > 100:
                await interaction.response.send_message("❌ Số lượng tin nhắn phải từ 1 đến 100")
                return
            
            # Defer response since this might take a while
            await interaction.response.defer(ephemeral=True)
            
            deleted = await interaction.channel.purge(limit=amount)
            await interaction.followup.send(f"🗑️ **Đã xóa {len(deleted)} tin nhắn**", ephemeral=True)
            
        except discord.Forbidden:
            await interaction.followup.send("❌ Bot không có quyền xóa tin nhắn", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ **Lỗi:** {str(e)}", ephemeral=True)
    
    # Assign Discord ID to participant by MSSV
    @bot.tree.command(name="assign", description="Liên kết Discord của bạn với MSSV")
    @app_commands.describe(mssv="MSSV của bạn (trong Google Sheet)")
    async def assign_slash(interaction: discord.Interaction, mssv: str):
        try:
            mongo = getattr(bot, "mongo", None)
            if not mongo:
                await interaction.response.send_message("Hệ thống cơ sở dữ liệu chưa được cấu hình.", ephemeral=True)
                return
            
            status, message = mongo.assign_discord_by_mssv(mssv, interaction.user.id)
            
            try:
                doc = mongo.participants.find_one({"mssv": str(mssv).strip()})
            except Exception:
                doc = None
            
            # Handle different status cases
            if status == "discord_already_used":
                # Find the participant who is currently using this Discord ID
                current_discord_user = mongo.participants.find_one({"discord_id": interaction.user.id})
                
                # Send detailed error message to user
                error_embed = discord.Embed(
                    title="❌ **Lỗi: Discord ID đã được sử dụng**",
                    description=message,
                    color=0xe74c3c
                )
                error_embed.add_field(
                    name="🔧 **Cần hỗ trợ**",
                    value="Discord ID của bạn đã được sử dụng bởi MSSV khác. Vui lòng liên hệ admin để được hỗ trợ.",
                    inline=False
                )
                error_embed.add_field(
                    name="📋 **Thông tin người đang sử dụng Discord ID của bạn**",
                    value=f"MSSV: {current_discord_user.get('mssv', 'Không có') if current_discord_user else 'Không tìm thấy'}\nHọ và tên: {current_discord_user.get('full_name', 'Không có tên') if current_discord_user else 'Không tìm thấy'}",
                    inline=False
                )
                
                # Add support channel information
                if bot.config.support_channel_id:
                    support_channel = bot.get_channel(bot.config.support_channel_id)
                    if support_channel:
                        error_embed.add_field(
                            name="📞 **Liên hệ hỗ trợ**",
                            value=f"Vui lòng đến channel {support_channel.mention} để được admin hỗ trợ giải quyết vấn đề này.",
                            inline=False
                        )
                    else:
                        error_embed.add_field(
                            name="📞 **Liên hệ hỗ trợ**",
                            value="Vui lòng liên hệ admin để được hỗ trợ giải quyết vấn đề này.",
                            inline=False
                        )
                else:
                    error_embed.add_field(
                        name="📞 **Liên hệ hỗ trợ**",
                        value="Vui lòng liên hệ admin để được hỗ trợ giải quyết vấn đề này.",
                        inline=False
                    )
                
                # Send error message as ephemeral (only visible to the user)
                await interaction.response.send_message(embed=error_embed, ephemeral=True)
                return
            
            # Update nickname on success or already_linked
            if doc and status in ("ok", "already_linked"):
                full_name = doc.get("full_name") or ""
                team_name = doc.get("team_name") or (f"Team {doc.get('team_id')}" if doc.get("team_id") else "")
                nickname = build_nickname(full_name, team_name)
                try:
                    member = None
                    if interaction.guild:
                        member = interaction.guild.get_member(interaction.user.id)
                        if member is None:
                            try:
                                member = await interaction.guild.fetch_member(interaction.user.id)
                            except Exception:
                                member = None
                    if member:
                        ok, err = await try_set_nickname(member, nickname, reason="Set nickname after /assign")
                        if not ok:
                            hint = None
                            if err in ("no_permission", "forbidden"):
                                hint = "Bot thiếu quyền Manage Nicknames."
                            elif err == "lower_role":
                                hint = "Role của bot thấp hơn thành viên."
                            elif err == "target_owner":
                                hint = "Không thể đổi nickname của chủ server."
                            if hint:
                                try:
                                    # We haven't responded yet in success flow, will send note after main embed
                                    await interaction.followup.send(f"ℹ️ Không thể đổi nickname: {hint}", ephemeral=True)
                                except Exception:
                                    pass
                except Exception:
                    pass

            if doc:
                embed = discord.Embed(
                    title="Xác nhận liên kết MSSV", 
                    description=message, 
                    color=0x2ecc71 if status in ("ok", "already_linked") else 0xe67e22
                )
                embed.add_field(name="Họ và tên", value=doc.get("full_name") or "-", inline=False)
                embed.add_field(name="MSSV", value=doc.get("mssv") or "-", inline=True)
                team = doc.get("team_name") or doc.get("team_id") or "-"
                embed.add_field(name="Tên đội", value=str(team), inline=True)
                
                # Thêm thông tin chi tiết về trạng thái
                if status == "already_assigned":
                    embed.add_field(
                        name="⚠️ Lưu ý", 
                        value="MSSV này đã được liên kết với tài khoản Discord khác. Nếu bạn nghĩ đây là lỗi, vui lòng liên hệ admin.", 
                        inline=False
                    )
                elif status == "already_linked":
                    embed.add_field(
                        name="ℹ️ Thông tin", 
                        value="MSSV này đã được liên kết với Discord của bạn rồi.", 
                        inline=False
                    )
                
                await interaction.response.send_message(embed=embed, ephemeral=True)
            else:
                await interaction.response.send_message(message, ephemeral=True)
        except Exception as e:
            await interaction.response.send_message(f"Lỗi: {e}", ephemeral=True)

    # Check participant information
    @bot.tree.command(name="check", description="Kiểm tra thông tin tham gia viên")
    @app_commands.describe(mssv="MSSV để kiểm tra (để trống để kiểm tra Discord ID của bạn)")
    @app_commands.checks.has_permissions(administrator=True)
    async def check_slash(interaction: discord.Interaction, mssv: str = None):
        """Kiểm tra thông tin tham gia viên. Nếu không có MSSV, kiểm tra Discord ID của bạn."""
        try:
            mongo = getattr(bot, "mongo", None)
            if not mongo:
                await interaction.response.send_message("Hệ thống cơ sở dữ liệu chưa được cấu hình.", ephemeral=True)
                return

            # If no MSSV provided, check by Discord ID
            if not mssv:
                doc = mongo.participants.find_one({"discord_id": interaction.user.id})
                if not doc:
                    await interaction.response.send_message(
                        "❌ **Không tìm thấy thông tin:** Bạn chưa liên kết MSSV nào với Discord của mình.\nSử dụng `/assign <mssv>` để liên kết.", 
                        ephemeral=True
                    )
                    return
                mssv = doc.get("mssv")
            else:
                # Check by MSSV
                doc = mongo.participants.find_one({"mssv": str(mssv).strip()})
                if not doc:
                    await interaction.response.send_message(
                        f"❌ **Không tìm thấy:** MSSV {mssv} không tồn tại trong hệ thống.", 
                        ephemeral=True
                    )
                    return

            # Create detailed embed
            embed = discord.Embed(
                title="📋 Thông tin tham gia viên",
                color=0x3498db
            )
            
            embed.add_field(name="👤 **Họ và tên**", value=doc.get("full_name") or "-", inline=False)
            embed.add_field(name="🆔 **MSSV**", value=doc.get("mssv") or "-", inline=True)
            embed.add_field(name="📧 **Email**", value=doc.get("email") or "-", inline=True)
            embed.add_field(name="📱 **Số điện thoại**", value=doc.get("phone") or "-", inline=True)
            embed.add_field(name="🏫 **Trường**", value=doc.get("school") or "-", inline=True)
            embed.add_field(name="🎓 **Khoa**", value=doc.get("faculty") or "-", inline=True)
            embed.add_field(name="📘 **Facebook**", value=doc.get("facebook") or "-", inline=True)
            
            # Team information
            team = doc.get("team_name") or doc.get("team_id") or "-"
            embed.add_field(name="👥 **Tên đội**", value=str(team), inline=True)
            
            # Discord link status
            discord_id = doc.get("discord_id")
            if discord_id:
                if int(discord_id) == interaction.user.id:
                    embed.add_field(name="🔗 **Trạng thái Discord**", value="✅ Đã liên kết với bạn", inline=True)
                else:
                    embed.add_field(name="🔗 **Trạng thái Discord**", value=f"⚠️ Liên kết với Discord ID khác: {discord_id}", inline=True)
            else:
                embed.add_field(name="🔗 **Trạng thái Discord**", value="❌ Chưa liên kết", inline=True)
            
            # Timestamp
            if doc.get("updated_at"):
                embed.add_field(name="🕒 **Cập nhật lần cuối**", value=doc.get("updated_at").strftime("%d/%m/%Y %H:%M:%S"), inline=False)

            await interaction.response.send_message(embed=embed, ephemeral=True)

        except Exception as e:
            await interaction.response.send_message(f"❌ **Lỗi:** {e}", ephemeral=True)

    # Admin command: Edit assign
    @bot.tree.command(name="editassign", description="Admin: Chỉnh sửa liên kết Discord ID với MSSV")
    @app_commands.describe(
        user="User Discord để liên kết",
        mssv="MSSV để liên kết"
    )
    @app_commands.checks.has_permissions(administrator=True)
    async def editassign_slash(interaction: discord.Interaction, user: discord.Member, mssv: str):
        """Admin command: Chỉnh sửa liên kết Discord ID với MSSV."""
        try:
            mongo = getattr(bot, "mongo", None)
            if not mongo:
                await interaction.response.send_message("❌ Hệ thống cơ sở dữ liệu chưa được cấu hình.", ephemeral=True)
                return

            # Kiểm tra MSSV có tồn tại không
            participant = mongo.participants.find_one({"mssv": str(mssv).strip()})
            if not participant:
                await interaction.response.send_message(f"❌ **Lỗi:** MSSV {mssv} không tồn tại trong hệ thống.", ephemeral=True)
                return

            # Kiểm tra xem MSSV này đã được liên kết với Discord ID nào chưa
            current_discord_id = participant.get("discord_id")
            current_discord_user = None
            if current_discord_id:
                current_discord_user = mongo.participants.find_one({"discord_id": int(current_discord_id)})

            # Kiểm tra xem Discord ID mới đã được sử dụng bởi MSSV khác chưa
            existing_user = mongo.participants.find_one({"discord_id": user.id})
            existing_mssv = None
            if existing_user:
                existing_mssv = existing_user.get("mssv")
                if existing_mssv == mssv:
                    # Nếu đã liên kết rồi thì không cần làm gì
                    await interaction.response.send_message(f"ℹ️ **Thông tin:** MSSV {mssv} đã được liên kết với Discord ID của {user.mention} rồi.", ephemeral=True)
                    return

            # Thực hiện cập nhật
            try:
                # Xóa liên kết cũ của MSSV hiện tại (nếu có)
                if current_discord_id:
                    mongo.participants.update_one(
                        {"mssv": str(mssv).strip()},
                        {"$unset": {"discord_id": "", "updated_at": ""}}
                    )

                # Xóa liên kết cũ của Discord ID mới (nếu đang liên kết với MSSV khác)
                if existing_mssv and existing_mssv != mssv:
                    mongo.participants.update_one(
                        {"mssv": existing_mssv},
                        {"$unset": {"discord_id": "", "updated_at": ""}}
                    )

                # Gán Discord ID mới cho MSSV
                mongo.participants.update_one(
                    {"mssv": str(mssv).strip()},
                    {"$set": {"discord_id": user.id, "updated_at": datetime.now(timezone.utc)}}
                )

                # Set nickname to "[Team] Full Name"
                try:
                    fresh = mongo.participants.find_one({"mssv": str(mssv).strip()}) or participant
                    full_name = (fresh.get("full_name") if fresh else None)
                    team_label = (fresh.get("team_name") if fresh else None) or (
                        f"Team {fresh.get('team_id')}" if fresh and fresh.get("team_id") else None
                    )
                    nickname = build_nickname(full_name, team_label)
                    await try_set_nickname(user, nickname, reason="Set nickname after /editassign")
                except Exception:
                    pass

                # Tạo embed thông báo thành công
                embed = discord.Embed(
                    title="✅ **Đã cập nhật liên kết Discord ID**",
                    color=0x2ecc71
                )
                embed.add_field(
                    name="👤 **Thông tin tham gia viên**",
                    value=f"**Họ và tên:** {participant.get('full_name', 'Không có tên')}\n**MSSV:** {mssv}",
                    inline=False
                )
                embed.add_field(
                    name="🔗 **Discord ID mới**",
                    value=f"{user.mention} ({user.id})",
                    inline=True
                )
                
                # Thông tin về các liên kết đã xóa
                removed_links = []
                if current_discord_id and current_discord_user:
                    removed_links.append(f"MSSV {mssv} ↔ Discord ID {current_discord_id}")
                if existing_mssv and existing_mssv != mssv:
                    removed_links.append(f"MSSV {existing_mssv} ↔ Discord ID {user.id}")
                
                if removed_links:
                    embed.add_field(
                        name="🔄 **Liên kết đã xóa**",
                        value="\n".join(removed_links),
                        inline=False
                    )
                
                embed.add_field(
                    name="👨‍💼 **Admin thực hiện**",
                    value=interaction.user.mention,
                    inline=False
                )
                embed.add_field(
                    name="🕒 **Thời gian**",
                    value=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S"),
                    inline=False
                )

                await interaction.response.send_message(embed=embed, ephemeral=True)

                # Gửi DM thông báo cho user được gán
                try:
                    user_embed = discord.Embed(
                        title="🔗 **Bạn đã được liên kết với MSSV mới**",
                        description=f"Admin {interaction.user.name} đã liên kết Discord của bạn với MSSV {mssv}.",
                        color=0x3498db
                    )
                    user_embed.add_field(
                        name="📋 **Thông tin MSSV**",
                        value=f"**Họ và tên:** {participant.get('full_name', 'Không có tên')}\n**MSSV:** {mssv}",
                        inline=False
                    )
                    
                    # Thông tin về liên kết cũ (nếu có)
                    if existing_mssv and existing_mssv != mssv:
                        user_embed.add_field(
                            name="🔄 **Liên kết cũ đã bị xóa**",
                            value=f"Discord của bạn không còn liên kết với MSSV {existing_mssv}",
                            inline=False
                        )
                    
                    user_embed.add_field(
                        name="👨‍💼 **Admin thực hiện**",
                        value=interaction.user.name,
                        inline=True
                    )
                    user_embed.add_field(
                        name="🕒 **Thời gian**",
                        value=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S"),
                        inline=True
                    )
                    
                    await user.send(embed=user_embed)
                except discord.Forbidden:
                    await interaction.followup.send(f"⚠️ Không thể gửi DM cho {user.mention}. Họ có thể đã tắt DM.", ephemeral=True)

            except Exception as e:
                await interaction.response.send_message(f"❌ **Lỗi khi cập nhật:** {e}", ephemeral=True)

        except Exception as e:
            await interaction.response.send_message(f"❌ **Lỗi:** {e}", ephemeral=True)

    @editassign_slash.error
    async def editassign_slash_error(interaction: discord.Interaction, error):
        if isinstance(error, app_commands.MissingPermissions):
            await interaction.response.send_message("❌ **Lỗi:** Bạn không có quyền sử dụng lệnh này! Chỉ admin mới được phép.", ephemeral=True)
        else:
            await interaction.response.send_message(f"❌ **Lỗi:** {error}", ephemeral=True)

    # Help Command
    @bot.tree.command(name="help", description="Hiển thị hướng dẫn sử dụng bot")
    async def help_slash(interaction: discord.Interaction):
        """Hiển thị hướng dẫn sử dụng bot"""
        embed = discord.Embed(
            title="🤖 **VnuTourBot - Hướng dẫn sử dụng**",
            description="Bot quản lý tour VNU với các chức năng âm nhạc và quản lý trạm",
            color=0x00ff00
        )
        
        # Music commands
        embed.add_field(
            name="🎵 **Lệnh âm nhạc**",
            value=(
                "`/play <tên/URL>` - Phát nhạc\n"
                "`/skip` - Bỏ qua bài hát hiện tại\n"
                "`/queue` - Hiển thị queue nhạc\n"
                "`/stop` - Dừng phát nhạc\n"
                "`/volume <0-200>` - Điều chỉnh âm lượng"
            ),
            inline=False
        )
        
        # Admin commands
        embed.add_field(
            name="🔧 **Lệnh admin**",
            value=(
                "`/ping` - Kiểm tra độ trễ\n"
                "`/info` - Thông tin bot\n"
                "`/clear <số>` - Xóa tin nhắn\n"
                "`/editassign <user> <mssv>` - Chỉnh sửa liên kết Discord ID với MSSV (Admin only)"
            ),
            inline=False
        )
        
        embed.add_field(
            name="💡 **Ghi chú**",
            value="Sử dụng `/` để xem tất cả các lệnh có sẵn",
            inline=False
        )
        
        embed.set_footer(text="VnuTourBot v1.0 - Slash Commands")
        await interaction.response.send_message(embed=embed)


# Helper functions (copied from music_commands.py)
async def apply_volume_from_current_position(vc: discord.VoiceClient, player, volume: float):
    """Apply volume immediately from current playback position"""
    try:
        # Get current track info
        track = player.now_playing
        if not track:
            return
        
        # Calculate current playback position
        current_time = 0
        if player.started_at:
            current_time = datetime.now(timezone.utc).timestamp() - player.started_at
        
        # Ensure current_time is not negative
        current_time = max(0, current_time)
        
        # Build FFmpeg options with seek to current position
        ffmpeg_opts = build_ffmpeg_options(track)
        
        # Add seek option to start from current position
        seek_option = f"-ss {current_time}"
        
        # Create new audio source with seek and volume
        source = discord.FFmpegPCMAudio(
            track.stream_url,
            before_options=f"{ffmpeg_opts} {seek_option}",
            options=f"-vn -af volume={volume}"
        )
        
        # Store new source
        player.current_source = source
        
        # Update start time to current position
        player.started_at = datetime.now(timezone.utc).timestamp() - current_time
        
        # Stop current playback first
        vc.stop()
        
        # Give more time for clean stop and cleanup
        await asyncio.sleep(0.1)
        
        # Cleanup old source if exists
        force_cleanup_ffmpeg_source(player.current_source)
        
        # Play with new volume from current position
        vc.play(source, after=lambda err: threading.Thread(target=lambda: asyncio.run(after_play_callback(err, player))).start())
        
    except Exception as e:
        print(f"[VOLUME POSITION ERROR] {e}")


async def play_next(guild, vc, player):
    """Play the next track in queue"""
    try:
        # Get next track
        track = player.get_next_track()
        if not track:
            return
        
        # Set as now playing
        player.now_playing = track
        player.started_at = datetime.now(timezone.utc).timestamp()
        
        # Build FFmpeg options
        ffmpeg_opts = build_ffmpeg_options(track)
        
        # Create audio source with current volume
        source = VolumeControlledAudioSource(
            track.stream_url,
            volume=player.volume,
            before_options=ffmpeg_opts,
            options="-vn"  # No volume filter needed, handled by our class
        )
        
        # Store source for cleanup
        player.current_source = source
        
        # Play audio with safe callback
        vc.play(source, after=lambda err: threading.Thread(target=lambda: asyncio.run(after_play_callback(err, player))).start())
        
        # Send now playing message with beautiful embed
        channel = guild.get_channel(player.text_channel_id)
        if channel:
            now_playing_embed = create_now_playing_embed(track)
            player.now_playing_msg = await channel.send(embed=now_playing_embed)
        
        # Create background task to handle track completion
        async def handle_track_completion():
            # Wait for completion
            await player.finished.wait()
            player.finished.clear()
            
            # When track finishes, update message to simple text
            if player.now_playing_msg:
                try:
                    await player.now_playing_msg.edit(content=f"✅ **Đã phát xong:** {track.title}", embed=None)
                except:
                    pass
            
            # Play next track if available
            if player.queue:
                await play_next(guild, vc, player)
            else:
                player.now_playing = None
                player.started_at = None
                player.now_playing_msg = None
        
        # Start background task (non-blocking)
        asyncio.create_task(handle_track_completion())
            
    except Exception as e:
        print(f"[PLAY NEXT ERROR] {e}")
        # Try to play next track
        if player.queue:
            await play_next(guild, vc, player)


def create_now_playing_embed(track):
    """Create a beautiful now playing embed"""
    embed = discord.Embed(
        title="🎵 **Đang phát**",
        description=f"**{track.title}**",
        color=0x00ff00
    )
    
    # Add artist info if available
    if hasattr(track, 'artist') and track.artist:
        embed.add_field(
            name="👤 **Nghệ sĩ**",
            value=track.artist,
            inline=True
        )
    
    # Add duration
    if hasattr(track, 'duration') and track.duration:
        duration_str = track.get_duration_str()
        embed.add_field(
            name="⏱️ **Thời lượng**",
            value=duration_str,
            inline=True
        )
    
    # Add uploader if available
    if hasattr(track, 'uploader') and track.uploader:
        embed.add_field(
            name="📺 **Kênh**",
            value=track.uploader,
            inline=True
        )
    
    # Add thumbnail if available
    if hasattr(track, 'thumbnail') and track.thumbnail:
        embed.set_thumbnail(url=track.thumbnail)
    
    embed.set_footer(text="🎶 VnuTourBot Music Player")
    return embed

    # Admin Commands Group
    @bot.tree.command(name="addallrole", description="Tự động tạo role và channel cho tất cả các đội có thành viên")
    @app_commands.checks.has_permissions(administrator=True)
    async def addallrole_slash(interaction: discord.Interaction):
        """Tự động tạo role và channel cho tất cả các đội có thành viên"""
        try:
            # Check if category ID is configured
            if not bot.config.team_category_id:
                await interaction.response.send_message(
                    "❌ **Lỗi:** Chưa cấu hình `CATEGORYIDFORTEAM` trong file .env",
                    ephemeral=True
                )
                return

            # Get category
            category = bot.get_channel(bot.config.team_category_id)
            if not category:
                await interaction.response.send_message(
                    f"❌ **Lỗi:** Không tìm thấy category với ID {bot.config.team_category_id}",
                    ephemeral=True
                )
                return

            # Get MongoDB instance
            mongo = getattr(bot, "mongo", None)
            if not mongo:
                await interaction.response.send_message(
                    "❌ **Lỗi:** Hệ thống cơ sở dữ liệu chưa được cấu hình.",
                    ephemeral=True
                )
                return

            # Send initial message
            status_embed = discord.Embed(
                title="🔄 **Đang tạo role và channel cho các đội...**",
                description="Vui lòng chờ trong khi bot xử lý...",
                color=0xf39c12
            )
            await interaction.response.send_message(embed=status_embed)

            # Get teams with members
            teams_with_members = mongo.get_teams_with_members()
            
            if not teams_with_members:
                await interaction.edit_original_response(embed=discord.Embed(
                    title="❌ **Không có đội nào để xử lý**",
                    description="Không tìm thấy đội nào có thành viên đã assign Discord ID.",
                    color=0xe74c3c
                ))
                return

            # Process each team
            created_roles = 0
            created_channels = 0
            assigned_members = 0
            errors = []

            for team in teams_with_members:
                try:
                    team_id = team.get("team_id")
                    team_name = team.get("team_name", f"Team {team_id}")
                    members = team.get("members_with_discord", [])

                    if not team_id or not team_name or not members:
                        continue

                    # Clean team name for Discord (remove special chars, limit length)
                    clean_team_name = "".join(c for c in team_name if c.isalnum() or c in " -_").strip()
                    if len(clean_team_name) > 32:
                        clean_team_name = clean_team_name[:32]

                    # Create role if not exists
                    role = discord.utils.get(interaction.guild.roles, name=clean_team_name)
                    if not role:
                        try:
                            role = await interaction.guild.create_role(
                                name=clean_team_name,
                                color=discord.Color.random(),
                                reason=f"Auto-created for team {team_id}"
                            )
                            created_roles += 1
                        except discord.Forbidden:
                            errors.append(f"Không có quyền tạo role cho đội {team_name}")
                            continue
                        except Exception as e:
                            errors.append(f"Lỗi tạo role cho đội {team_name}: {e}")
                            continue

                    # Create text channel if not exists
                    text_channel_name = f"{clean_team_name.lower().replace(' ', '-')}"
                    text_channel = discord.utils.get(category.text_channels, name=text_channel_name)
                    if not text_channel:
                        try:
                            # Set up text channel permissions
                            overwrites = {
                                interaction.guild.default_role: discord.PermissionOverwrite(
                                    read_messages=False, 
                                    send_messages=False,
                                    view_channel=False
                                ),
                                role: discord.PermissionOverwrite(
                                    read_messages=True, 
                                    send_messages=True, 
                                    attach_files=True, 
                                    embed_links=True,
                                    view_channel=True,
                                    add_reactions=True,
                                    read_message_history=True
                                )
                            }
                            
                            text_channel = await category.create_text_channel(
                                name=text_channel_name,
                                topic=f"Kênh chat cho đội {team_name}",
                                reason=f"Auto-created for team {team_id}",
                                overwrites=overwrites
                            )
                            created_channels += 1
                        except discord.Forbidden:
                            errors.append(f"Không có quyền tạo text channel cho đội {team_name}")
                        except Exception as e:
                            errors.append(f"Lỗi tạo text channel cho đội {team_name}: {e}")

                    # Create voice channel if not exists
                    voice_channel_name = f"{clean_team_name.lower().replace(' ', '-')}"
                    voice_channel = discord.utils.get(category.voice_channels, name=voice_channel_name)
                    if not voice_channel:
                        try:
                            # Set up voice channel permissions
                            overwrites = {
                                interaction.guild.default_role: discord.PermissionOverwrite(
                                    connect=False, 
                                    view_channel=False,
                                    speak=False,
                                    stream=False
                                ),
                                role: discord.PermissionOverwrite(
                                    connect=True, 
                                    view_channel=True, 
                                    speak=True, 
                                    stream=True,
                                    priority_speaker=False,
                                    mute_members=False,
                                    deafen_members=False,
                                    move_members=False
                                )
                            }
                            
                            voice_channel = await category.create_voice_channel(
                                name=voice_channel_name,
                                reason=f"Auto-created for team {team_id}",
                                overwrites=overwrites,
                                user_limit=10  # Limit to 10 users per team
                            )
                            created_channels += 1
                        except discord.Forbidden:
                            errors.append(f"Không có quyền tạo voice channel cho đội {team_name}")
                        except Exception as e:
                            errors.append(f"Lỗi tạo voice channel cho đội {team_name}: {e}")

                    # Assign role to team members
                    for member_data in members:
                        discord_id = member_data.get("discord_id")
                        if not discord_id:
                            continue

                        member = interaction.guild.get_member(discord_id)
                        if member:
                            try:
                                full_name = (member_data.get("full_name") or "").strip()
                                team_label = team_name
                                nickname = build_nickname(full_name, team_label)
                                await try_set_nickname(member, nickname, reason="Set nickname during /addallrole")
                            except Exception:
                                pass
                        if member and role not in member.roles:
                            try:
                                await member.add_roles(role, reason=f"Auto-assigned for team {team_id}")
                                assigned_members += 1
                            except discord.Forbidden:
                                errors.append(f"Không có quyền assign role cho {member.display_name}")
                            except Exception as e:
                                errors.append(f"Lỗi assign role cho {member.display_name}: {e}")

                except Exception as e:
                    errors.append(f"Lỗi xử lý đội {team.get('team_name', 'Unknown')}: {e}")

            # Create final report
            final_embed = discord.Embed(
                title="✅ **Hoàn thành tạo role và channel**",
                color=0x2ecc71
            )
            final_embed.add_field(
                name="📊 **Thống kê**",
                value=f"**Đội được xử lý:** {len(teams_with_members)}\n"
                      f"**Role đã tạo:** {created_roles}\n"
                      f"**Channel đã tạo:** {created_channels}\n"
                      f"**Thành viên được assign role:** {assigned_members}",
                inline=False
            )

            if errors:
                error_text = "\n".join(errors[:10])  # Limit to first 10 errors
                if len(errors) > 10:
                    error_text += f"\n... và {len(errors) - 10} lỗi khác"
                
                final_embed.add_field(
                    name="⚠️ **Lỗi gặp phải**",
                    value=f"```{error_text}```",
                    inline=False
                )

            final_embed.add_field(
                name="👨‍💼 **Admin thực hiện**",
                value=interaction.user.mention,
                inline=True
            )
            final_embed.add_field(
                name="🕒 **Thời gian**",
                value=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S"),
                inline=True
            )

            await interaction.edit_original_response(embed=final_embed)

        except Exception as e:
            if not interaction.response.is_done():
                await interaction.response.send_message(f"❌ **Lỗi:** {e}", ephemeral=True)
            else:
                await interaction.followup.send(f"❌ **Lỗi:** {e}", ephemeral=True)

    @addallrole_slash.error
    async def addallrole_slash_error(interaction: discord.Interaction, error):
        if isinstance(error, app_commands.MissingPermissions):
            await interaction.response.send_message(
                "❌ **Lỗi:** Bạn không có quyền sử dụng lệnh này! Chỉ admin mới được phép.",
                ephemeral=True
            )
        else:
            if not interaction.response.is_done():
                await interaction.response.send_message(f"❌ **Lỗi:** {error}", ephemeral=True)
            else:
                await interaction.followup.send(f"❌ **Lỗi:** {error}", ephemeral=True)
