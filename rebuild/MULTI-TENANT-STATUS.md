# 多租戶重構 — 進度總覽

> 精簡版 Route B（10 教練 baseline），4 週時程
> 詳細計畫見 [MULTI-TENANT-PLAN.md](./MULTI-TENANT-PLAN.md)

---

## 🎯 專案目標

把系統從「1 教練 1 套部署」改成「1 套部署 N 個教練」，以 **10 教練** 為基準，預留擴張到 30-50 個教練的架構。

- **月費目標**：~$35 USD（固定，不隨教練數線性成長）
- **新教練上線**：<1 小時手動操作（暫不做自助表單）
- **零停機遷移**：現有 aebcd 教練全程不中斷

---

## 🏗️ 基礎設施現況

### 新架構（sam.kuo@chengzhu.co 下）

| 環境 | GCP Project ID | Firestore | Firebase Hosting |
|---|---|---|---|
| Staging | `chengzhu-golf-staging` | ✅ asia-east1 | chengzhu-golf-staging.web.app |
| Production | `chengzhu-golf-prod` | ✅ asia-east1 | chengzhu-golf-prod.web.app |

- **Billing Account**: `0105CA-CC4BD1-B4ED9C`（TWD，NT$1,500/月 Budget Alert）
- **Organization**: chengzhu.co (ID: 57419883123)
- **Org Policy**: `iam.allowedPolicyMemberDomains` 只允許 chengzhu.co domain

### 舊架構（保留運作）

- **kuo.tinghow@gmail.com** 下的 `golf-coach-aebcd`
- 現有 aebcd 教練仍在此運作
- 等 Week 3 遷移到新 prod 後才關閉

### 已啟用的 APIs（兩個新專案都有）
firestore、run、secretmanager、cloudtasks、cloudscheduler、cloudbuild、artifactregistry、iamcredentials、firebase、firebaserules、firebasehosting、storage、billingbudgets、logging、monitoring

---

## 📋 四週執行時程

### ✅ Week 1（4/17-4/19）— Phase 0 完成
- [x] Service Account Key 檢查（git history 乾淨）
- [x] `.gitignore` 驗證（敏感檔已擋）
- [x] 建立 2 個 GCP 專案（staging + prod）
- [x] 關聯 Billing + 啟用 APIs
- [x] Budget Alert（NT$1,500/月，4 段警告）
- [x] Firestore databases（asia-east1）
- [x] Firebase activation（兩個專案）
- [x] 3 份法律文件草稿（[rebuild/docs/legal/](./docs/legal/)）
- [x] 本地 `gcloud auth application-default login`（quota project = `chengzhu-golf-staging`）
- [x] Workspace aliases：`security@chengzhu.co` + `noreply@chengzhu.co`（掛在 `sam.kuo@` 底下）
- [x] Workspace Gmail DKIM 驗證成功（`d=chengzhu.co; s=google`，2048-bit）
- [x] Resend 註冊 + chengzhu.co domain Verified（region `us-east-1`）
- [x] Cloudflare DNS 新增 5 筆：DMARC `p=reject`、2 把 DKIM（Google + Resend）、`send` 子網域 SPF + MX
- [x] mail-tester 10/10：SPF / DKIM / DMARC 三套全 PASS

### 🟡 Week 2（進行中）— Phase 1 + 2 + 3

**Phase 1：資料模型重構**（~3 天）
- [x] **1.1 建立型別與 helper**（2026-04-19 完成）
  - 新檔：`src/types/coach.ts`、`src/services/coach.ts`、`src/services/secrets.ts`、`src/middleware/coachContext.ts`、`src/utils/firestore-helpers.ts`
  - dep：`@google-cloud/secret-manager@^6.1.1`（已加入 `rebuild/package.json`）
  - typecheck 0 errors
