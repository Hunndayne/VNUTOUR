import json

from django.test import TestCase

from api.models import Account, ProgramPhase, Station, StationAssignment, SubEvent
from api.services.auth_service import generate_session


class StationAssignmentApiTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin",
            email="admin@example.com",
            password_hash="x",
            role=Account.ROLE_ADMIN,
        )
        self.collab = Account.objects.create(
            username="coop1",
            email="coop1@example.com",
            password_hash="x",
            role=Account.ROLE_COLLAB,
        )
        phase = ProgramPhase.objects.create(
            key="qualifying",
            label="Qualifying",
            order=1,
            is_current=True,
        )
        event = SubEvent.objects.create(
            phase=phase,
            name="Station Run",
            type=SubEvent.TYPE_STATION_RUN,
            uses_stations=True,
            order=1,
        )
        self.station = Station.objects.create(
            sub_event=event,
            code="VL01",
            name="Tram 1",
            order=1,
        )

    def test_admin_can_create_and_delete_assignment(self):
        token = generate_session(self.admin)

        create_response = self.client.post(
            "/api/admin/station-assignments",
            data=json.dumps({
                "collab_username": self.collab.username,
                "station_id": self.station.id,
                "note": "Ca sang",
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(create_response.status_code, 201)
        created_id = create_response.json()["id"]
        self.assertTrue(StationAssignment.objects.filter(id=created_id).exists())

        delete_response = self.client.delete(
            f"/api/admin/station-assignments/{created_id}",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(delete_response.status_code, 200)
        self.assertFalse(StationAssignment.objects.filter(id=created_id).exists())

    def test_collab_can_fetch_own_assignments(self):
        StationAssignment.objects.create(
            collab=self.collab,
            station=self.station,
            note="Ca chieu",
            active=True,
        )
        token = generate_session(self.collab)

        response = self.client.get(
            "/api/coop/me/assignments",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["items"]), 1)
        self.assertEqual(payload["items"][0]["station"]["code"], "VL01")
        self.assertEqual(payload["items"][0]["collab"]["username"], "coop1")
