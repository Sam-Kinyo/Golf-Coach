const fs = require('fs');
const path = require('path');

function getVersionTag() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function updateAppVersion(filePath, version) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const updated = raw.replace(/window\.APP_VERSION\s*=\s*'[^']*';/, `window.APP_VERSION = '${version}';`);
  if (updated === raw) {
    throw new Error(`找不到 APP_VERSION 佔位字串：${filePath}`);
  }
  fs.writeFileSync(filePath, updated, 'utf8');
}

function main() {
  const root = process.cwd();
  const version = getVersionTag();
  const targets = [
    path.join(root, 'liff', 'student', 'index.html'),
    path.join(root, 'liff', 'coach', 'index.html'),
  ];
  targets.forEach((p) => updateAppVersion(p, version));
  console.log(`[bump-liff-version] APP_VERSION -> ${version}`);
}

main();
