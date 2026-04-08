import { WebhookEvent } from '@line/bot-sdk';
import { replyMessage, replyButtons, isCoach, getLineClient } from '../services/line';
import { getBookingsByUser, getBookingsByDate, getBooking, approveBooking, rejectBooking, cancelBooking } from '../services/booking';
import { getActivePackages } from '../services/package';
import { env } from '../config/env';
import { getUser, setAlias, getOrCreateUser } from '../services/user';
import { notifyStudentBookingApproved, notifyStudentBookingRejected, notifyCoachesStudentCancelled } from '../services/notification';
import { getFixedSessionsOnDate } from '../services/fixedSchedule';

const LIFF_COACH_URL = env.liff.coachId ? `https://liff.line.me/${env.liff.coachId}` : '';
// 學員與教練共用同一個 LIFF（依身分自動顯示對應介面）
const LIFF_STUDENT_URL = LIFF_COACH_URL;

export async function handleWebhookEvent(event: WebhookEvent, reply: any): Promise<void> {
  const replyToken = 'replyToken' in event ? event.replyToken : '';
  const userId = (event.source as any).userId;
  if (!userId || !replyToken) return;

  if (event.type === 'postback') {
    await handlePostback(userId, event, replyToken);
    return;
  }

  if (event.type !== 'message' || event.message.type !== 'text') return;
  const text = (event.message as any).text?.trim() ?? '';
  if (isCoach(userId)) {
    await handleCoachMessage(userId, text, replyToken);
  } else {
    await handleStudentMessage(userId, text, replyToken);
  }
}

async function handlePostback(userId: string, event: WebhookEvent, replyToken: string): Promise<void> {
  if (event.type !== 'postback') return;
  const rawData = (event.postback as any)?.data ?? '';
  const params = new URLSearchParams(rawData);
  const action = params.get('action');

  if (action === 'cancel_fixed_session') {
    if (!isCoach(userId)) {
      await replyMessage(replyToken, '此操作僅限教練使用。');
      return;
    }
    const date = params.get('date');
    const startTime = params.get('startTime');
    const endTime = params.get('endTime');
    if (!date || !startTime || !endTime) return;
    try {
      const { addLeave } = require('../services/coachLeave');
      await addLeave(date, startTime, date, endTime, '取消固定排班');
      await replyMessage(replyToken, `✅ 已幫您把 ${date} ${startTime}－${endTime} 的固定時段改為休假。`);
    } catch (e) {
      await replyMessage(replyToken, '取消失敗，請確認時間格式。');
    }
    return;
  }

  if (action === 'student_cancel') {
    const bookingId = params.get('bookingId');
    if (!bookingId) return;
    const booking = await getBooking(bookingId);
    if (!booking) {
      await replyMessage(replyToken, '找不到該筆預約。');
      return;
    }
    if (booking.userId !== userId) {
      await replyMessage(replyToken, '您無權取消這筆預約。');
      return;
    }
    if (booking.status === 'cancelled' || booking.status === 'rejected') {
      await replyMessage(replyToken, '這筆預約已經取消囉。');
      return;
    }
    await cancelBooking(bookingId, '學員自行從 LINE 查詢取消');
    await notifyCoachesStudentCancelled({
      bookingId,
      userId: booking.userId,
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      location: booking.location,
      service: booking.service,
    });
    await replyMessage(replyToken, `✅ 已為您取消 ${booking.bookingDate} ${booking.startTime} 的預約。`);
    return;
  }

  if (action === 'booking_decision') {
    if (!isCoach(userId)) {
      await replyMessage(replyToken, '此操作僅限教練使用。');
      return;
    }
    const decision = params.get('decision');
    const bookingId = params.get('bookingId');
    if (!decision || !bookingId) {
      await replyMessage(replyToken, '操作失敗：缺少預約資訊。');
      return;
    }

    const booking = await getBooking(bookingId);
    if (!booking) {
      await replyMessage(replyToken, '找不到該筆預約，可能已被處理。');
      return;
    }

    if (booking.status !== 'pending' && booking.status !== 'approved') {
      const statusText =
        booking.status === 'rejected' || booking.status === 'cancelled'
          ? '已取消'
          : booking.status;
      await replyMessage(replyToken, `這筆預約目前狀態為「${statusText}」，無法操作。`);
      return;
    }

    if (decision === 'approve') {
      await approveBooking(bookingId);
      await notifyStudentBookingApproved({
        bookingId,
        userId: booking.userId,
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        location: booking.location,
        service: booking.service,
      });
      await replyMessage(replyToken, `已確認預約：${booking.bookingDate} ${booking.startTime}`);
      return;
    }

    if (decision === 'reject') {
      await rejectBooking(bookingId);
      await notifyStudentBookingRejected({
        bookingId,
        userId: booking.userId,
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        location: booking.location,
        service: booking.service,
      });
      await replyMessage(replyToken, `已取消此預約，並通知學員改約時間。`);
    }
    return;
  }
}

