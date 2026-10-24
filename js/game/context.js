/* 遊戲主頁：給 js/events.js 使用的事件 context（G.ctx） */
(function (G) {
  if (!G) return;
  const { E, job, state, stats, Ins, clamp, stage, ageInt, priceIndex, salaryNow, expenseNow, inflate,
    addHistory, logDecision, announce } = G;

  G.ctx = {
    state,
    addCash(n, reason) {
      state.cash = Math.round(state.cash + n);
      addHistory('life', n >= 0 ? '💰' : '💸', `${reason}（${UI.fmtSigned(n)}）`);
      G.renderStatus();
    },
    addHealth(n, reason) {
      state.health = clamp(Math.round(state.health + n), 0, 100);
      addHistory('life', n >= 0 ? '💚' : '🤒', `${reason}（健康 ${n >= 0 ? '+' : ''}${n}）`);
      G.renderStatus();
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
      const ss = G.stageStats;
      if (cash < 0 && (!ss.biggestLoss || cash < ss.biggestLoss.amount)) ss.biggestLoss = { amount: cash, reason };
      addHistory('life', icon, parts.length ? `${reason}（${parts.join('、')}）` : reason);
      G.renderStatus();
    },
    addNetIncome(n, reason) {
      state.netIncomeAdj = Math.round(state.netIncomeAdj + n);
      addHistory('life', n >= 0 ? '📈' : '📉', `${reason}（淨收入 ${UI.fmtSigned(n)}/月）`);
      G.renderStatus();
    },
    insurance: Ins,
    openProposal: (id) => G.openProposal(id),
    showMyPolicies: () => G.showMyPolicies(),
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
    renderStatus: () => G.renderStatus(),
    addHistory,
    // 依目前物價調整事件牌的金額
    inflate: (card) => ({ ...card, cash: inflate(card.cash), netIncome: inflate(card.netIncome) }),
    inflateAmount: inflate,
    priceIndex,
    salaryNow,
    expenseNow,
    // 擲一次骰子（住院天數等），回傳 1–6
    rollDice: () => G.rollDice(),
    // 貴人相助：往前走 n 格（照常過月份），再執行停留格的事件
    async moveForward(n) {
      for (let i = 0; i < n; i++) await G.stepOnce(G.stepDelay());
      G.ensureTokenVisible();
      announce(`前進 ${n} 格，來到「${G.currentTile().name}」`);
      await G.runTile(G.currentTile());
    },
  };
})(window.Game);
