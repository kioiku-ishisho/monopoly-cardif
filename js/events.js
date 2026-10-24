/*
 * 格子事件
 *   機會：從資料庫抽一張本局未抽過的機會牌，玩家選擇接受或放棄
 *   命運：從資料庫抽一張本局未抽過的命運牌，抽到即發生；依疾病標籤（js/data.js 的 cardTags）理賠
 *   保險：業務員隨機介紹 3 種險種（js/data.js 的 insurance、js/insurance.js）
 *   住院：擲骰決定住院天數、支付醫療費並理賠，之後暫停移動 1 回合
 *   特殊格：保單健檢、理財講座、觀念挑戰、貴人相助、保險優惠、保單整理日、錯過優惠（數值在 js/data.js 的 specialTiles）
 *   休息：什麼事都沒發生
 *
 * handler 為 async (tile, ctx) => void，ctx 由 js/game.js 提供：
 *   ctx.state / ctx.stats / ctx.job / ctx.age() / ctx.stageId() / ctx.gameId()
 *   ctx.applyEffects({ cash, netIncome, health }, 原因, 圖示)
 *   ctx.insurance（Insurance.create 的結果）/ ctx.stopIncome(月數) / ctx.logDecision(文字, 分類) / ctx.alert(opts)
 *   ctx.rollDice() / ctx.moveForward(格數) / ctx.renderStatus() / ctx.addHistory(kind, icon, text)
 */
