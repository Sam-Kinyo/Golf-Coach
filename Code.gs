/* ═══════════════════════════════════════════════════════════
   Golf Coach Booking System — Google Apps Script Backend
   Final Integrated Version
   ═══════════════════════════════════════════════════════════ */

/* ─── 全域常數 ─── */
const LINE_TOKEN    = 'yGE3DLwHsg6op/h9tYKe0ssJTHQ7A1732dFxxMSHWe9iUrTjV0YRddbtxnZuC/CitguV/fUNVydVJLQG15E4dMhaEocM6OBFjultU3ssSPLdDhnD44UBPz8Z87MBFBNZaPgtcMmgBGt2yO5PboPJKQdB04t89/1O/w1cDnyilFU=';
const ADMIN_UIDS    = ['U19f435262c62fcb5db8ea634495dc1c3', 'U6d5c702427918d5461fefb94d09c068c'];
const SHEET_ID      = '1X1vI1bZSeGs8OoizbhIkMfdWaoWBiwxfPJnduFHC0VI';
const CALENDAR_ID   = '169b4b3f981dae073642a157bb0b7ae1b1c09358e89c093aa9e9fbf4347bfa24@group.calendar.google.com';
const SHEET_NAME    = 'Orders';
const LIFF_URL      = 'https://liff.line.me/2009368868-R5zXPj93';
const COACH_PHONE   = '0966-293-193';

// 儲值相關 Sheet 與欄位設定
const SHEET_CREDIT_PACKAGES     = 'CreditPackages';
const SHEET_CREDIT_TRANSACTIONS = 'CreditTransactions';

// Orders Sheet 欄位索引（1-based）
const COL_ORDER_ID        = 1;
const COL_CREATE_TIME     = 2;
const COL_LINE_UID        = 3;
const COL_CUSTOMER_NAME   = 4;
const COL_LOCATION        = 5;
const COL_BOOKING_DATE    = 6;
const COL_BOOKING_TIME    = 7;
const COL_SERVICE_ITEM    = 8;
const COL_ESTIMATED_PRICE = 9;
const COL_STATUS          = 10;
const COL_EVENT_ID        = 11;
const COL_REMINDED        = 12;
const COL_CANCEL_REASON   = 13;
const COL_USED_PACKAGE_ID = 14; // 使用到的課程包 ID
const COL_USED_CREDITS    = 15; // 本次扣點數，通常為 1

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

function getCreditPackagesSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_CREDIT_PACKAGES);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_CREDIT_PACKAGES);
    sheet.appendRow([
      'Package_ID',      // [0]
      'LINE_UID',        // [1]
      'Customer_Name',   // [2]
      'Title',           // [3]
      'Total_Credits',   // [4]
      'Used_Credits',    // [5]
      'Remaining',       // [6]
      'Valid_From',      // [7]
      'Valid_To',        // [8]
      'Status',          // [9] active / expired / fully_used / cancelled
      'Course_Type',     // [10]
      'Created_At',      // [11]
      'Updated_At',      // [12]
      'Note'             // [13]
    ]);
  }
  return sheet;
}

function getCreditTransactionsSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_CREDIT_TRANSACTIONS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_CREDIT_TRANSACTIONS);
    sheet.appendRow([
      'Tx_ID',           // [0]
      'Package_ID',      // [1]
      'LINE_UID',        // [2]
      'Change',          // [3] 正數加點、負數扣點
      'Reason',          // [4] purchase / lesson_attended / manual_adjustment 等
      'Order_ID',        // [5] 關聯的預約單號
      'Created_At',      // [6]
      'Note'             // [7]
    ]);
  }
  return sheet;
}

function generateCreditId(prefix) {
  var ts = new Date().getTime().toString(36).toUpperCase();
  var rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return prefix + '-' + ts + rand;
}

function addCreditTransaction(lineUid, packageId, change, reason, orderId, note) {
  var sheet = getCreditTransactionsSheet();
  var txId = generateCreditId('TX');
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([
    txId,
    packageId,
    lineUid,
    change,
    reason,
    orderId || '',
    note || ''
  ]);
}

function listActiveCreditPackages(lineUid, courseType) {
  var sheet = getCreditPackagesSheet();
  var data = sheet.getDataRange().getDisplayValues();
  var todayStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  var active = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[1] !== lineUid) continue;

    var status = row[9] || 'active';
    if (status !== 'active') continue;

    var remaining = parseInt(row[6], 10) || 0;
    if (remaining <= 0) continue;

    var validTo = row[8];
    if (validTo && validTo < todayStr) {
      continue;
    }

    if (courseType && row[10] && row[10] !== courseType) {
      continue;
    }

    active.push({
      rowIndex: i + 1,
      packageId: row[0],
      title: row[3],
      total: parseInt(row[4], 10) || 0,
      used: parseInt(row[5], 10) || 0,
      remaining: remaining,
      validFrom: row[7],
      validTo: validTo,
      status: status,
      courseType: row[10],
      createdAt: row[11]
    });
  }

  active.sort(function(a, b) {
    if (a.validTo && b.validTo && a.validTo !== b.validTo) {
      return a.validTo < b.validTo ? -1 : 1;
    }
    if (!a.validTo && b.validTo) return 1;
    if (a.validTo && !b.validTo) return -1;
    if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? -1 : 1;
    }
    return 0;
  });

  return active;
}

