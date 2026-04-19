#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo ""
echo "🏌️ 高爾夫教練預約系統 — 一鍵部署"
echo ""

# 讀取設定
if [ ! -f ".firebaserc" ]; then
  echo "❌ 找不到 .firebaserc，請先執行 node scripts/setup-new-coach.js"
  exit 1
fi
if [ ! -f "env.production.yaml" ]; then
  echo "❌ 找不到 env.production.yaml，請先執行 node scripts/setup-new-coach.js"
  exit 1
fi

PROJECT_ID=$(node -e "console.log(require('./.firebaserc').projects.default)")
SERVICE_ID=$(node -e "console.log(require('./firebase.json').hosting.rewrites[0].run.serviceId)")
REGION=$(node -e "console.log(require('./firebase.json').hosting.rewrites[0].run.region)")

echo "📋 專案: $PROJECT_ID"
echo "📋 服務: $SERVICE_ID"
echo "📋 區域: $REGION"
echo ""

# Step 1: Install dependencies
echo "📦 安裝依賴..."
npm install
echo ""

# Step 2: Build TypeScript
echo "🔨 編譯 TypeScript..."
npm run build
echo ""

# Step 3: Deploy backend to Cloud Run
echo "🚀 部署後端到 Cloud Run..."
gcloud run deploy "$SERVICE_ID" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --env-vars-file env.production.yaml \
  --project "$PROJECT_ID"
echo ""

# Step 4: Deploy frontend to Firebase Hosting
echo "🌐 部署前端到 Firebase Hosting..."
firebase deploy --only hosting
echo ""

# Step 5: Setup Rich Menu
echo "📱 設定 LINE Rich Menu..."
npm run setup:rich-menu
echo ""

# Get Cloud Run URL
CLOUD_RUN_URL=$(gcloud run services describe "$SERVICE_ID" --region "$REGION" --project "$PROJECT_ID" --format="value(status.url)" 2>/dev/null || echo "")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 部署完成！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📍 前端網址: https://$PROJECT_ID.web.app"
echo "📍 後端網址: $CLOUD_RUN_URL"
echo ""
echo "⚠️ 還需要手動設定："
echo ""
echo "1️⃣  LINE Webhook URL:"
echo "   到 LINE Developers Console → Messaging API → Webhook URL"
echo "   填入: ${CLOUD_RUN_URL}/webhook"
echo ""
echo "2️⃣  LIFF Endpoint URL:"
echo "   教練 LIFF: https://$PROJECT_ID.web.app/coach/index.html"
echo "   學員 LIFF: https://$PROJECT_ID.web.app/student/index.html"
echo ""
echo "3️⃣  Cloud Scheduler (到 GCP Console 設定):"

# Read cron secret from env.production.yaml
CRON_SECRET=$(grep CRON_SECRET env.production.yaml | sed 's/.*"\(.*\)"/\1/')

echo "   POST ${CLOUD_RUN_URL}/api/cron/reminders      每天 21:00  Header: X-Cron-Secret: $CRON_SECRET"
echo "   POST ${CLOUD_RUN_URL}/api/cron/expiry          每天 08:00  Header: X-Cron-Secret: $CRON_SECRET"
echo "   POST ${CLOUD_RUN_URL}/api/cron/coach-digest    每天 21:00  Header: X-Cron-Secret: $CRON_SECRET"
echo "   POST ${CLOUD_RUN_URL}/api/cron/low-credits     每天 09:00  Header: X-Cron-Secret: $CRON_SECRET"
echo "   POST ${CLOUD_RUN_URL}/api/cron/inactive-reminders 每週一 10:00 Header: X-Cron-Secret: $CRON_SECRET"
echo "   POST ${CLOUD_RUN_URL}/api/cron/monthly-revenue 每月1號 09:00 Header: X-Cron-Secret: $CRON_SECRET"
echo ""
