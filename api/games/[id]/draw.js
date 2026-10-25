// POST /api/games/:id/draw  { kind, stage } -> { card }，該階段抽完時 404 exhausted
// 依玩家職業加權（js/data.js 的 drawWeight）：命運牌看 jobs[].risk，例如外送員較容易抽到意外；
// 職業事件只有該職業抽得到
import { randomInt } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { gameData } from '../../_lib/catalog.js';
import { getDeck } from '../../_lib/decks.js';
import { db } from '../../_lib/firebase.js';
import { GAME_ID, HttpError, KINDS, postHandler, STAGES } from '../../_lib/http.js';

export default postHandler(async (req, body) => {
  const gameId = String(req.query.id || '');
  const { kind, stage } = body;
  if (!GAME_ID.test(gameId) || !KINDS.includes(kind) || !STAGES.includes(stage)) {
    throw new HttpError(400, 'invalid_params');
  }
  const deck = await getDeck(stage, kind);
  const ref = db().collection('games').doc(gameId);

  // 交易：讀取本局已抽過的牌 → 從剩下的牌隨機挑一張 → 記錄下來
  // 同時發出兩次抽牌時，Firestore 會重試交易，保證不會抽到同一張
  const card = await db().runTransaction(async (tx) => {
    const game = await tx.get(ref);
    if (!game.exists) throw new HttpError(404, 'game_not_found');
    if (game.get('evaluation')) throw new HttpError(409, 'game_finished');
    const drawn = new Set(game.get('drawn') || []);
    const picked = weightedPick(deck.filter((c) => !drawn.has(c.id)), game.get('jobId'));
    if (!picked) throw new HttpError(404, 'exhausted');
    tx.update(ref, { drawn: FieldValue.arrayUnion(picked.id) });
    return picked;
  });
  return { card };
});

// 權重全為 0（只剩其他職業的牌）時回傳 null
function weightedPick(pool, jobId) {
  const { jobs, drawWeight } = gameData();
  const job = jobs.find((j) => j.id === jobId);
  const weights = pool.map((c) => drawWeight(job, c));
  const total = weights.reduce((s, w) => s + w, 0);
  if (!total) return null;
  let r = (randomInt(1_000_000) / 1_000_000) * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}
