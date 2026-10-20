/* 結算頁：AI 評分、全服排名、總結、決策回顧、建議 */
(function () {
  const $ = (s) => document.querySelector(s);
  UI.fillIcons();

  const record = Store.session.get('lastResult');
  const main = $('#main');

  if (!record) {
    $('#loading').hidden = true;
    $('#empty').hidden = false;
    main.setAttribute('aria-busy', 'false');
    return;
  }

  const STAGE_NAME = Object.fromEntries(GameData.stages.map((s) => [s.id, s.name]));
  $('#result-meta').textContent = `${record.jobIcon} ${record.jobName}・${record.endReasonText}`;

  (async () => {
    // 重新整理頁面時沿用同一份評分
    const evaluation = record.evaluation || await AI.evaluate(record);
    if (!record.evaluation) {
      record.evaluation = evaluation;
      Store.session.set('lastResult', record);
      Store.addHistory({
        id: record.id,
        jobName: record.jobName,
        finalAge: record.finalAge,
        endReason: record.endReason,
        netWorth: record.netWorth,
        score: evaluation.score,
        grade: evaluation.grade,
        endedAt: record.endedAt,
      });
    }
    const best = Store.getBestScore();
    const rank = await AI.getGlobalRank(best);
    const fresh = Store.unlockTips(evaluation.advice.map((a) => a.tip).filter(Boolean));
    render(evaluation, best, rank, fresh);
  })();

  function render(ev, best, rank, freshTips) {
    $('#loading').hidden = true;
    $('#content').hidden = false;
    main.setAttribute('aria-busy', 'false');

    // 評分
    const ring = $('#score-ring');
    ring.setAttribute('aria-label', `AI 評分 ${ev.score} 分（滿分 100），等級 ${ev.grade}`);
    $('#score-grade').textContent = `${ev.grade} 級`;
    animateScore(ev.score);

    // 排名
    $('#rank-big').textContent = `第 ${rank.rank.toLocaleString('zh-TW')} 名`;
    $('#rank-sub').textContent = `個人最高分 ${best} 分・前 ${rank.topPercent}%（共 ${rank.total.toLocaleString('zh-TW')} 位玩家）`;
    $('#rank-note').textContent = rank.simulated ? '＊目前為模擬排名，接上伺服器後顯示真實全服排名' : '';

    // 數據
    const stats = [
      ['最終年齡', `${record.finalAge} 歲`],
      ['結束階段', STAGE_NAME[record.finalStage] || ''],
      ['淨資產', UI.fmtMoney(record.netWorth)],
      ['最高淨資產', UI.fmtMoney(record.peakNetWorth)],
      ['現金', UI.fmtMoney(record.finalCash)],
      ['股票市值', UI.fmtMoney(record.stockValue)],
      ['平均健康', `${record.avgHealth} / 100`],
      ['回合數', `${record.turns} 回合`],
    ];
    $('#stat-grid').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${UI.escape(v)}</dd></div>`).join('');

    $('#summary').textContent = ev.summary;

    const BADGE = { good: '好決策', bad: '待改進', info: '紀錄' };
    $('#decision-list').innerHTML = ev.decisions.map((d) => `
      <li data-type="${d.type}"><span class="badge">${BADGE[d.type] || '紀錄'}</span><span>${UI.escape(d.text)}</span></li>`).join('');

    $('#advice-list').innerHTML = ev.advice.map((a) => `<li>${UI.escape(a.text)}</li>`).join('');

    if (freshTips.length) {
      const names = freshTips.map((id) => GameData.tips.find((t) => t.id === id)?.title).filter(Boolean);
      $('#unlock-note').textContent = `💡 解鎖了 ${names.length} 則新提示：${names.join('、')}（可在首頁「歷史取得提示」查看）`;
    }

  }

  function animateScore(score) {
    const ring = $('#score-ring');
    const num = $('#score-num');
    if (UI.reducedMotion()) {
      num.textContent = score;
      ring.style.setProperty('--p', score);
      return;
    }
    const start = performance.now();
    const dur = 1000;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const v = Math.round(score * (1 - Math.pow(1 - t, 3)));
      num.textContent = v;
      ring.style.setProperty('--p', v);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
})();
