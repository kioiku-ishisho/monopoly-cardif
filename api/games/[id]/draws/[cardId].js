// POST /api/games/:id/draws/:cardId  { accepted } -> { ok }  記錄機會牌的選擇
import { findCard } from '../../../_lib/decks.js';
import { db } from '../../../_lib/firebase.js';
import { CARD_ID, GAME_ID, HttpError, postHandler } from '../../../_lib/http.js';

export default postHandler(async (req, body) => {
  const gameId = String(req.query.id || '');
  const cardId = String(req.query.cardId || '');
  if (!GAME_ID.test(gameId) || !CARD_ID.test(cardId) || typeof body.accepted !== 'boolean') {
    throw new HttpError(400, 'invalid_params');
  }
  const card = await findCard(cardId);
  if (!card || card.kind !== 'chance') throw new HttpError(404, 'draw_not_found');

  const ref = db().collection('games').doc(gameId);
  await db().runTransaction(async (tx) => {
    const game = await tx.get(ref);
    if (!game.exists || !(game.get('drawn') || []).includes(cardId)) throw new HttpError(404, 'draw_not_found');
    tx.update(ref, { [`choices.${cardId}`]: body.accepted });
  });
  return { ok: true };
});