- [ ] **1.2 改寫 7 個 service 加 `coachId` 參數** ← **下一步**
  - `booking.ts`(8 queries)、`package.ts`(5+)、`notification.ts`(10+)、`coachLeave.ts`(3)、`fixedSchedule.ts`(4)、`waitlist.ts`、`user.ts`
  - 查詢改用 `coachDb(coachId).xxx`（不是 `getDb().collection('xxx')`）
  - 同步更新 caller：`handlers/webhook.ts`、`routes/{webhook,liff,cron}.ts`
  - 建議一個 service 一個 commit
- [ ] **1.3 Firestore Security Rules 全 deny**（新建 `firestore.rules`）
- [ ] **1.4 複合索引**（新建 `firestore.indexes.json`，先 deploy indexes 再 deploy code）
- [ ] **1.5 Secret Manager 整合** — 啟用 API、Cloud Run SA 加 `secretAccessor` 權限、為 aebcd 建 2 個 secret
- [ ] **1.6 Firestore PITR + GCS daily backup**（Nearline, 90 天 lifecycle）
- [ ] **1.7 冪等 migration script** `scripts/migrate-to-subcollections.js`（Week 3 遷移用，可較晚做）
- [ ] **1.8 單元測試**（租戶隔離 + `credit_transactions` audit trail）

**Phase 2：Webhook 路由 + Cloud Tasks**（1 天）
- Webhook 改 `/webhook/:coachId`
- Cron 用 Cloud Tasks fan-out（每教練一個 task）
- Middleware 從 path 取 coachId，絕不從 body 讀
- 教練 status（active / suspended / deleting）middleware

**Phase 3：設定 Firestore 化**（0.5 天）
- 刪除 `src/utils/constants.ts` 寫死值
- LIFF 前端動態讀取 coach config
- 移除硬編碼「高爾夫預約系統」、「Asia/Taipei」

### 🟡 Week 3（5/01-5/08）— 現有 aebcd 遷移
- Staging 完整驗證（24-48 小時觀察）
- 寫 migration script `scripts/migrate-to-subcollections.js`（冪等）
- 把 aebcd 舊 root-level data 搬進 `coaches/aebcd/` subcollection
- Cloud Run canary deployment（10% → 50% → 100%）
- LINE webhook URL 改 `/webhook/aebcd`
- 補跑 migration 處理 canary 期間新增的資料

### 🟢 Week 4 起（5/08+）— 量產
- 有新教練：助理手動執行
  1. 教練去 LINE Console 建 Channel（取 long-lived token）
  2. Sam 用 LIFF 或手動在 Firestore 建立 `coaches/{新 coachId}` doc
  3. 把 token/secret 放進 Secret Manager
  4. 呼叫 LINE API 建立 LIFF app × 2
  5. 上傳 Rich Menu
  6. 設定 webhook URL `/webhook/{新 coachId}`
- 每位教練 <1 小時，完全手動但 one code base

---

## ⏸️ 暫緩項目（有需要再做）

| 項目 | 何時觸發 |
|---|---|
| Phase 4 add-coach 自動化腳本 | 累積 5+ 教練、手動流程嫌累時 |
| Phase 5 Logo 客製 | 有教練要求客製時 |
| Phase 6 停權 / 刪除流程完整化 | 有教練真的要停用時 |
| Phase 7 自助 Onboarding 表單 | 教練數破 10-15 時 |
| Cloud Armor / DoS 防護 | 有被攻擊跡象時 |
| Google Workspace SSO 管理後台 | 教練數破 10 時 |
| 律師正式審閱法律文件 | 月營收穩定後 |
| 自建表單 B（Tally.so 替代） | Phase 7 要做時 |

---

## 🔐 安全與風險管控（已實施）

- ✅ Budget Alert NT$1,500/月（4 段警告）
- ✅ Organization 層級 Domain Restricted Sharing（只准 chengzhu.co）
- ✅ 郵件認證：SPF + DKIM（`d=chengzhu.co`，2048-bit）+ DMARC `p=reject`
- ✅ Resend 獨立 domain（教練/學員 email 通知用，與 Workspace Gmail 分流）
- ✅ Service Account Key 已從本地和 repo 清除，全部改用 ADC

## 🟡 Phase 1 會實施（Week 2）

