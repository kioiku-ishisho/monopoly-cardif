// POST /api/advisor  { gameId, playerId, context, messages } -> { reply }
// 人生階段結束時的理專問答：Claude 依前端送來的階段結算（js/review.js 的檢核結果）回答玩家的理財問題。
// 前端在失敗時會改用模板的常見問題回答，所以這裡只需要回傳文字。
import Anthropic from '@anthropic-ai/sdk';
import { db } from './_lib/firebase.js';
import { GAME_ID, HttpError, PLAYER_ID, postHandler } from './_lib/http.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const DAILY_LIMIT = Number(process.env.ADVISOR_DAILY_LIMIT || 40); // 每位玩家每天最多幾則理專問答
const MAX_TURNS = 12; // 一次問答最多幾則訊息（玩家 + 理專）
const MAX_TEXT = 300; // 玩家每則訊息字數上限

let anthropic;
const claude = () => (anthropic ||= new Anthropic());

const SYSTEM_PROMPT = `你是「人生富翁」理財教育遊戲裡的理財專員（理專）。玩家剛走完一個人生階段（青年 25–40 歲、中年 40–65 歲），你手上有這個階段的結算與檢討結果，正在和玩家面對面討論。

遊戲規則重點：一步約 3 個月，物價每年上漲、薪資只會小幅調升；中年收入為月薪 1.3 倍，退休後收入降為月薪約 70%（隨物價調整）。
健康 ≤ 30 會進入長照狀態，每月多 3 萬照護費；破產、健康歸零或幸福歸零時遊戲結束。
玩家可以隨時在右上角「保險」頁投保或解約、在「股票」頁買賣（有 ETF、金融股、成長股等）；現金放銀行有少量利息。

說話方式：
- 用繁體中文（台灣用語），親切、口語、簡短，每次回覆 2～5 句，不用 Markdown 標題或表格。
- 依「階段結算」裡的數字回答，引用具體金額或比例；不編造沒有提供的數據。
- 檢核結果是 bad（未達成）、warn（待加強）的項目要優先提醒，給出下一階段做得到的具體行動。
- 你是理財教育角色，不推銷特定商品；投資只談觀念（預備金、分散、定期定額、不恐慌賣出），保險只談需要哪類保障與保費占比（建議月薪 5–15%）。
- 和理財、保險、人生規劃無關的話題，簡短帶回主題。`;

const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
const str = (v, max) => String(v ?? '').slice(0, max);
const money = (v) => `${num(v, -1e11, 1e11).toLocaleString('zh-TW')} 元`;
const LEVEL = { good: '達成', warn: '待加強', bad: '未達成' };

// 前端送來的階段結算：只取需要的欄位並限制長度
function contextText(c) {
  const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  const policies = list(c.policies, 20);
  const holdings = list(c.holdings, 20);
  return [
    `## 階段結算：${str(c.stageName, 10)}（${num(c.startAge, 0, 120)}–${num(c.endAge, 0, 120)} 歲），接下來進入${str(c.nextStageName, 10) || '下一階段'}`,
    `- 職業：${str(c.jobName, 20)}，目前月薪 ${money(c.salary)}，每月生活費 ${money(c.expense)}，每月結餘 ${money(c.net)}`,
    `- 淨資產 ${money(c.startNetWorth)} → ${money(c.netWorth)}；現金 ${money(c.cash)}（約 ${(Number(c.fund) || 0).toFixed(1)} 個月生活費）、投資市值 ${money(c.stock)}、保單價值 ${money(c.policyValue)}`,
    `- 健康 ${num(c.startHealth, 0, 100)} → ${num(c.health, 0, 100)}，幸福 ${num(c.startHappiness, 0, 100)} → ${num(c.happiness, 0, 100)}${c.ltc ? '，已進入長照狀態' : ''}`,
    `- 病史：${list(c.history, 10).map((t) => str(t, 10)).join('、') || '無'}`,
    `- 每月保費 ${money(c.premium)}（占月薪 ${Math.round((Number(c.premiumRatio) || 0) * 100)}%）；有效保單：${policies.length ? policies.map((p) => `${str(p?.name, 20)}（${str(p?.status, 20)}）`).join('、') : '無'}`,
    `- 這個階段股票交易 ${num(c.trades, 0, 1e5)} 筆、被迫賣股 ${num(c.forcedSales, 0, 1e5)} 次；持股：${holdings.length ? holdings.map((h) => `${str(h?.name, 20)} ${money(h?.value)}`).join('、') : '無'}`,
    `- 退休後每月收入估計 ${money(c.pension)}，每月缺口 ${money(c.retireGap)}，退休 20 年缺口合計 ${money(c.retireNeed)}`,
    `## 檢討（等第 ${str(c.grade, 1)}）`,
    ...list(c.checks, 10).map((k) => `- ${str(k?.label, 20)}：${LEVEL[k?.level] || '—'}，${str(k?.text, 120)}`),
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

export default postHandler(async (req, body) => {
  const { gameId, playerId, context } = body;
  if (!GAME_ID.test(String(gameId)) || !PLAYER_ID.test(String(playerId)) || !context || typeof context !== 'object') {
    throw new HttpError(400, 'invalid_params');
  }
  if (JSON.stringify(body).length > 30_000) throw new HttpError(413, 'too_large');
  const messages = cleanMessages(body.messages);

  const game = await db().collection('games').doc(gameId).get();
  if (!game.exists || game.get('playerId') !== playerId) throw new HttpError(404, 'game_not_found');

  // 每日次數限制，避免 API 費用被濫用
  const playerRef = db().collection('players').doc(playerId);
  const today = new Date().toISOString().slice(0, 10);
  await db().runTransaction(async (tx) => {
    const p = await tx.get(playerRef);
    const count = p.get('advisorDay') === today ? p.get('advisorCount') || 0 : 0;
    if (count >= DAILY_LIMIT) throw new HttpError(429, 'daily_limit');
    tx.set(playerRef, { advisorDay: today, advisorCount: count + 1 }, { merge: true });
  });

  try {
    const msg = await claude().messages.create(
      {
        model: MODEL,
        max_tokens: 2000,
        output_config: { effort: 'low' },
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: contextText(context) },
        ],
        messages,
      },
      { timeout: 45_000 },
    );
    if (msg.stop_reason === 'refusal') return { reply: '這個問題我沒辦法回答，我們聊聊你下一階段的理財規劃好嗎？' };
    const reply = msg.content.filter((b) => b.type === 'text').map((b) => b.text.trim()).filter(Boolean).join('\n\n');
    return { reply: reply || '你可以再多說一點想了解的部分嗎？' };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'ai_busy');
    console.error('理專問答失敗', e);
    throw new HttpError(503, 'ai_unavailable');
  }
});