function deductOneCreditForOrder(orderRowIndex, orderRow) {
  var lineUid = orderRow[COL_LINE_UID - 1];
  var service = orderRow[COL_SERVICE_ITEM - 1];
  var orderId = orderRow[COL_ORDER_ID - 1];
  var customerName = orderRow[COL_CUSTOMER_NAME - 1];

  var packages = listActiveCreditPackages(lineUid, service);
  if (packages.length === 0) {
    return {
      ok: false,
      message: '目前沒有可用的儲值課程包可扣點。'
    };
  }

  var target = packages[0];
  var sheet = getCreditPackagesSheet();

  var used = target.used + 1;
  var remaining = target.remaining - 1;
  var status = remaining <= 0 ? 'fully_used' : 'active';
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');

  sheet.getRange(target.rowIndex, 6).setValue(used);
  sheet.getRange(target.rowIndex, 7).setValue(remaining);
  sheet.getRange(target.rowIndex, 10).setValue(status);
  sheet.getRange(target.rowIndex, 13).setValue(now);

  addCreditTransaction(lineUid, target.packageId, -1, 'lesson_attended', orderId, '');

  var ordersSheet = getSheet();
  ordersSheet.getRange(orderRowIndex, COL_USED_PACKAGE_ID).setValue(target.packageId);
  ordersSheet.getRange(orderRowIndex, COL_USED_CREDITS).setValue(1);

  return {
    ok: true,
    packageId: target.packageId,
    title: target.title,
    remaining: remaining,
    customerName: customerName
  };
}

// 依 LINE_UID 直接扣 1 堂（無對應訂單）
function deductOneCreditByLineUid(lineUid, courseType, note, displayName, attendedDateIso) {
  var packages = listActiveCreditPackages(lineUid, courseType);
  if (packages.length === 0) {
    return {
      ok: false,
      message: '目前沒有可用的儲值課程包可扣點。'
    };
  }

  var target = packages[0];
  var sheet = getCreditPackagesSheet();

  var used = target.used + 1;
  var remaining = target.remaining - 1;
  var status = remaining <= 0 ? 'fully_used' : 'active';
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');

  sheet.getRange(target.rowIndex, 6).setValue(used);
  sheet.getRange(target.rowIndex, 7).setValue(remaining);
  sheet.getRange(target.rowIndex, 10).setValue(status);
  sheet.getRange(target.rowIndex, 13).setValue(now);

  var manualOrderId = attendedDateIso ? ('MANUAL-' + attendedDateIso) : '';
  addCreditTransaction(lineUid, target.packageId, -1, 'lesson_attended', manualOrderId, note || '');

  return {
    ok: true,
    packageId: target.packageId,
    title: target.title,
    remaining: remaining,
    displayName: displayName || '',
    attendedDate: attendedDateIso || ''
  };
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

  // 教練相關指令
  if (ADMIN_UIDS.includes(userId)) {
    if (/上課完成|.+\s+\d{1,2}\/\d{1,2}\s*(?:上課)?完成(?:\(\d+\))?|.+\s+\d{4}-\d{2}-\d{2}\s*(?:上課)?完成(?:\(\d+\))?/.test(text)) {
      handleLessonCompleteByNameAndDate(text, replyToken);
      return;
    }
    if (text.startsWith('開課 ')) {
      handleOpenPackageCommand(text, replyToken);
      return;
    }
    if (text.startsWith('查詢學員 ')) {
      handleLookupStudent(text, replyToken);
      return;
    }
    if (text.startsWith('核准 ') || text.startsWith('拒絕 ')) {
      handleApproval(text, replyToken);
      return;
    }
    if (text.startsWith('完成 ')) {
      handleLessonComplete(text, replyToken);
      return;
    }
    if (text === '查詢今日' || text === '查詢今天' || text === '查詢本日') {
      sendAdminOrdersSummaryForToday(replyToken);
      return;
    }
    if (text === '查詢明日' || text === '查詢明天' || text === '查詢隔日') {
      sendAdminOrdersSummaryForTomorrow(replyToken);
      return;
    }
    if (text.startsWith('查詢 ')) {
      sendAdminOrdersSummaryForRangeText(text, replyToken);
      return;
    }
    if (text.startsWith('管理取消 ')) {
      handleAdminCancelOrder(text, replyToken);
      return;
    }
    if (text === '排程今日' || text === '排程今天' || text === '今日排程') {
      sendAdminScheduleForToday(replyToken);
      return;
    }
    if (text === '排程明日' || text === '排程明天' || text === '明日排程') {
      sendAdminScheduleForTomorrow(replyToken);
      return;
    }
    if (text.startsWith('排程 ')) {
      sendAdminScheduleForDateText(text, replyToken);
      return;
    }
  }

  // 共用：使用教學
  if (text === '使用教學' || text === 'help' || text === '說明' || text === '教學') {
    sendUsageHelp(userId, replyToken);
    return;
  }

  // 學員確認課程方案
  if (text === '確認課程') {
    handleConfirmPackage(userId, replyToken);
    return;
  }
  if (text.startsWith('確認方案 ')) {
    handleConfirmSpecificPackage(userId, replyToken, text);
    return;
  }

  // 學生查詢預約
  if (text === '查詢預約' || text === '我的預約') {
    sendStudentOrdersFlex(userId, replyToken);
    return;
  }

  // 學生查詢儲值堂數
  if (text === '查詢堂數' || text === '我的堂數') {
    sendStudentCreditSummary(userId, replyToken);
    return;
  }

  // 學生取消預約: "取消 ORD-xxxxx 理由"
  if (text.startsWith('取消 ')) {
    handleCancelOrder(text, userId, replyToken);
    return;
  }

  // 預設回覆（含預約連結與指令提示）
  replyMessage(
    replyToken,
    '⛳ 歡迎使用高爾夫預約系統\n\n' +
    '👉 預約：' + LIFF_URL + '\n\n' +
    '查詢預約、我的堂數、確認課程\n' +
    '輸入「使用教學」看完整說明'
  );
}

/* ═══════════════════════════════════════════════════════════
   handleLessonComplete — 教練標記「課程已完成」並扣點
   指令格式：完成 ORD-xxxx
   ═══════════════════════════════════════════════════════════ */
