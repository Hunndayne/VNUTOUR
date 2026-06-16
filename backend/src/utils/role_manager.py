"""
Role management utilities
"""
import discord
from typing import Optional, List


class RoleManager:
    """Manages Discord roles for tour participants"""
    
    def __init__(self, bot):
        self.bot = bot
    
    async def assign_tour_role(self, member: discord.Member, role_name: str = "Tour Participant") -> bool:
        """Assign tour role to member"""
        try:
            # Find or create tour role
            role = discord.utils.get(member.guild.roles, name=role_name)
            
            if not role:
                # Create role if it doesn't exist
                role = await member.guild.create_role(
                    name=role_name,
                    color=discord.Color.blue(),
                    reason="Tour participant role"
                )
            
            # Assign role to member
            if role not in member.roles:
                await member.add_roles(role, reason="Tour participation")
                return True
            
            return False  # Role already assigned
            
        except Exception as e:
            print(f"[ROLE ERROR] Không thể gán role: {e}")
            return False
    
    async def remove_tour_role(self, member: discord.Member, role_name: str = "Tour Participant") -> bool:
        """Remove tour role from member"""
        try:
            role = discord.utils.get(member.guild.roles, name=role_name)
            
            if role and role in member.roles:
                await member.remove_roles(role, reason="Tour completion")
                return True
            
            return False  # Role not found or not assigned
            
        except Exception as e:
            print(f"[ROLE ERROR] Không thể xóa role: {e}")
            return False
    
    async def get_tour_participants(self, guild: discord.Guild, role_name: str = "Tour Participant") -> List[discord.Member]:
        """Get all members with tour role"""
        try:
            role = discord.utils.get(guild.roles, name=role_name)
            
            if not role:
                return []
            
            return role.members
            
        except Exception as e:
            print(f"[ROLE ERROR] Không thể lấy danh sách participants: {e}")
            return []
    
    async def create_team_role(self, guild: discord.Guild, team_name: str, color: discord.Color = None) -> Optional[discord.Role]:
        """Create a role for a specific team"""
        try:
            if not color:
                color = discord.Color.random()
            
            role = await guild.create_role(
                name=f"Team {team_name}",
                color=color,
                reason=f"Team role for {team_name}"
            )
            
            return role
            
        except Exception as e:
            print(f"[ROLE ERROR] Không thể tạo team role: {e}")
            return None
    
    async def assign_team_role(self, member: discord.Member, team_name: str) -> bool:
        """Assign team role to member"""
        try:
            # Find or create team role
            role_name = f"Team {team_name}"
            role = discord.utils.get(member.guild.roles, name=role_name)
            
            if not role:
                role = await self.create_team_role(member.guild, team_name)
                if not role:
                    return False
            
            # Assign role
            if role not in member.roles:
                await member.add_roles(role, reason=f"Team {team_name} assignment")
                return True
            
            return False
            
        except Exception as e:
            print(f"[ROLE ERROR] Không thể gán team role: {e}")
            return False
    
    async def remove_team_role(self, member: discord.Member, team_name: str) -> bool:
        """Remove team role from member"""
        try:
            role_name = f"Team {team_name}"
            role = discord.utils.get(member.guild.roles, name=role_name)
            
            if role and role in member.roles:
                await member.remove_roles(role, reason=f"Team {team_name} removal")
                return True
            
            return False
            
        except Exception as e:
            print(f"[ROLE ERROR] Không thể xóa team role: {e}")
            return False
    
    async def cleanup_team_role(self, guild: discord.Guild, team_name: str):
        """Remove team role if no members have it"""
        try:
            role_name = f"Team {team_name}"
            role = discord.utils.get(guild.roles, name=role_name)
            
            if role and len(role.members) == 0:
                await role.delete(reason=f"Team {team_name} no longer has members")
                return True
            
            return False
            
        except Exception as e:
            print(f"[ROLE ERROR] Không thể cleanup team role: {e}")
            return False




