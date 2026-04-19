# 高爾夫教練預約系統 — 新教練部署指南

## 前置準備

- [ ] [Node.js 20+](https://nodejs.org/)
- [ ] [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)（`gcloud` 指令）
- [ ] [Firebase CLI](https://firebase.google.com/docs/cli)（`npm install -g firebase-tools`）
- [ ] [Python 3](https://www.python.org/)（用於產生 Rich Menu 圖片，需安裝 Pillow：`pip install Pillow`）
- [ ] Google 帳號（Firebase + Cloud Run）
- [ ] LINE 帳號（LINE Developers Console）

---

## Step 1：建立 Firebase 專案

1. 前往 [Firebase Console](https://console.firebase.google.com/)
2. 建立新專案（例如 `golf-coach-xxx`）
3. 啟用 **Firestore Database**（位置選 `asia-east1`，模式選「正式環境」）
4. 啟用 **Hosting**
5. 到「專案設定」→「服務帳戶」→「產生新的私密金鑰」
6. 下載 JSON 檔案，重新命名為 `serviceAccountKey.json`，放到專案根目錄

---

## Step 2：建立 LINE 頻道

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 建立 Provider → 建立 **Messaging API** 頻道
3. 記下 **Channel Access Token** 和 **Channel Secret**
4. 建立 2 個 **LIFF** 應用程式：
   - 教練後台（Size: Full，Scope: profile）
   - 學員專區（Size: Full，Scope: profile）
5. 記下兩個 LIFF ID
6. 將「Use webhook」設為 Enabled

---

## Step 3：執行設定腳本

```bash
node scripts/setup-new-coach.js
```

腳本會互動式問你：
- Firebase 專案 ID
- LINE Token / Secret
- LIFF IDs
- 教練 LINE User ID
- 上課地點、課程類型、營業時間

完成後會自動寫入所有設定檔。

---

## Step 4：部署

```bash
# 登入 Google Cloud 和 Firebase
gcloud auth login
firebase login

# 一鍵部署
bash scripts/deploy.sh
```

部署完成後會顯示需要手動設定的項目。

---

## Step 5：設定 LINE Webhook URL

1. 到 LINE Developers Console → Messaging API
2. Webhook URL 填入：`https://你的CloudRun網址/webhook`
3. 點 Verify 測試

---

## Step 6：設定 LIFF Endpoint URL

1. 教練 LIFF → Endpoint URL：`https://你的專案ID.web.app/coach/index.html`
2. 學員 LIFF → Endpoint URL：`https://你的專案ID.web.app/student/index.html`

---

## Step 7：設定 Cloud Scheduler

到 [Cloud Scheduler](https://console.cloud.google.com/cloudscheduler) 建立以下排程：

| 名稱 | URL | 排程 | Method | Header |
|------|-----|------|--------|--------|
| reminders | `/api/cron/reminders` | `0 21 * * *` | POST | `X-Cron-Secret: 你的密碼` |
| expiry | `/api/cron/expiry` | `0 8 * * *` | POST | `X-Cron-Secret: 你的密碼` |
| coach-digest | `/api/cron/coach-digest` | `0 21 * * *` | POST | `X-Cron-Secret: 你的密碼` |
| low-credits | `/api/cron/low-credits` | `0 9 * * *` | POST | `X-Cron-Secret: 你的密碼` |
| inactive-reminders | `/api/cron/inactive-reminders` | `0 10 * * 1` | POST | `X-Cron-Secret: 你的密碼` |
| monthly-revenue | `/api/cron/monthly-revenue` | `0 9 1 * *` | POST | `X-Cron-Secret: 你的密碼` |

所有 URL 前面加上 Cloud Run 網址（例如 `https://golf-coach-api-xxx.asia-east1.run.app`）。

---

## 完成

系統功能：
- 學員透過 LINE 預約課程（1-4 小時）
- 教練透過 LIFF 管理扣課/加課、學員明細、排班、休假
- 自動提醒：明日課程、堂數不足、沉睡學員、到期警告
- 收入統計：預收現金 vs 實際收入 vs 未消化餘額
- 每月自動推播收入月報

---

## 日後更新

改完程式後：
- 只改前端：`firebase deploy --only hosting`
- 只改後端：`gcloud run deploy 服務名稱 --source . --region 區域 --allow-unauthenticated --env-vars-file env.production.yaml --project 專案ID`
- 兩邊都改：`bash scripts/deploy.sh`
