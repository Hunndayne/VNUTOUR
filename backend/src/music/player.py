"""
Music player management
"""
import asyncio
import discord
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Deque
from datetime import datetime, timezone
from .track import Track


def force_cleanup_ffmpeg_source(source):
    """Force cleanup FFmpeg audio source and terminate process"""
    if not source:
        return
    
    try:
        # Standard cleanup first
        if hasattr(source, 'cleanup'):
            source.cleanup()
        
        # Force terminate FFmpeg process if still running
        if hasattr(source, '_process') and source._process:
            import subprocess
            import signal
            import os
            import time
            
            process = source._process
            if process and process.poll() is None:  # Process still running
                # Try graceful termination first
                process.terminate()
                time.sleep(0.05)
                
                # Force kill if still running
                if process.poll() is None:
                    if os.name == 'nt':  # Windows
                        process.kill()
                    else:  # Unix/Linux
                        try:
                            os.kill(process.pid, signal.SIGKILL)
                        except:
                            pass
    except Exception:
        pass  # Ignore all cleanup errors


@dataclass
class GuildPlayer:
    """Manages music playback for a specific guild"""
    guild_id: int
    queue: Deque[Track] = field(default_factory=deque)
    now_playing: Optional[Track] = None
    text_channel_id: Optional[int] = None
    volume: float = 1.0
    loop_task: Optional[asyncio.Task] = field(default=None)
    item_added: asyncio.Event = field(default_factory=asyncio.Event)
    finished: asyncio.Event = field(default_factory=asyncio.Event)
    started_at: Optional[float] = None
    current_source: Optional[discord.AudioSource] = None
    
    # Control panel state
    control_msg_id: Optional[int] = None
    control_channel_id: Optional[int] = None
    
    # Now playing message for auto-update
    now_playing_msg: Optional[discord.Message] = None
    
    def __post_init__(self):
        """Initialize events"""
        self.item_added = asyncio.Event()
        self.finished = asyncio.Event()
    
    def add_track(self, track: Track):
        """Add a track to the queue"""
        self.queue.append(track)
        self.item_added.set()
    
    def get_next_track(self) -> Optional[Track]:
        """Get the next track from queue"""
        if not self.queue:
            return None
        return self.queue.popleft()
    
    def clear_queue(self):
        """Clear the music queue"""
        self.queue.clear()
    
    def skip_current(self):
        """Skip the currently playing track"""
        self.finished.set()
    
    def set_volume(self, volume: float):
        """Set player volume (0.0 to 2.0)"""
        self.volume = max(0.0, min(2.0, volume))
    
    def get_queue_info(self) -> str:
        """Get formatted queue information"""
        if not self.queue:
            return "Queue trống"
        
        info = f"**Queue ({len(self.queue)} tracks):**\n"
        for i, track in enumerate(self.queue, 1):
            duration = track.get_duration_str()
            info += f"{i}. **{track.title}** - {duration}\n"
        
        return info
    
    def update_started_at(self, timestamp: float):
        """Update the started_at timestamp"""
        self.started_at = timestamp
    
    def get_current_position(self) -> float:
        """Get current playback position in seconds"""
        if not self.started_at:
            return 0.0
        
        import time
        current_time = time.time()
        position = current_time - self.started_at
        return max(0.0, position)


# Global player storage
players: dict[int, GuildPlayer] = {}


def get_player(guild_id: int) -> GuildPlayer:
    """Get or create a player for a guild"""
    if guild_id not in players:
        players[guild_id] = GuildPlayer(guild_id=guild_id)
    return players[guild_id]


def remove_player(guild_id: int):
    """Remove a player for a guild"""
    if guild_id in players:
        del players[guild_id]


async def ensure_voice(message: discord.Message) -> discord.VoiceClient:
    """Ensure bot is connected to a voice channel"""
    if message.author is None or message.author.voice is None or message.author.voice.channel is None:
        raise RuntimeError("Bạn phải vào voice channel trước.")
    
    if message.guild is None:
        raise RuntimeError("Lệnh chỉ dùng trong server.")
    
    if message.guild.voice_client is None or not message.guild.voice_client.is_connected():
        vc = await message.author.voice.channel.connect()
        return vc
    
    return message.guild.voice_client


async def after_play_callback(err: Optional[Exception], player: GuildPlayer):
    """Callback after music playback ends"""
    try:
        # Ignore certain expected errors
        if err and "_MissingSentinel" in str(err):
            # This is a common Discord.py internal error, ignore it
            pass
        elif err:
            print(f"[PLAYER ERROR] {err}")
        
        # Cleanup current source safely
        force_cleanup_ffmpeg_source(player.current_source)
        
        # Reset current source
        player.current_source = None
        
        # Signal completion
        if not player.finished.is_set():
            player.finished.set()
            
    except Exception as e:
        print(f"[CALLBACK ERROR] {e}")
