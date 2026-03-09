/* ═══════════════════════════════════════════════════════════
   Golf Coach Booking System — Google Apps Script Backend
   Final Integrated Version
   ═══════════════════════════════════════════════════════════ */

/* ─── 全域常數 ─── */
const LINE_TOKEN    = 'yGE3DLwHsg6op/h9tYKe0ssJTHQ7A1732dFxxMSHWe9iUrTjV0YRddbtxnZuC/CitguV/fUNVydVJLQG15E4dMhaEocM6OBFjultU3ssSPLdDhnD44UBPz8Z87MBFBNZaPgtcMmgBGt2yO5PboPJKQdB04t89/1O/w1cDnyilFU=';
const ADMIN_UID     = 'U19f435262c62fcb5db8ea634495dc1c3';
const SHEET_ID      = '1X1vI1bZSeGs8OoizbhIkMfdWaoWBiwxfPJnduFHC0VI';
const CALENDAR_ID   = '169b4b3f981dae073642a157bb0b7ae1b1c09358e89c093aa9e9fbf4347bfa24@group.calendar.google.com';
const SHEET_NAME    = 'Orders';
const LIFF_URL      = 'https://liff.line.me/2009368868-R5zXPj93';
const COACH_PHONE   = '0966-293-193';

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

/* 地點 → 地區前綴 */
function getRegionPrefix(location) {
  if (location.startsWith('桃園')) return '[桃園]';
  if (location.startsWith('新竹')) return '[新竹]';
  return '';
}

/* 地點 → 縣市（前兩字） */
function getCity(location) {
  return location ? location.substring(0, 2) : '';
}

/* ─── Helper: 取得工作表 ─── */
function getSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

/* ─── Helper: 產生 Order ID ─── */
function generateOrderId() {
  var ts = new Date().getTime().toString(36).toUpperCase();
  var rand = Math.random().toString(36).substring(2, 5).toUpperCase();
  return 'ORD-' + ts + rand;
}

/* ═══════════════════════════════════════════════════════════
   doGet — 唯讀 API（LIFF 查詢可用時段）
   回傳 bookedSlots 物件陣列: [{ time: "HH:00", city: "桃園" }, ...]
   ═══════════════════════════════════════════════════════════ */
function doGet(e) {
  var date = (e && e.parameter && e.parameter.date) ? e.parameter.date : '';
  var sheet = getSheet();
  var data  = sheet.getDataRange().getDisplayValues();

  var activeStatuses = ['待確認', '已確認'];
  var slots = [];
  var seen = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowDate    = row[5];
    var rowTime    = row[6];
    var rowService = row[7];
    var rowStatus  = row[9];
    var rowLocation = row[4];

    if (rowDate !== date) continue;
    if (activeStatuses.indexOf(rowStatus) === -1) continue;

    var duration = SERVICE_DURATION[rowService] || 1;
    var startH = parseInt(rowTime.split(':')[0], 10);
    var city = getCity(rowLocation);

    for (var offset = 0; offset < duration; offset++) {
      var hh = ('0' + (startH + offset)).slice(-2) + ':00';
      var key = hh + '_' + city;
      if (!seen[key]) {
        seen[key] = true;
        slots.push({ time: hh, city: city });
      }
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ bookedSlots: slots }))
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

    // --- 攔截 LINE Verify 假測試封包 ---
    if (body.events && body.events.length > 0) {
      var rToken = body.events[0].replyToken;
      if (rToken === '00000000000000000000000000000000' || rToken === 'ffffffffffffffffffffffffffffffff') {
        return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
      }
    } else if (body.events && body.events.length === 0) {
      return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
    }

    /* ── 來自 LIFF 的預約請求 ── */
    if (body.action === 'booking') {
      var result = handleBooking(body);
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }

    /* ── 來自 LINE Webhook 的訊息 ── */
    if (body.events) {
      body.events.forEach(function(event) {
        if (event.type === 'message' && event.message.type === 'text') {
          handleLineMessage(event);
        }
      });
    }
  } catch (error) {
    console.error('doPost error:', error.message);
  }

  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

/* ═══════════════════════════════════════════════════════════
   handleLineMessage — 訊息路由
   ═══════════════════════════════════════════════════════════ */
