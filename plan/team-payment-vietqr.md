# Bước Thanh toán + VietQR + upload minh chứng R2

Trạng thái: **ĐÃ CODE + VERIFY** (backend 379 test pass, FE build OK, chưa commit). Nhánh hiện tại: `feat/discord-oauth-connect` (nên tách nhánh `feat/team-payment-vietqr` trước khi commit vì đang lẫn WIP scoring/replay).

Còn lại: (1) BTC nhập số TK/tên TK thật ở `/admin/settings` (seed đang để trống → bước Thanh toán hiện "BTC chưa cấu hình tài khoản nhận" cho tới khi nhập); (2) smoke UI thủ công; (3) tách nhánh + commit.

## Mục tiêu (theo yêu cầu)

1. Tách "Ảnh minh chứng thanh toán" ra thành **một bước riêng "Thanh toán"**, đặt **trước "Gửi duyệt"**.
   - Luồng mới: `Hồ sơ · Đội · Thành viên · Thanh toán · Gửi duyệt · Được duyệt` (6 bước).
2. Bước Thanh toán hiển thị **QR VietQR** để quét chuyển khoản.
   - Lệ phí **25.000₫/người** → số tiền = `25.000 × số thành viên`.
   - Nội dung CK: `VNUTOUR2026 <mã 6 số> - <MSSV> - <HỌ TÊN>`
     (VD: `VNUTOUR2026 123456 - 22521234 - NGUYEN VAN A`).
   - MSSV/tên = **đội trưởng** (nhất quán). Mã 6 số cố định theo đội, để sau này auto-đối soát.
3. Upload minh chứng: **nén ảnh phía client rồi mới lên R2** (thay hẳn ô "dán link").
4. Trang admin (drawer đội): "Mở minh chứng" → **hiển thị ảnh trực tiếp**.
5. Cấu hình ngân hàng lưu ở **SystemSetting**, admin sửa được.

---

## Quyết định đã chốt

| Điểm | Chọn |
|---|---|
| Vị trí bước Thanh toán | Trước "Gửi duyệt" (minh chứng vẫn là điều kiện để gửi — khớp backend hiện tại) |
| Nguồn cấu hình bank | `SystemSetting["payment_config"]`, admin sửa được |
| Ô "dán link" cũ | Bỏ hẳn, chỉ còn upload R2 |
| MSSV/tên trong nội dung CK | Luôn dùng đội trưởng |
| Số tiền | `fee_per_person × số thành viên hiện tại` |

> ❓ **Cần BTC cung cấp để seed mặc định**: tên ngân hàng + **mã BIN Napas**, **số tài khoản**, **tên chủ TK**. (Mã BIN ví dụ: Vietcombank `970436`, MB `970422`, Techcombank `970407`, ACB `970416`…)

---

## Kiến trúc hiện trạng (đã khảo sát)

- **Wizard**: `frontend/src/ParticipantDashboard.jsx` — `STEPS` (dòng 60), card "Gửi duyệt" render `payment_proof` như một `SchemaField` kiểu URL (dòng 1538–1547), lưu vào `team.payment_proof` qua `PATCH /my-team`.
- **Gate gửi duyệt**: `views_participant.py:594` — nếu schema field `payment_proof` required mà `team.payment_proof` rỗng → `missing:team:payment_proof`.
- **Model**: `Team.payment_proof = CharField(500)` (`models.py:131`) — hiện chứa link dán tay.
- **R2 infra**: `services/submission_storage_service.py` — có `_r2_client()`, `_store_local()`, `presigned_url()`, nhưng key gắn **theo trạm** (`submissions/st{id}/{team}/…`). Media phục vụ private qua `views_media.py` (`/media/...`, chỉ file local; file R2 phục vụ từ bucket).
- **Admin drawer**: `frontend/src/TeamsPage.jsx:240` — link `<a>Mở minh chứng</a>`.
- **api.js**: đã có `apiDownload(path)` trả `{blob, filename}` (dòng 161) — dùng được để tải ảnh private rồi `URL.createObjectURL`.
- **Cấu hình động**: mẫu `SystemSetting` như `registration_form_schema` (`registration_service.py:25`), seed bằng data migration (`0008/0009`). **Chưa có UI admin** để sửa schema → phần admin sửa `payment_config` là mới hoàn toàn.

---

## Thay đổi Backend

### 1. Model + migration `0028`
`Team` thêm:
- `payment_code = CharField(max_length=6, null=True, blank=True)` — mã 6 số cố định.
- `payment_proof_file = JSONField(null=True, blank=True)` — `{name, size, type, key, storage, url?}` (giống metadata submission).
- Giữ `payment_proof` (CharField) cho **link cũ (legacy)** — admin/participant ưu tiên ảnh mới, fallback link cũ.

