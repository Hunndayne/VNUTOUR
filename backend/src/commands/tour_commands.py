"""
Tour management commands
"""
import discord
from discord.ext import commands
from datetime import datetime, timedelta


# Mock database for tour stations (replace with real database later)
tour_stations = {
    1: {"name": "Trạm 1 - UIT - Trường Đại học Công nghệ Thông tin", "status": "available", "current_team": None, "checkin_time": None},
    2: {"name": "Trạm 2 - Thư viện trung tâm", "status": "available", "current_team": None, "checkin_time": None},
    3: {"name": "Trạm 3 - Trung tâm Giáo dục quốc phòng và an ninh", "status": "available", "current_team": None, "checkin_time": None},
    4: {"name": "Trạm 4 - HCMUT - Trường đại học Bách Khoa Thành phố Hồ Chí Minh", "status": "available", "current_team": None, "checkin_time": None},
    5: {"name": "Trạm 5 - HCMUS - Trường đại học Khoa học Tự nhiên", "status": "available", "current_team": None, "checkin_time": None},
    6: {"name": "Trạm 6 - USSH - Trường đại học Khoa học Xã hội và Nhân văn", "status": "available", "current_team": None, "checkin_time": None},
    7: {"name": "Trạm 7 - IU - Trường Đại học Quốc tế", "status": "available", "current_team": None, "checkin_time": None},
    8: {"name": "Trạm 8 - KTXA - Ký túc xá khu A", "status": "available", "current_team": None, "checkin_time": None},
    9: {"name": "Trạm 9 - KTXB - Ký túc xá khu B", "status": "available", "current_team": None, "checkin_time": None},
    10: {"name": "Trạm 10 - NVHSV - Nhà văn hóa sinh viên", "status": "available", "current_team": None, "checkin_time": None}
}

# Mock team database
teams = {}