function handleLessonComplete(text, replyToken) {
  var parts = text.split(' ');
  var orderId = parts[1];

  if (!orderId) {
    replyMessage(replyToken, '⚠️ 指令格式錯誤，請使用「完成 訂單編號」，例如：完成 ORD-XXXX');
    return;
  }

  var sheet = getSheet();
  var data = sheet.getDataRange().getDisplayValues();
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
  var status = row[COL_STATUS - 1];
  var lineUid = row[COL_LINE_UID - 1];

  if (status !== '已確認') {
    replyMessage(replyToken, '⚠️ 此訂單目前狀態為「' + status + '」，僅能對「已確認」的訂單標記為完成。');
    return;
  }

  var result = deductOneCreditForOrder(targetRow, row);

  if (!result.ok) {
    replyMessage(replyToken, '⚠️ 無法扣點：' + result.message + '\n\n請先在試算表的 CreditPackages 表單中建立 / 補足此學生的課程包，或與學生確認付款狀態。');
    return;
  }

  sheet.getRange(targetRow, COL_STATUS).setValue('已完成');

  var msgToCoach =
    '✅ 已將訂單 ' + orderId + ' 標記為「已完成」，並扣除 1 堂課程。\n\n' +
    '👤 學員：' + result.customerName + '\n' +
    '📦 方案：' + result.title + '\n' +
    '🎯 剩餘堂數：' + result.remaining;

  replyMessage(replyToken, msgToCoach);

  var msgToStudent =
    '✅ 本次課程已完成，我們已為您扣除 1 堂。\n\n' +
    '📦 方案：' + result.title + '\n' +
    '🎯 剩餘堂數：' + result.remaining + '\n\n' +
    '如對堂數有疑問，歡迎直接回覆此訊息詢問教練。';

  pushMessage(lineUid, [{ type: 'text', text: msgToStudent }]);
}

/* ═══════════════════════════════════════════════════════════
   handleLessonCompleteByNameAndDate — 依「姓名 + 日期」扣課
   範例：
   - sam kuo 3/10 完成(1)   → 扣 1 堂
   - sam kuo 3/10 完成(3)   → 扣 3 堂
   - 王小明 3/9 上課完成    → 扣 1 堂（舊格式）
   - 王小明 3/9 完成        → 扣 1 堂
   ═══════════════════════════════════════════════════════════ */
function handleLessonCompleteByNameAndDate(text, replyToken) {
  var match = text.match(/(.+?)\s+(\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})\s*(?:上課)?完成(?:\((\d+)\))?/);
  if (!match) {
    replyMessage(replyToken, '⚠️ 無法解析指令，請使用：\n・「姓名 月/日 完成(1)」扣 1 堂，例如：sam kuo 3/10 完成(1)\n・「姓名 月/日 完成(3)」扣 3 堂，例如：sam kuo 3/10 完成(3)');
    return;
  }

  var name = match[1].trim();
  var dateStr = match[2].trim();
  var count = match[3] ? parseInt(match[3], 10) : 1;
  if (isNaN(count) || count < 1) count = 1;

  var today = new Date();
  var year = today.getFullYear();
  var isoDate;
  if (dateStr.indexOf('/') !== -1) {
    var seg = dateStr.split('/');
    var m = parseInt(seg[0], 10);
    var d = parseInt(seg[1], 10);
    if (isNaN(m) || isNaN(d)) {
      replyMessage(replyToken, '⚠️ 日期格式錯誤，請使用「3/10」或「2026-03-10」這種格式。');
      return;
    }
    var mm = ('0' + m).slice(-2);
    var dd = ('0' + d).slice(-2);
    isoDate = year + '-' + mm + '-' + dd;
  } else {
    isoDate = dateStr;
  }

  var sheet = getSheet();
  var data = sheet.getDataRange().getDisplayValues();
  var candidates = [];

  // 僅在 count=1 時嘗試對應預約單
  if (count === 1) {
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rowName = (row[COL_CUSTOMER_NAME - 1] || '').trim();
      var rowDate = row[COL_BOOKING_DATE - 1];
      var status = row[COL_STATUS - 1];
      if (!rowName || !rowDate) continue;
      if (rowName !== name) continue;
      if (rowDate !== isoDate) continue;
      if (status !== '待確認' && status !== '已確認') continue;
      candidates.push({ rowIndex: i + 1, row: row });
    }

    if (candidates.length === 1) {
      var c = candidates[0];
      var orderId = c.row[COL_ORDER_ID - 1];
      handleLessonComplete('完成 ' + orderId, replyToken);
      return;
    }

    if (candidates.length > 1) {
      var lines = ['⚠️ 找到多筆符合條件的預約，請改用「完成 單號」指定要完成哪一筆：', ''];
      for (var j = 0; j < candidates.length; j++) {
        var r = candidates[j].row;
        lines.push('🆔 ' + r[COL_ORDER_ID - 1] + ' / ' + r[COL_BOOKING_DATE - 1] + ' ' + r[COL_BOOKING_TIME - 1] + ' / ' + r[COL_SERVICE_ITEM - 1]);
      }
      replyMessage(replyToken, lines.join('\n'));
      return;
    }
  }

  // 直接依姓名找學員的儲值方案並扣課
  var pkgSheet = getCreditPackagesSheet();
  var pkgData = pkgSheet.getDataRange().getDisplayValues();
  var uidSet = {};
  var nameTrim = name.trim();

  for (var k = 1; k < pkgData.length; k++) {
    var prow = pkgData[k];
    var pName = (prow[2] || '').trim();
    if (!pName) continue;
    if (pName === nameTrim || pName.indexOf(nameTrim) !== -1 || nameTrim.indexOf(pName) !== -1) {
      uidSet[prow[1]] = true;
    }
  }

  var candidateUids = Object.keys(uidSet);

  if (candidateUids.length === 0) {
    for (var m = data.length - 1; m >= 1; m--) {
      var drow = data[m];
      var dName = (drow[COL_CUSTOMER_NAME - 1] || '').trim();
      if (dName === nameTrim || dName.indexOf(nameTrim) !== -1 || nameTrim.indexOf(dName) !== -1) {
        uidSet[drow[COL_LINE_UID - 1]] = true;
      }
    }
    candidateUids = Object.keys(uidSet);
  }

  if (candidateUids.length === 0) {
    replyMessage(replyToken, '⚠️ 找不到姓名「' + name + '」對應的學員儲值方案，請確認姓名是否與預約或儲值紀錄一致，或改用「完成 ORD-XXXX」。');
    return;
  }

  if (candidateUids.length > 1) {
    replyMessage(replyToken, '⚠️ 有多位姓名包含「' + name + '」的學員，為避免扣錯堂數，請改用「完成 ORD-XXXX」或「開課 LINEID ...」指定對象。');
    return;
  }

  var targetUid = candidateUids[0];
  var deducted = 0;
  var lastResult = null;

  for (var n = 0; n < count; n++) {
    var result = deductOneCreditByLineUid(
      targetUid,
      null,
      'manual by name/date: ' + name + ' ' + isoDate + ' (第' + (n + 1) + '/' + count + '堂)',
      name,
      isoDate
    );
    if (!result.ok) break;
    deducted++;
    lastResult = result;
  }

  if (deducted === 0) {
    replyMessage(replyToken, '⚠️ 無法扣點：' + (lastResult ? lastResult.message : '目前沒有可用的儲值課程包可扣點。') + '\n\n請先確認此學員是否已有儲值課程包。');
    return;
  }

  var coachMsg =
    '✅ 已為「' + name + '」於 ' + isoDate + ' 扣除 ' + deducted + ' 堂課程。\n\n' +
    '📦 方案：' + (lastResult ? lastResult.title : '') + '\n' +
    '🎯 剩餘堂數：' + (lastResult ? lastResult.remaining : '');
  if (deducted < count) {
    coachMsg += '\n\n⚠️ 原欲扣除 ' + count + ' 堂，但剩餘堂數不足，僅成功扣除 ' + deducted + ' 堂。';
  }

  replyMessage(replyToken, coachMsg);

  var studentMsg =
    '✅ ' + isoDate + ' 的課程已完成，我們已為您扣除 ' + deducted + ' 堂。\n\n' +
    '📦 方案：' + (lastResult ? lastResult.title : '') + '\n' +
    '🎯 剩餘堂數：' + (lastResult ? lastResult.remaining : '') + '\n\n' +
    '如對堂數有疑問，歡迎輸入「我的堂數」查看或直接回覆此訊息詢問教練。';

  pushMessage(targetUid, [{ type: 'text', text: studentMsg }]);
}

