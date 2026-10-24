/* 遊戲主頁：狀態列、電腦版右側欄、底部個人資料、歷史事件、暫停與離開 */
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
    if (isSheetOpen()) renderSheet();
    renderSide();
  }

  // ===== 電腦版右側欄 =====
  // 與 css/game.css 的側欄斷點一致
  const SIDE_QUERY = '(min-width: 1100px)';
  function renderSide() {
    if (!window.matchMedia(SIDE_QUERY).matches) return;
    // 股票
    const value = stockValue();
    const cost = Object.values(state.holdings).reduce((s, h) => s + h.cost, 0);
    $('#side-stock').innerHTML = `
      <p class="side-sum"><span>市值 ${UI.fmtMoney(value)}</span>${cost ? `<span class="${value - cost >= 0 ? 'up' : 'down'}">未實現 ${UI.fmtSigned(value - cost)}</span>` : ''}</p>
      <ul class="side-list">${state.market.map((s) => {
        const h = state.holdings[s.id];
        const chg = s.price / s.prev - 1;
        const pnl = h ? h.shares * s.price - h.cost : 0;
        return `
          <li class="side-stock">
            <span class="ss-name">${UI.escape(s.name)}</span>
            <span class="ss-price">${s.price.toFixed(2)}<small class="${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '▲' : '▼'}${UI.fmtPct(chg)}</small></span>
            ${h ? `<span class="ss-hold">${h.shares.toLocaleString('zh-TW')} 股・均價 ${(h.cost / h.shares).toFixed(2)}</span>
            <span class="ss-pnl ${pnl >= 0 ? 'up' : 'down'}">${UI.fmtSigned(pnl)}（${UI.fmtPct(pnl / h.cost)}）</span>` : ''}
          </li>`;
      }).join('')}</ul>`;
    // 保險
    const active = state.policies.filter((p) => p.status === 'active');
    const premium = Ins.monthlyPremium();
    $('#side-policy').innerHTML = `
      <p class="side-sum"><span>每月保費 ${UI.fmtMoney(premium)}</span><span class="${premium > job.salary * D.insurance.budgetRate ? 'neg' : ''}">月薪的 ${Math.round((premium / job.salary) * 100)}%</span></p>
      ${active.length ? `<ul class="side-list">${active.map((p) => `
        <li class="side-policy"><span>${Insurance.PRODUCTS[p.id].icon} ${UI.escape(p.name)}</span><span class="sp-status">${UI.escape(Ins.statusText(p))}</span></li>`).join('')}</ul>`
        : '<p class="empty">目前沒有有效保單</p>'}`;
    // 最近事件
    const recent = state.history.slice(-8).reverse();
    $('#side-history').innerHTML = recent.length
      ? recent.map((h) => `<li><span aria-hidden="true">${h.icon}</span><span>${UI.escape(h.text)}</span><span class="e-meta">第 ${h.turn} 回合・${h.age} 歲</span></li>`).join('')
      : '<li class="empty">目前沒有事件</li>';
  }
  window.matchMedia(SIDE_QUERY).addEventListener('change', () => { renderSide(); G.refit(); });
  // 側欄的「交易／管理／全部」沿用右上角按鈕開啟完整視窗
  document.querySelectorAll('[data-side-open]').forEach((btn) => {
    btn.addEventListener('click', () => document.getElementById(btn.dataset.sideOpen).click());
  });

  // ===== 底部個人資料面板 =====
  const sheet = $('#sheet');
  const scrim = $('#sheet-scrim');
  const btnSheet = $('#btn-sheet');
  const isSheetOpen = () => sheet.classList.contains('open');

  function setSheet(open) {
    sheet.classList.toggle('open', open);
    sheet.inert = !open;
    scrim.hidden = !open;
    btnSheet.setAttribute('aria-expanded', String(open));
    if (open) { renderSheet(); $('#btn-sheet-close').focus(); } else { btnSheet.focus(); }
  }
  btnSheet.addEventListener('click', () => setSheet(!isSheetOpen()));
  $('#btn-sheet-close').addEventListener('click', () => setSheet(false));
  scrim.addEventListener('click', () => setSheet(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isSheetOpen() && !document.querySelector('dialog[open]')) setSheet(false);
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
      ${G.policyTable()}`;
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
  $('#btn-history').addEventListener('click', () => { renderHistory(); $('#dlg-history').showModal(); });
  // 點市場跑馬燈：直接看市場波動紀錄
  $('#market-ticker').addEventListener('click', () => {
    historyFilter = 'market';
    document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === 'market')));
    renderHistory();
    $('#dlg-history').showModal();
  });

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

  Object.assign(G, { perkText, renderStatus, renderSide, renderSheet, isSheetOpen, renderHistory });
})(window.Game);
