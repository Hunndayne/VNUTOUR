"""
Member-related events (join, leave, etc.)
"""
import discord


def setup_member_events(bot):
    """Setup member event handlers"""

    @bot.event
    async def on_member_join(member: discord.Member):
        """Called when a member joins the guild"""
        await bot.logger.log_member_join(member)

        # Welcome announcement in the configured channel
        if bot.config.welcome_channel_id:
            try:
                welcome_channel = bot.get_channel(bot.config.welcome_channel_id)
                if welcome_channel:
                    welcome_msg = (
                        f"🎉 **Chào mừng {member.mention} đến với server!**\n"
                        f"Bạn là thành viên thứ {member.guild.member_count} của server.\n"
                        f"Chúc bạn có những trải nghiệm thật tuyệt vời! ✨"
                    )
                    await welcome_channel.send(welcome_msg)
            except Exception as e:
                print(f"[WELCOME ERROR] {e}")

        # DM a rich welcome guide to the new member
        try:
            # Channel IDs provided for guidance links
            start_here_id = 1396128700109422712
            rules_id = 1396131505927094282
            sync_mssv_id = 1411240925417705473

            guild_name = member.guild.name if member.guild else "Server"

            embed = discord.Embed(
                title=(
                    "Chào mừng đến với ngôi nhà chung của "
                    "VNU Tour – Hành trình thực tế khám phá khu đô thị ĐHQG-HCM! 🎉"
                ),
                description=(
                    "Đây là không gian để chúng ta cùng nhau kết nối, trao đổi và cập nhật những thông tin mới nhất "
                    "về chương trình do Đoàn khoa Mạng máy tính và Truyền thông tổ chức.\n\n"
                    "Để có một trải nghiệm tốt nhất tại server, bạn vui lòng dành chút thời gian thực hiện các bước sau:"
                ),
                color=discord.Color.blurple(),
            )

            if member.guild and member.guild.icon:
                embed.set_thumbnail(url=member.guild.icon.url)

            # Steps
            embed.add_field(
                name="1) Bắt đầu tại đây",
                value=(
                    f"Ghé thăm kênh 🚪 │ <#{start_here_id}> để nắm rõ chức năng của các kênh chat và cách hoạt động của server."
                ),
                inline=False,
            )

            embed.add_field(
                name="2) Đọc kỹ quy định",
                value=(
                    f"Dành vài phút tại 📜 │ <#{rules_id}> để hiểu rõ các quy định của cộng đồng, giúp chúng ta xây dựng một môi trường văn minh và thân thiện."
                ),
                inline=False,
            )

            embed.add_field(
                name="3) QUAN TRỌNG: Đồng bộ Mã số sinh viên",
                value=(
                    f"Truy cập kênh 🔄 │ <#{sync_mssv_id}>\n"
                    "Sử dụng cú pháp: `!assign <Mã số sinh viên của bạn>`\n"
                    "Ví dụ: `!assign 2552xxxx`\n"
                    "Đây là bước bắt buộc để xác thực và cấp quyền cho bạn."
                ),
                inline=False,
            )

            embed.add_field(
                name="4) Cần hỗ trợ?",
                value=(
                    "Nếu gặp bất kỳ khó khăn hay phát hiện lỗi nào trong quá trình sử dụng, hãy gửi hỗ trợ của bạn tại kênh `support-ticket`. "
                    "Đội ngũ quản trị viên sẽ giúp bạn ngay lập tức.\n"
                    "Lưu ý: Các yêu cầu hỗ trợ ngoài kênh này sẽ không được xử lý."
                ),
                inline=False,
            )

            embed.set_footer(text=f"Chúc bạn có những trải nghiệm thú vị và bổ ích cùng {guild_name}!")

            # Action buttons
            view = discord.ui.View()
            view.add_item(
                discord.ui.Button(
                    label="Facebook VNU TOUR",
                    url="https://www.facebook.com/VNUTour",
                    emoji="🌐",
                )
            )
            view.add_item(
                discord.ui.Button(
                    label="Facebook Khoa MMT&TT",
                    url="https://www.facebook.com/uit.nc",
                    emoji="🌐",
                )
            )

            greeting = (
                f"Chào mừng {member.mention} đến với ngôi nhà chung của "
                f"**VNU Tour – Hành trình thực tế khám phá khu đô thị ĐHQG-HCM**! 🎉"
            )

            await member.send(content=greeting, embed=embed, view=view)
        except discord.Forbidden:
            # User has DMs disabled or bot cannot DM — ignore silently
            pass
        except Exception as e:
            # Log but don't break join flow
            try:
                await bot.logger.log(f"[WELCOME DM ERROR] Không thể gửi DM cho {member.id}: {e}")
            except Exception:
                print(f"[WELCOME DM ERROR] Không thể gửi DM cho {member.id}: {e}")

    @bot.event
    async def on_member_remove(member: discord.Member):
        """Called when a member leaves the guild"""
        await bot.logger.log_member_leave(member)

    @bot.event
    async def on_member_update(before: discord.Member, after: discord.Member):
        """Called when a member is updated (nickname, roles, etc.)"""
        # Log role changes
        if before.roles != after.roles:
            added_roles = set(after.roles) - set(before.roles)
            removed_roles = set(before.roles) - set(after.roles)

            if added_roles:
                role_names = ", ".join([role.name for role in added_roles if role.name != "@everyone"])
                if role_names:
                    await bot.logger.log(f"🔔 **{after.mention} được thêm role:** {role_names}")

            if removed_roles:
                role_names = ", ".join([role.name for role in removed_roles if role.name != "@everyone"])
                if role_names:
                    await bot.logger.log(f"🔔 **{after.mention} bị mất role:** {role_names}")

        # Log nickname changes
        if before.nick != after.nick:
            old_nick = before.nick or before.name
            new_nick = after.nick or after.name
            await bot.logger.log(f"✏️ **{after.mention} đổi nickname:** `{old_nick}` → `{new_nick}`")

