# API plan: QR check-in, station occupancy, and event flow

## Muc tieu

Noi backend cho 2 luong QR moi tren FE:

1. `Check-in su kien`
2. `Check-in / check-out tram`

Trong khi van giu dung domain da chot:

```txt
Phase co dinh -> Event con -> Tram -> Diem event -> Tong diem phase
```

---

## 1. Nhung gi FE da ky vong

### 1.1. Phase va event

- Phase la co dinh:
  - `registration`
  - `qualifying`
  - `final`
  - `ended`
- Event con nam trong phase
- Tram chi thuoc event con co `usesStations = true`

### 1.2. Tram

Moi tram can co them cac field backend-ready:

```ts
type Station = {
  id: string
  eventId: string
  phaseKey: 'registration' | 'qualifying' | 'final' | 'ended'
  name: string
  location?: string
  active: boolean
  checkinPolicy: 'staff_scan' | 'free_play'
  capacityMode: 'unlimited' | 'limited'
  maxConcurrentTeams: number | null
}
```

Y nghia:

- `staff_scan`: vao/ra tram duoc ghi nhan bang QR boi operator
- `free_play`: khong bat buoc operator scan vao/ra
- `limited`: backend duoc phep chan them doi moi neu dang full

Luu y quan trong:

- `free_play` khong co nghia la backend co the biet occupancy thoi gian thuc.
- Neu tram `free_play`, occupancy chi la thong tin cau hinh, khong nen dung de gate luong vao tru khi sau nay co them luong self-scan cua doi.

---

## 2. API can co

## 2.1. Operator auth

Co the giu tam API cu:

- `POST /api/auth/login`
- `POST /api/auth/register`

Khong can doi ngay trong phase FE hien tai.

---

## 2.2. Check-in su kien

### `POST /api/event-checkins/scan`

Dung cho man QR mode `Check-in su kien`.

Request:

```json
{
  "eventId": "qual-station-map",
  "phaseKey": "qualifying",
  "teamCode": "T0007",
  "scannerUserId": "user_123"
}
```

Response:

```json
{
  "checkinId": "eci_001",
  "team": {
    "id": "team_007",
    "teamCode": "T0007",
    "name": "Nhung chien binh"
  },
  "event": {
    "id": "qual-station-map",
    "phaseKey": "qualifying",
    "name": "Chay tram ban do"
  },
  "checkedInAt": "2026-06-18T09:15:00.000Z",
  "members": []
}
```

Rule:

- mot doi chi co 1 lan check-in hop le trong cung 1 event
- co the mo rong sau nay de cho phep check-in theo `phase` thay vi theo `event`, nhung FE nen map vao event ro rang ngay tu dau

### `GET /api/event-checkins`

Query:

```txt
?phaseKey=qualifying&eventId=qual-station-map
```

Tra ve danh sach doi da check-in.

### `GET /api/event-checkins/stats`

Query:

```txt
?phaseKey=qualifying&eventId=qual-station-map
```

Tra ve:

```json
{
  "checkedInTeams": 42,
  "checkedInParticipants": 126
}
```

### `DELETE /api/event-checkins/:checkinId`

Reset check-in khi BTC can doi soat.

Khong nen xoa theo `teamCode` nua, vi sau nay 1 doi co the check-in nhieu event khac nhau.

---

## 2.3. Station enter / exit

Nen model hoa theo `station session`, khong ghi de vao station object.

### `POST /api/station-sessions/enter`

Request:

```json
{
  "phaseKey": "qualifying",
  "eventId": "qual-station-map",
  "stationId": "VL02",
  "teamCode": "T0007",
  "operatorUserId": "user_123"
}
```

Response:

```json
{
  "sessionId": "sts_001",
  "station": {
    "id": "VL02",
    "name": "Tram 2",
    "checkinPolicy": "staff_scan",
    "capacityMode": "limited",
    "maxConcurrentTeams": 2
  },
  "team": {
    "id": "team_007",
    "teamCode": "T0007",
    "name": "Nhung chien binh"
  },
  "enteredAt": "2026-06-18T09:20:00.000Z",
  "occupancy": {
    "current": 2,
    "limit": 2,
    "isFull": true
  }
}
```

Validation:

- station phai ton tai trong dung `phase + event`
- neu `checkinPolicy = free_play`:
  - API nay co the tu choi `409 policy_free_play`
  - hoac cho phep scan tay trong che do override, nhung nen chot 1 kieu duy nhat
- neu `capacityMode = limited`, chan khi full
- khong cho 1 doi enter 2 lan khi chua exit
- khong cho 1 doi o 2 station active cung luc trong cung 1 event, tru khi BTC bat co che override

### `POST /api/station-sessions/exit`

Request:

```json
{
  "phaseKey": "qualifying",
  "eventId": "qual-station-map",
  "stationId": "VL02",
  "teamCode": "T0007",
  "operatorUserId": "user_123"
}
```

Response:

```json
{
  "sessionId": "sts_001",
  "team": {
    "id": "team_007",
    "teamCode": "T0007",
    "name": "Nhung chien binh"
  },
  "station": {
    "id": "VL02",
    "name": "Tram 2"
  },
  "enteredAt": "2026-06-18T09:20:00.000Z",
  "exitedAt": "2026-06-18T09:33:00.000Z",
  "occupancy": {
    "current": 1,
    "limit": 2,
    "isFull": false
  }
}
```

