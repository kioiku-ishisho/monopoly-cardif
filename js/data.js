/* 遊戲靜態資料：職業、人生階段、地圖格子、股票、提示。數值皆為暫定，可直接調整。 */
(function () {
  // risk：職業對事件發生機率的倍率（未列出的為 1）
  //   accident 意外、hospital 一般住院、heart 心血管（心肌梗塞、腦中風）、mental 心理壓力（降低幸福的命運牌）
  //   命運牌在伺服器端依此加權抽牌（api/games/[id]/draw.js 的 drawWeight），重大疾病在 js/game.js 套用
  const jobs = [
    { id: 'engineer', name: '軟體工程師', icon: '👩‍💻', color: '#4c6ef5', salary: 58000, expense: 32000, desc: '收入高、工時長，要多留意健康。', risk: { accident: 0.7, heart: 1.3, mental: 1.4 } },
    { id: 'teacher', name: '國小老師', icon: '👨‍🏫', color: '#2b8a3e', salary: 46000, expense: 28000, desc: '收入穩定，退休制度完善。', risk: {} },
    { id: 'nurse', name: '護理師', icon: '👩‍⚕️', color: '#c2255c', salary: 50000, expense: 29000, desc: '輪班辛苦，健康管理很重要。', risk: { hospital: 1.2, heart: 1.2, mental: 1.3 } },
    { id: 'sales', name: '業務專員', icon: '🧑‍💼', color: '#e67700', salary: 42000, expense: 30000, desc: '底薪普通，獎金變動大。', risk: { accident: 1.2, mental: 1.2 } },
    { id: 'chef', name: '廚師', icon: '👨‍🍳', color: '#d9480f', salary: 38000, expense: 26000, desc: '靠手藝吃飯，未來有機會創業。', risk: { accident: 1.5 } },
    { id: 'designer', name: '平面設計師', icon: '🧑‍🎨', color: '#7048e8', salary: 40000, expense: 27000, desc: '接案收入不固定，需要預備金。', risk: { mental: 1.1 } },
    { id: 'civil', name: '公務員', icon: '🧑‍💼', color: '#1971c2', salary: 45000, expense: 27000, desc: '鐵飯碗，收入成長慢但穩定。', risk: {} },
    { id: 'farmer', name: '農夫', icon: '🧑‍🌾', color: '#5c940d', salary: 35000, expense: 22000, desc: '看天吃飯，生活開銷較低。', risk: { accident: 1.5 } },
    { id: 'courier', name: '外送員', icon: '🛵', color: '#0c8599', salary: 36000, expense: 25000, desc: '時間彈性，但缺乏保障。', risk: { accident: 2 } },
    { id: 'doctor', name: '醫師', icon: '🧑‍⚕️', color: '#087f5b', salary: 120000, expense: 60000, desc: '高收入也高壓力，生活開銷高。', risk: { hospital: 1.2, heart: 1.2, mental: 1.3 } },
  ];

  // 一張命運牌對某職業的抽牌權重
  function fateWeight(job, card) {
    const risk = (job && job.risk) || {};
    const tag = cardTagOf[card.id];
    let w = 1;
    if (tag === 'accident') w *= risk.accident || 1;
    if (tag === 'hospital') w *= risk.hospital || 1;
    if (tag === 'heart' || tag === 'stroke') w *= risk.heart || 1;
    if (card.happiness < 0) w *= risk.mental || 1;
    return w;
  }

  // 職業事件（docs/event-cards.md 第四篇，card.job）只有該職業抽得到，抽中機率是一般牌的 jobCardWeight 倍
  const jobCardWeight = 8;

  // 一張牌對某職業的抽牌權重（機會、命運共用）；0 表示抽不到
  function drawWeight(job, card) {
    if (card.job) return job && card.job === job.id ? jobCardWeight : 0;
    return card.kind === 'fate' ? fateWeight(job, card) : 1;
  }

  // 一圈 = 60 格 = 5 年，因此一格 = 1 個月
  const economy = {
    tilesPerLap: 60,
    yearsPerLap: 5,
    monthsPerStep: 1,
    startAge: 25,
    startCashMonths: 3, // 起始現金 = 月薪 × 3
    startHappiness: 70, // 幸福指數（約等於心理健康）起始值，0–100，歸零遊戲結束
    maxAge: 100, // 到達此年齡時遊戲以「壽終正寢」結束
    // 以下數值經 scripts/simulate.mjs 調整：不做規劃約 59% 失敗、有規劃約 15% 失敗
    // 各階段收入倍率（老年為退休金）
    incomeRate: { youth: 1, middle: 1.3, elder: 0.7 },
    pensionIndexed: true, // 退休金依退休後的物價調整
    // 每過一圈健康的變化（正數為下降、負數為自然恢復）
    healthDecayPerLap: { youth: -5, middle: -3, elder: 2 },
    // 每過一圈幸福自然下降（生活的消磨，要靠休閒、人際等機會牌補回來）
    happinessDecayPerLap: { youth: 3, middle: 4, elder: 4 },
    // 經濟壓力：過起點時現金不到 months 個月生活費，幸福再減 happiness
    stress: { months: 3, happiness: 6 },
    // 通膨：物價指數每年上漲 inflation，生活費與事件牌金額跟著物價調整
    // 薪資（含退休金）每年成長 salaryGrowth，於每次過起點時一次調升一圈（yearsPerLap 年）的幅度
    // 參考台灣：長期 CPI 年增約 1.2–2%、活儲利率約 0.6%、長期名目薪資成長約 1–2%
    inflation: 0.015,
    salaryGrowth: 0.01,
    // 現金放銀行（活存）的年利率，每月計息（只算正的現金）
    bankRate: 0.006,
  };

  // laps：此階段持續幾圈（老年無上限）
  const stages = [
    { id: 'youth', name: '青年', ageFrom: 25, ageTo: 40, laps: 3 },
    { id: 'middle', name: '中年', ageFrom: 40, ageTo: 65, laps: 5 },
    { id: 'elder', name: '老年', ageFrom: 65, ageTo: null, laps: Infinity },
  ];

  // group：地圖上的顏色分組；special 為 7 種特殊格（js/events.js 依 type 執行）
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

  // 特殊格依此順序放置：7 種各 1 格，保單健檢與觀念挑戰再各多 1 格（排在後面，與第 1 格隔開）
  const SPECIAL_SEQUENCE = [...SPECIAL_TYPES, 'checkup', 'myth'];

  // 一圈 60 格，三個人生階段共用；休息含 3 個角落
  const boardCounts = { start: 1, special: SPECIAL_SEQUENCE.length, insurance: 5, hospital: 2, chance: 19, fate: 16, rest: 8 };

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
    const specials = [...SPECIAL_SEQUENCE];
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

  // 依人生階段取值：v 可以是數字，或 { youth, middle, elder }
  const byStage = (v, stageId) => (typeof v === 'number' ? v : v[stageId]);

  // 住院格：天數 = 骰子點數 × daysPerPip，醫療費 = 天數 × costPerDay（依階段，再依物價調整）；之後暫停移動 skipTurns 回合
  const hospital = { daysPerPip: 2, costPerDay: { youth: 1000, middle: 2000, elder: 3000 }, skipTurns: 1 };

  // 特殊格數值（js/events.js），金額依人生階段取值（byStage）
  //   現金獎懲和事件牌一樣再依物價調整；與保費相關的折抵上限、加付金額不調整（保費本身不隨物價變動）
  //   參考事件牌現金的中位數：青年約 6,000～7,000，中年、老年約 5～6 萬（調整物價前）
  //   保險優惠類以 state.policyPerks 記錄，下一次投保時結算（js/insurance.js 的 buy）
  const specialTiles = {
    quizSeconds: 20, // 答題限時
    // 答對二選一：現金或保費優惠
    checkup: {
      cash: { youth: 5000, middle: 25000, elder: 25000 },
      coupon: { rate: 0.3, cap: { youth: 5000, middle: 15000, elder: 15000 } },
    },
    // 出席獎勵 + 每答對一題（js/seminar.js 每篇 3 題）
    seminar: { cash: { youth: 2000, middle: 10000, elder: 10000 }, perCorrect: { youth: 1000, middle: 5000, elder: 5000 } },
    myth: { win: { youth: 4000, middle: 20000, elder: 20000 }, lose: { youth: -4000, middle: -20000, elder: -20000 } },
    mentor: { steps: 3 },
    promo: { rate: 0.2, cap: { youth: 3000, middle: 8000, elder: 8000 } }, // 下一次投保首年保費折抵 20%
    attic: { cash: { youth: 10000, middle: 50000, elder: 50000 } }, // 舊保單都抽完時改給現金
    missed: { surcharge: { youth: 1500, middle: 5000, elder: 5000 } }, // 下一次投保額外支付
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
        id: 'daily', name: '住院日額險', icon: '🛏️', pricing: 'natural', premium: { 25: 350, 40: 550, 55: 950, 65: 1500 },
        maxEntryAge: 65, coverUntilAge: 85, waitMonths: 1, minHealth: 40,
        covers: ['accident', 'hospital', 'cancer', 'heart', 'stroke'], benefit: { perDay: 2000, maxDays: 30 },
        summary: '住院每天給付 2,000，每次最多 30 天',
        note: '依住院天數給付，和實際花多少醫藥費無關，可以和實支實付醫療險同時理賠；一年期自然費率，意外住院不用等待期。',
      },
      {
        id: 'wholelife', name: '終身壽險（分紅）', icon: '🌳', pricing: 'level', premium: { 25: 980, 40: 1700, 55: 3100 },
        maxEntryAge: 60, payMonths: 240, coverUntilAge: Infinity, waitMonths: 0, minHealth: 40,
        surcharges: [{ below: 50, rate: 0.6 }, { below: 70, rate: 0.3 }],
        benefit: { death: 1000000 },
        // 解約金 = 累計已繳保費 × 倍數（依保單年度內插），曲線參考富邦美好外幣分紅終身壽險建議書（預估值）
        cashValue: { 0: 0, 1: 0, 2: 0.28, 3: 0.38, 5: 0.48, 10: 0.83, 15: 1.08, 20: 1.25, 30: 1.91, 40: 2.89, 50: 4.29, 60: 6.2, 75: 11 },
        summary: '身故給付 100 萬與解約金取高，繳 20 年保障終身',
        note: '有儲蓄成分，保費比定期壽險貴很多；前幾年解約領回的錢少於已繳保費。紅利為預估值，不保證。',
      },
      {
        id: 'annuity', name: '年金險', icon: '🏦', pricing: 'amount', amounts: [3000, 5000, 10000],
        maxEntryAge: 60, payUntilAge: 65, coverUntilAge: Infinity, waitMonths: 0, minHealth: 0, surcharges: [],
        rate: 0.02, payoutAge: 65, guaranteeMonths: 240, surrenderByYear: [0.06, 0.05, 0.04, 0.03, 0.02, 0.01],
        summary: '年利率 2% 累積，65 歲起每月領年金（保證領 20 年）',
        note: '不用核保；65 歲前身故退還帳戶價值，前 6 年解約扣 6%～1%。',
      },
    ],
    // 初始保單：父母過去買的舊保單，開局時抽，已繳清；保障偏低，不能再購買
    //   claimType：理賠方式（未設定時依 id），legacy：不出現在投保清單
    legacy: [
      {
        id: 'old-life', name: '小額終身壽險', icon: '🕊️', claimType: 'life', coverUntilAge: Infinity, waitMonths: 0,
        benefit: { death: 500000 }, surrenderFlat: 30000,
        summary: '身故給付 50 萬，已繳清', note: '父母在你小時候買的終身壽險，保額不高；解約可領回 3 萬。',
      },
      {
        id: 'old-daily', name: '舊型住院日額', icon: '🛏️', claimType: 'daily', coverUntilAge: 75, waitMonths: 0,
        covers: ['accident', 'hospital', 'cancer', 'heart', 'stroke'], benefit: { perDay: 1000, maxDays: 30 },
        summary: '住院每天 1,000，每次最多 30 天，保到 75 歲', note: '早期的住院日額保單，日額偏低，跟不上現在的醫療費。',
      },
      {
        id: 'old-accident', name: '學生團保延續意外險', icon: '🦺', claimType: 'accident', coverUntilAge: 40, waitMonths: 0,
        covers: ['accident'], benefit: { medicalMax: 10000 },
        summary: '意外醫療每次最多 1 萬，保到 40 歲', note: '學生時期團保轉成的個人保單，沒有意外身故給付。',
      },
      {
        id: 'old-cancer', name: '舊型防癌險', icon: '🔬', claimType: 'lump', coverUntilAge: Infinity, waitMonths: 0,
        covers: ['cancer'], benefit: { lumpSum: 100000 },
        summary: '確診癌症一次給付 10 萬', note: '早期的防癌險，給付金額以現在的治療費來看偏低。',
      },
      {
        id: 'old-surgery', name: '手術險', icon: '🩹', claimType: 'surgery', coverUntilAge: 80, waitMonths: 0,
        covers: ['accident', 'cancer', 'heart', 'stroke'], benefit: { perSurgery: 20000, minCost: 20000 },
        summary: '醫藥費 2 萬以上的意外或重大疾病，每次給付 2 萬', note: '只在需要手術（遊戲中以醫藥費 ≥ 2 萬判斷）時給付。',
      },
    ],
    // 開局的保單類型：依 weight 抽，再從 legacy 隨機抽 count 張不同保單
    starting: [
      { name: '無保單型', weight: 25, count: 0 },
      { name: '基礎保障型', weight: 35, count: 1 },
      { name: '一般保障型', weight: 30, count: 2 },
      { name: '進階保障型', weight: 10, count: 3 },
    ],
    // 建議書試算：投資型保險假設的年報酬
    illustrateReturn: 0.04,
  };

  // 命運牌的疾病標籤，保險依標籤判斷是否理賠
  //   accident 意外、hospital 一般住院、cancer 癌症、heart 心肌梗塞、stroke 腦中風、esrd 末期腎病
  //   （長照與身故由健康值判斷，不需要標籤）
  const cardTags = {
    accident: [
      'Y5-02', 'Y5-06', 'Y5-21', 'Y5-26', 'Y5-35', 'Y5-41', 'Y5-45', 'M5-11', 'M5-27', 'M5-43',
      'O1-15', 'O1-32', 'O5-01', 'O5-07', 'O5-20', 'O5-29', 'O5-47',
      // 職業事件
      'Y7-14', 'Y7-22', 'Y7-25', 'Y7-26', 'Y7-44', 'Y7-49', 'M7-14', 'M7-22', 'M7-26', 'M7-45', 'M7-50',
    ],
    hospital: [
      'Y5-01', 'Y5-04', 'Y5-12', 'Y5-15', 'Y5-16', 'Y5-18', 'Y5-19', 'Y5-23', 'Y5-25', 'Y5-30', 'Y5-31', 'Y5-37',
      'Y5-40', 'Y5-46', 'M5-03', 'M5-04', 'M5-06', 'M5-08', 'M5-10', 'M5-13', 'M5-18', 'M5-21', 'M5-22', 'M5-24',
      'M5-25', 'M5-30', 'M5-32', 'M5-34', 'M5-39', 'M5-40', 'M5-42', 'M5-44', 'M5-45', 'O1-25', 'O5-03', 'O5-08',
      'O5-09', 'O5-11', 'O5-17', 'O5-19', 'O5-26', 'O5-30', 'O5-32', 'O5-34', 'O5-35', 'O5-38', 'O5-42',
      // 職業事件
      'M7-02', 'M7-07', 'M7-20', 'M7-25', 'M7-44', 'M7-49',
    ],
    cancer: ['O5-36'],
    heart: ['O5-21', 'M7-55'],
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

  // 經濟劇本：取材自真實歷史事件，讓股市有故事。遊戲開始時排好時間表（js/game.js）
  //   history 依序出現（每一格有 randomRate 機率改抽 future 的情境），之後輪流使用 future
  //   shock：事件當下各股票的漲跌；recovery：之後 months 個月內逐步回升的總幅度
  //   life：對玩家的影響（cash 會依物價調整）；illness：重大疾病與住院發生率倍率；price：物價一次跳升
  const marketStory = {
    firstMonth: [12, 36], // 第一個事件在開局後第幾個月之間
    gapMonths: [48, 84], // 之後每隔幾個月一個事件
    randomRate: 0.3,
    history: [
      {
        id: 'dotcom', icon: '💥', title: '網路泡沫破裂', source: '取材自 2000 年',
        text: '網路公司股價飆漲多年後泡沫破裂，許多沒有獲利的科技公司倒閉，科技股一年內腰斬。',
        shock: { ETF50: -0.25, BANK: -0.1, TECH: -0.45, BIO: -0.2 }, recovery: { months: 36, ETF50: 0.2, TECH: 0.3, BIO: 0.1 },
        life: { happiness: -2, text: '身邊有朋友在科技業被裁員，大家都很焦慮。' },
      },
      {
        id: 'sars', icon: '😷', title: 'SARS 疫情', source: '取材自 2003 年',
        text: 'SARS 疫情爆發，醫院封院、街上人人戴口罩，觀光與消費急凍，防疫概念股逆勢上漲。',
        shock: { ETF50: -0.12, BANK: -0.08, TECH: -0.1, BIO: 0.2 }, recovery: { months: 12, ETF50: 0.15, BANK: 0.08, TECH: 0.12 },
        life: { health: -2, happiness: -2, text: '疫情期間生活受限，健康與心情都受到影響。' }, illness: { rate: 1.5, months: 6 },
      },
      {
        id: 'gfc', icon: '🏦', title: '全球金融海嘯', source: '取材自 2008 年',
        text: '美國次級房貸風暴引爆全球金融危機，大型投資銀行倒閉，股市重挫，金融股跌最深。',
        shock: { ETF50: -0.4, BANK: -0.5, TECH: -0.45, BIO: -0.3 }, recovery: { months: 48, ETF50: 0.45, BANK: 0.4, TECH: 0.5, BIO: 0.25 },
        life: { cash: -30000, happiness: -4, text: '公司實施無薪假、年終獎金泡湯，家裡氣氛很低迷。', workOnly: true },
      },
      {
        id: 'euro', icon: '🇪🇺', title: '歐債危機', source: '取材自 2011 年',
        text: '希臘等歐洲國家債務違約疑慮升高，全球資金恐慌撤出股市。',
        shock: { ETF50: -0.2, BANK: -0.25, TECH: -0.2, BIO: -0.1 }, recovery: { months: 24, ETF50: 0.15, BANK: 0.15, TECH: 0.18 },
      },
      {
        id: 'china2015', icon: '📉', title: '中國股災', source: '取材自 2015 年',
        text: '中國股市暴漲後急跌，連帶拖累亞洲股市，市場人心惶惶。',
        shock: { ETF50: -0.15, BANK: -0.1, TECH: -0.2, BIO: -0.25 }, recovery: { months: 18, ETF50: 0.12, TECH: 0.15, BIO: 0.15 },
      },
      {
        id: 'covid', icon: '🦠', title: '新冠疫情', source: '取材自 2020 年',
        text: '新冠肺炎疫情席捲全球，股市一個月內崩跌，隨後各國大量印鈔救市，股價又快速反彈。',
        shock: { ETF50: -0.3, BANK: -0.25, TECH: -0.25, BIO: 0.35 }, recovery: { months: 18, ETF50: 0.5, BANK: 0.25, TECH: 0.6 },
        life: { health: -3, happiness: -4, text: '疫情讓人不敢出門，和親友的相聚少了很多。' }, illness: { rate: 1.5, months: 12 },
      },
      {
        id: 'ratehike', icon: '📈', title: '全球升息循環', source: '取材自 2022 年',
        text: '通膨升溫，各國央行快速升息，高估值的科技股大幅修正，銀行股反而受惠。',
        shock: { ETF50: -0.22, BANK: 0.1, TECH: -0.3, BIO: -0.2 }, recovery: { months: 24, ETF50: 0.2, TECH: 0.3 },
        price: 0.03,
      },
      {
        id: 'ai', icon: '🤖', title: 'AI 熱潮', source: '取材自 2023 年',
        text: '生成式 AI 爆紅，半導體與科技股一路大漲，台股創下歷史新高。',
        shock: { ETF50: 0.25, BANK: 0.05, TECH: 0.6, BIO: 0.05 },
      },
    ],
    future: [
      {
        id: 'green', icon: '🌱', title: '綠能革命', source: '未來情境',
        text: '各國加速淘汰化石燃料，綠能與電網建設帶動新一波投資熱潮。',
        shock: { ETF50: 0.15, BANK: 0.05, TECH: 0.2 },
      },
      {
        id: 'aging', icon: '🧓', title: '高齡化醫療需求爆發', source: '未來情境',
        text: '人口快速老化，長照與醫療需求大增，生技醫療股受到追捧。',
        shock: { ETF50: 0.05, BIO: 0.4 },
      },
      {
        id: 'inflation', icon: '🔥', title: '全球通膨失控', source: '未來情境',
        text: '能源與糧食價格飆漲，物價一口氣跳升，股市震盪下跌。',
        shock: { ETF50: -0.15, BANK: 0.05, TECH: -0.15, BIO: -0.1 }, recovery: { months: 24, ETF50: 0.12, TECH: 0.12 },
        price: 0.05, life: { happiness: -2, text: '菜價、油價、房租都在漲，荷包越來越緊。' },
      },
      {
        id: 'conflict', icon: '⚠️', title: '地緣政治衝突', source: '未來情境',
        text: '區域衝突升溫，供應鏈中斷，市場避險情緒濃厚。',
        shock: { ETF50: -0.2, BANK: -0.1, TECH: -0.25, BIO: -0.05 }, recovery: { months: 24, ETF50: 0.18, TECH: 0.22 },
        life: { happiness: -3, text: '新聞每天都是衝突消息，讓人感到不安。' },
      },
      {
        id: 'biofail', icon: '💊', title: '新藥試驗失敗潮', source: '未來情境',
        text: '多款明星新藥在臨床試驗失敗，生技股集體重挫。',
        shock: { BIO: -0.4 }, recovery: { months: 36, BIO: 0.2 },
      },
      {
        id: 'antitrust', icon: '⚖️', title: '大型科技反壟斷', source: '未來情境',
        text: '各國對大型科技公司祭出反壟斷調查與罰款，科技股承壓。',
        shock: { ETF50: -0.08, TECH: -0.2 }, recovery: { months: 24, TECH: 0.15 },
      },
    ],
  };

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

  window.GameData = { jobs, fateWeight, drawWeight, economy, stages, tileTypes, boardCounts, board, byStage, hospital, specialTiles, insurance, cardTagOf, majorIllness, stocks, marketNews, marketStory, tips };
})();
