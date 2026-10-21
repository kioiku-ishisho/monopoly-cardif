// POST /api/games  { jobId, playerId } -> { gameId }
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../_lib/firebase.js';
import { HttpError, PLAYER_ID, postHandler } from '../_lib/http.js';

export default postHandler(async (req, body) => {
  const jobId = String(body.jobId || '').slice(0, 40);
  const playerId = String(body.playerId || '');
  if (!jobId || !PLAYER_ID.test(playerId)) throw new HttpError(400, 'invalid_params');

  const gameId = randomUUID().replace(/-/g, '');
  await db().collection('games').doc(gameId).set({
    jobId,
    playerId,
    startedAt: FieldValue.serverTimestamp(),
    drawn: [], // 本局抽過的牌，用來避免重複
    choices: {}, // 機會牌：cardId -> 接受(true)/放棄(false)
  });
  return { gameId };
});