### 2. Data migration `0029` — seed `payment_config`
`SystemSetting["payment_config"]`:
```json
{
  "bank_bin": "970436", "bank_name": "Vietcombank",
  "account_no": "XXXXXXXXXX", "account_name": "NGUYEN VAN A",
  "fee_per_person": 25000, "prefix": "VNUTOUR2026", "template": "compact2"
}
```
(giá trị thật do BTC cung cấp; nếu chưa có, seed placeholder + hiện cảnh báo ở admin).

### 3. `services/payment_service.py` (mới)
- `get_payment_config()` → đọc SystemSetting, merge default.
- `_ascii(s)` → bỏ dấu tiếng Việt + upper (cho `addInfo`/`accountName` an toàn).
- `ensure_payment_code(team)` → sinh 6 số nếu chưa có (idempotent, lưu DB).
- `build_payment_info(team)` → trả:
  - `amount = fee_per_person × member_count`
  - `content = f"{prefix} {code} - {captain_mssv} - {ascii_name}"`
  - `qr_url = https://img.vietqr.io/image/{bin}-{acct}-{template}.png?amount={amount}&addInfo={urlenc content}&accountName={urlenc account_name}`
  - kèm `bank_name, account_no, account_name, member_count, fee_per_person`.
- `save_payment_proof(team, uploaded)` → key `payment-proofs/{team.code}/{uuid}_{safe}` , dùng lại `_r2_client/_store_local` (R2, fallback local), trả metadata entry.

### 4. `views_participant.py`
- `GET /my-team/payment` → `build_payment_info(team)` (auth participant = đội trưởng; đội chưa khoá).
- `POST /my-team/payment-proof` (multipart, field `file`) → validate ảnh (jpg/png/webp, ≤ ~5MB), `save_payment_proof`, set `team.payment_proof_file`, trả entry.
- `GET /my-team/payment-proof/file` → ảnh minh chứng của **đội mình** (stream local / 302 presigned R2).
- Sửa **gate gửi duyệt**: coi là hợp lệ khi có `payment_proof_file` **hoặc** `payment_proof` (legacy).
- `my_team_view` GET trả thêm `has_payment_proof`.

### 5. Phục vụ ảnh cho admin
- `views_admin.py`: `GET /admin/teams/{id}/payment-proof` → ảnh (admin/master_admin). Team detail trả thêm `has_payment_proof`.
- Chọn cách phục vụ đồng nhất cho cả participant & admin: **stream local / 302 → presigned R2**, để frontend tải bằng `apiDownload` (Bearer) → `objectURL`. (Không lộ public URL cho ảnh nhạy cảm.)

### 6. Admin sửa cấu hình
- `GET/PUT /admin/payment-config` (chỉ admin/master_admin) đọc/ghi `SystemSetting["payment_config"]`.

### 7. URLs
- Thêm route participant (`urls_participant.py`), admin (`urls_admin.py`).

---

## Thay đổi Frontend

### 8. `imageCompress.js` (mới)
- `compressImage(file, {maxDim=1600, quality=0.8, mime='image/webp'})`:
  `createImageBitmap(file, {imageOrientation:'from-image'})` → canvas scale → `toBlob`.
  Bỏ qua nếu không phải ảnh hoặc đã nhỏ; fallback file gốc nếu lỗi.

### 9. `ParticipantDashboard.jsx`
- `STEPS`: chèn `{ key:'payment', label:'Thanh toán' }` **trước** `submit`; grid `grid-cols-5` → `grid-cols-6`; cập nhật `getStepState` (payment = done khi có minh chứng).
- **Bỏ** `SchemaField payment_proof` khỏi card "Gửi duyệt"; bỏ `paymentProofDraft` & việc gửi `payment_proof` trong `saveTeamNameIfNeeded` (chỉ còn lưu tên đội).
- Component mới `PaymentStepCard`:
  - `GET /my-team/payment` → QR (`<img src=qr_url>`), số tiền (format ₫), **nội dung CK + nút Copy**, tên NH / số TK / chủ TK, ghi chú "chuyển đúng nội dung để BTC đối soát".
  - Vùng upload: chọn ảnh → `compressImage` → `POST /my-team/payment-proof` → preview thumbnail (tải qua `apiDownload('/my-team/payment-proof/file')`), nút "Đổi ảnh".
- `normalizeTeam`: thêm `has_payment_proof`.
- "Checklist nhanh": thêm dòng "Đã có minh chứng thanh toán".
- Nút "Gửi duyệt" giữ nguyên nhưng disable + hint nếu chưa có minh chứng.

### 10. `TeamsPage.jsx` (admin drawer)
- Thay block `Mở minh chứng` bằng `<img>` (tải `/admin/teams/{id}/payment-proof` qua `apiDownload` → objectURL), click phóng to (mở tab mới). Fallback link cũ nếu chỉ có `payment_proof` legacy; "Chưa có minh chứng" khi trống. Revoke objectURL khi unmount.

