# Cron API 規格（Cloud Scheduler 專用）

> 嚴禁在程式碼內使用 node-cron、setInterval 等常駐排程。
> 所有定時任務由 **Google Cloud Scheduler** 以 HTTP 呼叫下列 Endpoints。

---

## 安全驗證

所有 Cron Endpoints 必須驗證呼叫來源，建議方式：

1. **Header 密鑰**：`X-Cron-Secret: <環境變數 CRON_SECRET>`
2. **Cloud Scheduler OIDC**：若部署在 GCP，可設定 Cloud Scheduler 使用 OIDC Token，後端驗證 JWT。

---

## Endpoints

### 1. 預約前一天提醒學員

```
POST /api/cron/reminders
```

**功能**：查詢明日有「已核准」預約的學員，推播 LINE 提醒訊息。每筆預約僅提醒一次（依 `notifications_log` 防重複）。

**排程**：每日 21:00 (Asia/Taipei)

**Request**：
```
Headers:
  X-Cron-Secret: <CRON_SECRET>
  Content-Type: application/json
```

**Response**：
```json
{
  "ok": true,
  "sent": 5,
  "skipped": 0
}
```

---

### 2. 到期日前一個月提醒學員

```
POST /api/cron/expiry
```

**功能**：查詢 `validTo` 落在「今天起 30 天內」且 `remainingCredits > 0` 的 packages，推播提醒學員。每人每方案僅提醒一次。

**排程**：每日 08:00 (Asia/Taipei)

**Request**：同上

**Response**：
```json
{
  "ok": true,
  "sent": 3
}
```

---

### 3. 教練明日行程彙整

```
POST /api/cron/coach-digest
```

**功能**：彙整明日所有「已核准」預約，推播給教練（白名單中的 lineUserId）。

**排程**：每日 21:00 (Asia/Taipei)

**Request**：同上

**Response**：
```json
{
  "ok": true,
  "lessons": 4
}
```

---

## Cloud Scheduler 設定範例

| 工作名稱 | URL | 排程 (Cron) | 時區 |
|----------|-----|-------------|------|
| reminders | `https://your-service.run.app/api/cron/reminders` | `0 21 * * *` | Asia/Taipei |
| expiry | `https://your-service.run.app/api/cron/expiry` | `0 8 * * *` | Asia/Taipei |
| coach-digest | `https://your-service.run.app/api/cron/coach-digest` | `0 21 * * *` | Asia/Taipei |

**HTTP 方法**：POST  
**Headers**：`X-Cron-Secret: <你的密鑰>`
