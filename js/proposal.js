/*
 * 保險建議書：proposal.html?product=險種id&age=年齡&job=職業id&surcharge=健康加費倍率&amount=月繳
 * 正式文件版面：要保資料 → 重要事項說明（條款模板）→ 保費試算 → 聲明及簽章。
 * 條款文字是固定模板，數字一律從 js/data.js 的險種設定帶入，保費由 Insurance.illustrate 公式試算，不呼叫 AI。
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const prod = Insurance.PRODUCTS[params.get('product')];
  const paper = $('#paper');
  const num = (n) => Math.round(n).toLocaleString('zh-TW');
  const ntd = (n) => `新臺幣 ${num(n)} 元`;
  const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const CFG = GameData.insurance;

  $('#btn-print').addEventListener('click', () => window.print());
  // 嵌在遊戲頁的視窗裡（?embed=1）：通知遊戲頁關閉視窗，不換頁，遊戲才不會重新開局
  const embedded = params.has('embed') && window.parent !== window;
  const close = () => {
    if (embedded) window.parent.postMessage({ type: 'proposal-close' }, location.origin);
    else window.close();
  };
  $('#btn-close').addEventListener('click', close);
  if (embedded) document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  if (!prod || prod.legacy) {
    paper.innerHTML = '<p>查無此險種之建議書。</p>';
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

  const PRICING_TEXT = { level: '平準費率', natural: '自然費率（逐年依到達年齡調整）', job: '職業等級費率', amount: '彈性保費（要保人自選）' };
  const TAG = Insurance.TAG_NAME;
  const tagList = (tags) => (tags || []).map((t) => TAG[t]).join('、');
  const coverPeriod = () => (prod.coverUntilAge === Infinity ? '終身' : `至被保險人保險年齡達 ${prod.coverUntilAge} 歲之保單週年日前一日止`);
  const payPeriod = () => {
    if (prod.payMonths) return `${prod.payMonths / 12} 年期，按月繳納`;
    if (prod.payUntilAge) return `繳至被保險人保險年齡達 ${prod.payUntilAge} 歲止，按月繳納`;
    if (prod.id === 'invest') return '彈性繳費，要保人得申請停止或恢復繳納';
    return '一年期，按月繳納，期滿依續保時之年齡及費率續保';
  };
  const rateTable = () => Object.entries(prod.premium).map(([a, v]) => `${a} 歲 ${num(v)} 元`).join('、');
  const surchargeText = () => {
    const list = prod.surcharges || [{ below: 70, rate: 0.3 }];
    if (!list.length) return '本商品不因被保險人健康狀況加收保險費。';
    return `被保險人經核保評估為次標準體者，本公司得按標準費率加收保險費：${list.map((s) => `健康指數未達 ${s.below} 者加收 ${Math.round(s.rate * 100)}%`).join('；')}。`;
  };

  // 共用條款
  const DEATH_EXCLUDE = [
    '要保人故意致被保險人於死。',
    '被保險人故意自殺或自成殘廢；但自契約訂立或復效之日起二年後故意自殺致死者，本公司仍負給付責任。',
    '被保險人因犯罪處死或拒捕或越獄致死。',
  ];
  const ACCIDENT_EXCLUDE = [
    '要保人、被保險人之故意行為。',
    '被保險人犯罪行為。',
    '被保險人飲酒後駕（騎）車，其吐氣或血液所含酒精成份超過道路交通法令規定標準者。',
    '戰爭（不論宣戰與否）、內亂及其他類似之武裝變亂。',
    '因原子或核子能裝置所引起之爆炸、灼熱、輻射或污染。',
  ];
  const PRE_EXISTING = '被保險人於本契約生效日前已罹患之疾病或已發生之傷害，及其所致之後續診療、手術或住院，本公司不負給付責任。';
  const waitClause = () => {
    if (!prod.waitMonths) return '本契約無等待期間，自本公司同意承保且收取第一期保險費後生效。';
    const accidentOk = prod.id === 'medical' || prod.id === 'daily';
    return `本契約自生效日起 ${prod.waitMonths} 個月為等待期間。被保險人於等待期間內經診斷確定罹患本契約承保之疾病者，本公司不負給付責任${accidentOk ? '；但因意外傷害事故所致之住院診療，不受等待期間之限制' : ''}${prod.refundInWait ? '；本公司將無息退還已繳保險費，本契約效力即行終止' : ''}。`;
  };

  // 各險種條款：scope 保障範圍、method 給付方式、exclude 除外責任及不保事項、proviso 但書及特別約定
  const TERMS = {
    life: () => ({
      scope: ['被保險人於本契約有效期間內身故者。'],
      method: [`本公司按保險金額 ${ntd(prod.benefit.death)} 給付身故保險金，本契約效力即行終止。`],
      exclude: DEATH_EXCLUDE,
      proviso: ['本契約為定期保險，保險期間屆滿時被保險人仍生存者，本公司不給付滿期保險金，亦無解約金。', '保險費為平準費率，於投保時依被保險人投保年齡決定，繳費期間內不予調整。'],
    }),
    accident: () => ({
      scope: ['被保險人於本契約有效期間內，遭受外來突發之意外傷害事故，致其身體蒙受傷害而需診療或致死亡者。', '本契約所稱意外傷害事故，指非由疾病引起之外來突發事故。'],
      method: [
        `意外傷害醫療保險金：按被保險人實際支出之醫療費用給付，每次事故以 ${ntd(prod.benefit.medicalMax)} 為限。`,
        `意外身故保險金：被保險人因意外傷害事故致死亡者，按 ${ntd(prod.benefit.death)} 給付。`,
        '同一事故另有其他實支實付型保險契約者，本契約優先給付，其他契約就剩餘醫療費用計算。',
      ],
      exclude: [...ACCIDENT_EXCLUDE, '被保險人因疾病所致之診療、住院或死亡。'],
      proviso: [`保險費依被保險人職業等級計算，不因年齡調整：${GameData.jobs.map((j) => `${j.name} ${num(prod.jobPremium[j.id] ?? prod.jobPremium.default)} 元`).join('、')}（每月）。被保險人變更職業者，應通知本公司調整保險費。`, '本契約為一年期，期滿自動續保。'],
    }),
    medical: () => ({
      scope: [`被保險人於本契約有效期間內，因${tagList(prod.covers)}經醫師診斷必須住院診療者。`],
      method: [
        `本公司按被保險人實際支出之醫療費用之 ${Math.round(prod.benefit.rate * 100)}% 給付，每次住院以 ${ntd(prod.benefit.max)} 為限。`,
        '同一事故另有意外傷害保險已給付者，本公司就扣除該給付後之剩餘醫療費用計算，合計不超過實際支出。',
      ],
      exclude: [PRE_EXISTING, ...ACCIDENT_EXCLUDE.slice(0, 2), '美容手術、外科整型、非因治療目的之牙科處置及健康檢查。'],
      proviso: [`本契約採自然費率，續保時依被保險人到達年齡重新計算保險費。費率表：${rateTable()}（每月），其餘年齡依費率表內插計算。`],
    }),
    major: () => ({
      scope: [`被保險人於本契約有效期間內，經診斷確定罹患${tagList(prod.covers)}，並取得全民健康保險重大傷病證明者。`],
      method: [`本公司按 ${ntd(prod.benefit.lumpSum)} 給付重大傷病保險金，給付以一次為限，給付後本契約效力即行終止。`],
      exclude: [PRE_EXISTING, ...DEATH_EXCLUDE.slice(0, 1)],
      proviso: [`被保險人投保前曾罹患${tagList(prod.excludeHistory)}者，本公司不予承保。`, '本保險金與本公司其他癌症、醫療保險之給付，得同時申請。'],
    }),
    specific: () => ({
      scope: [`被保險人於本契約有效期間內，經診斷確定初次罹患${tagList(prod.covers)}者。`],
      method: [`每一項特定傷病按 ${ntd(prod.benefit.lumpSum)} 給付，各項以給付一次為限；${tagList(prod.covers)}均已給付後，本契約效力即行終止。`],
      exclude: [PRE_EXISTING, '癌症不屬本契約承保範圍。'],
      proviso: [`被保險人投保前曾罹患${tagList(prod.excludeHistory)}者，本公司不予承保。`],
    }),
    cancer: () => ({
      scope: ['被保險人於本契約有效期間內，經病理檢驗診斷確定初次罹患癌症者。'],
      method: [
        `初次罹癌保險金：按 ${ntd(prod.benefit.lumpSum)} 一次給付。`,
        `癌症治療保險金：自診斷確定之次月起，每月給付 ${ntd(prod.benefit.monthly)}，共 ${prod.benefit.months} 個月，給付完畢後本契約效力即行終止。`,
        '被保險人經診斷確定罹患癌症後，免繳續期保險費。',
      ],
      exclude: [PRE_EXISTING, '癌症以外之其他疾病，不屬本契約承保範圍。'],
      proviso: ['被保險人投保前曾罹患癌症者，本公司不予承保。', '本保險金與重大傷病保險金得同時申請。'],
    }),
    ltc: () => ({
      scope: [`被保險人於本契約有效期間內，經專科醫師診斷確定為長期照顧狀態（遊戲中以健康指數 ${CFG.ltc.health} 以下判定）者。`],
      method: [
        `長期照顧狀態持續 ${prod.benefit.delayMonths} 個月後，本公司按 ${ntd(prod.benefit.lumpSum)} 給付長期照顧一次保險金。`,
        `此後被保險人仍生存且持續長期照顧狀態者，每月給付長期照顧分期保險金 ${ntd(prod.benefit.monthly)}。`,
        '自開始給付之日起，免繳續期保險費。',
      ],
      exclude: [PRE_EXISTING, ...ACCIDENT_EXCLUDE.slice(0, 2)],
      proviso: [`被保險人投保前曾有${tagList(prod.excludeHistory)}紀錄者，本公司不予承保。`, `長期照顧狀態期間，每月照護支出約 ${ntd(CFG.ltc.careCost)}，本保險金不以實際支出為限。`],
    }),
    invest: () => ({
      scope: ['被保險人於本契約有效期間內身故者。', '保險費扣除費用後，依要保人指定之投資標的（台灣50 ETF）配置於保單帳戶。'],
      method: [
        `身故保險金：按 ${ntd(prod.benefit.death)} 與保單帳戶價值兩者取其大者給付。`,
        `前置費用：第 1 至第 ${prod.fee.months / 12} 保單年度為所繳保險費之 ${Math.round(prod.fee.early * 100)}%，第 ${prod.fee.months / 12 + 1} 保單年度起為 ${Math.round(prod.fee.later * 100)}%。`,
        '保險成本：每月依被保險人到達年齡自保單帳戶扣除，年齡愈高成本愈高。',
      ],
      exclude: DEATH_EXCLUDE,
      proviso: [
        '本商品之投資標的價值隨市場波動，要保人須自行承擔投資風險，本金可能發生虧損，過去績效不代表未來表現。',
        `第 1 至第 ${prod.surrenderPenalty.months / 12} 保單年度申請解約者，按保單帳戶價值收取 ${Math.round(prod.surrenderPenalty.rate * 100)}% 解約費用。`,
        '保單帳戶價值不足扣除保險成本時，本契約效力即行停止。',
      ],
    }),
    daily: () => ({
      scope: [`被保險人於本契約有效期間內，因${tagList(prod.covers)}經醫師診斷必須住院診療者。`],
      method: [
        `按實際住院日數，每日給付 ${ntd(prod.benefit.perDay)}，每次住院以 ${prod.benefit.maxDays} 日為限。`,
        '本保險金不以實際醫療費用為限，得與實支實付型醫療保險同時申請。',
      ],
      exclude: [PRE_EXISTING, ...ACCIDENT_EXCLUDE.slice(0, 2), '非因治療目的之住院、健康檢查或療養。'],
      proviso: [`本契約採自然費率，續保時依被保險人到達年齡重新計算保險費。費率表：${rateTable()}（每月），其餘年齡依費率表內插計算。`],
    }),
    wholelife: () => ({
      scope: ['被保險人於本契約有效期間內身故者。'],
      method: [`本公司按 ${ntd(prod.benefit.death)} 與當時保單解約金兩者取其大者給付身故保險金，本契約效力即行終止。`],
      exclude: DEATH_EXCLUDE,
      proviso: [
        '本契約為分紅保險單，保單紅利之分配非本公司保證之事項，可能為零；試算表所列解約金含預估紅利，實際以本公司公告為準。',
        '保單前期解約金低於累計所繳保險費，提前解約可能損及要保人權益。',
      ],
    }),
    annuity: () => ({
      scope: ['被保險人於年金給付開始日仍生存者，本公司依約定給付年金。'],
      method: [
        `累積期間：所繳保險費以宣告利率年利 ${Math.round(prod.rate * 1000) / 10}% 累積保單價值準備金。`,
        `年金給付：自被保險人保險年齡達 ${prod.payoutAge} 歲起按月給付年金，保證給付期間 ${prod.guaranteeMonths / 12} 年。`,
        '年金給付開始日前身故者，返還保單價值準備金；保證期間內身故者，將未支領之保證年金一次給付。',
      ],
      exclude: ['本契約不需核保，無疾病除外責任。'],
      proviso: [
        `解約費用：第 1 至第 ${prod.surrenderByYear.length} 保單年度申請解約者，分別按保單價值準備金之 ${prod.surrenderByYear.map((r) => `${Math.round(r * 100)}%`).join('、')} 收取。`,
        '年金給付開始後，不得申請解約。宣告利率非保證，試算以目前宣告利率計算。',
      ],
    }),
  };

  function clauses(t) {
    const list = [
      ['保險期間及繳費期間', [`保險期間：${coverPeriod()}。`, `繳費期間：${payPeriod()}。`, `保費計算基礎：${PRICING_TEXT[prod.pricing]}。`]],
      ['契約撤銷權（猶豫期間）', ['要保人得於保險單送達之翌日起算十日內，以書面檢同保險單親自或掛號郵寄向本公司撤銷本契約。本公司將無息退還已繳保險費，本契約自始無效。']],
      ['等待期間', [waitClause()]],
      ['保障範圍', t.scope],
      ['保險金給付方式', t.method],
      ['除外責任及不保事項', t.exclude],
      ['但書及特別約定', t.proviso],
      ['核保、寬限期間及停效', [
        `投保年齡：本商品最高投保年齡為 ${prod.maxEntryAge} 歲；${prod.minHealth ? `被保險人健康指數未達 ${prod.minHealth} 者，本公司不予承保` : '本商品不需核保'}。`,
        surchargeText(),
        `要保人未於應繳日繳納保險費者，自應繳日翌日起 ${CFG.graceMonths} 個月為寬限期間；逾寬限期間仍未繳納者，本契約自寬限期間終了翌日起停止效力。`,
      ]],
    ];
    return list.map(([h, items], i) => `
      <div class="clause">
        <h3>${CN[i]}、${h}</h3>
        ${items.length > 1 ? `<ol>${items.map((x) => `<li>${UI.escape(x)}</li>`).join('')}</ol>` : `<p>${UI.escape(items[0])}</p>`}
      </div>`).join('');
  }

  function render() {
    const rows = Insurance.illustrate(prod, { age, jobId: job.id, amount, surcharge });
    const first = rows[0] || { premium: 0 };
    const monthly = Math.round(first.premium / 12);
    const hasDeath = rows.some((r) => r.death != null);
    const hasSurrender = rows.some((r) => r.surrender > 0);
    const hasNote = rows.some((r) => r.note);
    const totalPaid = rows.length ? rows[rows.length - 1].total : 0;
    const now = new Date();
    const today = `中華民國 ${now.getFullYear() - 1911} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
    const docNo = `RL-${prod.id.toUpperCase()}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(Math.floor(age * 100)).padStart(4, '0')}`;

    document.title = `${prod.name}建議書`;
    paper.innerHTML = `
      <header class="doc-head">
        <p class="doc-brand">現實人生人壽保險股份有限公司</p>
        <h1>${UI.escape(prod.name)}　保險建議書</h1>
        <p class="doc-no">建議書編號：${docNo}　　試算日期：${today}</p>
      </header>

      <section class="doc-section">
        <h2>壹、要保資料</h2>
        <table class="doc-meta">
          <tbody>
            <tr><th scope="row">商品名稱</th><td>${UI.escape(prod.name)}</td><th scope="row">被保險人職業</th><td>${UI.escape(job.name)}</td></tr>
            <tr><th scope="row">投保年齡</th><td>${Math.floor(age)} 歲</td><th scope="row">費率基礎</th><td>${PRICING_TEXT[prod.pricing]}</td></tr>
            <tr><th scope="row">繳費期間</th><td>${Insurance.payTermText(prod).replace(/^繳 /, '')}</td><th scope="row">保險期間</th><td>${Insurance.coverText(prod).replace(/^保障到/, '至')}</td></tr>
            <tr><th scope="row">首期月繳保費</th><td>${ntd(monthly)}${surcharge > 1 ? `（含次標準體加費 ${Math.round((surcharge - 1) * 100)}%）` : ''}</td><th scope="row">試算總繳保費</th><td>${ntd(totalPaid)}</td></tr>
          </tbody>
        </table>
      </section>

      <section class="doc-section">
        <h2>貳、重要事項說明</h2>
        ${clauses(TERMS[prod.id]())}
      </section>

      <section class="doc-section">
        <h2>參、保險費及保單價值試算表</h2>
        <p class="doc-note">單位：新臺幣元。下表為依目前費率及假設條件之預估值，非保證給付金額。${prod.id === 'invest' ? `投資標的假設年報酬率 ${Math.round(CFG.illustrateReturn * 100)}%，假設繳費至 65 歲。` : ''}${prod.id === 'wholelife' ? '解約金含預估紅利。' : ''}${!hasDeath && !hasSurrender ? '本商品為保障型保險，無解約金及保單價值。' : ''}</p>
        <div class="doc-table-wrap">
          <table class="doc-table">
            <thead>
              <tr>
                <th scope="col">保單<br>年度</th><th scope="col">保險<br>年齡</th><th scope="col">年繳化<br>保險費</th><th scope="col">累計<br>保險費</th>
                ${hasDeath ? '<th scope="col">身故<br>保險金</th>' : ''}
                ${hasSurrender ? '<th scope="col">年度末<br>解約金</th>' : ''}
                ${hasNote ? '<th scope="col">備註</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => `
                <tr class="${r.year % 5 === 0 ? 'mark' : ''}">
                  <td>${r.year}</td><td>${Math.floor(r.age)}</td><td>${r.premium ? num(r.premium) : '—'}</td><td>${num(r.total)}</td>
                  ${hasDeath ? `<td>${r.death == null ? '—' : num(r.death)}</td>` : ''}
                  ${hasSurrender ? `<td>${num(r.surrender)}</td>` : ''}
                  ${hasNote ? `<td>${UI.escape(r.note)}</td>` : ''}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <section class="doc-section">
        <h2>肆、聲明事項</h2>
        <ol class="doc-declare">
          <li>本建議書僅供參考，實際權利義務以保險單條款為準。</li>
          <li>要保人已瞭解本商品之保障範圍、除外責任、等待期間及解約金等重要事項，並經業務員詳細說明。</li>
          <li>要保人及被保險人應據實告知，如有故意隱匿或過失遺漏，本公司得依保險法第六十四條解除契約。</li>
        </ol>
        <table class="doc-sign">
          <tbody>
            <tr><th scope="row">要保人簽章</th><td></td><th scope="row">被保險人簽章</th><td></td></tr>
            <tr><th scope="row">業務員簽章</th><td></td><th scope="row">日　　期</th><td></td></tr>
          </tbody>
        </table>
      </section>

      <footer class="doc-foot">
        <p>本建議書為「現實人生」遊戲中之示意文件，非真實保險商品，所載公司名稱亦屬虛構。</p>
      </footer>`;
  }

  render();
})();
