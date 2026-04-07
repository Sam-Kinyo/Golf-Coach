import { getDb } from '../config/firebase';
import { admin } from '../config/firebase';
import { SERVICE_DURATION, getAvailableTimeSlots } from '../utils/constants';
import { getBlockedSlots } from './coachLeave';

const COLLECTION = 'fixed_schedules';

export interface FixedScheduleTemplate {
  weekday: number; // 0=Sunday ... 6=Saturday
  startTime: string; // HH:mm
  location: string;
  service: string;
  note?: string;
  enabled: boolean;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

export interface FixedSession {
  templateId: string;
  date: string;
  weekday: number;
  startTime: string;
  endTime: string;
  location: string;
  service: string;
  note?: string;
}

function parseHour(time: string): number {
  return parseInt((time || '00:00').split(':')[0], 10);
}

function toWeekday(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getDay();
}

export async function listFixedSchedules(): Promise<(FixedScheduleTemplate & { id: string })[]> {
  const snap = await getDb().collection(COLLECTION).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as FixedScheduleTemplate & { id: string }))
    .sort((a, b) => {
      if (a.weekday !== b.weekday) return a.weekday - b.weekday;
      return a.startTime.localeCompare(b.startTime);
    });
}

export async function addFixedSchedule(input: {
  weekday: number;
  startTime: string;
  location: string;
  service: string;
  note?: string;
}): Promise<string> {
  const { weekday, startTime, location, service, note } = input;
  if (weekday < 0 || weekday > 6) throw new Error('星期格式錯誤');
  const h = parseHour(startTime);
  if (Number.isNaN(h) || h < 0 || h > 23) throw new Error('開始時間格式錯誤');
  const duration = SERVICE_DURATION[service] ?? 1;
  const end = h + duration;
  if (end > 22) throw new Error('固定課程超出營業時間');

  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = await getDb().collection(COLLECTION).add({
    weekday,
    startTime,
    location,
    service,
    note: note ?? null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function deleteFixedSchedule(id: string): Promise<void> {
  await getDb().collection(COLLECTION).doc(id).delete();
}

export async function getFixedSessionsOnDate(date: string): Promise<FixedSession[]> {
  const weekday = toWeekday(date);
  const templates = await listFixedSchedules();
  const allSlots = getAvailableTimeSlots();
  const blockedSet = await getBlockedSlots(date, allSlots);

  const sessions: FixedSession[] = [];
  for (const t of templates) {
    if (t.enabled === false || t.weekday !== weekday) continue;

    const startH = parseHour(t.startTime);
    const duration = SERVICE_DURATION[t.service] ?? 1;
    let blocked = false;
    for (let i = 0; i < duration; i++) {
      const slot = `${String(startH + i).padStart(2, '0')}:00`;
      if (blockedSet.has(slot)) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const endH = startH + duration;
    sessions.push({
      templateId: t.id,
      date,
      weekday,
      startTime: t.startTime,
      endTime: `${String(endH).padStart(2, '0')}:00`,
      location: t.location,
      service: t.service,
      note: t.note,
    });
  }
  return sessions;
}

export async function getFixedSessionsByDateRange(fromDate: string, toDate: string): Promise<FixedSession[]> {
  const start = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }
  const sessions: FixedSession[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const date = `${y}-${m}-${day}`;
    const oneDay = await getFixedSessionsOnDate(date);
    sessions.push(...oneDay);
  }
  return sessions.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.startTime.localeCompare(b.startTime);
  });
}
