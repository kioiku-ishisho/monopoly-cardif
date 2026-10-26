/* 遊戲主頁：上列狀態列、右側分頁（保險／股票／歷史／個人；手機為抽屜）、歷史事件、暫停與離開 */
(function (G) {
  if (!G) return;
  const { D, E, $, job, state, stats, Ins, stage, ageInt, priceIndex, salaryNow, expenseNow,
    monthlyIncome, monthlyNet, stockValue, netWorth } = G;

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
    $('#sum-health').textContent = state.health;
    const meter = $('#sum-health-meter');
    meter.querySelector('span').style.width = state.health + '%';
    meter.classList.toggle('warn', state.health <= 50 && state.health > 25);
    meter.classList.toggle('danger', state.health <= 25);
    $('#sum-happiness').textContent = state.happiness;
    const hm = $('#sum-happiness-meter');
    hm.querySelector('span').style.width = state.happiness + '%';
    hm.classList.toggle('danger', state.happiness <= 25);
    $('#loop-status').textContent = `目前 ${ageInt()} 歲・${lapText()}`;
    $('#perk-chip').hidden = !perkText();
    $('#perk-chip').textContent = perkText();
    renderPanel();
  }

  // 圈數以「這個階段的第幾圈」顯示
  function lapText() {
    const lapsBefore = D.stages.slice(0, state.stageIndex).reduce((sum, s) => sum + s.laps, 0);
    const lapsTotal = stage().laps === Infinity ? '' : ` / ${stage().laps}`;
    return `第 ${state.lap - lapsBefore + 1}${lapsTotal} 圈`;
  }

  // ===== 右側分頁：保險／股票／歷史／個人 =====
  // 電腦版常駐右欄、點分頁切換內容；手機為右緣直立分頁，點了從右側滑出抽屜（點遮罩或再點同一分頁關閉）
  // 與 css/game.css 的斷點一致
  const DESKTOP_QUERY = window.matchMedia('(min-width: 1024px)');
  const tabs = [...document.querySelectorAll('.tab[data-tab]')];
  const tabPanels = $('#tab-panels');
  const scrim = $('#drawer-scrim');
  let activeTab = 'personal';
  let drawerOpen = false;

  const isPanelVisible = (tab) => activeTab === tab && (DESKTOP_QUERY.matches || drawerOpen);

  function renderPanel() {
    if (!DESKTOP_QUERY.matches && !drawerOpen) return;
    if (activeTab === 'insurance') G.renderPolicy();
    else if (activeTab === 'stock') renderStockPanel();
    else if (activeTab === 'history') renderHistory();
    else renderPersonal();
  }

  // 重新渲染股票分頁時保留玩家輸入中的股數
  function renderStockPanel() {
    const qty = {};
    $('#stock-body').querySelectorAll('input[type="number"]').forEach((el) => { qty[el.id] = el.value; });
    G.renderStocks();
    Object.entries(qty).forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.value = v; });
  }

  function setDrawer(open) {
    const desktop = DESKTOP_QUERY.matches;
    drawerOpen = open && !desktop;
    document.body.classList.toggle('drawer-open', drawerOpen);
    scrim.hidden = !drawerOpen;
    tabPanels.inert = !desktop && !drawerOpen;
  }

  function selectTab(tab) {
    activeTab = tab;
    tabs.forEach((t) => {
      const on = t.dataset.tab === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.tab-panel').forEach((el) => { el.hidden = el.id !== `panel-${tab}`; });
  }

  // 開啟指定分頁（手機會一併打開抽屜）
  function openTab(tab) {
    selectTab(tab);
    setDrawer(true);
    renderPanel();
    tabPanels.scrollTop = 0;
  }

  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      if (drawerOpen && activeTab === t.dataset.tab) { setDrawer(false); return; }
      openTab(t.dataset.tab);
    });
    // 方向鍵在分頁間移動
    t.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = tabs[(tabs.indexOf(t) + step + tabs.length) % tabs.length];
      next.focus();
      openTab(next.dataset.tab);
    });
  });
  scrim.addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen && !document.querySelector('dialog[open]')) {
      setDrawer(false);
      tabs.find((t) => t.dataset.tab === activeTab).focus();
    }
  });
  DESKTOP_QUERY.addEventListener('change', () => { setDrawer(false); renderPanel(); G.refit(); });
  selectTab(activeTab);
  setDrawer(false);

  // ===== 個人：現金／健康／幸福只在上列，這裡放其他數據 =====
  function renderPersonal() {
    const income = monthlyIncome();
    const net = monthlyNet();
    const rows = state.market.filter((s) => state.holdings[s.id]?.shares);
    // 股市淨利 = 已實現損益（賣出）+ 未實現損益（持股市值 − 成本）
    const unrealized = stockValue() - Object.values(state.holdings).reduce((s, h) => s + h.cost, 0);
    const stockProfit = stats.realizedPnL + unrealized;
    const premium = Ins.monthlyPremium();
    const benefit = Ins.monthlyBenefit();
    $('#personal-body').innerHTML = `
      <dl class="stat-cards">
        <div><dt>淨資產</dt><dd>${UI.fmtMoney(netWorth())}</dd></div>
        <div><dt>每月結餘</dt><dd class="${net >= 0 ? 'pos' : 'neg'}">${UI.fmtSigned(net).replace('NT$ ', '<span class="cur">NT$ </span>')}</dd></div>
        <div><dt>股票獲利</dt><dd class="${stockProfit >= 0 ? 'up' : 'down'}">${UI.fmtSigned(stockProfit)}</dd></div>
        <div><dt>每月保費</dt><dd>${UI.fmtMoney(premium)}</dd></div>
      </dl>
      <h3 class="panel-h">持股明細</h3>
      <div class="mini-table">
        <div class="mini-row mini-head"><span>股票</span><span>股數</span><span>損益</span></div>
        ${rows.length ? rows.map((s) => {
          const h = state.holdings[s.id];
          const pnl = h.shares * s.price - h.cost;
          return `<div class="mini-row"><span>${UI.escape(s.name)}</span><span>${h.shares.toLocaleString('zh-TW')}</span><span class="${pnl >= 0 ? 'up' : 'down'}">${UI.fmtSigned(pnl)}</span></div>`;
        }).join('') : '<p class="mini-empty">目前沒有持股，可以從「股票」分頁開始投資。</p>'}
      </div>
      <h3 class="panel-h">保單</h3>
      ${state.policies.length ? `<ul class="policy-list">${state.policies.map((p) => `
        <li class="${p.status === 'active' ? '' : 'inactive'}">
          <span>${Insurance.PRODUCTS[p.id].icon} ${UI.escape(p.name)}</span>
          <small>${Ins.statusText(p)}${p.status === 'active' && !p.paidUp && !p.stopped ? `・月繳 ${UI.fmtMoney(p.monthly)}` : ''}</small>
        </li>`).join('')}</ul>`
        : '<p class="policy-list mini-empty">目前沒有保單，可以從「保險」分頁投保。</p>'}
      <dl class="info-list">
        <div><dt>職業</dt><dd>${job.icon} ${UI.escape(job.name)}</dd></div>
        <div><dt>${stage().id === 'elder' ? '每月退休金' : '每月收入'}</dt><dd>${UI.fmtMoney(income)}</dd></div>
        <div><dt>每月生活費</dt><dd>${UI.fmtMoney(expenseNow())}</dd>
          ${state.ltc ? `<dd class="info-sub">另加長照照護費 ${UI.fmtMoney(Ins.careCost())}</dd>` : ''}</div>
        <div><dt>物價指數</dt><dd>${priceIndex().toFixed(2)}</dd>
          <dd class="info-sub">每年通膨 ${+(E.inflation * 100).toFixed(1)}%；薪資每年成長 ${+(E.salaryGrowth * 100).toFixed(1)}%（每圈調升一次）（目前月薪 ${UI.fmtMoney(salaryNow())}）</dd></div>
        <div><dt>事件造成的淨收入變化</dt><dd class="${state.netIncomeAdj >= 0 ? 'pos' : 'neg'}">${UI.fmtSigned(state.netIncomeAdj)}/月</dd></div>
        <div><dt>保費占月薪</dt><dd class="${premium > job.salary * D.insurance.budgetRate ? 'neg' : ''}">${Math.round((premium / job.salary) * 100)}%</dd>
          <dd class="info-sub">建議約 ${Math.round(D.insurance.budgetRate * 100)}%</dd></div>
        ${benefit ? `<div><dt>每月保險給付</dt><dd class="pos">${UI.fmtSigned(benefit)}</dd></div>` : ''}
        <div><dt>股票市值</dt><dd>${UI.fmtMoney(stockValue())}</dd>
          <dd class="info-sub">已實現 ${UI.fmtSigned(stats.realizedPnL)}・未實現 ${UI.fmtSigned(unrealized)}</dd></div>
        <div><dt>保單價值</dt><dd>${UI.fmtMoney(Ins.value())}</dd>
          <dd class="info-sub">投資型保險與年金險帳戶</dd></div>
        <div><dt>活存利息</dt><dd>${UI.fmtMoney(stats.interestTotal)}</dd>
          <dd class="info-sub">年利率 ${+(E.bankRate * 100).toFixed(2)}%</dd></div>
        <div><dt>病史</dt><dd>${state.medicalHistory.length ? state.medicalHistory.map((t) => Insurance.TAG_NAME[t]).join('、') : '無'}</dd>
          ${state.ltc ? '<dd class="info-sub neg">長照狀態</dd>' : ''}</div>
        <div><dt>圈數</dt><dd>${stage().name}・${lapText()}</dd>
          <dd class="info-sub">已完成 ${state.lap} 圈</dd></div>
        <div><dt>回合數</dt><dd>${state.turn}</dd></div>
      </dl>`;
  }

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
  // 點市場跑馬燈：直接看市場波動紀錄
  $('#market-ticker').addEventListener('click', () => {
    historyFilter = 'market';
    document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === 'market')));
    openTab('history');
  });

  // ===== 暫停（含離開遊戲） =====
  $('#btn-pause').addEventListener('click', async () => {
    if (state.over) return;
    state.paused = true;
    for (;;) {
      const choice = await UI.modal({
        title: '遊戲暫停',
        body: pauseBody(),
        className: 'modal-pause',
        actions: [
          { label: '離開遊戲', value: 'quit', variant: 'danger' },
          { label: '重看新手教學', value: 'tutorial', variant: 'ghost' },
          { label: '繼續遊戲', value: 'ok', variant: 'primary' },
        ],
      });
      if (choice === 'tutorial') await Tutorial.run();
      // 取消離開時回到暫停視窗
      if (choice === 'quit' && !(await confirmQuit())) continue;
      break;
    }
    state.paused = false;
  });

  // 暫停視窗內可直接調整外觀主題與股票漲跌顏色，變更立即套用並存檔（與首頁設定共用）
  function pauseBody() {
    const s = Store.getSettings();
    const radio = (name, value, label) =>
      `<label><input type="radio" name="${name}" value="${value}" ${s[name] === value ? 'checked' : ''}> ${label}</label>`;
    const el = document.createElement('div');
    el.innerHTML = `
      <p class="pause-body" aria-hidden="true">${UI.icons.pause}</p>
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

  async function confirmQuit() {
    const ok = await UI.confirm({
      title: '離開遊戲',
      message: '確定要離開嗎？本局進度與紀錄都不會被保存。',
      okText: '離開',
      cancelText: '返回',
      danger: true,
    });
    if (ok) {
      state.over = true;
      Store.session.remove('newGame');
      location.href = 'index.html';
    }
    return ok;
  }

  Object.assign(G, { perkText, renderStatus, renderPanel, isPanelVisible, openTab, renderHistory });
})(window.Game);
