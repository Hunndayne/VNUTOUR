"""The shared draft a team's members type into together, ahead of an actual submit.

Every form except a survey (`SubEvent.TYPE_SURVEY`) syncs one draft per team: any
member's save is what any other member's next GET sees. Surveys stay per-person on
purpose, so the endpoint refuses to write one and just says so.
"""

import json

from django.test import TestCase

from api.models import (
    Account, Participant, PhaseRoster, ProgramPhase, Station, SubEvent,
    SystemSetting, Team, TeamFormDraft, TeamMembership,
)
from api.services.auth_service import generate_session


class DraftApiTestBase(TestCase):
    def setUp(self):
        self.account_a = Account.objects.create(
            username="member_a", email="member_a@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV001",
            full_name="Nguyen Van A",
        )
        self.participant_a = Participant.objects.create(
            account=self.account_a, mssv="SV001", full_name="Nguyen Van A",
            email="member_a@example.com",
        )
        self.account_b = Account.objects.create(
            username="member_b", email="member_b@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV002",
            full_name="Tran Thi B",
        )
        self.participant_b = Participant.objects.create(
            account=self.account_b, mssv="SV002", full_name="Tran Thi B",
            email="member_b@example.com",
        )
        self.team = Team.objects.create(
            code="T0001", name="Team A",
            approval_status=Team.APPROVAL_APPROVED, qr_token="token-a",
        )
        TeamMembership.objects.create(team=self.team, participant=self.participant_a, is_captain=True)
        TeamMembership.objects.create(team=self.team, participant=self.participant_b, is_captain=False)

        self.phase = ProgramPhase.objects.create(
            key="qualifying", label="Qualifying", order=2, is_current=True,
        )
        PhaseRoster.objects.create(
            phase=self.phase, team=self.team, origin=PhaseRoster.ORIGIN_APPROVED,
        )
        self.event = SubEvent.objects.create(
            phase=self.phase, name="Quiz Event", type=SubEvent.TYPE_QUIZ,
        )
        self.station = Station.objects.create(
            sub_event=self.event, code="Q01", name="Quiz Station",
            submission_config={
                "items": [
                    {"id": "f1", "type": "text", "label": "Ten doi?"},
                ],
            },
        )
        SystemSetting.objects.update_or_create(
            key="current_sub_event_id", defaults={"value": str(self.event.id)},
        )

        self.token_a = generate_session(self.account_a)
        self.token_b = generate_session(self.account_b)

    def _url(self, station=None):
        station = station or self.station
        return f"/api/my-team/stations/{station.id}/draft"

    def _get(self, token, station=None):
        return self.client.get(self._url(station), HTTP_AUTHORIZATION=f"Bearer {token}")

    def _put(self, token, response, station=None):
        return self.client.put(
            self._url(station),
            data=json.dumps({"response": response}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )


class TeamFormDraftSyncTests(DraftApiTestBase):
    def test_put_then_get_round_trips_the_response_and_editor_name(self):
        put_response = self._put(self.token_a, {"f1": "Doi Rong Vang"})

        self.assertEqual(put_response.status_code, 200)
        put_payload = put_response.json()
        self.assertIn("updated_at", put_payload)
        self.assertEqual(put_payload["updated_by"], "Nguyen Van A")

        get_response = self._get(self.token_a)
        self.assertEqual(get_response.status_code, 200)
        get_payload = get_response.json()
        self.assertFalse(get_payload["is_survey"])
        self.assertEqual(get_payload["response"], {"f1": "Doi Rong Vang"})
        self.assertEqual(get_payload["updated_by"], "Nguyen Van A")
        self.assertIsNotNone(get_payload["updated_at"])

    def test_a_teammate_sees_the_draft_just_saved_by_another_member(self):
        self._put(self.token_a, {"f1": "Doi Rong Vang"})

        payload = self._get(self.token_b).json()

        self.assertEqual(payload["response"], {"f1": "Doi Rong Vang"})
        self.assertEqual(payload["updated_by"], "Nguyen Van A")

    def test_a_second_save_overwrites_rather_than_duplicates(self):
        self._put(self.token_a, {"f1": "Ban dau"})
        self._put(self.token_b, {"f1": "Sua lai"})

        self.assertEqual(TeamFormDraft.objects.filter(team=self.team, station=self.station).count(), 1)
        payload = self._get(self.token_a).json()
        self.assertEqual(payload["response"], {"f1": "Sua lai"})
        self.assertEqual(payload["updated_by"], "Tran Thi B")

    def test_a_member_of_another_team_does_not_see_this_draft(self):
        self._put(self.token_a, {"f1": "Bi mat"})

        other_account = Account.objects.create(
            username="other_captain", email="other@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV900",
        )
        other_participant = Participant.objects.create(
            account=other_account, mssv="SV900", full_name="Doi Khac",
            email="other@example.com",
        )
        other_team = Team.objects.create(
            code="T0002", name="Team B",
            approval_status=Team.APPROVAL_APPROVED, qr_token="token-b",
        )
        TeamMembership.objects.create(team=other_team, participant=other_participant, is_captain=True)
        PhaseRoster.objects.create(
            phase=self.phase, team=other_team, origin=PhaseRoster.ORIGIN_APPROVED,
        )
        other_token = generate_session(other_account)

        payload = self._get(other_token).json()

        self.assertFalse(payload["is_survey"])
        self.assertIsNone(payload["response"])
        self.assertIsNone(payload["updated_by"])

    def test_get_with_no_draft_yet_returns_nulls_not_an_error(self):
        payload = self._get(self.token_a).json()

        self.assertEqual(payload["response"], None)
        self.assertIsNone(payload["updated_at"])
        self.assertIsNone(payload["updated_by"])

    def test_a_non_dict_response_body_is_rejected(self):
        response = self._put(self.token_a, ["not", "a", "dict"])

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "invalid_json")


