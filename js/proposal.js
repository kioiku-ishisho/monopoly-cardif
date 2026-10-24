/*
 * 保險建議書：proposal.html?product=險種id&age=年齡&job=職業id&surcharge=健康加費倍率&amount=月繳
 * 依 Insurance.illustrate 逐年試算，版面參考真實保險建議書；按「列印／另存 PDF」用瀏覽器列印成 PDF。
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const prod = Insurance.PRODUCTS[params.get('product')];
  const paper = $('#paper');
  const num = (n) => Math.round(n).toLocaleString('zh-TW');

  $('#btn-print').addEventListener('click', () => window.print());
  $('#btn-close').addEventListener('click', () => (history.length > 1 ? history.back() : window.close()));

  if (!prod || prod.legacy) {
    paper.innerHTML = '<p>找不到這個險種的建議書。</p>';
    return;
  }

  const age = Math.max(GameData.economy.startAge, Math.min(100, Number(params.get('age')) || GameData.economy.startAge));
  const job = GameData.jobs.find((j) => j.id === params.get('job')) || GameData.jobs[0];
  const surcharge = Number(params.get('surcharge')) || 1;
  let amount = Number(params.get('amount')) || (prod.amounts ? prod.amounts[1] : 0);

  if (prod.amounts) {
    const sel = $('#amount-select');
    sel.innerHTML = prod.amounts.map((a) => `<option value="${a}"${a === amount ? ' selected' : ''}>${num(a)} 元</option>`).join('');
    sel.addEventListener('change', () => { amount = Number(sel.value); render(); });
    $('#amount-pick').hidden = false;
  }

  const PRICING_TEXT = { level: '平準費率（投保時鎖定）', natural: '自然費率（每年依年齡調整）', job: '依職業等級', amount: '自選金額' };

  function render() {
    const rows = Insurance.illustrate(prod, { age, jobId: job.id, amount, surcharge });
    const first = rows[0] || { premium: 0 };
    const monthly = Math.round(first.premium / 12);
    const hasDeath = rows.some((r) => r.death != null);
    const hasSurrender = rows.some((r) => r.surrender > 0);
    const hasNote = rows.some((r) => r.note);
    const covers = (prod.covers || []).map((t) => Insurance.TAG_NAME[t]).join('、');
    const exclude = (prod.excludeHistory || []).map((t) => Insurance.TAG_NAME[t]).join('、');
    const totalPaid = rows.length ? rows[rows.length - 1].total : 0;
    const today = new Date().toLocaleDateString('zh-TW');

    document.title = `人生富翁｜${prod.name}建議書`;
    paper.innerHTML = `
      <header class="doc-head">
        <p class="doc-brand">人生富翁人壽（遊戲示意）</p>
        <h1>${prod.icon} ${UI.escape(prod.name)} 建議書</h1>
      </header>

      <table class="doc-meta">
        <tbody>
          <tr><th scope="row">被保險人</th><td>${job.icon} ${UI.escape(job.name)}</td><th scope="row">投保年齡</th><td>${Math.floor(age)} 歲</td></tr>
          <tr><th scope="row">保費計算</th><td>${PRICING_TEXT[prod.pricing]}</td><th scope="row">首年月繳保費</th><td><strong>${num(monthly)} 元</strong>${surcharge > 1 ? `（含健康加費 ${Math.round((surcharge - 1) * 100)}%）` : ''}</td></tr>
          <tr><th scope="row">繳費年期</th><td>${Insurance.payTermText(prod)}</td><th scope="row">保障期間</th><td>${Insurance.coverText(prod)}</td></tr>
          <tr><th scope="row">等待期</th><td>${Insurance.waitText(prod)}</td><th scope="row">試算總繳保費</th><td>${num(totalPaid)} 元</td></tr>
        </tbody>
      </table>

      <section class="doc-section">
        <h2>保障內容</h2>
        <p class="doc-summary">${UI.escape(prod.summary)}</p>
        <ul>
          ${covers ? `<li>理賠範圍：${covers}</li>` : ''}
          ${exclude ? `<li>投保限制：有${exclude}病史者不可投保</li>` : ''}
          <li>投保條件：${prod.maxEntryAge} 歲以前、${prod.minHealth ? `健康指數 ${prod.minHealth} 以上` : '不需核保'}</li>
          <li>${UI.escape(prod.note)}</li>
        </ul>
      </section>

      <section class="doc-section">
        <h2>逐年保費與保單價值表（預估值）</h2>
        ${!hasDeath && !hasSurrender ? '<p class="doc-note">本險種為保障型（消耗型）保險，沒有儲蓄價值，也沒有解約金；保障內容見上方。</p>' : ''}
        ${prod.id === 'invest' ? `<p class="doc-note">投資型帳戶以年報酬 ${Math.round(GameData.insurance.illustrateReturn * 100)}% 假設試算，實際依台灣50 ETF 漲跌而定，可能虧損本金。</p>` : ''}
        ${prod.id === 'wholelife' ? '<p class="doc-note">解約金含預估紅利，紅利非保證給付項目。</p>' : ''}
        <div class="doc-table-wrap">
          <table class="doc-table">
            <thead>
              <tr>
                <th scope="col">保單<br>年度</th><th scope="col">年齡</th><th scope="col">年度保費</th><th scope="col">累計保費</th>
                ${hasDeath ? '<th scope="col">身故給付</th>' : ''}
                ${hasSurrender ? '<th scope="col">年度末<br>解約金</th>' : ''}
                ${hasNote ? '<th scope="col">備註</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => `
                <tr class="${r.year % 5 === 0 ? 'mark' : ''}">
                  <td>${r.year}</td><td>${Math.floor(r.age)}</td><td>${r.premium ? num(r.premium) : ''}</td><td>${num(r.total)}</td>
                  ${hasDeath ? `<td>${r.death == null ? '—' : num(r.death)}</td>` : ''}
                  ${hasSurrender ? `<td>${num(r.surrender)}</td>` : ''}
                  ${hasNote ? `<td>${UI.escape(r.note)}</td>` : ''}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <footer class="doc-foot">
        <p>本建議書為「人生富翁」遊戲中的示意試算，非真實保險商品，金額單位為新台幣元。</p>
        <p>實際保險商品內容以保單條款為準；購買前請確認自己的需求、保障範圍與除外責任。試算日：${today}</p>
      </footer>`;
  }

  render();
})();
