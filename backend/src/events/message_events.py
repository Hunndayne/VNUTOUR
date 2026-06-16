"""
Message event handlers
"""
import discord
from discord.ext import commands
from datetime import datetime, timezone
import re
import asyncio


def setup_message_events(bot):
    """Setup message event handlers"""
    
    @bot.event
    async def on_message(message: discord.Message):
        """Called when a message is sent"""
        # Ignore bot messages
        if message.author.bot:
            return
        
        # Log message if it's in a monitored channel
        if message.guild and bot.config.log_channel_id:
            # You can add specific channel monitoring logic here
            pass
        
        # Process commands (required for commands to work)
        await bot.process_commands(message)

        # After commands are processed, if this was an !assign, ensure team resources for this user
        try:
            content = (message.content or "").strip()
            prefix = getattr(bot, "prefix", "!") or "!"
            if content.lower().startswith(f"{prefix}assign"):
                asyncio.create_task(_post_assign_provision(bot, message))
        except Exception:
            pass

    async def _post_assign_provision(bot, message: discord.Message):
        """Provision role/channels for the user's team after !assign finishes, and assign role to the user.

        Runs shortly after the command to allow DB to be updated.
        """
        try:
            await asyncio.sleep(1.0)
            mongo = getattr(bot, "mongo", None)
            if not mongo or not message.guild:
                return

            # Fetch participant by Discord ID
            doc = mongo.participants.find_one({"discord_id": message.author.id})
            if not doc:
                return

            team_name = doc.get("team_name")
            team_id = doc.get("team_id")
            if not team_name and not team_id:
                return

            base_name = team_name or (f"Team {team_id}" if team_id else None)
            if not base_name:
                return

            # Clean team name for Discord entities
            clean_team_name = "".join(c for c in base_name if c.isalnum() or c in " -_").strip()
            if not clean_team_name:
                return
            if len(clean_team_name) > 32:
                clean_team_name = clean_team_name[:32]

            guild = message.guild

            # Ensure role exists
            role = discord.utils.get(guild.roles, name=clean_team_name)
            if not role:
                try:
                    role = await guild.create_role(
                        name=clean_team_name,
                        color=discord.Color.random(),
                        reason=f"Auto-created after !assign for team {team_id or clean_team_name}"
                    )
                except Exception:
                    role = None

            # Ensure channels exist under configured category
            category = None
            try:
                if getattr(bot.config, "team_category_id", None):
                    category = bot.get_channel(bot.config.team_category_id)
            except Exception:
                category = None

            if category and clean_team_name and role:
                chan_name = clean_team_name.lower().replace(' ', '-')
                # Text channel
                try:
                    text_chan = discord.utils.get(guild.text_channels, name=chan_name)
                    if not text_chan:
                        overwrites = {
                            guild.default_role: discord.PermissionOverwrite(
                                read_messages=False, send_messages=False, view_channel=False
                            ),
                            role: discord.PermissionOverwrite(
                                read_messages=True, send_messages=True, attach_files=True, embed_links=True,
                                view_channel=True, add_reactions=True, read_message_history=True
                            )
                        }
                        try:
                            categories = get_valid_team_categories_for_guild(bot, guild)
                        except Exception:
                            categories = []
                        target_cat = pick_category_for_new_channels(categories, needed_slots=2) or category
                        await target_cat.create_text_channel(
                            name=chan_name,
                            topic=f"Kênh chat cho đội {base_name}",
                            reason=f"Auto-created after !assign for team {team_id or clean_team_name}",
                            overwrites=overwrites
                        )
                except Exception:
                    pass

                # Persist channel IDs to Mongo teams for later use (e.g., TeamQR)
                try:
                    updates = {}
                    if 'text_chan' in locals() and text_chan:
                        updates['text_channel_id'] = int(text_chan.id)
                    if 'voice_chan' in locals() and voice_chan:
                        updates['voice_channel_id'] = int(voice_chan.id)
                    if updates:
                        key = {'team_id': team_id} if team_id else {'team_name': base_name}
                        mongo.teams.update_one(key, {'$set': updates}, upsert=True)
                except Exception:
                    pass

                # Voice channel
                try:
                    voice_chan = discord.utils.get(guild.voice_channels, name=chan_name)
                    if not voice_chan:
                        overwrites = {
                            guild.default_role: discord.PermissionOverwrite(
                                connect=False, view_channel=False, speak=False, stream=False
                            ),
                            role: discord.PermissionOverwrite(
                                connect=True, view_channel=True, speak=True, stream=True,
                                priority_speaker=False, mute_members=False, deafen_members=False, move_members=False
                            )
                        }
                        try:
                            categories = get_valid_team_categories_for_guild(bot, guild)
                        except Exception:
                            categories = []
                        voice_cat = getattr(text_chan, 'category', None) or (pick_category_for_new_channels(categories, needed_slots=1) or category)
                        await voice_cat.create_voice_channel(
                            name=chan_name,
                            reason=f"Auto-created after !assign for team {team_id or clean_team_name}",
                            overwrites=overwrites,
                            user_limit=10
                        )
                except Exception:
                    pass

            # Assign role to the member if missing
            if role and role not in message.author.roles:
                try:
                    await message.author.add_roles(role, reason="Auto-assigned after !assign")
                except Exception:
                    pass
        except Exception:
            # Never crash the event loop because of provisioning
            pass
    
    @bot.event
    async def on_message_edit(before: discord.Message, after: discord.Message):
        """Called when a message is edited"""
        # Ignore bot messages
        if before.author.bot:
            return
        
        # Ignore if content didn't change (e.g., embed updates)
        if before.content == after.content:
            return
        
        await bot.logger.log_message_edit(before, after)
    
    @bot.event
    async def on_message_delete(message: discord.Message):
        """Called when a message is deleted"""
        # Ignore bot messages
        if message.author.bot:
            return
        
        await bot.logger.log_message_delete(message)
    
    @bot.event
    async def on_bulk_message_delete(messages: list[discord.Message]):
        """Called when multiple messages are deleted at once"""
        if not messages:
            return
        
        # Log bulk deletion
        guild = messages[0].guild
        channel = messages[0].channel
        count = len(messages)
        
        log_msg = (
            f"🗑️ **Xóa hàng loạt tin nhắn**\n"
            f"**Kênh:** {channel.mention}\n"
            f"**Số lượng:** {count} tin nhắn\n"
            f"**Thời gian:** {datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M:%S')}"
        )
        
        await bot.logger.log(log_msg)
