// POST /api/evaluate  { gameId, playerId, record } -> { evaluation, rank }
// 由 Claude 依評分規準打分、總結與建議；結果寫入 Firestore 並計算全服排名。每局只評一次。
import Anthropic from '@anthropic-ai/sdk';
import { FieldValue } from 'firebase-admin/firestore';
import { findCard } from './_lib/decks.js';
import { db } from './_lib/firebase.js';
import { GAME_ID, HttpError, PLAYER_ID, postHandler } from './_lib/http.js';
import { rankOf } from './_lib/rank.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const DAILY_LIMIT = Number(process.env.EVAL_DAILY_LIMIT || 20); // 每位玩家每天最多評分幾局
const MAX_RECORD_BYTES = 100_000;

// 各項滿分；Claude 給的分數會再夾在 0～滿分之間後加總
const MAX_POINTS = { longevity: 30, wealth: 35, health: 15, riskManagement: 10, ending: 10 };
// 需與 js/data.js 的 tips id 一致（結算頁會依此解鎖提示）
const TIP_IDS = ['emergency', 'rule72', 'diversify', 'insurance', 'compound', 'healthwealth', 'retirement', 'budget', 'dca', 'panic'];

const SYSTEM_PROMPT = `你是「人生富翁」理財教育遊戲的評審。玩家從 25 歲開始，以某個職業走過青年、中年、老年，透過機會牌（可選擇）、命運牌（無法選擇）、保險與股票投資做財務決策。遊戲在破產、健康歸零或活到 100 歲時結束。

保險有十一種可投保：定期壽險、意外險、醫療險（實支實付）、重大傷病險、特定傷病險、癌症險、長照險、投資型保險、住院日額險、終身壽險（分紅）、年金險；另有開局隨機取得、已繳清的舊保單（policies 裡 legacy 為 true，保障偏低，不是玩家自己買的）。保費每月扣款，繳不出會停效。健康 ≤ 30 會進入長照狀態，每月多 3 萬照護費。退休後收入只剩月薪 40%，年金險可以補退休缺口。身故時壽險等給付計入 legacy（留給家人），不算玩家自己的淨資產。

請依下列規準為這一局評分（每項給整數）：
- longevity（0–30）：活得越久越高；100 歲滿分，40 歲前結束接近 0。
- wealth（0–35）：最終淨資產相對年薪的倍數（wealthRatio）；破產為 0，約 20 倍年薪以上接近滿分。高薪職業不應只因薪水高而得高分。
- health（0–15）：平均健康指數與健康相關選擇。
- riskManagement（0–10）：保險組合是否涵蓋主要風險（醫療、重大傷病、長照、退休）、是否及早投保、保費是否符合雙十原則（maxPremiumRatio 約 0.1，明顯超過或停效都要扣分）、是否分散投資、有沒有被迫賣股、面對機會牌時是否權衡風險。
- ending（0–10）：活到 100 歲 10 分；65 歲後健康耗盡約 6 分；65 歲前約 2 分；破產 0 分。

接著用繁體中文（台灣用語）撰寫：
- summary：3～5 句的人生總結，引用具體數字與事件，語氣溫暖但誠實。
- decisions：4～8 則決策回顧，type 為 good（好決策）、bad（待改進）或 info（中性紀錄），每則一句，盡量指出玩家實際做過的選擇。
- advice：3～5 則具體、可在下一局實踐的理財建議，每則對應一個最相關的 tip。

金額單位皆為新台幣元；salary、expense 是「每月」的薪資與支出，年薪 = salary × 12。
如果玩家買了投資型保險，可以提醒「同樣的錢自己買 ETF 沒有費用，先買保障、再分開投資」。
只根據提供的資料判斷，不要臆測沒發生的事。`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['breakdown', 'summary', 'decisions', 'advice'],
  properties: {
    breakdown: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(MAX_POINTS),
      properties: Object.fromEntries(Object.keys(MAX_POINTS).map((k) => [k, { type: 'integer' }])),
    },
    summary: { type: 'string' },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'text'],
        properties: { type: { type: 'string', enum: ['good', 'bad', 'info'] }, text: { type: 'string' } },
      },
    },
    advice: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tip', 'text'],
        properties: { tip: { type: 'string', enum: TIP_IDS }, text: { type: 'string' } },
      },
    },
  },
};

// 第一次使用時才建立（讀取 ANTHROPIC_API_KEY），缺少金鑰時不會讓整個 function 載入失敗
let anthropic;
const claude = () => (anthropic ||= new Anthropic());