/* ─── 依「學員姓名」或「LINE UID」解析出 LINE_UID ─── */
function resolveLineUidFromNameOrUid(identifier) {
  if (!identifier) return { ok: false, error: '未提供學員識別' };
  var id = String(identifier).trim();
  // LINE UID 通常以 U 開頭、約 33 字元、英數字
  if (id.match(/^U[a-zA-Z0-9]{15,50}$/)) {
    return { ok: true, uid: id, name: '' };
  }
  // 當作學員姓名，從 Orders 與 CreditPackages 查詢
  var uidMap = {};
  var nameFound = '';
  var ordersData = getSheet().getDataRange().getDisplayValues();
  for (var i = 1; i < ordersData.length; i++) {
    var row = ordersData[i];
    var n = row[COL_CUSTOMER_NAME - 1] || '';
    if (n === id || n.indexOf(id) !== -1 || id.indexOf(n) !== -1) {
      uidMap[row[COL_LINE_UID - 1]] = true;
      if (!nameFound) nameFound = n;
    }
  }
  var pkgData = getCreditPackagesSheet().getDataRange().getDisplayValues();
  for (var j = 1; j < pkgData.length; j++) {
    var prow = pkgData[j];
    var pn = prow[2] || '';
    if (pn === id || pn.indexOf(id) !== -1 || id.indexOf(pn) !== -1) {
      uidMap[prow[1]] = true;
      if (!nameFound) nameFound = pn;
    }
  }
  var uids = Object.keys(uidMap);
  if (uids.length === 0) {
    return { ok: false, error: '找不到姓名「' + id + '」對應的學員。請確認該學員是否曾透過 LIFF 預約過，或改用 LINE UID。' };
  }
  if (uids.length > 1) {
    return { ok: false, error: '有多位姓名包含「' + id + '」的學員，請改用「開課 LINE_UID 方案名稱 堂數」指定。可輸入「查詢學員 ' + id + '」查看對應的 LINE UID。', uids: uids };
  }
  return { ok: true, uid: uids[0], name: nameFound || id };
}

/* ═══════════════════════════════════════════════════════════
   handleLookupStudent — 查詢學員姓名對應的 LINE UID
   指令：查詢學員 王小明
   ═══════════════════════════════════════════════════════════ */
