// 解析 docs/event-cards.md 的事件牌（import-cards 與 simulate 共用）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(root, 'docs', 'event-cards.md');

const STAGES = { Y: 'youth', M: 'middle', O: 'elder' };
const KINDS = { 機會: 'chance', 命運: 'fate' };
const ROW = /^\|\s*([YMO])([1-6])-(\d{2})\s*\|(.+?)\|(.+?)\|\s*(機會|命運)\s*\|\s*$/;
// 職業事件多一欄「職業」，編號第二碼固定為 7
const JOB_ROW = /^\|\s*([YMO])(7)-(\d{2})\s*\|(.+?)\|(.+?)\|(.+?)\|\s*(機會|命運)\s*\|\s*$/;
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

// 職業名稱 → id，讀自 js/data.js
function jobIds() {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(path.join(root, 'js', 'data.js'), 'utf8'), sandbox);
  return Object.fromEntries(sandbox.window.GameData.jobs.map((j) => [j.name, j.id]));
}

export function parseCards() {
  const cards = [];
  const errors = [];
  const JOB_ID = jobIds();
  readFileSync(SRC, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const jm = line.match(JOB_ROW);
    const m = jm ? [jm[0], jm[1], jm[2], jm[3], jm[5], jm[6], jm[7]] : line.match(ROW);
    if (!m) {
      if (/^\|\s*[YMO]\d-\d/.test(line)) errors.push(`第 ${i + 1} 行格式不符：${line}`);
      return;
    }
    const [, stage, category, num, text, effectText, kind] = m;
    const id = `${stage}${category}-${num}`;
    try {
      const card = { id, stage: STAGES[stage], kind: KINDS[kind], category: Number(category), text: text.trim(), ...parseEffects(effectText, id) };
      if (jm) {
        card.job = JOB_ID[jm[4].trim()];
        if (!card.job) throw new Error(`${id} 找不到職業「${jm[4].trim()}」`);
      }
      cards.push(card);
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
