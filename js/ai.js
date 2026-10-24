/*
 * AI 評分與全服排名
 *
 * 正常情況：呼叫 /api/evaluate，由伺服器端的 Claude 評分，並寫入 Firestore 全服排行榜。
 * 無法連線（直接開啟檔案、API 失敗、超過每日次數）時：改用下方的本機規則評分，不列入排行榜。
 */
(function () {
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
    if (r.insured) invest += r.firstInsuredAge != null && r.firstInsuredAge < 40 ? 3 : 2;
    if ((r.maxPremiumRatio || 0) > 0.2) invest -= 1; // 保費遠超過雙十原則
    if (r.forcedSales > 0) invest -= 3;
    invest = clamp(invest, 0, 10);
    // 結局（10）
    const ending = { maxAge: 10, death: r.finalAge >= 65 ? 6 : 2, unhappy: r.finalAge >= 65 ? 4 : 1, bankrupt: 0 }[r.endReason] ?? 0;

    const score = Math.round(longevity + wealth + health + invest + ending);
    const grade = gradeOf(score);

    // ---- 總結 ----
    const endPhrase = {
      bankrupt: `在 ${r.finalAge} 歲時因現金耗盡而破產`,
      death: `在 ${r.finalAge} 歲時因健康耗盡而離世`,
      unhappy: `在 ${r.finalAge} 歲時因幸福指數歸零、失去生活動力而結束`,
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
        ? `你投保了 ${(r.policies || []).map((p) => `${p.name}（${p.entryAge} 歲）`).join('、')}，共繳保費 ${money(r.premiumsPaid || 0)}，獲得 ${r.claims || 0} 次理賠、合計 ${money(r.claimTotal || 0)}。`
        : '你一直沒有投保任何保險。',
      r.legacy ? `身故後保險給付家人 ${money(r.legacy)}。` : '',
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
    if (r.insured && r.firstInsuredAge != null && r.firstInsuredAge < 40) decisions.push({ type: 'good', text: `${r.firstInsuredAge} 歲就開始投保，用較低的保費取得長期保障。` });
    if (r.claims > 0) decisions.push({ type: 'good', text: `保險發揮作用，${r.claims} 次理賠共減少 ${money(r.claimTotal)} 的損失。` });
    if ((r.maxPremiumRatio || 0) > 0.15) decisions.push({ type: 'bad', text: `保費最高占月薪 ${Math.round(r.maxPremiumRatio * 100)}%，超過雙十原則建議的 10%，排擠了儲蓄與投資。` });
    if ((r.policies || []).some((p) => p.status === '停效')) decisions.push({ type: 'bad', text: '曾因繳不出保費讓保單停效，之前繳的保費等於白繳。' });
    if (r.ltcAge != null && !(r.policies || []).some((p) => p.id === 'ltc')) decisions.push({ type: 'bad', text: `${r.ltcAge} 歲進入長照狀態，但沒有長照險，照護費全部自付。` });
    if ((r.policies || []).some((p) => p.id === 'annuity')) decisions.push({ type: 'good', text: '投保年金險，為退休後的收入缺口預先準備。' });
    if ((r.policies || []).some((p) => p.id === 'invest')) decisions.push({ type: 'info', text: '投資型保險的費用比自己買 ETF 高，可以比較「先買保障、再分開投資」的差異。' });
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
    if (!r.insured || uninsured >= 2) advice.push({ tip: 'insurance', text: '在保險業務員格及早投保醫療險、意外險與重大傷病險，用固定的小額保費轉嫁「付不起」的醫療風險；保費總額控制在月薪 10% 左右。' });
    if (r.trades === 0) advice.push({ tip: 'compound', text: '試著及早開始投資，讓複利替你工作；即使每次金額不大，時間會放大效果。' });
    if (r.distinctStocks <= 1) advice.push({ tip: 'diversify', text: '把資金分散到不同風險的標的，例如 ETF 搭配穩健的金融股，降低波動。' });
    if (r.realizedPnL < 0) advice.push({ tip: 'panic', text: '市場下跌時先冷靜評估，避免恐慌性賣出把帳面損失變成真正損失。' });
    if (r.finalAge < 65 || r.finalStage !== 'elder' || r.endReason === 'bankrupt') advice.push({ tip: 'retirement', text: '退休後收入會大幅下降，建議在中年就試算退休金缺口並提早準備。' });
    if (r.avgHealth < 70 || r.endReason === 'death') advice.push({ tip: 'healthwealth', text: '健康是最重要的資產，適度投資在運動與健康檢查上，能減少晚年醫療支出。' });
    advice.push({ tip: 'budget', text: '可以用 50/30/20 法則分配收入：必要支出 50%、想要 30%、儲蓄投資 20%。' });
    if (advice.length < 4) advice.push({ tip: 'dca', text: '嘗試定期定額投入指數型 ETF，不必預測高低點，也能平均成本。' });

    return { score, grade, summary, decisions, advice: advice.slice(0, 5), breakdown: { longevity, wealth, health, invest, ending }, source: 'local' };
  }

  const OFFLINE_REASON = {
    ai_unavailable: 'AI 評分服務暫時無法使用',
    daily_limit: '今天的 AI 評分次數已達上限',
    game_not_found: '找不到這局的伺服器紀錄',
  };

  // 回傳 { evaluation, rank, offlineReason }；rank 為 null 代表沒有列入全服排行榜
  async function evaluate(record) {
    if (record.gameId) {
      try {
        const { evaluation, rank } = await API.evaluate(record.gameId, record);
        return { evaluation, rank, offlineReason: null };
      } catch (e) {
        console.warn('AI 評分失敗，改用本機評分', e);
        return { evaluation: localEvaluate(record), rank: null, offlineReason: OFFLINE_REASON[e.code] || '無法連線伺服器' };
      }
    }
    return { evaluation: localEvaluate(record), rank: null, offlineReason: '遊戲開始時未連線伺服器' };
  }

  window.AI = { evaluate };
})();