function handleLookupStudent(text, replyToken) {
  var name = text.substring(5).trim(); // 去掉「查詢學員」
  if (!name) {
    replyMessage(replyToken, '⚠️ 請輸入「查詢學員 姓名」，例如：查詢學員 王小明');
    return;
  }

  var uidMap = {};
  var nameToUid = {};
  var ordersData = getSheet().getDataRange().getDisplayValues();
  for (var i = 1; i < ordersData.length; i++) {
    var row = ordersData[i];
    var n = row[COL_CUSTOMER_NAME - 1] || '';
    var uid = row[COL_LINE_UID - 1];
    if (n && (n === name || n.indexOf(name) !== -1 || name.indexOf(n) !== -1)) {
      uidMap[uid] = uidMap[uid] || [];
      uidMap[uid].push(n);
      nameToUid[n] = uid;
    }
  }
  var pkgData = getCreditPackagesSheet().getDataRange().getDisplayValues();
  for (var j = 1; j < pkgData.length; j++) {
    var prow = pkgData[j];
    var pn = prow[2] || '';
    var uid = prow[1];
    if (pn && (pn === name || pn.indexOf(name) !== -1 || name.indexOf(pn) !== -1)) {
      uidMap[uid] = uidMap[uid] || [];
      uidMap[uid].push(pn);
      nameToUid[pn] = uid;
    }
  }

  var uids = Object.keys(uidMap);
  if (uids.length === 0) {
    replyMessage(replyToken, '⚠️ 找不到姓名「' + name + '」對應的學員。請確認該學員是否曾透過 LIFF 預約過。');
    return;
  }

  var lines = ['📋 學員「' + name + '」對應結果：', ''];
  for (var k = 0; k < uids.length; k++) {
    var uid = uids[k];
    var names = uidMap[uid];
    var displayName = names[0] || '';
    lines.push('👤 ' + displayName);
    lines.push('   LINE UID：' + uid);
    lines.push('');
  }
  lines.push('💡 開課時可輸入「開課 ' + name + ' 方案名稱 堂數」直接對應。');
  replyMessage(replyToken, lines.join('\n'));
}

/* ═══════════════════════════════════════════════════════════
   handleOpenPackageCommand — 教練以指令開通儲值課程包
   指令格式：開課 [學員姓名 或 LINE_UID] 方案名稱 堂數
   範例：開課 王小明 10堂一對一 10
   範例：開課 Uxxxxxxxxxx 10堂一對一 10
   ═══════════════════════════════════════════════════════════ */
function handleOpenPackageCommand(text, replyToken) {
  var parts = text.split(' ');
  if (parts.length < 4) {
    replyMessage(replyToken, '⚠️ 指令格式錯誤，請使用「開課 學員姓名 方案名稱 堂數」，例如：\n開課 王小明 10堂一對一 10\n\n（學員姓名可用 LINE 顯示名稱，系統會自動對應；若有多位同名，請改用 LINE UID）');
    return;
  }

  var identifier = parts[1];
  var creditStr = parts[parts.length - 1];
  var titleParts = parts.slice(2, parts.length - 1);
  var title = titleParts.join(' ');

  var totalCredits = parseInt(creditStr, 10);
  if (!identifier || !title || isNaN(totalCredits) || totalCredits <= 0) {
    replyMessage(replyToken, '⚠️ 開課參數有誤，請確認學員姓名與堂數。\n範例：開課 王小明 10堂一對一 10');
    return;
  }

  var resolved = resolveLineUidFromNameOrUid(identifier);
  if (!resolved.ok) {
    replyMessage(replyToken, '⚠️ ' + resolved.error);
    return;
  }

  var lineUid = resolved.uid;
  var customerName = resolved.name;

  var sheet = getCreditPackagesSheet();
  var pkgId = generateCreditId('PKG');
  var todayIso = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');

  // 若尚未有 customerName，從歷史訂單補抓
  if (!customerName) {
    var ordersSheet = getSheet();
    var data = ordersSheet.getDataRange().getDisplayValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][COL_LINE_UID - 1] === lineUid) {
        customerName = data[i][COL_CUSTOMER_NAME - 1];
        break;
      }
    }
  }

  sheet.appendRow([
    pkgId,          // Package_ID
    lineUid,        // LINE_UID
    customerName,   // Customer_Name
    title,          // Title
    totalCredits,   // Total_Credits
    0,              // Used_Credits
    totalCredits,   // Remaining
    todayIso,       // Valid_From
    '',             // Valid_To
    'pending_confirm', // Status
    '',             // Course_Type
    now,            // Created_At
    now,            // Updated_At
    'created by command' // Note
  ]);

  addCreditTransaction(lineUid, pkgId, totalCredits, 'purchase', '', '開課指令：' + title);

  // 通知學員有新方案待確認
  var studentMsg =
    '📦 教練已為您開通一個新的儲值課程方案（待確認）：\n\n' +
    '方案：' + title + '\n' +
    '堂數：' + totalCredits + ' 堂\n\n' +
    '如內容無誤，請輸入「確認課程」啟用本方案。';

  pushMessage(lineUid, [
    { type: 'text', text: studentMsg, }
  ], [
    {
      type: 'action',
      action: { type: 'message', label: '✅ 確認課程', text: '確認課程' }
    }
  ]);

  var coachMsg =
    '✅ 已為學員' + (customerName ? '「' + customerName + '」' : '') + ' 建立儲值方案：\n\n' +
    'Package_ID：' + pkgId + '\n' +
    '方案名稱：' + title + '\n' +
    '總堂數：' + totalCredits + '\n\n' +
    '學員需輸入「確認課程」後才會正式啟用。';

  replyMessage(replyToken, coachMsg);
}

/* ═══════════════════════════════════════════════════════════
   學員確認 pending_confirm 的課程包為 active
   指令：
   - 確認課程  （若僅一筆待確認）
   - 確認方案 Package_ID （當有多筆待確認時）
   ═══════════════════════════════════════════════════════════ */
function handleConfirmPackage(userId, replyToken) {
  var sheet = getCreditPackagesSheet();
  var data = sheet.getDataRange().getDisplayValues();
  var pending = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[1] === userId && row[9] === 'pending_confirm') {
      pending.push({ rowIndex: i + 1, row: row });
    }
  }

  if (pending.length === 0) {
    replyMessage(replyToken, '目前沒有任何待確認的儲值課程方案。若有疑問，請直接聯繫教練。');
    return;
  }

  if (pending.length === 1) {
    var p = pending[0];
    activatePackageRow(sheet, p.rowIndex, p.row, replyToken);
    return;
  }

  var lines = ['您有多筆待確認的儲值課程，請回覆「確認方案 Package_ID」指定要啟用哪一筆：', ''];
  for (var j = 0; j < pending.length; j++) {
    var r = pending[j].row;
    lines.push('Package_ID：' + r[0]);
    lines.push('方案名稱：' + r[3] + '（' + r[6] + ' / ' + r[4] + ' 堂）');
    lines.push('');
  }

  replyMessage(replyToken, lines.join('\n'));
}

