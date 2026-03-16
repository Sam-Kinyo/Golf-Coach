# 強制更新 LIFF 快取（手機一直看到舊版時）

LINE 內建瀏覽器會快取網頁，導致你一直看到舊版。請依下列步驟強制載入新版本：

## 步驟一：更新 LIFF Endpoint URL

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 選擇你的 Provider 和 Channel
3. 進入 **LIFF** 分頁
4. 編輯學員用與教練用的 LIFF 應用

**學員 LIFF Endpoint URL 改為：**
```
https://golf-coach-aebcd.web.app/student/index.html?v=2
```

**教練 LIFF Endpoint URL 改為：**
```
https://golf-coach-aebcd.web.app/coach/index.html?v=2
```

（在網址後面加上 `?v=2` 即可，之後每次更新可改成 `?v=3`、`?v=4` 強制刷新）

5. 儲存

## 步驟二：清除 LINE 快取（選用）

- **Android**：設定 → 應用程式 → LINE → 儲存空間 → 清除快取
- **iOS**：設定 → 一般 → iPhone 儲存空間 → LINE → 卸載 App（再重新安裝），或清除 Safari 網站資料

## 步驟三：重新開啟

從官方帳號選單或連結重新開啟 LIFF，應會載入最新版本。
