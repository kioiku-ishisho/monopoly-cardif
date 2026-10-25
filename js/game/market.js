/* 遊戲主頁：股價變動、經濟劇本、市場跑馬燈、股票視窗與買賣 */
(function (G) {
  if (!G) return;
  const { D, E, $, state, stats, stage, ageInt, monthsPassed, inflate, stockValue, addHistory, logDecision } = G;

  function gaussian() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ===== 經濟劇本：開局排好事件時間表 =====
  const STORY = Object.fromEntries([...D.marketStory.history, ...D.marketStory.future].map((ep) => [ep.id, ep]));

  function buildStory() {
    const S = D.marketStory;
    const between = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));
    const shuffle = (arr) => arr.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const history = [...S.history];
    let future = shuffle([...S.future]);
    const schedule = [];
    for (let m = between(S.firstMonth); m < (E.maxAge - E.startAge) * 12; m += between(S.gapMonths)) {
      let ep;
      if (history.length && (Math.random() >= S.randomRate || !future.length)) ep = history.shift();
      else {
        if (!future.length) future = shuffle([...S.future]);
        ep = future.shift();
      }
      schedule.push({ month: m, id: ep.id });
    }
    return schedule;
  }

  // 本回合到期的經濟事件：回傳事件清單與各股票的衝擊、回升幅度
  function storyMoves(months) {
    const now = monthsPassed();
    const due = state.story.schedule.filter((e) => e.month <= now).map((e) => STORY[e.id]);
    state.story.schedule = state.story.schedule.filter((e) => e.month > now);
    const move = {};
    const add = (id, v) => { move[id] = (move[id] || 0) + v; };
    for (const p of state.story.pending) {
      const n = Math.min(p.left, months);
      Object.entries(p.per).forEach(([id, v]) => add(id, v * n));
      p.left -= n;
    }
    state.story.pending = state.story.pending.filter((p) => p.left > 0);
    for (const ep of due) {
      Object.entries(ep.shock).forEach(([id, v]) => add(id, v));
      if (ep.recovery) {
        const { months: m, ...total } = ep.recovery;
        state.story.pending.push({ left: m, per: Object.fromEntries(Object.entries(total).map(([id, v]) => [id, v / m])) });
      }
      if (ep.price) state.priceShock *= 1 + ep.price;
      if (ep.illness) state.story.illness = { rate: ep.illness.rate, until: now + ep.illness.months };
      state.story.seen.push(ep.id);
    }
    return { due, move };
  }

  // 疫情等事件期間，重大疾病發生率提高
  const illnessRate = () => (state.story.illness && monthsPassed() < state.story.illness.until ? state.story.illness.rate : 1);

  // 股票參數以「一年」為單位，依本回合經過的月數換算；回傳本回合發生的經濟事件
  function marketTick(months) {
    const dt = months / 12;
    const { due, move } = storyMoves(months);
    const news = !due.length && Math.random() < 0.18 * dt ? D.marketNews[Math.floor(Math.random() * D.marketNews.length)] : null;
    let total = 0;
    state.market.forEach((s) => {
      s.prev = s.price;
      const r = s.drift * dt + gaussian() * s.vol * Math.sqrt(dt) + (news ? news.effect * s.beta : 0) + (move[s.id] || 0);
      s.price = Math.max(1, Math.round(s.price * (1 + r) * 100) / 100);
      s.history.push(s.price);
      if (s.history.length > 40) s.history.shift();
      total += s.price / s.prev - 1;
    });
    const avg = total / state.market.length;
    const headline = due.length ? due.map((ep) => `${ep.title}（${ep.source}）`).join('、') : news && news.text;
    const text = headline ? `${headline}，市場平均 ${UI.fmtPct(avg)}` : `市場平均${avg >= 0 ? '上漲' : '下跌'} ${UI.fmtPct(avg)}`;
    addHistory('market', due.length ? due[0].icon : avg >= 0 ? '📈' : '📉', text);
    showTicker(due.length ? due[0].icon : news ? '📰' : avg >= 0 ? '📈' : '📉', text, !!headline, avg);
    if ($('#dlg-stock').open) renderStocks();
    G.renderSide();
    return due;
  }

  // 經濟事件的故事畫面與對玩家的影響
  async function showStory(due) {
    for (const ep of due) {
      const stocks = Object.entries(ep.shock).map(([id, v]) => {
        const s = state.market.find((m) => m.id === id);
        return `<li class="${v >= 0 ? 'up' : 'down'}">${UI.escape(s.name)} ${UI.fmtPct(v)}</li>`;
      }).join('');
      const life = ep.life ? { ...ep.life } : null;
      if (life && life.workOnly && stage().id === 'elder') delete life.cash;
      const effects = life ? { cash: inflate(life.cash || 0), health: life.health || 0, happiness: life.happiness || 0 } : null;
      const lifeItems = effects ? [
        effects.cash && `💰 現金 ${UI.fmtSigned(effects.cash)}`,
        effects.health && `❤️ 健康 ${effects.health > 0 ? '+' : ''}${effects.health}`,
        effects.happiness && `😊 幸福 ${effects.happiness > 0 ? '+' : ''}${effects.happiness}`,
      ].filter(Boolean) : [];
      const extra = [
        ep.price && `🛒 物價一次上漲 ${Math.round(ep.price * 100)}%`,
        ep.illness && `🦠 接下來 ${ep.illness.months} 個月生病的機率提高`,
        ep.recovery && `📈 接下來約 ${Math.round(ep.recovery.months / 12)} 年股價會逐步回升`,
      ].filter(Boolean);
      const held = stockValue();
      await UI.modal({
        title: `${ep.icon} ${ep.title}`,
        body: `
          <div class="event-card" data-kind="market">
            <p class="story-source">📰 ${UI.escape(ep.source)}</p>
            <p class="card-text">${UI.escape(ep.text)}</p>
            <ul class="effect-list story-stocks" aria-label="股市影響">${stocks}</ul>
            ${life ? `<p>${UI.escape(life.text)}</p>` : ''}
            ${lifeItems.length || extra.length ? `<ul class="effect-list" aria-label="對你的影響">${[...lifeItems, ...extra].map((t) => `<li>${UI.escape(t)}</li>`).join('')}</ul>` : ''}
            ${held ? `<p class="card-note">你目前持股市值 ${UI.fmtMoney(held)}。市場大跌時恐慌賣出，常常會把帳面虧損變成真的虧損。</p>` : ''}
          </div>`,
        actions: [{ label: '繼續', value: 'ok', variant: 'primary' }],
        dismissible: false,
      });
      if (effects && (effects.cash || effects.health || effects.happiness)) G.ctx.applyEffects(effects, `${ep.title}：${life.text}`, ep.icon);
      logDecision(`${ageInt()} 歲經歷「${ep.title}」（${ep.source}），當時持股市值 ${UI.fmtMoney(held)}`, 'market-event');
    }
  }

  function showTicker(icon, text, isNews, avg) {
    const el = $('#market-ticker');
    el.dataset.trend = avg >= 0 ? 'up' : 'down';
    el.classList.toggle('news', isNews);
    $('#ticker-icon').textContent = icon;
    $('#ticker-text').textContent = text;
    $('#ticker-meta').textContent = `第 ${state.turn} 回合`;
  }

  // ===== 股票視窗 =====
  function sparkline(hist) {
    const min = Math.min(...hist);
    const max = Math.max(...hist);
    const span = max - min || 1;
    const pts = hist.map((p, i) => `${(i / Math.max(1, hist.length - 1)) * 100},${30 - ((p - min) / span) * 26 - 2}`).join(' ');
    const trend = hist[hist.length - 1] >= hist[0] ? 'up' : 'down';
    return `<svg class="spark ${trend}" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function renderStocks() {
    const value = stockValue();
    const cost = Object.values(state.holdings).reduce((s, h) => s + h.cost, 0);
    $('#stock-body').innerHTML = `
      <div class="stock-summary">
        <span>現金 ${UI.fmtMoney(state.cash)}</span>
        <span>股票市值 ${UI.fmtMoney(value)}</span>
        <span class="${value - cost >= 0 ? 'up' : 'down'}">未實現損益 ${UI.fmtSigned(value - cost)}</span>
      </div>
      <div class="stock-cards">
        ${state.market.map((s) => {
          const h = state.holdings[s.id] || { shares: 0, cost: 0 };
          const chg = s.price / s.prev - 1;
          const inputId = `qty-${s.id}`;
          const mv = h.shares * s.price;
          const pnl = mv - h.cost;
          return `
          <article class="stock-card" aria-labelledby="name-${s.id}">
            <div class="stock-name" id="name-${s.id}">${UI.escape(s.name)}<small>${s.id}</small></div>
            <div class="s-price">${s.price.toFixed(2)}<small class="${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '▲' : '▼'} ${UI.fmtPct(chg)}</small></div>
            ${sparkline(s.history)}
            <div class="s-hold">持有 ${h.shares.toLocaleString('zh-TW')} 股${h.shares ? `・市值 ${UI.fmtMoney(mv)}` : ''}</div>
            ${h.shares ? `<div class="s-pnl">
              <span>買進均價 ${(h.cost / h.shares).toFixed(2)}</span>
              <span class="${pnl >= 0 ? 'up' : 'down'}">損益 ${UI.fmtSigned(pnl)}（${UI.fmtPct(pnl / h.cost)}）</span>
            </div>` : ''}
            <div class="s-trade">
              <label class="sr-only" for="${inputId}">${UI.escape(s.name)} 交易股數</label>
              <input type="number" id="${inputId}" min="1" step="1" value="100" inputmode="numeric">
              <span aria-hidden="true">股</span>
              <button class="btn btn-sm btn-primary" type="button" data-buy="${s.id}" ${state.over ? 'disabled' : ''}>買進</button>
              <button class="btn btn-sm btn-ghost" type="button" data-sell="${s.id}" ${state.over || !h.shares ? 'disabled' : ''}>賣出</button>
            </div>
          </article>`;
        }).join('')}
      </div>
      <p class="e-meta" style="margin-top:12px">股價每回合（擲一次骰子）變動一次。買進後現金必須大於 0。</p>`;
  }

  function buy(id, qty) {
    const s = state.market.find((m) => m.id === id);
    const cost = Math.round(s.price * qty);
    if (state.cash - cost <= 0) { UI.toast('現金不足，買進後現金必須大於 0'); return; }
    const h = state.holdings[id] || (state.holdings[id] = { shares: 0, cost: 0 });
    h.shares += qty;
    h.cost += cost;
    state.cash -= cost;
    stats.trades++;
    stats.boughtIds.add(id);
    addHistory('life', '🛒', `買進 ${s.name} ${qty} 股（${UI.fmtMoney(cost)}）`);
    logDecision(`買進 ${s.name} ${qty} 股，成本 ${UI.fmtMoney(cost)}`, 'invest');
    UI.toast(`已買進 ${s.name} ${qty} 股`);
  }

  // forced：現金不足時被迫賣股（js/game/turn.js 的 checkEnd）
  function sell(id, qty, forced = false) {
    const s = state.market.find((m) => m.id === id);
    const h = state.holdings[id];
    if (!h || !h.shares) return 0;
    qty = Math.min(qty, h.shares);
    const avgCost = h.cost / h.shares;
    const proceeds = Math.round(s.price * qty);
    const pnl = proceeds - avgCost * qty;
    h.shares -= qty;
    h.cost -= avgCost * qty;
    if (!h.shares) delete state.holdings[id];
    state.cash += proceeds;
    stats.trades++;
    stats.realizedPnL += pnl;
    addHistory('life', forced ? '⚠️' : '💵', `${forced ? '被迫' : ''}賣出 ${s.name} ${qty} 股（${UI.fmtMoney(proceeds)}，損益 ${UI.fmtSigned(pnl)}）`);
    logDecision(`${forced ? '因現金不足被迫' : ''}賣出 ${s.name} ${qty} 股，損益 ${UI.fmtSigned(pnl)}`, forced ? 'forced' : 'invest');
    if (!forced) UI.toast(`已賣出 ${s.name} ${qty} 股`);
    return proceeds;
  }

  $('#stock-body').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-buy],[data-sell]');
    if (!btn || state.over) return;
    const id = btn.dataset.buy || btn.dataset.sell;
    const qty = Math.floor(Number($(`#qty-${id}`).value));
    if (!qty || qty < 1) { UI.toast('請輸入正確的股數'); return; }
    if (btn.dataset.buy) buy(id, qty); else sell(id, qty);
    renderStocks();
    G.renderStatus();
    // 重新渲染後把焦點放回同一顆按鈕
    const again = $(`#stock-body [data-${btn.dataset.buy ? 'buy' : 'sell'}="${id}"]`);
    (again && !again.disabled ? again : $(`#qty-${id}`)).focus();
  });

  // 電腦版右側欄的買賣（js/game/panels.js 的 renderSide）
  $('#side-stock').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-buy],[data-sell]');
    if (!btn || state.over) return;
    const id = btn.dataset.buy || btn.dataset.sell;
    const qty = Math.floor(Number($(`#side-qty-${id}`).value));
    if (!qty || qty < 1) { UI.toast('請輸入正確的股數'); return; }
    if (btn.dataset.buy) buy(id, qty); else sell(id, qty);
    G.renderStatus();
    const again = $(`#side-stock [data-${btn.dataset.buy ? 'buy' : 'sell'}="${id}"]`);
    (again && !again.disabled ? again : $(`#side-qty-${id}`)).focus();
  });

  $('#btn-stock').addEventListener('click', () => { renderStocks(); $('#dlg-stock').showModal(); });

  Object.assign(G, { STORY, buildStory, illnessRate, marketTick, showStory, sell });
})(window.Game);
