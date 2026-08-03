import io
import zipfile

from django.test import TestCase

from api.models import Account, Participant, Team, TeamMembership
from api.services.auth_service import generate_session


class ReportExportApiTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin",
            email="admin@example.com",
            password_hash="x",
            role=Account.ROLE_ADMIN,
        )
        team = Team.objects.create(
            code="T0001",
            name="Team A",
            approval_status=Team.APPROVAL_APPROVED,
        )
        participant = Participant.objects.create(
            mssv="SV001",
            full_name="Nguyen Van A",
            school="UIT",
            cccd="012345678901",
        )
        TeamMembership.objects.create(
            team=team,
            participant=participant,
            is_captain=True,
        )
        self.token = generate_session(self.admin)

    def test_admin_can_export_valid_xlsx_without_private_identity_fields(self):
        response = self.client.get(
            "/api/admin/reports/export.xlsx",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Content-Type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        with zipfile.ZipFile(io.BytesIO(response.content)) as workbook:
            self.assertIn("xl/worksheets/sheet2.xml", workbook.namelist())
            teams_xml = workbook.read("xl/worksheets/sheet2.xml").decode("utf-8")
            self.assertIn("T0001", teams_xml)
            self.assertIn("SV001", teams_xml)
            self.assertIn("Nguyen Van A", teams_xml)
            self.assertIn("UIT", teams_xml)
            self.assertNotIn("012345678901", teams_xml)
