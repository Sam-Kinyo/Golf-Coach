import { getDb } from '../config/firebase';
import { admin } from '../config/firebase';

const COLLECTION = 'waitlists';

export type WaitlistStatus = 'waiting' | 'notified' | 'cancelled';

export interface WaitlistEntry {
  userId: string;
  desiredDate: string;
  startTime: string;
  location?: string;
  service?: string;
  status: WaitlistStatus;
  notifiedAt?: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
}

export async function addToWaitlist(
  userId: string,
  desiredDate: string,
  startTime: string,
  location?: string,
  service?: string
): Promise<string> {
  const ref = await getDb().collection(COLLECTION).add({
    userId,
    desiredDate,
    startTime,
    location: location ?? null,
    service: service ?? null,
    status: 'waiting',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function getWaitlistForSlot(desiredDate: string, startTime: string): Promise<(WaitlistEntry & { id: string })[]> {
  const snap = await getDb()
    .collection(COLLECTION)
    .where('desiredDate', '==', desiredDate)
    .where('startTime', '==', startTime)
    .where('status', '==', 'waiting')
    .orderBy('createdAt')
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as WaitlistEntry & { id: string }));
}

export async function markNotified(waitlistId: string): Promise<void> {
  await getDb().collection(COLLECTION).doc(waitlistId).update({
    status: 'notified',
    notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}
