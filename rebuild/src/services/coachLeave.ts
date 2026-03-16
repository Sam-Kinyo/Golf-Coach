import { getDb } from '../config/firebase';
import { admin } from '../config/firebase';

const COLLECTION = 'coach_leaves';

export interface CoachLeave {
  // Legacy field (for old data compatibility)
  leaveDate?: string;
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  note?: string;
  createdAt: admin.firestore.Timestamp;
}

function toDateTime(value: { date?: string; time?: string }, endOfDayWhenNoTime = false): Date | null {
  if (!value.date) return null;
  const t = value.time ?? (endOfDayWhenNoTime ? '23:59' : '00:00');
  const dt = new Date(`${value.date}T${t}:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function normalizeLeave(leave: CoachLeave): { start: Date | null; end: Date | null } {
  // New schema
  const startNew = toDateTime({ date: leave.startDate, time: leave.startTime });
  const endNew = toDateTime({ date: leave.endDate, time: leave.endTime }, true);
  if (startNew && endNew) return { start: startNew, end: endNew };

  // Legacy schema fallback (single day + optional start/end time)
  const startLegacy = toDateTime({ date: leave.leaveDate, time: leave.startTime });
  const endLegacy = toDateTime({ date: leave.leaveDate, time: leave.endTime }, true);
  if (!startLegacy && leave.leaveDate) {
    const allDayStart = toDateTime({ date: leave.leaveDate, time: '00:00' });
    const allDayEnd = toDateTime({ date: leave.leaveDate, time: '23:59' }, true);
    return { start: allDayStart, end: allDayEnd };
  }
  return { start: startLegacy, end: endLegacy };
}

async function getAllLeaves(): Promise<(CoachLeave & { id: string })[]> {
  const snap = await getDb().collection(COLLECTION).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CoachLeave & { id: string }));
}

export async function getBlockedSlots(date: string, allSlots: string[]): Promise<Set<string>> {
  const leaves = await getAllLeaves();
  const blocked = new Set<string>();
  const oneHourMs = 60 * 60 * 1000;
  for (const l of leaves) {
    const { start, end } = normalizeLeave(l);
    if (!start || !end || end <= start) continue;
    for (const slot of allSlots) {
      const slotStart = new Date(`${date}T${slot}:00`);
      const slotEnd = new Date(slotStart.getTime() + oneHourMs);
      // interval overlap: [slotStart, slotEnd) intersects [start, end)
      if (slotStart < end && slotEnd > start) blocked.add(slot);
    }
  }
  return blocked;
}

export async function isSlotBlocked(date: string, startTime: string): Promise<boolean> {
  const leaves = await getAllLeaves();
  const slotStart = new Date(`${date}T${startTime}:00`);
  const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
  for (const l of leaves) {
    const { start, end } = normalizeLeave(l);
    if (!start || !end || end <= start) continue;
    if (slotStart < end && slotEnd > start) return true;
  }
  return false;
}

export async function addLeave(startDate: string, startTime: string, endDate: string, endTime: string, note?: string): Promise<string> {
  const start = new Date(`${startDate}T${startTime}:00`);
  const end = new Date(`${endDate}T${endTime}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error('休假開始與結束時間不正確');
  }
  const ref = await getDb().collection(COLLECTION).add({
    startDate,
    startTime,
    endDate,
    endTime,
    // keep legacy field for fallback compatibility in existing UI/logics
    leaveDate: startDate,
    note: note ?? null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function listLeaves(fromDate: string, toDate: string): Promise<(CoachLeave & { id: string })[]> {
  const all = await getAllLeaves();
  const rangeStart = new Date(`${fromDate}T00:00:00`);
  const rangeEnd = new Date(`${toDate}T23:59:59`);
  return all.filter((l) => {
    const { start, end } = normalizeLeave(l);
    if (!start || !end || end <= start) return false;
    return start <= rangeEnd && end >= rangeStart;
  });
}
