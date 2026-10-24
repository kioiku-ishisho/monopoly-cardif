// POST /api/agent  { gameId, playerId, context, messages } -> { reply, recommendations }
// 保險業務員對話：Claude 依玩家狀況回答問題，需要推薦時呼叫 recommend 工具，前端把推薦顯示成投保按鈕。
// AI 只負責建議，真正投保（扣錢）一律由玩家在前端按下按鈕。
import Anthropic from '@anthropic-ai/sdk';
import { gameData } from './_lib/catalog.js';
import { db } from './_lib/firebase.js';
import { GAME_ID, HttpError, PLAYER_ID, postHandler } from './_lib/http.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const DAILY_LIMIT = Number(process.env.AGENT_DAILY_LIMIT || 60); // 每位玩家每天最多幾則業務員對話
const MAX_TURNS = 12; // 一次來訪最多幾則訊息（玩家 + 業務員）
const MAX_TEXT = 300; // 玩家每則訊息字數上限
const MAX_TOOL_ROUNDS = 3;

let anthropic;
const claude = () => (anthropic ||= new Anthropic());

const TAG_NAME = { accident: '意外', hospital: '一般住院', cancer: '癌症', heart: '心肌梗塞', stroke: '腦中風', esrd: '末期腎病', ltc: '長照' };

function payTerm(p) {
  if (p.payMonths) return `繳 ${p.payMonths / 12} 年`;
  if (p.payUntilAge) return `繳到 ${p.payUntilAge} 歲`;
  if (p.id === 'invest') return '彈性，可隨時停繳';
  return '一年期，每圈續約';
}

// 險種目錄（固定內容，放在 system 開頭以利快取）
function catalogText() {
  return gameData().insurance.products.map((p) => [
    `### ${p.name}（id: ${p.id}）`,
    `- 保障：${p.summary}`,
    `- 繳費：${payTerm(p)}；保障：${p.coverUntilAge === Infinity ? '終身' : `到 ${p.coverUntilAge} 歲`}；${p.waitMonths ? `等待期 ${p.waitMonths} 個月` : '立即生效'}`,
    p.covers ? `- 理賠範圍：${p.covers.map((t) => TAG_NAME[t]).join('、')}` : '',
    p.excludeHistory ? `- 有${p.excludeHistory.map((t) => TAG_NAME[t]).join('、')}病史不可投保` : '',
    p.amounts ? `- 月繳可選：${p.amounts.join('／')} 元` : '',
    `- 說明：${p.note}`,
  ].filter(Boolean).join('\n')).join('\n\n');
}

const SYSTEM_RULES = `你是「人生富翁」理財教育遊戲裡的保險業務員，正在和玩家面對面聊天。玩家是用遊戲角色在學習保險觀念。

說話方式：
- 用繁體中文（台灣用語），親切、口語、簡短，每次回覆 2～5 句，不用 Markdown 標題或表格。
- 誠實：只介紹下方目錄裡的險種，不編造商品、條款或數字；保費一律以「玩家狀況」裡的報價為準。
- 先了解需求再推薦：考慮玩家的年齡、職業、健康、病史、現有保單、現金與月薪。保費總額建議約月薪 10%（雙十原則），超過要提醒。
- 也要講缺點與限制，例如等待期、沒有解約金、儲蓄型保費比較貴、投資型可能虧損。玩家已經有的保障不要重複推銷。
- 適合推薦某個險種時，呼叫 recommend 工具（每次最多推薦 3 種），並在文字中說明理由；玩家按下按鈕才會投保，你不能替玩家投保。
- 無法投保的險種（報價寫「無法投保」）不要推薦，可以說明原因。
- 和保險、理財無關的話題，簡短帶回保險主題。

## 險種目錄
`;

const TOOLS = [
  {
    name: 'recommend',
    description: '向玩家推薦一個可以投保的險種，前端會顯示成「投保」按鈕。只在真的建議玩家考慮這個險種時使用。',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['productId', 'amount', 'reason'],
      properties: {
        productId: { type: 'string', description: '險種 id（見險種目錄）' },
        amount: { type: 'integer', description: '月繳金額；只有可自選金額的險種（投資型、年金）需要，其他填 0' },
        reason: { type: 'string', description: '一句話說明為什麼適合這位玩家（20 字以內）' },
      },
    },
  },
];

const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
const str = (v, max) => String(v ?? '').slice(0, max);

