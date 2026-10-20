/*
 * 格子事件（內容待補）
 *
 * 每個事件 handler 為 async (tile, ctx) => void，ctx 提供：
 *   ctx.state                目前遊戲狀態（唯讀為佳）
 *   ctx.addCash(金額, 原因)   增減現金，會記入歷史事件
 *   ctx.addHealth(數值, 原因) 增減健康指數（0–100）
 *   ctx.choose({ title, message, options: [{ label, value }] }) 讓玩家做決策，回傳選擇的 value
 *   ctx.alert({ title, message })
 *   ctx.logDecision(文字, 分類)  記錄玩家決策，供 AI 結算時參考
 *
 * 範例：
 *   expense: async (tile, ctx) => {
 *     const pick = await ctx.choose({ title: '換新手機', message: '新款手機上市了！', options: [
 *       { label: '買！(-NT$ 35,000)', value: 'buy' }, { label: '舊的還能用', value: 'skip' } ] });
 *     if (pick === 'buy') { ctx.addCash(-35000, '購買新手機'); ctx.logDecision('衝動購買新手機', 'spending'); }
 *   },
 */
(function () {
  const placeholder = async (tile, ctx) => {
    await ctx.alert({
      title: `${tile.icon} ${tile.name}`,
      message: `你來到了「${tile.name}」。此格事件內容尚未設計，敬請期待！`,
    });
  };

  window.TileEvents = {
    start: async () => {}, // 停在起點不觸發事件
    default: placeholder,
  };
})();
