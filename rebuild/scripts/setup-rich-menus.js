const fs = require('fs');
const path = require('path');

function parseEnvYaml(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function requireValue(env, key) {
  const v = env[key] || process.env[key];
  if (!v) throw new Error(`Missing required value: ${key}`);
  return v;
}

function createFourButtonRichMenu(name, chatBarText, actions) {
  if (!Array.isArray(actions) || actions.length !== 4) {
    throw new Error('actions must be an array of 4 items');
  }
  const btnWidth = 625;
  return {
    size: { width: 2500, height: 843 },
    selected: false,
    name,
    chatBarText,
    areas: actions.map((action, idx) => ({
      bounds: { x: idx * btnWidth, y: 0, width: btnWidth, height: 843 },
      action,
    })),
  };
}

async function callLineApi(token, method, endpoint, body) {
  const res = await fetch(`https://api.line.me${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LINE API ${method} ${endpoint} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function uploadRichMenuImage(token, richMenuId, imagePath) {
  const content = fs.readFileSync(imagePath);
  const res = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'image/png',
    },
    body: content,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Upload image failed for ${richMenuId}: ${res.status} ${text}`);
  }
}

async function cleanupOldManagedMenus(token) {
  const data = await callLineApi(token, 'GET', '/v2/bot/richmenu/list');
  const menus = Array.isArray(data.richmenus) ? data.richmenus : [];
  const managed = menus.filter((m) => String(m.name || '').startsWith('[GolfCoachAuto]'));
  for (const m of managed) {
    await callLineApi(token, 'DELETE', `/v2/bot/richmenu/${m.richMenuId}`);
  }
}

async function main() {
  const argEnvFileIdx = process.argv.indexOf('--env-file');
  const envFile = argEnvFileIdx >= 0 ? process.argv[argEnvFileIdx + 1] : 'env.production.yaml';
  const envPath = path.isAbsolute(envFile) ? envFile : path.join(process.cwd(), envFile);
  if (!fs.existsSync(envPath)) {
    throw new Error(`Env file not found: ${envPath}`);
  }

  const env = parseEnvYaml(envPath);
  const token = requireValue(env, 'LINE_CHANNEL_ACCESS_TOKEN');
  const coachIdsCsv = requireValue(env, 'COACH_LINE_USER_IDS');
  const liffCoachId = requireValue(env, 'LIFF_COACH_ID');
  const liffStudentId = requireValue(env, 'LIFF_STUDENT_ID');
  const coachIds = coachIdsCsv.split(',').map((s) => s.trim()).filter(Boolean);

  const coachUrl = `https://liff.line.me/${liffCoachId}`;
  // 目前後端是共用 LIFF（依身分自動分流），學員按鈕也走穩定的 coach LIFF 入口，避免 student LIFF 初始化異常。
  const studentUrl = `https://liff.line.me/${liffCoachId}`;

  await cleanupOldManagedMenus(token);

  const coachMenuBody = createFourButtonRichMenu(
    '[GolfCoachAuto] 教練後台',
    '教練常用功能',
    [
      { type: 'uri', uri: coachUrl },
      { type: 'message', text: '查詢今日' },
      { type: 'message', text: '查詢明日' },
      { type: 'uri', uri: coachUrl + '?tab=videos' },
    ]
  );
  const studentMenuBody = createFourButtonRichMenu(
    '[GolfCoachAuto] 學員專區',
    '學員常用功能',
    [
      { type: 'uri', uri: studentUrl },
      { type: 'message', text: '我的預約' },
      { type: 'message', text: '我的堂數' },
      { type: 'uri', uri: studentUrl + '?tab=myvideos' },
    ]
  );

  const coachMenu = await callLineApi(token, 'POST', '/v2/bot/richmenu', coachMenuBody);
  const studentMenu = await callLineApi(token, 'POST', '/v2/bot/richmenu', studentMenuBody);
  const coachMenuId = coachMenu.richMenuId;
  const studentMenuId = studentMenu.richMenuId;
  const coachImagePath = path.join(process.cwd(), 'scripts', 'richmenu-coach.png');
  const studentImagePath = path.join(process.cwd(), 'scripts', 'richmenu-student.png');
  if (!fs.existsSync(coachImagePath) || !fs.existsSync(studentImagePath)) {
    throw new Error('Rich menu images not found. Please run generate-richmenu-images.py first.');
  }

  await uploadRichMenuImage(token, coachMenuId, coachImagePath);
  await uploadRichMenuImage(token, studentMenuId, studentImagePath);

  await callLineApi(token, 'POST', `/v2/bot/user/all/richmenu/${studentMenuId}`);
  for (const coachId of coachIds) {
    await callLineApi(token, 'POST', `/v2/bot/user/${coachId}/richmenu/${coachMenuId}`);
  }

  console.log('Rich menu setup complete.');
  console.log(`Student(default): ${studentMenuId}`);
  console.log(`Coach(override): ${coachMenuId}`);
  console.log(`Coach users linked: ${coachIds.length}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
