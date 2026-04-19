# 多租戶架構重構實施計畫

> 目標：把「一個教練一套部署」改為「一套部署 N 個教練」，支援 30-50 個教練規模，每位教練上線 <10 分鐘。

---

## 目標與成功標準

- **成本**：總月費從 $30-750（取決於是否開 min-instance）降到 $15 固定
- **上線時間**：每位新教練 <10 分鐘，且流程可交給助理
- **品牌**：每位教練可自訂名稱，選配 logo
- **零停機遷移**：現有 `aebcd` 教練不中斷服務
- **可回滾**：任何階段出問題能在 5 分鐘內切回舊版
- **安全**：通過惡性同業攻擊想定（DoS、釣魚、資料竊取、法律檢舉）

---

## Phase 0：前置作業（法律、安全、基礎設施）—— 1-2 天

**這些必須在 Phase 1 開工前完成**，否則上線後就是法律風險 + 安全破口。

### 0.1 法律文件（委託律師）

**必備文件：**
- **服務條款（Terms of Service）** — 教練使用條款：付費方式、SLA、資料所有權、轉讓、退費
- **隱私政策（Privacy Policy）** — 收集哪些資料、怎麼用、保留多久、第三方分享、個資法合規
- **Cookie 政策** — landing page 如有 GA 等追蹤
- **個資法指定管理人** — 台灣《個人資料保護法》要求營利機構指定管理人
- **學員同意條款** — 學員首次加 LINE Bot 時彈出，同意才能用

**費用**：律師諮詢 + 文件起草 ~$15,000-30,000 NTD（一次性）

**放置位置：**
- `chengzhu.co/terms`、`chengzhu.co/privacy` 公開頁
- 每個 LIFF 頁腳連結
- 學員 follow bot 時第一則訊息附同意連結
- 教練簽約時附完整條款

### 0.2 帳號安全強化

- **Google Workspace（chengzhu.co）所有帳號強制 2FA**
  - Google Admin → Security → 2-Step Verification → Enforcement = On
  - 建議啟用 **Advanced Protection Program**（Sam 和敏感角色）
- **Sam 和助理的 LINE 個人帳號**
  - 強制開「使用 LINE 時需驗證 PIN」
  - 關閉「允許其他裝置登入」或設白名單
- **硬體 key（YubiKey）建議給 Sam**
  - 成本 ~$1,500 NTD/個
  - 防網路釣魚的最強手段
- **GCP IAM 審計**
  - 定期（每月）Review 誰有 Owner / Editor 權限
  - 離職帳號立即 revoke

### 0.3 Service Account Key 清理

- [ ] git log 檢查有無誤 commit `serviceAccountKey.json`（如有需重寫歷史或 rotate）
- [ ] 本地刪除 `serviceAccountKey.json`
- [ ] `.gitignore` 確認包含 `serviceAccountKey.json`、`*.json`（SA key 模式）、`.env`
- [ ] 所有 code 改用 `admin.credential.applicationDefault()`
- [ ] Cloud Run 綁定專屬 SA：`cloud-run-sa@xxx.iam`，不給 Owner 權限
- [ ] 本地改用 `gcloud auth application-default login`

### 0.4 Google Workspace 設定

申請 chengzhu.co Workspace 並建立：
- `sam@chengzhu.co`（Owner）
- `assistant@chengzhu.co`（Editor，限定權限）
- `noreply@chengzhu.co`（Resend sender）
- `support@chengzhu.co`（教練客服）
- `security@chengzhu.co`（DMARC 收 report 用）

### 0.5 Email 認證設定（DKIM、SPF、DMARC）

- **SPF**：DNS 加 TXT record 授權 Resend 發信
- **DKIM**：Resend 自動產 key，DNS 加 CNAME
- **DMARC**：DNS 加 TXT，**policy 直接設 `reject`**（假冒你的信直接退回）
  ```
  v=DMARC1; p=reject; rua=mailto:security@chengzhu.co;
  ```
- **BIMI**（選配）：在收件者 email 客戶端顯示品牌 logo

### 0.6 商標與網域保護

- [ ] 台灣商標註冊「chengzhu」+ 中文品牌（經濟部智慧財產局，~$3,000 NTD）
- [ ] **防禦性網域註冊**（每個 $300-500 NTD/年）：
  - chengzhu.com
  - chengzhu.tw
  - chengzhu.com.tw
  - chengzhu-support.co（防釣魚常見拼法）
  - chengzhugolf.com
- [ ] 全部轉址到 chengzhu.co（或顯示「官方網址」指引）

### 0.7 GCP 預算防護

- GCP Billing → Budgets → Create Budget
  - 月預算 $50 USD
  - Alert 50% / 90% / 100% / 120%
  - 通知 security@chengzhu.co
- Firestore Read Quota alert：每天 > 40k reads 發通知
- Cloud Run invocation alert：單日 > 預期量 3 倍發通知
- **設 Pub/Sub 自動回應**（進階）：budget 120% 時自動關閉非核心 service

