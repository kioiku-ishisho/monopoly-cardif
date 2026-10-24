/* 遊戲靜態資料：職業、人生階段、地圖格子、股票、提示。數值皆為暫定，可直接調整。 */
(function () {
  const jobs = [
    { id: 'engineer', name: '軟體工程師', icon: '👩‍💻', color: '#4c6ef5', salary: 58000, expense: 32000, desc: '收入高、工時長，要多留意健康。' },
    { id: 'teacher', name: '國小老師', icon: '👨‍🏫', color: '#2b8a3e', salary: 46000, expense: 28000, desc: '收入穩定，退休制度完善。' },
    { id: 'nurse', name: '護理師', icon: '👩‍⚕️', color: '#c2255c', salary: 50000, expense: 29000, desc: '輪班辛苦，健康管理很重要。' },
    { id: 'sales', name: '業務專員', icon: '🧑‍💼', color: '#e67700', salary: 42000, expense: 30000, desc: '底薪普通，獎金變動大。' },
    { id: 'chef', name: '廚師', icon: '👨‍🍳', color: '#d9480f', salary: 38000, expense: 26000, desc: '靠手藝吃飯，未來有機會創業。' },
    { id: 'designer', name: '平面設計師', icon: '🧑‍🎨', color: '#7048e8', salary: 40000, expense: 27000, desc: '接案收入不固定，需要預備金。' },
    { id: 'civil', name: '公務員', icon: '🧑‍💼', color: '#1971c2', salary: 45000, expense: 27000, desc: '鐵飯碗，收入成長慢但穩定。' },
    { id: 'farmer', name: '農夫', icon: '🧑‍🌾', color: '#5c940d', salary: 35000, expense: 22000, desc: '看天吃飯，生活開銷較低。' },
    { id: 'courier', name: '外送員', icon: '🛵', color: '#0c8599', salary: 36000, expense: 25000, desc: '時間彈性，但缺乏保障。' },
    { id: 'doctor', name: '醫師', icon: '🧑‍⚕️', color: '#087f5b', salary: 120000, expense: 60000, desc: '高收入也高壓力，生活開銷高。' },
  ];

  // 一圈 = 60 格 = 5 年，因此一格 = 1 個月
  const economy = {
    tilesPerLap: 60,
    yearsPerLap: 5,
    monthsPerStep: 1,
    startAge: 25,
    startCashMonths: 3, // 起始現金 = 月薪 × 3
    maxAge: 100, // 到達此年齡時遊戲以「壽終正寢」結束
    // 各階段收入倍率（老年為退休金）
    incomeRate: { youth: 1, middle: 1.3, elder: 0.4 },
    // 每過一圈健康自然下降
    healthDecayPerLap: { youth: 0, middle: 4, elder: 10 },
  };

  // laps：此階段持續幾圈（老年無上限）
  const stages = [
    { id: 'youth', name: '青年', ageFrom: 25, ageTo: 40, laps: 3 },
    { id: 'middle', name: '中年', ageFrom: 40, ageTo: 65, laps: 5 },
    { id: 'elder', name: '老年', ageFrom: 65, ageTo: null, laps: Infinity },
  ];

  // group：地圖上的顏色分組；special 為 7 種特殊格（各 1 格，js/events.js 依 type 執行）
  const tileTypes = {
    start: { name: '起點', icon: '🏁' },
    chance: { name: '機會', icon: '❓' }, // 抽機會牌，可選擇接受或放棄
    fate: { name: '命運', icon: '🎴' }, // 抽命運牌，抽到即發生
    insurance: { name: '保險業務員', icon: '🛡️' }, // 業務員隨機介紹 3 種險種
    hospital: { name: '住院', icon: '🏥' }, // 擲骰決定住院天數，暫停移動 1 回合
    rest: { name: '休息', icon: '☕' }, // 什麼事都沒發生
    checkup: { name: '保單健檢', icon: '🩺', group: 'special' },
    seminar: { name: '理財講座', icon: '🎓', group: 'special' },
    myth: { name: '觀念挑戰', icon: '🧐', group: 'special' },
    mentor: { name: '貴人相助', icon: '🤝', group: 'special' },
    promo: { name: '保險優惠', icon: '🏷️', group: 'special' },
    attic: { name: '保單整理日', icon: '🗂️', group: 'special' },
    missed: { name: '錯過優惠', icon: '⌛', group: 'special' },
  };
  const SPECIAL_TYPES = Object.keys(tileTypes).filter((t) => tileTypes[t].group === 'special');

  // 一圈 60 格，三個人生階段共用；休息含 3 個角落，special 依 SPECIAL_TYPES 順序各放 1 格
  const boardCounts = { start: 1, special: SPECIAL_TYPES.length, insurance: 5, hospital: 2, chance: 20, fate: 17, rest: 8 };

  // 角落為第 0、15、30、45 格：起點 + 3 個休息角落；其餘格子依比例平均分散排列
  function layoutBoard(counts, tiles = economy.tilesPerLap) {
    const side = tiles / 4;
    const board = new Array(tiles);
    board[0] = 'start';
    for (let i = side; i < tiles; i += side) board[i] = 'rest';
    const remaining = Object.fromEntries(Object.entries(counts).filter(([t]) => t !== 'start'));
    remaining.rest -= 3;
    const slots = tiles - 4;
    const used = Object.fromEntries(Object.keys(remaining).map((t) => [t, 0]));
    const specials = [...SPECIAL_TYPES];
    let k = 0;
    for (let i = 0; i < tiles; i++) {
      if (board[i]) continue;
      k++;
      // 選出目前「落後目標進度」最多的類型
      let best = null;
      let bestLag = -Infinity;
      for (const t of Object.keys(remaining)) {
        if (used[t] >= remaining[t]) continue;
        const lag = (remaining[t] * k) / slots - used[t];
        if (lag > bestLag) { bestLag = lag; best = t; }
      }
      board[i] = best === 'special' ? specials.shift() : best;
      used[best]++;
    }
    return board;
  }

  const board = layoutBoard(boardCounts);

  // 住院格：天數 = 骰子點數 × daysPerPip，醫療費 = 天數 × costPerDay；之後暫停移動 skipTurns 回合
  const hospital = { daysPerPip: 2, costPerDay: 1000, skipTurns: 1 };

  // 特殊格數值（js/events.js）
  //   保險優惠類以 state.policyPerks 記錄，下一次投保時結算（js/insurance.js 的 buy）
  const specialTiles = {
    quizSeconds: 20, // 答題限時
    checkup: { cash: 3000, coupon: { rate: 0.1, cap: 1000 } }, // 答對二選一：現金或保費優惠
    seminar: { cash: 2000 },
    myth: { win: 2000, lose: -2000 },
    mentor: { steps: 3 },
    promo: { rate: 0.2, cap: 2000 }, // 下一次投保首年保費折抵 20%，上限 2,000
    attic: { cash: 5000 }, // 暫定：初始保單池完成前先給現金（改版計畫 P2）
    missed: { surcharge: 1000 }, // 下一次投保額外支付
  };

  // 保險：九種險種（js/insurance.js 負責投保、扣款與理賠）
  // 金額以「每月」計、時間以「月」計，遊戲中再依 economy.monthsPerStep 換算成格數
  //   premium：各投保年齡的月繳，其餘年齡線性內插
  //   pricing：level = 投保時鎖定、natural = 每圈依年齡重算、job = 依職業、amount = 玩家自選月繳
  //   covers：會理賠的事件標籤（見 cardTags）；excludeHistory：有這些病史不可投保
  //   surcharges：健康低於 below 時保費加 rate（由上而下取第一個符合的）
  const insurance = {
    budgetRate: 0.1, // 雙十原則：保費總額約為月薪 10%
    graceMonths: 1, // 現金不足繳保費時的寬限期，之後仍繳不出就停效
    offerCount: 3, // 每次在保險格展示幾種險種
    ltc: { health: 30, careCost: 30000 }, // 健康 ≤ 30 進入長照狀態，之後每月多 3 萬照護費
    products: [
      {
        id: 'life', name: '定期壽險', icon: '🕊️', pricing: 'level', premium: { 25: 600, 40: 1300, 55: 3000 },
        maxEntryAge: 60, payUntilAge: 65, coverUntilAge: 65, waitMonths: 0, minHealth: 30,
        surcharges: [{ below: 50, rate: 0.6 }, { below: 70, rate: 0.3 }],
        benefit: { death: 3000000 },
        summary: '身故給付 300 萬，留給家人',
        note: '保障到 65 歲，沒有解約金。定期壽險便宜，是因為沒有儲蓄。',
      },
      {
        id: 'accident', name: '意外險', icon: '🦺', pricing: 'job', jobPremium: { default: 300, chef: 450, farmer: 450, courier: 600 },
        maxEntryAge: 75, coverUntilAge: 80, waitMonths: 0, minHealth: 0, surcharges: [],
        covers: ['accident'], benefit: { medicalMax: 30000, death: 3000000 },
        summary: '意外醫療每次最多 3 萬，意外身故 300 萬',
        note: '只理賠意外，生病不理賠；保費看職業不看年齡，每圈自動續約。',
      },
      {
        id: 'medical', name: '醫療險', icon: '🏥', pricing: 'natural', premium: { 25: 800, 40: 1300, 55: 2400, 65: 3800 },
        maxEntryAge: 65, coverUntilAge: 85, waitMonths: 1, minHealth: 40,
        covers: ['accident', 'hospital', 'cancer', 'heart', 'stroke', 'esrd'], benefit: { rate: 0.8, max: 150000 },
        summary: '實支實付：醫藥費理賠 80%，每次最多 15 萬',
        note: '一年期自然費率，每圈依年齡調整保費；投保前已有的病史不理賠，意外住院不用等待期。',
      },
      {
        id: 'major', name: '重大傷病險', icon: '🎗️', pricing: 'level', premium: { 25: 700, 40: 1200, 55: 2300 },
        maxEntryAge: 60, payMonths: 240, coverUntilAge: Infinity, waitMonths: 3, minHealth: 50,
        excludeHistory: ['cancer', 'heart', 'stroke', 'esrd'], covers: ['cancer', 'heart', 'stroke', 'esrd'],
        benefit: { lumpSum: 1000000 },
        summary: '取得重大傷病卡一次給付 100 萬',
        note: '範圍最廣，含癌症、心肌梗塞、腦中風、洗腎；理賠一次後保單結束。',
      },
      {
        id: 'specific', name: '特定傷病險', icon: '🫀', pricing: 'level', premium: { 25: 500, 40: 900, 55: 1800 },
        maxEntryAge: 60, payMonths: 240, coverUntilAge: 85, waitMonths: 3, minHealth: 50,
        excludeHistory: ['heart', 'stroke', 'esrd'], covers: ['heart', 'stroke', 'esrd'],
        benefit: { lumpSum: 1000000 },
        summary: '心肌梗塞、腦中風、末期腎病各給付 100 萬',
        note: '比重大傷病險便宜，但不含癌症；三種都理賠過後保單結束。',
      },
      {
        id: 'cancer', name: '癌症險', icon: '🔬', pricing: 'level', premium: { 25: 400, 40: 800, 55: 1700 },
        maxEntryAge: 60, payMonths: 240, coverUntilAge: Infinity, waitMonths: 3, minHealth: 40,
        excludeHistory: ['cancer'], covers: ['cancer'], refundInWait: true,
        benefit: { lumpSum: 500000, monthly: 10000, months: 12 },
        summary: '確診給付 50 萬，之後每月 1 萬治療金，共 12 個月',
        note: '只理賠癌症，可和重大傷病險同時理賠；等待期內確診會退還保費並終止保單。',
      },
      {
        id: 'ltc', name: '長照險', icon: '🧓', pricing: 'level', premium: { 25: 900, 40: 1500, 55: 3000 },
        maxEntryAge: 60, payMonths: 240, coverUntilAge: Infinity, waitMonths: 3, minHealth: 50,
        excludeHistory: ['ltc', 'stroke'], covers: ['ltc'],
        benefit: { lumpSum: 300000, monthly: 30000, delayMonths: 3 },
        summary: '進入長照給付 30 萬，之後每月 3 萬',
        note: '健康 ≤ 30 即進入長照狀態，每月多 3 萬照護費；持續 3 個月後開始給付，並免繳保費。',
      },
      {
        id: 'invest', name: '投資型保險', icon: '📈', pricing: 'amount', amounts: [3000, 5000, 10000],
        maxEntryAge: 60, coverUntilAge: 85, waitMonths: 0, minHealth: 30, surcharges: [],
        fund: 'ETF50', costPerLap: { 25: 1500, 40: 4000, 55: 12000 }, // 每圈從帳戶扣的保險成本
        fee: { months: 60, early: 0.25, later: 0.03 }, surrenderPenalty: { months: 60, rate: 0.1 },
        benefit: { death: 1000000 },
        summary: '身故給付 100 萬與帳戶價值取高',
        note: '保費扣除費用後買進台灣50 ETF：前 5 年扣 25%，之後扣 3%。可隨時停繳或解約，前 5 年解約再扣帳戶 10%。',
      },
      {
        id: 'annuity', name: '年金險', icon: '🏦', pricing: 'amount', amounts: [3000, 5000, 10000],
        maxEntryAge: 60, payUntilAge: 65, coverUntilAge: Infinity, waitMonths: 0, minHealth: 0, surcharges: [],
        rate: 0.02, payoutAge: 65, guaranteeMonths: 240, surrenderByYear: [0.06, 0.05, 0.04, 0.03, 0.02, 0.01],
        summary: '年利率 2% 累積，65 歲起每月領年金（保證領 20 年）',
        note: '不用核保；65 歲前身故退還帳戶價值，前 6 年解約扣 6%～1%。',
      },
    ],
  };

  // 命運牌的疾病標籤，保險依標籤判斷是否理賠
  //   accident 意外、hospital 一般住院、cancer 癌症、heart 心肌梗塞、stroke 腦中風、esrd 末期腎病
  //   （長照與身故由健康值判斷，不需要標籤）
  const cardTags = {
    accident: [
      'Y5-02', 'Y5-06', 'Y5-21', 'Y5-26', 'Y5-35', 'Y5-41', 'Y5-45', 'M5-11', 'M5-27', 'M5-43',
      'O1-15', 'O1-32', 'O5-01', 'O5-07', 'O5-20', 'O5-29', 'O5-47',
    ],
    hospital: [
      'Y5-01', 'Y5-04', 'Y5-12', 'Y5-15', 'Y5-16', 'Y5-18', 'Y5-19', 'Y5-23', 'Y5-25', 'Y5-30', 'Y5-31', 'Y5-37',
      'Y5-40', 'Y5-46', 'M5-03', 'M5-04', 'M5-06', 'M5-08', 'M5-10', 'M5-13', 'M5-18', 'M5-21', 'M5-22', 'M5-24',
      'M5-25', 'M5-30', 'M5-32', 'M5-34', 'M5-39', 'M5-40', 'M5-42', 'M5-44', 'M5-45', 'O1-25', 'O5-03', 'O5-08',
      'O5-09', 'O5-11', 'O5-17', 'O5-19', 'O5-26', 'O5-30', 'O5-32', 'O5-34', 'O5-35', 'O5-38', 'O5-42',
    ],
    cancer: ['O5-36'],
    heart: ['O5-21'],
    stroke: ['O5-02'],
    esrd: ['O3-41', 'O5-13'],
  };
  const cardTagOf = Object.fromEntries(Object.entries(cardTags).flatMap(([tag, ids]) => ids.map((id) => [id, tag])));

  // 重大疾病：牌組裡的大病很少，另外每回合依年齡與健康擲一次，讓重大傷病、癌症險有理賠的機會
  //   annualRate：各年齡的每年發生率（線性內插）；健康低於 70 時，每少 10 點發生率再增加 20%
  //   stopMonths：生病期間停薪幾個月（退休後不影響退休金）
  const majorIllness = {
    annualRate: { 25: 0.004, 40: 0.01, 55: 0.025, 65: 0.04, 85: 0.08 },
    events: [
      { tag: 'cancer', weight: 5, text: '健康檢查發現癌症，需要手術與化療。', cash: -400000, health: -20, stopMonths: 6 },
      { tag: 'heart', weight: 2, text: '突發心肌梗塞，緊急送醫裝心導管支架。', cash: -300000, health: -18, stopMonths: 3 },
      { tag: 'stroke', weight: 2, text: '腦中風送醫，之後需要長期復健。', cash: -250000, health: -22, stopMonths: 6 },
      { tag: 'esrd', weight: 1, text: '腎功能惡化成末期腎病，開始定期洗腎。', cash: -100000, netIncome: -6000, health: -15, stopMonths: 3 },
    ],
  };

  // vol：年化波動度；drift：年平均漲幅；beta：對市場新聞的敏感度
  const stocks = [
    { id: 'ETF50', name: '台灣50 ETF', price: 150, vol: 0.06, drift: 0.012, beta: 1 },
    { id: 'BANK', name: '穩健金控', price: 28, vol: 0.04, drift: 0.006, beta: 0.6 },
    { id: 'TECH', name: '晶創科技', price: 600, vol: 0.14, drift: 0.015, beta: 1.6 },
    { id: 'BIO', name: '未來生技', price: 80, vol: 0.22, drift: 0.004, beta: 1.2 },
  ];

  const marketNews = [
    { text: '央行降息，資金湧入股市', effect: 0.05 },
    { text: '央行升息，市場資金緊縮', effect: -0.05 },
    { text: '全球景氣衰退疑慮升溫', effect: -0.09 },
    { text: 'AI 熱潮帶動科技股大漲', effect: 0.08 },
    { text: '地緣政治緊張，市場恐慌', effect: -0.07 },
    { text: '出口數據亮眼，經濟成長優於預期', effect: 0.04 },
  ];

  const tips = [
    { id: 'emergency', title: '緊急預備金', text: '至少存下 3～6 個月的生活費，遇到失業或意外時才不會被迫借錢。' },
    { id: 'rule72', title: '72 法則', text: '用 72 除以年報酬率，就能估算資產翻倍所需年數。例如年報酬 6%，約 12 年翻倍。' },
    { id: 'diversify', title: '分散投資', text: '不要把雞蛋放在同一個籃子裡，分散到不同標的能降低單一風險。' },
    { id: 'insurance', title: '保險是風險轉嫁', text: '保險的目的是轉嫁「付不起」的風險，例如重大疾病與意外，而不是拿來投資。' },
    { id: 'compound', title: '複利效應', text: '越早開始投資，時間越能放大報酬，小額定期投入也能累積可觀資產。' },
    { id: 'healthwealth', title: '健康就是財富', text: '醫療支出常是晚年最大開銷之一，維持健康也是一種理財。' },
    { id: 'retirement', title: '提早規劃退休', text: '退休後收入大幅減少，越早試算退休金缺口，越有時間準備。' },
    { id: 'budget', title: '50/30/20 法則', text: '收入的 50% 用於必要支出、30% 用於想要的事物、20% 用於儲蓄與投資。' },
    { id: 'dca', title: '定期定額', text: '固定時間投入固定金額，可平均買入成本，不用猜測高低點。' },
    { id: 'panic', title: '別在恐慌時賣出', text: '市場大跌時恐慌賣出，往往把帳面虧損變成真正的虧損。' },
  ];

  window.GameData = { jobs, economy, stages, tileTypes, boardCounts, board, hospital, specialTiles, insurance, cardTagOf, majorIllness, stocks, marketNews, tips };
})();
