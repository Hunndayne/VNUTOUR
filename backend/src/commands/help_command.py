"""Help for the PostgreSQL-backed VNUTour bot."""
import discord


def setup_help_command(bot):
    @bot.command(name="help", aliases=["h", "commands"])
    async def help_command(ctx):
        embed = discord.Embed(
            title="VNUTour Bot · Hướng dẫn",
            description="Dữ liệu được đồng bộ trực tiếp với trang web qua PostgreSQL.",
            color=discord.Color.blurple(),
        )
        embed.add_field(
            name="Tài khoản",
            value=(
                "`!assign <mssv>` hoặc `/assign` · liên kết Discord với hồ sơ web\n"
                "`!mystation` · xem trạm hiện tại của đội"
            ),
            inline=False,
        )
        embed.add_field(
            name="Sự kiện",
            value="`!stations` · trạm đang mở\n`!leaderboard` · bảng xếp hạng PostgreSQL",
            inline=False,
        )
        embed.add_field(
            name="Quản trị",
            value=(
                "`!check [mssv]` · tra hồ sơ\n"
                "`!editassign @user <mssv>` · sửa liên kết\n"
                "`!addallrole` · đưa các đội đã duyệt vào queue\n"
                "`!teamqr` · gửi QR đang được bật trên web\n"
                "`!checkteamconfig` · trạng thái tích hợp"
            ),
            inline=False,
        )
        if bot.config.web_base_url:
            embed.add_field(name="Trang web", value=bot.config.web_base_url, inline=False)
        embed.set_footer(text="VNUTour Bot 2.0 · PostgreSQL")
        await ctx.send(embed=embed)
