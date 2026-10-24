// 把 docs/event-cards.md 的事件牌上傳到 Firestore 的 cardDecks 集合
//
// 用法：
//   npm run import-cards:dry   只解析並顯示統計，不上傳
//   npm run import-cards       上傳（需要 .env.local 的 FIREBASE_SERVICE_ACCOUNT）
//
// 每個「階段 × 牌種」存成一份文件（共 6 份，例如 cardDecks/youth-chance），
// 抽牌時只需讀一份文件，比一張牌一份文件省下大量讀取次數。
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseCards, root } from './lib/cards.mjs';

const dryRun = process.argv.includes('--dry-run');

// 讀取 .env.local（vercel env pull 產生的格式）
function loadEnvFile() {
  const file = path.join(root, '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v.replace(/\\n/g, '\n');
  }
}

const cards = parseCards();
const decks = {};
for (const c of cards) (decks[`${c.stage}-${c.kind}`] ||= []).push(c);

console.log(`解析 ${cards.length} 張牌：`);
for (const [key, list] of Object.entries(decks)) console.log(`  ${key.padEnd(14)} ${list.length}`);

if (dryRun) {
  console.log('（--dry-run，未上傳）');
} else {
  loadEnvFile();
  const { db } = await import('../api/_lib/firebase.js');
  const batch = db().batch();
  for (const [key, list] of Object.entries(decks)) {
    batch.set(db().collection('cardDecks').doc(key), { cards: list, count: list.length, updatedAt: new Date() });
  }
  await batch.commit();
  console.log(`已上傳 ${Object.keys(decks).length} 份牌組到 Firestore cardDecks`);
}
