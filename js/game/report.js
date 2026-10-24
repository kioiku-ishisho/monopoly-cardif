/* 遊戲主頁：人生階段報告、遊戲結束與結算紀錄 */
(function (G) {
  if (!G) return;
  const { setup, job, state, stats, Ins, stage, ageInt, priceIndex, salaryNow, expenseNow,
    monthlyNet, stockValue, netWorth, logDecision } = G;

  // ===== 人生階段報告：每個階段結束與遊戲結束時，列出保險、資產配置與目前狀況 =====
  // 階段開始時的數據，報告用來算「這個階段」的變化；存在 G.stageStats
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

  const ASSET_COLORS = ['#2f9e44', '#e67700', '#7048e8', '#c2255c', '#0c8599', '#1c7ed6'];

  function stageReportHtml() {
    const b = G.stageStats;
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
      title: `📋 ${s.name}階段報告（${G.stageStats.startAge}–${ageInt()} 歲）`,
      body: `<div class="stage-report">${stageReportHtml()}</div>`,
      actions: [{ label: final ? '下一步' : '繼續人生', value: 'ok', variant: 'primary' }],
      dismissible: false,
      className: 'modal-wide',
    });
    logDecision(`${s.name}階段結束（${ageInt()} 歲）：淨資產 ${UI.fmtMoney(netWorth())}、健康 ${state.health}、幸福 ${state.happiness}、每月保費 ${UI.fmtMoney(Ins.monthlyPremium())}`, 'milestone');
  }

  // ===== 遊戲結束 =====
  const END_TEXT = {
    bankrupt: { title: '破產了…', icon: '💸', msg: (a) => `你在 ${a} 歲時現金歸零，宣告破產。` },
    death: { title: '健康指數歸零', icon: '🕯️', msg: (a) => `你在 ${a} 歲時健康耗盡，人生畫下句點。` },
    unhappy: { title: '幸福指數歸零', icon: '🌧️', msg: (a) => `你在 ${a} 歲時失去了生活的動力，人生停在這裡。` },
    maxAge: { title: '壽終正寢', icon: '🎉', msg: (a) => `你平安活到 ${a} 歲，走完了精彩的一生！` },
  };

  async function endGame(reason) {
    state.over = true;
    G.setDiceEnabled(false);
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
      marketEvents: state.story.seen.map((id) => G.STORY[id].title),
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

  Object.assign(G, { newStageStats, showStageReport, endGame });
})(window.Game);