// 前端送來的玩家狀況：只取需要的欄位並限制長度
function contextText(c, productIds) {
  const quotes = Array.isArray(c.quotes) ? c.quotes.filter((q) => productIds.includes(q.id)) : [];
  const policies = Array.isArray(c.policies) ? c.policies.slice(0, 20) : [];
  return [
    '## 玩家狀況',
    `- 職業：${str(c.jobName, 20)}，月薪 ${num(c.salary, 0, 1e7)} 元，每月生活費 ${num(c.expense, 0, 1e7)} 元`,
    `- 年齡 ${num(c.age, 0, 120)} 歲，健康指數 ${num(c.health, 0, 100)}，現金 ${num(c.cash, -1e10, 1e10)} 元`,
    `- 病史：${Array.isArray(c.medicalHistory) && c.medicalHistory.length ? c.medicalHistory.map((t) => TAG_NAME[t] || '').join('、') : '無'}`,
    `- 目前每月保費合計 ${num(c.monthlyPremium, 0, 1e7)} 元`,
    `- 現有保單：${policies.length ? policies.map((p) => `${str(p.name, 20)}（${str(p.status, 20)}）`).join('、') : '無'}`,
    '## 這位玩家現在投保的報價（每月）',
    ...quotes.map((q) => `- ${str(q.name, 20)}（${q.id}）：${q.ok ? (q.premium ? `${num(q.premium, 0, 1e6)} 元` : '自選金額') : `無法投保（${str(q.reason, 40)}）`}`),
  ].join('\n');
}

function cleanMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_TURNS) throw new HttpError(400, 'invalid_messages');
  const out = messages.map((m) => ({
    role: m?.role === 'assistant' ? 'assistant' : 'user',
    content: str(m?.content, m?.role === 'assistant' ? 2000 : MAX_TEXT).trim() || '…',
  }));
  if (out[0].role !== 'user' || out[out.length - 1].role !== 'user') throw new HttpError(400, 'invalid_messages');
  return out;
}

async function askClaude(context, history, productIds, amountsOf) {
  const messages = [...history];
  const recommendations = [];
  const texts = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const msg = await claude().messages.create(
      {
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: 'low' },
        system: [
          { type: 'text', text: SYSTEM_RULES + catalogText(), cache_control: { type: 'ephemeral' } },
          { type: 'text', text: context },
        ],
        tools: TOOLS,
        messages,
      },
      { timeout: 45_000 },
    );
    // Haiku 沒有伺服器端備援模型：遭拒絕時回一句客氣話，前端仍可用一般投保畫面
    if (msg.stop_reason === 'refusal') {
      return { reply: '這個問題我沒辦法回答，我們聊聊你的保障需求好嗎？', recommendations };
    }
    for (const b of msg.content) if (b.type === 'text' && b.text.trim()) texts.push(b.text.trim());
    if (msg.stop_reason !== 'tool_use') break;

    // 推薦工具：驗證後收集，回傳 tool_result 讓業務員把話說完
    const results = [];
    for (const b of msg.content) {
      if (b.type !== 'tool_use') continue;
      const { productId, amount, reason } = b.input || {};
      let result = '已在畫面上顯示投保按鈕。';
      if (!productIds.includes(productId)) result = '找不到這個險種 id，請只推薦目錄裡的險種。';
      else if (recommendations.length >= 3) result = '這次已經推薦 3 種，不再顯示更多按鈕。';
      else if (!recommendations.some((r) => r.productId === productId)) {
        const amounts = amountsOf[productId];
        recommendations.push({
          productId,
          amount: amounts ? (amounts.includes(amount) ? amount : amounts[0]) : 0,
          reason: str(reason, 60),
        });
      }
      results.push({ type: 'tool_result', tool_use_id: b.id, content: result });
    }
    messages.push({ role: 'assistant', content: msg.content });
    messages.push({ role: 'user', content: results });
  }
  return { reply: texts.join('\n\n') || '你可以再多跟我說說你的需求嗎？', recommendations };
}

export default postHandler(async (req, body) => {
  const { gameId, playerId, context } = body;
  if (!GAME_ID.test(String(gameId)) || !PLAYER_ID.test(String(playerId)) || !context || typeof context !== 'object') {
    throw new HttpError(400, 'invalid_params');
  }
  if (JSON.stringify(body).length > 30_000) throw new HttpError(413, 'too_large');
  const history = cleanMessages(body.messages);

  const game = await db().collection('games').doc(gameId).get();
  if (!game.exists || game.get('playerId') !== playerId) throw new HttpError(404, 'game_not_found');

  // 每日次數限制，避免 API 費用被濫用
  const playerRef = db().collection('players').doc(playerId);
  const today = new Date().toISOString().slice(0, 10);
  await db().runTransaction(async (tx) => {
    const p = await tx.get(playerRef);
    const count = p.get('agentDay') === today ? p.get('agentCount') || 0 : 0;
    if (count >= DAILY_LIMIT) throw new HttpError(429, 'daily_limit');
    tx.set(playerRef, { agentDay: today, agentCount: count + 1 }, { merge: true });
  });

  const products = gameData().insurance.products;
  const productIds = products.map((p) => p.id);
  const amountsOf = Object.fromEntries(products.filter((p) => p.amounts).map((p) => [p.id, p.amounts]));
  try {
    return await askClaude(contextText(context, productIds), history, productIds, amountsOf);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'ai_busy');
    console.error('業務員對話失敗', e);
    throw new HttpError(503, 'ai_unavailable');
  }
});
