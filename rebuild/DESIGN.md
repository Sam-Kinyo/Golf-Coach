# 高爾夫預約系統 — 架構設計書

> 打掉重練版：LINE + LIFF + 後端 API + Firebase Firestore
> 開發決策：70% 穩定度與邊界處理，30% 開發速度

---

## 一、營業時間

- **時段**：06:00–22:00
- **區間**：每小時一檔（06:00, 07:00, …, 22:00）
- **實作**：程式內固定，無需額外資料表

---

## 二、Firestore Schema

### Collection 結構總覽

```
users              # LINE 使用者
coach_whitelist    # 教練白名單
packages           # 儲值課程包
credit_transactions # 堂數異動紀錄
coach_leaves       # 教練休假
bookings           # 預約
waitlists          # 候補（無時效，僅通知）
notifications_log  # 通知紀錄（防重複）
```

---

### 1. users

| 欄位 | 型別 | 說明 |
|------|------|------|
| lineUserId | string | LINE userId（文件 ID 或欄位） |
| role | string | `student` \| `coach` |
| alias | string? | 教練設定的真實姓名 |
| displayName | string? | LINE 顯示名稱快取 |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

**文件 ID**：建議用 `lineUserId` 當文件 ID，方便查詢。

**複合索引**：`role`, `alias`（用於教練查學員）

---

### 2. coach_whitelist

| 欄位 | 型別 | 說明 |
|------|------|------|
| lineUserId | string | 教練 LINE userId（文件 ID） |
| createdAt | Timestamp | |

**文件 ID**：`lineUserId`

---

### 3. packages

| 欄位 | 型別 | 說明 |
|------|------|------|
| userId | string | 學員 lineUserId（或 users 文件 ID） |
| totalCredits | number | 總堂數 |
| usedCredits | number | 已使用 |
| remainingCredits | number | 剩餘 |
| validFrom | string | 生效日 `YYYY-MM-DD` |
| validTo | string? | 到期日 `YYYY-MM-DD` |
| status | string | `active` \| `expired` \| `fully_used` \| `cancelled` |
| title | string | 方案名稱 |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

**複合索引**：`userId` + `status`, `validTo`

---

### 4. credit_transactions

| 欄位 | 型別 | 說明 |
|------|------|------|
| packageId | string | packages 文件 ID |
| userId | string | 學員 lineUserId |
| change | number | +N 加點 / -N 扣點 |
| reason | string | `purchase` \| `lesson_attended` \| `refund` \| `manual_adjustment` |
| bookingId | string? | 關聯預約 |
| note | string? | |
| createdAt | Timestamp | |

**複合索引**：`packageId`, `userId`, `createdAt`

---

### 5. coach_leaves

| 欄位 | 型別 | 說明 |
|------|------|------|
| leaveDate | string | `YYYY-MM-DD` |
| startTime | string? | `HH:mm`，全天則 null |
| endTime | string? | `HH:mm`，全天則 null |
| note | string? | |
| createdAt | Timestamp | |

**複合索引**：`leaveDate`

---

### 6. bookings

| 欄位 | 型別 | 說明 |
|------|------|------|
| userId | string | 學員 lineUserId |
| bookingDate | string | `YYYY-MM-DD` |
| startTime | string | `HH:00` |
| endTime | string | `HH:00` |
| location | string | 練習場 |
| service | string | 課程類型 |
| status | string | `pending` \| `approved` \| `rejected` \| `completed` \| `cancelled` |
| packageId | string? | 扣課使用的方案 |
| creditsUsed | number | 本次扣課數 |
| calendarEventId | string? | Google Calendar 事件 ID |
| cancelReason | string? | |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

**複合索引**：`userId`, `bookingDate` + `status`, `bookingDate` + `startTime`（衝堂檢查）

**唯一性**：同一 `bookingDate` + `startTime` 僅允許一筆 `approved` / `pending`，由程式檢查。

---

### 7. waitlists（候補，無時效）

| 欄位 | 型別 | 說明 |
|------|------|------|
| userId | string | 學員 lineUserId |
| desiredDate | string | `YYYY-MM-DD` |
| startTime | string | `HH:00` |
| location | string? | |
| service | string? | |
| status | string | `waiting` \| `notified` \| `cancelled` |
| notifiedAt | Timestamp? | 通知候補時 |
| createdAt | Timestamp | |

**流程**：原預約取消 → 查該時段候補 → 推播通知候補者 → 學員重新預約 → 教練核准。無保留時效。

