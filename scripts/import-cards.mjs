// 把 docs/event-cards.md 的事件牌上傳到 Firestore 的 cardDecks 集合
//
// 用法：
//   npm run import-cards:dry   只解析並顯示統計，不上傳
//   npm run import-cards       上傳（需要 .env.local 的 FIREBASE_SERVICE_ACCOUNT）
//
// 每個「階段 × 牌種」存成一份文件（共 6 份，例如 cardDecks/youth-chance），
// 抽牌時只需讀一份文件，比一張牌一份文件省下大量讀取次數。
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'docs', 'event-cards.md');
const dryRun = process.argv.includes('--dry-run');

const STAGES = { Y: 'youth', M: 'middle', O: 'elder' };
const KINDS = { 機會: 'chance', 命運: 'fate' };
const ROW = /^\|\s*([YMO])([1-6])-(\d{2})\s*\|(.+?)\|(.+?)\|\s*(機會|命運)\s*\|\s*$/;
const EFFECT = /(現金|淨收入|健康|幸福)\s*([+\-−])\s*([\d,]+)/; // 「−」(U+2212) 也算負號
const FIELD = { 現金: 'cash', 淨收入: 'netIncome', 健康: 'health', 幸福: 'happiness' };

function parseEffects(text, id) {
  const eff = { cash: 0, netIncome: 0, health: 0, happiness: 0 };
  for (const part of text.split(/[；;]/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(EFFECT);
    if (!m) throw new Error(`${id} 無法解析影響「${part}」`);
    const value = Number(m[3].replace(/,/g, ''));
    eff[FIELD[m[1]]] += m[2] === '+' ? value : -value;
  }
  return eff;
}

function parseCards() {
  const cards = [];
  const errors = [];
  readFileSync(SRC, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const m = line.match(ROW);
    if (!m) {
      if (/^\|\s*[YMO]\d-\d/.test(line)) errors.push(`第 ${i + 1} 行格式不符：${line}`);
      return;
    }
    const [, stage, category, num, text, effectText, kind] = m;
    const id = `${stage}${category}-${num}`;
    try {
      cards.push({ id, stage: STAGES[stage], kind: KINDS[kind], category: Number(category), text: text.trim(), ...parseEffects(effectText, id) });
    } catch (e) {
      errors.push(`第 ${i + 1} 行：${e.message}`);
    }
  });
  const ids = cards.map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) errors.push(`編號重複：${[...new Set(dupes)].join(', ')}`);
  if (errors.length) throw new Error(errors.join('\n'));
  return cards;
}

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
