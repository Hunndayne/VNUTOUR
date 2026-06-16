"""
Help command for bot
"""
import discord
from discord.ext import commands


def setup_help_command(bot):
    """Setup help command"""

    @bot.command(name="help", aliases=["h", "commands"])
    async def help_command(ctx, command_name: str = None):
        """Hiển thị hướng dẫn sử dụng"""

        if command_name:
            # Show help for specific command
            command = bot.get_command(command_name)
            if not command:
                await ctx.send(f"Không tìm thấy lệnh `{command_name}`")
                return

            embed = discord.Embed(
                title=f"Lệnh: {command.name}",
                description=command.help or "Không có mô tả",
                color=0x00ff00,
            )

            if getattr(command, "aliases", None):
                embed.add_field(
                    name="Tên viết tắt",
                    value=", ".join(command.aliases),
                    inline=False,
                )

            await ctx.send(embed=embed)
            return

        # General help
        embed = discord.Embed(
            title="VnuTourBot - Hướng dẫn sử dụng",
            description="Bot quản lý tour VNU với các chức năng âm nhạc và quản lý trạm",
            color=0x00ff00,
        )

        # Music commands
        embed.add_field(
            name="Lệnh âm nhạc",
            value=(
                "`!play <tên/URL>` hoặc `/play <tên/URL>` - Phát nhạc\n"
                "`!skip` hoặc `/skip` - Bỏ qua bài hiện tại\n"
                "`!queue` hoặc `/queue` - Hiển thị queue\n"
                "`!stop` hoặc `/stop` - Dừng phát nhạc\n"
                "`!volume <0-200>` hoặc `/volume <0-200>` - Điều chỉnh âm lượng\n"
                "`!exit` - Thoát voice channel"
            ),
            inline=False,
        )

        # Tour commands
        embed.add_field(
            name="Lệnh tour",
            value=(
                "`!stations` - Danh sách trạm\n"
                "`!checkin <id> <tên đội>` - Check-in\n"
                "`!checkout <tên đội>` - Check-out\n"
                "`!mystation` - Trạm hiện tại\n"
                "`!leaderboard` - Bảng xếp hạng"
            ),
            inline=False,
        )

        # Data commands
        embed.add_field(
            name="Dữ liệu (MongoDB)",
            value=(
                "`!assign <mssv>` hoặc `/assign mssv:<mssv>` - Liên kết Discord với MSSV.\n"
                "`!check [mssv]` hoặc `/check [mssv]` - Kiểm tra thông tin tham gia viên.\n"
                "`!editassign @<user> <mssv>` hoặc `/editassign <user> <mssv>` - Chỉnh sửa liên kết Discord ID với MSSV (Admin only).\n"
                "`!syncstatus` - Xem trạng thái đồng bộ Google Sheet.\n"
                "`!syncnow` - Ép đồng bộ ngay (admin).\n"
                "Yêu cầu MSSV đã tồn tại trong cơ sở dữ liệu."
            ),
            inline=False,
        )

        # Admin commands
        embed.add_field(
            name="Lệnh admin",
            value=(
                "`!ping` hoặc `/ping` - Kiểm tra độ trễ\n"
                "`!info` hoặc `/info` - Thông tin bot\n"
                "`!clear <số>` hoặc `/clear <số>` - Xóa tin nhắn\n"
                "`!kick <@user> <lý do>` - Kick\n"
                "`!ban <@user> <lý do>` - Ban\n"
                "`!addallrole` hoặc `/addallrole` - Tự động tạo role và channel cho tất cả đội có thành viên\n"
                "`!checkteamconfig` - Kiểm tra cấu hình team setup\n"
                "`!checkteampermissions <tên team>` - Kiểm tra permissions của role và channel"
            ),
            inline=False,
        )

        embed.add_field(
            name="Ghi chú",
            value=(
                "Sử dụng `!help <tên lệnh>` để xem chi tiết từng lệnh.\n"
                "Gõ `/` để xem danh sách slash commands với giao diện gợi ý."
            ),
            inline=False,
        )

        embed.set_footer(text="Prefix: ! hoặc / | VnuTourBot v1.0")
        await ctx.send(embed=embed)
