/* 遊戲主頁：人生階段報告、遊戲結束與結算紀錄 */
(function (G) {
  if (!G) return;
  const { D, E, setup, job, state, stats, Ins, stage, ageInt, priceIndex, salaryNow, expenseNow,
    monthlyNet, stockValue, netWorth, logDecision } = G;

  // ===== 人生階段報告：每個階段結束與遊戲結束時，依 js/review.js 的模板產生結算、檢討與理專建議 =====
  // 階段開始時的數據，報告用來算「這個階段」的變化；存在 G.stageStats
  const newStageStats = () => ({
    startAge: ageInt(),
    startNetWorth: netWorth(),
    startCash: state.cash,
    startStock: stockValue(),
    startHealth: state.health,
    startHappiness: state.happiness,
    startPremium: Ins.monthlyPremium(),
    claims: stats.claims,
    claimTotal: stats.claimTotal,
    medicalCost: stats.medicalCost,
    quizAsked: stats.quizAsked,
    quizCorrect: stats.quizCorrect,
    trades: stats.trades,
    forcedSales: stats.forcedSales,
    biggestLoss: null,
  });

  // 給 StageReview 模板與 AI 理專的快照
  function snapshot(s) {
    const b = G.stageStats;
    const next = D.stages[D.stages.indexOf(s) + 1];
    const premium = Ins.monthlyPremium();
    const expense = expenseNow();
    // 退休後收入估計：工作中以目前月薪 × 退休金倍率，已退休就用實際收入
    const pension = Math.round(s.id === 'elder' ? monthlyNet() + expense + premium : salaryNow() * E.incomeRate.elder);
    const retireGap = expense + premium - pension;
    return {
      stageId: s.id,
      stageName: s.name,
      nextStageName: next ? next.name : '',
      startAge: b.startAge,
      endAge: ageInt(),
      jobName: job.name,
      salary: salaryNow(),
      expense,
      cash: Math.round(state.cash),
      stock: Math.round(stockValue()),
      policyValue: Math.round(Ins.value()),
      netWorth: Math.round(netWorth()),
      startNetWorth: Math.round(b.startNetWorth),
      health: state.health,
      startHealth: b.startHealth,
      happiness: state.happiness,
      startHappiness: b.startHappiness,
      premium,
      premiumRatio: premium / salaryNow(),
      fund: state.cash / expense,
      net: monthlyNet(),
      held: state.market.filter((m) => state.holdings[m.id]?.shares).length,
      trades: stats.trades - b.trades,
      forcedSales: stats.forcedSales - b.forcedSales,
      policies: Ins.summary(),
      cover: StageReview.coverOf(Ins.summary()),
      history: state.medicalHistory.map((t) => Insurance.TAG_NAME[t]),
      ltc: !!state.ltc,
      pension,
      retireGap,
      retireNeed: Math.max(0, retireGap) * 12 * 20,
    };
  }

  const LEVEL_ICON = { good: '✅', warn: '⚠️', bad: '❌' };
  const LEVEL_TEXT = { good: '達成', warn: '待加強', bad: '未達成' };

  const ASSET_COLORS = ['#2f9e44', '#e67700', '#7048e8', '#c2255c', '#0c8599', '#1c7ed6'];

  // 一、階段結算：成績單、保險、資產配置與目前狀況
  function settlementHtml(snap) {
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
    const worthDiff = netWorth() - b.startNetWorth;
    const rows = [
      ['淨資產', b.startNetWorth, snap.netWorth, true],
      ['現金', b.startCash, snap.cash, true],
      ['投資市值', b.startStock, snap.stock, true],
      ['每月保費', b.startPremium, premium, true],
      ['健康指數', b.startHealth, snap.health, false],
      ['幸福指數', b.startHappiness, snap.happiness, false],
    ];
    const fmt = (v, isMoney) => (isMoney ? UI.fmtMoney(v) : v);
    const diff = (a, z, isMoney) => (isMoney ? UI.fmtSigned(z - a) : `${z - a >= 0 ? '+' : ''}${z - a}`);
    return `
      <h3 class="report-h">📊 階段成績單</h3>
      <div class="table-wrap"><table class="data-table outcome-table">
        <thead><tr><th scope="col">項目</th><th scope="col">${b.startAge} 歲</th><th scope="col">${snap.endAge} 歲</th><th scope="col">變化</th></tr></thead>
        <tbody>${rows.map(([name, a, z, isMoney]) => `<tr><th scope="row">${name}</th><td>${fmt(a, isMoney)}</td><td>${fmt(z, isMoney)}</td>
          <td class="${z - a === 0 ? '' : (z - a > 0) === (name !== '每月保費') ? 'pos' : 'neg'}">${diff(a, z, isMoney)}</td></tr>`).join('')}</tbody>
      </table></div>

      <h3 class="report-h">🛡️ 保險</h3>
      ${policies.length ? `
        <div class="table-wrap table-stack"><table class="data-table report-table">
          <thead><tr><th scope="col">險種</th><th scope="col">投保</th><th scope="col">月繳</th><th scope="col">狀態</th><th scope="col">已繳</th><th scope="col">已理賠</th></tr></thead>
          <tbody>${policies.map((p) => `<tr><td>${UI.escape(p.name)}${p.legacy ? '<small>（舊保單）</small>' : ''}</td><td data-label="投保">${p.entryAge} 歲</td>
            <td data-label="月繳">${p.monthly ? UI.fmtMoney(p.monthly) : '—'}</td><td data-label="狀態">${UI.escape(p.status)}</td><td data-label="已繳">${UI.fmtMoney(p.paid)}</td><td data-label="已理賠">${UI.fmtMoney(p.claimed)}</td></tr>`).join('')}</tbody>
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
      </dl>`;
  }

  // 二、階段檢討：模板的檢核項目與等第
  function reviewHtml(review) {
    const b = G.stageStats;
    const claimed = stats.claimTotal - b.claimTotal;
    const medical = stats.medicalCost - b.medicalCost;
    const asked = stats.quizAsked - b.quizAsked;
    const correct = stats.quizCorrect - b.quizCorrect;
    return `
      <div class="review-grade" data-grade="${review.grade}">
        <strong aria-label="等第 ${review.grade}">${review.grade}</strong>
        <p>達成 ${review.passed} / ${review.checks.length} 項目標。${UI.escape(review.gradeText)}</p>
      </div>
      <p class="report-sub">${UI.escape(review.goal)}</p>

      <h3 class="report-h">✅ 檢核項目</h3>
      <ul class="review-checks">${review.checks.map((c) => `
        <li data-level="${c.level}"><span class="review-icon" aria-hidden="true">${LEVEL_ICON[c.level]}</span>
          <div><strong>${UI.escape(c.label)}</strong><span class="sr-only">：${LEVEL_TEXT[c.level]}</span><p>${UI.escape(c.text)}</p></div></li>`).join('')}
      </ul>

      <h3 class="report-h">📝 這個階段的回顧</h3>
      <ul class="report-list">
        <li>保險理賠 ${stats.claims - b.claims} 次，共 ${UI.fmtMoney(claimed)}${medical ? `；醫療支出 ${UI.fmtMoney(medical)}，保險負擔了 ${Math.round(Math.min(1, claimed / medical) * 100)}%` : ''}</li>
        <li>${b.biggestLoss ? `最大一筆支出：${UI.escape(b.biggestLoss.reason)}（${UI.fmtMoney(b.biggestLoss.amount)}）` : '沒有大筆的意外支出'}</li>
        <li>股票交易 ${stats.trades - b.trades} 筆${stats.forcedSales - b.forcedSales ? `，被迫賣股 ${stats.forcedSales - b.forcedSales} 次` : ''}</li>
        <li>${asked ? `保險知識題答對 ${correct} / ${asked} 題` : '這個階段沒有遇到保險知識題'}</li>
      </ul>`;
  }

  // 三、理專建議與問答
  function advisorHtml(snap, review) {
    return `
      <div class="advisor-intro"><span aria-hidden="true">💼</span>
        <p>我是你的理財專員。看完你${snap.stageName}階段的結算，給你幾個建議：</p></div>
      ${review.advice.length
        ? `<ol class="advisor-advice">${review.advice.map((a) => `<li data-level="${a.level}"><strong>${UI.escape(a.label)}</strong><p>${UI.escape(a.text)}</p></li>`).join('')}</ol>`
        : '<p class="empty">這個階段每一項都達標，做得很好！</p>'}
      ${review.next.length ? `
        <h3 class="report-h">🧭 進入${snap.nextStageName}的重點</h3>
        <ul class="report-list">${review.next.map((t) => `<li>${UI.escape(t)}</li>`).join('')}</ul>` : ''}

      <h3 class="report-h">💬 問問理專</h3>
      <ol class="chat-log advisor-log" aria-live="polite"></ol>
      <div class="chat-suggest">${StageReview.FAQ.map((f) => `<button class="btn btn-sm btn-ghost" type="button" data-faq>${UI.escape(f.q)}</button>`).join('')}</div>
      <div class="chat-form">
        <label class="sr-only" for="advisor-input">問理專</label>
        <input id="advisor-input" type="text" maxlength="200" autocomplete="off" placeholder="例如：我該先存錢還是先投資？">
        <button class="btn btn-primary" type="button" data-send>送出</button>
      </div>
      <p class="chat-meta"></p>`;
  }

  // 給 AI 理專的資料：快照 + 模板檢核結果
  function advisorContext(snap, review) {
    return {
      ...snap,
      policies: snap.policies.map((p) => ({ name: p.name, status: p.status, monthly: p.monthly })),
      holdings: state.market.filter((m) => state.holdings[m.id]?.shares).map((m) => ({ name: m.name, value: Math.round(state.holdings[m.id].shares * m.price) })),
      grade: review.grade,
      checks: review.checks.map((c) => ({ label: c.label, level: c.level, text: c.text })),
    };
  }

  const ADVISOR_MAX_QUESTIONS = 6;

  // 理專問答：連得上伺服器時問 AI 理專，否則（或失敗時）常見問題改用模板回答
  function bindAdvisor(root, snap, review) {
    const log = root.querySelector('.advisor-log');
    const input = root.querySelector('#advisor-input');
    const sendBtn = root.querySelector('[data-send]');
    const meta = root.querySelector('.chat-meta');
    const history = [];
    let asked = 0;
    let busy = false;

    const updateMeta = () => {
      const left = ADVISOR_MAX_QUESTIONS - asked;
      meta.textContent = left > 0 ? `還可以問 ${left} 個問題${state.gameId ? '' : '（離線中，只能回答常見問題）'}` : '理專還有其他客戶，下個階段再聊。';
      input.disabled = sendBtn.disabled = busy || left <= 0;
      root.querySelectorAll('[data-faq]').forEach((btn) => { btn.disabled = busy || left <= 0; });
    };
    const addLine = (role, html) => {
      const li = document.createElement('li');
      li.className = `chat-msg ${role}`;
      li.innerHTML = html;
      log.append(li);
      li.scrollIntoView({ block: 'nearest' });
      return li;
    };
    const localAnswer = (text) => {
      const f = StageReview.FAQ.find((x) => x.q === text);
      return f ? f.a(snap, review) : null;
    };

    async function ask(text) {
      if (busy || asked >= ADVISOR_MAX_QUESTIONS) return;
      busy = true;
      asked++;
      addLine('user', UI.escape(text));
      const typing = addLine('agent typing', '<span class="dots" aria-label="理專輸入中">…</span>');
      updateMeta();
      let reply = null;
      if (state.gameId) {
        history.push({ role: 'user', content: text });
        try {
          reply = (await API.advisor(state.gameId, advisorContext(snap, review), history)).reply;
          history.push({ role: 'assistant', content: reply });
        } catch (e) {
          console.warn('AI 理專無法回覆，改用常見問題的回答', e);
          history.pop();
        }
      }
      if (reply == null) reply = localAnswer(text);
      typing.remove();
      if (reply == null) {
        asked--;
        addLine('agent error', '理專暫時無法回覆這個問題，可以點上方的常見問題。');
      } else {
        addLine('agent', UI.escape(reply).replace(/\n/g, '<br>'));
        logDecision(`${snap.stageName}階段結束時詢問理專：「${text}」`, 'advisor-ask');
      }
      busy = false;
      updateMeta();
    }

    const sendInput = () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      ask(text).then(() => input.focus());
    };
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn?.matches('[data-faq]')) ask(btn.textContent);
      else if (btn?.matches('[data-send]')) sendInput();
    });
    // 輸入框在彈窗的 form 裡，Enter 會送出整個彈窗，改成送出問題
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      sendInput();
    });
    addLine('agent', `${UI.escape(snap.jobName)}你好！你的${UI.escape(snap.stageName)}階段評為 ${review.grade} 級。對結算或下一步的規劃有任何問題，都可以問我。`);
    updateMeta();
  }

  // 分頁：結算／檢討／理專（遊戲結束時沒有理專分頁）
  function bindTabs(root) {
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    const select = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        root.querySelector('#' + t.getAttribute('aria-controls')).hidden = !on;
      });
      tab.focus();
    };
    root.addEventListener('click', (e) => {
      const tab = e.target.closest('[role="tab"]');
      if (tab) select(tab);
    });
    root.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (step) { e.preventDefault(); select(tabs[(i + step + tabs.length) % tabs.length]); }
    });
  }

  async function showStageReport(s, final = false) {
    const snap = snapshot(s);
    const review = StageReview.build(snap);
    const panes = [
      { id: 'settle', label: '📊 結算', html: settlementHtml(snap) },
      { id: 'review', label: `📝 檢討（${review.grade}）`, html: reviewHtml(review) },
      ...(final ? [] : [{ id: 'advisor', label: '💼 理專建議', html: advisorHtml(snap, review) }]),
    ];
    const root = document.createElement('div');
    root.className = 'stage-report';
    root.innerHTML = `
      <div class="report-tabs" role="tablist" aria-label="階段報告">${panes.map((p, i) => `
        <button class="report-tab" type="button" role="tab" id="rt-${p.id}" aria-controls="rp-${p.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${p.label}</button>`).join('')}
      </div>
      ${panes.map((p, i) => `<section class="report-pane" role="tabpanel" id="rp-${p.id}" aria-labelledby="rt-${p.id}" ${i === 0 ? '' : 'hidden'}>${p.html}</section>`).join('')}`;
    bindTabs(root);
    if (!final) bindAdvisor(root, snap, review);
    await UI.modal({
      title: `📋 ${s.name}階段結算與檢討（${snap.startAge}–${snap.endAge} 歲）`,
      body: root,
      actions: [{ label: final ? '下一步' : '繼續人生', value: 'ok', variant: 'primary' }],
      dismissible: false,
      className: 'modal-wide',
    });
    logDecision(`${s.name}階段結束（${ageInt()} 歲）：評為 ${review.grade} 級（達成 ${review.passed}/${review.checks.length}），淨資產 ${UI.fmtMoney(netWorth())}、健康 ${state.health}、幸福 ${state.happiness}、每月保費 ${UI.fmtMoney(Ins.monthlyPremium())}`, 'milestone');
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
