import { getDb } from '../config/firebase';
import { admin } from '../config/firebase';
import { pushMessage } from './line';
import { LOCATION_MAP } from '../utils/constants';
import { getApprovedBookingsForTomorrow, getBookingsByDate } from './booking';
import { getFixedSessionsOnDate } from './fixedSchedule';
import { getPackagesExpiringWithinDays, getLowCreditPackages, getActivePackages, getAllPackagesForRevenue } from './package';
import { listStudentsWithAlias } from './user';
import { getBookingsByUser } from './booking';
import { getUser } from './user';
import { env } from '../config/env';

const COLLECTION = 'notifications_log';

function getDateInTaipei(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

async function hasSent(userId: string, type: string, refId?: string): Promise<boolean> {
  let q = getDb().collection(COLLECTION).where('userId', '==', userId).where('type', '==', type);
  if (refId) {
    q = q.where('refId', '==', refId) as any;
  }
  const snap = await q.limit(1).get();
  return !snap.empty;
}

async function logSent(userId: string, type: string, refId?: string): Promise<void> {
  await getDb().collection(COLLECTION).add({
    userId,
    type,
    refId: refId ?? null,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function sendTomorrowReminders(): Promise<{ sent: number; skipped: number }> {
  const bookings = await getApprovedBookingsForTomorrow();
  let sent = 0;
  let skipped = 0;
  const dateStr = getDateInTaipei(1);

  for (const b of bookings) {
    const alreadySent = await hasSent(b.userId, 'reminder_tomorrow', b.id as string);
    if (alreadySent) {
      skipped++;
      continue;
    }
    const user = await getUser(b.userId);
    const name = user?.alias ?? user?.displayName ?? '學員';
    const mapsUrl = LOCATION_MAP[b.location] ?? '';
    const text =
      `🔔 明日課程提醒\n\n` +
      `${name} 您好！\n明天有一堂課程，別忘了喔 😊\n\n` +
      `📋 ${b.id}\n📍 ${b.location}\n⏰ ${b.startTime}\n🏌️ ${b.service}\n\n` +
      `📍 導航：${mapsUrl}\n\n期待明天見面！⛳`;
    await pushMessage(b.userId, [{ type: 'text', text }]);
    await logSent(b.userId, 'reminder_tomorrow', b.id as string);
    sent++;
  }
  return { sent, skipped };
}

export async function sendExpiryWarnings(): Promise<number> {
  const packages = await getPackagesExpiringWithinDays(30);
  let sent = 0;
  const seen = new Set<string>();

  for (const p of packages) {
    const key = `${p.userId}-${p.id}`;
    if (seen.has(key)) continue;
    const alreadySent = await hasSent(p.userId, 'expiry_warning', p.id as string);
    if (alreadySent) continue;
    const text =
      `📋 儲值課程到期提醒\n\n` +
      `您的方案「${p.title}」將於 ${p.validTo} 到期。\n` +
      `目前剩餘 ${p.remainingCredits} 堂，請盡快安排上課。\n\n` +
      `如有疑問請聯繫教練。`;
    await pushMessage(p.userId, [{ type: 'text', text }]);
    await logSent(p.userId, 'expiry_warning', p.id as string);
    seen.add(key);
    sent++;
  }
  return sent;
}

export async function sendCoachDigest(coachUserId: string): Promise<number> {
  const bookings = await getApprovedBookingsForTomorrow();
  const dateStr = getDateInTaipei(1);
  const fixedSessions = await getFixedSessionsOnDate(dateStr);

  type Session = {
    startTime: string;
    location: string;
    service: string;
    title: string;
  };

  const sessions: Session[] = [];

  for (const b of bookings) {
    const user = await getUser(b.userId);
    const name = user?.alias ?? user?.displayName ?? b.userId;
    sessions.push({
      startTime: b.startTime,
      location: b.location,
      service: b.service,
      title: name,
    });
  }

  for (const f of fixedSessions) {
    sessions.push({
      startTime: f.startTime,
      location: f.location,
      service: f.service,
      title: f.note ? `[固定] ${f.note}` : `[固定]`,
    });
  }

  sessions.sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (sessions.length === 0) {
    await pushMessage(coachUserId, [
      { type: 'text', text: `📋 明日行程彙報\n\n${dateStr}\n\n✅ 明天沒有排課，好好休息！💤` },
    ]);
    return 0;
  }

  const lines = ['📋 明日行程彙報', '', `${dateStr}（共 ${sessions.length} 堂課）`, ''];
  for (const s of sessions) {
    lines.push(`⏰ ${s.startTime}  ${s.title}`);
    lines.push(`   📍 ${s.location}`);
    lines.push(`   🏌️ ${s.service}`);
    lines.push('');
  }
  await pushMessage(coachUserId, [{ type: 'text', text: lines.join('\n') }]);
  return sessions.length;
}

export async function notifyCoachesNewBooking(input: {
  bookingId: string;
  userId: string;
  bookingDate: string;
  startTime: string;
  location: string;
  service: string;
}): Promise<number> {
  const coachIds = env.coachLineUserIds;
  if (!coachIds.length) return 0;

  const user = await getUser(input.userId);
  const studentName = user?.alias ?? user?.displayName ?? input.userId;
  const mapsUrl = LOCATION_MAP[input.location] ?? '';
  const detailText =
    `🔔 新預約待處理\n\n` +
    `👤 學員：${studentName}\n` +
    `📅 日期：${input.bookingDate}\n` +
    `⏰ 時段：${input.startTime}\n` +
    `📍 地點：${input.location}\n` +
    `🏌️ 課程：${input.service}\n` +
    `🆔 編號：${input.bookingId}` +
    (mapsUrl ? `\n🧭 導航：${mapsUrl}` : '') +
    `\n\n請直接點下方按鈕處理。`;

  const fixedSessions = await getFixedSessionsOnDate(input.bookingDate);
  const bookings = await getBookingsByDate(input.bookingDate);

  const items: any[] = [];
  for (const f of fixedSessions) {
    items.push({
      startTime: f.startTime,
      title: f.note ? `固定課程（${f.note}）` : '固定課程',
      status: 'fixed'
    });
  }
  for (const b of bookings) {
    const u = await getUser(b.userId);
    const name = u?.alias ?? u?.displayName ?? b.userId;
    items.push({
      startTime: b.startTime,
      title: name,
      status: b.status,
      id: b.id
    });
  }

  items.sort((a, b) => a.startTime.localeCompare(b.startTime));

  let scheduleText = `📅 教練當日（${input.bookingDate}）行程總覽：\n`;
  if (items.length === 0) {
    scheduleText += '無其他行程';
  } else {
    scheduleText += items.map(item => {
      let st = '';
      if (item.status === 'pending') st = ' (待確認)';
      if (item.status === 'approved') st = ' (已確認)';
      if (item.status === 'fixed') st = ' (固定班)';
      
      const mark = item.id === input.bookingId ? '🆕 ' : '🔸 ';
      return `${mark}${item.startTime} ${item.title}${st}`;
    }).join('\n');
  }

  const actionCard = {
    type: 'template',
    altText: `新預約待確認：${studentName} ${input.bookingDate} ${input.startTime}`,
    template: {
      type: 'buttons',
      title: '新預約待處理',
      text: `${studentName}｜${input.bookingDate} ${input.startTime}`,
      actions: [
        {
          type: 'postback',
          label: '確認預約',
          data: `action=booking_decision&decision=approve&bookingId=${input.bookingId}`,
          displayText: `確認預約 ${input.bookingDate} ${input.startTime}`,
        },
        {
          type: 'postback',
          label: '取消，改約時間',
          data: `action=booking_decision&decision=reject&bookingId=${input.bookingId}`,
          displayText: `取消預約，請學員改約時間`,
        },
      ],
    },
  };

  let sent = 0;
  for (const coachId of coachIds) {
    try {
      await pushMessage(coachId, [{ type: 'text', text: detailText }, { type: 'text', text: scheduleText }, actionCard]);
      sent++;
    } catch (err) {
      console.error('[notify/new-booking]', coachId, err);
    }
  }
  return sent;
}

export async function notifyCoachesStudentCancelled(input: {
  bookingId: string;
  userId: string;
  bookingDate: string;
  startTime: string;
  location: string;
  service: string;
}): Promise<number> {
  const coachIds = env.coachLineUserIds;
  if (!coachIds.length) return 0;

  const user = await getUser(input.userId);
  const studentName = user?.alias ?? user?.displayName ?? input.userId;
  const text =
    `⚠️ 學員已取消預約\n\n` +
    `👤 學員：${studentName}\n` +
    `📅 日期：${input.bookingDate}\n` +
    `⏰ 時段：${input.startTime}\n` +
    `📍 地點：${input.location}\n` +
    `🏌️ 課程：${input.service}`;

  let sent = 0;
  for (const coachId of coachIds) {
    try {
      await pushMessage(coachId, [{ type: 'text', text }]);
      sent++;
    } catch (err) {
      console.error('[notify/student-cancelled]', coachId, err);
    }
  }
  return sent;
}

export async function notifyStudentBookingCreated(input: {
  bookingId: string;
  userId: string;
  bookingDate: string;
  startTime: string;
  location: string;
  service: string;
}): Promise<boolean> {
  const mapsUrl = LOCATION_MAP[input.location] ?? '';
  const text =
    `✅ 預約已送出（待確認）\n\n` +
    `📅 日期：${input.bookingDate}\n` +
    `⏰ 時段：${input.startTime}\n` +
    `📍 地點：${input.location}\n` +
    `🏌️ 課程：${input.service}\n` +
    `🆔 編號：${input.bookingId}` +
    (mapsUrl ? `\n🧭 導航：${mapsUrl}` : '') +
    `\n\n可在「我的預約」查看最新狀態。`;

  try {
    await pushMessage(input.userId, [{ type: 'text', text }]);
    return true;
  } catch (err) {
    console.error('[notify/student-booking-created]', input.userId, err);
    return false;
  }
}

export async function notifyStudentBookingApproved(input: {
  bookingId: string;
  userId: string;
  bookingDate: string;
  startTime: string;
  location: string;
  service: string;
}): Promise<boolean> {
  const mapsUrl = LOCATION_MAP[input.location] ?? '';
  const text =
    `🎉 預約已確認\n\n` +
    `📅 日期：${input.bookingDate}\n` +
    `⏰ 時段：${input.startTime}\n` +
    `📍 地點：${input.location}\n` +
    `🏌️ 課程：${input.service}\n` +
    `🆔 編號：${input.bookingId}` +
    (mapsUrl ? `\n🧭 導航：${mapsUrl}` : '') +
    `\n\n期待課堂見！`;
  try {
    await pushMessage(input.userId, [{ type: 'text', text }]);
    return true;
  } catch (err) {
    console.error('[notify/student-booking-approved]', input.userId, err);
    return false;
  }
}

export async function notifyStudentBookingRejected(input: {
  bookingId: string;
  userId: string;
  bookingDate: string;
  startTime: string;
  location: string;
  service: string;
}): Promise<boolean> {
  const text =
    `⚠️ 此次預約未確認\n\n` +
    `📅 日期：${input.bookingDate}\n` +
    `⏰ 原時段：${input.startTime}\n` +
    `📍 地點：${input.location}\n` +
    `🏌️ 課程：${input.service}\n` +
    `🆔 編號：${input.bookingId}\n\n` +
    `請打開學員專區重新選擇可預約時段。`;
  try {
    await pushMessage(input.userId, [{ type: 'text', text }]);
    return true;
  } catch (err) {
    console.error('[notify/student-booking-rejected]', input.userId, err);
    return false;
  }
}

export async function notifyStudentCreditAdded(input: {
  userId: string;
  title: string;
  credits: number;
  realName?: string;
  validFrom?: string;
  validTo?: string;
  price?: number;
}): Promise<boolean> {
  const nameText = input.realName ? `（${input.realName}）` : '';
  const fromText = input.validFrom ? `起始日：${input.validFrom}\n` : '';
  const toText = input.validTo ? `到期日：${input.validTo}\n` : '';
  const priceText = input.price ? `金額：NT$ ${input.price}\n` : '';
  const text =
    `🎉 已新增課程包${nameText}\n\n` +
    `📦 方案：${input.title}\n` +
    `➕ 新增：${input.credits} 堂\n` +
    fromText +
    toText +
    priceText +
    `\n可在學員專區「我的堂數」查看。`;
  try {
    await pushMessage(input.userId, [{ type: 'text', text }]);
    return true;
  } catch (err) {
    console.error('[notify/student-credit-added]', input.userId, err);
    return false;
  }
}

export async function notifyStudentCreditDeducted(input: {
  userId: string;
  title: string;
  deducted: number;
  remaining: number;
  note?: string;
}): Promise<boolean> {
  const noteText = input.note ? `\n備註：${input.note}` : '';
  const text =
    `📋 課程堂數異動通知\n\n` +
    `📦 方案：${input.title}\n` +
    `➖ 本次扣除：${input.deducted} 堂\n` +
    `🎯 剩餘堂數：${input.remaining} 堂` +
    noteText +
    `\n\n如有疑問請聯繫教練。`;
  try {
    await pushMessage(input.userId, [{ type: 'text', text }]);
    return true;
  } catch (err) {
    console.error('[notify/student-credit-deducted]', input.userId, err);
    return false;
  }
}

export async function notifyCoachCreditDeducted(input: {
  targetUserId: string;
  studentDisplayName?: string;
  title: string;
  deducted: number;
  remaining: number;
  note?: string;
}): Promise<number> {
  const coachIds = env.coachLineUserIds;
  if (!coachIds.length) return 0;

  const nameText = input.studentDisplayName ? `\n學員：${input.studentDisplayName}` : '';
  const noteText = input.note ? `\n備註：${input.note}` : '';
  const text =
    `✅ 扣課完成` +
    nameText +
    `\n📦 方案：${input.title}\n` +
    `➖ 本次扣除：${input.deducted} 堂\n` +
    `🎯 剩餘堂數：${input.remaining} 堂` +
    noteText;

  let sent = 0;
  for (const coachId of coachIds) {
    try {
      await pushMessage(coachId, [{ type: 'text', text }]);
      sent++;
    } catch (err) {
      console.error('[notify/coach-credit-deducted]', coachId, err);
    }
  }
  return sent;
}

export async function notifyCoachCreditAdded(input: {
  targetUserId: string;
  studentDisplayName?: string;
  title: string;
  credits: number;
  realName?: string;
  validFrom?: string;
  validTo?: string;
  price?: number;
}): Promise<number> {
  const coachIds = env.coachLineUserIds;
  if (!coachIds.length) return 0;

  const nameText = input.realName ? `\n本名：${input.realName}` : '';
  const lineNameText = input.studentDisplayName ? `\nLINE 名稱：${input.studentDisplayName}` : '';
  const fromText = input.validFrom ? `\n起始日：${input.validFrom}` : '';
  const toText = input.validTo ? `\n到期日：${input.validTo}` : '';
  const priceText = input.price ? `\n金額：NT$ ${input.price}` : '';
  const text =
    `✅ 開課成功\n\n` +
    `📦 方案：${input.title}\n` +
    `➕ 新增：${input.credits} 堂` +
    nameText +
    lineNameText +
    fromText +
    toText +
    priceText;

  let sent = 0;
  for (const coachId of coachIds) {
    try {
      await pushMessage(coachId, [{ type: 'text', text }]);
      sent++;
    } catch (err) {
      console.error('[notify/coach-credit-added]', coachId, err);
    }
  }
  return sent;
}

export async function sendLowCreditReminders(): Promise<{ sent: number; skipped: number }> {
  const packages = await getLowCreditPackages(2);
  let sent = 0;
  let skipped = 0;

  for (const p of packages) {
    const alreadySent = await hasSent(p.userId, 'low_credit_warning', p.id);
    if (alreadySent) {
      skipped++;
      continue;
    }
    const user = await getUser(p.userId);
    const name = user?.alias ?? user?.displayName ?? '學員';
    const text =
      `📋 堂數即將用完提醒\n\n` +
      `${name} 您好！\n` +
      `您的課程包「${p.title}」剩餘 ${p.remainingCredits} 堂，建議儘早續購，以免影響上課進度。\n\n` +
      `如需續購請聯繫教練 😊`;
    try {
      await pushMessage(p.userId, [{ type: 'text', text }]);
      await logSent(p.userId, 'low_credit_warning', p.id);
      sent++;
    } catch (err) {
      console.error('[notify/low-credit]', p.userId, err);
    }
  }
  return { sent, skipped };
}

export async function sendInactiveStudentReminders(): Promise<{ sent: number; skipped: number }> {
  const students = await listStudentsWithAlias();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const monthKey = todayStr.slice(0, 7);
  let sent = 0;
  let skipped = 0;

  for (const s of students) {
    const pkgs = await getActivePackages(s.lineUserId);
    if (pkgs.length === 0) continue;

    const totalRemaining = pkgs.reduce((sum, p) => sum + p.remainingCredits, 0);
    if (totalRemaining <= 0) continue;

    const alreadySent = await hasSent(s.lineUserId, 'inactive_reminder', monthKey);
    if (alreadySent) {
      skipped++;
      continue;
    }

    const bookings = await getBookingsByUser(s.lineUserId);
    const validBookings = bookings.filter(
      (b) => b.status === 'approved' || b.status === 'completed' || b.status === 'pending'
    );
    if (validBookings.length > 0) {
      const lastDate = validBookings[validBookings.length - 1].bookingDate;
      const diffDays = Math.floor((today.getTime() - new Date(`${lastDate}T00:00:00`).getTime()) / 86400000);
      if (diffDays < 30) continue;
    }

    const name = s.alias ?? s.displayName ?? '學員';
    const text =
      `👋 好久沒見到您了！\n\n` +
      `${name} 您好，您已經超過 30 天沒有預約課程了。\n` +
      `目前還有 ${totalRemaining} 堂課可以使用，快來預約吧！\n\n` +
      `期待在球場上見到您 ⛳`;
    try {
      await pushMessage(s.lineUserId, [{ type: 'text', text }]);
      await logSent(s.lineUserId, 'inactive_reminder', monthKey);
      sent++;
    } catch (err) {
      console.error('[notify/inactive]', s.lineUserId, err);
    }
  }
  return { sent, skipped };
}

export async function sendMonthlyRevenueReport(coachUserId: string): Promise<boolean> {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthLabel = `${lastMonth.getFullYear()}年${lastMonth.getMonth() + 1}月`;

  const packages = await getAllPackagesForRevenue();

  let totalPaid = 0;
  let totalEarned = 0;
  let totalUnearned = 0;

  const studentMap: Record<string, { name: string; unearned: number; remaining: number }> = {};

  for (const p of packages) {
    const price = p.price ?? 0;
    const unitPrice = p.totalCredits > 0 ? price / p.totalCredits : 0;
    const used = p.totalCredits - p.remainingCredits;
    totalPaid += price;
    totalEarned += Math.round(used * unitPrice);
    totalUnearned += Math.round(p.remainingCredits * unitPrice);

    if (p.remainingCredits > 0) {
      if (!studentMap[p.userId]) {
        const user = await getUser(p.userId);
        studentMap[p.userId] = {
          name: user?.alias ?? user?.displayName ?? p.userId,
          unearned: 0,
          remaining: 0,
        };
      }
      studentMap[p.userId].unearned += Math.round(p.remainingCredits * unitPrice);
      studentMap[p.userId].remaining += p.remainingCredits;
    }
  }

  const unearnedList = Object.values(studentMap)
    .filter((s) => s.unearned > 0)
    .sort((a, b) => b.unearned - a.unearned);

  const fmt = (n: number) => `NT$ ${n.toLocaleString()}`;
  const lines = [
    `📊 ${monthLabel} 收入月報`,
    '',
    `💰 預收現金總額：${fmt(totalPaid)}`,
    `✅ 實際收入：${fmt(totalEarned)}`,
    `⏳ 未消化餘額：${fmt(totalUnearned)}`,
  ];

  if (unearnedList.length > 0) {
    lines.push('', `📋 尚有餘額的學員（${unearnedList.length} 位）：`);
    for (const s of unearnedList.slice(0, 15)) {
      lines.push(`  ${s.name}：剩 ${s.remaining} 堂（${fmt(s.unearned)}）`);
    }
    if (unearnedList.length > 15) {
      lines.push(`  ...還有 ${unearnedList.length - 15} 位`);
    }
  }

  try {
    await pushMessage(coachUserId, [{ type: 'text', text: lines.join('\n') }]);
    return true;
  } catch (err) {
    console.error('[notify/monthly-revenue]', coachUserId, err);
    return false;
  }
}
