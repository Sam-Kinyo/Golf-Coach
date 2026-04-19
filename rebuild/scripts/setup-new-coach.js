const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');

function ask(rl, question, defaultVal) {
  return new Promise((resolve) => {
    const hint = defaultVal ? ` (預設: ${defaultVal})` : '';
    rl.question(`${question}${hint}: `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n🏌️ 高爾夫教練預約系統 — 新教練設定工具\n');
  console.log('請依序填寫以下資訊，系統會自動寫入對應的設定檔。\n');
  console.log('━━━ 基本設定 ━━━\n');

  const firebaseProjectId = await ask(rl, 'Firebase 專案 ID');
  const cloudRunServiceName = await ask(rl, 'Cloud Run 服務名稱', 'golf-coach-api');
  const cloudRunRegion = await ask(rl, 'Cloud Run 區域', 'asia-east1');

  console.log('\n━━━ LINE 設定 ━━━\n');

  const lineToken = await ask(rl, 'LINE Channel Access Token');
  const lineSecret = await ask(rl, 'LINE Channel Secret');
  const liffCoachId = await ask(rl, '教練 LIFF ID（例如 1234567890-abcdefgh）');
  const liffStudentId = await ask(rl, '學員 LIFF ID（例如 1234567890-xxxxxxxx）');
  const coachUserIds = await ask(rl, '教練 LINE User ID（多個用逗號分隔）');
  const cronSecret = await ask(rl, 'Cron Secret（自訂密碼）', Math.random().toString(36).slice(2, 14));

  console.log('\n━━━ 教學設定 ━━━\n');

  const locations = [];
  console.log('請輸入上課地點（輸入空白結束）：');
  while (true) {
    const name = await ask(rl, `  地點名稱 #${locations.length + 1}`);
    if (!name) break;
    const url = await ask(rl, `  Google Maps 連結`);
    locations.push({ name, url });
  }
  if (locations.length === 0) {
    locations.push({ name: '練習場A', url: 'https://www.google.com/maps' });
  }

  const services = [];
  console.log('\n請輸入課程類型（輸入空白結束）：');
  while (true) {
    const name = await ask(rl, `  課程名稱 #${services.length + 1}`);
    if (!name) break;
    const hours = await ask(rl, `  時數（小時）`, '1');
    services.push({ name, hours: Number(hours) || 1 });
  }
  if (services.length === 0) {
    services.push({ name: '1對1教學', hours: 1 });
    services.push({ name: '體驗課程', hours: 1 });
  }

  const bizStart = await ask(rl, '營業開始時間（小時，0-23）', '6');
  const bizEnd = await ask(rl, '營業結束時間（小時，0-23）', '22');

  rl.close();

  console.log('\n━━━ 寫入設定檔 ━━━\n');

  // 1. .firebaserc
  const firebaserc = { projects: { default: firebaseProjectId } };
  fs.writeFileSync(path.join(ROOT, '.firebaserc'), JSON.stringify(firebaserc, null, 2) + '\n');
  console.log('✅ .firebaserc');

  // 2. firebase.json
  const firebaseJson = {
    hosting: {
      public: 'liff',
      ignore: ['firebase.json', '**/.*', '**/node_modules/**'],
      predeploy: ['npm run bump:liff-version'],
      rewrites: [{ source: '/api/**', run: { serviceId: cloudRunServiceName, region: cloudRunRegion } }],
      headers: [
        { source: '**/*.html', headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' }, { key: 'Pragma', value: 'no-cache' }] },
        { source: '**/*.@(js|css|png|jpg|svg|ico|woff2)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      ],
    },
  };
  fs.writeFileSync(path.join(ROOT, 'firebase.json'), JSON.stringify(firebaseJson, null, 2) + '\n');
  console.log('✅ firebase.json');

  // 3. env.production.yaml
  const envYaml = [
    `# Cloud Run 環境變數`,
    `LINE_CHANNEL_ACCESS_TOKEN: "${lineToken}"`,
    `LINE_CHANNEL_SECRET: "${lineSecret}"`,
    `LIFF_COACH_ID: "${liffCoachId}"`,
    `LIFF_STUDENT_ID: "${liffStudentId}"`,
    `CRON_SECRET: "${cronSecret}"`,
    `COACH_LINE_USER_IDS: "${coachUserIds}"`,
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(ROOT, 'env.production.yaml'), envYaml);
  console.log('✅ env.production.yaml');

  // 4. .env (for local dev)
  const dotenv = [
    `LINE_CHANNEL_ACCESS_TOKEN=${lineToken}`,
    `LINE_CHANNEL_SECRET=${lineSecret}`,
    `LIFF_COACH_ID=${liffCoachId}`,
    `LIFF_STUDENT_ID=${liffStudentId}`,
    `CRON_SECRET=${cronSecret}`,
    `COACH_LINE_USER_IDS=${coachUserIds}`,
    `GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json`,
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(ROOT, '.env'), dotenv);
  console.log('✅ .env');

  // 5. liff/coach/index.html — replace LIFF ID
  const coachHtml = path.join(ROOT, 'liff', 'coach', 'index.html');
  let coachContent = fs.readFileSync(coachHtml, 'utf8');
  coachContent = coachContent.replace(/window\.LIFF_ID\s*=\s*'[^']*'/, `window.LIFF_ID = '${liffCoachId}'`);
  fs.writeFileSync(coachHtml, coachContent);
  console.log('✅ liff/coach/index.html');

  // 6. liff/student/index.html — replace LIFF ID
  const studentHtml = path.join(ROOT, 'liff', 'student', 'index.html');
  let studentContent = fs.readFileSync(studentHtml, 'utf8');
  studentContent = studentContent.replace(/window\.LIFF_ID\s*=\s*'[^']*'/, `window.LIFF_ID = '${liffStudentId}'`);
  fs.writeFileSync(studentHtml, studentContent);
  console.log('✅ liff/student/index.html');

  // 7. src/utils/constants.ts — locations, services, business hours
  const locationEntries = locations.map((l) => `  '${l.name}': '${l.url}',`).join('\n');
  const serviceEntries = services.map((s) => `  '${s.name}': ${s.hours},`).join('\n');
  const constantsContent = `export const BUSINESS_HOURS = {
  start: ${Number(bizStart) || 6},
  end: ${Number(bizEnd) || 22},
  intervalMinutes: 60,
} as const;

export function getAvailableTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = BUSINESS_HOURS.start; h < BUSINESS_HOURS.end; h++) {
    slots.push(\`\${String(h).padStart(2, '0')}:00\`);
  }
  return slots;
}

export const SERVICE_DURATION: Record<string, number> = {
${serviceEntries}
};

export const LOCATION_MAP: Record<string, string> = {
${locationEntries}
};
`;
  fs.writeFileSync(path.join(ROOT, 'src', 'utils', 'constants.ts'), constantsContent);
  console.log('✅ src/utils/constants.ts');

  // Done
  console.log('\n━━━ 設定完成 ━━━\n');
  console.log('接下來請執行：');
  console.log('  1. 把 serviceAccountKey.json 放到專案根目錄');
  console.log('  2. bash scripts/deploy.sh');
  console.log(`  3. 到 LINE Developers Console 設定 Webhook URL:`);
  console.log(`     https://${cloudRunServiceName}-XXXXXX.${cloudRunRegion}.run.app/webhook`);
  console.log('  4. 設定 Cloud Scheduler（參考 SETUP.md）\n');
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
