/*
 * 計分標準（100 分，不計入剩餘資產）：瀏覽器的本機評分（js/ai.js）與伺服器的 AI 評分（api/evaluate.js）共用
 *   壽命 20、幸福 20、健康 20、保險決策 20、理財決策 10、保險知識 10
 * Score.compute(record) -> { score, grade, breakdown: { key: 分數 }, details: { key: [說明] } }
 */
(function () {
  const MAX = { longevity: 20, happiness: 20, health: 20, insurance: 20, finance: 10, knowledge: 10 };
  const LABELS = { longevity: '壽命', happiness: '幸福指數', health: '健康指數', insurance: '保險決策', finance: '理財決策', knowledge: '保險知識' };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round1 = (n) => Math.round(n * 10) / 10;

  function gradeOf(score) {
    if (score >= 90) return 'S';
    if (score >= 75) return 'A';
    if (score >= 60) return 'B';
    if (score >= 40) return 'C';
    return 'D';
  }

  // 自己買的保單中，最早投保某類險種的年齡（舊保單不算玩家的決策）
  function firstAge(policies, ids) {
    const ages = (policies || []).filter((p) => !p.legacy && ids.includes(p.id)).map((p) => p.entryAge);
    return ages.length ? Math.min(...ages) : null;
  }

  function compute(r) {
    const details = {};
    const note = (key, text) => (details[key] ||= []).push(text);

    // 壽命：結束年齡 ÷ 100 × 20
    const longevity = clamp((r.finalAge || 0) / 100, 0, 1) * MAX.longevity;
    note('longevity', `${r.finalAge} 歲結束`);

    const happiness = clamp((r.avgHappiness ?? 50) / 100, 0, 1) * MAX.happiness;
    note('happiness', `平均幸福 ${r.avgHappiness ?? '—'}`);
    const health = clamp((r.avgHealth ?? 50) / 100, 0, 1) * MAX.health;
    note('health', `平均健康 ${r.avgHealth ?? '—'}`);

    // 保險決策：保障缺口 8、保費比例 4、理賠覆蓋 4、沒有停效 4
    let insurance = 0;
    const tiers = (age, early, late, full) => (age == null ? 0 : age <= early ? full : age <= late ? full * 0.6 : full * 0.2);
    const medAge = firstAge(r.policies, ['medical', 'daily']);
    const majorAge = firstAge(r.policies, ['major', 'cancer', 'specific']);
    const accAge = firstAge(r.policies, ['accident']);
    const oldAge = firstAge(r.policies, ['ltc', 'annuity']);
    const gap = tiers(medAge, 35, 45, 2.5) + tiers(majorAge, 40, 50, 2.5) + tiers(accAge, 40, 55, 1) + tiers(oldAge, 50, 60, 2);
    insurance += gap;
    note('insurance', `保障缺口 ${round1(gap)}/8（醫療 ${medAge ?? '未買'}、重大疾病 ${majorAge ?? '未買'}、意外 ${accAge ?? '未買'}、長照或年金 ${oldAge ?? '未買'}）`);
    const bought = (r.policies || []).some((p) => !p.legacy);
    const ratio = r.avgPremiumRatio || 0;
    const budget = ratio >= 0.05 && ratio <= 0.15 ? 4 : (ratio >= 0.02 && ratio < 0.05) || (ratio > 0.15 && ratio <= 0.2) ? 2 : 0;
    insurance += budget;
    note('insurance', `保費占月薪平均 ${Math.round(ratio * 100)}%（建議 5–15%）`);
    const cost = r.medicalCost || 0;
    const covered = cost > 0 ? clamp((r.claimTotal || 0) / cost, 0, 1) * 4 : bought ? 4 : 0;
    insurance += covered;
    if (cost > 0) note('insurance', `醫療支出 ${Math.round(cost).toLocaleString('zh-TW')} 元，保險理賠 ${Math.round(r.claimTotal || 0).toLocaleString('zh-TW')} 元`);
    const lapse = !bought ? 0 : !r.lapses ? 4 : r.lapses === 1 ? 2 : 0;
    insurance += lapse;
    if (r.lapses) note('insurance', `保單停效 ${r.lapses} 次`);

    // 理財決策：緊急預備金 4、分散投資 3、沒被強制賣股 3
    const emergency = clamp(r.emergencyRate || 0, 0, 1) * 4;
    note('finance', `${Math.round((r.emergencyRate || 0) * 100)}% 的時間保有 3 個月以上生活費`);
    const diversify = (r.distinctStocks || 0) >= 2 ? 3 : (r.distinctStocks || 0) === 1 ? 1.5 : 0;
    note('finance', `投資過 ${r.distinctStocks || 0} 檔股票`);
    const forced = !r.forcedSales && r.endReason !== 'bankrupt' ? 3 : 0;
    if (r.forcedSales) note('finance', `被迫賣股 ${r.forcedSales} 次`);
    const finance = emergency + diversify + forced;

    const knowledge = r.quizAsked ? (r.quizCorrect / r.quizAsked) * MAX.knowledge : MAX.knowledge / 2;
    note('knowledge', r.quizAsked ? `保險知識題答對 ${r.quizCorrect}/${r.quizAsked}` : '沒有遇到保險知識題（給一半分數）');

    const breakdown = {
      longevity: round1(longevity),
      happiness: round1(happiness),
      health: round1(health),
      insurance: round1(clamp(insurance, 0, MAX.insurance)),
      finance: round1(clamp(finance, 0, MAX.finance)),
      knowledge: round1(clamp(knowledge, 0, MAX.knowledge)),
    };
    const score = Math.round(Object.values(breakdown).reduce((s, v) => s + v, 0));
    return { score, grade: gradeOf(score), breakdown, details };
  }

  window.Score = { compute, gradeOf, MAX, LABELS };
})();
