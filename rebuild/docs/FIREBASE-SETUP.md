# Firebase 設定清單

> 可將此清單貼給 Gemini 或其他 AI，請其逐步教你完成 Firebase 設定。

---

## 一、建立 Firebase 專案

- [ ] 1. 前往 [Firebase Console](https://console.firebase.google.com/)
- [ ] 2. 點「新增專案」或「建立專案」
- [ ] 3. 輸入專案名稱（例：`golf-coach`）
- [ ] 4. 是否啟用 Google Analytics：依需求選擇
- [ ] 5. 建立完成後進入專案總覽

---

## 二、啟用 Firestore

- [ ] 1. 左側選單 →「建置」→「Firestore Database」
- [ ] 2. 點「建立資料庫」
- [ ] 3. 選擇模式：**正式環境**（Production）
- [ ] 4. 選擇位置：`asia-east1`（台灣）或 `us-central1`
- [ ] 5. 建立完成後，進入 Firestore 資料頁

---

## 三、建立 Firestore 安全規則

- [ ] 1. Firestore →「規則」分頁
- [ ] 2. 開發階段可先用以下規則（**後續需改為依後端驗證**）：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 僅允許後端（透過 Admin SDK）寫入，前端不直接存取
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] 3. 若後端使用 **Firebase Admin SDK**，則無需放寬規則；前端僅透過後端 API 存取資料。

---

## 四、取得服務帳號金鑰（供後端使用）

- [ ] 1. 專案設定（齒輪圖示）→「服務帳戶」
- [ ] 2. 點「產生新的私密金鑰」→ 確認
- [ ] 3. 下載 JSON 檔案
- [ ] 4. 將檔案重新命名為 `serviceAccountKey.json`，放在專案根目錄（**勿提交到 Git**）
- [ ] 5. 在 `.gitignore` 加入：`serviceAccountKey.json`

---

## 五、建立環境變數（.env）

```env
# Firebase
FIREBASE_PROJECT_ID=你的專案ID
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json

# 或直接使用 JSON 內容（部分部署環境適用）
# FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
```

- [ ] 1. 從 `serviceAccountKey.json` 複製 `project_id`
- [ ] 2. 在 `.env` 或部署環境設定上述變數

---

## 六、建立 Firestore 索引（依查詢需求）

在 Firestore 的「索引」分頁建立以下複合索引：

| 集合 | 欄位 | 查詢類型 |
|------|------|----------|
| users | role, alias | 複合 |
| packages | userId, status | 複合 |
| packages | userId, validTo | 複合 |
| credit_transactions | packageId, createdAt | 複合 |
| credit_transactions | userId, createdAt | 複合 |
| coach_leaves | leaveDate | 單一 |
| bookings | userId, bookingDate, startTime | 複合 |

---

## 七、建立 Collections（可選，Firestore 會自動建立）

首次寫入時 Firestore 會自動建立 Collection，無需手動建立。可先建立以下空集合作為結構參考：

- `users`
- `coach_whitelist`
- `packages`
- `credit_transactions`
- `coach_leaves`
- `bookings`
- `waitlists`
- `notifications_log`

---

## 八、後端程式碼範例（Node.js）

```javascript
// 初始化
const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  // 或: credential: admin.credential.cert(require('./serviceAccountKey.json'))
});

const db = admin.firestore();

// 寫入範例
await db.collection('users').doc(lineUserId).set({
  lineUserId,
  role: 'student',
  alias: null,
  displayName: '王小明',
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
});

// Transaction 範例（扣課）
await db.runTransaction(async (tx) => {
  const pkgRef = db.collection('packages').doc(packageId);
  const pkg = await tx.get(pkgRef);
  const remaining = pkg.data().remainingCredits - 1;
  if (remaining < 0) throw new Error('堂數不足');
  tx.update(pkgRef, { remainingCredits: remaining, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  tx.set(db.collection('credit_transactions').doc(), { packageId, userId, change: -1, reason: 'lesson_attended', createdAt: admin.firestore.FieldValue.serverTimestamp() });
});
```

---

## 九、常見問題

**Q: 如何取得 project_id？**  
A: 在 Firebase Console 專案設定中，或從 `serviceAccountKey.json` 的 `project_id` 欄位。

**Q: 後端部署到 Cloud Run 時如何設定金鑰？**  
A: 使用 Secret Manager 儲存 JSON，或設定環境變數 `GOOGLE_APPLICATION_CREDENTIALS` 指向 Secret。

**Q: 開發時如何在本機使用？**  
A: 將 `serviceAccountKey.json` 放在專案根目錄，設定 `GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json`。

---

## 十、貼給 Gemini 的提示詞範例

```
請依照 FIREBASE-SETUP.md 這份清單，一步一步教我完成 Firebase Firestore 的設定。
我已經有 Firebase 帳號，但還沒建立專案。請從「建立 Firebase 專案」開始，
每個步驟都要說明清楚，並告訴我哪裡可以找到對應的選項或按鈕。
```