---

### 8. notifications_log

| 欄位 | 型別 | 說明 |
|------|------|------|
| userId | string | |
| type | string | `reminder_tomorrow` \| `expiry_warning` \| `waitlist_notify` |
| bookingId | string? | |
| sentAt | Timestamp | |

**用途**：避免重複推播（如明日提醒）。

---

## 三、Firestore Transaction 策略

| 操作 | 策略 |
|------|------|
| 學員預約 | `runTransaction` → 檢查時段 + coach_leaves → `set` booking |
| 取消預約 + 候補通知 | `runTransaction` → 更新 booking → 查候補 → 更新 waitlist；推播非同步 |
| 扣課 / 加課 | `runTransaction` → `get` package → 更新 remainingCredits → `set` credit_transaction |
| 教練核准預約 | `runTransaction` → 更新 booking → 若需扣課則同上 |

---

## 四、專案資料夾結構

```
golf-coach-v2/
├── .env.example
├── .gitignore
├── package.json
├── README.md
├── docs/
│   ├── DESIGN.md
│   ├── FIREBASE-SETUP.md    # Firebase 設定清單（可貼給 Gemini）
│   ├── API.md
│   └── DEPLOYMENT.md
│
├── src/
│   ├── index.ts             # 入口 (Express/Fastify)
│   ├── config/
│   │   ├── env.ts
│   │   ├── firebase.ts      # Firestore 初始化
│   │   └── line.ts
│   │
│   ├── routes/
│   │   ├── webhook.ts       # LINE Webhook
│   │   ├── cron/            # ⚠️ 僅供 Cloud Scheduler 呼叫，嚴禁 node-cron
│   │   │   ├── reminders.ts # POST /api/cron/reminders
│   │   │   ├── expiry.ts    # POST /api/cron/expiry
│   │   │   └── coachDigest.ts # POST /api/cron/coach-digest
│   │   ├── liff/
│   │   │   ├── coach.ts
│   │   │   └── student.ts
│   │   └── health.ts
│   │
│   ├── services/
│   │   ├── line.ts
│   │   ├── user.ts
│   │   ├── package.ts
│   │   ├── booking.ts
│   │   ├── waitlist.ts
│   │   ├── coachLeave.ts
│   │   └── notification.ts
│   │
│   ├── handlers/
│   │   ├── webhook.ts
│   │   ├── student/
│   │   └── coach/
│   │
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── coachGuard.ts
│   │   ├── cronAuth.ts      # 驗證 Cloud Scheduler 呼叫（如 Header 密鑰）
│   │   └── errorHandler.ts
│   │
│   └── utils/
│       ├── logger.ts
│       ├── errors.ts
│       └── constants.ts     # 營業時段 06:00-22:00
│
├── liff/
│   └── coach/
│       ├── credit-form/
│       ├── student-list/
│       └── block-time/
│
└── scripts/
    └── seed.ts
```

---

## 五、Cron Endpoints（Cloud Scheduler 專用）

**嚴禁**：`node-cron`、`setInterval` 等常駐排程。

| Endpoint | 說明 | 建議排程 |
|----------|------|----------|
| `POST /api/cron/reminders` | 預約前一天 21:00 提醒學員 | 每日 21:00 |
| `POST /api/cron/expiry` | 到期日前一個月提醒學員 | 每日 08:00 |
| `POST /api/cron/coach-digest` | 教練明日行程彙整 | 每日 21:00 |

**安全**：需驗證呼叫來源（如 `X-Cron-Secret` Header 或 Cloud Scheduler 的 OIDC）。

---

## 六、Tech Stack

| 項目 | 選擇 |
|------|------|
| Runtime | Node.js 20+ |
| Framework | Fastify 或 Express |
| DB | Firebase Firestore |
| Cron | Google Cloud Scheduler → HTTP 呼叫上述 Endpoints |
| LINE SDK | @line/bot-sdk |
| LIFF | LIFF SDK v2 |
| 部署 | Google Cloud Run 或 Cloud Functions |

---

## 七、Rich Menu 與動態切換

- **學員選單**：預約、查詢預約、我的堂數、使用說明
- **教練選單**：審核、查詢今日、查詢明日、扣課/加課(LIFF)、學員明細(LIFF)、休假設定(LIFF)、使用說明

流程：`follow` 時依 `users.role` 或 `coach_whitelist` 設定對應 Rich Menu。
