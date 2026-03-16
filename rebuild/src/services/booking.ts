import { getDb } from '../config/firebase';
import { admin } from '../config/firebase';
import { getAvailableTimeSlots, SERVICE_DURATION } from '../utils/constants';
import { getBlockedSlots, isSlotBlocked } from './coachLeave';
import { getFixedSessionsOnDate } from './fixedSchedule';

const COLLECTION = 'bookings';

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

export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'completed' | 'cancelled';

export interface Booking {
  userId: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  location: string;
  service: string;
  status: BookingStatus;
  packageId?: string;
  creditsUsed: number;
  calendarEventId?: string;
  cancelReason?: string;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

export interface SlotStatus {
  time: string;
  available: boolean;
  reason?: 'booked' | 'leave' | 'outside_hours';
  location?: string;
}

export async function createBooking(
  userId: string,
  bookingDate: string,
  startTime: string,
  location: string,
  service: string
): Promise<string> {
  const db = getDb();
  const allSlots = getAvailableTimeSlots();
  if (!allSlots.includes(startTime)) {
    throw new Error('預約時段不在營業時間內');
  }
  const duration = SERVICE_DURATION[service] ?? 1;
  const startH = parseInt(startTime.split(':')[0], 10);
  const endH = startH + duration;
  const endTime = `${String(endH).padStart(2, '0')}:00`;
  const endHourLimit = parseInt(allSlots[allSlots.length - 1].split(':')[0], 10) + 1;
  if (endH > endHourLimit) {
    throw new Error('課程結束時間超出營業時間');
  }

  return await db.runTransaction(async (tx) => {
    const blocked = await isSlotBlocked(bookingDate, startTime);
    if (blocked) throw new Error('該時段教練休假，無法預約');

    const fixedSessions = await getFixedSessionsOnDate(bookingDate);
    const allStartSlots = Array.from({ length: duration }, (_, i) => `${String(startH + i).padStart(2, '0')}:00`);
    for (const s of fixedSessions) {
      const d = SERVICE_DURATION[s.service] ?? 1;
      const sh = parseInt(s.startTime.split(':')[0], 10);
      for (let i = 0; i < d; i++) {
        const occupied = `${String(sh + i).padStart(2, '0')}:00`;
        if (allStartSlots.includes(occupied)) {
          throw new Error('該時段為固定課程，無法預約');
        }
      }
    }

    const sameDateSnap = await tx.get(db.collection(COLLECTION).where('bookingDate', '==', bookingDate));
    for (const doc of sameDateSnap.docs) {
      const data = doc.data() as Booking;
      if (data.status !== 'pending' && data.status !== 'approved') continue;
      const d = SERVICE_DURATION[data.service] ?? 1;
      const bookedStartH = parseInt(data.startTime.split(':')[0], 10);
      for (let i = 0; i < d; i++) {
        const occupied = `${String(bookedStartH + i).padStart(2, '0')}:00`;
        if (allStartSlots.includes(occupied)) {
          throw new Error('該時段已被預約');
        }
      }
    }

    const ref = db.collection(COLLECTION).doc();
    tx.set(ref, {
      userId,
      bookingDate,
      startTime,
      endTime,
      location,
      service,
      status: 'pending',
      creditsUsed: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  });
}

export async function getBooking(id: string): Promise<(Booking & { id: string }) | null> {
  const snap = await getDb().collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() } as Booking & { id: string };
}

export async function approveBooking(id: string): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({
    status: 'approved',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function rejectBooking(id: string): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({
    status: 'rejected',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function cancelBooking(id: string, reason?: string): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({
    status: 'cancelled',
    cancelReason: reason ?? null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function getBookingsByUser(userId: string, fromDate?: string): Promise<(Booking & { id: string })[]> {
  const snap = await getDb().collection(COLLECTION).where('userId', '==', userId).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Booking & { id: string }))
    .filter((b) => !fromDate || b.bookingDate >= fromDate)
    .sort((a, b) => {
      const dateCmp = a.bookingDate.localeCompare(b.bookingDate);
      if (dateCmp !== 0) return dateCmp;
      return a.startTime.localeCompare(b.startTime);
    });
}

export async function getBookingsByDate(date: string): Promise<(Booking & { id: string })[]> {
  const snap = await getDb().collection(COLLECTION).where('bookingDate', '==', date).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Booking & { id: string }))
    .filter((b) => b.status === 'pending' || b.status === 'approved' || b.status === 'completed')
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export async function getBookingsByDateRange(fromDate: string, toDate: string): Promise<(Booking & { id: string })[]> {
  const snap = await getDb()
    .collection(COLLECTION)
    .where('bookingDate', '>=', fromDate)
    .where('bookingDate', '<=', toDate)
    .get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Booking & { id: string }))
    .filter((b) => b.status === 'pending' || b.status === 'approved' || b.status === 'completed')
    .sort((a, b) => {
      const dateCmp = a.bookingDate.localeCompare(b.bookingDate);
      if (dateCmp !== 0) return dateCmp;
      return a.startTime.localeCompare(b.startTime);
    });
}

export async function getApprovedBookingsForTomorrow(): Promise<(Booking & { id: string })[]> {
  const dateStr = getDateInTaipei(1);
  const snap = await getDb().collection(COLLECTION).where('bookingDate', '==', dateStr).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Booking & { id: string }))
    .filter((b) => b.status === 'approved')
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export async function getBookedSlots(date: string): Promise<string[]> {
  const bookings = await getBookingsByDate(date);
  const fixedSessions = await getFixedSessionsOnDate(date);
  const slots: string[] = [];
  for (const b of bookings) {
    if (b.status !== 'pending' && b.status !== 'approved') continue;
    const duration = SERVICE_DURATION[b.service] ?? 1;
    const startH = parseInt(b.startTime.split(':')[0], 10);
    for (let i = 0; i < duration; i++) {
      slots.push(`${String(startH + i).padStart(2, '0')}:00`);
    }
  }
  for (const s of fixedSessions) {
    const duration = SERVICE_DURATION[s.service] ?? 1;
    const startH = parseInt(s.startTime.split(':')[0], 10);
    for (let i = 0; i < duration; i++) {
      slots.push(`${String(startH + i).padStart(2, '0')}:00`);
    }
  }
  return [...new Set(slots)];
}

export async function getAvailableSlots(date: string): Promise<string[]> {
  const statuses = await getSlotStatuses(date);
  return statuses.filter((s) => s.available).map((s) => s.time);
}

export async function getSlotStatuses(date: string, service?: string): Promise<SlotStatus[]> {
  const all = getAvailableTimeSlots();
  const bookings = await getBookingsByDate(date);
  const fixedSessions = await getFixedSessionsOnDate(date);
  const blocked = await getBlockedSlots(date, all);
  const bookedInfo = new Map<string, { location: string }>();
  const duration = SERVICE_DURATION[service ?? ''] ?? 1;
  const startHourMin = parseInt(all[0].split(':')[0], 10);
  const endHourLimit = parseInt(all[all.length - 1].split(':')[0], 10) + 1;

  for (const b of bookings) {
    if (b.status !== 'pending' && b.status !== 'approved') continue;
    const duration = SERVICE_DURATION[b.service] ?? 1;
    const startH = parseInt(b.startTime.split(':')[0], 10);
    for (let i = 0; i < duration; i++) {
      const slot = `${String(startH + i).padStart(2, '0')}:00`;
      bookedInfo.set(slot, { location: b.location });
    }
  }
  for (const s of fixedSessions) {
    const d = SERVICE_DURATION[s.service] ?? 1;
    const startH = parseInt(s.startTime.split(':')[0], 10);
    for (let i = 0; i < d; i++) {
      const slot = `${String(startH + i).padStart(2, '0')}:00`;
      if (!bookedInfo.has(slot)) bookedInfo.set(slot, { location: s.location });
    }
  }

  return all.map((time) => {
    const h = parseInt(time.split(':')[0], 10);
    if (h < startHourMin || h + duration > endHourLimit) {
      return { time, available: false, reason: 'outside_hours' as const };
    }
    const info = bookedInfo.get(time);
    if (info) {
      return {
        time,
        available: false,
        reason: 'booked' as const,
        location: info.location,
      };
    }
    // 僅當沒有課程占用時，才顯示為休假。
    if (blocked.has(time)) {
      return { time, available: false, reason: 'leave' as const };
    }
    return { time, available: true };
  });
}
