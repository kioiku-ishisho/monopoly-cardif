// 解析 docs/event-cards.md 的事件牌（import-cards 與 simulate 共用）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(root, 'docs', 'event-cards.md');

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

export function parseCards() {
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
