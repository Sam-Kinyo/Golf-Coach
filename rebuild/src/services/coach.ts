import { admin, getDb } from '../config/firebase';
import type { Coach, CoachStatus, CoachWithId } from '../types/coach';
import { COACHES_COLLECTION, coachRef } from '../utils/firestore-helpers';
import { getSecret } from './secrets';

export async function getCoachConfig(coachId: string): Promise<Coach | null> {
  const snap = await coachRef(coachId).get();
  if (!snap.exists) return null;
  return snap.data() as Coach;
}

export async function listCoaches(filter?: { status?: CoachStatus }): Promise<CoachWithId[]> {
  let q: FirebaseFirestore.Query = getDb().collection(COACHES_COLLECTION);
  if (filter?.status) q = q.where('status', '==', filter.status);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Coach) }));
}

export async function updateCoach(coachId: string, patch: Partial<Coach>): Promise<void> {
  await coachRef(coachId).update({
    ...patch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function getCoachLineToken(coachId: string): Promise<string> {
  const coach = await getCoachConfig(coachId);
  if (!coach) throw new Error(`Coach ${coachId} not found`);
  return getSecret(coach.line.channelAccessTokenRef);
}

export async function getCoachLineSecret(coachId: string): Promise<string> {
  const coach = await getCoachConfig(coachId);
  if (!coach) throw new Error(`Coach ${coachId} not found`);
  return getSecret(coach.line.channelSecretRef);
}
