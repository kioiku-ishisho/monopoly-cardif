// 全服排名：以每位玩家的最高分（players.bestScore）排序，同分同名次
import { db } from './firebase.js';

// 回傳 { rank, total, best, topPercent }；玩家尚無成績時回傳 null
export async function rankOf(playerId) {
  const players = db().collection('players');
  const me = await players.doc(playerId).get();
  const best = me.get('bestScore');
  if (typeof best !== 'number') return null;
  const [above, total] = await Promise.all([
    players.where('bestScore', '>', best).count().get(),
    players.where('bestScore', '>=', 0).count().get(), // 只算有成績的玩家
  ]);
  const rank = above.data().count + 1;
  const totalCount = Math.max(total.data().count, rank);
  return { rank, total: totalCount, best, topPercent: Math.max(0.1, Math.round((rank / totalCount) * 1000) / 10) };
}

// 前 limit 名；不回傳玩家 id，只標示哪一筆是自己
export async function topPlayers(limit, playerId) {
  const snap = await db().collection('players').orderBy('bestScore', 'desc').limit(limit).get();
  const list = [];
  snap.docs.forEach((doc, i) => {
    const score = doc.get('bestScore');
    const prev = list[i - 1];
    list.push({
      rank: prev && prev.score === score ? prev.rank : i + 1,
      score,
      grade: doc.get('bestGrade') || '',
      jobName: doc.get('bestJobName') || '',
      jobIcon: doc.get('bestJobIcon') || '',
      finalAge: doc.get('bestFinalAge') ?? null,
      isMe: doc.id === playerId,
    });
  });
  return list;
}
