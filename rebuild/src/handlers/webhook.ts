import { WebhookEvent } from '@line/bot-sdk';
import { replyMessage, replyButtons, isCoach } from '../services/line';
import { getBookingsByUser, getBookingsByDate, getBooking, approveBooking, rejectBooking } from '../services/booking';
import { getActivePackages } from '../services/package';
import { env } from '../config/env';
import { getUser } from '../services/user';
import { notifyStudentBookingApproved, notifyStudentBookingRejected } from '../services/notification';

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
  if (!isCoach(userId)) {
    await replyMessage(replyToken, '此操作僅限教練使用。');
    return;
  }
  if (event.type !== 'postback') return;
  const rawData = (event.postback as any)?.data ?? '';
  const params = new URLSearchParams(rawData);
  const action = params.get('action');
  if (action !== 'booking_decision') return;

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

  if (booking.status !== 'pending') {
    const statusText =
      booking.status === 'approved'
        ? '已確認'
        : booking.status === 'rejected'
        ? '已取消'
        : booking.status;
    await replyMessage(replyToken, `這筆預約目前狀態為「${statusText}」，無需重複處理。`);
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
    await replyMessage(replyToken, await formatBookings('今日', today, bookings));
    return;
  }
  if (text === '查詢明日' || text === '查詢明天') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const dateStr = d.toISOString().slice(0, 10);
    const bookings = await getBookingsByDate(dateStr);
    await replyMessage(replyToken, await formatBookings('明日', dateStr, bookings));
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

async function handleStudentMessage(userId: string, text: string, replyToken: string): Promise<void> {
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
    if (bookings.length === 0) {
      if (LIFF_STUDENT_URL) {
        await replyButtons(replyToken, '📋 您目前沒有有效預約。點擊下方按鈕可預約課程。', '👉 開啟學員專區', LIFF_STUDENT_URL);
      } else {
        await replyMessage(replyToken, '📋 您目前沒有有效預約。');
      }
      return;
    }
    const lines = ['📋 您的預約：', ''];
    for (const b of bookings) {
      lines.push(`📅 ${b.bookingDate} ${b.startTime}`);
      lines.push(`📍 ${b.location} / ${b.service}`);
      lines.push(`📌 ${b.status === 'pending' ? '待確認' : '已確認'}`);
      lines.push('');
    }
    if (LIFF_STUDENT_URL) {
      await replyButtons(replyToken, lines.join('\n'), '👉 開啟學員專區', LIFF_STUDENT_URL);
    } else {
      await replyMessage(replyToken, lines.join('\n'));
    }
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

async function formatBookings(label: string, dateStr: string, bookings: any[]): Promise<string> {
  if (bookings.length === 0) {
    return `📋 ${label}（${dateStr}）沒有任何預約。`;
  }
  const lines = [`📋 ${label}（${dateStr}）共 ${bookings.length} 筆`, ''];
  for (const b of bookings) {
    const user = await getUser(b.userId);
    const name = user?.alias ?? user?.displayName ?? b.userId;
    lines.push(`⏰ ${b.startTime}  ${name}`);
    lines.push(`   📍 ${b.location} / ${b.service}`);
    lines.push(`   📌 ${b.status}`);
    lines.push('');
  }
  return lines.join('\n');
}
