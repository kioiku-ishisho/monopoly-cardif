/*
 * 遊戲主頁共用核心：狀態、統計、收支計算、歷史事件紀錄
 *
 * 遊戲頁拆成數個模組（js/game/*.js），共用 window.Game（各檔案內稱為 G）。
 * 載入順序見 game.html：core → map → panels → policies → market → context → report → turn → js/game.js（開局）。
 * 跨模組呼叫一律在執行當下寫成 G.xxx()，所以函式定義在哪個檔案、先後載入都不影響。
 */
(function () {
  const D = GameData;
  const E = D.economy;
  const $ = (s) => document.querySelector(s);

  const setup = Store.session.get('newGame');
  if (!setup) { location.replace('index.html'); return; } // 沒有 window.Game，其他模組會直接略過
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
    seminarUsed: [], // 本局讀過的理財講座文章 id
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
    if ($('#dlg-history').open) G.renderHistory();
    G.renderSide();
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

  const G = {
    D, E, $, setup, job, state, stats, Ins,
    clamp, stage, age, ageInt, monthsPassed, priceIndex, salaryNow, expenseNow, inflate,
    monthlyIncome, monthlyCashflow, monthlyNet, stockValue, netWorth, stageIndexForLap,
    addHistory, logDecision, announce,
    stageStats: null, // 目前人生階段的起始數據（js/game/report.js）
  };
  window.Game = G;
})();
