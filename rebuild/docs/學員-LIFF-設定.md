# 學員 LIFF 設定指南

> 學員專區與教練後台一樣，需要建立獨立的 LIFF 應用並部署到 Firebase Hosting。

---

## 一、在 LINE Developers Console 建立學員 LIFF

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 選擇您的頻道（與教練 LIFF 同一個）
3. 點選「**LIFF**」分頁
4. 點擊「**新增**」
5. 填寫：
   - **LIFF app name**：`學員專區`
   - **Size**：Full
   - **Endpoint URL**：先填 `https://example.com`（部署後再改）
   - **Scope**：勾選「profile」
6. 點擊「**新增**」
7. **複製 LIFF ID**（例如：`2009368869-xxxxxxxx`）

---

## 二、設定環境變數

在 `.env` 和 `env.production.yaml` 中加入：

```env
LIFF_STUDENT_ID=您的學員LIFF_ID
```

---

## 三、設定學員 LIFF 頁面

1. 開啟 `d:\Golf-Coach\rebuild\liff\student\index.html`
2. 找到 `window.LIFF_ID = '';`
3. 改為：`window.LIFF_ID = '您的學員LIFF_ID';`

---

## 四、部署到 Firebase Hosting

學員頁面與教練頁面一起部署：

```
cd d:\Golf-Coach\rebuild
firebase deploy --only hosting
```

學員專區網址為：`https://您的專案.web.app/student/index.html`

---

## 五、設定 LIFF Endpoint URL

1. 回到 LINE Developers Console → LIFF
2. 點擊學員 LIFF 的「**編輯**」
3. 在 **Endpoint URL** 填入：`https://您的專案.web.app/student/index.html`
4. 儲存

---

## 六、重新部署後端（若新增 LIFF_STUDENT_ID）

```
gcloud run deploy golf-coach-api --source . --region asia-east1 --allow-unauthenticated --env-vars-file env.production.yaml
```

---

## 完成

學員傳送「使用教學」「我的堂數」「查詢預約」「預約」等訊息時，Bot 會回覆「👉 開啟學員專區」按鈕，點擊即可進入學員 LIFF 頁面。
