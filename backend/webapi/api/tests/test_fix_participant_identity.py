"""Admin identity-fix tool: correct a roster participant's mis-typed MSSV and
relink the real account, without severing its team.

Context (the bug this fixes): team visibility joins ``Account.mssv`` →
``Participant.mssv`` at query time rather than through the ``Participant.account``
FK. When a captain types a member's MSSV wrong, the member's real account (whose
MSSV is correct) can never match the roster row, so the account shows "no team"
and the roster shows "no web account". Editing the *account's* MSSV cannot fix
it — only correcting the Participant row that carries the membership can.
"""

import json

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase

from api.models import Account, Participant, Team, TeamMembership
from api.services.auth_service import generate_session
from api.services.team_service import fix_participant_identity


def _participant(mssv, email="", full_name="Form Name", account=None):
    return Participant.objects.create(
        mssv=mssv, full_name=full_name, email=email, account=account,
    )


def _account(email, mssv=None, role=Account.ROLE_PARTICIPANT):
    return Account.objects.create(
        username=email.split("@")[0],
        email=email,
        password_hash=make_password("x"),
        role=role,
        mssv=mssv,
    )


def _team_with_captain(participant, code="T0001", name="Wi-Find"):
    team = Team.objects.create(code=code, name=name)
    TeamMembership.objects.create(team=team, participant=participant, is_captain=True)
    return team


def _dashboard_team_code(account):
    """The exact resolver the participant dashboard uses (my_team_view)."""
    m = (
        TeamMembership.objects.filter(participant__mssv=account.mssv)
        .select_related("team").first()
    )
    return m.team.code if m else None


class FixParticipantIdentityServiceTests(TestCase):
    def test_reported_scenario_typo_plus_account_stub(self):
        # Captain typed 26511985; the person's real account is 26521985 and has
        # auto-created a stub Participant (no team) on first sign-in.
        roster = _participant("26511985", email="form@school.edu")
        team = _team_with_captain(roster)
        acc = _account("26521985@gm.uit.edu.vn", mssv="26521985")
        stub = _participant("26521985", email=acc.email, account=acc)

        # Before: the account cannot see its team.
        self.assertIsNone(_dashboard_team_code(acc))

        participant, err = fix_participant_identity("26511985", "26521985", actor=acc)

        self.assertIsNone(err)
        self.assertEqual(participant.pk, roster.pk)
        roster.refresh_from_db()
        self.assertEqual(roster.mssv, "26521985")
        self.assertEqual(roster.account_id, acc.id)
        # The colliding stub was absorbed, membership rode along untouched.
        self.assertFalse(Participant.objects.filter(pk=stub.pk).exists())
        self.assertTrue(
            TeamMembership.objects.filter(team=team, participant=roster).exists()
        )
        # After: the account now resolves to its team.
        self.assertEqual(_dashboard_team_code(acc), "T0001")

    def test_typo_with_account_no_stub(self):
        roster = _participant("26511985", email="form@school.edu")
        _team_with_captain(roster)
        acc = _account("26521985@gm.uit.edu.vn", mssv="26521985")

        _, err = fix_participant_identity("26511985", "26521985", actor=acc)

        self.assertIsNone(err)
        roster.refresh_from_db()
        self.assertEqual(roster.mssv, "26521985")
        self.assertEqual(roster.account_id, acc.id)
        self.assertEqual(_dashboard_team_code(acc), "T0001")

    def test_typo_with_no_account_yet_still_corrects_mssv(self):
        roster = _participant("26511985")
        _team_with_captain(roster)

        participant, err = fix_participant_identity("26511985", "26521985")

        self.assertIsNone(err)
        roster.refresh_from_db()
        self.assertEqual(roster.mssv, "26521985")
        self.assertIsNone(roster.account_id)
        self.assertTrue(
            TeamMembership.objects.filter(participant=roster).exists()
        )

    def test_case_and_whitespace_normalized(self):
        roster = _participant("26511985")
        _team_with_captain(roster)

        _, err = fix_participant_identity("  26511985 ", " 26521985x ")
        self.assertIsNone(err)
        roster.refresh_from_db()
        self.assertEqual(roster.mssv, "26521985X")

    def test_conflict_when_correct_mssv_is_a_real_roster_member(self):
        roster = _participant("26511985")
        _team_with_captain(roster, code="T0001")
        other = _participant("26521985")
        _team_with_captain(other, code="T0002", name="Other")

        participant, err = fix_participant_identity("26511985", "26521985")

        self.assertIsNone(participant)
        self.assertEqual(err, "mssv_conflict_roster:T0002")
        roster.refresh_from_db()
        self.assertEqual(roster.mssv, "26511985")  # untouched

    def test_account_link_conflict_when_roster_linked_to_other_account(self):
        acc_a = _account("a@x.com")
        roster = _participant("26511985", account=acc_a)
        _team_with_captain(roster)
        _account("26521985@gm.uit.edu.vn", mssv="26521985")

        participant, err = fix_participant_identity("26511985", "26521985")

        self.assertIsNone(participant)
        self.assertEqual(err, "account_link_conflict")
        roster.refresh_from_db()
        self.assertEqual(roster.mssv, "26511985")
        self.assertEqual(roster.account_id, acc_a.id)

    def test_participant_not_found(self):
        participant, err = fix_participant_identity("99999999", "26521985")
        self.assertIsNone(participant)
        self.assertEqual(err, "participant_not_found")

    def test_missing_correct_mssv(self):
        _participant("26511985")
        participant, err = fix_participant_identity("26511985", "")
        self.assertIsNone(participant)
        self.assertEqual(err, "missing_correct_mssv")


