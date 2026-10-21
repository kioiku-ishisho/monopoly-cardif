// 事件牌：Firestore 的 cardDecks/{stage}-{kind}，每份文件存一整副牌（約 150 張）
// 牌組內容不常變動，在同一個 function 執行個體內快取，避免每次抽牌都重複讀取
import { db } from './firebase.js';

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

export async function getDeck(stage, kind) {
  const key = `${stage}-${kind}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.cards;
  const snap = await db().collection('cardDecks').doc(key).get();
  if (!snap.exists) throw new Error(`找不到牌組 ${key}，請先執行 npm run import-cards`);
  const cards = snap.get('cards');
  cache.set(key, { cards, at: Date.now() });
  return cards;
}

const STAGE_OF = { Y: 'youth', M: 'middle', O: 'elder' };

// 由牌的編號找回牌的內容
export async function findCard(cardId) {
  const stage = STAGE_OF[cardId[0]];
  for (const kind of ['chance', 'fate']) {
    const card = (await getDeck(stage, kind)).find((c) => c.id === cardId);
    if (card) return card;
  }
  return null;
}
