/* ═══════════════════════════════════════════════════════════
   Golf Coach Booking System — Google Apps Script Backend
   ═══════════════════════════════════════════════════════════ */

/* ─── 全域常數 ─── */
const LINE_TOKEN    = 'yGE3DLwHsg6op/h9tYKe0ssJTHQ7A1732dFxxMSHWe9iUrTjV0YRddbtxnZuC/CitguV/fUNVydVJLQG15E4dMhaEocM6OBFjultU3ssSPLdDhnD44UBPz8Z87MBFBNZaPgtcMmgBGt2yO5PboPJKQdB04t89/1O/w1cDnyilFU=';
const ADMIN_UID     = 'U5a47a389458c99313558af8568f0626';
const SHEET_ID      = '1X1vI1bZSeGs8OoizbhIkMfdWaoWBiwxfPJnduFHC0VI';
const CALENDAR_ID   = '169b4b3f981dae073642a157bb0b7ae1b1c09358e89c093aa9e9fbf4347bfa24@group.calendar.google.com';
const SHEET_NAME    = 'Orders';

/* 服務項目 → 耗時（小時） */
const SERVICE_DURATION = {
  '體驗課程':       1,
  '1對1教學':      1,
  '下場實戰教學':   5,
  '果嶺邊實戰教學': 2
};

/* 地點 → Google Maps 導航 */
const LOCATION_MAP = {
  '桃園良益高爾夫練習場':     'https://www.google.com/maps/search/?api=1&query=桃園+良益高爾夫練習場',
  '桃園亞洲高爾夫練習場':     'https://www.google.com/maps/search/?api=1&query=桃園+亞洲高爾夫練習場',
  '桃園清浦高爾夫練習場':     'https://www.google.com/maps/search/?api=1&query=桃園+清浦高爾夫練習場',
  '新竹東海櫻花高爾夫練習場': 'https://www.google.com/maps/search/?api=1&query=新竹+東海櫻花高爾夫練習場'
};

/* 地點 → 地區前綴（用於 Calendar 標題） */
function getRegionPrefix(location) {
  if (location.startsWith('桃園')) return '[桃園]';
  if (location.startsWith('新竹')) return '[新竹]';
  return '';
}

/* ─── Helper: 取得工作表 ─── */
function getSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

/* ─── Helper: 產生 Order ID ─── */
function generateOrderId() {
  const ts = new Date().getTime().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
  return 'ORD-' + ts + rand;
}

/* ═══════════════════════════════════════════════════════════
   doGet — 唯讀 API（LIFF 查詢可用時段）
   ═══════════════════════════════════════════════════════════ */
