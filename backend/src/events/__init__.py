"""
Events module for handling Discord events
"""

from .member_events import setup_member_events
from .message_events import setup_message_events
from .reaction_events import setup_reaction_events


def setup_events(bot):
    """Setup all event handlers"""
    setup_member_events(bot)
    setup_message_events(bot)
    setup_reaction_events(bot)


__all__ = ['setup_events', 'setup_member_events', 'setup_message_events', 'setup_reaction_events']
