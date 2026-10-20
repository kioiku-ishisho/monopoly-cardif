/*
 * AI 評分與全服排名
 *
 * 目前為「本機規則版」：依遊戲紀錄計算分數並組出總結與建議，不需要網路。
 * 要接上真正的 AI（例如 Claude API）時：
 *   1. 架一個後端 API，接收遊戲紀錄、呼叫 LLM，回傳 { score, grade, summary, decisions, advice }
 *      （API 金鑰務必放在後端，不可寫在前端程式碼）
 *   2. 把下方 AI_CONFIG.evaluateEndpoint 設為該網址
 * 排名同理：設定 AI_CONFIG.rankEndpoint 後會改用伺服器回傳的排名。
 */
(function () {
  const AI_CONFIG = {
    evaluateEndpoint: '', // 例如 'https://your-server.example.com/api/evaluate'
    rankEndpoint: '', // 例如 'https://your-server.example.com/api/rank'
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const money = (n) => UI.fmtMoney(n);

  function gradeOf(score) {
    if (score >= 90) return 'S';
    if (score >= 75) return 'A';
    if (score >= 60) return 'B';
    if (score >= 40) return 'C';
    return 'D';
  }

  function localEvaluate(r) {
    const maxAge = GameData.economy.maxAge;
    const yearlySalary = r.salary * 12;

    // 壽命（30）
    const longevity = clamp(((r.finalAge - 25) / (maxAge - 25)) * 30, 0, 30);
    // 財富（35）：淨資產相對年薪的倍數，取對數避免高薪職業過度領先
    const wealthRatio = Math.max(0, r.netWorth) / yearlySalary;
    const wealth = r.endReason === 'bankrupt' ? 0 : clamp((Math.log2(1 + wealthRatio) / Math.log2(1 + 20)) * 35, 0, 35);
    // 健康（15）
    const health = clamp((r.avgHealth / 100) * 15, 0, 15);
    // 投資與風險管理（10）
    let invest = 0;
    if (r.trades > 0) invest += 3;
    if (r.distinctStocks >= 2) invest += 2;
    if (r.realizedPnL > 0 || r.stockValue > 0) invest += 2;
    if (r.insured) invest += r.insuredStage === 'youth' ? 3 : 2;
    if (r.forcedSales > 0) invest -= 3;
    invest = clamp(invest, 0, 10);
    // 結局（10）
    const ending = { maxAge: 10, death: r.finalAge >= 65 ? 6 : 2, bankrupt: 0 }[r.endReason] ?? 0;

    const score = Math.round(longevity + wealth + health + invest + ending);
    const grade = gradeOf(score);

    // ---- 總結 ----
    const endPhrase = {
      bankrupt: `在 ${r.finalAge} 歲時因現金耗盡而破產`,
      death: `在 ${r.finalAge} 歲時因健康耗盡而離世`,
      maxAge: `平安走到 ${r.finalAge} 歲，享壽百歲`,
    }[r.endReason];
    const summary = [
      `你以「${r.jobName}」的身分展開人生，月薪 ${money(r.salary)}，最終${endPhrase}。`,
      `這一生共走了 ${r.laps} 圈、${r.turns} 個回合，淨資產最高曾達 ${money(r.peakNetWorth)}，結束時為 ${money(r.netWorth)}（現金 ${money(r.finalCash)}、股票 ${money(r.stockValue)}）。`,
      r.trades
        ? `投資方面，你進行了 ${r.trades} 筆交易、接觸 ${r.distinctStocks} 檔標的，已實現損益 ${UI.fmtSigned(r.realizedPnL)}。`
        : '整場遊戲你沒有進行任何投資，資產完全依靠薪資累積。',
      `人生中你遇到 ${r.fateCount || 0} 次命運，面對 ${(r.chanceAccepted || 0) + (r.chanceDeclined || 0)} 次機會時接受了 ${r.chanceAccepted || 0} 次；事件累積讓每月淨收入${(r.netIncomeAdj || 0) >= 0 ? '增加' : '減少'} ${money(Math.abs(r.netIncomeAdj || 0))}。`,
      r.insured
        ? `你有投保醫療險，共獲得 ${r.claims || 0} 次理賠、合計 ${money(r.claimTotal || 0)}。`
        : '你一直沒有投保醫療險。',
      `平均健康指數為 ${r.avgHealth}，最低曾降到 ${r.minHealth}。`,
    ].join('');

    // ---- 決策回顧 ----
    const decisions = [];
    if (r.trades === 0) decisions.push({ type: 'bad', text: '從未投資：現金放著不動，長期會被通膨侵蝕購買力。' });
    if (r.distinctStocks >= 2) decisions.push({ type: 'good', text: `分散投資 ${r.distinctStocks} 檔標的，降低了單一股票的風險。` });
    if (r.distinctStocks === 1) decisions.push({ type: 'bad', text: '只投資單一標的，風險過度集中。' });
    if (r.realizedPnL > 0) decisions.push({ type: 'good', text: `適時獲利了結，已實現獲利 ${money(r.realizedPnL)}。` });
    if (r.realizedPnL < 0) decisions.push({ type: 'bad', text: `賣出時產生虧損 ${money(-r.realizedPnL)}，可能在低點賣出。` });
    if (r.forcedSales > 0) decisions.push({ type: 'bad', text: '曾因現金不足被迫賣股，代表緊急預備金不夠。' });
    if (r.finalAge >= 65 && r.endReason !== 'bankrupt') decisions.push({ type: 'good', text: '成功撐到退休年齡，具備基本的長期規劃。' });
    if (r.endReason === 'bankrupt' && r.finalStage === 'elder') decisions.push({ type: 'bad', text: '退休後收入下降，資產不足以支撐晚年生活。' });
    if (r.avgHealth >= 80) decisions.push({ type: 'good', text: '健康維持良好，為人生打下穩固基礎。' });
    if (r.insured && r.insuredStage === 'youth') decisions.push({ type: 'good', text: '年輕時就投保醫療險，用較低的保費取得長期保障。' });
    if (r.claims > 0) decisions.push({ type: 'good', text: `保險發揮作用，${r.claims} 次理賠共減少 ${money(r.claimTotal)} 的損失。` });
    const uninsured = (r.log || []).filter((l) => l.category === 'uninsured-loss').length;
    if (uninsured >= 2) decisions.push({ type: 'bad', text: `有 ${uninsured} 次醫療相關支出都是自掏腰包，缺少保險保障。` });
    if (r.netIncomeAdj < 0) decisions.push({ type: 'bad', text: `各種事件讓每月淨收入減少了 ${money(-r.netIncomeAdj)}，長期開銷要特別留意。` });
    if (r.netIncomeAdj > 0) decisions.push({ type: 'good', text: `透過進修、加薪等選擇，每月淨收入提高了 ${money(r.netIncomeAdj)}。` });
    // 附上玩家實際做過的幾筆重要決策
    const notable = (r.log || []).filter((l) => !['milestone', 'uninsured-loss'].includes(l.category)).slice(-4);
    notable.forEach((l) => decisions.push({ type: 'info', text: `${l.age} 歲：${l.text}` }));
    if (!decisions.length) decisions.push({ type: 'info', text: '這局的決策紀錄不多，下次試著多做一些財務選擇吧！' });

    // ---- 建議（每則對應一個可解鎖的提示） ----
    const advice = [];
    if (r.endReason === 'bankrupt' || r.forcedSales > 0) advice.push({ tip: 'emergency', text: '先建立 3～6 個月生活費的緊急預備金，再考慮投資，才不會在急需用錢時被迫賣出資產。' });
    if (!r.insured || uninsured >= 2) advice.push({ tip: 'insurance', text: '在保險格及早投保醫療險，用固定的小額保費轉嫁「付不起」的醫療風險。' });
    if (r.trades === 0) advice.push({ tip: 'compound', text: '試著及早開始投資，讓複利替你工作；即使每次金額不大，時間會放大效果。' });
    if (r.distinctStocks <= 1) advice.push({ tip: 'diversify', text: '把資金分散到不同風險的標的，例如 ETF 搭配穩健的金融股，降低波動。' });
    if (r.realizedPnL < 0) advice.push({ tip: 'panic', text: '市場下跌時先冷靜評估，避免恐慌性賣出把帳面損失變成真正損失。' });
    if (r.finalAge < 65 || r.finalStage !== 'elder' || r.endReason === 'bankrupt') advice.push({ tip: 'retirement', text: '退休後收入會大幅下降，建議在中年就試算退休金缺口並提早準備。' });
    if (r.avgHealth < 70 || r.endReason === 'death') advice.push({ tip: 'healthwealth', text: '健康是最重要的資產，適度投資在運動與健康檢查上，能減少晚年醫療支出。' });
    advice.push({ tip: 'budget', text: '可以用 50/30/20 法則分配收入：必要支出 50%、想要 30%、儲蓄投資 20%。' });
    if (advice.length < 4) advice.push({ tip: 'dca', text: '嘗試定期定額投入指數型 ETF，不必預測高低點，也能平均成本。' });

    return { score, grade, summary, decisions, advice: advice.slice(0, 5), breakdown: { longevity, wealth, health, invest, ending }, source: 'local' };
  }

  async function postJSON(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function evaluate(record) {
    if (AI_CONFIG.evaluateEndpoint) {
      try {
        return Object.assign({ source: 'remote' }, await postJSON(AI_CONFIG.evaluateEndpoint, record));
      } catch (e) {
        console.warn('AI 服務連線失敗，改用本機評分', e);
      }
    }
    await UI.wait(900); // 模擬分析時間
    return localEvaluate(record);
  }

  // 標準常態分布累積函數（近似）
  function normCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp((-z * z) / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  // 回傳 { rank, total, topPercent, simulated }
  async function getGlobalRank(bestScore) {
    if (AI_CONFIG.rankEndpoint) {
      try {
        return Object.assign({ simulated: false }, await postJSON(AI_CONFIG.rankEndpoint, { score: bestScore }));
      } catch (e) {
        console.warn('排名服務連線失敗，改用模擬排名', e);
      }
    }
    // 尚無伺服器：以假設的玩家分布（平均 55、標準差 16、共 12,840 人）模擬
    const total = 12840;
    const above = 1 - normCdf((bestScore - 55) / 16);
    const rank = Math.max(1, Math.round(total * above));
    return { rank, total, topPercent: Math.max(0.1, Math.round((rank / total) * 1000) / 10), simulated: true };
  }

  window.AI = { config: AI_CONFIG, evaluate, getGlobalRank };
})();