### ✅ Phase 0 驗收
- [ ] 服務條款、隱私政策上線並連結到 LIFF 頁腳
- [ ] Google Workspace 全員 2FA
- [ ] `serviceAccountKey.json` 完全從本地和 repo 清除
- [ ] Cloud Run 使用 ADC 而非 SA Key
- [ ] DMARC `p=reject` 生效（用 [mail-tester.com](https://mail-tester.com) 驗證）
- [ ] 商標送件、防禦網域註冊完成
- [ ] GCP Budget Alert 測試過

---

## 架構對比

### 現況（單租戶）
```
[教練 A LINE] → [Cloud Run A] → [Firestore A] → [Firebase Hosting A]
[教練 B LINE] → [Cloud Run B] → [Firestore B] → [Firebase Hosting B]
[教練 C LINE] → [Cloud Run C] → [Firestore C] → [Firebase Hosting C]
... × 50
```

### 目標（多租戶）
```
[教練 A LINE] ─┐
[教練 B LINE] ─┼→ [單一 Cloud Run] → [單一 Firestore（coachId 分區）] → [單一 Firebase Hosting]
[教練 C LINE] ─┤     ↑
...          ─┘  從 /webhook/:coachId
               從 Firestore 讀對應 channelSecret
```

---

## 資料模型變更

### 新增 collection：`coaches`
```
coaches/{coachId} {
  name: string                    // 「Kinyo 高爾夫教室」
  slug: string                    // URL 用，e.g. "kinyo"
  status: 'active' | 'suspended' | 'deleting'   // 停權機制
  deletedAt: Timestamp | null     // deleting 時記錄時間，30 天後清除
  ownerLineUserIds: string[]      // 可能多教練共管
  line: {
    // ⚠️ 只存 Secret Manager reference，不存明文 token/secret
    channelAccessTokenRef: string // 例: 'projects/xxx/secrets/coach-kinyo-token/versions/latest'
    channelSecretRef: string      // 例: 'projects/xxx/secrets/coach-kinyo-secret/versions/latest'
    liffCoachId: string           // LIFF ID 不敏感，可明文
    liffStudentId: string
  }
  branding: {
    displayName: string           // 歡迎訊息裡的名字
    logoUrl: string | null        // Firebase Storage URL
    primaryColor: string | null   // UI 主色
  }
  settings: {
    timezone: string              // 預設 'Asia/Taipei'
    businessHours: { start: number, end: number }
    locations: { name: string, url: string }[]
    services: { name: string, hours: number }[]
  }
  flags: {                        // Feature flags
    [key: string]: boolean
  }
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### 所有業務資料 → Subcollection under `coaches/{coachId}/`

**架構決定：全部資料搬進 subcollection，不用 root-level + coachId 欄位**

```
coaches/{coachId}/users/{lineUserId}
coaches/{coachId}/coach_whitelist/{lineUserId}
coaches/{coachId}/packages/{packageId}
coaches/{coachId}/credit_transactions/{txId}
coaches/{coachId}/bookings/{bookingId}
coaches/{coachId}/waitlists/{waitlistId}
coaches/{coachId}/notifications_log/{logId}
coaches/{coachId}/coach_leaves/{leaveId}
coaches/{coachId}/fixed_schedules/{scheduleId}
coaches/{coachId}/fixed_schedule_exceptions/{exceptionId}
```

**理由：**
- Firestore Rules 一條規則就能擋：`match /coaches/{coachId}/{document=**}`
- 查詢 path 強制帶 coachId，**忘記 filter 的 bug 不可能寫出來**
- 同一個 LINE User 在多教練下自動獨立，不會互相覆蓋
- Collection Group Query 仍可用（需要時）

### 複合索引（每個 subcollection 各自需要）

| Subcollection | 索引 |
|---|---|
| `bookings` | `(bookingDate, status)`、`(userId, bookingDate)` |
| `packages` | `(userId, status)`、`(status, validTo)` |
| `credit_transactions` | `(userId, createdAt desc)` |
| `notifications_log` | `(userId, type, sentAt)` |
| `coach_leaves` | `(startDate, endDate)` |
| `fixed_schedules` | `(weekday, enabled)` |

因為 path 已經帶 coachId，**不需要**再 filter coachId — 索引裡也不需要 coachId 欄位。

### 跨租戶考量
- **同一個 LINE User 是多個教練的學員**：自動處理，各 `coaches/{coachId}/users/{lineUserId}` 獨立 doc
- **教練本人同時用多個 coach 帳號**：在各 `coaches/{coachId}.ownerLineUserIds` 列入即可

---

## Phase 1：資料模型重構（2 天）

### 1.1 建立型別與 helper
**新增檔案：**
- `src/types/coach.ts` — Coach config 型別
- `src/services/coach.ts` — `getCoachConfig(coachId)`、`listCoaches()`、`updateCoach()`、`getCoachLineToken(coachId)`（從 Secret Manager 讀）
- `src/services/secrets.ts` — **Secret Manager wrapper，含 5 分鐘 in-memory cache**
- `src/middleware/coachContext.ts` — Fastify plugin，從 request 解析 coachId 注入 `req.coachId`
- `src/utils/firestore-helpers.ts` — `coachDb(coachId)` 回傳該 coach 的 subcollection refs

```ts
// src/utils/firestore-helpers.ts 範例
export function coachDb(coachId: string) {
  const base = getDb().collection('coaches').doc(coachId);
  return {
    users: base.collection('users'),
    bookings: base.collection('bookings'),
    packages: base.collection('packages'),
    // ... 其他 subcollection
  };
}
```

所有 service 改用 `coachDb(coachId).bookings.where(...)` 而不是 `getDb().collection('bookings').where('coachId', '==', coachId)`。

### 1.2 改寫所有 service
每個 service 的函式簽章加 `coachId: string` 參數：

**[src/services/booking.ts](rebuild/src/services/booking.ts)**（8 個查詢）
- `getBookingsByDate(coachId, date)`
- `getBookingsByDateRange(coachId, from, to)`
- `getApprovedBookingsForTomorrow(coachId)`
- `getSlotStatuses(coachId, date)`
- `getBookingsByUser(coachId, userId, from?)`
- `createBooking(coachId, ...)`
- `cancelBooking(coachId, bookingId)`
- `rejectBooking(coachId, bookingId)`

**[src/services/package.ts](rebuild/src/services/package.ts)**（5+ 個查詢）
- `getActivePackages(coachId, userId)`
- `addCredits(coachId, userId, ...)`
- `deductCredits(coachId, userId, ...)`
- `getPackagesExpiringWithinDays(coachId, days)`
- `getAllPackagesForRevenue(coachId, month)`

**[src/services/coachLeave.ts](rebuild/src/services/coachLeave.ts)**（3 個查詢）
- `getAllLeaves(coachId)` / `listLeaves(coachId)`
- `getBlockedSlots(coachId, date)`
- `isSlotBlocked(coachId, date, time)`

**[src/services/fixedSchedule.ts](rebuild/src/services/fixedSchedule.ts)**（4 個查詢）
- `listFixedSchedules(coachId)`
- `getFixedSessionsOnDate(coachId, date)`
- `getFixedSessionsByDateRange(coachId, from, to)`
- `getExceptions(coachId, date)`

**[src/services/notification.ts](rebuild/src/services/notification.ts)**（10+ 個查詢）
- 所有 `hasSent/logSent` 加 coachId
- `sendCoachDigest(coachId)`
- `pushMessage` 改用 coach-specific `channelAccessToken`（從 coach config 讀）

**[src/services/waitlist.ts](rebuild/src/services/waitlist.ts)**、**[src/services/user.ts](rebuild/src/services/user.ts)** 同理

### 1.3 Security Rules（Firestore）
**新增檔案：`firestore.rules`**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 全部 deny，只准 Admin SDK 存取
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```
部署：`firebase deploy --only firestore:rules`

### 1.4 複合索引
**新增檔案：`firestore.indexes.json`** — 各 subcollection 索引
部署：`firebase deploy --only firestore:indexes`
⚠️ **要在 deploy code 之前先建 index**，不然查詢會失敗

### 1.5 Secret Manager 整合
**新增步驟：**
1. 啟用 Secret Manager API：`gcloud services enable secretmanager.googleapis.com`
2. Cloud Run SA 加權限：`roles/secretmanager.secretAccessor`
3. 為現有 `aebcd` 教練建 secret：
   ```
   echo -n "$TOKEN" | gcloud secrets create coach-aebcd-line-token --data-file=-
   echo -n "$SECRET" | gcloud secrets create coach-aebcd-line-secret --data-file=-
   ```
4. 寫入 `coaches/aebcd.line.channelAccessTokenRef` = `projects/XXX/secrets/coach-aebcd-line-token/versions/latest`

**實作：`src/services/secrets.ts`**
- 用 `@google-cloud/secret-manager` SDK
- **5 分鐘 in-memory cache**（避免每個 webhook 都打 API）
- Cache key 用 secret name；如果 version 是 `latest` 就自動重新取

### 1.6 Firestore 備份設定
**PITR（Point-in-Time Recovery）：**
```
gcloud firestore databases update --database=(default) --enable-pitr
```

**Scheduled Export → GCS：**
```
gcloud scheduler jobs create http firestore-daily-backup \
  --schedule="0 3 * * *" \
  --uri="https://firestore.googleapis.com/v1/projects/XXX/databases/(default):exportDocuments" \
  --http-method=POST \
  --message-body='{"outputUriPrefix":"gs://XXX-firestore-backups/$(date +%Y%m%d)"}' \
  --oauth-service-account-email=...
```

**GCS bucket 設定：**
- Storage class: **Nearline**（便宜 + 合理存取速度）
- Lifecycle rule: 90 天後自動刪除
- Versioning: Off（每次 export 都是獨立資料夾）

### 1.7 冪等 migration script（搬到 subcollection）
**新增檔案：`scripts/migrate-to-subcollections.js`**
```
用法：node scripts/migrate-to-subcollections.js --coachId=aebcd --dry-run
```
- 讀取 root-level `bookings`、`packages` 等所有現有 collection
- 寫入 `coaches/aebcd/bookings/{原 docId}`、`coaches/aebcd/packages/{原 docId}` 等
- **保留原 docId**，避免外部連結失效
- 冪等：已存在就跳過
- 完成後**不立刻刪除**原 collection，留給雙寫期（Phase 2 結束再刪）

### 1.8 單元測試
**新增：`tests/services/*.test.ts`**
- 每個 service 至少 1 個測試：建 2 個測試 coach，各插入資料，驗證只能取到自己的
- **特別針對 `credit_transactions` 寫 audit 測試**：扣堂/加堂後，對應紀錄必須存在

### ✅ Phase 1 驗收
- [ ] 全部 service 函式改用 `coachDb(coachId)` 取 subcollection refs
- [ ] `migrate-to-subcollections.js` 在 staging 跑過，所有舊 doc 已搬入 `coaches/aebcd/...`
- [ ] Firestore rules 部署，直連 Firestore 會被拒
- [ ] Secret Manager 有 `aebcd` 的 2 個 secret，code 能讀到
- [ ] PITR 啟用，GCS 備份排程跑起來
- [ ] 租戶隔離單元測試通過

---

## Phase 2：Webhook 路由 + 多租戶識別（0.5 天）

### 2.1 Webhook 改為 per-coach 路徑
**修改：[src/routes/webhook.ts](rebuild/src/routes/webhook.ts:13)**
- `POST /webhook` → `POST /webhook/:coachId`
- 從 Firestore 讀 `coaches/{coachId}.line.channelSecret` 驗簽
- 把 `coachId` 注入到 `req.coachId`

### 2.2 LIFF API middleware
**修改：[src/routes/liff.ts](rebuild/src/routes/liff.ts:27)**
- 所有 `/api/liff/*` 加 header `X-Coach-Id` 或 query `?coachId=xxx`
- Middleware 驗證 coachId 存在且 LIFF 的 userId 屬於該 coach
- 如果可以，**用 LIFF ID Token 驗證**（前端 `liff.getIDToken()`）而不是只靠 userId

### 2.3 Cron → Cloud Tasks fan-out

**不用 for-loop，改用 Cloud Tasks dispatcher pattern。**

**架構：**
```
Cloud Scheduler (6 個 job)
  ↓ 定時觸發
POST /api/cron/reminders (dispatcher)
  ↓ 列舉所有 status='active' 的 coach
  ↓ 為每個 coach 建一個 Cloud Task
POST /api/cron/internal/reminders?coachId=xxx (worker)
  ↓ 只處理這個 coach 的 reminders
```

**新增：**
- Cloud Tasks queue：`golf-coach-cron`（`max_dispatches_per_second=10` 避免撞 LINE API）
- `src/services/cloudTasks.ts` — `dispatchTask(queue, url, payload)` wrapper
- 每個現有 `/api/cron/:type` 拆成：
  - **dispatcher**（`/api/cron/:type`）：Cloud Scheduler 打這裡
  - **worker**（`/api/cron/internal/:type`）：Cloud Tasks 打這裡，處理單 coach

**worker endpoint 驗證：**
- 加 middleware 檢查 `X-CloudTasks-QueueName` header（Google 簽過的 header，無法偽造）
- 避免外部直接打 internal endpoint

**優點：**
- 單 coach 失敗不影響其他（Cloud Tasks 自動 retry）
- 自動平行（Cloud Run auto-scale）
- 自動 rate limit
- 單 cron 執行時間不會超時（dispatcher 只做列舉 + dispatch，<5 秒）

**成本**：每月 100 萬 tasks 免費，預估用量 ~9000/月 → **$0**

### 2.4 關鍵原則：`coachId` 絕不從 client 端 request body 讀
- **Webhook**：從 URL path `:coachId` + 用該 coach 的 secret 驗簽成功代表合法
- **LIFF**：驗證 LIFF ID Token（`liff.getIDToken()`），從 token 的 audience claim 反查 coachId
- **Cron worker**：從 `X-CloudTasks-QueueName` 驗證是 Google 打來的，query `?coachId=xxx` 才信任
- **其他 internal API**：一律從 `req.coachId`（middleware 注入），不從 body

### 2.5 教練 status 檢查 middleware
**新增：`src/middleware/coachStatus.ts`**
- 讀 `coaches/{coachId}.status`
- `suspended`：webhook return 200 但不處理；LIFF API return 503「服務暫停」
- `deleting`：一律 404
- `active`：放行

### 2.6 DoS / DDoS 防護

**為什麼重要**：沒防護 = 同業寫腳本灌 100 萬 req，你月費從 $35 飆到 $1,000+。

**多層防線：**

**Layer 1 — Cloud Armor（GCP WAF）**
- 在 Cloud Run 前面加 HTTPS Load Balancer + Cloud Armor
- 免費 tier：每月 2000 萬 req 內免費
- Rule 設定：
  - Per IP rate limit：60 req/min
  - 超過 rate limit 直接 429 return
  - 已知惡意 IP（Google Threat Intelligence）直接擋

**Layer 2 — 應用層 rate limit**
- **`/webhook/:coachId`**：
  - 未知 coachId → 立刻 return 404，**不記 log**（省 Cloud Logging 費用）
  - 已知 coachId 但驗簽失敗 → 記 audit log（可能是攻擊），然後 return 200（LINE 不在意）
  - 單一 coachId 每秒 > 10 req → 429
- **`/api/liff/*`**：
  - 需 LIFF ID Token 才放行（防未授權存取）
  - 單一 lineUserId 每分鐘 > 60 req → 429
- **`/api/signup/*`** 最嚴格：
  - 單一 IP 每小時 > 5 req → 429
  - 配合 Cloudflare Turnstile 驗證（免費）

**Layer 3 — Cloud Run 硬上限**
- `max-instances=20`（即使流量爆也不會無限 scale）
- `concurrency=80`
- `timeout=60s`（避免慢 request 佔 slot）
- 達上限後新 request 會排隊或 503，但**月費有天花板**

**Layer 4 — Firestore 配額監控**
- Cloud Monitoring 設 alert：`firestore.googleapis.com/document/read_count` 暴增時發通知
- 自訂 budget：單日 reads > 預估 3 倍 → 自動觸發 Cloud Function 暫時停用 webhook（極端保護）

### 2.7 LINE Push Rate Limit（保護教練的錢包）

**攻擊情境**：同業對某教練的 webhook 灌訊息，Bot 自動回覆 → 超過 LINE 免費 500 通/月 → 教練要付 $799。

**防護機制：**

**Per-user 限流（per coach）**
- 同一 `lineUserId` 每分鐘最多收 3 則 push（非緊急）
- 同一 `lineUserId` 每小時最多收 10 則
- 超過 → 累積成 digest 訊息，下次合併發

**Per-coach 月度配額追蹤**
- `coaches/{coachId}.monthlyPushCount`（每月 1 號重置）
- 達 400 通（80% warning）→ Email 警告教練
- 達 480 通（96%）→ 自動暫停非緊急 push（只保留預約通知、提醒）
- 達 500 通（100%）→ 全停，需教練自己升級 LINE 方案

**分類 push：**
| 類別 | 範例 | 配額爆了還發？ |
|---|---|---|
| 🔴 緊急 | 預約成功/失敗 | 發 |
| 🟡 例行 | 課前 1 天提醒 | 發 |
| 🟢 次要 | 堂數警告、月報 | **停，改 Email** |

**UI：LIFF 顯示當月已用量**
- 教練後台首頁顯示：「本月已發送 123/500 則」
- 給教練決策感（知道自己的成本）

### ✅ Phase 2 驗收
- [ ] Webhook 從 URL path 取 coachId，用 Secret Manager 讀對應 secret 驗簽
- [ ] 用教練 A 的 userId + 教練 B 的 coachId 打 API → 403
- [ ] Cloud Tasks queue 設定好，dispatcher + worker endpoint 分離
- [ ] 6 個 cron 透過 Cloud Tasks fan-out，每個 coach 獨立失敗不相互影響
- [ ] 教練 status=suspended 時 webhook/LIFF 正確拒絕
- [ ] Cloud Armor rate limit 生效，wrk 壓測 100 req/s 會被擋
- [ ] 未知 coachId 打 webhook return 404 且不記 log
- [ ] LINE push 計數器正確、超額自動降級

---

## Phase 3：教練設定存 Firestore + 前端讀取（0.5 天）

### 3.1 移除 env 依賴，改讀 Firestore
**修改：[src/config/env.ts](rebuild/src/config/env.ts)**
- 刪除 `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`、`LIFF_*`、`COACH_LINE_USER_IDS`（這些變 per-coach）
- 保留：`CRON_SECRET`、`GOOGLE_APPLICATION_CREDENTIALS`、`FIREBASE_STORAGE_BUCKET`

**修改：[src/config/firebase.ts:6](rebuild/src/config/firebase.ts:6)**
- `STORAGE_BUCKET` 改從 env 讀

### 3.2 `isCoach` 改為 per-coach 查詢
**修改：[src/services/line.ts](rebuild/src/services/line.ts)**
- `isCoach(userId, coachId)` → 查 `coaches/{coachId}.ownerLineUserIds`
- 所有呼叫點都要補 coachId

### 3.3 前端動態讀取設定
**新增 API：`GET /api/liff/coach-config?coachId=xxx`**
- 回傳 `{ name, displayName, logoUrl, primaryColor, liffId }`（不回傳 token/secret）

**修改：[liff/coach/index.html](rebuild/liff/coach/index.html:32)**、**[liff/student/index.html](rebuild/liff/student/index.html:33)**
- 從 URL query `?coach=xxx` 或 hostname 推導 coachId
- 啟動時打 `/api/liff/coach-config` 取得設定
- 動態塞入標題、logo、LIFF ID

### 3.4 移除硬編碼字串
**修改：[src/handlers/webhook.ts](rebuild/src/handlers/webhook.ts)** 第 281, 313, 316 行
- `'高爾夫預約系統'` → `coachConfig.branding.displayName`

**修改：[src/services/notification.ts:19](rebuild/src/services/notification.ts:19)** 等
- `'Asia/Taipei'` → `coachConfig.settings.timezone`

**修改：[src/utils/constants.ts](rebuild/src/utils/constants.ts)**
- 刪除整個 `LOCATION_MAP`、`SERVICE_DURATION`、`BUSINESS_HOURS`
- 改為從 `coachConfig.settings` 讀

### ✅ Phase 3 驗收
- [ ] 沒有任何硬編碼「高爾夫」、「Asia/Taipei」、地點名稱
- [ ] 前端載入時顯示正確的教練名稱/logo
- [ ] env.production.yaml 只剩 `CRON_SECRET` 和 `FIREBASE_STORAGE_BUCKET`

---

## Phase 4：`add-coach` 自動化腳本（1 天）

### 4.1 腳本介面
**新增：`scripts/add-coach.js`**
```bash
node scripts/add-coach.js \
  --name="Kinyo 高爾夫教室" \
  --slug="kinyo" \
  --line-token="xxx" \
  --line-secret="yyy" \
  --owner-line-id="U1234..." \
  --logo="./logos/kinyo.png"   # 選配
```

互動模式（沒帶參數）：逐題問。

### 4.2 腳本做的事
1. **驗證 LINE token 有效**：打 `https://api.line.me/v2/bot/info` 成功才繼續
2. **建立 2 個 LIFF app**：呼叫 [LINE Messaging API `POST /liff`](https://developers.line.biz/en/reference/messaging-api/#create-liff-app)
   - 教練：`{ view: { type: 'full', url: 'https://{host}/coach/index.html?coach={slug}' } }`
   - 學員：同上，換成 student
3. **設定 Webhook URL**：呼叫 `PUT /v2/bot/channel/webhook/endpoint`
   - URL: `https://{cloud-run-host}/webhook/{coachId}`
4. **啟用 Webhook**：`PUT /v2/bot/channel/webhook/use`
5. **上傳 logo**（如果有）到 Firebase Storage
6. **生成 Rich Menu 圖片**：跑 [generate-richmenu-images.py](rebuild/scripts/generate-richmenu-images.py) 帶 logo 參數
7. **上傳 Rich Menu**：複用 [setup-rich-menus.js](rebuild/scripts/setup-rich-menus.js) 邏輯
8. **寫入 Firestore `coaches/{coachId}`**
9. **輸出**：
   ```
   ✅ 教練「Kinyo 高爾夫教室」設定完成
   coachId: kinyo-a1b2c3
   請到 LINE Developers Console 確認以下項目：
     Webhook URL: https://api.golf-coach.com/webhook/kinyo-a1b2c3  ← 已自動設定
     驗證 Webhook：點 Verify 按鈕
   LIFF URLs 已自動綁定，不用手動設定。
   ```

### 4.3 錯誤恢復
- 每一步都是冪等的：跑到一半失敗，修好後重跑不會建重複
- 先寫 `coaches/{coachId}.status = 'provisioning'`，全部成功後改 `'active'`
- 失敗時保留 doc 供除錯，下次跑自動接續

### ✅ Phase 4 驗收
- [ ] 助理按 README 成功新增一個測試教練
- [ ] 全部過程 <10 分鐘
- [ ] Rich Menu、Webhook、LIFF 都自動綁好

---

## Phase 5：Logo 與品牌客製（0.5 天，選配）

### 5.1 Logo 上傳
- 助理把 logo PNG 放到 `scripts/logos/{slug}.png`
- `add-coach.js` 自動上傳到 `gs://{bucket}/coaches/{coachId}/logo.png`

### 5.2 Rich Menu 帶 logo
**修改：[scripts/generate-richmenu-images.py](rebuild/scripts/generate-richmenu-images.py)**
- 加 `--logo` 參數
- 把 logo 貼到 Rich Menu 背景左上角

### 5.3 LIFF 頁面顯示
- 前端 `<img src="{coachConfig.logoUrl}">` 在 header
- 沒有 logo 時顯示文字名稱

---

## Phase 6：教練停權與刪除流程（0.5 天）

### 6.1 Status 機制
`coaches/{coachId}.status`:

| Status | Webhook | Cron | LIFF | 資料狀態 |
|---|---|---|---|---|
| `active` | 正常處理 | 正常排程 | 正常顯示 | 完整 |
| `suspended` | return 200 不處理 | dispatcher 跳過 | 503「服務暫停」 | 完整保留 |
| `deleting` | return 200 不處理 | 跳過 | 404 | 30 天後清除 |

Middleware 在 Phase 2.5 已實作。

### 6.2 管理腳本

**`scripts/suspend-coach.js <coachId>`** — 立刻停用
- 更新 `coaches/{coachId}.status = 'suspended'`
- 不刪除資料
- 不動 LINE Channel（教練方還是能從 LINE Console 看到）

**`scripts/reactivate-coach.js <coachId>`** — 恢復
- `status = 'active'`

**`scripts/delete-coach.js <coachId>`** — 標記刪除
- `status = 'deleting'`
- `deletedAt = now()`
- 刪除 LIFF apps（呼叫 LINE API）
- 刪除 Secret Manager secrets（destroy，不是 disable）
- 從 LINE channel 解除 rich menu 綁定
- 資料**先不刪**，等 30 天保留期

**`scripts/purge-deleted-coaches.js`** — Cron 每日跑
- 列舉 `status='deleting' && deletedAt < now() - 30 days`
- 遞迴刪除 `coaches/{coachId}/*` 所有 subcollection docs
- 刪除 logo 等 Storage 檔案
- 刪除 `coaches/{coachId}` doc 本身

### 6.3 資料匯出（個資法合規）
**新增：`scripts/export-coach-data.js <coachId>`**
- 把該 coach 所有 subcollection 匯出成 JSON
- 輸出到 `exports/{coachId}-{timestamp}.json`
- 教練要離開時，能交給他完整資料

### ✅ Phase 6 驗收
- [ ] 停權的教練 webhook 收到訊息不爆錯但也不處理
- [ ] 停權的教練 LIFF 顯示「服務暫停」
- [ ] 刪除流程能完整清除該教練所有 Firestore / Storage / Secret Manager / LIFF / Rich Menu 資源
- [ ] 30 天保留期內還能 reactivate

---

## Phase 7：教練自助 Onboarding 流程（1.5 天）

### 整體流程
```
教練詢問
  ↓
寄「售前申請表 A」連結
  ↓
教練填 → Sam 收到 LINE 通知
  ↓
Sam 聯繫、簡報、收款（線下/實體，不走系統）
  ↓
Sam 寄「設定表單 B」連結
  ↓
教練預約遠端協助 OR 實體拜訪時間
  ↓
Sam/助理協助教練建立 LINE Bot（視訊 / 現場）
  ↓
教練當場填完設定表單 B
  ↓
Sam 在管理後台點「開通」→ 自動跑 add-coach 流程
  ↓
10 秒後教練收到上線通知（LINE + Email）
```

### 7.1 表單 A：售前申請表（Tally.so）
**欄位：**
- 教練姓名 / 品牌名稱
- Email、手機
- 教練 LINE User ID（附查詢教學）
- 目前學員數（範圍選項）
- 聽說管道（選擇題）
- 備註

**Webhook 目的地：** `POST /api/signup/inquire`

**新增 Firestore collection：`signup_inquiries/{id}`**（root-level）
```
{
  name, brandName, email, phone, lineUserId,
  studentCount, source, note,
  status: 'new' | 'contacted' | 'quoted' | 'paid' | 'configuring' | 'done' | 'dropped',
  createdAt, updatedAt,
  notes: [{ at, text, by }]   // Sam 跟進紀錄
}
```

**Anti-spam：Cloudflare Turnstile**（免費）防機器人灌水。

### 7.2 表單 B：設定表單（**自建，不走第三方**）

**為什麼不用 Tally.so：** 表單 B 會收 LINE Channel Access Token 這種**最敏感的憑證**。經第三方 = 信任第三方不被駭、不外洩、員工不作惡。自建才能真正保證資料只在你的 infrastructure 內流動。

**技術實作：**

**前端 — 公開 web 頁面（非 LIFF）：**
- 路徑：`https://chengzhu.co/apply?token={oneTimeToken}`
- 為何不是 LIFF：教練此時還沒加過你的 Bot，不適合用 LINE Login
- 一次性 token 機制：
  - Sam 在管理後台點「寄設定表單」→ 後端產生 UUID + 30 天期限
  - 存 `signup_tokens/{tokenId} { inquiryId, expiresAt, usedAt: null }`
  - Email 給教練帶 token 的連結
  - 教練打開 → 驗證 token 有效 → 顯示表單
  - 提交後 token 標記 `usedAt`，不能再用
- 頁面設計：
  - 多步驟表單（避免一次看到太多嚇到）
  - 進度儲存（localStorage）
  - 即時驗證欄位

**後端 API：`POST /api/signup/configure`**
- 驗證 `token` 有效
- **token/secret 收到後立刻寫 Secret Manager**（用程式碼產生 secret name）
- **Firestore 只存 reference**，原始值在記憶體處理完就丟掉
- 狀態進 `pending`，等 Sam 審核

**關鍵安全：**
- HTTPS only（Firebase Hosting 強制）
- Content-Security-Policy header 嚴格
- 表單 submit 限流（同 IP 每小時 3 次）
- 提交後 5 秒內即時 `/v2/bot/info` 驗證 token 有效（失敗就不存）

**新增 Firestore collection：`signup_applications/{id}`**
```
{
  inquiryId,            // 關聯到 signup_inquiries
  tokenId,              // 來自哪個 one-time token
  basic: { name, slug, email, phone },
  line: {
    userId,
    tokenRef,           // Secret Manager reference（如 projects/xxx/secrets/app-abc-token）
    secretRef,
    liffCoachId,
    liffStudentId,
    needsLiffCreation: boolean,
    tokenValidated: boolean   // 提交時即時驗證結果
  },
  settings: { locations, services, businessHours, timezone },
  branding: { logoUrl, primaryColor, welcomeMessage },
  legalConfirm: {
    agreedTerms: true,
    agreedTermsAt: Timestamp,
    paidReceiptNo: string
  },
  status: 'pending' | 'validating' | 'approved' | 'rejected',
  rejectReason?: string,
  approvedBy?: string,
  approvedAt?: Timestamp,
  createdAt, updatedAt
}
```

**新增 Firestore collection：`signup_tokens/{tokenId}`**（root-level）
- 30 天自動過期（用 TTL policy）
- 已用過 → `usedAt` 標記後無法重用

### 7.3 管理後台（**Google Workspace SSO，不走 LINE**）

**為什麼不走 LINE Login：** 管理後台是營運核心，LINE 帳號容易被盜、email 也可能變動，認證強度不夠。改用 Google Workspace SSO 才是真正安全的做法。

**技術實作：**

**前端 — 獨立 Next.js / 純 HTML SPA**
- 路徑：`https://admin.chengzhu.co`（獨立 subdomain，不放在 LIFF host 下）
- 首頁強制 Google OAuth 登入
- 只允許 `@chengzhu.co` domain 的帳號登入（hd=chengzhu.co 限制）
- 登入後 session 存 HttpOnly cookie（JWT），15 分鐘 idle timeout

**後端驗證：`src/middleware/adminAuth.ts`**
- 每個 `/api/admin/*` route 強制驗證：
  1. Google ID Token（JWKS 本地驗簽）
  2. Email domain = `chengzhu.co`
  3. Email 在 `admins` 白名單（環境變數 + Firestore）
- 不符合 → 403

**角色分級：**
```
admins/{email} {
  role: 'owner' | 'staff' | 'viewer',
  allowedActions: ['approve_coach', 'delete_coach', 'view_audit', ...]
}
```
- `sam@chengzhu.co` = owner，所有操作
- `assistant@chengzhu.co` = staff，可開通但不可刪除
- `support@chengzhu.co` = viewer，只讀

**敏感操作再驗證：**
- `delete-coach`、`refund` 等高風險操作：
  - 要求重新輸入 Google 密碼 或
  - 要求 Hardware key 觸碰（WebAuthn）
- 限 `owner` role 執行

**三個 tab：**
- **待聯繫**（`signup_inquiries` where status=new）
- **待開通**（`signup_applications` where status=pending）
- **已上線**（`coaches` where status=active）

**售前追蹤（inquiries）：**
- 每筆可點「已聯繫」/「已報價」/「已收款」/「已寄設定表單」/「放棄」
- 「已寄設定表單」會自動產生 one-time token 並寄 email 給教練（from noreply@chengzhu.co）
- 每筆可寫跟進備註（記到 `notes` array）

**售後開通（applications）：**
- 審核表單內容
- 顯示 token 驗證結果（提交時已即時驗過）
- 點「開通」→ `POST /api/admin/applications/:id/approve`
- 點「拒絕」→ 要求填原因，通知教練

**所有操作寫 audit_log：**
- 誰（Google email）、什麼時候、做了什麼、影響哪個 coach / application
- IP、User-Agent 也記錄
- 無法竄改（用 append-only + Firestore Trigger 自動寫）

### 7.4 自動開通 API

**`POST /api/admin/applications/:id/approve`（只有 sam@chengzhu.co 可呼叫）：**

1. 讀 `signup_applications/{id}`
2. 從 Secret Manager 讀 token，驗證 LINE `/v2/bot/info` 成功
3. 如果 `needsLiffCreation=true`，呼叫 LINE API 建 2 個 LIFF app
4. 呼叫 Phase 4 的 `add-coach` 核心邏輯（建 `coaches/{coachId}` doc、Rich Menu 等）
5. 狀態更新 `applications.status = 'approved'`
6. 關聯 inquiry 狀態更新為 `done`
7. 通知教練：
   - LINE push：「您的系統已上線，點這裡進入：{LIFF URL}」
   - Email（from noreply@chengzhu.co）：詳細操作指南

**冪等**：已開通的 application 再點一次不會建重複。

### 7.5 LINE Bot 建立協助流程（非自動化）

**選項 A：遠端協助**（預設）
- 教練付款後預約時段
- Sam / 助理用 Google Meet / LINE 視訊
- 螢幕分享指導教練自己操作
- 預估 20-30 分鐘
- 同時完成表單 B 填寫

**選項 B：實體拜訪**
- 適用大教室 / 有意願的 VIP 客戶
- Sam 親自到場
- 含產品教學，預估 1-1.5 小時
- 建立更強的信任關係（符合「比較專業」的定位）

**SOP 文件：`docs/onboarding-sop.md`**
- 視訊前準備檢查清單
- 逐步操作順序
- 常見卡關點 + 解法
- 事後給教練的教學 PDF 連結

**收費：**
- 買斷金 $15,000 已包含首次設定服務
- 後續重新設定（例如換 LINE 帳號）另收 $1,000/次

### 7.6 通知 Sam 的機制

新申請進來時：
- Firestore Trigger（Cloud Function）偵測新 doc
- 打 LINE push 給 Sam（用自己的 bot）：「📬 新申請：{教練名稱}，快去看」
- Email 備份通知

### ✅ Phase 7 驗收
- [ ] 表單 A（Tally.so）建立，無敏感資料
- [ ] 表單 B **自建**公開頁面，走 one-time token 認證
- [ ] Token/Secret 提交後即時驗證 LINE API，失敗不存
- [ ] Token/Secret 立刻搬到 Secret Manager，Firestore 只有 reference
- [ ] 管理後台走 **Google Workspace SSO**，限 `@chengzhu.co` 登入
- [ ] 角色分級（owner / staff / viewer）正確運作
- [ ] 敏感操作（delete、refund）需重新驗證
- [ ] 所有管理操作寫 audit_log
- [ ] 新申請觸發 LINE 通知給 Sam
- [ ] 遠端協助 SOP 文件完成
- [ ] 走過 1 次完整流程（假教練測試）<30 分鐘

---

## 風險管控機制（全程貫穿）

### A. Staging 環境
- **新增：第 2 個 Firebase 專案 `golf-coach-staging`**
- 部 `golf-coach-api-staging` Cloud Run service
- 每次 deploy 先進 staging，觀察 24-48 小時才進 production
- 成本：額外 ~$5/mo

### B. Canary deployment
- Cloud Run traffic splitting
- `gcloud run services update-traffic golf-coach-api --to-revisions=NEW=10,OLD=90`
- 階段：10% → 50% → 100%，每階段至少 30 分鐘
- Rollback 指令：`--to-revisions=OLD=100`

### C. Feature Flags
- `coaches/{coachId}.flags = { newBookingUI: true }`
- 先開給 1-2 個白老鼠教練
- 出事立刻關（不用重新 deploy）

### D. Monitoring
- **Cloud Monitoring Uptime Check**：每 1 分鐘 ping `/health`
- **Error Reporting Alert**：error rate >5% 發 Email
- **自訂 metric**：每個 coach 的 request 數、error 數
- **Structured log**：每筆 log 都要帶 `coachId` 欄位，用 Cloud Logging 就能 filter

### E. 整合測試（必寫）
**新增：`tests/integration/tenant-isolation.test.ts`**
- 建 2 個測試 coach（seed data）
- 用 coach A 的 context 試著讀 coach B 的資料 → 應失敗
- 跑在 CI 每次 PR 都驗

### F. LINE API 防護
- **Token 類型驗證**：`add-coach.js` 強制要求長期 token（驗證方式：查 `/v2/bot/info` 成功，但無法直接判斷期限；改為在 README 明確要求長期 token）
- **Rate limit 保護**：Cloud Tasks queue 設 `max_dispatches_per_second=10`，避免 cron fan-out 時撞 LINE API 上限
- **Webhook signature 驗證失敗**：記 log 並 return 200（LINE 不在意 status code），避免被列為無效 webhook
- **Secret 輪替機制**（選配）：`scripts/rotate-coach-secret.js <coachId> <new-token>` — 更新 Secret Manager 新版本

### G. Firestore 配額防護
- **寫入速率限制**：`notifications_log` 在 cron fan-out 時可能瞬間高寫入；用 `batch write`（最多 500 ops/batch）+ Cloud Tasks rate limit 分散
- **Index 部署時序**：永遠先 `firebase deploy --only firestore:indexes`，等建完才 deploy code
- **Read 配額監控**：Cloud Monitoring 設 alert，reads > 40k/day 時發通知（free tier 50k）

### H. 金流 audit trail
- 任何 `packages.credits` 變動都必須對應一筆 `credit_transactions`
- 用 Firestore Transaction 確保原子性
- 寫整合測試：故意讓扣堂在中途 throw，確認 `packages` 和 `credit_transactions` 要嘛都動、要嘛都不動

### I. 前端 code 保護（降低同業抄襲難度）

**原則**：敵方能看前端就能抄 UX，完全防不了，但可以提高門檻。

- **不輸出 source map 到 production**
  - Vite / esbuild build 加 `--sourcemap=hidden` 或直接關閉
- **Minify + 基本 obfuscate**
  - esbuild/Vite 預設會 minify（變數改短）
  - 進階用 `javascript-obfuscator` npm（變數亂碼、邏輯難讀）但會增加 bundle 大小 + 效能
  - **建議折衷**：預設 minify 即可，不過度 obfuscate
- **業務邏輯放後端**
  - 所有計算、驗證都在 API（前端只做顯示）
  - 前端 code 看起來像「殼」，抄了也沒用
- **API 路徑混淆（選配）**
  - 不要用 `/api/delete-booking` 這種明顯命名
  - 改 `/api/v1/b/delete` 增加解讀成本
  - 但**不是安全措施**（auth middleware 才是真正的防線）
- **Firebase config 不是 secret**
  - Firebase Web SDK 本來就需要 apiKey 在前端，這個**不是機密**
  - 真正的安全靠 Firestore Rules（已 deny-all）和後端 Auth middleware
- **防 DevTools 截圖**（不做）
  - 有些網站偵測到 DevTools 就擋，但會影響正常客服
  - 不值得做

### J. 合規與法律防線

- Phase 0 已處理 ToS / 隱私政策 / 個資法
- **資料外洩通報機制**：個資法規定外洩需 72 小時內通報主管機關
  - 準備 SOP 文件：誰負責、如何評估影響、範本通知書
- **學員匯出資料權利**：任何學員能要求匯出自己的資料（GDPR-like）
  - 做個 `/api/liff/my-data-export` endpoint（後續功能）
- **學員刪除權利**：學員退出時可要求刪除個資
  - 做 `/api/liff/delete-me` endpoint（後續功能）

---

## 遷移計畫（現有 aebcd 教練）

### Step 0：準備
- [ ] 在新的 staging 專案完整跑一遍 Phase 1-4
- [ ] 用測試 LINE 帳號模擬整個學員體驗
- [ ] 確認 migration script 冪等

### Step 1：資料加欄位（不停機）
- [ ] 跑 `scripts/migrate-add-coach-id.js --coachId=aebcd --dry-run`
- [ ] 確認預期筆數（bookings 幾筆、packages 幾筆等）
- [ ] 實際跑：`node scripts/migrate-add-coach-id.js --coachId=aebcd`
- [ ] 驗證：隨機抽 10 個 doc 確認 `coachId` 欄位存在

### Step 2：寫 `coaches/aebcd` doc
- [ ] 把現有 `env.production.yaml` 的值填入
- [ ] 把 `src/utils/constants.ts` 的 locations/services 搬進去
- [ ] 腳本：`node scripts/import-existing-coach.js aebcd`

### Step 3：Canary 部署新版
- [ ] 新版 code 部署但 0% 流量
- [ ] 10% 流量，觀察 30 分鐘（看 error rate、log）
- [ ] 50% 流量，觀察 30 分鐘
- [ ] 100% 流量
- [ ] 舊 revision 保留 7 天供 rollback

### Step 4：切換 Webhook URL
- [ ] LINE Console 把 webhook 從 `/webhook` 改為 `/webhook/aebcd`
- [ ] 點 Verify 測試

### Step 5：補跑 migration
- [ ] canary 期間可能有新資料沒 coachId
- [ ] 再跑一次 migration script

### Step 6：移除舊 webhook endpoint
- [ ] 確認 24 小時沒流量打 `/webhook`（沒帶 coachId）
- [ ] 刪除舊 route

---

## Rollback 計畫

| 情境 | Rollback 動作 | 耗時 |
|---|---|---|
| 新版 code 有 bug | `gcloud run services update-traffic --to-revisions=OLD=100` | <1 min |
| migration 加錯欄位 | 改 migration script 補正（冪等），重跑 | <5 min |
| security rules 擋住合法讀取 | `firebase deploy --only firestore:rules`（前一版） | <2 min |
| 某個教練上線爆炸 | `coaches/{coachId}.flags.disabled = true`，後端 middleware 擋 | <30 sec |

---

## 費用估算

### 多租戶架構月費（假設 50 個教練，中等流量）

| 項目 | 用量 | 費用 (USD) |
|---|---|---|
| Cloud Run (min-instance=1, max=20) | ~30 hr/day 實際運算 | $15 |
| **Cloud Load Balancer + Cloud Armor** | 基本 LB + WAF rules | $18 |
| Cloud Scheduler | 6 job（遠低於 free tier） | $0 |
| Cloud Tasks | ~9000 tasks/月（免費 100 萬） | $0 |
| Secret Manager | 50 coach × 2 secret = 100 active versions | $6 |
| Firestore | 共用 free tier（50k reads/day），預估超標 | $5-10 |
| Firestore PITR | ~5GB × 7 天 retention | $3 |
| GCS Firestore backup | Nearline 90 天保留，~15GB | $1 |
| Firebase Hosting (主站 + admin + apply) | 多個站點 | $0-5 |
| Cloud Storage (logos + videos) | ~50GB | $1 |
| Staging 環境 | min-instance=0 | $3 |
| **Google Workspace** (4 人 × Business Starter) | 外部服務 | $24 |
| **Resend** (email) | 免費 tier 夠用 | $0 |
| **網域 + 商標**（一次性攤提） | ~$500 NTD/年 ÷ 12 | $1 |
| **總計（月費）** | | **~$77/mo** |

對比單租戶 50 個部署的 $30-750/mo，仍然便宜很多。
每新增 1 教練增量成本：~$0.12（Secret Manager 2 個 secret）。

**一次性成本：**
- 律師文件：$15,000-30,000 NTD
- 商標註冊：~$3,000 NTD
- 防禦網域：~$3,000 NTD（10 個）
- YubiKey：~$1,500 NTD × 1-2 個

---

## 總工時估算

| Phase | 工時 | 說明 |
|---|---|---|
| **Phase 0：法律 + 安全基礎**（新） | 1-2 天 | 含律師諮詢等待期；技術 1 天 |
| Phase 1：資料模型重構 + Secret Manager + 備份 | 2.5 天 | 動最多程式碼 |
| Phase 2：Webhook 路由 + Cloud Tasks + DoS 防護 + LINE 限流 | 1.5 天 | 架構變動 + Cloud Armor |
| Phase 3：設定 Firestore 化 | 0.5 天 | 硬編碼抽出 |
| Phase 4：add-coach 腳本 | 1 天 | LINE API 整合 |
| Phase 5：Logo 客製 | 0.5 天 | 選配 |
| Phase 6：停權 / 刪除流程 | 0.5 天 | 4 個管理腳本 |
| Phase 7：自助 Onboarding（**自建表單 B + SSO 後台**） | 2 天 | 從 1.5 天增加到 2 天（改自建） |
| 遷移與驗證 | 0.5 天 | migration + canary |
| **總計** | **9.5-11 天** | 不含律師文件起草等待期 |

---

## 執行順序建議

**Phase 0（並行進行，最慢的時鐘）：**
- [ ] 委託律師起草 ToS + 隱私政策（2-4 週，找律師最耗時）
- [ ] 申請 Google Workspace（chengzhu.co）— 1 天
- [ ] 商標送件 + 網域註冊 — 1 天
- [ ] Service Account Key 清理 — 半天
- [ ] Resend 申請 + DMARC 設定 — 半天
- [ ] GCP Budget Alert 設定 — 1 小時

**技術實作（Phase 0 的技術部分完成後開工）：**
1. **Day 1-2**：Phase 1（資料模型 + Secret Manager + 備份 + 測試）
2. **Day 3-4 上午**：Phase 2（Webhook 路由 + Cloud Tasks + Cloud Armor + LINE 限流）
3. **Day 4 下午**：Phase 3（設定 Firestore 化）
4. **Day 5 上午**：用 staging 驗證 + 跑遷移 dry-run
5. **Day 5 下午**：Phase 4（add-coach 腳本）開始
6. **Day 6**：Phase 4 完成 + Phase 6（停權/刪除腳本）
7. **Day 7 上午**：現有教練遷移（canary）
8. **Day 7 下午**：Phase 5（logo 客製，選配）
9. **Day 8-9**：Phase 7（自助 Onboarding — 自建表單 + SSO 管理後台）
10. **Day 10 起**：開始量產 — 每位教練 <10 分鐘（技術）+ 20-30 分鐘（協助建 LINE Bot）

**關鍵依賴：**
- **律師文件要先啟動**（2-4 週交期），不然 Phase 0 卡住整個上線
- 技術 Phase 0 完成才能開 Phase 1
- Phase 7 的管理後台可以平行開發（不卡 Phase 1-6）