class TeamFormDraftSurveyTests(DraftApiTestBase):
    def setUp(self):
        super().setUp()
        self.survey_event = SubEvent.objects.create(
            phase=self.phase, name="Khao sat", type=SubEvent.TYPE_SURVEY,
        )
        self.survey_station = Station.objects.create(
            sub_event=self.survey_event, code="SV01", name="Khao sat",
            submission_config={
                "items": [{"id": "s1", "type": "text", "label": "Cam nhan?"}],
            },
        )
        SystemSetting.objects.update_or_create(
            key="current_sub_event_id", defaults={"value": str(self.survey_event.id)},
        )

    def test_get_reports_is_survey_true_with_no_other_fields(self):
        response = self._get(self.token_a, station=self.survey_station)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"is_survey": True})

    def test_put_is_refused_because_a_survey_never_syncs(self):
        response = self._put(self.token_a, {"s1": "Rat vui"}, station=self.survey_station)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "survey_not_synced")
        self.assertFalse(TeamFormDraft.objects.filter(station=self.survey_station).exists())


class TeamFormDraftAccessTests(DraftApiTestBase):
    def test_an_account_without_a_team_gets_404(self):
        loner = Account.objects.create(
            username="loner", email="loner@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV800",
        )
        Participant.objects.create(
            account=loner, mssv="SV800", full_name="Mot Minh", email="loner@example.com",
        )
        token = generate_session(loner)

        response = self._get(token)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"], "no_team")

    def test_a_non_participant_role_gets_403(self):
        staff = Account.objects.create(
            username="coop", email="coop@example.com",
            password_hash="x", role=Account.ROLE_COLLAB,
        )
        token = generate_session(staff)

        response = self._get(token)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "forbidden")

    def test_a_station_with_no_form_is_treated_as_not_found(self):
        bare_station = Station.objects.create(
            sub_event=self.event, code="Q02", name="No Form Station",
        )

        response = self._get(self.token_a, station=bare_station)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"], "form_not_found")

    def test_an_unapproved_team_is_refused(self):
        self.team.approval_status = Team.APPROVAL_PENDING
        self.team.save(update_fields=["approval_status"])

        response = self._get(self.token_a)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "team_not_approved")
