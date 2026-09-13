"""The sweep that deletes team roles and channels no team owns any more.

These tests exist because the sweep is destructive and runs unattended: the
interesting cases are all the ones where it must decide *not* to delete.
"""

import asyncio
import os
import sys
import types
from unittest.mock import patch

from django.test import SimpleTestCase

# The bot package lives beside `webapi`, which is pytest's rootdir, so it is not
# importable by default from inside the test suite.
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)
))))
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from src.utils import orphan_sweep  # noqa: E402


class FakeRole:
    def __init__(self, role_id, name, position=1, managed=False, default=False):
        self.id = role_id
        self.name = name
        self.position = position
        self.managed = managed
        self._default = default
        self.deleted = False

    def is_default(self):
        return self._default

    def __ge__(self, other):
        return self.position >= other.position

    def __hash__(self):
        return hash(self.id)

    async def delete(self, reason=None):
        self.deleted = True


class FakeChannel:
    def __init__(self, channel_id, name, overwrites=None):
        self.id = channel_id
        self.name = name
        self.overwrites = overwrites or {}
        self.deleted = False

    async def delete(self, reason=None):
        self.deleted = True


class FakeCategory:
    def __init__(self, channels):
        self.channels = channels


class FakePermissions:
    def __init__(self, manage_roles=True):
        self.manage_roles = manage_roles


class FakeMember:
    def __init__(self, top_role, manage_roles=True):
        self.top_role = top_role
        self.guild_permissions = FakePermissions(manage_roles)


class FakeGuild:
    def __init__(self, me):
        self.me = me


class OrphanSweepTests(SimpleTestCase):
    def setUp(self):
        # The bot sits above ordinary team roles in the hierarchy.
        self.bot_role = FakeRole(9, "VNUTour Bot", position=100)
        self.guild = FakeGuild(FakeMember(self.bot_role))

    def _run(self, categories, inventory):
        """Run the sweep against a fixed set of categories.

        `discord.Role` is swapped for the fake so the sweep's isinstance check
        recognises these objects; nothing else in the module touches discord.
        """
        stub = types.SimpleNamespace(Role=FakeRole)
        with patch.object(orphan_sweep, "discord", stub), \
             patch.object(orphan_sweep, "get_valid_team_categories_for_guild",
                          return_value=categories):
            return asyncio.run(
                orphan_sweep.sweep_orphan_team_resources(None, self.guild, inventory)
            )

    def _inventory(self, **overrides):
        base = {
            "role_ids": [],
            "channel_ids": [],
            "pending_role_ids": [],
            "pending_channel_ids": [],
            "expected_names": [],
        }
        base.update(overrides)
        return base

    def test_orphan_channel_and_its_role_are_deleted(self):
        role = FakeRole(201, "Doi T1001")
        channel = FakeChannel(202, "doi-t1001", overwrites={role: object()})

        result = self._run([FakeCategory([channel])], self._inventory())

        self.assertTrue(channel.deleted)
        self.assertTrue(role.deleted)
        self.assertEqual([item["id"] for item in result["deleted_channels"]], [202])
        self.assertEqual([item["id"] for item in result["deleted_roles"]], [201])

    def test_a_live_teams_resources_are_left_alone(self):
        role = FakeRole(301, "Doi T2000")
        channel = FakeChannel(302, "doi-t2000", overwrites={role: object()})

        self._run(
            [FakeCategory([channel])],
            self._inventory(role_ids=[301], channel_ids=[302]),
        )

        self.assertFalse(channel.deleted)
        self.assertFalse(role.deleted)

    def test_a_channel_named_after_a_live_team_survives_the_id_write_back_gap(self):
        """Provisioning finds channels by name before it records their ids.

        Between creating a channel and saving its id there is a window where a
        live team's channel looks unclaimed. Deleting it there would destroy the
        team's channel moments after the bot made it.
        """
        channel = FakeChannel(402, "doi-t3000")

        self._run(
            [FakeCategory([channel])],
            self._inventory(expected_names=["doi t3000"]),
        )

        self.assertFalse(channel.deleted)

    def test_resources_already_queued_for_deprovision_are_left_to_that_loop(self):
        role = FakeRole(501, "Doi T4000")
        channel = FakeChannel(502, "doi-t4000", overwrites={role: object()})

        self._run(
            [FakeCategory([channel])],
            self._inventory(pending_role_ids=[501], pending_channel_ids=[502]),
        )

        self.assertFalse(channel.deleted)
        self.assertFalse(role.deleted)

    def test_roles_the_bot_must_not_touch_are_reported_not_deleted(self):
        everyone = FakeRole(601, "@everyone", default=True)
        integration = FakeRole(602, "Server Booster", managed=True)
        above_bot = FakeRole(603, "Admin", position=500)
        channel = FakeChannel(604, "doi-t5000", overwrites={
            everyone: object(), integration: object(), above_bot: object(),
        })

        result = self._run([FakeCategory([channel])], self._inventory())

        self.assertTrue(channel.deleted)
        for role in (everyone, integration, above_bot):
            self.assertFalse(role.deleted)
        # @everyone never becomes a candidate in the first place, so it is not
        # reported as skipped — the other two are, with the reason why.
        self.assertEqual(
            {item["reason"] for item in result["skipped_roles"]},
            {"integration_managed", "above_bot"},
        )

    def test_nothing_happens_without_configured_team_categories(self):
        """No categories means no safe boundary, so the sweep must not guess."""
        role = FakeRole(701, "Doi T6000")
        channel = FakeChannel(702, "doi-t6000", overwrites={role: object()})

        result = self._run([], self._inventory())

        self.assertFalse(channel.deleted)
        self.assertFalse(role.deleted)
        self.assertEqual(result["deleted_channels"], [])

    def test_a_single_pass_cannot_empty_a_category(self):
        channels = [
            FakeChannel(800 + i, f"doi-x{i}", overwrites={FakeRole(850 + i, f"Doi X{i}"): object()})
            for i in range(25)
        ]

        result = self._run([FakeCategory(channels)], self._inventory())

        self.assertEqual(
            len(result["deleted_channels"]), orphan_sweep.MAX_DELETIONS_PER_PASS,
        )
        self.assertEqual(
            sum(1 for channel in channels if channel.deleted),
            orphan_sweep.MAX_DELETIONS_PER_PASS,
        )

    def test_a_role_outside_the_team_categories_is_never_a_candidate(self):
        """Only roles an orphan team channel granted access to are in scope."""
        unrelated = FakeRole(901, "Moderator")
        orphan_role = FakeRole(902, "Doi T7000")
        orphan = FakeChannel(903, "doi-t7000", overwrites={orphan_role: object()})

        result = self._run([FakeCategory([orphan])], self._inventory())

        self.assertTrue(orphan.deleted)
        self.assertTrue(orphan_role.deleted)
        self.assertFalse(unrelated.deleted)
        self.assertEqual([item["id"] for item in result["deleted_roles"]], [902])

    def test_a_hand_made_channel_in_a_team_category_is_not_a_team_channel(self):
        """Provisioning always attaches a role overwrite; a noticeboard has none.

        Without this the sweep would delete anything an organiser happened to
        file alongside the team channels.
        """
        everyone = FakeRole(1001, "@everyone", default=True)
        noticeboard = FakeChannel(1002, "thong-bao-chung", overwrites={everyone: object()})
        lobby = FakeChannel(1003, "sanh-cho")

        result = self._run([FakeCategory([noticeboard, lobby])], self._inventory())

        self.assertFalse(noticeboard.deleted)
        self.assertFalse(lobby.deleted)
        self.assertEqual(result["deleted_channels"], [])
