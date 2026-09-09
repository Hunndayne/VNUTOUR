# Admin account details

The Accounts page opens a read-only drawer through `?detail=<username>`.
It shows account contact information, Google link status, the linked participant's
registration fields and Discord identity, team membership, and timestamps.
Password hashes, session tokens and Google subject identifiers are never included.
Profile/team ownership is resolved by `Participant.account_id`, not by matching
mutable MSSV or email text. Differences between the account and its linked profile
are displayed for review; reading does not repair or merge records.

## Transport

`POST /api/admin/accounts/<username>/details` accepts only an authenticated admin
or master admin. Cookie authentication also requires the existing CSRF checks.
The request body is `{ "public_key": "<base64 SPKI DER RSA public key>" }`.
Only RSA keys of 2048, 3072 or 4096 bits with exponent 65537 are accepted.

The response is `{ "encrypted": true, "jwe": "<compact JWE>" }`, with five
base64url segments: protected header, encrypted key, IV, ciphertext, authentication
tag. The protected header uses `alg=RSA-OAEP-256`, `enc=A256GCM`,
`typ=vnutour-account-details+jwe` and `account=<requested username>`.
The encoded protected header is the AES-GCM additional authenticated data.
Each response has a fresh 256-bit AES key, 96-bit nonce and 128-bit tag.

The browser uses Web Crypto to create a fresh RSA pair for every fetch. Its private
key is non-exportable. Only its public key is sent; the AES key is unwrapped to a
non-exportable CryptoKey. Keys and decrypted details are not persisted in browser
storage. Closing the drawer aborts pending work and unmounts its state. JavaScript
garbage collection cannot guarantee immediate erasure of rendered strings.
Missing crypto support, invalid headers, wrong keys, modified ciphertext and
plaintext responses all fail closed. There is no plaintext fallback.

Responses, including errors, use `Cache-Control: no-store` through `never_cache`.
Successful views create an `account.details_viewed` audit entry containing the
actor and target IDs, without the dossier or cryptographic material.

HTTPS remains required: this additional layer does not authenticate the server
without TLS and does not hide data from an authorized browser after decryption,
browser extensions, XSS, or the backend before encryption. It applies specifically
to this new details endpoint; existing list/edit/team/export APIs retain their
existing transport and authorization behavior. It is not database encryption or
two-factor authentication. Production already configures HTTPS redirection and
HSTS in Django, with ingress TLS; retain that deployment configuration.

## Deployment and validation

Install updated `backend/requirements.txt` (adds an explicit `cryptography`
dependency) and deploy both backend and frontend. No schema/data migration or
persistent encryption key is needed. No existing participant data is rewritten.

Backend: `python -m pytest backend/webapi/api/tests/test_admin_account_details.py`.
Frontend interoperability: from `frontend`, run
`node --test tests/accountDetailsCrypto.test.mjs`. Set `TEST_PYTHON` to the backend
Python executable outside Windows; the default uses the repository's Windows venv.
These tests call the actual Python encryptor and Web Crypto decryptor, including
Unicode, tampering, replay across keys, and cancellation scenarios.

References: [JWE compact serialization](https://www.rfc-editor.org/rfc/rfc7516#section-3.1),
[Web Crypto key generation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/generateKey),
[AES-GCM API](https://cryptography.io/en/stable/hazmat/primitives/aead/).