(function () {
  const KIND_LABEL = { chance: '機會', fate: '命運', hospital: '住院' };

  function effectItems({ cash, netIncome, health }) {
    const items = [];
    if (cash) items.push(`💰 現金 ${UI.fmtSigned(cash)}`);
    if (netIncome) items.push(`📅 淨收入 ${UI.fmtSigned(netIncome)}/月`);
    if (health) items.push(`❤️ 健康 ${health > 0 ? '+' : ''}${health}`);
    return items;
  }

  function cardHtml(card, { note = '', warn = false, extra = [], hideEffects = false } = {}) {
    const items = hideEffects ? [] : [...effectItems(card), ...extra];
    return `
      <div class="event-card" data-kind="${card.kind}">
        <div class="card-kind"><span>${GameData.tileTypes[card.kind].icon} ${KIND_LABEL[card.kind]}</span><span class="card-id">${UI.escape(card.id)}</span></div>
        <p class="card-text">${UI.escape(card.text)}</p>
        ${items.length ? `<ul class="effect-list" aria-label="影響">${items.map((t) => `<li>${UI.escape(t)}</li>`).join('')}</ul>` : ''}
        ${note ? `<p class="card-note${warn ? ' warn' : ''}">${UI.escape(note)}</p>` : ''}
      </div>`;
  }

  // 抽牌；無法抽時以提示訊息帶過並回傳 null
  async function drawCard(kind, ctx) {
    const gameId = ctx.gameId();
    if (!gameId) {
      UI.toast('未連線事件資料庫，本格略過');
      return null;
    }
    try {
      const card = await API.draw(gameId, kind, ctx.stageId());
      if (!card) UI.toast(`這個階段的${KIND_LABEL[kind]}牌已全部抽過`);
      return card;
    } catch (e) {
      console.error(e);
      UI.toast('抽牌失敗，本格略過');
      return null;
    }
  }

  async function chance(tile, ctx) {
    const card = await drawCard('chance', ctx);
    if (!card) return;
    // 選擇前不透露效果，讓玩家依情境判斷
    const choice = await UI.modal({
      title: '抽到機會牌',
      body: cardHtml(card, { hideEffects: true, note: '要接受這個機會嗎？放棄則沒有任何影響。' }),
      actions: [
        { label: '放棄', value: 'decline', variant: 'ghost' },
        { label: '接受', value: 'accept', variant: 'primary' },
      ],
      dismissible: false,
    });
    const accepted = choice === 'accept';
    API.recordChoice(ctx.gameId(), card.id, accepted);
    if (accepted) {
      ctx.stats.chanceAccepted++;
      const before = { cash: ctx.state.cash, netIncomeAdj: ctx.state.netIncomeAdj, health: ctx.state.health };
      ctx.applyEffects(card, `接受機會：${card.text}`, '❓');
      ctx.logDecision(`接受「${card.text}」（${effectItems(card).join('、')}）`, 'chance-accept');
      await showOutcome(card, before, ctx.state);
    } else {
      ctx.stats.chanceDeclined++;
      ctx.logDecision(`放棄「${card.text}」`, 'chance-decline');
      UI.toast('已放棄這個機會，沒有任何影響');
    }
  }

  // 接受機會後，顯示各項數據的變化（之前 → 之後）
  function showOutcome(card, before, after) {
    const rows = [];
    if (card.cash) rows.push(['💰 現金', UI.fmtMoney(before.cash), UI.fmtMoney(after.cash), UI.fmtSigned(card.cash), card.cash > 0]);
    if (card.netIncome) {
      rows.push(['📅 每月淨收入變化', `${UI.fmtSigned(before.netIncomeAdj)}/月`, `${UI.fmtSigned(after.netIncomeAdj)}/月`,
        `${UI.fmtSigned(card.netIncome)}/月`, card.netIncome > 0]);
    }
    if (card.health) {
      const diff = after.health - before.health;
      rows.push(['❤️ 健康', before.health, after.health, `${diff >= 0 ? '+' : ''}${diff}`, diff >= 0]);
    }
    return UI.modal({
      title: '機會結果',
      body: `
        <div class="event-card" data-kind="chance">
          <p class="card-text">${UI.escape(card.text)}</p>
          ${rows.length ? `
            <table class="data-table outcome-table">
              <caption class="sr-only">數據變化</caption>
              <thead><tr><th scope="col">項目</th><th scope="col">之前</th><th scope="col">之後</th><th scope="col">變化</th></tr></thead>
              <tbody>${rows.map(([name, b, a, d, good]) => `
                <tr><th scope="row">${name}</th><td>${b}</td><td>${a}</td><td class="${good ? 'pos' : 'neg'}">${d}</td></tr>`).join('')}
              </tbody>
            </table>` : '<p class="card-note">沒有任何數據變化。</p>'}
        </div>`,
      actions: [{ label: '確定', value: 'ok', variant: 'primary' }],
      dismissible: false,
    });
  }

  async function fate(tile, ctx) {
    const card = await drawCard('fate', ctx);
    if (!card) return;
    ctx.stats.fateCount++;
    await resolveFate(card, ctx, { title: '抽到命運牌', tag: GameData.cardTagOf[card.id] || null });
  }

  // 重大疾病（js/game.js 依年齡與健康觸發）
  async function illness(ev, ctx) {
    const card = { kind: 'fate', id: '重大疾病', cash: 0, netIncome: 0, health: 0, ...ev };
    await resolveFate(card, ctx, { title: '🚑 健康警訊', tag: ev.tag });
  }

  // 命運事件：依疾病標籤理賠，再套用影響
  async function resolveFate(card, ctx, { title, tag, reason = `命運：${card.text}` }) {
    const cost = card.cash < 0 ? -card.cash : 0;
    const result = ctx.insurance.claim({ tag, cost });
    const extra = [];
    if (tag) extra.push(`🏷️ ${Insurance.TAG_NAME[tag]}`);
    if (card.stopMonths && ctx.stageId() !== 'elder') extra.push(`⏸️ 停薪 ${card.stopMonths} 個月`);
    result.items.forEach((i) => extra.push(`🛡️ ${i.name} ${UI.fmtSigned(i.amount)}`));
    const notes = [
      ...result.items.map((i) => `${i.name}：${i.note}`),
      ...result.denied.map((d) => `${d.name}不理賠：${d.reason}`),
    ];
    let note = '命運無法選擇，只能面對。';
    if (result.total) note = '還好有投保，減輕了這次的損失。';
    else if (tag && (cost || ['cancer', 'heart', 'stroke', 'esrd'].includes(tag))) note = '沒有適用的保險，費用必須全部自付。';
    await UI.modal({
      title,
      body: cardHtml(card, { extra, note, warn: !result.total && note !== '命運無法選擇，只能面對。' })
        + (notes.length ? `<ul class="claim-notes">${notes.map((t) => `<li>${UI.escape(t)}</li>`).join('')}</ul>` : ''),
      actions: [{ label: '確定', value: 'ok', variant: 'primary' }],
      dismissible: false,
    });
    ctx.applyEffects({ ...card, cash: card.cash + result.total }, reason, { 重大疾病: '🚑', 住院: '🏥' }[card.id] || '🎴');
    if (card.stopMonths) ctx.stopIncome(card.stopMonths);
    if (tag) ctx.state.lastTag = { tag, turn: ctx.state.turn };
    if (result.total) {
      ctx.logDecision(`保險理賠 ${UI.fmtMoney(result.total)}（${result.items.map((i) => i.name).join('、')}；${card.text}）`, 'insurance-claim');
    } else if (tag && cost) {
      ctx.logDecision(`沒有適用的保險，自付${Insurance.TAG_NAME[tag]}相關支出 ${UI.fmtMoney(cost)}（${card.text}）`, 'uninsured-loss');
    }
  }

  function offerHtml(prod, ins) {
    const q = ins.quote(prod);
    const price = prod.amounts
      ? `月繳 ${prod.amounts.map((a) => a.toLocaleString('zh-TW')).join('／')} 元可選`
      : `月繳 ${UI.fmtMoney(q.premium)}${q.surcharge > 1 ? `（健康加費 ${Math.round((q.surcharge - 1) * 100)}%）` : ''}`;
    return `
      <article class="policy-offer" aria-labelledby="offer-${prod.id}">
        <div class="offer-head">
          <h3 id="offer-${prod.id}">${prod.icon} ${UI.escape(prod.name)}</h3>
          <button class="btn btn-sm btn-primary" value="buy:${prod.id}">投保</button>
        </div>
        <p class="offer-summary">${UI.escape(prod.summary)}</p>
        <ul class="effect-list" aria-label="保單條件">
          <li>${price}</li>
          <li>${Insurance.payTermText(prod)}</li>
          <li>${Insurance.coverText(prod)}</li>
          <li>${Insurance.waitText(prod)}</li>
        </ul>
        <p class="card-note">${UI.escape(prod.note)}</p>
      </article>`;
  }

  async function chooseAmount(prod) {
    const v = await UI.modal({
      title: `${prod.icon} ${prod.name}：選擇月繳金額`,
      body: `<p>${UI.escape(prod.summary)}</p><p class="card-note">${UI.escape(prod.note)}</p>`,
      actions: [{ label: '取消', value: 'cancel', variant: 'ghost' },
        ...prod.amounts.map((a) => ({ label: `${a.toLocaleString('zh-TW')} 元`, value: String(a), variant: 'primary' }))],
    });
    return v === 'cancel' ? null : Number(v);
  }

  // 保險格：業務員隨機介紹 3 種符合年齡與健康條件的險種，可以買其中幾種
  async function insurance(tile, ctx) {
    const ins = ctx.insurance;
    let offers = ins.offers();
    if (!offers.length) {
      UI.toast('🛡️ 目前沒有你能投保的新險種');
      return;
    }
    const shown = offers.map((p) => p.name);
    let bought = 0;
    while (offers.length) {
      const choice = await UI.modal({
        title: '🛡️ 保險業務員來訪',
        body: `
          <div class="event-card" data-kind="insurance">
            <p class="card-text">業務員帶來 ${offers.length} 種你目前可以投保的保險：</p>
            <div class="policy-offers">${offers.map((p) => offerHtml(p, ins)).join('')}</div>
            <p class="card-note">目前每月保費 ${UI.fmtMoney(ins.monthlyPremium())}，月薪的 ${Math.round((ins.monthlyPremium() / ctx.job.salary) * 100)}%（雙十原則建議約 ${Math.round(GameData.insurance.budgetRate * 100)}%）。</p>
          </div>`,
        actions: [{ label: bought ? '完成' : '暫不投保', value: 'skip', variant: 'ghost' }],
        dismissible: false,
        className: 'modal-wide',
      });
      if (!choice.startsWith('buy:')) break;
      const prod = offers.find((p) => p.id === choice.slice(4));
      let amount;
      if (prod.amounts) {
        amount = await chooseAmount(prod);
        if (!amount) continue;
      }
      if (prod.id === 'invest' && ctx.stats.trades === 0) {
        const ok = await UI.confirm({
          title: '風險屬性評估',
          message: '投資型保險的帳戶價值會跟著台灣50 ETF 漲跌，可能虧損本金，而且前 5 年要扣 25% 費用。你還沒有任何投資經驗，確定了解風險嗎？',
          okText: '我了解，投保',
          cancelText: '再想想',
        });
        if (!ok) continue;
      }
      const res = ins.buy(prod.id, amount);
      if (!res) continue;
      bought++;
      ctx.renderStatus();
      UI.toast(`🛡️ 已投保${prod.name}`);
      if (res.overBudget) UI.toast(`⚠️ 保費總額 ${UI.fmtMoney(res.total)}，已超過月薪的 ${Math.round(GameData.insurance.budgetRate * 100)}%`);
      offers = offers.filter((p) => p.id !== prod.id);
    }
    if (!bought) ctx.logDecision(`${ctx.age()} 歲婉拒投保（${shown.join('、')}）`, 'insurance-decline');
  }

  async function rest() {
    UI.toast('☕ 休息一下，什麼事都沒發生');
  }

  // ===== 住院 =====
  async function hospital(tile, ctx) {
    const cfg = GameData.hospital;
    await UI.alert({
      title: '🏥 住院',
      message: '你因突發疾病需要住院治療，暫時無法正常工作。擲骰子決定住院天數。',
      okText: '擲骰子',
      dismissible: false,
    });
    const pip = await ctx.rollDice();
    const days = pip * cfg.daysPerPip;
    const cost = days * cfg.costPerDay;
    ctx.stats.hospitalDays += days;
    const card = {
      kind: 'hospital', id: '住院', cash: -cost, netIncome: 0, health: 0,
      text: `擲出 ${pip} 點，住院 ${days} 天，醫療費 ${UI.fmtMoney(cost)}。出院後要休養，下回合暫停移動。`,
    };
    await resolveFate(card, ctx, { title: '🏥 住院', tag: 'hospital', reason: `住院 ${days} 天` });
    ctx.state.skipTurns = cfg.skipTurns;
  }

  // ===== 保險知識題（小學堂）=====
  // 回傳 { correct, timeout, question }
  async function askQuiz(ctx, { title, intro, preferMyth = false }) {
    const q = Quiz.pick(ctx.state.quizUsed, preferMyth);
    ctx.state.quizUsed.push(q.id);
    const seconds = GameData.specialTiles.quizSeconds;
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="event-card quiz-card" data-kind="special">
        <p class="card-text">${UI.escape(intro)}</p>
        <p class="quiz-q">${UI.escape(q.q)}</p>
        <p class="quiz-timer"><span class="quiz-bar" aria-hidden="true"><span></span></span><span><span class="quiz-sec">${seconds}</span> 秒</span></p>
      </div>`;
    const bar = body.querySelector('.quiz-bar > span');
    const sec = body.querySelector('.quiz-sec');
    let left = seconds;
    const timer = setInterval(() => {
      left--;
      sec.textContent = left;
      bar.style.width = `${(left / seconds) * 100}%`;
      if (left <= 0) body.closest('dialog')?.close('timeout');
    }, 1000);
    // 選項順序每次打亂；按鈕的 value 仍是題庫裡的原始索引
    const order = q.options.map((_, i) => i).sort(() => Math.random() - 0.5);
    const letters = ['A', 'B', 'C', 'D'];
    const choice = await UI.modal({
      title,
      body,
      actions: order.map((i, k) => ({ label: `${letters[k]}. ${q.options[i]}`, value: String(i), variant: 'ghost' })),
      dismissible: false,
      className: 'modal-quiz',
    });
    clearInterval(timer);
    const timeout = choice === 'timeout';
    const correct = !timeout && Number(choice) === q.answer;
    ctx.stats.quizAsked++;
    if (correct) ctx.stats.quizCorrect++;
    const verdict = correct ? '答對' : timeout ? '超時未答' : `答錯（選了「${q.options[Number(choice)]}」）`;
    ctx.logDecision(`保險知識題「${q.q}」${verdict}`, correct ? 'quiz-correct' : 'quiz-wrong');
    return { correct, timeout, question: q };
  }

  function quizResultHtml({ correct, timeout, question }, rewardHtml) {
    const head = correct ? '⭕ 答對了！' : timeout ? '⏰ 時間到！' : '❌ 答錯了';
    return `
      <div class="event-card" data-kind="special">
        <p class="quiz-result ${correct ? 'pos' : 'neg'}">${head}</p>
        <p>正確答案：<strong>${UI.escape(question.options[question.answer])}</strong></p>
        <p class="card-note">${UI.escape(question.explain)}</p>
        ${rewardHtml}
      </div>`;
  }

  // ===== 特殊格 =====
  const SP = () => GameData.specialTiles;
  const pct = (rate) => `${Math.round(rate * 100)}%`;

  function specialHtml(text, items, note = '') {
    return `
      <div class="event-card" data-kind="special">
        <p class="card-text">${UI.escape(text)}</p>
        <ul class="effect-list">${items.map((t) => `<li>${UI.escape(t)}</li>`).join('')}</ul>
        ${note ? `<p class="card-note">${UI.escape(note)}</p>` : ''}
      </div>`;
  }

  // 下次投保優惠；已有優惠時保留折抵較多的那一個
  function grantDiscount(ctx, discount, reason) {
    const perks = ctx.state.policyPerks;
    const worth = (d) => (d ? d.rate * 1e6 + d.cap : 0);
    if (worth(discount) > worth(perks.discount)) perks.discount = { rate: discount.rate, cap: discount.cap };
    ctx.addHistory('life', '🏷️', `${reason}：下次投保首年保費折抵 ${pct(discount.rate)}（上限 ${UI.fmtMoney(discount.cap)}）`);
    ctx.renderStatus();
  }

  // 1. 保單健檢機會：答對可選現金或保費優惠
  async function checkup(tile, ctx) {
    const cfg = SP().checkup;
    const title = '🩺 保單健檢機會';
    const res = await askQuiz(ctx, { title, intro: '你參加了一場免費的保險健檢活動，重新了解自己目前的保障內容。答對保險知識題可以獲得獎勵！' });
    if (!res.correct) {
      await UI.alert({ title, html: quizResultHtml(res, '<p>這次沒有獲得獎勵，下次再加油。</p>'), dismissible: false });
      return;
    }
    const reward = await UI.modal({
      title,
      body: quizResultHtml(res, '<p>請選擇一項獎勵：</p>'),
      actions: [
        { label: `🏷️ 下次投保首年保費折抵 ${pct(cfg.coupon.rate)}（上限 ${UI.fmtMoney(cfg.coupon.cap)}）`, value: 'coupon', variant: 'ghost' },
        { label: `💰 現金 ${UI.fmtSigned(cfg.cash)}`, value: 'cash', variant: 'primary' },
      ],
      dismissible: false,
    });
    if (reward === 'coupon') {
      grantDiscount(ctx, cfg.coupon, '保單健檢優惠');
      ctx.logDecision('保單健檢答對，選擇保費優惠', 'special');
    } else {
      ctx.applyEffects({ cash: cfg.cash }, '保單健檢答對獎勵', '🩺');
      ctx.logDecision(`保單健檢答對，選擇現金 ${UI.fmtMoney(cfg.cash)}`, 'special');
    }
  }

  // 2. 財務規劃講座：小額現金 + 一則理財小知識
  async function seminar(tile, ctx) {
    const cfg = SP().seminar;
    const tip = GameData.tips[Math.floor(Math.random() * GameData.tips.length)];
    await UI.alert({
      title: '🎓 財務規劃講座',
      html: specialHtml('你參加了一場理財講座，學會區分緊急預備金、儲蓄與保險的功能。',
        [`💰 現金 ${UI.fmtSigned(cfg.cash)}`], `💡 ${tip.title}：${tip.text}`),
      dismissible: false,
    });
    ctx.applyEffects({ cash: cfg.cash }, '參加財務規劃講座', '🎓');
  }

  // 3. 保障觀念挑戰：答對加現金，答錯買到不符合需求的保單
  async function myth(tile, ctx) {
    const cfg = SP().myth;
    const title = '🧐 保障觀念挑戰';
    const res = await askQuiz(ctx, { title, intro: '你看到一則宣稱「買了保險，所有醫療費用都能理賠」的廣告。先想想看：', preferMyth: true });
    const cash = res.correct ? cfg.win : cfg.lose;
    const msg = res.correct
      ? `<ul class="effect-list"><li>💰 現金 ${UI.fmtSigned(cash)}</li></ul>`
      : `<p class="card-note warn">你被廣告說服，買到不符合需求的保單。</p><ul class="effect-list"><li>💸 現金 ${UI.fmtSigned(cash)}</li></ul>`;
    await UI.alert({ title, html: quizResultHtml(res, msg), dismissible: false });
    ctx.applyEffects({ cash }, res.correct ? '識破保險廣告迷思' : '買到不符合需求的保單', '🧐');
  }

  // 4. 貴人相助：前進 3 格（照常過月份），停留格的事件照常執行
  async function mentor(tile, ctx) {
    const n = SP().mentor.steps;
    await UI.alert({
      title: '🤝 貴人相助',
      html: specialHtml('你在一次聚會中，認識了一位熱心的保險從業人員，對方提醒你：購買保險前應先確認自己的需求與保障內容。',
        [`👣 向前移動 ${n} 格`], '停留的格子有事件時，依該格規則執行。'),
      okText: `前進 ${n} 格`,
      dismissible: false,
    });
    ctx.addHistory('life', '🤝', `貴人相助，前進 ${n} 格`);
    await ctx.moveForward(n);
  }

  // 5. 保險優惠活動：下一次投保首年保費折抵
  async function promo(tile, ctx) {
    const cfg = SP().promo;
    await UI.alert({
      title: '🏷️ 保險優惠活動',
      html: specialHtml('你發現某項符合自身需求的保險推出優惠方案。',
        [`🏷️ 下一次投保首年保費折抵 ${pct(cfg.rate)}（上限 ${UI.fmtMoney(cfg.cap)}）`], '優惠會在下一次投保時自動結算，以退回現金的方式給付。'),
      dismissible: false,
    });
    grantDiscount(ctx, cfg, '保險優惠活動');
  }

  // 6. 保單整理日：從初始保單池抽 1 張（初始保單池在改版計畫 P2 完成，目前先給現金）
  async function attic(tile, ctx) {
    const cfg = SP().attic;
    await UI.alert({
      title: '🗂️ 保單整理日',
      html: specialHtml('你整理舊文件時，發現父母過去替你存的一筆小額保單紅利。', [`💰 現金 ${UI.fmtSigned(cfg.cash)}`]),
      dismissible: false,
    });
    ctx.applyEffects({ cash: cfg.cash }, '保單整理日：發現舊保單紅利', '🗂️');
  }

  // 7. 錯過優惠：下一次投保需額外支付
  async function missed(tile, ctx) {
    const cfg = SP().missed;
    await UI.alert({
      title: '⌛ 錯過優惠',
      html: specialHtml('你原本打算購買的保單優惠活動結束了。', [`💸 下一次投保需額外支付 ${UI.fmtMoney(cfg.surcharge)}`]),
      dismissible: false,
    });
    ctx.state.policyPerks.surcharge += cfg.surcharge;
    ctx.addHistory('life', '⌛', `錯過優惠：下次投保加付 ${UI.fmtMoney(cfg.surcharge)}`);
    ctx.renderStatus();
  }

  window.TileEvents = {
    start: async () => {}, // 停在起點不觸發事件
    chance,
    fate,
    insurance,
    hospital,
    checkup,
    seminar,
    myth,
    mentor,
    promo,
    attic,
    missed,
    rest,
    default: rest,
    illness, // 不是格子，由 js/game.js 依機率觸發
  };
})();
