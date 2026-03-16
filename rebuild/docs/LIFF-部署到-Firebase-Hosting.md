# 教練 LIFF 頁面部署到 Firebase Hosting

> 完成後，您會得到一個 HTTPS 網址，填入 LINE Developers Console 的 LIFF Endpoint URL。

---

## 步驟零：確認 Firebase Hosting 已啟用

1. 前往 [Firebase Console](https://console.firebase.google.com/)
2. 選擇專案 `golf-coach-aebcd`
3. 左側選單 →「**建置**」→「**Hosting**」
4. 若尚未啟用，點擊「**開始使用**」完成設定

---

## 步驟一：安裝 Firebase CLI（若尚未安裝）

在終端機執行：

```
npm install -g firebase-tools
```

---

## 步驟二：登入 Firebase

```
firebase login
```

會開啟瀏覽器，請用**與 Firebase 專案相同的 Google 帳號**登入。

---

## 步驟三：部署

在 `d:\Golf-Coach\rebuild` 目錄執行：

```
firebase deploy --only hosting
```

---

## 步驟四：取得網址

部署成功後，會顯示類似：

```
Hosting URL: https://golf-coach-aebcd.web.app
```

**教練 LIFF 頁面的完整網址為：**

```
https://golf-coach-aebcd.web.app/coach/index.html
```

> 若您的專案 ID 不同，請將 `golf-coach-aebcd` 替換為您的專案 ID。

---

## 步驟五：填入 LINE Developers Console

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 選擇您的頻道
3. 點選「**LIFF**」分頁
4. 點擊您的 LIFF 應用程式（教練後台）右側的「**編輯**」
5. 在「**Endpoint URL**」欄位填入：

   ```
   https://golf-coach-aebcd.web.app/coach/index.html
   ```

6. 點擊「**更新**」儲存

---

## 完成

之後可從 LINE 的 Rich Menu 或連結開啟此網址，即可使用教練後台（扣課、加課、休假設定）。

---

## 常見問題

**Q：部署時出現「Permission denied」？**  
A：確認已用 `firebase login` 登入，且登入帳號為 Firebase 專案的擁有者或具備部署權限。

**Q：Endpoint URL 要填 index.html 還是只填到 /coach/？**  
A：兩者皆可，建議填完整路徑：`https://您的專案.web.app/coach/index.html`
