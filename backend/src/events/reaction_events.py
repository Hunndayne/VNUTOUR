"""
Reaction-related events
"""
import discord


def setup_reaction_events(bot):
    """Setup reaction event handlers"""
    
    @bot.event
    async def on_raw_reaction_add(payload: discord.RawReactionActionEvent):
        """Called when a reaction is added to a message"""
        # Ignore bot reactions
        if payload.user_id == bot.user.id:
            return
        
        # Handle music control reactions
        await handle_music_reactions(bot, payload, "add")
    
    @bot.event
    async def on_raw_reaction_remove(payload: discord.RawReactionActionEvent):
        """Called when a reaction is removed from a message"""
        # Ignore bot reactions
        if payload.user_id == bot.user.id:
            return
        
        # Handle music control reactions
        await handle_music_reactions(bot, payload, "remove")


async def handle_music_reactions(bot, payload: discord.RawReactionActionEvent, action: str):
    """Handle music control reactions"""
    from ..music.player import get_player
    
    guild = bot.get_guild(payload.guild_id)
    if guild is None:
        return
    
    player = get_player(guild.id)
    if player is None or player.control_msg_id != payload.message_id:
        return
    
    # Check if controller is in same voice channel as bot
    try:
        member = guild.get_member(payload.user_id) or await guild.fetch_member(payload.user_id)
    except discord.NotFound:
        return
    except Exception:
        return
    
    vc = guild.voice_client
    if member is None or vc is None or not vc.is_connected() or member.voice is None or member.voice.channel != vc.channel:
        return
    
    emoji = str(payload.emoji)
    
    # Music control emojis
    CONTROL_EMOJIS = {
        "playpause": "⏯️",
        "skip": "⏭️"
    }
    
    try:
        if emoji == CONTROL_EMOJIS["playpause"]:
            if vc.is_playing():
                vc.pause()
            elif vc.is_paused():
                vc.resume()
        
        elif emoji == CONTROL_EMOJIS["skip"]:
            if vc.is_playing() or vc.is_paused():
                vc.stop()
    
    except Exception as e:
        print(f"[REACTION ERROR] {e}")
        await bot.logger.log(f"Lỗi xử lý reaction: {e}")




