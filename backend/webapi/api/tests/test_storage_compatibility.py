import io
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from botocore.exceptions import ClientError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from api.models import SubEvent
from api.services import submission_storage_service as storage
from api.views_station import _serialize_submission


def missing(operation="GetObject"):
    return ClientError({"Error": {"Code": "NoSuchKey"}}, operation)


@pytest.mark.parametrize("serve", [storage.frame_file_response, storage.proof_file_response])
@override_settings(R2_BUCKET="vnutour")
def test_old_objects_remain_readable_after_endpoint_normalization(serve):
    client = Mock()
    client.get_object.side_effect = [missing(), {"Body": io.BytesIO(b"image"), "ContentType": "image/png"}]
    with patch.object(storage, "_r2_client", return_value=client):
        response = serve({"storage": "r2", "key": "frames/old.png"})
    assert response is not None
    assert response.content == b"image"
    assert [c.kwargs["Key"] for c in client.get_object.call_args_list] == [
        "frames/old.png", "vnutour/frames/old.png",
    ]


@override_settings(R2_BUCKET="vnutour")
def test_storage_access_errors_do_not_trigger_legacy_fallback():
    client = Mock()
    client.get_object.side_effect = ClientError({"Error": {"Code": "AccessDenied"}}, "GetObject")
    with patch.object(storage, "_r2_client", return_value=client):
        assert storage.proof_file_response({"storage": "r2", "key": "payment-proofs/a.png"}) is None
    assert client.get_object.call_count == 1


@pytest.mark.parametrize("event_type", [SubEvent.TYPE_QUIZ, SubEvent.TYPE_SURVEY])
@override_settings(R2_BUCKET="vnutour")
def test_private_submission_url_resolves_legacy_key_even_with_old_public_url(event_type):
    client = Mock()
    client.head_object.side_effect = [missing("HeadObject"), {}]
    client.generate_presigned_url.return_value = "https://signed.example/legacy"
    entry = {"storage": "r2", "key": "submissions/old.png", "url": "storage.example/submissions/old.png"}
    sub = SimpleNamespace(
        id=1, team=SimpleNamespace(code="T1", name="Team"), status="submitted",
        station=SimpleNamespace(sub_event=SimpleNamespace(type=event_type)), participant_id=None,
        is_correct=None, score=None, submitted_at=None, graded_at=None,
        graded_by=None, response_payload={}, item_marks=None, attachment_payload={"files": [entry]},
    )
    with patch.object(storage, "_r2_client", return_value=client):
        data = _serialize_submission(sub)
    assert data["files"][0]["url"] == "https://signed.example/legacy"
    assert data["is_survey"] == (event_type == SubEvent.TYPE_SURVEY)
    assert data["participant_id"] is None
    assert client.generate_presigned_url.call_args.kwargs["Params"]["Key"] == "vnutour/submissions/old.png"
    assert entry["url"] == "storage.example/submissions/old.png"


@pytest.mark.parametrize("kind", ["frame", "proof", "submission"])
@override_settings(R2_BUCKET="vnutour", R2_PUBLIC_BASE_URL="storage.example")
def test_new_upload_can_be_read_from_the_same_key(kind):
    objects = {}
    client = Mock()

    def upload(file, bucket, key, **kwargs):
        assert bucket == "vnutour"
        objects[key] = file.read()

    def get(**kwargs):
        return {"Body": io.BytesIO(objects[kwargs["Key"]])}

    client.upload_fileobj.side_effect = upload
    client.get_object.side_effect = get
    uploaded = SimpleUploadedFile("new.png", b"new-image", content_type="image/png")
    with patch.object(storage, "_r2_client", return_value=client):
        if kind == "frame":
            entry = storage.save_frame_image(uploaded)
        elif kind == "proof":
            entry = storage.save_payment_proof(SimpleNamespace(code="T1"), uploaded)
        else:
            entry = storage.save_submission_files(SimpleNamespace(id=1), SimpleNamespace(code="T1"), [uploaded], {})[0]
        response = storage.proof_file_response(entry)
    assert entry["storage"] == "r2"
    assert entry["url"] == f'https://storage.example/{entry["key"]}'
    assert not entry["key"].startswith("vnutour/")
    assert response.content == b"new-image"
    assert client.get_object.call_count == 1