function doGet(e) {
  const date = (e && e.parameter && e.parameter.date) ? e.parameter.date : '';
  const sheet = getSheet();
  const data  = sheet.getDataRange().getDisplayValues(); // 避免 Date 物件型別問題

  const activeStatuses = ['待確認', '已確認'];
  const occupiedSet = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowDate    = row[5]; // Booking_Date
    const rowTime    = row[6]; // Booking_Time
    const rowService = row[7]; // Service_Item
    const rowStatus  = row[9]; // Status

    if (rowDate !== date) continue;
    if (!activeStatuses.includes(rowStatus)) continue;

    const duration = SERVICE_DURATION[rowService] || 1;
    const startH = parseInt(rowTime.split(':')[0], 10);

    for (let offset = 0; offset < duration; offset++) {
      const hh = String(startH + offset).padStart(2, '0') + ':00';
      occupiedSet[hh] = true;
    }
  }

  const bookedSlots = Object.keys(occupiedSet).sort();

  return ContentService
    .createTextOutput(JSON.stringify({ bookedSlots: bookedSlots }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ═══════════════════════════════════════════════════════════
   doPost — 接收 Webhook / 預約請求
   ═══════════════════════════════════════════════════════════ */
function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  try {
    var body = JSON.parse(e.postData.contents);

    // --- 強制防呆：精準攔截 LINE Verify 專用的假測試封包 ---
    if (body.events && body.events.length > 0) {
      const rToken = body.events[0].replyToken;
      if (rToken === '00000000000000000000000000000000' || rToken === 'ffffffffffffffffffffffffffffffff') {
        return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
      }
    } else if (body.events && body.events.length === 0) {
      return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
    }
    // ---------------------------------------------------

    /* ── 來自 LIFF 的預約請求 ── */
    if (body.action === 'booking') {
      const result = handleBooking(body);
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }

    /* ── 來自 LINE Webhook 的訊息 ── */
    if (body.events) {
      body.events.forEach(function(event) {
        if (event.type === 'message' && event.message.type === 'text') {
          var text = event.message.text.trim();
          var replyToken = event.replyToken;
          var userId = event.source.userId;

          // 教練審核指令
          if (userId === ADMIN_UID && (text.startsWith('核准 ') || text.startsWith('拒絕 '))) {
            handleApproval(text, replyToken);
            return;
          }

          // 預設回覆（確認 Webhook 連線正常）
          replyMessage(replyToken, '⛳ 歡迎使用高爾夫教練預約系統！\n\n請透過預約頁面進行預約 🏌️');
        }
      });
    }
  } catch (error) {
    console.error('doPost error:', error.message);
  }

  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

/* ═══════════════════════════════════════════════════════════
   handleBooking — 顧客預約（Two-Phase: 待確認）
   ═══════════════════════════════════════════════════════════ */
function handleBooking(data) {
  const orderId = generateOrderId();
  const createTime = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');

  const sheet = getSheet();
  sheet.appendRow([
    orderId,                  // [0] Order_ID
    createTime,               // [1] Create_Time
    data.uid,                 // [2] LINE_UID
    data.name,                // [3] Customer_Name
    data.location,            // [4] Location
    data.date,                // [5] Booking_Date
    data.time,                // [6] Booking_Time
    data.service,             // [7] Service_Item
    '',                       // [8] Estimated_Price
    '待確認',                 // [9] Status
    '',                       // [10] Event_ID
    ''                        // [11] Reminded
  ]);

  /* 推播：通知顧客等待 */
  pushMessage(data.uid, [
    {
      type: 'text',
      text: `⛳ 預約已送出！\n\n📋 訂單編號：${orderId}\n📍 地點：${data.location}\n📅 日期：${data.date}\n⏰ 時間：${data.time}\n🏌️ 課程：${data.service}\n\n教練確認後會再通知您，請稍候 🙏`
    }
  ]);

  /* 推播：審核卡片給教練 */
  pushMessage(ADMIN_UID, [
    {
      type: 'text',
      text: `📩 新預約待審核\n\n📋 ${orderId}\n👤 ${data.name}\n📍 ${data.location}\n📅 ${data.date} ${data.time}\n🏌️ ${data.service}\n\n請回覆「核准 ${orderId}」或「拒絕 ${orderId}」`
    }
  ], [
    {
      type: 'action',
      action: { type: 'message', label: '✅ 核准', text: '核准 ' + orderId }
    },
    {
      type: 'action',
      action: { type: 'message', label: '❌ 拒絕', text: '拒絕 ' + orderId }
    }
  ]);

  return { status: 'ok', orderId: orderId };
}

/* ═══════════════════════════════════════════════════════════
   handleApproval — 教練審核（Phase 2: 確認 / 拒絕）
   ═══════════════════════════════════════════════════════════ */
function handleApproval(text, replyToken) {
  const parts = text.split(' ');
  const action  = parts[0]; // 核准 or 拒絕
  const orderId = parts[1]; // ORD-xxxxx

  const sheet = getSheet();
  const data  = sheet.getDataRange().getDisplayValues();
  let targetRow = -1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) {
      targetRow = i + 1; // Sheets 是 1-indexed, header 佔 row 1
      break;
    }
  }

  if (targetRow === -1) {
    replyMessage(replyToken, '⚠️ 找不到訂單 ' + orderId);
    return;
  }

  const row = data[targetRow - 1];
  const customerUid = row[2];
  const customerName = row[3];
  const location = row[4];
  const bookingDate = row[5];
  const bookingTime = row[6];
  const service = row[7];
  const duration = SERVICE_DURATION[service] || 1;

  if (action === '核准') {
    /* ── 寫入 Google Calendar ── */
    const prefix = getRegionPrefix(location);
    const calTitle = prefix + ' ' + customerName + ' - ' + service;

    const startDT = new Date(bookingDate + 'T' + bookingTime + ':00');
    const endDT   = new Date(startDT.getTime() + duration * 60 * 60 * 1000);

    const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    const event = calendar.createEvent(calTitle, startDT, endDT, {
      description: '訂單編號：' + orderId + '\n地點：' + location
    });
    const eventId = event.getId();

    /* 更新 Sheets */
    sheet.getRange(targetRow, 10).setValue('已確認');   // Status (col J = 10)
    sheet.getRange(targetRow, 11).setValue(eventId);    // Event_ID (col K = 11)

    /* 通知顧客 */
    const mapsUrl = LOCATION_MAP[location] || '';
    pushMessage(customerUid, [
      {
        type: 'text',
        text: `✅ 預約已確認！\n\n📋 訂單編號：${orderId}\n📍 地點：${location}\n📅 日期：${bookingDate}\n⏰ 時間：${bookingTime}\n🏌️ 課程：${service}（${duration} hr）\n\n📍 導航地圖：\n${mapsUrl}\n\n期待與您見面！⛳`
      }
    ]);

    replyMessage(replyToken, '✅ 已核准 ' + orderId + '，日曆事件已建立。');

  } else if (action === '拒絕') {
    /* 更新 Sheets */
    sheet.getRange(targetRow, 10).setValue('已拒絕');

    /* 通知顧客 */
    pushMessage(customerUid, [
      {
        type: 'text',
        text: `❌ 很抱歉，您的預約未通過。\n\n📋 訂單編號：${orderId}\n📍 地點：${location}\n📅 日期：${bookingDate} ${bookingTime}\n🏌️ 課程：${service}\n\n歡迎重新選擇其他時段預約 🙏`
      }
    ]);

    replyMessage(replyToken, '❌ 已拒絕 ' + orderId + '，已通知顧客。');
  }
}