function handleConfirmSpecificPackage(userId, replyToken, text) {
  var parts = text.split(' ');
  if (parts.length < 2) {
    replyMessage(replyToken, '⚠️ 請輸入「確認方案 Package_ID」，例如：確認方案 PKG-XXXX');
    return;
  }
  var pkgId = parts[1];

  var sheet = getCreditPackagesSheet();
  var data = sheet.getDataRange().getDisplayValues();
  var targetRow = -1;
  var target;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[0] === pkgId && row[1] === userId && row[9] === 'pending_confirm') {
      targetRow = i + 1;
      target = row;
      break;
    }
  }

  if (targetRow === -1) {
    replyMessage(replyToken, '⚠️ 找不到對應的待確認方案，請確認 Package_ID 是否正確，或輸入「確認課程」查看目前待確認列表。');
    return;
  }

  activatePackageRow(sheet, targetRow, target, replyToken);
}

function activatePackageRow(sheet, rowIndex, row, replyToken) {
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  sheet.getRange(rowIndex, 10).setValue('active');   // Status
  sheet.getRange(rowIndex, 13).setValue(now);        // Updated_At

  var title = row[3];
  var total = row[4];
  var remaining = row[6];

  var msg =
    '✅ 您的儲值課程已啟用：\n\n' +
    '方案：' + title + '\n' +
    '總堂數：' + total + ' 堂\n' +
    '目前剩餘：' + remaining + ' 堂\n\n' +
    '之後每次上課完成，教練確認後系統會自動為您扣除堂數。';

  replyMessage(replyToken, msg);
}

/* ═══════════════════════════════════════════════════════════
   sendStudentCreditSummary — 學生查詢目前儲值堂數
   ═══════════════════════════════════════════════════════════ */
function sendStudentCreditSummary(userId, replyToken) {
  var packages = listActiveCreditPackages(userId, null);

  if (packages.length === 0) {
    replyMessage(replyToken, '📋 您目前沒有可用的儲值課程包。\n\n如需購買或確認方案，請直接聯繫教練。');
    return;
  }

  var lines = ['📋 您目前的儲值課程：', ''];
  var totalRemaining = 0;

  for (var i = 0; i < packages.length; i++) {
    var p = packages[i];
    totalRemaining += p.remaining;
    var title = p.title || (p.courseType || '課程方案');
    var validText = p.validTo ? ('，到期日：' + p.validTo) : '（無到期日）';
    lines.push('🏌️ ' + title);
    lines.push('   剩餘：' + p.remaining + ' / ' + p.total + ' 堂' + validText);
    lines.push('');
  }

  lines.push('🎯 總剩餘堂數：' + totalRemaining + ' 堂');

  replyMessage(replyToken, lines.join('\n'));
}

/* ═══════════════════════════════════════════════════════════
   Admin — 查詢預約總覽（今天 / 明天 / 區間）
   ═══════════════════════════════════════════════════════════ */
function sendAdminOrdersSummaryForToday(replyToken) {
  var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  sendAdminOrdersSummaryForRange(today, today, '今日', replyToken);
}

function sendAdminOrdersSummaryForTomorrow(replyToken) {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  var tomorrow = Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd');
  sendAdminOrdersSummaryForRange(tomorrow, tomorrow, '明日', replyToken);
}

// 文字格式示例: "查詢 3/12-3/15"
function sendAdminOrdersSummaryForRangeText(text, replyToken) {
  var raw = text.substring(3).trim(); // 去掉「查詢」
  if (!raw) {
    replyMessage(replyToken, '⚠️ 請輸入日期區間，例如：查詢 3/12-3/15');
    return;
  }

  var parts = raw.split('-');
  if (parts.length !== 2) {
    replyMessage(replyToken, '⚠️ 日期格式錯誤，請使用「3/12-3/15」這種格式。');
    return;
  }

  var fromStr = parts[0].trim();
  var toStr = parts[1].trim();

  var year = new Date().getFullYear();
  function mdToIso(md) {
    var seg = md.split('/');
    if (seg.length !== 2) return null;
    var m = parseInt(seg[0], 10);
    var d = parseInt(seg[1], 10);
    if (isNaN(m) || isNaN(d)) return null;
    var mm = ('0' + m).slice(-2);
    var dd = ('0' + d).slice(-2);
    return year + '-' + mm + '-' + dd;
  }

  var fromIso = mdToIso(fromStr);
  var toIso = mdToIso(toStr);

  if (!fromIso || !toIso) {
    replyMessage(replyToken, '⚠️ 無法解析日期，請使用「3/12-3/15」這種格式。');
    return;
  }

  if (fromIso > toIso) {
    var tmp = fromIso;
    fromIso = toIso;
    toIso = tmp;
  }

  var label = fromIso + ' ~ ' + toIso;
  sendAdminOrdersSummaryForRange(fromIso, toIso, label, replyToken);
}

