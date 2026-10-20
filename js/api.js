/* 事件牌 API（server.py + SQLite） */
(function () {
  const BASE = ''; // 與網頁同一個伺服器；若 API 另外架設，改成完整網址

  async function post(path, body) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'HTTP ' + res.status);
      err.code = data.error;
      throw err;
    }
    return data;
  }

  const API = {
    async createGame(jobId) {
      return (await post('/api/games', { jobId })).gameId;
    },
    // 回傳一張本局尚未抽過的牌；該階段的牌抽完時回傳 null
    async draw(gameId, kind, stage) {
      try {
        return (await post(`/api/games/${gameId}/draw`, { kind, stage })).card;
      } catch (e) {
        if (e.code === 'exhausted') return null;
        throw e;
      }
    },
    // 記錄機會牌的選擇；失敗不影響遊戲
    recordChoice(gameId, cardId, accepted) {
      return post(`/api/games/${gameId}/draws/${cardId}`, { accepted }).catch((e) => console.warn('記錄選擇失敗', e));
    },
  };

  window.API = API;
})();
