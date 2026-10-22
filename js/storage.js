/* 本機儲存工具：localStorage（長期）與 sessionStorage（單次遊戲） */
(function () {
  const PREFIX = 'lf.';

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  // 無法使用瀏覽器儲存時（無痕模式、封鎖），退回記憶體
  function memoryArea() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  }

  function wrap(getArea) {
    const area = safe(() => { const a = getArea(); a.getItem('__test'); return a; }, null) || memoryArea();
    return {
      get(key, fallback = null) {
        return safe(() => {
          const raw = area.getItem(PREFIX + key);
          return raw == null ? fallback : JSON.parse(raw);
        }, fallback);
      },
      set(key, value) { safe(() => area.setItem(PREFIX + key, JSON.stringify(value))); },
      remove(key) { safe(() => area.removeItem(PREFIX + key)); },
    };
  }

  const Store = wrap(() => window.localStorage);
  Store.session = wrap(() => window.sessionStorage);

  const DEFAULT_SETTINGS = { theme: 'system', font: 'normal', reduceMotion: false, highContrast: false, lang: 'zh-Hant' };

  Store.getSettings = () => Object.assign({}, DEFAULT_SETTINGS, Store.get('settings', {}));
  Store.saveSettings = (s) => Store.set('settings', s);

  const HISTORY_MAX = 50;
  Store.getHistory = () => Store.get('history', []);
  Store.addHistory = (entry) => {
    const list = Store.getHistory().filter((h) => h.id !== entry.id);
    list.unshift(entry);
    Store.set('history', list.slice(0, HISTORY_MAX));
  };
  Store.getBestScore = () => Store.getHistory().reduce((best, h) => Math.max(best, h.score || 0), 0);

  // 匿名玩家 id：用來在全服排行榜記錄「自己的最高分」
  Store.getPlayerId = () => {
    let id = Store.get('playerId');
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
      id = crypto.randomUUID ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
      Store.set('playerId', id);
    }
    return id;
  };

  Store.getTips = () => Store.get('tips', []);
  // 回傳本次新解鎖的提示 id
  Store.unlockTips = (ids) => {
    const owned = new Set(Store.getTips());
    const fresh = ids.filter((id) => !owned.has(id));
    fresh.forEach((id) => owned.add(id));
    Store.set('tips', [...owned]);
    return fresh;
  };

  Store.clearAll = () => {
    Store.remove('history');
    Store.remove('tips');
  };

  window.Store = Store;
})();
