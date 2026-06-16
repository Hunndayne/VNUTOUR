"""
Admin-related commands
"""
import discord
from discord.ext import commands
from datetime import datetime, timezone
from ..utils.nicknames import build_nickname, try_set_nickname
from ..utils.categories import get_valid_team_categories_for_guild, pick_category_for_new_channels


def setup_admin_commands(bot):
    """Setup admin commands"""

    @bot.command(name="ping")
    async def ping(ctx):
        """Kiểm tra độ trễ của bot"""
        latency = round(bot.latency * 1000)
        await ctx.send(f"Pong! Độ trễ: {latency}ms")

    @bot.command(name="info")
    async def info(ctx):
        """Hiển thị thông tin bot"""
        embed = discord.Embed(
            title="VnuTourBot Info",
            description="Bot quản lý tour VNU với các chức năng âm nhạc và quản lý trạm",
            color=0x00ff00,
        )

        embed.add_field(
            name="Thống kê",
            value=f"Servers: {len(bot.guilds)}\nUsers: {len(bot.users)}",
            inline=True,
        )

        embed.add_field(
            name="Độ trễ",
            value=f"{round(bot.latency * 1000)}ms",
            inline=True,
        )

        embed.add_field(
            name="Chức năng",
            value="Âm nhạc YouTube\nQuản lý trạm tour\nLogging tự động",
            inline=False,
        )

        embed.set_footer(text="VnuTourBot v1.0")
        await ctx.send(embed=embed)

    # Public command: assign Discord ID to MSSV
    @bot.command(name="assign")
    async def assign(ctx, mssv: str):
        """Gán Discord ID của bạn vào MSSV trong cơ sở dữ liệu."""
        try:
            mongo = getattr(bot, "mongo", None)
            if not mongo:
                await ctx.send("Hệ thống cơ sở dữ liệu chưa được cấu hình.")
                return

            status, message = mongo.assign_discord_by_mssv(mssv, ctx.author.id)

            # Fetch participant info for confirmation DM
            doc = None
            try:
                doc = mongo.participants.find_one({"mssv": str(mssv).strip()})
            except Exception:
                doc = None

            # Handle different status cases
            if status == "discord_already_used":
                # Find the participant who is currently using this Discord ID
                current_discord_user = mongo.participants.find_one({"discord_id": ctx.author.id})
                
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
                
                # Try to send DM first, fallback to public reply if DM fails
                try:
                    await ctx.author.send(embed=error_embed)
                    await ctx.reply("📬 Đã gửi thông tin lỗi qua tin nhắn riêng (DM). Vui lòng kiểm tra DM của bạn.", mention_author=False)
                except discord.Forbidden:
                    # If DM fails, send public reply (ephemeral-like behavior)
                    await ctx.reply("📬 **Lỗi Discord ID Conflict** - Vui lòng mở DM để nhận thông tin chi tiết.", mention_author=False)
                
                return

            # Update nickname on success or already_linked
            if doc and status in ("ok", "already_linked"):
                full_name = doc.get("full_name") or ""
                team_name = doc.get("team_name") or (f"Team {doc.get('team_id')}" if doc.get("team_id") else "")
                nickname = build_nickname(full_name, team_name)
                try:
                    member = None
                    if ctx.guild:
                        member = ctx.guild.get_member(ctx.author.id)
                        if member is None:
                            try:
                                member = await ctx.guild.fetch_member(ctx.author.id)
                            except Exception:
                                member = None
                    if member:
                        ok, err = await try_set_nickname(member, nickname, reason="Set nickname after !assign")
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
                                    await ctx.reply(f"ℹ️ Không thể đổi nickname: {hint}", mention_author=False)
                                except Exception:
                                    pass
                except Exception:
                    pass

            # Send DM with details (private) for other cases
            try:
                embed = discord.Embed(
                    title="Kết quả liên kết MSSV",
                    description=message,
                    color=0x2ecc71 if status in ("ok", "already_linked") else 0xe67e22,
                )
                if doc:
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
                
                await ctx.author.send(embed=embed)
                await ctx.reply("Đã gửi thông tin xác nhận qua tin nhắn riêng (DM).", mention_author=False)
            except discord.Forbidden:
                await ctx.send(message + " (Không thể gửi DM, vui lòng mở DM)")

        except Exception as e:
            await ctx.send(f"Lỗi: {e}")

    # Admin-only: check participant information
    @bot.command(name="check")
    @commands.has_permissions(administrator=True)
    async def check(ctx, mssv: str = None):
        """Kiểm tra thông tin tham gia viên. Nếu không có MSSV, kiểm tra Discord ID của bạn."""
        try:
            mongo = getattr(bot, "mongo", None)
            if not mongo:
                await ctx.send("Hệ thống cơ sở dữ liệu chưa được cấu hình.")
                return

            # If no MSSV provided, check by Discord ID
            if not mssv:
                doc = mongo.participants.find_one({"discord_id": ctx.author.id})
                if not doc:
                    await ctx.send("❌ **Không tìm thấy thông tin:** Bạn chưa liên kết MSSV nào với Discord của mình.\nSử dụng `!assign <mssv>` để liên kết.")
                    return
                mssv = doc.get("mssv")
            else:
                # Check by MSSV
                doc = mongo.participants.find_one({"mssv": str(mssv).strip()})
                if not doc:
                    await ctx.send(f"❌ **Không tìm thấy:** MSSV {mssv} không tồn tại trong hệ thống.")
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
                if int(discord_id) == ctx.author.id:
                    embed.add_field(name="🔗 **Trạng thái Discord**", value="✅ Đã liên kết với bạn", inline=True)
                else:
                    embed.add_field(name="🔗 **Trạng thái Discord**", value=f"⚠️ Liên kết với Discord ID khác: {discord_id}", inline=True)
            else:
                embed.add_field(name="🔗 **Trạng thái Discord**", value="❌ Chưa liên kết", inline=True)
            
            # Timestamp
            if doc.get("updated_at"):
                embed.add_field(name="🕒 **Cập nhật lần cuối**", value=doc.get("updated_at").strftime("%d/%m/%Y %H:%M:%S"), inline=False)

            # Send DM with detailed info
            try:
                await ctx.author.send(embed=embed)
                await ctx.reply("📬 Đã gửi thông tin chi tiết qua tin nhắn riêng (DM).", mention_author=False)
            except discord.Forbidden:
                # If DM fails, send public response (less detailed)
                public_embed = discord.Embed(
                    title=f"📋 Thông tin MSSV {doc.get('mssv')}",
                    description=f"**Họ và tên:** {doc.get('full_name')}\n**Đội:** {team}",
                    color=0x3498db
                )
                await ctx.send(embed=public_embed)
                await ctx.send("💡 **Gợi ý:** Mở DM để nhận thông tin chi tiết hơn.")

        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {e}")

    @check.error
    async def check_error(ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ Bạn không có quyền sử dụng lệnh này! Chỉ admin được phép.")
        else:
            await ctx.send(f"❌ Lỗi: {error}")

    @bot.command(name="syncstatus")
    async def syncstatus(ctx):
        """Xem trạng thái đồng bộ Google Sheet -> MongoDB."""
        try:
            mongo = getattr(bot, "mongo", None)
            if not mongo:
                await ctx.send("Hệ thống cơ sở dữ liệu chưa được cấu hình.")
                return

            last_at = mongo.get_meta("sheet_last_sync_at")
            last_result = mongo.get_meta("sheet_last_result") or {"created": 0, "updated": 0}
            hash_short = (mongo.get_meta("sheet_hash") or "")[:10]

            embed = discord.Embed(title="Trạng thái đồng bộ Google Sheet", color=0x3498db)
            embed.add_field(name="Lần gần nhất", value=str(last_at or "Chưa có"), inline=False)
            embed.add_field(name="Kết quả gần nhất", value=f"tạo: {last_result.get('created',0)}, cập nhật: {last_result.get('updated',0)}", inline=False)
            embed.add_field(name="Hash", value=hash_short or "-", inline=True)
            embed.add_field(name="Khoảng lặp", value=f"{bot.config.sheet_sync_interval}s", inline=True)
            await ctx.send(embed=embed)
        except Exception as e:
            await ctx.send(f"Lỗi: {e}")


    @bot.command(name="syncnow")
    @commands.has_permissions(manage_messages=True)
    async def syncnow(ctx):
        """Ép đồng bộ Google Sheet -> MongoDB ngay lập tức (admin)."""
        try:
            cog = bot.get_cog('SheetSyncCog')
            if cog is None or not hasattr(cog, '_sync_once'):
                await ctx.send("Chức năng đồng bộ chưa sẵn sàng hoặc chưa được cấu hình.")
                return
            msg = await ctx.reply("Đang đồng bộ...", mention_author=False)
            await cog._sync_once()
            mongo = getattr(bot, "mongo", None)
            last_result = mongo.get_meta("sheet_last_result") or {"created": 0, "updated": 0}
            await msg.edit(content=f"Đã đồng bộ xong: tạo {last_result.get('created',0)}, cập nhật {last_result.get('updated',0)}")
        except Exception as e:
            await ctx.send(f"Lỗi: {e}")
    @bot.command(name="clear")
    @commands.has_permissions(manage_messages=True)
    async def clear(ctx, amount: int = 5):
        """Xóa tin nhắn (Admin only)"""
        try:
            if amount > 100:
                await ctx.send("Chỉ có thể xóa tối đa 100 tin nhắn")
                return

            deleted = await ctx.channel.purge(limit=amount + 1)  # +1 for command message
            await ctx.send(f"Đã xóa {len(deleted) - 1} tin nhắn", delete_after=5)

        except Exception as e:
            await ctx.send(f"Lỗi: {str(e)}")

    @bot.command(name="kick")
    @commands.has_permissions(kick_members=True)
    async def kick(ctx, member: discord.Member, *, reason: str = "Không có lý do"):
        """Kick thành viên (Admin only)"""
        try:
            await member.kick(reason=reason)
            await ctx.send(f"Đã kick {member.mention}\nLý do: {reason}")

        except Exception as e:
            await ctx.send(f"Lỗi: {str(e)}")

    @bot.command(name="ban")
    @commands.has_permissions(ban_members=True)
    async def ban(ctx, member: discord.Member, *, reason: str = "Không có lý do"):
        """Ban thành viên (Admin only)"""
        try:
            await member.ban(reason=reason)
            await ctx.send(f"Đã ban {member.mention}\nLý do: {reason}")

        except Exception as e:
            await ctx.send(f"Lỗi: {str(e)}")

    @bot.command(name="unban")
    @commands.has_permissions(ban_members=True)
    async def unban(ctx, user_id: int):
        """Unban thành viên (Admin only)"""
        try:
            user = await bot.fetch_user(user_id)
            await ctx.guild.unban(user)
            await ctx.send(f"Đã unban {user.mention}")

        except Exception as e:
            await ctx.send(f"Lỗi: {str(e)}")

    @clear.error
    async def clear_error(ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("Bạn không có quyền sử dụng lệnh này!")

    @kick.error
    async def kick_error(ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("Bạn không có quyền sử dụng lệnh này!")

    @ban.error
    async def ban_error(ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("Bạn không có quyền sử dụng lệnh này!")

    @bot.command(name="editassign")
    @commands.has_permissions(administrator=True)
    async def editassign(ctx, member: discord.Member, mssv: str):
        """Admin command: Chỉnh sửa liên kết Discord ID với MSSV."""
        try:
            mongo = getattr(bot, "mongo", None)
            if not mongo:
                await ctx.send("❌ Hệ thống cơ sở dữ liệu chưa được cấu hình.")
                return

            # Kiểm tra MSSV có tồn tại không
            participant = mongo.participants.find_one({"mssv": str(mssv).strip()})
            if not participant:
                await ctx.send(f"❌ **Lỗi:** MSSV {mssv} không tồn tại trong hệ thống.")
                return

            # Kiểm tra xem MSSV này đã được liên kết với Discord ID nào chưa
            current_discord_id = participant.get("discord_id")
            current_discord_user = None
            if current_discord_id:
                current_discord_user = mongo.participants.find_one({"discord_id": int(current_discord_id)})

            # Kiểm tra xem Discord ID mới đã được sử dụng bởi MSSV khác chưa
            existing_user = mongo.participants.find_one({"discord_id": member.id})
            existing_mssv = None
            if existing_user:
                existing_mssv = existing_user.get("mssv")
                if existing_mssv == mssv:
                    # Nếu đã liên kết rồi thì không cần làm gì
                    await ctx.send(f"ℹ️ **Thông tin:** MSSV {mssv} đã được liên kết với Discord ID của {member.mention} rồi.")
                    return

            # Thực hiện cập nhật
            try:
                # Xóa liên kết cũ của MSSV hiện tại (nếu có)
                if current_discord_id:
                    mongo.participants.update_one(
                        {"mssv": str(mssv).strip()},
                        {"$unset": {"discord_id": "", "updated_at": ""}}
                    )
                    await ctx.send(f"🔄 **Đã xóa liên kết cũ:** MSSV {mssv} không còn liên kết với Discord ID {current_discord_id}")

                # Xóa liên kết cũ của Discord ID mới (nếu đang liên kết với MSSV khác)
                if existing_mssv and existing_mssv != mssv:
                    mongo.participants.update_one(
                        {"mssv": existing_mssv},
                        {"$unset": {"discord_id": "", "updated_at": ""}}
                    )
                    await ctx.send(f"🔄 **Đã xóa liên kết cũ:** Discord ID {member.mention} không còn liên kết với MSSV {existing_mssv}")

                # Gán Discord ID mới cho MSSV
                mongo.participants.update_one(
                    {"mssv": str(mssv).strip()},
                    {"$set": {"discord_id": member.id, "updated_at": datetime.now(timezone.utc)}}
                )

                # Set nickname to "[Team] Full Name"
                try:
                    fresh = mongo.participants.find_one({"mssv": str(mssv).strip()}) or participant
                    full_name = (fresh.get("full_name") if fresh else None)
                    team_label = (fresh.get("team_name") if fresh else None) or (
                        f"Team {fresh.get('team_id')}" if fresh and fresh.get("team_id") else None
                    )
                    nickname = build_nickname(full_name, team_label)
                    ok, err = await try_set_nickname(member, nickname, reason="Set nickname after !editassign")
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
                                await ctx.send(f"ℹ️ Không thể đổi nickname của {member.mention}: {hint}")
                            except Exception:
                                pass
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
                    value=f"{member.mention} ({member.id})",
                    inline=True
                )
                
                # Thông tin về các liên kết đã xóa
                removed_links = []
                if current_discord_id and current_discord_user:
                    removed_links.append(f"MSSV {mssv} ↔ Discord ID {current_discord_id}")
                if existing_mssv and existing_mssv != mssv:
                    removed_links.append(f"MSSV {existing_mssv} ↔ Discord ID {member.id}")
                
                if removed_links:
                    embed.add_field(
                        name="🔄 **Liên kết đã xóa**",
                        value="\n".join(removed_links),
                        inline=False
                    )
                
                embed.add_field(
                    name="👨‍💼 **Admin thực hiện**",
                    value=ctx.author.mention,
                    inline=False
                )
                embed.add_field(
                    name="🕒 **Thời gian**",
                    value=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S"),
                    inline=False
                )

                await ctx.send(embed=embed)

                # Gửi DM thông báo cho user được gán
                try:
                    user_embed = discord.Embed(
                        title="🔗 **Bạn đã được liên kết với MSSV mới**",
                        description=f"Admin {ctx.author.name} đã liên kết Discord của bạn với MSSV {mssv}.",
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
                        value=ctx.author.name,
                        inline=True
                    )
                    user_embed.add_field(
                        name="🕒 **Thời gian**",
                        value=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S"),
                        inline=True
                    )
                    
                    await member.send(embed=user_embed)
                except discord.Forbidden:
                    await ctx.send(f"⚠️ Không thể gửi DM cho {member.mention}. Họ có thể đã tắt DM.")

            except Exception as e:
                await ctx.send(f"❌ **Lỗi khi cập nhật:** {e}")

        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {e}")

    @editassign.error
    async def editassign_error(ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ **Lỗi:** Bạn không có quyền sử dụng lệnh này! Chỉ admin mới được phép.")
        elif isinstance(error, commands.MissingRequiredArgument):
            await ctx.send("❌ **Lỗi:** Thiếu tham số! Sử dụng: `!editassign @user <mssv>`")
        elif isinstance(error, commands.BadArgument):
            await ctx.send("❌ **Lỗi:** Tham số không hợp lệ! Sử dụng: `!editassign @user <mssv>`")

    @unban.error
    async def unban_error(ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("Bạn không có quyền sử dụng lệnh này!")

    @bot.command(name="addallrole")
    @commands.has_permissions(administrator=True)
    async def addallrole(ctx):
        """Tự động tạo role và channel cho tất cả các đội có thành viên"""
        try:
            # Check if category ID is configured
            if not bot.config.team_category_id:
                await ctx.send("❌ **Lỗi:** Chưa cấu hình `CATEGORYIDFORTEAM` trong file .env")
                return

            # Get category
            category = bot.get_channel(bot.config.team_category_id)
            if not category:
                await ctx.send(f"❌ **Lỗi:** Không tìm thấy category với ID {bot.config.team_category_id}")
                return

            # Get MongoDB instance
            mongo = getattr(bot, "mongo", None)
            if not mongo:
                await ctx.send("❌ **Lỗi:** Hệ thống cơ sở dữ liệu chưa được cấu hình.")
                return

            # Send initial message
            status_embed = discord.Embed(
                title="🔄 **Đang tạo role và channel cho các đội...**",
                description="Vui lòng chờ trong khi bot xử lý...",
                color=0xf39c12
            )
            status_msg = await ctx.send(embed=status_embed)

            # Get teams with members
            teams_with_members = mongo.get_teams_with_members()
            
            if not teams_with_members:
                await status_msg.edit(embed=discord.Embed(
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
                    role = discord.utils.get(ctx.guild.roles, name=clean_team_name)
                    if not role:
                        try:
                            role = await ctx.guild.create_role(
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
                    # Search guild-wide to avoid duplicates; will choose category dynamically if creating
                    categories = get_valid_team_categories_for_guild(bot, ctx.guild)
                    text_channel = discord.utils.get(ctx.guild.text_channels, name=text_channel_name)
                    if not text_channel:
                        try:
                            # Set up text channel permissions
                            overwrites = {
                                ctx.guild.default_role: discord.PermissionOverwrite(
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
                            # Choose category with capacity for creation (2 slots: text + voice)
                            category = pick_category_for_new_channels(categories, needed_slots=2)
                            if not category:
                                raise RuntimeError("KhA'ng cA3 category nA�o phA�n cA2n dung l��%ng")
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
                    voice_channel = discord.utils.get(ctx.guild.voice_channels, name=voice_channel_name)
                    if not voice_channel:
                        try:
                            # Set up voice channel permissions
                            overwrites = {
                                ctx.guild.default_role: discord.PermissionOverwrite(
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
                            # Prefer creating under same category as text (if newly created) otherwise pick with capacity
                            voice_cat = getattr(text_channel, 'category', None) or category or pick_category_for_new_channels(categories, needed_slots=1)
                            if not voice_cat:
                                raise RuntimeError("KhA'ng cA3 category nA�o phA�n cA2n dung l��%ng")
                            category = voice_cat
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

                    # Update team document with channel IDs for future features (e.g., TeamQR)
                    try:
                        updates = {}
                        if text_channel:
                            updates["text_channel_id"] = int(text_channel.id)
                        if voice_channel:
                            updates["voice_channel_id"] = int(voice_channel.id)
                        if updates:
                            key = {"team_id": team_id} if team_id else {"team_name": team_name}
                            mongo.teams.update_one(key, {"$set": updates}, upsert=True)
                    except Exception:
                        pass

                    # Assign role to team members
                    for member_data in members:
                        discord_id = member_data.get("discord_id")
                        if not discord_id:
                            continue

                        member = ctx.guild.get_member(discord_id)
                        if member is None:
                            try:
                                member = await ctx.guild.fetch_member(discord_id)
                            except Exception:
                                member = None
                        if member:
                            try:
                                full_name = (member_data.get("full_name") or "").strip()
                                team_label = team_name
                                nickname = build_nickname(full_name, team_label)
                                await try_set_nickname(member, nickname, reason="Set nickname during !addallrole")
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
                value=ctx.author.mention,
                inline=True
            )
            final_embed.add_field(
                name="🕒 **Thời gian**",
                value=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S"),
                inline=True
            )

            await status_msg.edit(embed=final_embed)

        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {e}")

    @addallrole.error
    async def addallrole_error(ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ **Lỗi:** Bạn không có quyền sử dụng lệnh này! Chỉ admin mới được phép.")
        else:
            await ctx.send(f"❌ **Lỗi:** {error}")

    @bot.command(name="checkteamconfig")
    @commands.has_permissions(administrator=True)
    async def checkteamconfig(ctx):
        """Kiểm tra cấu hình cho lệnh addallrole"""
        try:
            embed = discord.Embed(
                title="🔧 **Kiểm tra cấu hình Team Setup**",
                color=0x3498db
            )
            
            # Check category configuration
            if bot.config.team_category_id:
                category = bot.get_channel(bot.config.team_category_id)
                if category:
                    embed.add_field(
                        name="✅ **Category**",
                        value=f"**ID:** {bot.config.team_category_id}\n**Tên:** {category.name}\n**Loại:** {category.type}",
                        inline=False
                    )
                else:
                    embed.add_field(
                        name="❌ **Category**",
                        value=f"**ID:** {bot.config.team_category_id}\n**Trạng thái:** Không tìm thấy category",
                        inline=False
                    )
            else:
                embed.add_field(
                    name="❌ **Category**",
                    value="**Trạng thái:** Chưa cấu hình `CATEGORYIDFORTEAM` trong .env",
                    inline=False
                )
            
            # Check MongoDB
            mongo = getattr(bot, "mongo", None)
            if mongo:
                try:
                    teams_with_members = mongo.get_teams_with_members()
                    embed.add_field(
                        name="✅ **MongoDB**",
                        value=f"**Trạng thái:** Kết nối thành công\n**Đội có thành viên:** {len(teams_with_members)}",
                        inline=False
                    )
                    
                    if teams_with_members:
                        team_list = []
                        for team in teams_with_members[:5]:  # Show first 5 teams
                            team_name = team.get("team_name", "Unknown")
                            member_count = len(team.get("members_with_discord", []))
                            team_list.append(f"• {team_name}: {member_count} thành viên")
                        
                        if len(teams_with_members) > 5:
                            team_list.append(f"... và {len(teams_with_members) - 5} đội khác")
                        
                        embed.add_field(
                            name="📋 **Danh sách đội**",
                            value="\n".join(team_list),
                            inline=False
                        )
                except Exception as e:
                    embed.add_field(
                        name="❌ **MongoDB**",
                        value=f"**Trạng thái:** Lỗi kết nối\n**Chi tiết:** {e}",
                        inline=False
                    )
            else:
                embed.add_field(
                    name="❌ **MongoDB**",
                    value="**Trạng thái:** Chưa khởi tạo MongoDB",
                    inline=False
                )
            
            # Check bot permissions
            bot_member = ctx.guild.get_member(bot.user.id)
            if bot_member:
                required_permissions = [
                    "manage_roles",
                    "manage_channels",
                    "view_channels",
                    "send_messages"
                ]
                
                missing_permissions = []
                for perm in required_permissions:
                    if not getattr(bot_member.guild_permissions, perm, False):
                        missing_permissions.append(perm)
                
                if missing_permissions:
                    embed.add_field(
                        name="❌ **Quyền Bot**",
                        value=f"**Thiếu quyền:** {', '.join(missing_permissions)}",
                        inline=False
                    )
                else:
                    embed.add_field(
                        name="✅ **Quyền Bot**",
                        value="**Trạng thái:** Đủ quyền để tạo role và channel",
                        inline=False
                    )
            
            embed.add_field(
                name="💡 **Hướng dẫn**",
                value="Sử dụng `!addallrole` để tạo role và channel cho tất cả đội có thành viên.",
                inline=False
            )
            
            await ctx.send(embed=embed)
            
        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {e}")

    @checkteamconfig.error
    async def checkteamconfig_error(ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ **Lỗi:** Bạn không có quyền sử dụng lệnh này! Chỉ admin mới được phép.")
        else:
            await ctx.send(f"❌ **Lỗi:** {error}")

    @bot.command(name="checkteampermissions")
    @commands.has_permissions(administrator=True)
    async def checkteampermissions(ctx, team_name: str = None):
        """Kiểm tra permissions của role và channel của team"""
        try:
            if not team_name:
                await ctx.send("❌ **Lỗi:** Vui lòng nhập tên team! Ví dụ: `!checkteampermissions Team Alpha`")
                return

            # Clean team name
            clean_team_name = "".join(c for c in team_name if c.isalnum() or c in " -_").strip()
            if len(clean_team_name) > 32:
                clean_team_name = clean_team_name[:32]

            embed = discord.Embed(
                title=f"🔍 **Kiểm tra Permissions - {clean_team_name}**",
                color=0x3498db
            )

            # Check role
            role = discord.utils.get(ctx.guild.roles, name=clean_team_name)
            if role:
                embed.add_field(
                    name="✅ **Role**",
                    value=f"**Tên:** {role.name}\n**ID:** {role.id}\n**Màu:** {role.color}\n**Thành viên:** {len(role.members)}",
                    inline=False
                )
            else:
                embed.add_field(
                    name="❌ **Role**",
                    value=f"Không tìm thấy role `{clean_team_name}`",
                    inline=False
                )

            # Check text channel
            text_channel_name = f"{clean_team_name.lower().replace(' ', '-')}"
            text_channel = discord.utils.get(ctx.guild.text_channels, name=text_channel_name)
            if text_channel:
                embed.add_field(
                    name="✅ **Text Channel**",
                    value=f"**Tên:** {text_channel.name}\n**ID:** {text_channel.id}\n**Category:** {text_channel.category.name if text_channel.category else 'None'}",
                    inline=False
                )
                
                # Check permissions
                if role:
                    role_perms = text_channel.permissions_for(role)
                    embed.add_field(
                        name="📝 **Text Channel Permissions**",
                        value=f"**Đọc tin nhắn:** {'✅' if role_perms.read_messages else '❌'}\n"
                              f"**Gửi tin nhắn:** {'✅' if role_perms.send_messages else '❌'}\n"
                              f"**Gửi file:** {'✅' if role_perms.attach_files else '❌'}\n"
                              f"**Embed links:** {'✅' if role_perms.embed_links else '❌'}\n"
                              f"**Reactions:** {'✅' if role_perms.add_reactions else '❌'}",
                        inline=True
                    )
            else:
                embed.add_field(
                    name="❌ **Text Channel**",
                    value=f"Không tìm thấy text channel `{text_channel_name}`",
                    inline=False
                )

            # Check voice channel
            voice_channel = discord.utils.get(ctx.guild.voice_channels, name=text_channel_name)
            if voice_channel:
                embed.add_field(
                    name="✅ **Voice Channel**",
                    value=f"**Tên:** {voice_channel.name}\n**ID:** {voice_channel.id}\n**Category:** {voice_channel.category.name if voice_channel.category else 'None'}\n**User limit:** {voice_channel.user_limit}",
                    inline=False
                )
                
                # Check permissions
                if role:
                    role_perms = voice_channel.permissions_for(role)
                    embed.add_field(
                        name="🎤 **Voice Channel Permissions**",
                        value=f"**Kết nối:** {'✅' if role_perms.connect else '❌'}\n"
                              f"**Xem channel:** {'✅' if role_perms.view_channel else '❌'}\n"
                              f"**Nói chuyện:** {'✅' if role_perms.speak else '❌'}\n"
                              f"**Stream:** {'✅' if role_perms.stream else '❌'}",
                        inline=True
                    )
            else:
                embed.add_field(
                    name="❌ **Voice Channel**",
                    value=f"Không tìm thấy voice channel `{text_channel_name}`",
                    inline=False
                )

            await ctx.send(embed=embed)

        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {e}")

    @checkteampermissions.error
    async def checkteampermissions_error(ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ **Lỗi:** Bạn không có quyền sử dụng lệnh này! Chỉ admin mới được phép.")
        else:
            await ctx.send(f"❌ **Lỗi:** {error}")