function handleLineMessage(event) {
  var text = event.message.text.trim();
  var replyToken = event.replyToken;
  var userId = event.source.userId;

  // 教練審核指令
  if (userId === ADMIN_UID && (text.startsWith('核准 ') || text.startsWith('拒絕 '))) {
    handleApproval(text, replyToken);
    return;
  }

  // 學生查詢預約
  if (text === '查詢預約' || text === '我的預約') {
    sendStudentOrdersFlex(userId, replyToken);
    return;
  }

  // 學生取消預約: "取消 ORD-xxxxx 理由"
  if (text.startsWith('取消 ')) {
    handleCancelOrder(text, userId, replyToken);
    return;
  }

  // 預設回覆（含預約連結）
  replyMessage(replyToken, '⛳ 歡迎使用高爾夫教練預約系統！\n\n👉 點擊以下連結立即預約：\n' + LIFF_URL + '\n\n📋 輸入「查詢預約」查看您的預約\n\n期待為您服務 🏌️');
}

/* ═══════════════════════════════════════════════════════════
   handleBooking — 顧客預約（Two-Phase: 待確認）
   ═══════════════════════════════════════════════════════════ */
function handleBooking(data) {
  var orderId = generateOrderId();
  var createTime = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');

  var sheet = getSheet();
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
    '',                       // [11] Reminded
    ''                        // [12] Cancel_Reason
  ]);

  /* 推播：通知顧客等待 */
  pushMessage(data.uid, [
    {
      type: 'text',
      text: '⛳ 預約已送出！\n\n📋 訂單編號：' + orderId + '\n📍 地點：' + data.location + '\n📅 日期：' + data.date + '\n⏰ 時間：' + data.time + '\n🏌️ 課程：' + data.service + '\n\n教練確認後會再通知您，請稍候 🙏'
    }
  ]);

  /* 推播：審核卡片給教練 */
  pushMessage(ADMIN_UID, [
    {
      type: 'text',
      text: '📩 新預約待審核\n\n📋 ' + orderId + '\n👤 ' + data.name + '\n📍 ' + data.location + '\n📅 ' + data.date + ' ' + data.time + '\n🏌️ ' + data.service + '\n\n請回覆「核准 ' + orderId + '」或「拒絕 ' + orderId + '」'
    }
  ], [
    { type: 'action', action: { type: 'message', label: '✅ 核准', text: '核准 ' + orderId } },
    { type: 'action', action: { type: 'message', label: '❌ 拒絕', text: '拒絕 ' + orderId } }
  ]);

  return { status: 'ok', orderId: orderId };
}

/* ═══════════════════════════════════════════════════════════
   handleApproval — 教練審核（Phase 2: 確認 / 拒絕）
   ═══════════════════════════════════════════════════════════ */
function handleApproval(text, replyToken) {
  var parts = text.split(' ');
  var action  = parts[0];
  var orderId = parts[1];

  var sheet = getSheet();
  var data  = sheet.getDataRange().getDisplayValues();
  var targetRow = -1;

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) {
    replyMessage(replyToken, '⚠️ 找不到訂單 ' + orderId);
    return;
  }

  var row = data[targetRow - 1];
  var customerUid = row[2];
  var customerName = row[3];
  var location = row[4];
  var bookingDate = row[5];
  var bookingTime = row[6];
  var service = row[7];
  var duration = SERVICE_DURATION[service] || 1;

  if (action === '核准') {
    /* 寫入 Google Calendar */
    var prefix = getRegionPrefix(location);
    var calTitle = prefix + ' ' + customerName + ' - ' + service;

    var startDT = new Date(bookingDate + 'T' + bookingTime + ':00');
    var endDT   = new Date(startDT.getTime() + duration * 60 * 60 * 1000);

    var calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    var calEvent = calendar.createEvent(calTitle, startDT, endDT, {
      description: '訂單編號：' + orderId + '\n地點：' + location
    });
    var eventId = calEvent.getId();

    /* 更新 Sheets */
    sheet.getRange(targetRow, 10).setValue('已確認');
    sheet.getRange(targetRow, 11).setValue(eventId);

    /* 通知顧客 */
    var mapsUrl = LOCATION_MAP[location] || '';
    pushMessage(customerUid, [
      {
        type: 'text',
        text: '✅ 預約已確認！\n\n📋 訂單編號：' + orderId + '\n📍 地點：' + location + '\n📅 日期：' + bookingDate + '\n⏰ 時間：' + bookingTime + '\n🏌️ 課程：' + service + '（' + duration + ' hr）\n\n📍 導航地圖：\n' + mapsUrl + '\n\n期待與您見面！⛳'
      }
    ]);

    replyMessage(replyToken, '✅ 已核准 ' + orderId + '，日曆事件已建立。');

  } else if (action === '拒絕') {
    sheet.getRange(targetRow, 10).setValue('已拒絕');

    pushMessage(customerUid, [
      {
        type: 'text',
        text: '❌ 很抱歉，您的預約未通過。\n\n📋 訂單編號：' + orderId + '\n📍 地點：' + location + '\n📅 日期：' + bookingDate + ' ' + bookingTime + '\n🏌️ 課程：' + service + '\n\n歡迎重新選擇其他時段預約 🙏'
      }
    ]);

    replyMessage(replyToken, '❌ 已拒絕 ' + orderId + '，已通知顧客。');
  }
}