async function handleCoachMessage(userId: string, text: string, replyToken: string): Promise<void> {
  if (text === '使用教學' || text === 'help' || text === '說明') {
    if (LIFF_COACH_URL) {
      await replyButtons(
        replyToken,
        getCoachHelp(),
        '👉 開啟教練後台',
        LIFF_COACH_URL
      );
    } else {
      await replyMessage(replyToken, getCoachHelp());
    }
    return;
  }
  if (text === '查詢今日' || text === '查詢今天') {
    const today = new Date().toISOString().slice(0, 10);
    const bookings = await getBookingsByDate(today);
    await replyCoachScheduleFlex(replyToken, '今日行程', today, bookings);
    return;
  }
  if (text === '查詢明日' || text === '查詢明天') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const dateStr = d.toISOString().slice(0, 10);
    const bookings = await getBookingsByDate(dateStr);
    await replyCoachScheduleFlex(replyToken, '明日行程', dateStr, bookings);
    return;
  }
  if (text.startsWith('查詢紀錄')) {
    const targetName = text.replace('查詢紀錄', '').trim();
    if (!targetName) {
      await replyMessage(replyToken, '請輸入完整的指令，例如：查詢紀錄 王小明');
      return;
    }
    const { listStudentsWithAlias } = require('../services/user');
    const students = await listStudentsWithAlias();
    const target = (students as any[]).find(s => (s.alias || s.displayName || '').includes(targetName));
    if (!target) {
      await replyMessage(replyToken, `找不到名字包含「${targetName}」的學員。`);
      return;
    }
    await replyStudentHistoryFlex(replyToken, target.lineUserId, userId, target.alias || target.displayName || targetName);
    return;
  }
  // 教練後台、LIFF、開課、扣課、核銷、休假 → 顯示按鈕
  if (
    text === '教練後台' ||
    text.toLowerCase() === 'liff' ||
    text === '開課' ||
    text === '扣課' ||
    text === '核銷' ||
    text === '休假'
  ) {
    if (LIFF_COACH_URL) {
      await replyButtons(
        replyToken,
        '點擊下方按鈕開啟教練後台，可進行扣課/加課、學員明細、休假設定。',
        '👉 開啟教練後台',
        LIFF_COACH_URL
      );
    } else {
      await replyMessage(replyToken, '請輸入「使用教學」查看教練指令，或使用 LIFF 進行扣課等操作。');
    }
    return;
  }
  if (LIFF_COACH_URL) {
    await replyButtons(
      replyToken,
      '請輸入「使用教學」查看教練指令，或點擊下方按鈕開啟教練後台。',
      '👉 開啟教練後台',
      LIFF_COACH_URL
    );
  } else {
    await replyMessage(replyToken, '請輸入「使用教學」查看教練指令，或使用 LIFF 進行扣課等操作。');
  }
}

const pendingNameSet = new Set<string>();