function sendAdminOrdersSummaryForRange(fromDate, toDate, label, replyToken) {
  var sheet = getSheet();
  var data = sheet.getDataRange().getDisplayValues();
  var rows = [];

  var validStatuses = ['待確認', '已確認', '已完成'];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var date = row[COL_BOOKING_DATE - 1];
    var status = row[COL_STATUS - 1];
    if (!date) continue;
    if (date < fromDate || date > toDate) continue;
    if (validStatuses.indexOf(status) === -1) continue;

    rows.push({
      date: date,
      time: row[COL_BOOKING_TIME - 1],
      name: row[COL_CUSTOMER_NAME - 1],
      location: row[COL_LOCATION - 1],
      service: row[COL_SERVICE_ITEM - 1],
      status: status,
      orderId: row[COL_ORDER_ID - 1]
    });
  }

  if (rows.length === 0) {
    replyMessage(replyToken, '📋 在「' + label + '」區間內沒有任何預約。');
    return;
  }

  rows.sort(function(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return 0;
  });

  var lines = ['📋 預約總覽（' + label + '）', '共 ' + rows.length + ' 筆', ''];
  for (var j = 0; j < rows.length; j++) {
    var r = rows[j];
    lines.push('📅 ' + r.date + ' ' + r.time);
    lines.push('👤 ' + r.name);
    lines.push('📍 ' + r.location);
    lines.push('🏌️ ' + r.service);
    lines.push('📌 狀態：' + r.status);
    lines.push('🆔 ' + r.orderId);
    lines.push('');
  }

  replyMessage(replyToken, lines.join('\n'));
}

/* ═══════════════════════════════════════════════════════════
   Admin — 單日排程（更精簡格式）
   指令：
   - 排程今日 / 排程今天 / 今日排程
   - 排程明日 / 排程明天 / 明日排程
   - 排程 3/12  （查詢當年度 3/12 的排程）
   ═══════════════════════════════════════════════════════════ */
function sendAdminScheduleForToday(replyToken) {
  var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  sendAdminScheduleForDate(today, '今日', replyToken);
}

function sendAdminScheduleForTomorrow(replyToken) {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  var tomorrow = Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd');
  sendAdminScheduleForDate(tomorrow, '明日', replyToken);
}

// 文字格式: "排程 3/12"
function sendAdminScheduleForDateText(text, replyToken) {
  var raw = text.substring(3).trim(); // 去掉「排程」
  if (!raw) {
    replyMessage(replyToken, '⚠️ 請輸入日期，例如：排程 3/12');
    return;
  }

  var year = new Date().getFullYear();
  var seg = raw.split('/');
  if (seg.length !== 2) {
    replyMessage(replyToken, '⚠️ 日期格式錯誤，請使用「3/12」這種格式。');
    return;
  }

  var m = parseInt(seg[0], 10);
  var d = parseInt(seg[1], 10);
  if (isNaN(m) || isNaN(d)) {
    replyMessage(replyToken, '⚠️ 無法解析日期，請使用「3/12」這種格式。');
    return;
  }

  var mm = ('0' + m).slice(-2);
  var dd = ('0' + d).slice(-2);
  var iso = year + '-' + mm + '-' + dd;
  var label = iso;
  sendAdminScheduleForDate(iso, label, replyToken);
}

function sendAdminScheduleForDate(targetDate, label, replyToken) {
  var sheet = getSheet();
  var data = sheet.getDataRange().getDisplayValues();
  var rows = [];

  var validStatuses = ['待確認', '已確認', '已完成'];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var date = row[COL_BOOKING_DATE - 1];
    var status = row[COL_STATUS - 1];
    if (!date) continue;
    if (date !== targetDate) continue;
    if (validStatuses.indexOf(status) === -1) continue;

    rows.push({
      time: row[COL_BOOKING_TIME - 1],
      name: row[COL_CUSTOMER_NAME - 1],
      location: row[COL_LOCATION - 1],
      service: row[COL_SERVICE_ITEM - 1],
      status: status,
      orderId: row[COL_ORDER_ID - 1]
    });
  }

  if (rows.length === 0) {
    replyMessage(replyToken, '📋 ' + label + ' 沒有任何預約排程。');
    return;
  }

  rows.sort(function(a, b) {
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return 0;
  });

  var lines = ['📅 ' + label + ' 排程（共 ' + rows.length + ' 堂）', ''];
  for (var j = 0; j < rows.length; j++) {
    var r = rows[j];
    lines.push(
      r.time + '  ' + r.name + ' / ' + r.service + ' / ' + r.location + ' / ' + r.status + ' / ' + r.orderId
    );
  }

  replyMessage(replyToken, lines.join('\n'));
}

/* ═══════════════════════════════════════════════════════════
   共用：使用教學（學員 + 教練）
   ⚠️ 新增功能時請同步更新此函式內容
   ═══════════════════════════════════════════════════════════ */
