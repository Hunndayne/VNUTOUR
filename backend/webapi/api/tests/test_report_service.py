import pytest
from defusedxml.common import EntitiesForbidden

from api.services.report_service import _populate_data_sheet, _populate_summary


MALICIOUS_WORKSHEET_XML = b"""\
<!DOCTYPE worksheet [<!ENTITY payload "expanded">]>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row><c r="A1"><v>&payload;</v></c></row></sheetData>
</worksheet>
"""


@pytest.mark.parametrize(
    ("populate", "argument"),
    [
        (_populate_data_sheet, []),
        (_populate_summary, {}),
    ],
)
def test_report_xml_rejects_entities(populate, argument):
    with pytest.raises(EntitiesForbidden):
        populate(MALICIOUS_WORKSHEET_XML, argument)