async function handleStudentMessage(userId: string, text: string, replyToken: string): Promise<void> {
  // 如果正在等待輸入本名
  if (pendingNameSet.has(userId)) {
    const name = text.trim();
    if (name.length >= 2 && name.length <= 20) {
      await setAlias(userId, name);
      pendingNameSet.delete(userId);
      await replyMessage(replyToken, `✅ 已記錄您的本名：${name}\n\n歡迎使用高爾夫預約系統！輸入「使用教學」查看功能說明。`);
      return;
    }
    pendingNameSet.delete(userId);
  }

  // 確保 user 存在，沒有的話先建立
  const user = await getOrCreateUser(userId);
  // 檢查是否有設定本名，沒有的話請學員輸入
  if (!user.alias) {
    pendingNameSet.add(userId);
    await replyMessage(replyToken, '👋 您好！第一次使用請先輸入您的本名（中文全名），方便教練辨識您。');
    return;
  }

  if (text === '使用教學' || text === 'help' || text === '說明') {
    if (LIFF_STUDENT_URL) {
      await replyButtons(
        replyToken,
        getStudentHelp(),
        '👉 開啟學員專區',
        LIFF_STUDENT_URL
      );
    } else {
      await replyMessage(replyToken, getStudentHelp());
    }
    return;
  }
  if (text === '查詢預約' || text === '我的預約') {
    const today = new Date().toISOString().slice(0, 10);
    const bookings = await getBookingsByUser(userId, today);
    await replyStudentBookingsFlex(replyToken, bookings);
    return;
  }
  if (text === '我的堂數' || text === '查詢堂數') {
    const pkgs = await getActivePackages(userId);
    if (pkgs.length === 0) {
      if (LIFF_STUDENT_URL) {
        await replyButtons(replyToken, '📋 您目前沒有可用的儲值課程包。請聯繫教練購買課程。', '👉 開啟學員專區', LIFF_STUDENT_URL);
      } else {
        await replyMessage(replyToken, '📋 您目前沒有可用的儲值課程包。');
      }
      return;
    }
    const lines = ['📋 您的儲值課程：', ''];
    let total = 0;
    for (const p of pkgs) {
      total += p.remainingCredits;
      lines.push(`🏌️ ${p.title}`);
      lines.push(`   剩餘：${p.remainingCredits} / ${p.totalCredits} 堂`);
      if (p.validTo) lines.push(`   到期：${p.validTo}`);
      lines.push('');
    }
    lines.push(`🎯 總剩餘：${total} 堂`);
    if (LIFF_STUDENT_URL) {
      await replyButtons(replyToken, lines.join('\n'), '👉 開啟學員專區', LIFF_STUDENT_URL);
    } else {
      await replyMessage(replyToken, lines.join('\n'));
    }
    return;
  }
  if (text === '查詢紀錄' || text === '我的紀錄') {
    await replyStudentHistoryFlex(replyToken, userId, userId);
    return;
  }
  // 學員專區、預約、LIFF → 顯示按鈕
  if (text === '學員專區' || text === '預約' || text.toLowerCase() === 'liff') {
    if (LIFF_STUDENT_URL) {
      await replyButtons(
        replyToken,
        '點擊下方按鈕開啟學員專區，可查詢堂數、預約、我的預約。',
        '👉 開啟學員專區',
        LIFF_STUDENT_URL
      );
    } else {
      await replyMessage(replyToken, '請輸入「使用教學」查看學員指令。');
    }
    return;
  }
  if (LIFF_STUDENT_URL) {
    await replyButtons(
      replyToken,
      '⛳ 歡迎使用高爾夫預約系統\n\n查詢預約、我的堂數、預約課程\n點擊下方按鈕開啟學員專區',
      '👉 開啟學員專區',
      LIFF_STUDENT_URL
    );
  } else {
    await replyMessage(
      replyToken,
      `⛳ 歡迎使用高爾夫預約系統\n\n查詢預約、我的堂數\n輸入「使用教學」看完整說明`
    );
  }
}

function getCoachHelp(): string {
  return (
    '📖 使用教學\n\n' +
    '━━━ 教練 ━━━\n\n' +
    '查詢  「查詢今日」「查詢明日」\n' +
    '核銷  請使用 LIFF 扣課/加課\n' +
    '開課  請使用 LIFF 學員明細\n' +
    '休假  請使用 LIFF 休假設定\n\n' +
    '💡 輸入「使用教學」可隨時查看'
  );
}

function getStudentHelp(): string {
  return (
    '📖 使用教學\n\n' +
    '━━━ 學員 ━━━\n\n' +
    '預約  點連結選地點、課程、日期時間\n' +
    '查詢  「查詢預約」或「我的預約」\n' +
    '堂數  「我的堂數」或「查詢堂數」\n\n' +
    '💡 輸入「使用教學」可隨時查看'
  );
}