/* ═══════════════════════════════════════════════════════════
   sendNightlyReminders — 每日排程提醒
   ═══════════════════════════════════════════════════════════ */
function sendNightlyReminders() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getDisplayValues();

  /* 計算明天的日期字串 */
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = Utilities.formatDate(tomorrow, 'Asia/Taipei', 'yyyy-MM-dd');

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const bookingDate = row[5];
    const status      = row[9];
    const reminded    = row[11];

    if (bookingDate !== tomorrowStr) continue;
    if (status !== '已確認') continue;
    if (reminded === 'Y') continue;

    const customerUid  = row[2];
    const customerName = row[3];
    const location     = row[4];
    const bookingTime  = row[6];
    const service      = row[7];
    const orderId      = row[0];
    const mapsUrl      = LOCATION_MAP[location] || '';

    pushMessage(customerUid, [
      {
        type: 'text',
        text: `🔔 明日課程提醒\n\n${customerName} 您好！\n明天有一堂課程，別忘了喔 😊\n\n📋 ${orderId}\n📍 ${location}\n⏰ ${bookingTime}\n🏌️ ${service}\n\n📍 導航：${mapsUrl}\n\n期待明天見面！⛳`
      }
    ]);

    /* 標記已提醒 */
    sheet.getRange(i + 1, 12).setValue('Y'); // Reminded (col L = 12)
  }
}

/* ═══════════════════════════════════════════════════════════
   LINE Messaging API Helpers
   ═══════════════════════════════════════════════════════════ */

/**
 * Push Message（主動推播）
 * @param {string} to - LINE UID
 * @param {Array} messages - 訊息陣列
 * @param {Array} [quickReply] - Quick Reply items（可選）
 */
function pushMessage(to, messages, quickReply) {
  if (quickReply && quickReply.length > 0) {
    messages[messages.length - 1].quickReply = { items: quickReply };
  }

  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_TOKEN
    },
    payload: JSON.stringify({
      to: to,
      messages: messages
    }),
    muteHttpExceptions: true
  });
}

/**
 * Reply Message（回覆訊息）
 * @param {string} replyToken
 * @param {string} text
 */
function replyMessage(replyToken, text) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_TOKEN
    },
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    }),
    muteHttpExceptions: true
  });
}
