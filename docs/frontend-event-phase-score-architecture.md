# Frontend architecture: fixed phase -> sub-event -> station -> score

## Muc tieu

Admin FE hien tai duoc chot theo 1 mua duy nhat, khong quan ly nhieu season.

Truc van hanh moi:

```txt
Phase co dinh -> Event con trong phase -> Tram trong event -> Diem event -> Tong diem phase
```

Trong do:

- `Phase` la khung co dinh cua mua.
- `Event con` la hoat dong nho nam trong phase.
- `Tram` chi thuoc ve event con nao bat tuy chon `Co tram`.
- Diem tram cong vao event con.
- Tong diem cua cac event con tao thanh leaderboard cua phase.

---

## 1. Phase la co dinh

FE khong cho tao/xoa phase. Chi co 4 phase:

1. `Dang ky`
2. `Vong loai`
3. `Vong chung ket`
4. `Ket thuc`

Admin chi duoc:

- sua `startDate`
- sua `endDate`
- chuyen `currentPhase`

File nguon:

- `frontend/src/adminProgram.js`
- `frontend/src/EventManagementPage.jsx`

Storage:

```txt
vnutour:admin:program
```

Shape:

```js
{
  currentPhase: 'qualifying',
  phaseSchedule: {
    registration: { startDate, endDate },
    qualifying: { startDate, endDate },
    final: { startDate, endDate },
    ended: { startDate, endDate },
  },
  subEventsByPhase: {
    registration: [],
    qualifying: [],
    final: [],
    ended: [],
  }
}
```

---

## 2. Event con nam ben trong phase

Tab `Quan ly su kien` khong con quan ly top-level event.
No chi quan ly:

- lich cua phase
- phase hien tai
- danh sach `event con` cua phase dang chon

Moi event con co:

```js
{
  id,
  name,
  type,         // workflow | social | station_run | quiz | submission | custom
  startDate,
  endDate,
  usesStations, // true neu event nay co bo tram rieng
  note
}
```

Y nghia nghiep vu:

- `social`: event cong diem tu social
- `station_run`: event co bo tram
- `quiz`: event hoi dap / trac nghiem
- `submission`: event nop file, nop minh chung
- `workflow`: event van hanh, briefing, duyet ho so

Neu `usesStations = true` thi event do xuat hien trong tab `Quan ly tram`.

---

## 3. Tram thuoc ve event con, khong thuoc phase thuan

Tab `Quan ly tram` da duoc doi tu model:

```txt
phase -> stations[]
```

thanh:

```txt
phase -> subEventId -> stations[]
```

Storage:

```txt
vnutour:admin:stations-by-phase-event
```

Shape:

```js
{
  qualifying: {
    'qual-station-map': [station, station, ...]
  },
  final: {
    'final-station-map': [station, station, ...]
  }
}
```

FE co migration nhe tu key cu:

```txt
vnutour:admin:stations-by-phase
```

de khong mat mock data cu trong localStorage.

### Tram co gi

Moi tram gom:

```js
{
  id,
  order,
  name,
  location,
  active,
  checkinPolicy,      // staff_scan | free_play
  capacityMode,       // unlimited | limited
  maxConcurrentTeams, // chi dung khi limited
  teamsHere: [],
  teamsDone: [
    { id, name, doneAt, score }
  ],
  submission: {
    brief,      // markdown
    form,
    quiz,
    attachment
  }
}
```

### 3.1. Van hanh vao/ra tram

Moi tram co them 2 cau hinh van hanh:

- `checkinPolicy`
  - `staff_scan`: vao/ra tram duoc ghi nhan bang QR boi admin/co-op
  - `free_play`: tram khong bat buoc admin/co-op scan
- `capacityMode`
  - `unlimited`: khong gioi han so doi choi cung luc
  - `limited`: co `maxConcurrentTeams`

Luu y nghiep vu:

- Neu tram la `staff_scan + limited`, FE co the chan vuot cong suat theo `teamsHere`.
- Neu tram la `free_play`, FE khong theo doi occupancy thoi gian thuc bang operator scan. Khi noi API, can xem day la tram tu do va khong dung occupancy de gate luong vao.

### Cau hinh bai nop

FE da ho tro 3 kieu cau hinh trong tram:

- `form`
- `quiz`
- `attachment`

Va co the bat nhieu loai cung luc trong cung 1 tram.

`submission.brief` duoc uu tien soan bang markdown va co preview ngay tren FE.

### 3.2. Trang QR operations