async function replyCoachScheduleFlex(replyToken: string, label: string, dateStr: string, bookings: any[]): Promise<void> {
  const fixedSessions = await getFixedSessionsOnDate(dateStr);
  const items: any[] = [];
  
  for (const f of fixedSessions) {
    items.push({
      type: 'fixed',
      bookingId: '',
      startTime: f.startTime,
      endTime: f.endTime,
      location: f.location,
      service: f.service,
      status: 'fixed',
      title: f.note ? `固定課程（${f.note}）` : '固定課程',
    });
  }

  for (const b of bookings) {
    const user = await getUser(b.userId);
    const name = user?.alias ?? user?.displayName ?? b.userId;
    items.push({
      type: 'booking',
      bookingId: b.id,
      startTime: b.startTime,
      location: b.location,
      service: b.service,
      status: b.status,
      title: name,
    });
  }

  items.sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (items.length === 0) {
    await replyMessage(replyToken, `📋 ${label}（${dateStr}）沒有任何預約與固定課程。`);
    return;
  }

  const chunks = items.slice(0, 10);
  const bubbles = chunks.map(item => {
    let statusText = item.status;
    let statusColor = '#999999';
    if (item.status === 'pending') { statusText = '待確認'; statusColor = '#ff9800'; }
    else if (item.status === 'approved') { statusText = '已確認'; statusColor = '#4caf50'; }
    else if (item.status === 'fixed') { statusText = '固定排程'; statusColor = '#2196f3'; }

    const bubble: any = {
      type: 'bubble',
      size: 'micro',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: statusText, weight: 'bold', color: statusColor, size: 'sm' },
          { type: 'text', text: item.title, weight: 'bold', size: 'md', wrap: true },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            spacing: 'sm',
            contents: [
              { type: 'text', text: `⏰ ${item.startTime}`, size: 'sm', color: '#666666' },
              { type: 'text', text: `📍 ${item.location}`, size: 'sm', color: '#666666', wrap: true },
              { type: 'text', text: `🏌️ ${item.service}`, size: 'sm', color: '#666666', wrap: true }
            ]
          }
        ]
      }
    };

    if (item.type === 'booking') {
      bubble.footer = {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            color: '#f44336',
            action: {
              type: 'postback',
              label: '取消預約',
              data: `action=booking_decision&decision=reject&bookingId=${item.bookingId}`,
              displayText: '我要取消學員預約'
            }
          }
        ]
      };
    } else if (item.type === 'fixed') {
      bubble.footer = {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            color: '#f44336',
            action: {
              type: 'postback',
              label: '取消今日固定班',
              data: `action=cancel_fixed_session&date=${dateStr}&startTime=${item.startTime}&endTime=${item.endTime}`,
              displayText: '這個固定時段不排課（轉為請假）'
            }
          }
        ]
      };
    }
    return bubble;
  });

  const carousel = { type: 'carousel', contents: bubbles };
  const messages: any[] = [{ type: 'flex', altText: `📋 ${label}（共 ${items.length} 筆）`, contents: carousel }];

  if (items.length > 10) {
    if (LIFF_COACH_URL) {
      messages.push({
        type: 'template',
        altText: '還有更多行程...',
        template: {
          type: 'buttons',
          text: `還有 ${items.length - 10} 筆行程未顯示。`,
          actions: [{ type: 'uri', label: '開啟教練後台查看全部', uri: LIFF_COACH_URL }]
        }
      });
    } else {
      messages.push({ type: 'text', text: `還有 ${items.length - 10} 筆行程未顯示。` });
    }
  }

  await getLineClient().replyMessage(replyToken, messages);
}