function gradeOf(score) {
  if (score >= 90) return 'S';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 只挑評分需要的欄位，避免把整份紀錄原封不動送出
function facts(r) {
  const pick = ['jobName', 'salary', 'expense', 'endReason', 'endReasonText', 'finalAge', 'finalStage', 'finalCash',
    'finalHealth', 'stockValue', 'netWorth', 'peakNetWorth', 'avgHealth', 'minHealth', 'laps', 'turns', 'trades',
    'distinctStocks', 'realizedPnL', 'forcedSales', 'netIncomeAdj', 'insured', 'firstInsuredAge', 'policies',
    'premiumsPaid', 'monthlyPremium', 'maxPremiumRatio', 'policyValue', 'legacy', 'legacyItems', 'medicalHistory',
    'majorIllness', 'ltcAge', 'chanceAccepted', 'chanceDeclined', 'fateCount', 'claims', 'claimTotal', 'holdings'];
  const out = Object.fromEntries(pick.filter((k) => k in r).map((k) => [k, r[k]]));
  out.wealthRatio = r.salary ? Math.round((Math.max(0, r.netWorth) / (r.salary * 12)) * 10) / 10 : 0;
  return out;
}

const fmtEffect = (c) => [
  c.cash && `現金${c.cash > 0 ? '+' : ''}${c.cash}`,
  c.netIncome && `淨收入${c.netIncome > 0 ? '+' : ''}${c.netIncome}/月`,
  c.health && `健康${c.health > 0 ? '+' : ''}${c.health}`,
].filter(Boolean).join('、');

// 伺服器端記錄的抽牌與選擇（比前端紀錄可信）
async function drawLines(game) {
  const choices = game.get('choices') || {};
  const lines = [];
  for (const id of game.get('drawn') || []) {
    const c = await findCard(id);
    if (!c) continue;
    const choice = c.kind === 'chance' ? (choices[id] === true ? '接受' : choices[id] === false ? '放棄' : '未選擇') : '發生';
    lines.push(`${id}｜${c.kind === 'chance' ? '機會' : '命運'}｜${choice}｜${c.text}（${fmtEffect(c)}）`);
  }
  return lines;
}

async function askClaude(record, lines) {
  const content = [
    '## 結算數據',
    JSON.stringify(facts(record)),
    '## 玩家決策紀錄（遊戲內）',
    (record.log || []).slice(-100).map((l) => `${l.age} 歲：${l.text}`).join('\n') || '（無）',
    '## 抽到的事件牌（伺服器紀錄）',
    lines.join('\n') || '（無）',
  ].join('\n\n');

  // Haiku 沒有伺服器端備援模型；遭拒絕時由下方丟出錯誤，前端會改用本機評分
  const msg = await claude().messages.create(
    {
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    },
    { timeout: 90_000 },
  );
  if (msg.stop_reason === 'refusal') throw new Error('Claude 拒絕評分：' + JSON.stringify(msg.stop_details));
  if (msg.stop_reason === 'max_tokens') throw new Error('Claude 輸出超過 max_tokens');
  const text = msg.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Claude 沒有回傳文字');
  return JSON.parse(text);
}

function toEvaluation(out) {
  const breakdown = Object.fromEntries(
    Object.entries(MAX_POINTS).map(([k, max]) => [k, clamp(Math.round(Number(out.breakdown?.[k]) || 0), 0, max)]),
  );
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return {
    score,
    grade: gradeOf(score),
    breakdown,
    summary: String(out.summary || ''),
    decisions: (out.decisions || []).slice(0, 8),
    advice: (out.advice || []).filter((a) => TIP_IDS.includes(a.tip)).slice(0, 5),
    source: 'claude',
    model: MODEL,
  };
}

export default postHandler(async (req, body) => {
  const { gameId, playerId, record } = body;
  if (!GAME_ID.test(String(gameId)) || !PLAYER_ID.test(String(playerId)) || !record || typeof record !== 'object') {
    throw new HttpError(400, 'invalid_params');
  }
  if (JSON.stringify(record).length > MAX_RECORD_BYTES) throw new HttpError(413, 'record_too_large');

  const gameRef = db().collection('games').doc(gameId);
  const playerRef = db().collection('players').doc(playerId);
  const game = await gameRef.get();
  if (!game.exists || game.get('playerId') !== playerId) throw new HttpError(404, 'game_not_found');

  // 同一局重複請求（例如重新整理）直接回傳之前的結果
  if (game.get('evaluation')) return { evaluation: game.get('evaluation'), rank: await rankOf(playerId) };

  // 每日次數限制，避免 API 費用被濫用
  const today = new Date().toISOString().slice(0, 10);
  await db().runTransaction(async (tx) => {
    const p = await tx.get(playerRef);
    const count = p.get('evalDay') === today ? p.get('evalCount') || 0 : 0;
    if (count >= DAILY_LIMIT) throw new HttpError(429, 'daily_limit');
    tx.set(playerRef, { evalDay: today, evalCount: count + 1 }, { merge: true });
  });

  let evaluation;
  try {
    evaluation = toEvaluation(await askClaude(record, await drawLines(game)));
  } catch (e) {
    console.error('Claude 評分失敗', e);
    throw new HttpError(503, 'ai_unavailable');
  }

  await db().runTransaction(async (tx) => {
    const [g, p] = await Promise.all([tx.get(gameRef), tx.get(playerRef)]);
    if (g.get('evaluation')) return; // 併發請求已寫入
    tx.update(gameRef, {
      evaluation,
      score: evaluation.score,
      facts: facts(record),
      evaluatedAt: FieldValue.serverTimestamp(),
    });
    const best = p.get('bestScore') ?? -1;
    tx.set(playerRef, {
      gamesEvaluated: FieldValue.increment(1),
      lastPlayedAt: FieldValue.serverTimestamp(),
      ...(evaluation.score > best ? {
        bestScore: evaluation.score,
        bestGrade: evaluation.grade,
        bestGameId: gameId,
        bestJobName: String(record.jobName || '').slice(0, 20),
        bestJobIcon: String(record.jobIcon || '').slice(0, 8),
        bestFinalAge: Number(record.finalAge) || null,
        bestAt: FieldValue.serverTimestamp(),
      } : {}),
    }, { merge: true });
  });

  const saved = (await gameRef.get()).get('evaluation');
  return { evaluation: saved, rank: await rankOf(playerId) };
});
