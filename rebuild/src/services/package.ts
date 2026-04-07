import { getDb } from '../config/firebase';
import { admin } from '../config/firebase';

const COLLECTION = 'packages';
const TX_COLLECTION = 'credit_transactions';

export type PackageStatus = 'active' | 'expired' | 'fully_used' | 'cancelled';
export type CreditReason = 'purchase' | 'lesson_attended' | 'refund' | 'manual_adjustment';

export interface CreditPackage {
  userId: string;
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  validFrom?: string;
  validTo?: string;
  price?: number;
  status: PackageStatus;
  title: string;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

export async function addCredits(
  userId: string,
  credits: number,
  title: string,
  validTo?: string,
  validFrom?: string,
  price?: number
): Promise<string> {
  const db = getDb();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const today = new Date().toISOString().slice(0, 10);
  const ref = await db.collection(COLLECTION).add({
    userId,
    totalCredits: credits,
    usedCredits: 0,
    remainingCredits: credits,
    validFrom: validFrom ?? today,
    validTo: validTo ?? null,
    price: price ?? null,
    status: 'active',
    title,
    createdAt: now,
    updatedAt: now,
  });
  await db.collection(TX_COLLECTION).add({
    packageId: ref.id,
    userId,
    change: credits,
    reason: 'purchase',
    note: title,
    createdAt: now,
  });
  return ref.id;
}

export async function deductCredits(
  userId: string,
  amount: number,
  reason: CreditReason,
  bookingId?: string,
  note?: string,
  approvedByCoach = false
): Promise<{ packageId: string; title: string; remaining: number }> {
  // 防呆：避免任何未經教練核准的自動扣堂。
  if (reason !== 'manual_adjustment' && !approvedByCoach) {
    throw new Error('扣堂需由教練核准或手動執行');
  }
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const pkgsSnap = await db.collection(COLLECTION).where('userId', '==', userId).where('status', '==', 'active').get();
  const pkgs = pkgsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() } as CreditPackage & { id: string }))
    .filter((p) => !p.validTo || p.validTo >= today)
    .filter((p) => p.remainingCredits > 0)
    .sort((a, b) => {
      const va = a.validTo || '9999-12-31';
      const vb = b.validTo || '9999-12-31';
      if (va !== vb) return va.localeCompare(vb);
      return (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0);
    });
  if (pkgs.length === 0) throw new Error('沒有可用的儲值課程包');
  const totalAvailable = pkgs.reduce((sum, p) => sum + (p.remainingCredits || 0), 0);
  if (totalAvailable < amount) throw new Error('堂數不足');
  const pkgRefs = pkgs.map((p) => ({ pkg: p, ref: db.collection(COLLECTION).doc(p.id) }));

  return await db.runTransaction(async (tx) => {
    let remainingToDeduct = amount;
    let firstTouched: { packageId: string; title: string } | null = null;

    for (const { pkg, ref } of pkgRefs) {
      const doc = await tx.get(ref);
      const data = doc.data() as CreditPackage;
      if (!data || data.status !== 'active' || data.remainingCredits <= 0) continue;

      const deductFromThis = Math.min(data.remainingCredits, remainingToDeduct);
      const newRemaining = data.remainingCredits - deductFromThis;
      const newStatus = newRemaining <= 0 ? 'fully_used' : 'active';

      tx.update(ref, {
        usedCredits: admin.firestore.FieldValue.increment(deductFromThis),
        remainingCredits: newRemaining,
        status: newStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(db.collection(TX_COLLECTION).doc(), {
        packageId: pkg.id,
        userId,
        change: -deductFromThis,
        reason,
        bookingId: bookingId ?? null,
        note: note ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (!firstTouched) {
        firstTouched = { packageId: pkg.id, title: data.title };
      }
      remainingToDeduct -= deductFromThis;
      if (remainingToDeduct <= 0) break;
    }

    if (remainingToDeduct > 0 || !firstTouched) throw new Error('堂數不足');

    // Recalculate from in-memory source to avoid extra query in transaction.
    const finalRemaining = totalAvailable - amount;
    return {
      packageId: firstTouched.packageId,
      title: firstTouched.title,
      remaining: finalRemaining,
    };
  });
}

export async function getActivePackages(userId: string): Promise<(CreditPackage & { id: string })[]> {
  const today = new Date().toISOString().slice(0, 10);
  const snap = await getDb()
    .collection(COLLECTION)
    .where('userId', '==', userId)
    .where('status', '==', 'active')
    .get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as CreditPackage & { id: string }))
    .filter((p) => !p.validTo || p.validTo >= today)
    .filter((p) => p.remainingCredits > 0);
}

export async function getTotalRemainingCredits(userId: string): Promise<number> {
  const pkgs = await getActivePackages(userId);
  return pkgs.reduce((sum, p) => sum + p.remainingCredits, 0);
}

export async function getPackagesExpiringWithinDays(days: number): Promise<(CreditPackage & { id: string; userId: string })[]> {
  const today = new Date();
  const future = new Date(today);
  future.setDate(future.getDate() + days);
  const fromStr = today.toISOString().slice(0, 10);
  const toStr = future.toISOString().slice(0, 10);
  const snap = await getDb()
    .collection(COLLECTION)
    .where('status', '==', 'active')
    .where('validTo', '>=', fromStr)
    .where('validTo', '<=', toStr)
    .get();
  return snap.docs
    .map((d) => ({ id: d.id, userId: (d.data() as CreditPackage).userId, ...d.data() } as CreditPackage & { id: string; userId: string }))
    .filter((p) => p.remainingCredits > 0);
}

export async function getAllPackagesForRevenue(): Promise<(CreditPackage & { id: string })[]> {
  const snap = await getDb()
    .collection(COLLECTION)
    .where('status', 'in', ['active', 'fully_used'])
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CreditPackage & { id: string }));
}

export async function getLowCreditPackages(threshold: number): Promise<(CreditPackage & { id: string })[]> {
  const snap = await getDb()
    .collection(COLLECTION)
    .where('status', '==', 'active')
    .get();
  const today = new Date().toISOString().slice(0, 10);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as CreditPackage & { id: string }))
    .filter((p) => !p.validTo || p.validTo >= today)
    .filter((p) => p.remainingCredits > 0 && p.remainingCredits <= threshold);
}
