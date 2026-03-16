# 高爾夫預約系統 v2

LINE + LIFF + Firebase Firestore + Serverless

## 快速開始

1. 複製 `.env.example` 為 `.env`，填入 LINE 與 Firebase 設定
2. 將 `serviceAccountKey.json` 放在專案根目錄
3. 執行：`npm install && npm run dev`

## 環境變數

| 變數 | 說明 |
|------|------|
| LINE_CHANNEL_ACCESS_TOKEN | LINE 頻道存取權杖 |
| LINE_CHANNEL_SECRET | LINE 頻道密鑰 |
| COACH_LINE_USER_IDS | 教練 LINE userId，逗號分隔 |
| CRON_SECRET | Cron 呼叫密鑰 |
| GOOGLE_APPLICATION_CREDENTIALS | Firebase 服務帳號 JSON 路徑 |

## API Endpoints

- `POST /webhook` - LINE Webhook
- `GET /health` - 健康檢查
- `POST /api/cron/reminders` - 明日提醒（Cloud Scheduler）
- `POST /api/cron/expiry` - 到期提醒（Cloud Scheduler）
- `POST /api/cron/coach-digest` - 教練行程彙整（Cloud Scheduler）
- `GET/POST /api/liff/*` - 教練 LIFF API

## 部署

部署至 Google Cloud Run 後，在 Cloud Scheduler 建立三個排程：

- 每日 21:00 呼叫 `POST /api/cron/reminders`
- 每日 08:00 呼叫 `POST /api/cron/expiry`
- 每日 21:00 呼叫 `POST /api/cron/coach-digest`

Header 需帶 `X-Cron-Secret: <CRON_SECRET>`
