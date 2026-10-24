// 把 docs/event-cards.md 裡「心理類」事件的健康影響改成幸福影響，並產生對照表 docs/幸福指數對照表.md
//
// 用法：node scripts/happiness-cards.mjs
// MOVE 是人工判斷的清單：情緒、人際、休閒娛樂、壓力、悲傷與喜悅 → 幸福；運動、飲食、疾病、受傷、醫療、體力勞累 → 維持健康。
// 已經改過的牌（影響欄已是「幸福」）會略過，可以重複執行。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'docs', 'event-cards.md');
const OUT = path.join(root, 'docs', '幸福指數對照表.md');

const MOVE = `
Y1-11 Y1-12 Y1-17 Y1-18 Y1-21 Y1-24 Y1-28 Y1-31 Y1-34 Y1-44 Y1-46 Y1-48
Y2-36 Y2-40
Y3-10 Y3-11 Y3-12 Y3-14 Y3-19 Y3-32 Y3-34 Y3-35 Y3-37 Y3-39 Y3-40 Y3-42 Y3-46 Y3-49 Y3-50
Y4-20 Y4-35
Y5-09 Y5-10 Y5-11 Y5-28 Y5-29 Y5-32 Y5-33 Y5-44 Y5-47 Y5-50
Y6-01 Y6-02 Y6-10 Y6-12 Y6-13 Y6-15 Y6-17 Y6-18 Y6-19 Y6-20 Y6-23 Y6-24 Y6-25 Y6-30 Y6-31 Y6-32
Y6-34 Y6-35 Y6-37 Y6-38 Y6-39 Y6-42 Y6-47 Y6-48 Y6-49 Y6-50
M1-04 M1-06 M1-09 M1-11 M1-12 M1-13 M1-17 M1-29 M1-35 M1-40 M1-41 M1-50
M2-16 M2-32 M2-39 M2-45
M3-01 M3-02 M3-04 M3-05 M3-06 M3-08 M3-09 M3-11 M3-13 M3-16 M3-17 M3-22 M3-23 M3-25 M3-26 M3-27
M3-29 M3-34 M3-37 M3-38 M3-50
M4-03 M4-05 M4-45
M5-12 M5-14 M5-16 M5-19 M5-29 M5-33 M5-38 M5-44
M6-02 M6-03 M6-07 M6-09 M6-14 M6-15 M6-16 M6-18 M6-21 M6-22 M6-24 M6-25 M6-29 M6-32 M6-33 M6-35
M6-38 M6-39 M6-41 M6-42 M6-44 M6-45 M6-46 M6-47 M6-48 M6-49
O1-03 O1-04 O1-06 O1-10 O1-12 O1-17 O1-20 O1-22 O1-23 O1-26 O1-29 O1-30 O1-33 O1-35 O1-39 O1-42
O1-43 O1-45 O1-47 O1-48 O1-49
O2-04 O2-05 O2-07 O2-13 O2-14 O2-16 O2-17 O2-18 O2-24 O2-27 O2-28 O2-31 O2-33 O2-37 O2-39 O2-43
O3-05 O3-06 O3-13 O3-14 O3-28 O3-31 O3-34 O3-35 O3-39 O3-42 O3-43 O3-45 O3-48
O4-05 O4-10 O4-17 O4-24 O4-26 O4-29 O4-31 O4-33 O4-43 O4-45 O4-50
O5-04 O5-12 O5-16 O5-18 O5-28 O5-37 O5-40 O5-41 O5-44
O6-02 O6-03 O6-05 O6-07 O6-08 O6-09 O6-10 O6-12 O6-15 O6-16 O6-17 O6-18 O6-21 O6-23 O6-27 O6-28
O6-29 O6-30 O6-31 O6-34 O6-36 O6-38 O6-39 O6-40 O6-41 O6-42 O6-44 O6-45 O6-46 O6-48 O6-49
`.trim().split(/\s+/);

const ROW = /^(\|\s*([YMO][1-6]-\d{2})\s*\|(.+?)\|)(.+?)(\|\s*(?:機會|命運)\s*\|\s*)$/;
const STAGE = { Y: '青年', M: '中年', O: '老年' };

const lines = readFileSync(SRC, 'utf8').split(/\r?\n/);
const moved = [];
const missing = new Set(MOVE);
const out = lines.map((line) => {
  const m = line.match(ROW);
  if (!m || !MOVE.includes(m[2])) return line;
  missing.delete(m[2]);
  if (!/健康\s*[+\-−]/.test(m[4])) return line; // 已改過或沒有健康影響
  const effect = m[4].replace(/健康(\s*[+\-−])/, '幸福$1');
  moved.push({ id: m[2], text: m[3].trim(), before: m[4].trim(), after: effect.trim() });
  return m[1] + effect + m[5];
});
if (missing.size) throw new Error(`找不到這些牌：${[...missing].join(', ')}`);

// 說明表加上幸福的寫法（只加一次）
const legendAt = out.findIndex((l) => l.startsWith('| ⑥ | 增加健康 |'));
if (legendAt >= 0 && !out[legendAt + 1].startsWith('| ⑦')) {
  out.splice(legendAt + 1, 0, '| ⑦ | 幸福增減 | 幸福 ±點數（幸福指數 0–100，約等於心理健康；歸零遊戲結束） |');
}
writeFileSync(SRC, out.join('\n'));

const byStage = { Y: [], M: [], O: [] };
moved.forEach((c) => byStage[c.id[0]].push(c));
const md = [
  '# 幸福指數對照表',
  '',
  `由 \`scripts/happiness-cards.mjs\` 產生。共 ${moved.length} 張牌的「健康」影響改為「幸福」：情緒、人際、休閒娛樂、壓力、悲傷與喜悅類的事件。運動、飲食、疾病、受傷、醫療與體力勞累類維持健康。`,
  '',
  '確認後執行 `npm run import-cards` 上傳到 Firestore；要調整時改腳本裡的 MOVE 清單（或直接改 `docs/event-cards.md`）。',
  '',
  ...Object.entries(byStage).flatMap(([s, list]) => [
    `## ${STAGE[s]}（${list.length} 張）`,
    '',
    '| 編號 | 事件 | 原本 | 改為 |',
    '| --- | --- | --- | --- |',
    ...list.map((c) => `| ${c.id} | ${c.text} | ${c.before} | ${c.after} |`),
    '',
  ]),
].join('\n');
writeFileSync(OUT, md);
console.log(`已改 ${moved.length} 張牌，對照表：docs/幸福指數對照表.md`);
