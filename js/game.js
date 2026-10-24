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
    happiness: E.startHappiness,
    steps: 0, // 總步數，一步 = 3 個月
    position: 0,
    lap: 0, // 已完成圈數
    stageIndex: 0,
    turn: 0,
    netIncomeAdj: 0, // 事件牌造成的每月淨收入增減（持續）
    policies: [], // 保單（js/insurance.js）
    medicalHistory: [], // 病史：cancer / heart / stroke / esrd，相關險種會拒保
    ltc: null, // 進入長照狀態時的 { since, age }
    premiumArrears: 0, // 保費欠繳月數（寬限期）
    incomeStopUntil: 0, // 生病停薪到第幾步（退休金不受影響）
    lastTag: null, // 本回合最後一個事件的疾病標籤 { tag, turn }，判斷意外身故
    skipTurns: 0, // 住院：剩下幾回合暫停移動
    policyPerks: { discount: null, surcharge: 0 }, // 特殊格給的下次投保優惠 { rate, cap } 與加價
    quizUsed: [], // 本局答過的題目 id
    salaryIndex: 1, // 薪資指數：每圈調升 economy.salaryGrowthPerLap
    priceShock: 1, // 經濟事件造成的物價一次跳升（乘在通膨指數上）
    story: { schedule: [], pending: [], illness: null, seen: [] }, // 經濟劇本（js/data.js 的 marketStory）
    gameId: null, // 伺服器端的遊戲 id，用來抽牌
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
    minHappiness: E.startHappiness,
    happinessSum: 0,
    trades: 0,
    boughtIds: new Set(),
    realizedPnL: 0,
    forcedSales: 0,
    chanceAccepted: 0,
    chanceDeclined: 0,
    fateCount: 0,
    claims: 0,
    claimTotal: 0,
    premiumsPaid: 0,
    firstInsuredAge: null,
    maxPremiumRatio: 0,
    majorIllness: 0,
    interestTotal: 0,
    medicalCost: 0, // 醫療支出合計（計分：理賠覆蓋比例）
    lapses: 0, // 保單因繳不出保費而停效的次數（js/insurance.js 累加）
    lapSamples: 0, // 過起點的次數
    emergencyLaps: 0, // 過起點時現金 ≥ 3 個月生活費的次數
    premiumRatioSum: 0, // 工作期間每圈的保費占月薪比例
    premiumSamples: 0,
    quizAsked: 0,
    quizCorrect: 0,
    hospitalDays: 0,
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const stage = () => D.stages[state.stageIndex];
  const age = () => E.startAge + (state.steps * E.monthsPerStep) / 12;
  const ageInt = () => Math.floor(age());
  const incomeStopped = () => stage().id !== 'elder' && state.steps < state.incomeStopUntil;
  const monthsPassed = () => state.steps * E.monthsPerStep;
  // 物價指數：每年通膨 economy.inflation，再乘上經濟事件造成的跳升
  const priceIndex = () => Math.pow(1 + E.inflation, monthsPassed() / 12) * state.priceShock;
  const salaryNow = () => Math.round(job.salary * state.salaryIndex);
  const expenseNow = () => Math.round(job.expense * priceIndex());
  const inflate = (n) => (n ? Math.round((n * priceIndex()) / 100) * 100 : 0);
  // 退休金依退休後的物價調整（economy.pensionIndexed）
  const pensionIndex = () => (stage().id === 'elder' && E.pensionIndexed && state.retirePrice ? priceIndex() / state.retirePrice : 1);
  const monthlyIncome = () => (incomeStopped() ? 0 : Math.round(salaryNow() * E.incomeRate[stage().id] * pensionIndex()));
  // 不含保險的每月收支；保費與保險給付由 Ins.monthly() 另外處理
  const monthlyCashflow = () => monthlyIncome() - expenseNow() - Ins.careCost() + state.netIncomeAdj;
  const monthlyNet = () => monthlyCashflow() - Ins.monthlyPremium() + Ins.monthlyBenefit();
  const stockValue = () => state.market.reduce((sum, s) => sum + (state.holdings[s.id]?.shares || 0) * s.price, 0);
  const netWorth = () => state.cash + stockValue() + Ins.value();

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

  const Ins = Insurance.create({
    state,
    job,
    stats,
    age,
    etfPrice: () => state.market.find((s) => s.id === 'ETF50').price,
    addHistory,
    logDecision,
    toast: UI.toast,
  });

  function announce(msg) {
    $('#dice-result').textContent = msg;
  }

  // ===== 地圖：三個人生階段共用一圈 =====
  const WORLD = GameWorld.build(E.tilesPerLap);
  const loopsEl = $('#loops');
  const roadsEl = $('#roads');
  const token = $('#token');

  const TILES = D.board.map((type, i) => ({ index: i, type, ...D.tileTypes[type] }));
  const currentTile = () => TILES[state.position];

  // 只建立一次：道路（SVG）與格子
  function buildWorld() {
    const boardEl = $('#board');
    boardEl.style.width = WORLD.width + 'px';
    boardEl.style.height = WORLD.height + 'px';
    roadsEl.setAttribute('viewBox', `0 0 ${WORLD.width} ${WORLD.height}`);
    roadsEl.setAttribute('width', WORLD.width);
    roadsEl.setAttribute('height', WORLD.height);
    roadsEl.innerHTML = `
      <g class="road">
        <path class="road-edge" d="${WORLD.path}"/>
        <path class="road-bed" d="${WORLD.path}"/>
        <path class="road-line" d="${WORLD.path}"/>
      </g>`;

    const counts = D.boardCounts;
    const legend = [['chance', counts.chance], ['fate', counts.fate], ['insurance', counts.insurance], ['hospital', counts.hospital]]
      .map(([t, n]) => `<span>${D.tileTypes[t].icon} ${n}</span>`).join('') + `<span>⭐ ${counts.special}</span>`;
    loopsEl.innerHTML = `
      <section class="loop" aria-label="人生圈">
        <div class="loop-label" style="left:${WORLD.center.x}px;top:${WORLD.center.y}px" aria-hidden="true">
          <div class="loop-name" id="loop-name"></div>
          <div class="loop-ages" id="loop-ages"></div>
          <div class="loop-status" id="loop-status"></div>
          <div class="loop-legend">${legend}</div>
        </div>
        <ol class="tiles" aria-label="人生圈的格子">
          ${TILES.map((t) => {
            const p = WORLD.points[t.index];
            const rot = ((t.index * 37) % 13) - 6; // 固定的小角度傾斜（-6°～6°）
            return `<li class="tile${t.index === 0 ? ' start' : ''}" data-type="${t.type}"${t.group ? ` data-group="${t.group}"` : ''} data-index="${t.index}"
                      style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px;--rot:${rot}deg">
              <span class="tile-no" aria-hidden="true">${t.index + 1}</span>
              <span class="tile-icon" aria-hidden="true">${t.icon}</span>
              <span class="tile-name">${UI.escape(t.name)}</span>
            </li>`;
          }).join('')}
        </ol>
      </section>`;
    token.textContent = job.icon;
    token.style.setProperty('--job-color', job.color);
  }

  // 圈的顏色與中央標籤跟著目前的人生階段
  function buildBoard() {
    if (!loopsEl.children.length) buildWorld();
    document.body.dataset.stage = stage().id;
    const s = stage();
    $('#loop-name').textContent = s.name;
    $('#loop-ages').textContent = `${s.ageFrom}${s.ageTo ? `–${s.ageTo} 歲` : ' 歲以上'}`;
    placeToken(false);
    renderStatus();
  }

  function tokenCenter() {
    return WORLD.points[state.position];
  }

  function placeToken(hop) {
    const { x, y } = tokenCenter();
    token.style.left = x + 'px';
    token.style.top = y + 'px';
    loopsEl.querySelectorAll('.tile.current').forEach((t) => {
      t.classList.remove('current');
      t.removeAttribute('aria-current');
    });
    const cur = loopsEl.querySelector(`[data-index="${state.position}"]`);
    if (cur) {
      cur.classList.add('current');
      cur.setAttribute('aria-current', 'location');
    }
    if (hop && !UI.reducedMotion()) {
      token.classList.remove('hop');
      void token.offsetWidth;
      token.classList.add('hop');
    }
  }

  // ===== 地圖拖曳 / 縮放 =====
  const vp = $('#board-viewport');
  const board = $('#board');
  const MIN_S = 0.05;
  const MAX_S = 2;
  const READABLE_S = 0.6; // 小螢幕整圈放不下時，改用此倍率並跟著棋子
  const DICE_SPACE = 150; // 底部預留給骰子
  const view = { x: 0, y: 0, s: 1 };
  let userMoved = false;

  function applyView(animate) {
    board.classList.toggle('animate', !!animate && !UI.reducedMotion());
    board.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
  }

  // 把地圖上的矩形區域放進畫面；readable 為 true 時，縮太小就改成跟著棋子
  function fitRect(rect, animate, readable) {
    const r = vp.getBoundingClientRect();
    const usableH = Math.max(200, r.height - DICE_SPACE);
    const s = clamp(Math.min(r.width / rect.w, usableH / rect.h) * 0.94, MIN_S, MAX_S);
    if (readable && s < READABLE_S * 0.8) {
      view.s = READABLE_S;
      centerOnToken(animate);
      return;
    }
    view.s = s;
    view.x = (r.width - rect.w * s) / 2 - rect.x * s;
    view.y = (usableH - rect.h * s) / 2 - rect.y * s;
    applyView(animate);
  }

  const fitBoard = (animate) => fitRect(WORLD.bbox, animate, true);
  const fitWorld = (animate) => fitRect(WORLD.bbox, animate, false);

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
    view.y = (r.height - DICE_SPACE) / 2 - y * view.s;
    applyView(animate);
  }

  function ensureTokenVisible() {
    const r = vp.getBoundingClientRect();
    const { x, y } = tokenCenter();
    const sx = view.x + x * view.s;
    const sy = view.y + y * view.s;
    const pad = 40;
    if (sx < pad || sx > r.width - pad || sy < pad || sy > r.height - DICE_SPACE) centerOnToken(true);
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
    else if (e.key === '9') { userMoved = true; fitWorld(true); e.preventDefault(); }
  });

  $('#btn-zoom-in').addEventListener('click', () => zoomCenter(1.25));
  $('#btn-zoom-out').addEventListener('click', () => zoomCenter(1 / 1.25));
  $('#btn-zoom-me').addEventListener('click', () => { userMoved = true; centerOnToken(true); });
  $('#btn-zoom-all').addEventListener('click', () => { userMoved = true; fitWorld(true); });
  window.addEventListener('resize', () => { if (!userMoved) fitBoard(false); });

  // ===== 狀態顯示 =====
  // 下一次投保的優惠／加價（特殊格造成）
  function perkText() {
    const { discount, surcharge } = state.policyPerks;
    const parts = [];
    if (discount) parts.push(`🏷️ 下次投保首年保費折抵 ${Math.round(discount.rate * 100)}%（上限 ${UI.fmtMoney(discount.cap)}）`);
    if (surcharge) parts.push(`⌛ 下次投保加付 ${UI.fmtMoney(surcharge)}`);
    return parts.join('・');
  }

  function renderStatus() {
    $('#stage-chip').textContent = `${stage().name}・${ageInt()} 歲`;
    $('#sum-cash').textContent = UI.fmtMoney(state.cash);
    $('#sum-cash').classList.toggle('neg', state.cash <= 0);
    $('#sum-health').textContent = `${state.health} / 100`;
    const meter = $('#sum-health-meter');
    meter.querySelector('span').style.width = state.health + '%';
    meter.classList.toggle('warn', state.health <= 50 && state.health > 25);
    meter.classList.toggle('danger', state.health <= 25);
    $('#sum-happiness').textContent = `${state.happiness} / 100`;
    const hm = $('#sum-happiness-meter');
    hm.querySelector('span').style.width = state.happiness + '%';
    hm.classList.toggle('danger', state.happiness <= 25);
    // 圈數以「這個階段的第幾圈」顯示
    const lapsBefore = D.stages.slice(0, state.stageIndex).reduce((sum, s) => sum + s.laps, 0);
    const lapsTotal = stage().laps === Infinity ? '' : ` / ${stage().laps}`;
    $('#loop-status').textContent = `目前 ${ageInt()} 歲・第 ${state.lap - lapsBefore + 1}${lapsTotal} 圈`;
    $('#perk-chip').hidden = !perkText();
    $('#perk-chip').textContent = perkText();
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
    const net = monthlyNet();
    const rows = state.market.filter((s) => state.holdings[s.id]?.shares);
    // 股市淨利 = 已實現損益（賣出）+ 未實現損益（持股市值 − 成本）
    const unrealized = stockValue() - Object.values(state.holdings).reduce((s, h) => s + h.cost, 0);
    const stockProfit = stats.realizedPnL + unrealized;
    const premium = Ins.monthlyPremium();
    const benefit = Ins.monthlyBenefit();
    $('#sheet-body').innerHTML = `
      <dl class="info-grid">
        <div><dt>職業</dt><dd>${job.icon} ${UI.escape(job.name)}</dd></div>
        <div><dt>年齡</dt><dd>${ageInt()} 歲</dd></div>
        <div><dt>人生階段</dt><dd>${stage().name}</dd></div>
        <div><dt>${stage().id === 'elder' ? '每月退休金' : '每月收入'}</dt><dd>${UI.fmtMoney(income)}</dd></div>
        <div><dt>物價指數</dt><dd>${priceIndex().toFixed(2)}</dd>
          <dd class="info-sub">每年通膨 ${Math.round(E.inflation * 100)}%；薪資每圈調升 ${Math.round(E.salaryGrowthPerLap * 100)}%（目前月薪 ${UI.fmtMoney(salaryNow())}）</dd></div>
        <div><dt>每月生活費</dt><dd>${UI.fmtMoney(expenseNow())}</dd>
          ${state.ltc ? `<dd class="info-sub">另加長照照護費 ${UI.fmtMoney(Ins.careCost())}</dd>` : ''}</div>
        <div><dt>事件造成的淨收入變化</dt><dd class="${state.netIncomeAdj >= 0 ? 'pos' : 'neg'}">${UI.fmtSigned(state.netIncomeAdj)}/月</dd></div>
        <div><dt>每月保費</dt><dd>${UI.fmtMoney(premium)}</dd>
          <dd class="info-sub${premium > job.salary * D.insurance.budgetRate ? ' neg' : ''}">月薪的 ${Math.round((premium / job.salary) * 100)}%（建議約 ${Math.round(D.insurance.budgetRate * 100)}%）</dd></div>
        ${benefit ? `<div><dt>每月保險給付</dt><dd class="pos">${UI.fmtSigned(benefit)}</dd></div>` : ''}
        <div><dt>每月結餘</dt><dd class="${net >= 0 ? 'pos' : 'neg'}">${UI.fmtSigned(net)}</dd></div>
        <div><dt>現金</dt><dd>${UI.fmtMoney(state.cash)}</dd>
          <dd class="info-sub">銀行年利率 ${(E.bankRate * 100).toFixed(1)}%，累計利息 ${UI.fmtMoney(stats.interestTotal)}</dd></div>
        <div><dt>股票市值</dt><dd>${UI.fmtMoney(stockValue())}</dd></div>
        <div><dt>保單價值</dt><dd>${UI.fmtMoney(Ins.value())}</dd>
          <dd class="info-sub">投資型保險與年金險帳戶</dd></div>
        <div><dt>股市截至目前淨利</dt><dd class="${stockProfit >= 0 ? 'up' : 'down'}">${UI.fmtSigned(stockProfit)}</dd>
          <dd class="info-sub">已實現 ${UI.fmtSigned(stats.realizedPnL)}・未實現 ${UI.fmtSigned(unrealized)}</dd></div>
        <div><dt>淨資產</dt><dd>${UI.fmtMoney(netWorth())}</dd></div>
        <div><dt>健康指數</dt><dd>${state.health} / 100</dd>
          ${state.ltc ? '<dd class="info-sub neg">長照狀態</dd>' : ''}
          ${state.medicalHistory.length ? `<dd class="info-sub">病史：${state.medicalHistory.map((t) => Insurance.TAG_NAME[t]).join('、')}</dd>` : ''}</div>
        <div><dt>幸福指數</dt><dd>${state.happiness} / 100</dd>
          <dd class="info-sub${state.happiness <= 25 ? ' neg' : ''}">${state.happiness <= 25 ? '心情低落，再低下去會失去生活動力' : '約等於心理健康，歸零時遊戲結束'}</dd></div>
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
            return `<tr><td>${UI.escape(s.name)}</td><td>${h.shares.toLocaleString('zh-TW')}</td><td>${s.price.toFixed(2)}</td><td>${UI.fmtMoney(value)}</td><td class="${pnl >= 0 ? 'up' : 'down'}">${UI.fmtSigned(pnl)}</td></tr>`;
          }).join('')}</tbody>
        </table></div>` : '<p class="empty">目前沒有持股，可以從右上角「股票」開始投資。</p>'}
      <h3>保單</h3>
      ${policyTable()}`;
  }

  function policyTable() {
    if (!state.policies.length) return '<p class="empty">目前沒有保單，踩到「保險業務員」格時可以投保。</p>';
    return `
      <div class="table-wrap"><table class="data-table policy-table">
        <thead><tr><th scope="col">險種</th><th scope="col">投保</th><th scope="col">狀態</th><th scope="col">月繳</th><th scope="col">已繳</th><th scope="col">已領給付</th><th scope="col">保單價值</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead>
        <tbody>${state.policies.map((p) => {
          const active = p.status === 'active';
          const due = active && !p.paidUp && !p.stopped;
          const surrender = Ins.surrenderValue(p);
          const actions = [];
          if (active && p.id === 'invest') actions.push(`<button class="btn btn-sm btn-ghost" type="button" data-policy-stop="${p.uid}" ${state.over ? 'disabled' : ''}>${p.stopped ? '恢復繳費' : '停繳'}</button>`);
          if (Ins.canSurrender(p)) actions.push(`<button class="btn btn-sm btn-ghost" type="button" data-policy-cancel="${p.uid}" ${state.over ? 'disabled' : ''}>解約${surrender ? `（${UI.fmtMoney(surrender)}）` : ''}</button>`);
          return `<tr class="${active ? '' : 'inactive'}">
            <td>${Insurance.PRODUCTS[p.id].icon} ${UI.escape(p.name)}</td>
            <td>${p.entryAge} 歲</td>
            <td>${Ins.statusText(p)}</td>
            <td>${due ? UI.fmtMoney(p.monthly) : '—'}</td>
            <td>${UI.fmtMoney(p.paid)}</td>
            <td>${UI.fmtMoney(p.claimed)}</td>
            <td>${UI.fmtMoney(Ins.policyValue(p))}</td>
            <td class="policy-actions">${actions.join('')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="e-meta">保費與生活費一起每月扣款；現金不足時有 ${D.insurance.graceMonths} 個月寬限期，之後仍繳不出就停效。</p>`;
  }

  async function onPolicyAction(e) {
    const btn = e.target.closest('[data-policy-cancel],[data-policy-stop],[data-buy-product],[data-proposal]');
    if (!btn) return;
    if (btn.dataset.proposal) { openProposal(btn.dataset.proposal); return; }
    if (state.over) return;
    if (btn.dataset.buyProduct) {
      const prod = Insurance.PRODUCTS[btn.dataset.buyProduct];
      const q = Ins.quote(prod);
      if (!q.ok) { UI.toast(q.reason); return; }
      if (!prod.amounts) {
        const ok = await UI.confirm({
          title: `投保${prod.name}`,
          message: `每月保費 ${UI.fmtMoney(q.premium)}，${Insurance.payTermText(prod)}，${Insurance.coverText(prod)}。確定投保嗎？`,
          okText: '投保',
          cancelText: '再想想',
        });
        if (!ok) return;
      }
      if (!(await TileEvents.purchase(prod, ctx))) return;
    } else if (btn.dataset.policyStop) {
      Ins.toggleStop(Number(btn.dataset.policyStop));
    } else {
      const uid = Number(btn.dataset.policyCancel);
      const p = state.policies.find((x) => x.uid === uid);
      const cash = Ins.surrenderValue(p);
      const ok = await UI.confirm({
        title: `解約${p.name}`,
        message: cash ? `解約後可領回 ${UI.fmtMoney(cash)}，保障立即結束。` : '這張保單沒有解約金，解約後保障立即結束，之後重新投保要再核保。',
        okText: '解約',
        cancelText: '保留',
        danger: true,
      });
      if (!ok) return;
      Ins.surrender(uid);
      UI.toast(`已解約${p.name}`);
    }
    renderStatus();
    if (sheet.classList.contains('open')) renderSheet();
    if ($('#dlg-policy').open) renderPolicyDialog();
  }
  $('#sheet-body').addEventListener('click', onPolicyAction);
  $('#policy-body').addEventListener('click', onPolicyAction);

  // ===== 保單與保險規則 =====
  const PRICING_TEXT = {
    level: '投保時鎖定保費',
    natural: '每圈依年齡調整保費',
    job: '依職業決定保費',
    amount: '自選每月金額',
  };
  let policyTab = 'mine';

  function premiumText(p) {
    if (p.pricing === 'amount') return `每月 ${p.amounts.map((a) => UI.fmtMoney(a)).join(' / ')} 擇一`;
    if (p.pricing === 'job') return `你的職業：每月 ${UI.fmtMoney(p.jobPremium[job.id] ?? p.jobPremium.default)}`;
    return Object.entries(p.premium).map(([a, v]) => `${a} 歲 ${UI.fmtMoney(v)}`).join('、') + '（每月）';
  }

  // shop：在「全部險種」分頁顯示目前的報價與投保、建議書按鈕
  function productCard(p, owned, shop = false) {
    const chips = p.legacy ? ['已繳清', Insurance.coverText(p)] : [
      PRICING_TEXT[p.pricing],
      Insurance.payTermText(p),
      Insurance.coverText(p),
      Insurance.waitText(p),
      `${p.maxEntryAge} 歲前可投保`,
      p.minHealth ? `健康需 ≥ ${p.minHealth}` : '不需核保',
    ];
    let quote = '';
    if (shop) {
      const q = Ins.quote(p);
      const price = !q.ok ? `<span class="neg">無法投保：${UI.escape(q.reason)}</span>`
        : p.amounts ? '你可以自選月繳金額'
        : `你現在投保：每月 <strong>${UI.fmtMoney(q.premium)}</strong>${q.surcharge > 1 ? `（健康加費 ${Math.round((q.surcharge - 1) * 100)}%）` : ''}`;
      quote = `
        <p class="product-quote">${price}</p>
        <div class="product-actions">
          <button class="btn btn-sm btn-ghost" type="button" data-proposal="${p.id}">📄 建議書</button>
          <button class="btn btn-sm btn-primary" type="button" data-buy-product="${p.id}" ${!q.ok || state.over ? 'disabled' : ''}>投保</button>
        </div>`;
    }
    return `
      <article class="product-card${owned ? ' owned' : ''}">
        <h3><span aria-hidden="true">${p.icon}</span> ${UI.escape(p.name)}${owned ? ` <span class="owned-badge">${p.legacy ? '舊保單' : '已投保'}</span>` : ''}</h3>
        <p class="product-summary">${UI.escape(p.summary)}</p>
        <ul class="effect-list">${chips.map((c) => `<li>${UI.escape(c)}</li>`).join('')}</ul>
        ${p.legacy ? '' : `<p class="product-premium">保費表：${UI.escape(premiumText(p))}</p>`}
        <p class="card-note">${UI.escape(p.note)}</p>
        ${quote}
      </article>`;
  }

  // 建議書（可列印成 PDF）：依目前年齡、職業、健康加費試算
  function openProposal(id) {
    const prod = Insurance.PRODUCTS[id];
    const q = Ins.quote(prod);
    // 傳精確年齡，建議書的首年保費才會和業務員／保險頁的報價一致
    const params = new URLSearchParams({ product: id, age: Math.round(age() * 100) / 100, job: job.id, surcharge: q.surcharge || 1 });
    window.open(`proposal.html?${params}`, '_blank');
  }

  function renderPolicyDialog() {
    document.querySelectorAll('[data-policy-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.policyTab === policyTab)));
    const cfg = D.insurance;
    const ownedIds = new Set(state.policies.filter((p) => p.status === 'active').map((p) => p.id));
    const products = Object.values(Insurance.PRODUCTS);
    if (policyTab === 'mine') {
      const mine = products.filter((p) => ownedIds.has(p.id));
      $('#policy-body').innerHTML = `
        <p class="policy-total">每月保費合計 <strong>${UI.fmtMoney(Ins.monthlyPremium())}</strong>
          ・建議上限（月薪 ${Math.round(cfg.budgetRate * 100)}%）${UI.fmtMoney(job.salary * cfg.budgetRate)}</p>
        ${policyTable()}
        ${mine.length ? `<h3 class="policy-h">保障內容</h3><div class="product-list">${mine.map((p) => productCard(p, true)).join('')}</div>` : ''}`;
    } else {
      $('#policy-body').innerHTML = `
        ${perkText() ? `<p class="policy-perk">${UI.escape(perkText())}</p>` : ''}
        <h3 class="policy-h">通用規則</h3>
        <ul class="rule-list">
          <li>隨時都可以在這裡自己閱讀條款並投保；踩到「保險業務員」格時，業務員會介紹適合你的險種並回答問題。</li>
          <li>每個險種都有「建議書」，列出逐年的保費、身故給付與解約金，可以列印或另存成 PDF。</li>
          <li>保單可以隨時解約，有解約金的會領回現金，保障立即結束。</li>
          <li>保費與生活費一起每月扣款；現金不足時有 ${cfg.graceMonths} 個月寬限期，之後仍繳不出就停效。</li>
          <li>雙十原則：保費總額建議不超過月薪的 ${Math.round(cfg.budgetRate * 100)}%。</li>
          <li>健康降到 ${cfg.ltc.health} 以下會進入長照狀態，之後每月多 ${UI.fmtMoney(cfg.ltc.careCost)} 照護費。</li>
          <li>健康較差時投保可能加費或被拒保；有等待期的險種，生效前發生的事故不理賠。</li>
        </ul>
        <h3 class="policy-h">全部險種</h3>
        <div class="product-list">${products.filter((p) => !p.legacy).map((p) => productCard(p, ownedIds.has(p.id), true)).join('')}</div>`;
    }
  }

  document.querySelectorAll('[data-policy-tab]').forEach((btn) => {
    btn.addEventListener('click', () => { policyTab = btn.dataset.policyTab; renderPolicyDialog(); });
  });
  $('#btn-policy').addEventListener('click', () => { renderPolicyDialog(); $('#dlg-policy').showModal(); });

  // ===== 股票 =====
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
      if (effects && (effects.cash || effects.health || effects.happiness)) ctx.applyEffects(effects, `${ep.title}：${life.text}`, ep.icon);
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
  // 點市場跑馬燈：直接看市場波動紀錄
  $('#market-ticker').addEventListener('click', () => {
    historyFilter = 'market';
    document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === 'market')));
    renderHistory();
    $('#dlg-history').showModal();
  });

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
    // 一次套用多種影響，只記一筆歷史事件；effects: { cash, netIncome, health, happiness }
    applyEffects({ cash = 0, netIncome = 0, health = 0, happiness = 0 }, reason, icon = '🎲') {
      state.cash = Math.round(state.cash + cash);
      state.netIncomeAdj = Math.round(state.netIncomeAdj + netIncome);
      state.health = clamp(Math.round(state.health + health), 0, 100);
      state.happiness = clamp(Math.round(state.happiness + (happiness || 0)), 0, 100);
      const parts = [];
      if (cash) parts.push(`現金 ${UI.fmtSigned(cash)}`);
      if (netIncome) parts.push(`淨收入 ${UI.fmtSigned(netIncome)}/月`);
      if (health) parts.push(`健康 ${health > 0 ? '+' : ''}${health}`);
      if (happiness) parts.push(`幸福 ${happiness > 0 ? '+' : ''}${happiness}`);
      if (cash < 0 && (!stageStats.biggestLoss || cash < stageStats.biggestLoss.amount)) stageStats.biggestLoss = { amount: cash, reason };
      addHistory('life', icon, parts.length ? `${reason}（${parts.join('、')}）` : reason);
      renderStatus();
    },
    addNetIncome(n, reason) {
      state.netIncomeAdj = Math.round(state.netIncomeAdj + n);
      addHistory('life', n >= 0 ? '📈' : '📉', `${reason}（淨收入 ${UI.fmtSigned(n)}/月）`);
      renderStatus();
    },
    insurance: Ins,
    openProposal,
    job,
    // 生病停薪；退休後不影響退休金
    stopIncome(months) {
      state.incomeStopUntil = Math.max(state.incomeStopUntil, state.steps + Math.ceil(months / E.monthsPerStep));
      if (stage().id !== 'elder') addHistory('life', '⏸️', `因病停薪 ${months} 個月`);
    },
    age: ageInt,
    stageId: () => stage().id,
    gameId: () => state.gameId,
    stats,
    alert: (opts) => UI.alert(opts),
    logDecision,
    renderStatus: () => renderStatus(),
    addHistory,
    // 依目前物價調整事件牌的金額
    inflate: (card) => ({ ...card, cash: inflate(card.cash), netIncome: inflate(card.netIncome) }),
    inflateAmount: inflate,
    priceIndex,
    salaryNow,
    expenseNow,
    // 擲一次骰子（住院天數等），回傳 1–6
    rollDice: () => rollDice(),
    // 貴人相助：往前走 n 格（照常過月份），再執行停留格的事件
    async moveForward(n) {
      for (let i = 0; i < n; i++) await stepOnce(stepDelay());
      ensureTokenVisible();
      announce(`前進 ${n} 格，來到「${currentTile().name}」`);
      await runTile(currentTile());
    },
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

  // ===== 人生階段報告：每個階段結束與遊戲結束時，列出保險、資產配置與目前狀況 =====
  const newStageStats = () => ({
    startAge: ageInt(),
    startNetWorth: netWorth(),
    claims: stats.claims,
    claimTotal: stats.claimTotal,
    medicalCost: stats.medicalCost,
    quizAsked: stats.quizAsked,
    quizCorrect: stats.quizCorrect,
    biggestLoss: null,
  });
  let stageStats = null;

  const ASSET_COLORS = ['#2f9e44', '#e67700', '#7048e8', '#c2255c', '#0c8599', '#1c7ed6'];

  function stageReportHtml() {
    const b = stageStats;
    const assets = [
      { name: '現金', value: Math.max(0, state.cash) },
      ...state.market.filter((m) => state.holdings[m.id]?.shares).map((m) => ({ name: m.name, value: state.holdings[m.id].shares * m.price })),
      { name: '保單價值', value: Ins.value() },
    ].filter((a) => a.value > 0).map((a, i) => ({ ...a, color: ASSET_COLORS[i % ASSET_COLORS.length] }));
    const total = assets.reduce((s, a) => s + a.value, 0) || 1;
    const policies = Ins.summary();
    const premium = Ins.monthlyPremium();
    const fund = state.cash / expenseNow();
    const net = monthlyNet();
    const claimed = stats.claimTotal - b.claimTotal;
    const medical = stats.medicalCost - b.medicalCost;
    const asked = stats.quizAsked - b.quizAsked;
    const correct = stats.quizCorrect - b.quizCorrect;
    const worthDiff = netWorth() - b.startNetWorth;
    return `
      <h3 class="report-h">🛡️ 保險</h3>
      ${policies.length ? `
        <div class="table-wrap"><table class="data-table report-table">
          <thead><tr><th scope="col">險種</th><th scope="col">投保</th><th scope="col">月繳</th><th scope="col">狀態</th><th scope="col">已繳</th><th scope="col">已理賠</th></tr></thead>
          <tbody>${policies.map((p) => `<tr><td>${UI.escape(p.name)}${p.legacy ? '<small>（舊保單）</small>' : ''}</td><td>${p.entryAge} 歲</td>
            <td>${p.monthly ? UI.fmtMoney(p.monthly) : '—'}</td><td>${UI.escape(p.status)}</td><td>${UI.fmtMoney(p.paid)}</td><td>${UI.fmtMoney(p.claimed)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty">目前沒有任何保單。</p>'}
      <p class="report-sub">每月保費 ${UI.fmtMoney(premium)}，占月薪 ${Math.round((premium / salaryNow()) * 100)}%（建議 5–15%）</p>

      <h3 class="report-h">💼 資產配置</h3>
      <div class="asset-bar" role="img" aria-label="${assets.map((a) => `${a.name} ${Math.round((a.value / total) * 100)}%`).join('、')}">
        ${assets.map((a) => `<span style="width:${(a.value / total) * 100}%;background:${a.color}"></span>`).join('')}
      </div>
      <ul class="asset-legend">${assets.map((a) => `<li><i style="background:${a.color}"></i>${UI.escape(a.name)} ${UI.fmtMoney(a.value)}（${Math.round((a.value / total) * 100)}%）</li>`).join('')}</ul>
      <p class="report-sub">淨資產 ${UI.fmtMoney(netWorth())}，這個階段 ${UI.fmtSigned(worthDiff)}</p>

      <h3 class="report-h">🩺 目前狀況</h3>
      <dl class="report-grid">
        <div><dt>年齡</dt><dd>${ageInt()} 歲</dd></div>
        <div><dt>健康指數</dt><dd class="${state.health <= 30 ? 'neg' : ''}">${state.health} / 100</dd></div>
        <div><dt>幸福指數</dt><dd class="${state.happiness <= 30 ? 'neg' : ''}">${state.happiness} / 100</dd></div>
        <div><dt>病史</dt><dd>${state.medicalHistory.length ? state.medicalHistory.map((t) => Insurance.TAG_NAME[t]).join('、') : '無'}${state.ltc ? '、長照中' : ''}</dd></div>
        <div><dt>每月結餘</dt><dd class="${net >= 0 ? 'pos' : 'neg'}">${UI.fmtSigned(net)}</dd></div>
        <div><dt>緊急預備金</dt><dd class="${fund >= 3 ? 'pos' : 'neg'}">${fund > 0 ? fund.toFixed(1) : 0} 個月生活費</dd>
          <dd class="report-hint">${fund >= 6 ? '很充足' : fund >= 3 ? '及格（建議 3–6 個月）' : '不足，遇到意外容易被迫賣股或破產'}</dd></div>
      </dl>

      <h3 class="report-h">📝 這個階段的回顧</h3>
      <ul class="report-list">
        <li>保險理賠 ${stats.claims - b.claims} 次，共 ${UI.fmtMoney(claimed)}${medical ? `；醫療支出 ${UI.fmtMoney(medical)}，保險負擔了 ${Math.round(Math.min(1, claimed / medical) * 100)}%` : ''}</li>
        <li>${b.biggestLoss ? `最大一筆支出：${UI.escape(b.biggestLoss.reason)}（${UI.fmtMoney(b.biggestLoss.amount)}）` : '沒有大筆的意外支出'}</li>
        <li>${asked ? `保險知識題答對 ${correct} / ${asked} 題` : '這個階段沒有遇到保險知識題'}</li>
      </ul>`;
  }

  async function showStageReport(s, final = false) {
    await UI.modal({
      title: `📋 ${s.name}階段報告（${stageStats.startAge}–${ageInt()} 歲）`,
      body: `<div class="stage-report">${stageReportHtml()}</div>`,
      actions: [{ label: final ? '下一步' : '繼續人生', value: 'ok', variant: 'primary' }],
      dismissible: false,
      className: 'modal-wide',
    });
    logDecision(`${s.name}階段結束（${ageInt()} 歲）：淨資產 ${UI.fmtMoney(netWorth())}、健康 ${state.health}、幸福 ${state.happiness}、每月保費 ${UI.fmtMoney(Ins.monthlyPremium())}`, 'milestone');
  }

  async function passStart() {
    state.lap++;
    Ins.onLap();
    stats.lapSamples++;
    if (state.cash >= expenseNow() * 3) stats.emergencyLaps++;
    if (stage().id !== 'elder') {
      stats.premiumRatioSum += Ins.monthlyPremium() / salaryNow();
      stats.premiumSamples++;
    }
    state.salaryIndex *= 1 + E.salaryGrowthPerLap;
    addHistory('life', '🧾', `物價指數 ${priceIndex().toFixed(2)}，每月生活費調整為 ${UI.fmtMoney(expenseNow())}；薪資調升 ${Math.round(E.salaryGrowthPerLap * 100)}%，月薪 ${UI.fmtMoney(salaryNow())}`);
    const decay = E.healthDecayPerLap[stage().id];
    if (decay > 0) addHistory('life', '⏳', `歲月流逝，健康 -${decay}`);
    else if (decay < 0 && state.health < 100) addHistory('life', '💪', `年輕身體恢復得快，健康 +${-decay}`);
    state.health = clamp(state.health - decay, 0, 100);
    const sad = E.happinessDecayPerLap[stage().id];
    const stress = state.cash < expenseNow() * E.stress.months ? E.stress.happiness : 0;
    if (sad + stress) {
      state.happiness = clamp(state.happiness - sad - stress, 0, 100);
      addHistory('life', '🌧️', `${stress ? `存款不到 ${E.stress.months} 個月生活費，經濟壓力大；` : ''}生活的消磨讓幸福 -${sad + stress}`);
    }
    addHistory('life', '🏁', `完成第 ${state.lap} 圈，${ageInt()} 歲`);
    const idx = stageIndexForLap(state.lap);
    if (idx !== state.stageIndex) {
      await showStageReport(stage());
      stageStats = newStageStats();
      state.stageIndex = idx;
      if (stage().id === 'elder') state.retirePrice = priceIndex();
      buildBoard();
      const msg = {
        middle: '人生進入中年（40–65 歲）。收入提升為月薪的 1.3 倍，但家庭與健康的挑戰也變多了。',
        elder: `你退休了！之後收入改為退休金（約月薪的 ${Math.round(E.incomeRate.elder * 100)}%${E.pensionIndexed ? '，會隨物價調整' : ''}），健康也會開始下降。`,
      }[stage().id];
      addHistory('life', '🎂', `進入${stage().name}階段`);
      logDecision(`${ageInt()} 歲進入${stage().name}，淨資產 ${UI.fmtMoney(netWorth())}`, 'milestone');
      await UI.alert({ title: `進入${stage().name}階段`, message: msg, okText: '繼續' });
    }
  }

  // 過一個月：銀行利息、薪水與生活費、保費；noSalary 為住院期間沒有薪水
  function payMonth(noSalary = false) {
    if (state.cash > 0) {
      const interest = Math.round(state.cash * (E.bankRate / 12) * E.monthsPerStep);
      state.cash += interest;
      stats.interestTotal += interest;
    }
    state.cash += (monthlyCashflow() - (noSalary ? monthlyIncome() : 0)) * E.monthsPerStep;
    Ins.monthly();
  }

  // 前進一格 = 過一個月：領薪、扣生活費與保費，經過起點時換圈
  async function stepOnce(delay) {
    await waitIfPaused();
    state.position = (state.position + 1) % E.tilesPerLap;
    state.steps++;
    payMonth();
    if (state.position === 0) await passStart();
    placeToken(true);
    renderStatus();
    await UI.wait(delay);
  }

  const stepDelay = () => (UI.reducedMotion() ? 60 : 220);

  async function runTile(tile) {
    await waitIfPaused();
    await (TileEvents[tile.type] || TileEvents.default)(tile, ctx);
  }

  // 住院中：這回合不移動，仍過一個月（沒有薪水，退休金照領）
  async function hospitalTurn() {
    state.skipTurns--;
    const before = state.cash;
    state.steps++;
    const lost = stage().id === 'elder' ? 0 : monthlyIncome();
    payMonth(lost > 0);
    addHistory('life', '🛏️', `住院休養，暫停移動 1 回合${lost ? `，少領 1 個月薪水（${UI.fmtMoney(lost)}）` : ''}`);
    renderStatus();
    announce(`住院休養中，暫停移動・1 個月收支 ${UI.fmtSigned(state.cash - before)}`);
    const due = marketTick(E.monthsPerStep);
    await UI.alert({ title: '🛏️ 住院休養中', message: `這回合暫停移動。${lost ? '無法上班，這個月沒有薪水。' : '退休金照常入帳。'}`, okText: '繼續' });
    await showStory(due);
    return E.monthsPerStep;
  }

  async function moveTurn() {
    const n = await rollDice();
    announce(`擲出 ${n} 點`);
    const before = state.cash;
    for (let i = 0; i < n; i++) await stepOnce(stepDelay());
    ensureTokenVisible();
    const tile = currentTile();
    announce(`擲出 ${n} 點，來到「${tile.name}」・${n * E.monthsPerStep} 個月收支 ${UI.fmtSigned(state.cash - before)}`);
    await showStory(marketTick(n * E.monthsPerStep));
    await runTile(tile);
    return n * E.monthsPerStep;
  }

  async function turn() {
    if (state.busy || state.over || state.paused) return;
    state.busy = true;
    setDiceEnabled(false);
    state.turn++;
    const months = state.skipTurns > 0 ? await hospitalTurn() : await moveTurn();
    await maybeMajorIllness(months);
    await checkLtc();

    stats.peakNetWorth = Math.max(stats.peakNetWorth, netWorth());
    stats.minHealth = Math.min(stats.minHealth, state.health);
    stats.healthSum += state.health;
    stats.healthSamples++;
    stats.minHappiness = Math.min(stats.minHappiness, state.happiness);
    stats.happinessSum += state.happiness;
    renderStatus();

    if (await checkEnd()) return;
    state.busy = false;
    setDiceEnabled(true);
    diceBtn.querySelector('.dice-label').textContent = state.skipTurns > 0 ? '住院休養' : '擲骰子';
  }

  // 重大疾病：每回合依年齡與健康擲一次（命運牌裡的大病很少，補上才能體會重大傷病、癌症險的價值）
  async function maybeMajorIllness(months) {
    if (state.health <= 0) return;
    const cfg = D.majorIllness;
    // 職業倍率：心血管疾病（心肌梗塞、腦中風）依 job.risk.heart 調整，發生率與病種比例一起變
    const weightOf = (ev) => ev.weight * (['heart', 'stroke'].includes(ev.tag) ? job.risk.heart || 1 : 1);
    const baseWeight = cfg.events.reduce((s, ev) => s + ev.weight, 0);
    const totalWeight = cfg.events.reduce((s, ev) => s + weightOf(ev), 0);
    let rate = Insurance.interp(cfg.annualRate, age()) * (totalWeight / baseWeight) * illnessRate();
    if (state.health < 70) rate *= 1 + ((70 - state.health) / 10) * 0.2;
    if (Math.random() >= (rate * months) / 12) return;
    let r = Math.random() * totalWeight;
    const ev = cfg.events.find((x) => (r -= weightOf(x)) < 0) || cfg.events[0];
    stats.majorIllness++;
    await TileEvents.illness(ev, ctx);
    renderStatus();
  }

  async function checkLtc() {
    const res = Ins.checkLtc();
    if (!res) return;
    renderStatus();
    const notes = res.notes.length ? res.notes : ['你沒有長照險，照護費必須全部自付。'];
    await UI.alert({
      title: '🧑‍🦽 進入長照狀態',
      html: `<p>健康降到 ${state.health}，日常生活需要他人照顧，之後每月多 ${UI.fmtMoney(Ins.careCost())} 照護費。</p>
        <ul>${notes.map((t) => `<li>${UI.escape(t)}</li>`).join('')}</ul>`,
      okText: '我知道了',
      dismissible: false,
    });
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
    else if (state.happiness <= 0) reason = 'unhappy';
    else if (age() >= E.maxAge) reason = 'maxAge';
    if (!reason) return false;
    await endGame(reason);
    return true;
  }

  const END_TEXT = {
    bankrupt: { title: '破產了…', icon: '💸', msg: (a) => `你在 ${a} 歲時現金歸零，宣告破產。` },
    death: { title: '健康指數歸零', icon: '🕯️', msg: (a) => `你在 ${a} 歲時健康耗盡，人生畫下句點。` },
    unhappy: { title: '幸福指數歸零', icon: '🌧️', msg: (a) => `你在 ${a} 歲時失去了生活的動力，人生停在這裡。` },
    maxAge: { title: '壽終正寢', icon: '🎉', msg: (a) => `你平安活到 ${a} 歲，走完了精彩的一生！` },
  };

  async function endGame(reason) {
    state.over = true;
    setDiceEnabled(false);
    const t = END_TEXT[reason];
    const lastTag = state.lastTag && state.lastTag.turn === state.turn ? state.lastTag.tag : null;
    const legacy = reason === 'death' ? Ins.deathBenefits(lastTag) : { total: 0, items: [] };
    const policyValue = reason === 'death' ? 0 : Ins.value(); // 身故時保單價值已轉成給家人的給付
    const record = {
      id: 'g' + Date.now().toString(36),
      gameId: state.gameId, // 伺服器端的遊戲 id，AI 評分與排行榜用
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
      policyValue: Math.round(policyValue),
      netWorth: Math.round(state.cash + stockValue() + policyValue),
      legacy: legacy.total,
      legacyItems: legacy.items,
      peakNetWorth: Math.round(stats.peakNetWorth),
      minHealth: stats.minHealth,
      avgHealth: stats.healthSamples ? Math.round(stats.healthSum / stats.healthSamples) : state.health,
      medicalCost: Math.round(stats.medicalCost),
      lapses: stats.lapses,
      emergencyRate: stats.lapSamples ? Math.round((stats.emergencyLaps / stats.lapSamples) * 100) / 100 : (state.cash >= expenseNow() * 3 ? 1 : 0),
      avgPremiumRatio: stats.premiumSamples ? Math.round((stats.premiumRatioSum / stats.premiumSamples) * 1000) / 1000 : Math.round((Ins.monthlyPremium() / salaryNow()) * 1000) / 1000,
      quizAsked: stats.quizAsked,
      quizCorrect: stats.quizCorrect,
      priceIndex: Math.round(priceIndex() * 100) / 100,
      finalSalary: salaryNow(),
      interestTotal: Math.round(stats.interestTotal),
      marketEvents: state.story.seen.map((id) => STORY[id].title),
      finalHappiness: state.happiness,
      minHappiness: stats.minHappiness,
      avgHappiness: stats.healthSamples ? Math.round(stats.happinessSum / stats.healthSamples) : state.happiness,
      laps: state.lap,
      turns: state.turn,
      trades: stats.trades,
      distinctStocks: stats.boughtIds.size,
      realizedPnL: Math.round(stats.realizedPnL),
      forcedSales: stats.forcedSales,
      netIncomeAdj: state.netIncomeAdj,
      insured: state.policies.length > 0,
      firstInsuredAge: stats.firstInsuredAge,
      policies: Ins.summary(),
      premiumsPaid: Math.round(stats.premiumsPaid),
      monthlyPremium: Ins.monthlyPremium(),
      maxPremiumRatio: Math.round(stats.maxPremiumRatio * 100) / 100,
      medicalHistory: state.medicalHistory.slice(),
      majorIllness: stats.majorIllness,
      ltcAge: state.ltc ? state.ltc.age : null,
      chanceAccepted: stats.chanceAccepted,
      chanceDeclined: stats.chanceDeclined,
      fateCount: stats.fateCount,
      claims: stats.claims,
      claimTotal: Math.round(stats.claimTotal),
      holdings: state.market.filter((s) => state.holdings[s.id]).map((s) => ({ id: s.id, name: s.name, shares: state.holdings[s.id].shares, value: Math.round(state.holdings[s.id].shares * s.price) })),
      log: state.log.slice(-100),
      history: state.history.slice(-60),
      startedAt: setup.startedAt,
      endedAt: Date.now(),
    };
    Store.session.set('lastResult', record);
    Store.session.remove('newGame');
    await showStageReport(stage(), true);
    await UI.modal({
      title: t.title,
      body: `<p class="pause-body" aria-hidden="true">${t.icon}</p><p>${UI.escape(record.endReasonText)}</p>
        ${legacy.total ? `<p>🕊️ 保險給付家人 ${UI.fmtMoney(legacy.total)}（${legacy.items.map((i) => `${UI.escape(i.name)} ${UI.fmtMoney(i.amount)}`).join('、')}）</p>` : ''}
        <p>接下來 AI 會為你的人生進行評分、總結與建議。</p>`,
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
      body: pauseBody(),
      actions: [{ label: '繼續遊戲', value: 'ok', variant: 'primary' }],
    });
    state.paused = false;
  });

  // 暫停視窗內可直接調整外觀主題與股票漲跌顏色，變更立即套用並存檔（與首頁設定共用）
  function pauseBody() {
    const s = Store.getSettings();
    const radio = (name, value, label) =>
      `<label><input type="radio" name="${name}" value="${value}" ${s[name] === value ? 'checked' : ''}> ${label}</label>`;
    const el = document.createElement('div');
    el.innerHTML = `
      <p class="pause-body" aria-hidden="true">⏸️</p>
      <p style="text-align:center">休息一下，準備好再繼續。</p>
      <hr class="divider">
      <fieldset class="field">
        <legend>外觀主題</legend>
        <div class="radio-row">
          ${radio('theme', 'system', '跟隨系統')}${radio('theme', 'light', '淺色')}${radio('theme', 'dark', '深色')}
        </div>
      </fieldset>
      <fieldset class="field">
        <legend>股票漲跌顏色</legend>
        <div class="radio-row">
          ${radio('stockColor', 'tw', '<span class="neg">紅漲</span><span class="pos">綠跌</span>（台股）')}
          ${radio('stockColor', 'us', '<span class="pos">綠漲</span><span class="neg">紅跌</span>（美股）')}
        </div>
      </fieldset>`;
    el.addEventListener('change', (e) => {
      if (e.target.type !== 'radio') return;
      Store.saveSettings({ ...Store.getSettings(), [e.target.name]: e.target.value });
      UI.applySettings();
    });
    return el;
  }

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

  state.story.schedule = buildStory();
  stageStats = newStageStats();

  // 開局保單類型與初始保單（父母買的舊保單）
  async function showStartingPolicies() {
    const { tier, policies } = Ins.rollStarting();
    renderStatus();
    const list = policies.map((p) => {
      const prod = Insurance.PRODUCTS[p.id];
      return `<li><strong>${prod.icon} ${UI.escape(prod.name)}</strong>：${UI.escape(prod.summary)}</li>`;
    }).join('');
    await UI.alert({
      title: '🗂️ 你的保險現況',
      html: `
        <div class="event-card" data-kind="insurance">
          <p class="card-text">你的保單類型是「<strong>${tier.name}</strong>」。</p>
          ${policies.length
            ? `<p>父母過去替你買了 ${policies.length} 張保單，已經繳清，不用再繳保費：</p><ul>${list}</ul>
               <p class="card-note">這些舊保單保障偏低，可以在右上角「保險」查看，或之後自己補強。</p>`
            : '<p class="card-note">你目前沒有任何保單。可以在右上角「保險」閱讀各險種條款並投保，或等保險業務員來介紹。</p>'}
        </div>`,
      okText: '開始人生',
      dismissible: false,
    });
  }

  // 向伺服器建立本局，之後的抽牌都以此 id 避免重複
  setDiceEnabled(false);
  const starting = showStartingPolicies();
  API.createGame(job.id)
    .then((id) => { state.gameId = id; })
    .catch(async () => {
      await UI.alert({
        title: '無法連線遊戲伺服器',
        message: '機會與命運牌、AI 評分與全服排名都需要伺服器。目前仍可遊玩，但抽不到牌，結算也會改用本機評分。',
      });
    })
    .finally(() => starting.then(() => setDiceEnabled(true)));
})();
