"""
Track class for music tracks
"""
from dataclasses import dataclass, field
from typing import Optional, Dict


@dataclass
class Track:
    """Represents a music track"""
    title: str
    stream_url: str
    page_url: str
    duration: Optional[int]
    requested_by: int
    headers: Dict[str, str] = field(default_factory=dict)
    
    # Additional info for rich embed display
    artist: Optional[str] = None
    uploader: Optional[str] = None
    thumbnail: Optional[str] = None
    view_count: Optional[int] = None
    
    def __str__(self):
        return f"{self.title} (requested by <@{self.requested_by}>)"
    
    def get_duration_str(self) -> str:
        """Get formatted duration string"""
        if self.duration is None:
            return "Unknown"
        
        minutes = self.duration // 60
        seconds = self.duration % 60
        return f"{minutes}:{seconds:02d}"




