// GET /api/leaderboard?playerId=...  -> { top: [...前 20 名], me: { rank, total, best, topPercent } | null }
import { getHandler, PLAYER_ID } from './_lib/http.js';
import { rankOf, topPlayers } from './_lib/rank.js';

const TOP_N = 20;

export default getHandler(async (req) => {
  const playerId = PLAYER_ID.test(String(req.query.playerId || '')) ? String(req.query.playerId) : null;
  const [top, me] = await Promise.all([topPlayers(TOP_N, playerId), playerId ? rankOf(playerId) : null]);
  return { top, me };
});
