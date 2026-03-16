# LIFF「發生不明錯誤」解決方式

> 學員點擊「開啟學員專區」後出現「發生不明錯誤，請稍後再試」時，請依序嘗試以下方式。

---

## 方式一：連結 LINE Login 與 Messaging API 頻道（最重要）

學員 LIFF 在 **LINE Login 頻道**，但學員是從 **Messaging API 機器人** 聊天室點擊連結。兩者需連結為同一個官方帳號，LIFF 才能正常運作。

### 操作步驟

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 點選 **LINE Login 頻道**（葉永承-專業高爾夫教練，有 LIFF 的那個）
3. 點選「**Basic settings**」分頁
4. 找到「**Linked LINE Official Account**」（連結的 LINE 官方帳號）
5. 點擊「**Edit**」
6. 選擇 **Messaging API 頻道對應的官方帳號**（葉永承-專業高爾夫教練機器人）
7. 點擊「**Update**」儲存

> 若您同時是兩個頻道的管理員，列表中應會出現 Messaging API 的官方帳號。

---

## 方式二：確認 LINE Login 頻道已發布

1. 在 LINE Login 頻道的「Basic settings」
2. 確認狀態為「**Published**」（已發布），而非「Development」（開發中）

---

## 方式三：Android 裝置請更新 LINE App

若使用 Android 手機，請將 LINE App 更新至最新版本，可避免部分 WebView 相關錯誤。

---

## 方式四：學員需已加入機器人好友

學員必須先將「葉永承-專業高爾夫教練」加為 LINE 好友，再從聊天室點擊「開啟學員專區」按鈕。

---

## 完成後

請學員重新從 LINE 聊天室點擊「開啟學員專區」測試。**方式一（連結頻道）** 是最常見的解決方式。