async function replyStudentBookingsFlex(replyToken: string, bookings: any[]): Promise<void> {
  const items = bookings.filter(b => b.status === 'pending' || b.status === 'approved');

  if (items.length === 0) {
    if (LIFF_STUDENT_URL) {
      await replyButtons(replyToken, '📋 您目前沒有有效預約。點擊下方按鈕可進行預約。', '👉 開啟學員專區', LIFF_STUDENT_URL);
    } else {
      await replyMessage(replyToken, '📋 您目前沒有有效預約。');
    }
    return;
  }

  const chunks = items.slice(0, 10);
  const bubbles = chunks.map(item => {
    const statusText = item.status === 'pending' ? '待確認' : '已確認';
    const statusColor = item.status === 'pending' ? '#ff9800' : '#4caf50';

    return {
      type: 'bubble',
      size: 'micro',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: statusText, weight: 'bold', color: statusColor, size: 'sm' },
          { type: 'text', text: item.bookingDate, weight: 'bold', size: 'md' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            spacing: 'sm',
            contents: [
              { type: 'text', text: `⏰ ${item.startTime}`, size: 'sm', color: '#666666' },
              { type: 'text', text: `📍 ${item.location}`, size: 'sm', color: '#666666', wrap: true },
              { type: 'text', text: `🏌️ ${item.service}`, size: 'sm', color: '#666666', wrap: true }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            color: '#f44336',
            action: {
              type: 'postback',
              label: '取消預約',
              data: `action=student_cancel&bookingId=${item.id}`,
              displayText: '我要取消這筆預約'
            }
          }
        ]
      }
    };
  });

  const messages: any[] = [{ type: 'flex', altText: `📋 您的預約（共 ${items.length} 筆）`, contents: { type: 'carousel', contents: bubbles } }];

  if (items.length > 10 && LIFF_STUDENT_URL) {
    messages.push({
      type: 'template',
      altText: '還有更多預約...',
      template: {
        type: 'buttons',
        text: `還有 ${items.length - 10} 筆預約未顯示。`,
        actions: [{ type: 'uri', label: '開啟學員專區查看', uri: LIFF_STUDENT_URL }]
      }
    });
  }

  await getLineClient().replyMessage(replyToken, messages);
}

async function replyStudentHistoryFlex(replyToken: string, targetUserId: string, requesterUserId: string, targetName?: string): Promise<void> {
  const pkgs = await getActivePackages(targetUserId);
  const total = pkgs.reduce((acc, p) => acc + p.remainingCredits, 0);

  const allBookings = await getBookingsByUser(targetUserId);
  const today = new Date().toISOString().slice(0, 10);
  const history = allBookings
    .filter(b => b.bookingDate <= today && (b.status === 'approved' || b.status === 'completed'))
    .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate) || b.startTime.localeCompare(a.startTime))
    .slice(0, 10);

  const summaryText = pkgs.length === 0 ? '目前無可用方案' : `總剩餘：${total} 堂`;
  const nameLabel = targetName ? `${targetName} 的` : '我的';

  const contents: any[] = [
    { type: 'text', text: `${nameLabel}上課紀錄`, weight: 'bold', size: 'md', align: 'center'},
    { type: 'text', text: summaryText, size: 'sm', align: 'center', color: '#06c755', margin: 'md'},
    { type: 'separator', margin: 'md' },
    { type: 'text', text: history.length ? '近期上課明細：' : '尚無近期紀錄', size: 'xs', color: '#999999', margin: 'md' }
  ];

  history.forEach(b => {
    contents.push({
      type: 'box', layout: 'vertical', margin: 'md', spacing: 'none',
      contents: [
        { type: 'text', text: `📅 ${b.bookingDate} ${b.startTime}`, size: 'sm', weight: 'bold' },
        { type: 'text', text: `📍 ${b.location} / ${b.service}`, size: 'xs', color: '#666666' }
      ]
    });
  });

  if (history.length >= 10) {
    contents.push({ type: 'text', text: '...顯示最近10筆', size: 'xs', color: '#999999', margin: 'md', align: 'center' });
  }

  const infoBubble: any = {
    type: 'bubble',
    size: 'mega',
    body: { type: 'box', layout: 'vertical', contents }
  };

  if (isCoach(requesterUserId) && LIFF_COACH_URL) {
      infoBubble.footer = { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: '#06c755', action: { type: 'uri', label: '開啟教練後台查看全部', uri: LIFF_COACH_URL }}]};
  } else if (!isCoach(requesterUserId) && LIFF_STUDENT_URL) {
      infoBubble.footer = { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: '#06c755', action: { type: 'uri', label: '開啟學員專區查看', uri: LIFF_STUDENT_URL }}]};
  }

  const messages: any[] = [{ type: 'flex', altText: `${nameLabel}上課紀錄`, contents: infoBubble }];
  await getLineClient().replyMessage(replyToken, messages);
}
