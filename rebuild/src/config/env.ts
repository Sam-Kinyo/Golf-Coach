import path from 'path';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function optionalEnv(name: string, def: string): string {
  return process.env[name] ?? def;
}

export const env = {
  line: {
    channelAccessToken: requireEnv('LINE_CHANNEL_ACCESS_TOKEN'),
    channelSecret: requireEnv('LINE_CHANNEL_SECRET'),
  },
  liff: {
    coachId: optionalEnv('LIFF_COACH_ID', ''),
    studentId: optionalEnv('LIFF_STUDENT_ID', ''),
  },
  cronSecret: optionalEnv('CRON_SECRET', 'change-me-in-production'),
  coachLineUserIds: (process.env.COACH_LINE_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  firebase: {
    credentialPath: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? path.join(process.cwd(), 'serviceAccountKey.json'),
  },
};