FE hien co them trang QR operations de dung chung cho:

- check-in su kien
- check-in vao tram
- check-out roi tram

Trang nay doc context tu:

- `vnutour:admin:program`
- `vnutour:admin:stations-by-phase-event`

De operator chon:

- phase
- event co tram
- tram cu the
- mode quet

Tam thoi, du lieu vao/ra tram van la mock state tren FE:

- station config: `vnutour:admin:stations-by-phase-event`
- station ops log: `vnutour:checkin:station-ops`

--- 

## 4. Diem tong hop theo phase, nhung co nguon goc theo event con

Tab `Diem & suat di tiep` khong tao event moi.
No doc event con tu `Quan ly su kien`, roi tong hop diem theo 2 nguon:

1. `Diem tram`
2. `Cong/tru thu cong`

### 4.1. Diem tram

Neu event con co `usesStations = true`, FE se doc:

```js
stationsByPhaseEvent[phase][subEventId]
```

va cong tat ca:

```js
station.teamsDone[].score
```

vao event do.

### 4.2. Cong/tru thu cong

Dung cho:

- diem social
- diem quiz khong di qua tram
- diem submission
- penalty
- dieu chinh tay cua BTC

Storage:

```txt
vnutour:admin:phase-scoring
```

Shape chinh:

```js
{
  rosterByPhase,
  manualLedgerByPhase,
  advancementByPhase,
}
```

Trong `manualLedgerByPhase`, moi dong diem deu phai gan voi 1 event con:

```js
{
  id,
  teamId,
  phaseEventId,
  phaseEventName,
  phaseEventType,
  kind,      // bonus | penalty | manual
  points,
  note,
  createdAt
}
```

---

## 5. Roster cua phase tach rieng voi danh sach dang ky

`Quan ly doi` la noi xu ly danh sach doi va thanh vien.

`Diem & suat di tiep` lai co `rosterByPhase` rieng de tra loi cau hoi:

- doi nao duoc cham diem trong phase nay?
- co bao nhieu doi vao chung ket?
- doi nao la wildcard?

Vi vay:

- roster dang ky != roster cham diem
- du lieu cua phase truoc van giu nguyen
- day doi sang phase sau chi cap nhat roster phase sau

---

## 6. Day doi sang phase sau

FE ho tro 2 cach:

1. `top_n`
2. `manual`

BTC chon so slot, preview danh sach, roi day roster sang phase ke tiep.

Vi du:

- `Vong loai` lay top 15 vao `Vong chung ket`
- `Vong chung ket` co the chon tay neu can doi soat

Quan trong:

- leaderboard phase duoc tinh tu tong diem event con
- khi day doi, ledger cua phase cu khong bi sua

---

## 7. Trach nhiem cua tung trang admin

### `Quan ly su kien`

- sua lich phase
- chuyen current phase
- tao/sua/xoa event con trong phase
- bat/tat `Co tram` cho event con

### `Quan ly tram`

- chon phase
- chon event con co tram
- tao/sua/xoa tram trong event do
- cau hinh markdown/form/quiz/file
- xem tong diem tram tu `teamsDone[].score`

### `Diem & suat di tiep`

- tong hop diem event con
- them cong/tru thu cong
- xem leaderboard phase
- quan ly roster phase
- day doi sang phase tiep theo

---

## 8. Ghi chu ky thuat

### File chinh

- `frontend/src/adminProgram.js`
- `frontend/src/EventManagementPage.jsx`
- `frontend/src/StationsPage.jsx`
- `frontend/src/ScoreManagementPage.jsx`
- `frontend/src/AdminDashboard.jsx`

### Dieu da duoc implementation

- phase co dinh
- sub-event theo phase
- tram theo `phase + subEventId`
- markdown composer/preview cho mo ta tram
- form / quiz / attachment config
- tong diem tram vao event
- tong diem event vao phase
- top N / manual advancement

### Gioi han hien tai

- chua noi API
- diem tram hien la mock state trong localStorage
- `teamsDone[].score` hien duoc xem nhu du lieu cham diem co san tren FE mock

---

## 9. Ket luan

Kien truc FE hien tai da dung voi cach BTC van hanh:

- phase la co dinh
- event con la don vi nghiep vu trong phase
- tram la chi tiet cua event con co tram
- bang diem phase la tong hop cua nhieu event con

Huong nay hop ly hon model cu, va sau nay noi backend se de map hon vi data flow da ro:

```txt
Station score -> Event total -> Phase leaderboard -> Advancement
```
