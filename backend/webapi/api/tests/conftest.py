import pytest
from api.models import ProgramPhase, SubEvent, Team, Station


@pytest.fixture
def event_fixture(db):
    phase = ProgramPhase.objects.create(
        key="qualifying", label="Qualifying", order=1, is_current=True,
    )
    return SubEvent.objects.create(
        phase=phase, name="Station Run",
        type=SubEvent.TYPE_STATION_RUN, uses_stations=True, order=1,
    )


@pytest.fixture
def team_fixture(db):
    return Team.objects.create(
        code="T0001", name="Team A",
        approval_status=Team.APPROVAL_APPROVED, qr_token="tok1",
    )


@pytest.fixture
def station_fixture(db):
    def _make(code, sub_event, **kwargs):
        return Station.objects.create(
            sub_event=sub_event, code=code, name=f"Station {code}", **kwargs
        )
    return _make
