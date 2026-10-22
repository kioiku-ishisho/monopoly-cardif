/*
 * 格子事件
 *   機會：從資料庫抽一張本局未抽過的機會牌，玩家選擇接受或放棄
 *   命運：從資料庫抽一張本局未抽過的命運牌，抽到即發生；依疾病標籤（js/data.js 的 cardTags）理賠
 *   保險：業務員隨機介紹 3 種險種（js/data.js 的 insurance、js/insurance.js）
 *   休息：什麼事都沒發生
 *
 * handler 為 async (tile, ctx) => void，ctx 由 js/game.js 提供：
 *   ctx.state / ctx.stats / ctx.job / ctx.age() / ctx.stageId() / ctx.gameId()
 *   ctx.applyEffects({ cash, netIncome, health }, 原因, 圖示)
 *   ctx.insurance（Insurance.create 的結果）/ ctx.stopIncome(月數) / ctx.logDecision(文字, 分類) / ctx.alert(opts)
 */
(function () {
  const KIND_LABEL = { chance: '機會', fate: '命運' };

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
  async function resolveFate(card, ctx, { title, tag }) {
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
    ctx.applyEffects({ ...card, cash: card.cash + result.total }, `命運：${card.text}`, card.id === '重大疾病' ? '🚑' : '🎴');
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
      UI.toast(`🛡️ 已投保${prod.name}`);
      if (res.overBudget) UI.toast(`⚠️ 保費總額 ${UI.fmtMoney(res.total)}，已超過月薪的 ${Math.round(GameData.insurance.budgetRate * 100)}%`);
      offers = offers.filter((p) => p.id !== prod.id);
    }
    if (!bought) ctx.logDecision(`${ctx.age()} 歲婉拒投保（${shown.join('、')}）`, 'insurance-decline');
  }

  async function rest() {
    UI.toast('☕ 休息一下，什麼事都沒發生');
  }

  window.TileEvents = {
    start: async () => {}, // 停在起點不觸發事件
    chance,
    fate,
    insurance,
    rest,
    default: rest,
    illness, // 不是格子，由 js/game.js 依機率觸發
  };
})();