class FixParticipantIdentityViewTests(TestCase):
    def setUp(self):
        cache.clear()
        self.admin = _account("admin@x.com", role=Account.ROLE_ADMIN)
        self.token = generate_session(self.admin)

    def _post(self, body):
        return self.client.post(
            "/api/admin/participants/fix-identity",
            data=json.dumps(body),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_happy_path_links_account_to_team(self):
        roster = _participant("26511985", email="form@school.edu")
        _team_with_captain(roster)
        acc = _account("26521985@gm.uit.edu.vn", mssv="26521985")
        _participant("26521985", email=acc.email, account=acc)

        resp = self._post({"current_mssv": "26511985", "correct_mssv": "26521985"})

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["mssv"], "26521985")
        self.assertTrue(body["account_linked"])
        self.assertEqual(body["team_code"], "T0001")
        self.assertEqual(_dashboard_team_code(acc), "T0001")

    def test_conflict_returns_409(self):
        roster = _participant("26511985")
        _team_with_captain(roster, code="T0001")
        other = _participant("26521985")
        _team_with_captain(other, code="T0002")

        resp = self._post({"current_mssv": "26511985", "correct_mssv": "26521985"})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "mssv_conflict_roster:T0002")

    def test_missing_fields_returns_400(self):
        resp = self._post({"current_mssv": "26511985"})
        self.assertEqual(resp.status_code, 400)

    def test_requires_admin(self):
        plain = _account("p@x.com")
        token = generate_session(plain)
        resp = self.client.post(
            "/api/admin/participants/fix-identity",
            data=json.dumps({"current_mssv": "1", "correct_mssv": "2"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(resp.status_code, 403)


class AccountMssvEditWithoutLinkTests(TestCase):
    def setUp(self):
        cache.clear()
        self.admin = _account("admin@x.com", role=Account.ROLE_ADMIN)
        self.token = generate_session(self.admin)

    def _patch(self, username, body):
        return self.client.patch(
            f"/api/admin/accounts/{username}",
            data=json.dumps(body),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_edit_without_any_participant_does_not_create_profile(self):
        target = _account("stu@x.com", mssv="26521985")
        resp = self._patch(target.username, {"mssv": "26599999"})
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Participant.objects.exists())

    def test_admin_edit_does_not_claim_unlinked_roster_even_when_email_matches(self):
        target = _account("stu@x.com", mssv="26521985")
        roster = _participant("26599999", email="stu@x.com")
        _team_with_captain(roster)

        resp = self._patch(target.username, {"mssv": "26599999"})

        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "identity_review_required")
        roster.refresh_from_db()
        target.refresh_from_db()
        self.assertIsNone(roster.account_id)
        self.assertEqual(target.mssv, "26521985")