Validation:

- phai co session dang `active`
- khong cho exit neu doi chua enter

---

## 2.4. Occupancy va nhat ky tram

### `GET /api/stations/:stationId/occupancy`

Query:

```txt
?phaseKey=qualifying&eventId=qual-station-map
```

Response:

```json
{
  "stationId": "VL02",
  "phaseKey": "qualifying",
  "eventId": "qual-station-map",
  "checkinPolicy": "staff_scan",
  "capacityMode": "limited",
  "maxConcurrentTeams": 2,
  "currentTeams": [
    {
      "teamId": "team_007",
      "teamCode": "T0007",
      "name": "Nhung chien binh",
      "enteredAt": "2026-06-18T09:20:00.000Z"
    }
  ],
  "currentCount": 1,
  "isFull": false
}
```

### `GET /api/station-sessions`

Query:

```txt
?phaseKey=qualifying&eventId=qual-station-map&stationId=VL02&status=all
```

Dung cho recent ops va lich su vao/ra.

---

## 2.5. Station config APIs

FE admin sau nay se can API cho cau hinh tram:

### `GET /api/phases/:phaseKey/events/:eventId/stations`

Lay danh sach tram cua event.

### `PUT /api/stations/:stationId`

Cap nhat:

```json
{
  "name": "Tram 2",
  "location": "Thu vien",
  "active": true,
  "checkinPolicy": "staff_scan",
  "capacityMode": "limited",
  "maxConcurrentTeams": 2,
  "submission": {
    "brief": "Markdown...",
    "form": { "enabled": true, "fields": [] },
    "quiz": { "enabled": false, "items": [] },
    "attachment": { "enabled": true, "maxFiles": 1, "allowedTypes": "JPG, PNG" }
  }
}
```

Backend nen validate:

- `maxConcurrentTeams = null` neu `capacityMode = unlimited`
- `maxConcurrentTeams >= 1` neu `capacityMode = limited`
- `checkinPolicy` va `capacityMode` dung enum

---

## 3. Luu tru du lieu nen tach the nao

## 3.1. Event check-in

Bang / collection `event_checkins`

```ts
{
  id,
  phaseKey,
  eventId,
  teamId,
  scannerUserId,
  checkedInAt,
  status // active | reverted
}
```

Unique key nen la:

```txt
(eventId, teamId, status=active)
```

## 3.2. Station session

Bang / collection `station_sessions`

```ts
{
  id,
  phaseKey,
  eventId,
  stationId,
  teamId,
  enteredByUserId,
  enteredAt,
  exitedByUserId,
  exitedAt,
  status // active | closed | cancelled
}
```

Neu can chan 1 doi dang o 2 tram cung luc, validate theo:

```txt
(eventId, teamId, status=active)
```

---

## 4. Cac ma loi nen co

### Event check-in

- `team_not_found`
- `event_not_found`
- `already_checked_in`
- `phase_mismatch`

### Station enter / exit

- `station_not_found`
- `station_inactive`
- `policy_free_play`
- `station_full`
- `session_already_active`
- `session_not_found`
- `session_already_closed`

---

## 5. Mapping tu FE hien tai sang API moi

FE QR page hien co 3 mode:

1. `event`
2. `station_enter`
3. `station_exit`

Mapping de noi backend:

- `event` -> `POST /api/event-checkins/scan`
- `station_enter` -> `POST /api/station-sessions/enter`
- `station_exit` -> `POST /api/station-sessions/exit`

Danh sach o ben phai:

- list doi da check-in -> `GET /api/event-checkins`
- stats -> `GET /api/event-checkins/stats`
- recent station ops -> `GET /api/station-sessions?...`
- occupancy station -> `GET /api/stations/:stationId/occupancy`

---

## 6. Thu tu implementation backend de it rung nhat

1. Giu auth API nhu cu
2. Tach event check-in sang namespace moi `event-checkins`
3. Lam `station_sessions` cho tram `staff_scan`
4. Mo API lay occupancy + recent ops
5. Sau cung moi doi admin station config sang API that

Lam theo thu tu nay se giup:

- check-in su kien chay truoc
- tram co occupancy chay doc lap
- FE admin va FE operator co the noi API dan dan, khong can doi mot luc

---

## 7. Quy tac domain nen chot som

Co 3 diem nen khoa som truoc khi code backend:

1. `Check-in su kien` la theo `phase` hay theo `event`?
   - De nhat quan voi kien truc moi, nen theo `event`.
2. `free_play` co cho operator scan override khong?
   - Neu khong, backend tra `policy_free_play`.
3. Mot doi co duoc active o 2 station cung luc trong cung 1 event khong?
   - Mac dinh nen `khong`.

---

## Ket luan

Phia FE da san sang cho model:

```txt
Event check-in + Station session + Station occupancy
```

Neu backend di theo plan nay, viec noi API sau se thang hang voi:

- phase co dinh
- event con
- tram theo event
- occupancy theo tram
- leaderboard theo event / phase
