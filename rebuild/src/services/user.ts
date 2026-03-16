import { getDb } from '../config/firebase';
import { admin } from '../config/firebase';
import { isCoach } from './line';

const USERS = 'users';
const COACH_WHITELIST = 'coach_whitelist';

export interface User {
  lineUserId: string;
  role: 'student' | 'coach';
  alias?: string;
  displayName?: string;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

export async function getOrCreateUser(lineUserId: string, displayName?: string): Promise<User> {
  const db = getDb();
  const ref = db.collection(USERS).doc(lineUserId);
  const snap = await ref.get();
  if (snap.exists) {
    const existing = snap.data() as User;
    if (displayName && existing.displayName !== displayName) {
      await ref.update({
        displayName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { ...existing, displayName };
    }
    return existing;
  }
  const role = isCoach(lineUserId) ? 'coach' : 'student';
  const now = admin.firestore.FieldValue.serverTimestamp();
  const data: Omit<User, 'createdAt' | 'updatedAt'> & { createdAt: any; updatedAt: any } = {
    lineUserId,
    role,
    ...(displayName && { displayName }),
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(data);
  return { ...data, createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() };
}

export async function getUser(lineUserId: string): Promise<User | null> {
  const snap = await getDb().collection(USERS).doc(lineUserId).get();
  return snap.exists ? (snap.data() as User) : null;
}

export async function setAlias(lineUserId: string, alias: string): Promise<void> {
  const db = getDb();
  await db.collection(USERS).doc(lineUserId).update({
    alias,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function listStudentsWithAlias(): Promise<{ lineUserId: string; alias: string | undefined; displayName: string | undefined }[]> {
  const snap = await getDb().collection(USERS).where('role', '==', 'student').get();
  return snap.docs.map((d) => ({
    lineUserId: d.id,
    alias: (d.data() as User).alias,
    displayName: (d.data() as User).displayName,
  }));
}
