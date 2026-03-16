import { FastifyInstance } from 'fastify';
import { getOrCreateUser, getUser, listStudentsWithAlias, setAlias } from '../services/user';
import { getActivePackages, addCredits, deductCredits } from '../services/package';
import { addLeave, listLeaves } from '../services/coachLeave';
import { createBooking, getBookingsByDateRange, getBookingsByUser, getSlotStatuses } from '../services/booking';
import { addFixedSchedule, deleteFixedSchedule, getFixedSessionsByDateRange, listFixedSchedules } from '../services/fixedSchedule';
import { isCoach } from '../services/line';
import { getAvailableTimeSlots, LOCATION_MAP, SERVICE_DURATION } from '../utils/constants';
import { notifyCoachesNewBooking, notifyStudentBookingCreated, notifyStudentCreditAdded, notifyCoachCreditAdded, notifyStudentCreditDeducted, notifyCoachCreditDeducted } from '../services/notification';

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

export async function liffRoutes(app: FastifyInstance): Promise<void> {
  // ========== 共用：取得使用者角色 ==========
  app.get('/api/liff/me', async (req, reply) => {
    const userId = (req.query as any).userId;
    const displayName = (req.query as any).displayName;
    if (!userId) return reply.status(400).send({ error: 'Missing userId' });
    await getOrCreateUser(userId, displayName);
    return { role: isCoach(userId) ? 'coach' : 'student' };
  });

  // ========== 學員 API（需 LIFF userId） ==========
  app.get('/api/liff/my-packages', async (req, reply) => {
    const userId = (req.query as any).userId;
    if (!userId) return reply.status(400).send({ error: 'Missing userId' });
    const packages = await getActivePackages(userId);
    return { packages };
  });

  app.get('/api/liff/my-bookings', async (req, reply) => {
    const userId = (req.query as any).userId;
    if (!userId) return reply.status(400).send({ error: 'Missing userId' });
    const from = (req.query as any).from ?? getDateInTaipei(-30);
    const bookings = await getBookingsByUser(userId, from);
    return { bookings };
  });

  app.get('/api/liff/booking-options', async (_req, reply) => {
    return {
      locations: Object.keys(LOCATION_MAP),
      services: Object.keys(SERVICE_DURATION),
      timeSlots: getAvailableTimeSlots(),
    };
  });

  app.get('/api/liff/available-slots', async (req, reply) => {
    const date = (req.query as any).date;
    const service = (req.query as any).service;
    if (!date) return reply.status(400).send({ error: 'Missing date' });
    const slotStatus = await getSlotStatuses(date, service);
    const slots = slotStatus.filter((s) => s.available).map((s) => s.time);
    return { slots, slotStatus };
  });

  app.post('/api/liff/create-booking', async (req, reply) => {
    const body = req.body as any;
    const { userId, bookingDate, startTime, location, service } = body;
    if (!userId || !bookingDate || !startTime || !location || !service) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }
    const id = await createBooking(userId, bookingDate, startTime, location, service);
    const payload = {
      bookingId: id,
      userId,
      bookingDate,
      startTime,
      location,
      service,
    };
    const [coachNotified, studentNotified] = await Promise.all([
      notifyCoachesNewBooking(payload),
      notifyStudentBookingCreated(payload),
    ]);
    return { ok: true, bookingId: id, coachNotified, studentNotified };
  });

  // ========== 教練 API ==========
  app.get('/api/liff/students', async (req, reply) => {
    const userId = (req.query as any).userId;
    if (!userId || !isCoach(userId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const students = await listStudentsWithAlias();
    return { students };
  });

  app.get('/api/liff/student-packages', async (req, reply) => {
    const userId = (req.query as any).userId;
    const targetUserId = (req.query as any).targetUserId;
    if (!userId || !isCoach(userId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const packages = await getActivePackages(targetUserId);
    return { packages };
  });

  app.get('/api/liff/coach-schedule', async (req, reply) => {
    const userId = (req.query as any).userId;
    if (!userId || !isCoach(userId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const from = (req.query as any).from ?? getDateInTaipei();
    const to = (req.query as any).to ?? getDateInTaipei(2);
    if (from > to) {
      return reply.status(400).send({ error: '日期區間不正確' });
    }
    const bookings = await getBookingsByDateRange(from, to);
    const fixedSessions = await getFixedSessionsByDateRange(from, to);
    const enriched = await Promise.all(
      bookings.map(async (b) => {
        const user = await getUser(b.userId);
        return {
          ...b,
          studentName: user?.alias ?? user?.displayName ?? b.userId,
        };
      })
    );
    const fixedRows = fixedSessions.map((s) => ({
      id: `fixed-${s.templateId}-${s.date}-${s.startTime}`,
      bookingDate: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      location: s.location,
      service: s.service,
      status: 'fixed',
      userId: '',
      studentName: s.note ? `固定課程（${s.note}）` : '固定課程',
    }));
    return { bookings: [...enriched, ...fixedRows] };
  });

  app.get('/api/liff/fixed-schedules', async (req, reply) => {
    const userId = (req.query as any).userId;
    if (!userId || !isCoach(userId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const schedules = await listFixedSchedules();
    return { schedules };
  });

  app.post('/api/liff/fixed-schedule', async (req, reply) => {
    const body = req.body as any;
    const { coachUserId, weekday, startTime, location, service, note } = body;
    if (!coachUserId || !isCoach(coachUserId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    if (weekday === undefined || !startTime || !location || !service) {
      return reply.status(400).send({ error: '缺少固定班表欄位' });
    }
    let id = '';
    try {
      id = await addFixedSchedule({
        weekday: Number(weekday),
        startTime,
        location,
        service,
        note: note || undefined,
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message ?? '新增固定班失敗' });
    }
    return { ok: true, id };
  });

  app.delete('/api/liff/fixed-schedule', async (req, reply) => {
    const userId = (req.query as any).userId;
    const id = (req.query as any).id;
    if (!userId || !isCoach(userId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    if (!id) return reply.status(400).send({ error: '缺少固定班表 id' });
    await deleteFixedSchedule(id);
    return { ok: true };
  });

  app.post('/api/liff/add-credits', async (req, reply) => {
    const body = req.body as any;
    const { coachUserId, targetUserId, credits, title, validTo, validFrom, realName, price } = body;
    if (!coachUserId || !isCoach(coachUserId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const id = await addCredits(targetUserId, credits, title, validTo, validFrom || undefined, price ? Number(price) : undefined);
    // 設定本名 alias（若有填）
    if (realName && realName.trim()) {
      try { await setAlias(targetUserId, realName.trim()); } catch (_) {}
    }
    // 取得學員 LINE 顯示名稱
    const studentUser = await getOrCreateUser(targetUserId);
    const studentDisplayName = studentUser?.displayName || undefined;
    // 同時推播：學員 + 教練
    await Promise.all([
      notifyStudentCreditAdded({
        userId: targetUserId,
        title,
        credits: Number(credits),
        realName: realName || undefined,
        validFrom: validFrom || undefined,
        validTo: validTo || undefined,
        price: price ? Number(price) : undefined,
      }),
      notifyCoachCreditAdded({
        targetUserId,
        studentDisplayName,
        title,
        credits: Number(credits),
        realName: realName || undefined,
        validFrom: validFrom || undefined,
        validTo: validTo || undefined,
        price: price ? Number(price) : undefined,
      }),
    ]);
    return { ok: true, packageId: id };
  });

  app.post('/api/liff/deduct-credits', async (req, reply) => {
    const body = req.body as any;
    const { coachUserId, targetUserId, amount, note } = body;
    if (!coachUserId || !isCoach(coachUserId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const deductAmount = Number(amount);
    if (!targetUserId || !deductAmount || deductAmount <= 0) {
      return reply.status(400).send({ ok: false, error: '請確認學員與扣課堂數' });
    }
    let result: { packageId: string; title: string; remaining: number };
    try {
      result = await deductCredits(targetUserId, deductAmount, 'manual_adjustment', undefined, note || undefined);
    } catch (err: any) {
      return reply.status(400).send({ ok: false, error: err.message ?? '扣課失敗' });
    }
    const studentUser = await getOrCreateUser(targetUserId);
    const studentDisplayName = studentUser?.displayName || undefined;
    await Promise.all([
      notifyStudentCreditDeducted({
        userId: targetUserId,
        title: result.title,
        deducted: deductAmount,
        remaining: result.remaining,
        note: note || undefined,
      }),
      notifyCoachCreditDeducted({
        targetUserId,
        studentDisplayName,
        title: result.title,
        deducted: deductAmount,
        remaining: result.remaining,
        note: note || undefined,
      }),
    ]);
    return { ok: true, ...result, deducted: deductAmount };
  });

  app.post('/api/liff/coach-leave', async (req, reply) => {
    const body = req.body as any;
    const { coachUserId, startDate, startTime, endDate, endTime, note } = body;
    if (!coachUserId || !isCoach(coachUserId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    if (!startDate || !startTime || !endDate || !endTime) {
      return reply.status(400).send({ error: '請完整選擇開始與結束日期時間' });
    }
    let id = '';
    try {
      id = await addLeave(startDate, startTime, endDate, endTime, note);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message ?? '新增休假失敗' });
    }
    return { ok: true, id };
  });

  app.get('/api/liff/coach-leaves', async (req, reply) => {
    const userId = (req.query as any).userId;
    const fromDate = (req.query as any).from ?? getDateInTaipei();
    const toDate = (req.query as any).to ?? getDateInTaipei(90);
    if (!userId || !isCoach(userId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const leaves = await listLeaves(fromDate, toDate);
    return { leaves };
  });
}
