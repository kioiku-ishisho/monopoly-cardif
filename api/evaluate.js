// POST /api/evaluate  { gameId, playerId, record } -> { evaluation, rank }
// 分數由 js/score.js 的計分標準算出（和本機評分同一套），Claude 依分數撰寫總結、決策回顧與建議；
// 結果寫入 Firestore 並計算全服排名。每局只評一次。
import Anthropic from '@anthropic-ai/sdk';
import { FieldValue } from 'firebase-admin/firestore';
import { scoring } from './_lib/catalog.js';
import { findCard } from './_lib/decks.js';
import { db } from './_lib/firebase.js';
import { GAME_ID, HttpError, PLAYER_ID, postHandler } from './_lib/http.js';
import { rankOf } from './_lib/rank.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const DAILY_LIMIT = Number(process.env.EVAL_DAILY_LIMIT || 20); // 每位玩家每天最多評分幾局
const MAX_RECORD_BYTES = 100_000;

// 需與 js/data.js 的 tips id 一致（結算頁會依此解鎖提示）
const TIP_IDS = ['emergency', 'rule72', 'diversify', 'insurance', 'compound', 'healthwealth', 'retirement', 'budget', 'dca', 'panic'];

const SYSTEM_PROMPT = `你是「人生富翁」理財教育遊戲的評審。玩家從 25 歲開始，以某個職業走過青年、中年、老年，透過機會牌（可選擇）、命運牌（無法選擇）、保險與股票投資做財務決策。遊戲在破產、健康歸零、幸福歸零（unhappy，失去生活動力）或活到 100 歲時結束。幸福指數 0–100 約等於心理健康，由人際、休閒、壓力、悲傷等事件增減。

保險有十一種可投保（玩家可以隨時在保險頁投保，也可以問 AI 業務員）：定期壽險、意外險、醫療險（實支實付）、重大傷病險、特定傷病險、癌症險、長照險、投資型保險、住院日額險、終身壽險（分紅）、年金險；另有開局隨機取得、已繳清的舊保單（policies 裡 legacy 為 true，保障偏低，不是玩家自己買的）。保費每月扣款，繳不出會停效。健康 ≤ 30 會進入長照狀態，每月多 3 萬照護費。物價每年上漲，薪資每 5 年只調升 1%；退休後收入降為月薪的 70%（隨物價調整），年金險可以補退休缺口。股市會經歷取材自真實歷史的經濟事件（marketEvents）。身故時壽險等給付計入 legacy（留給家人），不算玩家自己的淨資產。

分數已經由程式依計分標準算好，附在資料的「## 分數」裡，你不需要打分。計分標準（100 分，不計入剩餘資產）：
壽命 20（結束年齡 ÷ 100）、幸福指數 20（平均幸福）、健康指數 20（平均健康）、
保險決策 20（是否及早買醫療、重大疾病、意外、長照或年金等保障，保費占月薪 5–15%，醫療支出被理賠的比例，有沒有停效）、
理財決策 10（保有 3 個月以上生活費的比例、分散投資、有沒有被迫賣股）、保險知識 10（特殊格知識題答對率）。

請參考分數明細，用繁體中文（台灣用語）撰寫，說明時要和分數一致（例如保險決策分數低，就具體指出缺了哪些保障）：
- summary：3～5 句的人生總結，引用具體數字與事件，語氣溫暖但誠實。
- decisions：4～8 則決策回顧，type 為 good（好決策）、bad（待改進）或 info（中性紀錄），每則一句，盡量指出玩家實際做過的選擇。
- advice：3～5 則具體、可在下一局實踐的理財建議，每則對應一個最相關的 tip。

金額單位皆為新台幣元；salary、expense 是「每月」的薪資與支出，年薪 = salary × 12。
如果玩家買了投資型保險，可以提醒「同樣的錢自己買 ETF 沒有費用，先買保障、再分開投資」。
只根據提供的資料判斷，不要臆測沒發生的事。`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'decisions', 'advice'],
  properties: {
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


// 只挑評分需要的欄位，避免把整份紀錄原封不動送出
function facts(r) {
  const pick = ['jobName', 'salary', 'expense', 'endReason', 'endReasonText', 'finalAge', 'finalStage', 'finalCash',
    'finalHealth', 'finalHappiness', 'avgHappiness', 'minHappiness', 'stockValue', 'netWorth', 'peakNetWorth', 'avgHealth', 'minHealth', 'laps', 'turns', 'trades',
    'distinctStocks', 'realizedPnL', 'forcedSales', 'netIncomeAdj', 'insured', 'firstInsuredAge', 'policies',
    'premiumsPaid', 'monthlyPremium', 'maxPremiumRatio', 'policyValue', 'legacy', 'legacyItems', 'medicalHistory',
    'majorIllness', 'ltcAge', 'chanceAccepted', 'chanceDeclined', 'fateCount', 'claims', 'claimTotal', 'holdings',
    'medicalCost', 'lapses', 'emergencyRate', 'avgPremiumRatio', 'quizAsked', 'quizCorrect', 'priceIndex', 'finalSalary',
    'interestTotal', 'marketEvents'];
  const out = Object.fromEntries(pick.filter((k) => k in r).map((k) => [k, r[k]]));
  out.wealthRatio = r.salary ? Math.round((Math.max(0, r.netWorth) / (r.salary * 12)) * 10) / 10 : 0;
  return out;
}

const fmtEffect = (c) => [
  c.cash && `現金${c.cash > 0 ? '+' : ''}${c.cash}`,
  c.netIncome && `淨收入${c.netIncome > 0 ? '+' : ''}${c.netIncome}/月`,
  c.health && `健康${c.health > 0 ? '+' : ''}${c.health}`,
  c.happiness && `幸福${c.happiness > 0 ? '+' : ''}${c.happiness}`,
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

async function askClaude(record, lines, scored) {
  const { LABELS, MAX } = scoring();
  const content = [
    '## 分數',
    `總分 ${scored.score}（${scored.grade} 級）`,
    ...Object.entries(scored.breakdown).map(([k, v]) => `- ${LABELS[k]} ${v}/${MAX[k]}：${(scored.details[k] || []).join('；')}`),
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

function toEvaluation(out, scored) {
  return {
    score: scored.score,
    grade: scored.grade,
    breakdown: scored.breakdown,
    details: scored.details,
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
    const scored = scoring().compute(record);
    evaluation = toEvaluation(await askClaude(record, await drawLines(game), scored), scored);
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
