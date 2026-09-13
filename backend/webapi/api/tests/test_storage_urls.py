from unittest import TestCase

from api.services.submission_storage_service import normalize_public_base_url


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
