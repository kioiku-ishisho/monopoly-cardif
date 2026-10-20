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

  const tileTypes = {
    start: { name: '起點', icon: '🏁' },
    chance: { name: '機會', icon: '❓' }, // 抽機會牌，可選擇接受或放棄
    fate: { name: '命運', icon: '🎴' }, // 抽命運牌，抽到即發生
    insurance: { name: '保險', icon: '🛡️' }, // 可投保醫療險
    rest: { name: '休息', icon: '☕' }, // 什麼事都沒發生
  };

  // 每圈各類格子數量（合計 60）；休息含 3 個角落
  const boardCounts = {
    youth: { start: 1, chance: 26, fate: 16, insurance: 10, rest: 7 },
    middle: { start: 1, chance: 24, fate: 18, insurance: 9, rest: 8 },
    elder: { start: 1, chance: 19, fate: 24, insurance: 6, rest: 10 },
  };

  // 角落為第 0、15、30、45 格：起點 + 3 個休息角落；其餘格子依比例平均分散排列
  function layoutBoard(counts, tiles = economy.tilesPerLap) {
    const side = tiles / 4;
    const board = new Array(tiles);
    board[0] = 'start';
    for (let i = side; i < tiles; i += side) board[i] = 'rest';
    const remaining = { chance: counts.chance, fate: counts.fate, insurance: counts.insurance, rest: counts.rest - 3 };
    const slots = tiles - 4;
    const used = { chance: 0, fate: 0, insurance: 0, rest: 0 };
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
      board[i] = best;
      used[best]++;
    }
    return board;
  }

  const boards = Object.fromEntries(Object.entries(boardCounts).map(([stage, c]) => [stage, layoutBoard(c)]));

  // 醫療險：在保險格投保，保費依投保時的人生階段固定（越早投保越便宜）
  // 投保後，同時造成「現金減少」與「健康下降」的命運牌，現金損失由保險理賠 coverRate
  const insurance = {
    name: '醫療險',
    premium: { youth: 1200, middle: 2800, elder: 6000 },
    coverRate: 0.8,
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

  window.GameData = { jobs, economy, stages, tileTypes, boardCounts, boards, insurance, stocks, marketNews, tips };
})();
