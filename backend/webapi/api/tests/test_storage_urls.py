from unittest import TestCase

from api.services.submission_storage_service import (
    normalize_public_base_url,
    normalize_r2_endpoint_url,
)


class PublicStorageUrlTests(TestCase):
    def test_schemeless_hostname_defaults_to_https(self):
        self.assertEqual(
            normalize_public_base_url("storage-vnutour.hiseku.net/"),
            "https://storage-vnutour.hiseku.net",
        )

    def test_absolute_and_empty_values_are_preserved(self):
        self.assertEqual(
            normalize_public_base_url("https://storage.example.com/"),
            "https://storage.example.com",
        )
        self.assertEqual(normalize_public_base_url(""), "")

    def test_r2_endpoint_drops_a_duplicated_bucket_path(self):
        self.assertEqual(
            normalize_r2_endpoint_url(
                "https://account.r2.cloudflarestorage.com/vnutour/",
                "vnutour",
            ),
            "https://account.r2.cloudflarestorage.com",
        )

    def test_r2_endpoint_preserves_the_canonical_account_endpoint(self):
        self.assertEqual(
            normalize_r2_endpoint_url(
                "https://account.r2.cloudflarestorage.com",
                "vnutour",
            ),
            "https://account.r2.cloudflarestorage.com",
        )
