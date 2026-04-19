import { getDb } from '../config/firebase';

export const COACHES_COLLECTION = 'coaches';

export function coachRef(coachId: string) {
  return getDb().collection(COACHES_COLLECTION).doc(coachId);
}

export function coachDb(coachId: string) {
  const base = coachRef(coachId);
  return {
    users: base.collection('users'),
    coachWhitelist: base.collection('coach_whitelist'),
    packages: base.collection('packages'),
    creditTransactions: base.collection('credit_transactions'),
    bookings: base.collection('bookings'),
    waitlists: base.collection('waitlists'),
    notificationsLog: base.collection('notifications_log'),
    coachLeaves: base.collection('coach_leaves'),
    fixedSchedules: base.collection('fixed_schedules'),
    fixedScheduleExceptions: base.collection('fixed_schedule_exceptions'),
  };
}

export type CoachDb = ReturnType<typeof coachDb>;
