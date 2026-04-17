import { FastifyInstance } from 'fastify';
import { getDb, admin, getBucket } from '../config/firebase';
import crypto from 'crypto';
import { getOrCreateUser, getUser, listStudentsWithAlias, setAlias } from '../services/user';
import { getActivePackages, addCredits, deductCredits, getAllPackagesForRevenue } from '../services/package';
import { addLeave, listLeaves } from '../services/coachLeave';
import { getBooking, rejectBooking, createBooking, getBookingsByDateRange, getBookingsByUser, getSlotStatuses, cancelBooking } from '../services/booking';
import { addFixedSchedule, deleteFixedSchedule, getFixedSessionsByDateRange, listFixedSchedules } from '../services/fixedSchedule';
import { isCoach, pushMessage } from '../services/line';
import { getAvailableTimeSlots, LOCATION_MAP, SERVICE_DURATION } from '../utils/constants';
import { notifyCoachesNewBooking, notifyStudentBookingCreated, notifyStudentCreditAdded, notifyCoachCreditAdded, notifyStudentCreditDeducted, notifyCoachCreditDeducted, notifyStudentBookingRejected, notifyCoachesStudentCancelled } from '../services/notification';

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

  app.get('/api/liff/student-history', async (req, reply) => {
    const userId = (req.query as any).userId;
    const targetUserId = (req.query as any).targetUserId;
    
    let authorizedUserId = '';
    if (isCoach(userId)) {
      authorizedUserId = targetUserId || userId;
    } else {
      if (!userId || (targetUserId && targetUserId !== userId)) {
        return reply.status(403).send({ error: '無權查看他人紀錄' });
      }
      authorizedUserId = userId;
    }

    if (!authorizedUserId) return reply.status(400).send({ error: '缺少查詢目標' });

    const packages = await getActivePackages(authorizedUserId);
    const allBookings = await getBookingsByUser(authorizedUserId);
    const today = new Date().toISOString().slice(0, 10);
    
    const historyBookings = allBookings.filter(b => 
      b.bookingDate <= today && 
      (b.status === 'approved' || b.status === 'completed')
    ).sort((a, b) => {
      const dateCmp = b.bookingDate.localeCompare(a.bookingDate);
      if (dateCmp !== 0) return dateCmp;
      return b.startTime.localeCompare(a.startTime);
    });

    return { packages, historyBookings };
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
    const duration = Number((req.query as any).duration) || 0;
    if (!date) return reply.status(400).send({ error: 'Missing date' });
    const slotStatus = await getSlotStatuses(date, service, duration || undefined);
    const slots = slotStatus.filter((s) => s.available).map((s) => s.time);
    return { slots, slotStatus };
  });

  app.post('/api/liff/create-booking', async (req, reply) => {
    const body = req.body as any;
    const { userId, bookingDate, startTime, location, service, duration } = body;
    if (!userId || !bookingDate || !startTime || !location || !service) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }
    const id = await createBooking(userId, bookingDate, startTime, location, service, Number(duration) || undefined);
    const payload = {
      bookingId: id,
      userId,
      bookingDate,
      startTime,
      location,
      service,
      duration: Number(duration) || 1,
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
    const { coachUserId, targetUserId, amount, note, lessonNote } = body;
    if (!coachUserId || !isCoach(coachUserId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const deductAmount = Number(amount);
    if (!targetUserId || !deductAmount || deductAmount <= 0) {
      return reply.status(400).send({ ok: false, error: '請確認學員與扣課堂數' });
    }
    const combinedNote = [note, lessonNote].filter(Boolean).join(' | ');
    let result: { packageId: string; title: string; remaining: number };
    try {
      result = await deductCredits(targetUserId, deductAmount, 'manual_adjustment', undefined, combinedNote || undefined);
    } catch (err: any) {
      return reply.status(400).send({ ok: false, error: err.message ?? '扣課失敗' });
    }
    // 扣課時同時建立 completed booking 紀錄，讓上課紀錄查得到
    const deductDate = getDateInTaipei();
    const nowTs = admin.firestore.FieldValue.serverTimestamp();
    for (let i = 0; i < deductAmount; i++) {
      await getDb().collection('bookings').add({
        userId: targetUserId,
        bookingDate: deductDate,
        startTime: '00:00',
        endTime: '01:00',
        location: lessonNote || '手動扣課',
        service: note || '手動扣課',
        status: 'completed',
        creditsUsed: 1,
        cancelReason: null,
        createdAt: nowTs,
        updatedAt: nowTs,
      });
    }

    const studentUser = await getOrCreateUser(targetUserId);
    const studentDisplayName = studentUser?.displayName || undefined;
    const displayNote = lessonNote ? `${note || ''}${note ? ' · ' : ''}上課內容：${lessonNote}` : (note || undefined);
    await Promise.all([
      notifyStudentCreditDeducted({
        userId: targetUserId,
        title: result.title,
        deducted: deductAmount,
        remaining: result.remaining,
        note: displayNote,
      }),
      notifyCoachCreditDeducted({
        targetUserId,
        studentDisplayName,
        title: result.title,
        deducted: deductAmount,
        remaining: result.remaining,
        note: displayNote,
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

    // 自動取消休假時段內的預約並通知學員
    let cancelledCount = 0;
    try {
      const leaveStart = new Date(`${startDate}T${startTime}:00`);
      const leaveEnd = new Date(`${endDate}T${endTime}:00`);
      // 查詢休假期間每天的預約
      const current = new Date(leaveStart);
      while (current <= leaveEnd) {
        const dateStr = current.toISOString().slice(0, 10);
        const dayBookings = await getBookingsByDateRange(dateStr, dateStr);
        for (const b of dayBookings) {
          if (b.status !== 'pending' && b.status !== 'approved') continue;
          const bStart = new Date(`${b.bookingDate}T${b.startTime}:00`);
          const bEnd = new Date(`${b.bookingDate}T${b.endTime}:00`);
          if (bStart < leaveEnd && bEnd > leaveStart) {
            await cancelBooking(b.id, note ? `教練休假：${note}` : '教練臨時休假');
            await notifyStudentBookingRejected({
              bookingId: b.id,
              userId: b.userId,
              bookingDate: b.bookingDate,
              startTime: b.startTime,
              location: b.location,
              service: b.service,
              reason: note ? `教練臨時休假：${note}` : '教練臨時休假',
            });
            cancelledCount++;
          }
        }
        current.setDate(current.getDate() + 1);
      }
    } catch (err) {
      console.error('[coach-leave] auto-cancel error:', err);
    }

    return { ok: true, id, cancelledCount };
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

  app.delete('/api/liff/coach-leave', async (req, reply) => {
    const userId = (req.query as any).userId;
    const leaveId = (req.query as any).id;
    if (!userId || !isCoach(userId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    if (!leaveId) return reply.status(400).send({ error: '缺少休假 ID' });
    try {
      await getDb().collection('coach_leaves').doc(leaveId).delete();
      return { ok: true };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message ?? '刪除失敗' });
    }
  });

  app.get('/api/liff/revenue-summary', async (req, reply) => {
    const userId = (req.query as any).userId;
    if (!userId || !isCoach(userId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const from = (req.query as any).from || '';
    const to = (req.query as any).to || '';
    let packages = await getAllPackagesForRevenue();
    if (from) packages = packages.filter(p => (p.validFrom ?? '') >= from);
    if (to) packages = packages.filter(p => (p.validFrom ?? '') <= to);
    const studentMap: Record<string, {
      name: string;
      totalPaid: number;
      earnedIncome: number;
      unearned: number;
      totalCredits: number;
      usedCredits: number;
      remainingCredits: number;
    }> = {};

    for (const p of packages) {
      const price = p.price ?? 0;
      const unitPrice = p.totalCredits > 0 ? price / p.totalCredits : 0;
      const used = p.totalCredits - p.remainingCredits;
      const earned = Math.round(used * unitPrice);
      const unearned = Math.round(p.remainingCredits * unitPrice);

      if (!studentMap[p.userId]) {
        const user = await getUser(p.userId);
        studentMap[p.userId] = {
          name: user?.alias ?? user?.displayName ?? p.userId,
          totalPaid: 0,
          earnedIncome: 0,
          unearned: 0,
          totalCredits: 0,
          usedCredits: 0,
          remainingCredits: 0,
        };
      }
      studentMap[p.userId].totalPaid += price;
      studentMap[p.userId].earnedIncome += earned;
      studentMap[p.userId].unearned += unearned;
      studentMap[p.userId].totalCredits += p.totalCredits;
      studentMap[p.userId].usedCredits += used;
      studentMap[p.userId].remainingCredits += p.remainingCredits;
    }

    const students = Object.entries(studentMap)
      .map(([uid, data]) => ({ userId: uid, ...data }))
      .sort((a, b) => b.unearned - a.unearned);

    const totals = students.reduce(
      (acc, s) => ({
        totalPaid: acc.totalPaid + s.totalPaid,
        earnedIncome: acc.earnedIncome + s.earnedIncome,
        unearned: acc.unearned + s.unearned,
      }),
      { totalPaid: 0, earnedIncome: 0, unearned: 0 }
    );

    return { totals, students };
  });

  app.post('/api/liff/cancel-coach-schedule', async (req, reply) => {
    const body = req.body as any;
    const { coachUserId, type, id, date, startTime, endTime } = body;
    if (!coachUserId || !isCoach(coachUserId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    
    try {
      if (type === 'fixed') {
        if (!date || !startTime || !endTime) {
          return reply.status(400).send({ error: '缺少固定班日期或時間' });
        }
        const { cancelFixedSession } = require('../services/fixedSchedule');
        await cancelFixedSession(date, startTime, endTime);
        return { ok: true };
      } else if (type === 'booking') {
        if (!id) return reply.status(400).send({ error: '缺少預約 ID' });
        const booking = await getBooking(id);
        if (!booking) return reply.status(400).send({ error: '預約不存在' });
        await rejectBooking(id);
        await notifyStudentBookingRejected({
          bookingId: id,
          userId: booking.userId,
          bookingDate: booking.bookingDate,
          startTime: booking.startTime,
          location: booking.location,
          service: booking.service,
        });
        return { ok: true };
      }
      return reply.status(400).send({ error: '未知的預約類型' });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message ?? '取消預約失敗' });
    }
  });

  // ========== 學員取消預約 ==========
  app.post('/api/liff/cancel-booking', async (req, reply) => {
    const { userId, bookingId } = req.body as any;
    if (!userId || !bookingId) return reply.status(400).send({ error: 'Missing parameters' });
    
    const booking = await getBooking(bookingId);
    if (!booking) return reply.status(400).send({ error: '預約不存在' });
    if (booking.userId !== userId) return reply.status(403).send({ error: '無權限取消此預約' });
    if (booking.status === 'cancelled' || booking.status === 'rejected' || booking.status === 'completed') {
      return reply.status(400).send({ error: '此預約狀態無法取消' });
    }

    try {
      await cancelBooking(bookingId, '學員自行從 LIFF 取消');
      await notifyCoachesStudentCancelled({
        bookingId,
        userId: booking.userId,
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        location: booking.location,
        service: booking.service,
      });

      // 回傳未來 3 天可預約時段供改約
      const rescheduleSlots: { date: string; slots: string[] }[] = [];
      for (let i = 1; i <= 3; i++) {
        const d = getDateInTaipei(i);
        const slotStatus = await getSlotStatuses(d, booking.service);
        const available = slotStatus.filter((s) => s.available).map((s) => s.time);
        if (available.length > 0) {
          rescheduleSlots.push({ date: d, slots: available });
        }
      }

      return { ok: true, rescheduleSlots };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message ?? '取消失敗' });
    }
  });

  // ========== 影片管理 ==========

  // 取得上傳用的 signed URL
  app.post('/api/liff/video-upload-url', async (req, reply) => {
    const { coachUserId, fileName, contentType } = req.body as any;
    if (!coachUserId || !isCoach(coachUserId)) return reply.status(403).send({ error: 'Forbidden' });
    if (!fileName || !contentType) return reply.status(400).send({ error: '缺少檔案資訊' });

    const ext = fileName.split('.').pop() || 'mp4';
    const storagePath = `videos/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const bucket = getBucket();
    const file = bucket.file(storagePath);

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000,
      contentType,
    });

    return { uploadUrl, storagePath };
  });

  // 新增影片（支援 Storage 上傳 & YouTube 連結）
  app.post('/api/liff/video', async (req, reply) => {
    const { coachUserId, title, youtubeUrl, storagePath, description, studentIds } = req.body as any;
    if (!coachUserId || !isCoach(coachUserId)) return reply.status(403).send({ error: 'Forbidden' });
    if (!title || (!youtubeUrl && !storagePath)) return reply.status(400).send({ error: '請填寫標題和影片' });

    let videoUrl = '';
    if (storagePath) {
      const bucket = getBucket();
      const file = bucket.file(storagePath);
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: '2030-12-31',
      });
      videoUrl = signedUrl;
    }

    const ref = await getDb().collection('videos').add({
      title,
      youtubeUrl: youtubeUrl || '',
      videoUrl,
      storagePath: storagePath || '',
      description: description || '',
      studentIds: Array.isArray(studentIds) ? studentIds : [],
      createdBy: coachUserId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 推播通知被指定的學員
    const ids = Array.isArray(studentIds) ? studentIds : [];
    for (const sid of ids) {
      try {
        const user = await getUser(sid);
        const name = user?.alias ?? user?.displayName ?? '學員';
        await pushMessage(sid, [{ type: 'text', text: `🎬 ${name} 您好！\n\n教練為您準備了專屬教學影片：「${title}」\n\n請打開學員專區的「我的影片」觀看。` }]);
      } catch (err) {
        console.error('[video/notify]', sid, err);
      }
    }

    return { ok: true, videoId: ref.id };
  });

  app.get('/api/liff/videos', async (req, reply) => {
    const userId = (req.query as any).userId;
    if (!userId || !isCoach(userId)) return reply.status(403).send({ error: 'Forbidden' });
    const snap = await getDb().collection('videos').orderBy('createdAt', 'desc').get();
    const videos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return { videos };
  });

  app.delete('/api/liff/video', async (req, reply) => {
    const userId = (req.query as any).userId;
    const videoId = (req.query as any).id;
    if (!userId || !isCoach(userId)) return reply.status(403).send({ error: 'Forbidden' });
    if (!videoId) return reply.status(400).send({ error: '缺少影片 ID' });

    // 刪除 Storage 檔案
    const doc = await getDb().collection('videos').doc(videoId).get();
    const data = doc.data();
    if (data?.storagePath) {
      try {
        await getBucket().file(data.storagePath).delete();
      } catch (err) {
        console.error('[video/delete-storage]', err);
      }
    }

    await getDb().collection('videos').doc(videoId).delete();
    return { ok: true };
  });

  app.get('/api/liff/my-videos', async (req, reply) => {
    const userId = (req.query as any).userId;
    if (!userId) return reply.status(400).send({ error: 'Missing userId' });
    const snap = await getDb().collection('videos').where('studentIds', 'array-contains', userId).orderBy('createdAt', 'desc').get();
    const videos = snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, title: data.title, youtubeUrl: data.youtubeUrl, videoUrl: data.videoUrl || '', description: data.description, createdAt: data.createdAt };
    });
    return { videos };
  });

  // ========== 照片管理 ==========

  app.post('/api/liff/photo-upload-url', async (req, reply) => {
    const { coachUserId, fileName, contentType } = req.body as any;
    if (!coachUserId || !isCoach(coachUserId)) return reply.status(403).send({ error: 'Forbidden' });
    if (!fileName || !contentType) return reply.status(400).send({ error: '缺少檔案資訊' });
    const ext = fileName.split('.').pop() || 'jpg';
    const storagePath = `photos/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const bucket = getBucket();
    const file = bucket.file(storagePath);
    const [uploadUrl] = await file.getSignedUrl({ version: 'v4', action: 'write', expires: Date.now() + 15 * 60 * 1000, contentType });
    return { uploadUrl, storagePath };
  });

  app.post('/api/liff/photo', async (req, reply) => {
    const { coachUserId, title, storagePath, description, studentIds } = req.body as any;
    if (!coachUserId || !isCoach(coachUserId)) return reply.status(403).send({ error: 'Forbidden' });
    if (!title || !storagePath) return reply.status(400).send({ error: '請填寫標題和照片' });
    const bucket = getBucket();
    const file = bucket.file(storagePath);
    const [photoUrl] = await file.getSignedUrl({ action: 'read', expires: '2030-12-31' });
    const ref = await getDb().collection('photos').add({
      title, photoUrl, storagePath, description: description || '',
      studentIds: Array.isArray(studentIds) ? studentIds : [],
      createdBy: coachUserId, createdAt: new Date(),
    });
    for (const sid of (Array.isArray(studentIds) ? studentIds : [])) {
      try {
        const user = (await getDb().collection('users').where('lineUserId', '==', sid).limit(1).get()).docs[0]?.data();
        const name = user?.alias ?? user?.displayName ?? '學員';
        await pushMessage(sid, [{ type: 'text', text: `📸 ${name} 您好！\n\n教練為您上傳了專屬照片：「${title}」\n\n請打開學員專區的「我的照片」觀看。` }]);
      } catch (err) { console.error('[photo/notify]', sid, err); }
    }
    return { ok: true, photoId: ref.id };
  });

  app.get('/api/liff/photos', async (req, reply) => {
    const userId = (req.query as any).userId;
    if (!userId || !isCoach(userId)) return reply.status(403).send({ error: 'Forbidden' });
    const snap = await getDb().collection('photos').orderBy('createdAt', 'desc').get();
    const photos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return { photos };
  });

  app.delete('/api/liff/photo', async (req, reply) => {
    const userId = (req.query as any).userId;
    const photoId = (req.query as any).id;
    if (!userId || !isCoach(userId)) return reply.status(403).send({ error: 'Forbidden' });
    if (!photoId) return reply.status(400).send({ error: '缺少照片 ID' });
    const doc = await getDb().collection('photos').doc(photoId).get();
    const data = doc.data();
    if (data?.storagePath) {
      try { await getBucket().file(data.storagePath).delete(); } catch (err) { console.error('[photo/delete-storage]', err); }
    }
    await getDb().collection('photos').doc(photoId).delete();
    return { ok: true };
  });

  app.get('/api/liff/my-photos', async (req, reply) => {
    const userId = (req.query as any).userId;
    if (!userId) return reply.status(400).send({ error: 'Missing userId' });
    const snap = await getDb().collection('photos').where('studentIds', 'array-contains', userId).orderBy('createdAt', 'desc').get();
    const photos = snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, title: data.title, photoUrl: data.photoUrl || '', description: data.description, createdAt: data.createdAt };
    });
    return { photos };
  });

  // ========== 學員請假 ==========

  // 教練新增學員請假紀錄
  app.post('/api/liff/student-leave', async (req, reply) => {
    const { coachUserId, studentId, startDate, startTime, endDate, endTime, note, bookingId } = req.body as any;
    if (!coachUserId || !isCoach(coachUserId)) return reply.status(403).send({ error: 'Forbidden' });
    if (!studentId || !startDate || !endDate) return reply.status(400).send({ error: '請填寫學員和日期' });

    const db = getDb();

    // 若有 bookingId，自動取消該預約
    let linkedBookingInfo: any = null;
    if (bookingId) {
      const booking = await getBooking(bookingId);
      if (booking) {
        await cancelBooking(bookingId, note || '學員請假');
        linkedBookingInfo = booking;
      }
    }

    const ref = await db.collection('student_leaves').add({
      studentId,
      startDate,
      startTime: startTime || null,
      endDate,
      endTime: endTime || null,
      note: note || '',
      bookingId: bookingId || null,
      createdBy: coachUserId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 推播通知學員
    try {
      const user = await getUser(studentId);
      const name = user?.alias ?? user?.displayName ?? '學員';
      const dateRange = startDate === endDate
        ? `${startDate}${startTime ? ` ${startTime}` : ''}${endTime ? ` - ${endTime}` : ''}`
        : `${startDate}${startTime ? ` ${startTime}` : ''} ～ ${endDate}${endTime ? ` ${endTime}` : ''}`;
      let text = `📝 ${name} 您好！\n\n教練已為您記錄請假：\n📅 ${dateRange}`;
      if (note) text += `\n📌 原因：${note}`;
      if (linkedBookingInfo) {
        text += `\n\n⚠️ 原預約已自動取消：\n${linkedBookingInfo.bookingDate} ${linkedBookingInfo.startTime} ${linkedBookingInfo.service}`;
      }
      text += `\n\n請至學員專區「我的請假」查看。`;
      await pushMessage(studentId, [{ type: 'text', text }]);
    } catch (err) {
      console.error('[student-leave/notify]', err);
    }

    return { ok: true, leaveId: ref.id };
  });

  // 教練查詢所有學員請假
  app.get('/api/liff/student-leaves', async (req, reply) => {
    const userId = (req.query as any).userId;
    if (!userId || !isCoach(userId)) return reply.status(403).send({ error: 'Forbidden' });
    const snap = await getDb().collection('student_leaves').orderBy('createdAt', 'desc').get();
    const leaves = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return { leaves };
  });

  // 教練刪除學員請假
  app.delete('/api/liff/student-leave', async (req, reply) => {
    const userId = (req.query as any).userId;
    const leaveId = (req.query as any).id;
    if (!userId || !isCoach(userId)) return reply.status(403).send({ error: 'Forbidden' });
    if (!leaveId) return reply.status(400).send({ error: '缺少請假 ID' });
    await getDb().collection('student_leaves').doc(leaveId).delete();
    return { ok: true };
  });

  // 學員查詢自己的請假紀錄
  app.get('/api/liff/my-leaves', async (req, reply) => {
    const userId = (req.query as any).userId;
    if (!userId) return reply.status(400).send({ error: 'Missing userId' });
    const snap = await getDb().collection('student_leaves').where('studentId', '==', userId).get();
    const leaves = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .sort((a, b) => (b.createdAt?._seconds ?? 0) - (a.createdAt?._seconds ?? 0));
    return { leaves };
  });

  // ========== 教練刪除學員 ==========
  app.post('/api/liff/delete-student', async (req, reply) => {
    const { coachUserId, targetUserId } = req.body as any;
    if (!coachUserId || !isCoach(coachUserId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    if (!targetUserId) return reply.status(400).send({ error: '缺少學員 ID' });

    try {
      const db = getDb();
      // 刪除 user
      await db.collection('users').doc(targetUserId).delete();
      // 刪除 bookings
      const bookings = await db.collection('bookings').where('userId', '==', targetUserId).get();
      for (const doc of bookings.docs) { await doc.ref.delete(); }
      // 刪除 packages
      const packages = await db.collection('packages').where('userId', '==', targetUserId).get();
      for (const doc of packages.docs) { await doc.ref.delete(); }
      // 刪除 transactions
      const txs = await db.collection('credit_transactions').where('userId', '==', targetUserId).get();
      for (const doc of txs.docs) { await doc.ref.delete(); }
      // 刪除 notifications log
      const notifs = await db.collection('notifications_log').where('userId', '==', targetUserId).get();
      for (const doc of notifs.docs) { await doc.ref.delete(); }

      return { ok: true, deleted: { bookings: bookings.size, packages: packages.size, transactions: txs.size } };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message ?? '刪除失敗' });
    }
  });
}