- Firestore Security Rules 全 deny（只准 Admin SDK）
- Secret Manager 存 LINE 憑證（Firestore 只存 reference）
- Firebase PITR 啟用
- GCS 每日備份（Nearline，90 天 lifecycle）
- Credit transaction audit trail

## 🚫 本次 MVP 不做

- Cloud Armor / DoS 防護
- LINE push rate limit
- Google Workspace SSO 管理後台
- 自助表單自建
- 前端 code 混淆

---

## 💰 收費模式

- **買斷授權金**：$15,000 NTD（早鳥價，限前 10 名）
- **年度服務費**：$3,600 NTD/年（首年免）
- **SLA**：99% uptime
- **不續年費處理**：30 日寬限 → 唯讀 30 日 → 1 年後徹底刪除

---

## 📁 重要文件

### Plans & docs
- [rebuild/MULTI-TENANT-PLAN.md](./MULTI-TENANT-PLAN.md) — 完整 plan（含所有 Phase、風險、成本）
- [rebuild/MULTI-TENANT-STATUS.md](./MULTI-TENANT-STATUS.md) — 本文件，進度總覽
- [rebuild/docs/legal/privacy-policy.md](./docs/legal/privacy-policy.md) — 平台隱私政策草稿
- [rebuild/docs/legal/terms-of-service.md](./docs/legal/terms-of-service.md) — 平台服務條款草稿
- [rebuild/docs/legal/coach-privacy-template.md](./docs/legal/coach-privacy-template.md) — 教練對學員隱私告知範本
- [CLAUDE.md](../CLAUDE.md) — 專案層級設定（舊 aebcd 綁定 kuo.tinghow@gmail.com）

### 維運 scripts（Phase 0 建立，未來 rotate/審計可重用）
- `rebuild/scripts/setup-adc.ps1` — gcloud ADC login + quota project
- `rebuild/scripts/cf-read-txt.ps1` — 讀 Cloudflare TXT/DKIM 當前狀態
- `rebuild/scripts/cf-add-records.ps1` — 一次建立 DMARC/DKIM/SPF/MX（idempotent）
- `rebuild/scripts/cf-update-google-dkim.ps1` — DKIM key rotate 時更新 Cloudflare TXT
- `rebuild/scripts/resend-add-domain.ps1` — Resend 加 domain + 匯出 DNS records（JSON）

---

## 🧠 關鍵決策記錄

1. **10 教練 baseline**（不是 50）→ 選精簡版 Route B，不做完整自動化
2. **舊 aebcd 專案保留在原帳號**，不搬家（避免斷線風險）
3. **新專案建在 sam.kuo@chengzhu.co 下**，使用 chengzhu.co Workspace
4. **全部 subcollection 架構**（不是 root-level + coachId 欄位）
5. **Cloud Tasks fan-out**（不是 for loop）— 未來擴張用
6. **Secret Manager 存憑證**（Firestore 只存 reference）
7. **PITR + GCS 雙層備份**（金流 audit trail 另做）
8. **法律文件先用自寫草稿**（月營收穩定再請律師）
9. **Tally.so 表單暫不做**（Phase 7 暫緩，10 教練值得手動接洽）
10. **LINE long-lived token**（不用短期需 refresh 的版本）

---

**進度**：Phase 0 完成。Phase 1.1 完成（2026-04-19 — 型別、helper、secrets wrapper、coachContext middleware）。Phase 1.2 待開工。

**Phase 1.2 開工前提醒**：
- 專案已從 Google Drive Stream（`H:\我的雲端硬碟\`）搬到本地開發（Drive Stream 會害 `npm install` 產生 0-byte 檔）
- 用既有 ADC（`sam.kuo@chengzhu.co`，quota project = `chengzhu-golf-staging`）開發
- LINE `aebcd` channel token/secret 在 1.5 才搬到 Secret Manager，1.2 階段仍走既有 env
- 建議每個 service 單獨 commit，方便 rollback
- Phase 1.6 的 PITR + GCS 備份**要先於**任何 migration 動作