function sendUsageHelp(userId, replyToken) {
  var isAdmin = ADMIN_UIDS.includes(userId);
  var lines = [];

  lines.push('📖 使用教學');
  lines.push('');

  if (isAdmin) {
    // 教練專用
    lines.push('━━━ 教練 ━━━');
    lines.push('');
    lines.push('審核  「核准 單號」或「拒絕 單號」');
    lines.push('');
    lines.push('查詢  「查詢今日」「查詢明日」「查詢 3/12-3/15」');
    lines.push('排程  「排程今日」「排程明日」「排程 3/12」');
    lines.push('');
    lines.push('核銷  「完成 單號」');
    lines.push('      「姓名 日期 完成(N)」例：sam kuo 3/10 完成(1)');
    lines.push('');
    lines.push('開課  「開課 學員姓名 方案 堂數」');
    lines.push('      例：開課 王小明 10堂一對一 10');
    lines.push('');
    lines.push('取消  「管理取消 單號 理由」');
    lines.push('查人  「查詢學員 姓名」');
    lines.push('');
    lines.push('提醒  每日 21:00 自動提醒學生明日課程');
  } else {
    // 學員專用
    lines.push('━━━ 學員 ━━━');
    lines.push('');
    lines.push('預約  點連結選地點、課程、日期時間');
    lines.push('查詢  「查詢預約」或「我的預約」');
    lines.push('取消  「取消 單號 理由」或按卡片按鈕（需 2hr 前）');
    lines.push('堂數  「我的堂數」或「查詢堂數」');
    lines.push('確認  「確認課程」啟用教練開通的儲值方案');
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━');
  lines.push('💡 輸入「使用教學」可隨時查看');

  replyMessage(replyToken, lines.join('\n'));
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
  ADMIN_UIDS.forEach(uid => {
    pushMessage(uid, [
      {
        type: 'text',
        text: '📩 新預約待審核\n\n📋 ' + orderId + '\n👤 ' + data.name + '\n📍 ' + data.location + '\n📅 ' + data.date + ' ' + data.time + '\n🏌️ ' + data.service + '\n\n請回覆「核准 ' + orderId + '」或「拒絕 ' + orderId + '」'
      }
    ], [
      { type: 'action', action: { type: 'message', label: '✅ 核准', text: '核准 ' + orderId } },
      { type: 'action', action: { type: 'message', label: '❌ 拒絕', text: '拒絕 ' + orderId } }
    ]);
  });

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
  ADMIN_UIDS.forEach(uid => {
    pushMessage(uid, [
      {
        type: 'text',
        text: '🔔 學生取消通知\n\n📋 ' + orderId + '\n👤 ' + row[3] + '\n📍 ' + row[4] + '\n📅 ' + row[5] + ' ' + row[6] + '\n🏌️ ' + row[7] + '\n💬 理由：' + reason
      }
    ]);
  });
}

/* ═══════════════════════════════════════════════════════════
   handleAdminCancelOrder — 管理員直接取消預約（無 2 小時限制）
   指令格式: "管理取消 ORD-xxxxx 理由(可省略)"
   ═══════════════════════════════════════════════════════════ */
function handleAdminCancelOrder(text, replyToken) {
  var parts = text.split(' ');
  var orderId = parts[1] || '';
  var reason = parts.slice(2).join(' ') || '管理員手動取消';

  if (!orderId) {
    replyMessage(replyToken, '⚠️ 指令格式錯誤，請使用「管理取消 訂單編號」，例如：管理取消 ORD-XXXX');
    return;
  }

  var sheet = getSheet();
  var data = sheet.getDataRange().getDisplayValues();
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
  var currentStatus = row[9];

  if (currentStatus === '已取消' || currentStatus === '已拒絕') {
    replyMessage(replyToken, '⚠️ 此訂單目前狀態為「' + currentStatus + '」，無需再次取消。');
    return;
  }

  sheet.getRange(targetRow, 10).setValue('已取消');
  sheet.getRange(targetRow, 13).setValue(reason);

  var eventId = row[10];
  if (eventId) {
    try {
      var calendar = CalendarApp.getCalendarById(CALENDAR_ID);
      var calEvent = calendar.getEventById(eventId);
      if (calEvent) calEvent.deleteEvent();
      sheet.getRange(targetRow, 11).setValue('');
    } catch (err) {
      console.error('管理員刪除日曆事件失敗:', err.message);
    }
  }

  var userId = row[2];
  var msgToStudent =
    '❌ 您的一筆預約已由教練取消。\n\n' +
    '📋 訂單編號：' + orderId + '\n' +
    '📍 地點：' + row[4] + '\n' +
    '📅 日期：' + row[5] + ' ' + row[6] + '\n' +
    '🏌️ 課程：' + row[7] + '\n' +
    '💬 理由：' + reason + '\n\n' +
    '如有任何疑問，歡迎直接回覆此訊息與教練聯絡。';

  pushMessage(userId, [{ type: 'text', text: msgToStudent }]);

  replyMessage(replyToken, '✅ 已為您取消訂單 ' + orderId + '。');
}

/* ═══════════════════════════════════════════════════════════
   sendNightlyReminders — 每日 21:00 提醒學生明天有課
   首次使用：執行 setupStudentReminderTrigger() 建立每日 21:00 排程
   ═══════════════════════════════════════════════════════════ */
function setupStudentReminderTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendNightlyReminders') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('sendNightlyReminders')
    .timeBased()
    .everyDays(1)
    .atHour(21)
    .create();
  Logger.log('已設定每日 21:00 學生上課提醒');
}

function sendNightlyReminders() {
  var sheet = getSheet();
  var data  = sheet.getDataRange().getDisplayValues();

  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var tomorrowStr = Utilities.formatDate(tomorrow, 'Asia/Taipei', 'yyyy-MM-dd');

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[COL_BOOKING_DATE - 1] !== tomorrowStr) continue;
    if (row[COL_STATUS - 1] !== '已確認') continue;
    if (row[COL_REMINDED - 1] === 'Y') continue;

    var mapsUrl = LOCATION_MAP[row[COL_LOCATION - 1]] || '';

    pushMessage(row[COL_LINE_UID - 1], [
      {
        type: 'text',
        text: '🔔 明日課程提醒\n\n' + row[COL_CUSTOMER_NAME - 1] + ' 您好！\n明天有一堂課程，別忘了喔 😊\n\n📋 ' + row[COL_ORDER_ID - 1] + '\n📍 ' + row[COL_LOCATION - 1] + '\n⏰ ' + row[COL_BOOKING_TIME - 1] + '\n🏌️ ' + row[COL_SERVICE_ITEM - 1] + '\n\n📍 導航：' + mapsUrl + '\n\n期待明天見面！⛳'
      }
    ]);

    sheet.getRange(i + 1, COL_REMINDED).setValue('Y');
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
    ADMIN_UIDS.forEach(uid => {
      pushMessage(uid, [
        { type: 'text', text: '📋 明日行程彙報\n\n' + tomorrowStr + '\n\n✅ 明天沒有排課，好好休息！💤' }
      ]);
    });
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

  ADMIN_UIDS.forEach(uid => {
    pushMessage(uid, [
      { type: 'text', text: lines.join('\n') }
    ]);
  });
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