### 11. `AdminDashboard.jsx` — tab settings
- Form nhỏ sửa `payment_config` (bank_bin, bank_name, account_no, account_name, fee_per_person, prefix) qua `GET/PUT /admin/payment-config`, có preview QR.

---

## Test
- `test_payment_service`: mã 6 số ổn định/idempotent; `content` đúng format & bỏ dấu; `amount` theo số TV; default config khi thiếu SystemSetting.
- `test_participant_payment`: upload lưu `payment_proof_file`; gate gửi duyệt nhận field mới; ảnh chỉ đội mình xem được (đội khác 403, admin OK); `GET /my-team/payment` đúng.
- `test_admin_payment`: admin xem ảnh, GET/PUT payment-config quyền đúng.

---

## Phân đoạn triển khai
- **P1 (lõi)**: model+migration, `payment_service`, endpoint payment/upload/serve, bước Thanh toán FE + nén ảnh, đổi admin drawer sang ảnh. Config đọc từ SystemSetting đã seed.
- **P2**: UI admin sửa `payment_config` (+ endpoint). Có thể ship sau P1.

## Tái sử dụng từ dự án cũ (`D:\code\caulongdi`)

- `frontend/src/lib/banks.json` — **đã copy** (danh mục 65 bank + BIN, dạng `{code,desc,data:[{name,code,bin,shortName,logo,...}]}`). Dùng cho picker bank ở admin.
- `frontend/src/lib/bankDeeplinks.ts` → **port sang `.js`** (bỏ type). Giữ export:
  `buildVietQrPayload({bankBin,accountNumber,amount,description})` (dựng chuỗi EMV/VietQR + CRC16),
  `BANK_DEEPLINKS`, `BANK_DEEPLINK_OPTIONS`, `buildBankDeeplink`, `buildTimoDeeplink`,
  `buildQrBankDeeplink`, `openDeeplinkWithFallback`.
- **Ảnh QR** = `<img src="https://img.vietqr.io/image/{bin}-{acct}-compact2.png?amount=&addInfo=&accountName=">` (browser tự tải, không cần key).
  **Deeplink app bank** cần chuỗi EMV từ `buildVietQrPayload` (đút vào `qrContent=`). Nút "Mở app ngân hàng" = người trả chọn app của họ (BANK_DEEPLINK_OPTIONS) → `openDeeplinkWithFallback`.

## Contract API (chốt cho các agent)

`SystemSetting["payment_config"]`:
```json
{ "bank_bin":"970436","bank_short_name":"Vietcombank","account_no":"...","account_name":"NGUYEN VAN A",
  "fee_per_person":25000,"prefix":"VNUTOUR2026","template":"compact2" }
```
- `GET /my-team/payment` → `{ amount, content, payment_code, member_count, fee_per_person,
  bank:{bin,short_name,account_no,account_name}, qr_image_url, has_proof }`
  (`content = "{prefix} {code} - {captain_mssv} - {ASCII họ tên}"`, `amount = fee_per_person × member_count`).
- `POST /my-team/payment-proof` (multipart field `file`) → `{ has_proof:true, name, size }`. Lưu vào `team.payment_proof_file`.
- `GET /my-team/payment-proof/file` → ảnh (stream local / 302 presigned R2); 404 nếu chưa có. Đội mình.
- `GET /admin/teams/{id}/payment-proof` → ảnh (admin/master_admin).
- `GET /admin/payment-config` → `{ payment_config:{...} }`; `PUT` body `{bank_bin,bank_short_name,account_no,account_name,fee_per_person,prefix}` → lưu, trả lại.
- `my-team` GET + admin team detail thêm `has_payment_proof`.

Model `Team`: `payment_code=CharField(6,null,blank)`, `payment_proof_file=JSONField(null,blank)`; giữ `payment_proof` (legacy). Migration `0028` (fields, depends 0027), `0029` (seed payment_config).

## Rủi ro / lưu ý
- `img.vietqr.io` là ảnh ngoài (browser tự tải, không cần key) — OK cho SPA. Nếu muốn không phụ thuộc bên thứ 3: sinh QR VietQR phía server (thư viện) — để dành, chưa làm.
- `addInfo` phải bỏ dấu + urlencode; giới hạn độ dài memo của một số ngân hàng (~25–50 ký tự) — tên dài có thể bị cắt; ưu tiên `mã - MSSV` trước tên.
- Ảnh nhạy cảm (ảnh chụp chuyển khoản) → phục vụ private (không dùng public R2 URL).
- Đội < 5 người vẫn thanh toán được (amount theo số TV hiện tại) — khớp quy tắc đăng ký thiếu người.