/* ═══════════════════════════════════════════════════════════
   sendStudentOrdersFlex — 學生查詢預約 (Flex Carousel)
   ═══════════════════════════════════════════════════════════ */
function sendStudentOrdersFlex(userId, replyToken) {
  var sheet = getSheet();
  var data  = sheet.getDataRange().getDisplayValues();

  var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  var validStatuses = ['待確認', '已確認'];
  var bubbles = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[2] !== userId) continue;
    if (row[5] < today) continue;
    if (validStatuses.indexOf(row[9]) === -1) continue;

    bubbles.push({
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: '🏌️ 預約詳情', weight: 'bold', color: '#1DB446', size: 'sm' },
          { type: 'text', text: row[7], weight: 'bold', size: 'xl', margin: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', contents: [
            { type: 'text', text: '📍 地點：' + row[4], size: 'sm', color: '#666666' },
            { type: 'text', text: '📅 日期：' + row[5], size: 'sm', color: '#666666' },
            { type: 'text', text: '⏰ 時間：' + row[6], size: 'sm', color: '#666666' },
            { type: 'text', text: '📌 狀態：' + row[9], size: 'sm', color: '#666666' },
            { type: 'text', text: '🆔 單號：' + row[0], size: 'xs', color: '#aaaaaa' }
          ]}
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', contents: [
          {
            type: 'button', style: 'link', color: '#E63946',
            action: { type: 'message', label: '❌ 取消預約 (2hr前)', text: '取消 ' + row[0] + ' ' }
          }
        ]
      }
    });
  }

  if (bubbles.length === 0) {
    replyMessage(replyToken, '📋 您目前沒有任何有效預約。\n\n👉 點擊連結立即預約：\n' + LIFF_URL);
    return;
  }

  // LINE Carousel 最多 12 個 bubble
  if (bubbles.length > 12) bubbles = bubbles.slice(0, 12);

  var flexMsg = {
    type: 'flex',
    altText: '📋 您的預約清單',
    contents: {
      type: 'carousel',
      contents: bubbles
    }
  };

  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_TOKEN
    },
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: [flexMsg]
    }),
    muteHttpExceptions: true
  });
}

/* ═══════════════════════════════════════════════════════════
   handleCancelOrder — 學生取消預約 (2 小時規則)
   格式: "取消 ORD-xxxxx 理由"
   ═══════════════════════════════════════════════════════════ */