def setup_tour_commands(bot):
    """Setup tour management commands"""
    
    @bot.command(name="stations")
    async def stations(ctx):
        """Hiển thị danh sách tất cả trạm"""
        embed = discord.Embed(
            title="🏁 **Danh sách trạm tour VNU**",
            description="Trạng thái hiện tại của các trạm",
            color=0x00ff00
        )
        
        for station_id, station in tour_stations.items():
            status_emoji = "🟢" if station["status"] == "available" else "🔴"
            team_info = f"Đội: {station['current_team']}" if station["current_team"] else "Trống"
            
            embed.add_field(
                name=f"{status_emoji} {station['name']}",
                value=f"**Trạng thái:** {station['status']}\n**{team_info}**",
                inline=True
            )
        
        embed.set_footer(text="Sử dụng !checkin <trạm_id> để check-in")
        await ctx.send(embed=embed)
    
    @bot.command(name="checkin")
    async def checkin(ctx, station_id: int, *, team_name: str):
        """Check-in vào trạm"""
        try:
            if station_id not in tour_stations:
                await ctx.send(f"❌ **Lỗi:** Trạm {station_id} không tồn tại!")
                return
            
            station = tour_stations[station_id]
            
            if station["status"] != "available":
                await ctx.send(f"❌ **Lỗi:** Trạm {station_id} đã có đội khác!")
                return
            
            # Check-in
            station["status"] = "occupied"
            station["current_team"] = team_name
            station["checkin_time"] = datetime.now()
            
            # Log team info
            teams[team_name] = {
                "current_station": station_id,
                "checkin_time": station["checkin_time"],
                "member": ctx.author.id
            }
            
            embed = discord.Embed(
                title="✅ **Check-in thành công!**",
                description=f"Đội **{team_name}** đã check-in vào {station['name']}",
                color=0x00ff00
            )
            
            embed.add_field(
                name="📍 **Trạm**",
                value=f"{station['name']} (ID: {station_id})",
                inline=True
            )
            
            embed.add_field(
                name="⏰ **Thời gian**",
                value=station["checkin_time"].strftime("%H:%M:%S"),
                inline=True
            )
            
            embed.add_field(
                name="👥 **Thành viên**",
                value=ctx.author.mention,
                inline=True
            )
            
            await ctx.send(embed=embed)
            
        except ValueError:
            await ctx.send("❌ **Lỗi:** ID trạm phải là số!")
        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {str(e)}")
    
    @bot.command(name="checkout")
    async def checkout(ctx, *, team_name: str):
        """Check-out khỏi trạm hiện tại"""
        try:
            if team_name not in teams:
                await ctx.send(f"❌ **Lỗi:** Đội {team_name} chưa check-in trạm nào!")
                return
            
            team = teams[team_name]
            station_id = team["current_station"]
            station = tour_stations[station_id]
            
            # Calculate time spent
            checkin_time = team["checkin_time"]
            checkout_time = datetime.now()
            time_spent = checkout_time - checkin_time
            
            # Check-out
            station["status"] = "available"
            station["current_team"] = None
            station["checkin_time"] = None
            
            # Remove team from database
            del teams[team_name]
            
            embed = discord.Embed(
                title="🏁 **Check-out thành công!**",
                description=f"Đội **{team_name}** đã hoàn thành trạm {station['name']}",
                color=0xff8800
            )
            
            embed.add_field(
                name="⏱️ **Thời gian hoàn thành**",
                value=f"{time_spent.seconds // 60} phút {time_spent.seconds % 60} giây",
                inline=True
            )
            
            embed.add_field(
                name="👥 **Thành viên**",
                value=ctx.author.mention,
                inline=True
            )
            
            await ctx.send(embed=embed)
            
        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {str(e)}")
    
    @bot.command(name="mystation")
    async def mystation(ctx):
        """Hiển thị trạm hiện tại của người dùng"""
        try:
            user_id = ctx.author.id
            user_team = None
            
            # Find team by member
            for team_name, team_info in teams.items():
                if team_info["member"] == user_id:
                    user_team = team_name
                    break
            
            if not user_team:
                await ctx.send("❌ Bạn chưa check-in trạm nào!")
                return
            
            team = teams[user_team]
            station_id = team["current_station"]
            station = tour_stations[station_id]
            
            embed = discord.Embed(
                title="📍 **Trạm hiện tại của bạn**",
                description=f"Đội **{user_team}**",
                color=0x0099ff
            )
            
            embed.add_field(
                name="🏁 **Trạm**",
                value=f"{station['name']} (ID: {station_id})",
                inline=True
            )
            
            embed.add_field(
                name="⏰ **Check-in lúc**",
                value=team["checkin_time"].strftime("%H:%M:%S"),
                inline=True
            )
            
            embed.add_field(
                name="⏱️ **Đã ở trạm**",
                value=f"{(datetime.now() - team['checkin_time']).seconds // 60} phút",
                inline=True
            )
            
            await ctx.send(embed=embed)
            
        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {str(e)}")
    
    @bot.command(name="leaderboard")
    async def leaderboard(ctx):
        """Hiển thị bảng xếp hạng các đội"""
        if not teams:
            await ctx.send("📊 Chưa có đội nào check-in!")
            return
        
        # Sort teams by time spent
        sorted_teams = sorted(
            teams.items(),
            key=lambda x: datetime.now() - x[1]["checkin_time"],
            reverse=True
        )
        
        embed = discord.Embed(
            title="🏆 **Bảng xếp hạng các đội**",
            description="Sắp xếp theo thời gian ở trạm",
            color=0xffd700
        )
        
        for i, (team_name, team_info) in enumerate(sorted_teams[:10], 1):  # Top 10
            station_id = team_info["current_station"]
            station = tour_stations[station_id]
            time_spent = datetime.now() - team_info["checkin_time"]
            
            embed.add_field(
                name=f"#{i} 🥇 {team_name}",
                value=f"**Trạm:** {station['name']}\n**Thời gian:** {time_spent.seconds // 60} phút",
                inline=False
            )
        
        embed.set_footer(text="Cập nhật theo thời gian thực")
        await ctx.send(embed=embed)
