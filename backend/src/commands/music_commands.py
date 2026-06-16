"""
Music-related commands
"""
import discord
from discord.ext import commands
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


def setup_music_commands(bot):
    """Setup music commands"""
    
    @bot.command(name="play", aliases=["p"])
    async def play(ctx, *, query: str):
        """Phát nhạc từ YouTube"""
        try:
            # Ensure bot is in voice channel
            vc = await ensure_voice(ctx.message)
            
            # Get or create player
            player = get_player(ctx.guild.id)
            player.text_channel_id = ctx.channel.id
            
            # Show searching message
            searching_msg = await ctx.send(f"🔍 **Đang tìm kiếm:** {query}")
            
            try:
                # Extract track info (already async optimized)
                track = await ytdlp_extract(query, ctx.author.id)
                
                # Add to queue
                player.add_track(track)
                
                # Update searching message
                await searching_msg.edit(content=f"✅ **Đã thêm vào queue:** {track.title}")
                
                # Start playing if not already playing (non-blocking)
                if not vc.is_playing():
                    asyncio.create_task(play_next(ctx.guild, vc, player))
                    
            except Exception as e:
                await searching_msg.edit(content=f"❌ **Lỗi:** {str(e)}")
                
        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {str(e)}")
    
    @bot.command(name="skip", aliases=["s"])
    async def skip(ctx):
        """Bỏ qua bài hát hiện tại"""
        try:
            vc = ctx.guild.voice_client
            if not vc or not vc.is_connected():
                await ctx.send("❌ Bot không ở trong voice channel")
                return
            
            if vc.is_playing():
                # Stop current track and trigger next
                vc.stop()
                await ctx.send("⏭️ **Đã bỏ qua bài hát hiện tại**")
                
                # Get player and play next track (non-blocking)
                player = get_player(ctx.guild.id)
                if player.queue:
                    await ctx.send("🔄 **Đang chuyển sang bài tiếp theo...**")
                    asyncio.create_task(play_next(ctx.guild, vc, player))
                else:
                    await ctx.send("📭 **Queue đã hết, không còn bài nào để phát**")
            else:
                await ctx.send("❌ Không có gì đang phát")
                
        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {str(e)}")
    
    @bot.command(name="queue", aliases=["q"])
    async def queue(ctx):
        """Hiển thị queue nhạc"""
        try:
            player = get_player(ctx.guild.id)
            queue_info = player.get_queue_info()
            
            if player.now_playing:
                now_playing = f"🎵 **Đang phát:** {player.now_playing.title}\n\n"
            else:
                now_playing = ""
            
            await ctx.send(f"{now_playing}{queue_info}")
            
        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {str(e)}")
    
    @bot.command(name="stop")
    async def stop(ctx):
        """Dừng phát nhạc và rời voice channel"""
        try:
            vc = ctx.guild.voice_client
            if not vc or not vc.is_connected():
                await ctx.send("❌ Bot không ở trong voice channel")
                return
            
            # Clear queue and stop
            player = get_player(ctx.guild.id)
            player.clear_queue()
            player.skip_current()
            
            # Disconnect
            await vc.disconnect()
            await ctx.send("⏹️ **Đã dừng phát nhạc và rời voice channel**")
            
        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {str(e)}")
    
    @bot.command(name="exit")
    async def exit_voice(ctx):
        """Thoát khỏi voice channel"""
        try:
            vc = ctx.guild.voice_client
            if not vc or not vc.is_connected():
                await ctx.send("❌ Bot không ở trong voice channel")
                return
            
            # Clear queue and stop
            player = get_player(ctx.guild.id)
            player.clear_queue()
            player.skip_current()
            
            # Force cleanup any remaining FFmpeg processes
            force_cleanup_ffmpeg_source(player.current_source)
            
            # Disconnect
            await vc.disconnect()
            await ctx.send("👋 **Đã thoát khỏi voice channel**")
            
        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {str(e)}")
    
    @bot.command(name="volume", aliases=["vol"])
    async def volume(ctx, vol: int):
        """Điều chỉnh âm lượng (0-200%)"""
        try:
            if not 0 <= vol <= 200:
                await ctx.send("❌ Âm lượng phải từ 0% đến 200%")
                return
            
            player = get_player(ctx.guild.id)
            # Convert percentage to decimal (0-2.0)
            volume_decimal = vol / 100.0
            player.set_volume(volume_decimal)
            
            # Apply volume to currently playing audio if any
            vc = ctx.guild.voice_client
            if vc and vc.is_playing() and player.now_playing:
                # Use our custom volume control (no process restart)
                if hasattr(vc.source, 'volume'):
                    vc.source.volume = volume_decimal
                    await ctx.send(f"🔊 **Âm lượng đã được đặt thành:** {vol}% (áp dụng ngay lập tức)")
                else:
                    # Fallback to FFmpeg method if source doesn't support volume
                    await apply_volume_from_current_position(vc, player, volume_decimal)
                    await ctx.send(f"🔊 **Âm lượng đã được đặt thành:** {vol}% (đang áp dụng...)")
            else:
                await ctx.send(f"🔊 **Âm lượng đã được đặt thành:** {vol}%")
            
        except Exception as e:
            await ctx.send(f"❌ **Lỗi:** {str(e)}")


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