function handleCancelOrder(text, userId, replyToken) {
  var parts = text.split(' ');
  var orderId = parts[1] || '';
  var reason  = parts.slice(2).join(' ') || '未提供理由';

  var sheet = getSheet();
  var data  = sheet.getDataRange().getDisplayValues();
  var targetRow = -1;

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) {
    replyMessage(replyToken, '⚠️ 找不到訂單 ' + orderId);
    return;
  }

  var row = data[targetRow - 1];

  // 權限檢查：只有本人可取消
  if (row[2] !== userId) {
    replyMessage(replyToken, '⚠️ 您無權取消此訂單。');
    return;
  }

  // 狀態檢查
  if (row[9] !== '待確認' && row[9] !== '已確認') {
    replyMessage(replyToken, '⚠️ 此訂單目前狀態為「' + row[9] + '」，無法取消。');
    return;
  }

  // 2 小時規則檢查
  var bookingDateTime = new Date(row[5] + 'T' + row[6] + ':00');
  var now = new Date();
  var diffMs = bookingDateTime.getTime() - now.getTime();
  var diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 2) {
    replyMessage(replyToken, '⚠️ 距離上課時間不足 2 小時，已無法自行取消。\n\n📞 如需取消，請直接聯繫教練：\n☎️ ' + COACH_PHONE);
    return;
  }

  // 執行取消
  sheet.getRange(targetRow, 10).setValue('已取消');
  sheet.getRange(targetRow, 13).setValue(reason);   // Cancel_Reason (col M = 13)

  // 若已確認，刪除日曆事件
  var eventId = row[10];
  if (eventId) {
    try {
      var calendar = CalendarApp.getCalendarById(CALENDAR_ID);
      var calEvent = calendar.getEventById(eventId);
      if (calEvent) calEvent.deleteEvent();
      sheet.getRange(targetRow, 11).setValue('');  // 清空 Event_ID
    } catch (err) {
      console.error('刪除日曆事件失敗:', err.message);
    }
  }

  // 通知學生
  replyMessage(replyToken, '✅ 訂單 ' + orderId + ' 已取消。\n\n如需重新預約，請點擊：\n' + LIFF_URL);

  // 通知教練
  pushMessage(ADMIN_UID, [
    {
      type: 'text',
      text: '🔔 學生取消通知\n\n📋 ' + orderId + '\n👤 ' + row[3] + '\n📍 ' + row[4] + '\n📅 ' + row[5] + ' ' + row[6] + '\n🏌️ ' + row[7] + '\n💬 理由：' + reason
    }
  ]);
}

/* ═══════════════════════════════════════════════════════════
   sendNightlyReminders — 每日 20:00 提醒學生明天有課
   ═══════════════════════════════════════════════════════════ */
function sendNightlyReminders() {
  var sheet = getSheet();
  var data  = sheet.getDataRange().getDisplayValues();

  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var tomorrowStr = Utilities.formatDate(tomorrow, 'Asia/Taipei', 'yyyy-MM-dd');

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[5] !== tomorrowStr) continue;
    if (row[9] !== '已確認') continue;
    if (row[11] === 'Y') continue;

    var mapsUrl = LOCATION_MAP[row[4]] || '';

    pushMessage(row[2], [
      {
        type: 'text',
        text: '🔔 明日課程提醒\n\n' + row[3] + ' 您好！\n明天有一堂課程，別忘了喔 😊\n\n📋 ' + row[0] + '\n📍 ' + row[4] + '\n⏰ ' + row[6] + '\n🏌️ ' + row[7] + '\n\n📍 導航：' + mapsUrl + '\n\n期待明天見面！⛳'
      }
    ]);

    sheet.getRange(i + 1, 12).setValue('Y');
  }
}

/* ═══════════════════════════════════════════════════════════
   sendCoachDailyDigest — 每日 21:00 推播教練明日行程
   ═══════════════════════════════════════════════════════════ */
function sendCoachDailyDigest() {
  var sheet = getSheet();
  var data  = sheet.getDataRange().getDisplayValues();

  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var tomorrowStr = Utilities.formatDate(tomorrow, 'Asia/Taipei', 'yyyy-MM-dd');

  var lessons = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[5] !== tomorrowStr) continue;
    if (row[9] !== '已確認') continue;

    lessons.push({
      time: row[6],
      name: row[3],
      location: row[4],
      service: row[7],
      orderId: row[0]
    });
  }

  if (lessons.length === 0) {
    pushMessage(ADMIN_UID, [
      { type: 'text', text: '📋 明日行程彙報\n\n' + tomorrowStr + '\n\n✅ 明天沒有排課，好好休息！💤' }
    ]);
    return;
  }

  // 依時間排序
  lessons.sort(function(a, b) { return a.time.localeCompare(b.time); });

  var lines = ['📋 明日行程彙報', '', tomorrowStr + '（共 ' + lessons.length + ' 堂課）', ''];
  for (var j = 0; j < lessons.length; j++) {
    var l = lessons[j];
    lines.push('⏰ ' + l.time + '  ' + l.name);
    lines.push('   📍 ' + l.location);
    lines.push('   🏌️ ' + l.service);
    lines.push('');
  }

  pushMessage(ADMIN_UID, [
    { type: 'text', text: lines.join('\n') }
  ]);
}

/* ═══════════════════════════════════════════════════════════
   LINE Messaging API Helpers
   ═══════════════════════════════════════════════════════════ */

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
