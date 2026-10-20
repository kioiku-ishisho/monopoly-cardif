/* 遊戲主頁：地圖、骰子、移動、股票、個人資料、結束判定 */
(function () {
  const D = GameData;
  const E = D.economy;
  const $ = (s) => document.querySelector(s);

  const setup = Store.session.get('newGame');
  if (!setup) { location.replace('index.html'); return; }
  const job = D.jobs.find((j) => j.id === setup.jobId) || D.jobs[0];

  UI.fillIcons();
  UI.bindDialogs();

  // ===== 狀態 =====
  const state = {
    cash: job.salary * E.startCashMonths,
    health: 100,
    steps: 0, // 總步數，一步 = 3 個月
    position: 0,
    lap: 0, // 已完成圈數
    stageIndex: 0,
    turn: 0,
    holdings: {}, // { 股票id: { shares, cost } }
    market: D.stocks.map((s) => ({ ...s, prev: s.price, history: [s.price] })),
    history: [],
    log: [],
    busy: false,
    paused: false,
    over: false,
  };
  const stats = {
    peakNetWorth: state.cash,
    minHealth: 100,
    healthSum: 0,
    healthSamples: 0,
    trades: 0,
    boughtIds: new Set(),
    realizedPnL: 0,
    forcedSales: 0,
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const stage = () => D.stages[state.stageIndex];
  const age = () => E.startAge + (state.steps * E.monthsPerStep) / 12;
  const ageInt = () => Math.floor(age());
  const monthlyIncome = () => Math.round(job.salary * E.incomeRate[stage().id]);
  const stockValue = () => state.market.reduce((sum, s) => sum + (state.holdings[s.id]?.shares || 0) * s.price, 0);
  const netWorth = () => state.cash + stockValue();

  function stageIndexForLap(lap) {
    let acc = 0;
    for (let i = 0; i < D.stages.length; i++) {
      acc += D.stages[i].laps;
      if (lap < acc) return i;
    }
    return D.stages.length - 1;
  }

  function addHistory(kind, icon, text) {
    state.history.push({ kind, icon, text, age: ageInt(), turn: state.turn });
    if ($('#dlg-history').open) renderHistory();
  }

  function logDecision(text, category = 'other') {
    state.log.push({ turn: state.turn, age: ageInt(), stage: stage().id, text, category });
  }

  function announce(msg) {
    $('#dice-result').textContent = msg;
  }

  // ===== 地圖 =====
  const TILE_PX = 120;
  const tilesEl = $('#tiles');
  const token = $('#token');

  // 0 號格在右下角，逆時針前進
  function tileCell(i) {
    if (i === 0) return { r: 5, c: 5 };
    if (i < 5) return { r: 5, c: 5 - i };
    if (i === 5) return { r: 5, c: 0 };
    if (i < 10) return { r: 5 - (i - 5), c: 0 };
    if (i === 10) return { r: 0, c: 0 };
    if (i < 15) return { r: 0, c: i - 10 };
    if (i === 15) return { r: 0, c: 5 };
    return { r: i - 15, c: 5 };
  }

  function boardTiles() {
    return D.boards[stage().id].map((type, i) => ({ index: i, type, ...D.tileTypes[type] }));
  }
  const currentTile = () => boardTiles()[state.position];

  function buildBoard() {
    document.body.dataset.stage = stage().id;
    tilesEl.innerHTML = boardTiles().map((t) => {
      const { r, c } = tileCell(t.index);
      const corner = t.index % 5 === 0;
      return `<li class="tile${corner ? ' corner' : ''}" data-type="${t.type}" data-index="${t.index}"
                style="grid-row:${r + 1};grid-column:${c + 1}">
        <span class="tile-no" aria-hidden="true">${t.index + 1}</span>
        <span class="tile-icon" aria-hidden="true">${t.icon}</span>
        <span class="tile-name">${UI.escape(t.name)}</span>
      </li>`;
    }).join('');
    token.textContent = job.icon;
    token.style.setProperty('--job-color', job.color);
    placeToken(false);
    renderStatus();
  }

  function tokenCenter() {
    const { r, c } = tileCell(state.position);
    return { x: (c + 0.5) * TILE_PX, y: (r + 0.5) * TILE_PX };
  }

  function placeToken(hop) {
    const { x, y } = tokenCenter();
    token.style.left = x + 'px';
    token.style.top = y + 'px';
    tilesEl.querySelectorAll('.tile.current').forEach((t) => t.classList.remove('current'));
    const cur = tilesEl.querySelector(`[data-index="${state.position}"]`);
    if (cur) {
      cur.classList.add('current');
      cur.setAttribute('aria-current', 'location');
    }
    tilesEl.querySelectorAll('[aria-current]').forEach((t) => { if (t !== cur) t.removeAttribute('aria-current'); });
    if (hop && !UI.reducedMotion()) {
      token.classList.remove('hop');
      void token.offsetWidth;
      token.classList.add('hop');
    }
  }

  // ===== 地圖拖曳 / 縮放 =====
  const vp = $('#board-viewport');
  const board = $('#board');
  const BOARD_PX = TILE_PX * 6;
  const MIN_S = 0.3;
  const MAX_S = 2.5;
  const view = { x: 0, y: 0, s: 1 };
  let userMoved = false;

  function applyView(animate) {
    board.classList.toggle('animate', !!animate && !UI.reducedMotion());
    board.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
  }

  function fitBoard(animate) {
    const r = vp.getBoundingClientRect();
    // 預留骰子按鈕的空間
    const usableH = Math.max(200, r.height - 150);
    view.s = clamp(Math.min(r.width / BOARD_PX, usableH / BOARD_PX) * 0.94, MIN_S, MAX_S);
    view.x = (r.width - BOARD_PX * view.s) / 2;
    view.y = Math.max(8, (usableH - BOARD_PX * view.s) / 2);
    applyView(animate);
  }

  function zoomAt(factor, cx, cy) {
    const ns = clamp(view.s * factor, MIN_S, MAX_S);
    const k = ns / view.s;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.s = ns;
    userMoved = true;
    applyView(false);
  }

  function zoomCenter(factor) {
    const r = vp.getBoundingClientRect();
    zoomAt(factor, r.width / 2, r.height / 2);
  }

  function centerOnToken(animate) {
    const r = vp.getBoundingClientRect();
    const { x, y } = tokenCenter();
    view.x = r.width / 2 - x * view.s;
    view.y = (r.height - 150) / 2 - y * view.s;
    applyView(animate);
  }

  function ensureTokenVisible() {
    const r = vp.getBoundingClientRect();
    const { x, y } = tokenCenter();
    const sx = view.x + x * view.s;
    const sy = view.y + y * view.s;
    const pad = 40;
    if (sx < pad || sx > r.width - pad || sy < pad || sy > r.height - 150) centerOnToken(true);
  }

  const pointers = new Map();
  let pinch = null;

  vp.addEventListener('pointerdown', (e) => {
    vp.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    vp.classList.add('dragging');
    if (pointers.size === 2) pinch = pinchInfo();
  });

  vp.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      view.x += cur.x - prev.x;
      view.y += cur.y - prev.y;
      userMoved = true;
      pointers.set(e.pointerId, cur);
      applyView(false);
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, cur);
      const next = pinchInfo();
      const r = vp.getBoundingClientRect();
      view.x += next.mx - pinch.mx;
      view.y += next.my - pinch.my;
      zoomAt(next.dist / pinch.dist, next.mx - r.left, next.my - r.top);
      pinch = next;
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) vp.classList.remove('dragging');
  }
  vp.addEventListener('pointerup', endPointer);
  vp.addEventListener('pointercancel', endPointer);

  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  vp.addEventListener('keydown', (e) => {
    const step = 48;
    const keys = {
      ArrowLeft: () => { view.x += step; },
      ArrowRight: () => { view.x -= step; },
      ArrowUp: () => { view.y += step; },
      ArrowDown: () => { view.y -= step; },
    };
    if (keys[e.key]) { keys[e.key](); userMoved = true; applyView(false); e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') { zoomCenter(1.2); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { zoomCenter(1 / 1.2); e.preventDefault(); }
    else if (e.key === '0') { userMoved = false; fitBoard(true); e.preventDefault(); }
  });

  $('#btn-zoom-in').addEventListener('click', () => zoomCenter(1.25));
  $('#btn-zoom-out').addEventListener('click', () => zoomCenter(1 / 1.25));
  $('#btn-zoom-me').addEventListener('click', () => { userMoved = true; centerOnToken(true); });
  window.addEventListener('resize', () => { if (!userMoved) fitBoard(false); });

  // ===== 狀態顯示 =====
  function renderStatus() {
    $('#stage-chip').textContent = `${stage().name}・${ageInt()} 歲`;
    $('#sum-cash').textContent = UI.fmtMoney(state.cash);
    $('#sum-cash').classList.toggle('neg', state.cash <= 0);
    $('#sum-health').textContent = `${state.health} / 100`;
    const meter = $('#sum-health-meter');
    meter.querySelector('span').style.width = state.health + '%';
    meter.classList.toggle('warn', state.health <= 50 && state.health > 25);
    meter.classList.toggle('danger', state.health <= 25);
    $('#board-center').innerHTML = `
      <div class="center-stage">${stage().name}</div>
      <div class="center-age">${ageInt()} 歲</div>
      <div class="center-lap">第 ${state.lap + 1} 圈・每圈 ${E.yearsPerLap} 年</div>`;
    if ($('#sheet').classList.contains('open')) renderSheet();
  }

  // ===== 底部個人資料面板 =====
  const sheet = $('#sheet');
  const scrim = $('#sheet-scrim');
  const btnSheet = $('#btn-sheet');

  function setSheet(open) {
    sheet.classList.toggle('open', open);
    sheet.inert = !open;
    scrim.hidden = !open;
    btnSheet.setAttribute('aria-expanded', String(open));
    if (open) { renderSheet(); $('#btn-sheet-close').focus(); } else { btnSheet.focus(); }
  }
  btnSheet.addEventListener('click', () => setSheet(!sheet.classList.contains('open')));
  $('#btn-sheet-close').addEventListener('click', () => setSheet(false));
  scrim.addEventListener('click', () => setSheet(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet.classList.contains('open') && !document.querySelector('dialog[open]')) setSheet(false);
  });

  function renderSheet() {
    const income = monthlyIncome();
    const net = income - job.expense;
    const rows = state.market.filter((s) => state.holdings[s.id]?.shares);
    $('#sheet-body').innerHTML = `
      <dl class="info-grid">
        <div><dt>職業</dt><dd>${job.icon} ${UI.escape(job.name)}</dd></div>
        <div><dt>年齡</dt><dd>${ageInt()} 歲</dd></div>
        <div><dt>人生階段</dt><dd>${stage().name}</dd></div>
        <div><dt>${stage().id === 'elder' ? '每月退休金' : '每月收入'}</dt><dd>${UI.fmtMoney(income)}</dd></div>
        <div><dt>每月生活費</dt><dd>${UI.fmtMoney(job.expense)}</dd></div>
        <div><dt>每月結餘</dt><dd class="${net >= 0 ? 'pos' : 'neg'}">${UI.fmtSigned(net)}</dd></div>
        <div><dt>現金</dt><dd>${UI.fmtMoney(state.cash)}</dd></div>
        <div><dt>股票市值</dt><dd>${UI.fmtMoney(stockValue())}</dd></div>
        <div><dt>淨資產</dt><dd>${UI.fmtMoney(netWorth())}</dd></div>
        <div><dt>健康指數</dt><dd>${state.health} / 100</dd></div>
        <div><dt>已完成圈數</dt><dd>${state.lap} 圈</dd></div>
        <div><dt>回合數</dt><dd>${state.turn}</dd></div>
      </dl>
      <h3>持股明細</h3>
      ${rows.length ? `
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th scope="col">股票</th><th scope="col">股數</th><th scope="col">現價</th><th scope="col">市值</th><th scope="col">損益</th></tr></thead>
          <tbody>${rows.map((s) => {
            const h = state.holdings[s.id];
            const value = h.shares * s.price;
            const pnl = value - h.cost;
            return `<tr><td>${UI.escape(s.name)}</td><td>${h.shares.toLocaleString('zh-TW')}</td><td>${s.price.toFixed(2)}</td><td>${UI.fmtMoney(value)}</td><td class="${pnl >= 0 ? 'pos' : 'neg'}">${UI.fmtSigned(pnl)}</td></tr>`;
          }).join('')}</tbody>
        </table></div>` : '<p class="empty">目前沒有持股，可以從右上角「股票」開始投資。</p>'}`;
  }

  // ===== 股票 =====
  function gaussian() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function marketTick() {
    const news = Math.random() < 0.18 ? D.marketNews[Math.floor(Math.random() * D.marketNews.length)] : null;
    let total = 0;
    state.market.forEach((s) => {
      s.prev = s.price;
      const r = s.drift + gaussian() * s.vol + (news ? news.effect * s.beta : 0);
      s.price = Math.max(1, Math.round(s.price * (1 + r) * 100) / 100);
      s.history.push(s.price);
      if (s.history.length > 40) s.history.shift();
      total += s.price / s.prev - 1;
    });
    const avg = total / state.market.length;
    const text = news ? `${news.text}，市場平均 ${UI.fmtPct(avg)}` : `市場平均${avg >= 0 ? '上漲' : '下跌'} ${UI.fmtPct(avg)}`;
    addHistory('market', avg >= 0 ? '📈' : '📉', text);
    if (news) UI.toast('📰 ' + news.text);
    if ($('#dlg-stock').open) renderStocks();
  }

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
        <span class="${value - cost >= 0 ? 'pos' : 'neg'}">未實現損益 ${UI.fmtSigned(value - cost)}</span>
      </div>
      <div class="stock-cards">
        ${state.market.map((s) => {
          const h = state.holdings[s.id] || { shares: 0, cost: 0 };
          const chg = s.price / s.prev - 1;
          const inputId = `qty-${s.id}`;
          return `
          <article class="stock-card" aria-labelledby="name-${s.id}">
            <div class="stock-name" id="name-${s.id}">${UI.escape(s.name)}<small>${s.id}</small></div>
            <div class="s-price">${s.price.toFixed(2)}<small class="${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? '▲' : '▼'} ${UI.fmtPct(chg)}</small></div>
            ${sparkline(s.history)}
            <div class="s-hold">持有 ${h.shares.toLocaleString('zh-TW')} 股${h.shares ? `・市值 ${UI.fmtMoney(h.shares * s.price)}` : ''}</div>
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
    renderStatus();
    // 重新渲染後把焦點放回同一顆按鈕
    const again = $(`[data-${btn.dataset.buy ? 'buy' : 'sell'}="${id}"]`);
    (again && !again.disabled ? again : $(`#qty-${id}`)).focus();
  });

  $('#btn-stock').addEventListener('click', () => { renderStocks(); $('#dlg-stock').showModal(); });

  // ===== 歷史事件 =====
  let historyFilter = 'all';
  function renderHistory() {
    const list = state.history.filter((h) => historyFilter === 'all' || h.kind === historyFilter).slice().reverse();
    $('#event-list').innerHTML = list.length
      ? list.map((h) => `
        <li class="event-item" data-kind="${h.kind}">
          <span class="e-icon" aria-hidden="true">${h.icon}</span>
          <span>${UI.escape(h.text)}</span>
          <span class="e-meta">第 ${h.turn} 回合・${h.age} 歲</span>
        </li>`).join('')
      : '<li class="empty">目前沒有事件</li>';
  }
  document.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      historyFilter = btn.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      renderHistory();
    });
  });
  $('#btn-history').addEventListener('click', () => { renderHistory(); $('#dlg-history').showModal(); });

  // ===== 事件 context（給 js/events.js 使用） =====
  const ctx = {
    state,
    addCash(n, reason) {
      state.cash = Math.round(state.cash + n);
      addHistory('life', n >= 0 ? '💰' : '💸', `${reason}（${UI.fmtSigned(n)}）`);
      renderStatus();
    },
    addHealth(n, reason) {
      state.health = clamp(Math.round(state.health + n), 0, 100);
      addHistory('life', n >= 0 ? '💚' : '🤒', `${reason}（健康 ${n >= 0 ? '+' : ''}${n}）`);
      renderStatus();
    },
    choose: ({ title, message = '', html, options }) => UI.modal({
      title,
      body: html || `<p>${UI.escape(message)}</p>`,
      actions: options.map((o, i) => ({ label: o.label, value: o.value, variant: i === 0 ? 'primary' : 'ghost' })).reverse(),
      dismissible: false,
    }),
    alert: (opts) => UI.alert(opts),
    logDecision,
  };

  // ===== 回合流程 =====
  const diceBtn = $('#btn-dice');
  const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  function setDiceEnabled(on) { diceBtn.disabled = !on; }

  async function waitIfPaused() {
    while (state.paused) await UI.wait(120);
  }

  async function rollDice() {
    const n = 1 + Math.floor(Math.random() * 6);
    const face = $('#dice-face');
    if (!UI.reducedMotion()) {
      diceBtn.classList.add('rolling');
      for (let i = 0; i < 8; i++) {
        face.textContent = FACES[Math.floor(Math.random() * 6)];
        await UI.wait(70);
      }
      diceBtn.classList.remove('rolling');
    }
    face.textContent = FACES[n - 1];
    return n;
  }

  async function passStart() {
    state.lap++;
    const decay = E.healthDecayPerLap[stage().id];
    if (decay) {
      state.health = clamp(state.health - decay, 0, 100);
      addHistory('life', '⏳', `歲月流逝，健康 -${decay}`);
    }
    addHistory('life', '🏁', `完成第 ${state.lap} 圈，${ageInt()} 歲`);
    const idx = stageIndexForLap(state.lap);
    if (idx !== state.stageIndex) {
      state.stageIndex = idx;
      buildBoard();
      const msg = {
        middle: '人生進入中年（40–65 歲）。收入提升為月薪的 1.3 倍，但家庭與健康的挑戰也變多了。',
        elder: `你退休了！之後收入改為退休金（約月薪的 ${Math.round(E.incomeRate.elder * 100)}%），健康也會加速下降。`,
      }[stage().id];
      addHistory('life', '🎂', `進入${stage().name}階段`);
      logDecision(`${ageInt()} 歲進入${stage().name}，淨資產 ${UI.fmtMoney(netWorth())}`, 'milestone');
      await UI.alert({ title: `進入${stage().name}圈`, message: msg, okText: '繼續' });
    }
  }

  async function turn() {
    if (state.busy || state.over || state.paused) return;
    state.busy = true;
    setDiceEnabled(false);
    const n = await rollDice();
    state.turn++;
    announce(`擲出 ${n} 點`);
    const before = state.cash;
    const stepDelay = UI.reducedMotion() ? 60 : 220;

    for (let i = 0; i < n; i++) {
      await waitIfPaused();
      state.position = (state.position + 1) % E.tilesPerLap;
      state.steps++;
      state.cash += (monthlyIncome() - job.expense) * E.monthsPerStep;
      if (state.position === 0) await passStart();
      placeToken(true);
      renderStatus();
      await UI.wait(stepDelay);
    }
    ensureTokenVisible();

    const tile = currentTile();
    announce(`擲出 ${n} 點，來到「${tile.name}」・薪資收支 ${UI.fmtSigned(state.cash - before)}`);
    marketTick();
    await waitIfPaused();
    await (TileEvents[tile.type] || TileEvents.default)(tile, ctx);

    stats.peakNetWorth = Math.max(stats.peakNetWorth, netWorth());
    stats.minHealth = Math.min(stats.minHealth, state.health);
    stats.healthSum += state.health;
    stats.healthSamples++;
    renderStatus();

    if (await checkEnd()) return;
    state.busy = false;
    setDiceEnabled(true);
  }

  async function checkEnd() {
    // 現金不足時先強制賣股
    if (state.cash <= 0 && stockValue() > 0) {
      for (const s of state.market) {
        if (state.cash > 0) break;
        const h = state.holdings[s.id];
        if (h) sell(s.id, h.shares, true);
      }
      stats.forcedSales++;
      renderStatus();
      await UI.alert({ title: '被迫賣股', message: '現金不足以支付生活開銷，你的持股被迫賣出換現。', okText: '我知道了' });
    }
    let reason = null;
    if (state.cash <= 0) reason = 'bankrupt';
    else if (state.health <= 0) reason = 'death';
    else if (age() >= E.maxAge) reason = 'maxAge';
    if (!reason) return false;
    await endGame(reason);
    return true;
  }

  const END_TEXT = {
    bankrupt: { title: '破產了…', icon: '💸', msg: (a) => `你在 ${a} 歲時現金歸零，宣告破產。` },
    death: { title: '健康指數歸零', icon: '🕯️', msg: (a) => `你在 ${a} 歲時健康耗盡，人生畫下句點。` },
    maxAge: { title: '壽終正寢', icon: '🎉', msg: (a) => `你平安活到 ${a} 歲，走完了精彩的一生！` },
  };

  async function endGame(reason) {
    state.over = true;
    setDiceEnabled(false);
    const t = END_TEXT[reason];
    const record = {
      id: 'g' + Date.now().toString(36),
      jobId: job.id,
      jobName: job.name,
      jobIcon: job.icon,
      salary: job.salary,
      expense: job.expense,
      endReason: reason,
      endReasonText: t.msg(ageInt()),
      finalAge: ageInt(),
      finalStage: stage().id,
      finalCash: Math.round(state.cash),
      finalHealth: state.health,
      stockValue: Math.round(stockValue()),
      netWorth: Math.round(netWorth()),
      peakNetWorth: Math.round(stats.peakNetWorth),
      minHealth: stats.minHealth,
      avgHealth: stats.healthSamples ? Math.round(stats.healthSum / stats.healthSamples) : state.health,
      laps: state.lap,
      turns: state.turn,
      trades: stats.trades,
      distinctStocks: stats.boughtIds.size,
      realizedPnL: Math.round(stats.realizedPnL),
      forcedSales: stats.forcedSales,
      holdings: state.market.filter((s) => state.holdings[s.id]).map((s) => ({ id: s.id, name: s.name, shares: state.holdings[s.id].shares, value: Math.round(state.holdings[s.id].shares * s.price) })),
      log: state.log.slice(-100),
      history: state.history.slice(-60),
      startedAt: setup.startedAt,
      endedAt: Date.now(),
    };
    Store.session.set('lastResult', record);
    Store.session.remove('newGame');
    await UI.modal({
      title: t.title,
      body: `<p class="pause-body" aria-hidden="true">${t.icon}</p><p>${UI.escape(record.endReasonText)}</p><p>接下來 AI 會為你的人生進行評分、總結與建議。</p>`,
      actions: [{ label: '查看人生結算', value: 'ok', variant: 'primary' }],
      dismissible: false,
    });
    location.href = 'result.html';
  }

  diceBtn.addEventListener('click', turn);

  // ===== 暫停 / 離開 =====
  $('#btn-pause').addEventListener('click', async () => {
    if (state.over) return;
    state.paused = true;
    await UI.modal({
      title: '遊戲暫停',
      body: '<p class="pause-body" aria-hidden="true">⏸️</p><p style="text-align:center">休息一下，準備好再繼續。</p>',
      actions: [{ label: '繼續遊戲', value: 'ok', variant: 'primary' }],
    });
    state.paused = false;
  });

  $('#btn-quit').addEventListener('click', async () => {
    const wasPaused = state.paused;
    state.paused = true;
    const ok = await UI.confirm({
      title: '離開遊戲',
      message: '確定要離開嗎？本局進度與紀錄都不會被保存。',
      okText: '離開',
      cancelText: '繼續玩',
      danger: true,
    });
    if (ok) {
      state.over = true;
      Store.session.remove('newGame');
      location.href = 'index.html';
      return;
    }
    state.paused = wasPaused;
  });

  // ===== 開始 =====
  addHistory('life', '🎬', `以「${job.name}」身分開始人生，起始現金 ${UI.fmtMoney(state.cash)}`);
  logDecision(`以${job.name}開始，月薪 ${UI.fmtMoney(job.salary)}`, 'milestone');
  buildBoard();
  requestAnimationFrame(() => fitBoard(false));
  announce('');
})();
