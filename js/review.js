/*
 * 人生階段結算與檢討的模板：每個階段有一組檢核項目、下一階段重點與理專的常見問答。
 * 只依 js/game/report.js 傳入的快照（snapshot）計算，不碰遊戲狀態；數值門檻可直接調整。
 *
 * snapshot 欄位：stageId, stageName, nextStageName, startAge, endAge, jobName, salary, expense,
 *   cash, stock, policyValue, netWorth, startNetWorth, health, startHealth, happiness, startHappiness,
 *   premium, premiumRatio, fund（緊急預備金月數）, net（每月結餘）, held（持有幾檔）, trades, forcedSales,
 *   cover（{ medical, accident, major, life, ltc, annuity } 有效保障）, history（病史名稱）, ltc,
 *   pension（退休後每月收入估計）, retireGap（退休後每月缺口）, retireNeed（退休 20 年缺口總額）
 */
(function () {
  const money = (n) => UI.fmtMoney(n);
  const pct = (r) => `${Math.round(r * 100)}%`;
  const good = (text, advice = '') => ({ level: 'good', text, advice });
  const warn = (text, advice) => ({ level: 'warn', text, advice });
  const bad = (text, advice) => ({ level: 'bad', text, advice });

  // 有效保單的 id 對應到保障類別（舊保單也算）
  const COVER_GROUPS = {
    medical: ['medical', 'daily', 'old-daily', 'old-surgery'],
    accident: ['accident', 'old-accident'],
    major: ['major', 'specific', 'cancer', 'old-cancer'],
    life: ['life', 'wholelife', 'old-life'],
    ltc: ['ltc'],
    annuity: ['annuity'],
  };
  const INACTIVE = ['已解約', '停效', '已到期', '已理賠結束'];
  function coverOf(policies) {
    const ids = policies.filter((p) => !INACTIVE.includes(p.status)).map((p) => p.id);
    return Object.fromEntries(Object.entries(COVER_GROUPS).map(([k, list]) => [k, ids.some((id) => list.includes(id))]));
  }

  // ===== 共用檢核項目 =====
  const checkFund = {
    id: 'fund', label: '緊急預備金',
    run: (s) => {
      const lack = Math.max(0, Math.round(s.expense * 6 - s.cash));
      if (s.fund >= 6) return good(`現金約 ${s.fund.toFixed(1)} 個月生活費，很充足。`);
      if (s.fund >= 3) return warn(`現金約 ${s.fund.toFixed(1)} 個月生活費，及格但偏緊。`, `再存 ${money(lack)} 就有 6 個月生活費，遇到停薪或住院比較不慌。`);
      return bad(`現金只有 ${Math.max(0, s.fund).toFixed(1)} 個月生活費。`, `先把投資暫停，存到至少 3 個月生活費（${money(s.expense * 3)}），否則一次意外就可能被迫賣股或破產。`);
    },
  };
  const checkPremium = {
    id: 'premium', label: '保費占月薪 5–15%',
    run: (s) => {
      if (s.stageId === 'elder') return s.net >= 0 ? good(`保費 ${money(s.premium)}，每月收支仍有結餘。`) : warn(`保費 ${money(s.premium)}，每月收支已是負的。`, '檢視還需要的保單，已經不需要的壽險保障可以考慮減額或解約。');
      const r = s.premiumRatio;
      if (r > 0.15) return bad(`每月保費 ${money(s.premium)}，占月薪 ${pct(r)}，太高了。`, '保費超過月薪 15% 會排擠儲蓄，優先保留醫療、重大傷病等「付不起」的保障，儲蓄型保單可以減額。');
      if (r >= 0.05) return good(`每月保費 ${money(s.premium)}，占月薪 ${pct(r)}，在合理範圍。`);
      return warn(`每月保費 ${money(s.premium)}，只占月薪 ${pct(r)}，保障可能不夠。`, '可以用月薪 5–10% 補齊醫療、意外與重大傷病保障，用小錢轉嫁大風險。');
    },
  };
  const checkMedical = {
    id: 'medical', label: '醫療與意外保障',
    run: (s) => {
      const { medical, accident } = s.cover;
      if (medical && accident) return good('醫療與意外保障都有。');
      if (medical || accident) return warn(`有${medical ? '醫療' : '意外'}保障，但缺少${medical ? '意外險' : '醫療險'}。`, `補一張${medical ? '意外險（保費便宜、職業風險高更需要）' : '醫療險（實支實付），住院和手術費用才不會全部自付'}。`);
      return bad('沒有醫療也沒有意外保障。', '這是最基本的保障，先補醫療險（實支實付）和意外險，每月不到 2,000 元。');
    },
  };
  const checkMajor = {
    id: 'major', label: '重大疾病保障',
    run: (s) => {
      if (s.cover.major) return good('有重大傷病、特定傷病或癌症保障。');
      const blocked = s.history.length ? `（你有${s.history.join('、')}病史，部分險種已無法投保）` : '';
      const advice = s.history.length
        ? '有病史後能買的保障變少，剩下的保險要好好續繳，並多存一些醫療預備金。'
        : `重大疾病一次可能花掉數十萬，${s.stageId === 'youth' ? '年輕時保費最便宜，' : '年紀越大保費越高、越可能被拒保，'}建議盡早投保重大傷病險。`;
      return (s.stageId === 'youth' ? warn : bad)(`沒有重大疾病保障${blocked}。`, advice);
    },
  };
  const checkInvest = {
    id: 'invest', label: '投資與分散',
    run: (s) => {
      if (s.forcedSales) return bad(`這個階段被迫賣股 ${s.forcedSales} 次。`, '投資的錢要是「閒錢」，先留好預備金，才不會在低點被迫賣出。');
      if (s.held >= 2) return good(`持有 ${s.held} 檔標的，投資市值 ${money(s.stock)}。`);
      if (s.held === 1) return warn('只持有 1 檔標的，風險集中。', '可以加入台灣50這類 ETF 或穩健的金融股分散風險。');
      return bad(s.trades ? '目前沒有持股。' : '這個階段沒有任何投資。', '現金放著會被通膨吃掉，預備金足夠後，每圈定期定額買一點 ETF，讓複利慢慢累積。');
    },
  };
  const checkWorth = {
    id: 'worth', label: '淨資產成長',
    run: (s) => {
      const diff = s.netWorth - s.startNetWorth;
      if (diff > 0) return good(`淨資產從 ${money(s.startNetWorth)} 成長到 ${money(s.netWorth)}（${UI.fmtSigned(diff)}）。`);
      return bad(`淨資產減少了 ${money(-diff)}。`, '每月結餘是負的就要先砍開銷；機會牌的花費也要先想想是否負擔得起。');
    },
  };
  const checkWellbeing = {
    id: 'wellbeing', label: '健康與幸福',
    run: (s) => {
      const text = `健康 ${s.startHealth} → ${s.health}，幸福 ${s.startHappiness} → ${s.happiness}。`;
      if (s.health <= 30 || s.happiness <= 30) return bad(text, `${s.health <= 30 ? '健康太低會進入長照狀態，' : ''}${s.happiness <= 30 ? '幸福歸零人生就會停下來，' : ''}遇到運動、休閒、人際的機會牌值得花點錢接受。`);
      if (s.health >= 60 && s.happiness >= 60) return good(text);
      return warn(text, '錢不是唯一的資產，適度花在健康檢查、運動和休閒上，能減少之後的醫療支出。');
    },
  };

  // ===== 各階段模板 =====
  const TEMPLATES = {
    youth: {
      goal: '青年期（25–40 歲）的目標：存好預備金、用便宜的保費把基本保障買齊，並及早開始投資。',
      checks: [checkFund, checkMedical, checkMajor, checkPremium, checkInvest, checkWorth, checkWellbeing],
      next: ['中年收入提高，但家庭開銷與健康風險也會變多，維持 6 個月預備金。',
        '開始試算退休金缺口：退休後收入只剩月薪約 7 成，缺口要靠中年 25 年存下來。',
        '考慮長照險或年金險，越晚投保保費越貴。'],
    },
    middle: {
      goal: '中年期（40–65 歲）的目標：補強重大疾病與長照保障，並在退休前把退休金缺口準備好。',
      checks: [checkFund, {
        id: 'retire', label: '退休金準備',
        run: (s) => {
          if (s.retireGap <= 0) return good(`退休後每月收入約 ${money(s.pension)}，足以支付生活費。`);
          const ratio = s.netWorth / s.retireNeed;
          const text = `退休後每月缺口約 ${money(s.retireGap)}，20 年共需 ${money(s.retireNeed)}，目前淨資產達成 ${pct(Math.max(0, ratio))}。`;
          if (ratio >= 1) return good(text);
          if (ratio >= 0.5 || s.cover.annuity) return warn(text, `還差 ${money(s.retireNeed - s.netWorth)}，退休後要控制開銷${s.cover.annuity ? '' : '，或用年金險補一部分固定收入'}。`);
          return bad(text, '退休金明顯不足，退休後要大幅縮減開銷；資產要放在穩健、能領息的標的。');
        },
      }, checkMajor, {
        id: 'ltc', label: '長照與年金',
        run: (s) => {
          if (s.cover.ltc && s.cover.annuity) return good('長照險與年金險都有，晚年的照護與收入都有準備。');
          if (s.cover.ltc || s.cover.annuity) return warn(`有${s.cover.ltc ? '長照險' : '年金險'}，缺少${s.cover.ltc ? '年金險' : '長照險'}。`, s.cover.ltc ? '年金險可以補退休後的固定收入。' : '健康降到 30 以下會進入長照，每月多 3 萬照護費，可以用長照險或專款存一筆照護預備金。');
          return warn('沒有長照險，也沒有年金險。', '老年健康會逐年下降，長照每月要多 3 萬元；至少準備其中一種，或存一筆專用的照護金。');
        },
      }, checkPremium, checkInvest, checkWellbeing],
      next: ['退休後薪水停了，每月收入只剩退休金，先確認每月結餘是不是正的。',
        '健康每年下降，長照狀態每月多 3 萬照護費，要留一筆照護預備金。',
        '投資改以穩健為主，避免在晚年遇到大跌被迫賣出。'],
    },
    elder: {
      goal: '老年期（65 歲以後）的目標：讓資產撐得比壽命久、維持健康與幸福，並安排好給家人的保障。',
      checks: [{
        id: 'last', label: '資產能撐多久',
        run: (s) => {
          if (s.net >= 0) return good(`每月收支 ${UI.fmtSigned(s.net)}，退休金就能支應生活。`);
          const years = Math.max(0, s.netWorth) / (-s.net * 12);
          const text = `每月不足 ${money(-s.net)}，目前資產約可支撐 ${years.toFixed(1)} 年。`;
          return years >= 20 ? good(text) : years >= 10 ? warn(text, '開銷要更節制，必要時賣出部分投資補現金。') : bad(text, '資產可能比壽命先用完，退休前就要準備更多退休金。');
        },
      }, checkFund, checkWellbeing, {
        id: 'legacy', label: '照護與傳承',
        run: (s) => {
          if (s.ltc && !s.cover.ltc) return bad('進入長照狀態，但沒有長照險，照護費全部自付。', '長照險要在健康時投保，生病後就買不到了。');
          if (s.cover.ltc || s.cover.life) return good(`有${[s.cover.ltc && '長照險', s.cover.life && '壽險'].filter(Boolean).join('與')}，照護或傳承有準備。`);
          return warn('沒有長照險，也沒有壽險。', '晚年的照護與留給家人的錢，要靠存款準備。');
        },
      }],
      next: [],
    },
  };

  const LEVEL_POINT = { good: 2, warn: 1, bad: 0 };
  const GRADES = [
    { min: 0.8, grade: 'A', text: '規劃得很好，保持下去！' },
    { min: 0.6, grade: 'B', text: '大方向正確，還有幾個地方可以補強。' },
    { min: 0.4, grade: 'C', text: '有一些明顯的缺口，下一階段要優先處理。' },
    { min: 0, grade: 'D', text: '風險偏高，建議照理專的建議一項一項調整。' },
  ];

  // 回傳 { goal, checks: [{ id, label, level, text, advice }], passed, grade, gradeText, advice, next }
  function build(s) {
    const t = TEMPLATES[s.stageId] || TEMPLATES.elder;
    const checks = t.checks.map((c) => ({ id: c.id, label: c.label, ...c.run(s) }));
    const ratio = checks.reduce((sum, c) => sum + LEVEL_POINT[c.level], 0) / (checks.length * 2);
    const g = GRADES.find((x) => ratio >= x.min);
    // 理專建議：先處理紅燈，再處理黃燈，最多 4 則
    const advice = [...checks.filter((c) => c.level === 'bad'), ...checks.filter((c) => c.level === 'warn')]
      .slice(0, 4).map((c) => ({ label: c.label, level: c.level, text: c.advice }));
    return { goal: t.goal, checks, passed: checks.filter((c) => c.level === 'good').length, grade: g.grade, gradeText: g.text, advice, next: t.next };
  }

  // ===== 理專的常見問題：離線或 AI 無法使用時，用快照算出回答 =====
  const FAQ = [
    {
      q: '我這個階段最該改進什麼？',
      a: (s, r) => (r.advice.length
        ? `最優先的是「${r.advice[0].label}」：${r.advice[0].text}${r.advice[1] ? `其次是「${r.advice[1].label}」：${r.advice[1].text}` : ''}`
        : `這個階段 ${r.checks.length} 項檢核都達標，維持現在的做法，持續每圈存錢與定期投資就好。`),
    },
    {
      q: '下一個階段要注意什麼？',
      a: (s, r) => (r.next.length ? `進入${s.nextStageName}後要注意：${r.next.join('')}` : '接下來好好享受生活，維持健康就是最好的理財。'),
    },
    {
      q: '我的緊急預備金夠嗎？',
      a: (s) => `建議存 3–6 個月生活費，也就是 ${money(s.expense * 3)}～${money(s.expense * 6)}。你現在有 ${money(Math.max(0, s.cash))}，約 ${Math.max(0, s.fund).toFixed(1)} 個月，${s.fund >= 6 ? '很充足，多出來的部分可以拿去投資。' : s.fund >= 3 ? '及格，再多存一點會更安心。' : '不夠，先存預備金再投資。'}`,
    },
    {
      q: '我的保費會不會太高？',
      a: (s) => `你每月保費 ${money(s.premium)}，占月薪 ${pct(s.premiumRatio)}。一般建議 5–15%（雙十原則約 10%）。${s.premiumRatio > 0.15 ? '偏高，可以先減少儲蓄型或投資型保單，保留醫療與重大傷病保障。' : s.premiumRatio < 0.05 ? '偏低，保障可能不夠，可以補醫療、意外或重大傷病險。' : '在合理範圍。'}`,
    },
    {
      q: '退休金夠用嗎？',
      a: (s) => (s.retireGap <= 0
        ? `退休後每月收入約 ${money(s.pension)}，比生活費 ${money(s.expense)} 高，基本生活沒問題，但還要留意醫療與長照費用。`
        : `退休後每月收入約 ${money(s.pension)}，生活費 ${money(s.expense)}，每月缺口 ${money(s.retireGap)}。以退休後 20 年計算，要準備 ${money(s.retireNeed)}，你現在淨資產 ${money(s.netWorth)}${s.netWorth >= s.retireNeed ? '，已經足夠。' : `，還差 ${money(s.retireNeed - s.netWorth)}。可以每圈定期投資，或用年金險補固定收入。`}`),
    },
    {
      q: '怎麼開始投資比較好？',
      a: (s) => `先確認預備金至少 3 個月，再用每月結餘的一部分定期定額買 ETF，不用猜高低點。${s.held >= 2 ? `你已經持有 ${s.held} 檔，分散得不錯，` : s.held === 1 ? '你只有 1 檔，可以再分散到不同類型的標的，' : '你目前沒有持股，可以從台灣50 ETF 開始，'}遇到市場大跌不要恐慌賣出。`,
    },
  ];

  window.StageReview = { build, coverOf, FAQ };
})();
