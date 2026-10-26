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

  function effectItems({ cash, netIncome, health, happiness }) {
    const items = [];
    if (cash) items.push(`💰 現金 ${UI.fmtSigned(cash)}`);
    if (netIncome) items.push(`📅 淨收入 ${UI.fmtSigned(netIncome)}/月`);
    if (health) items.push(`❤️ 健康 ${health > 0 ? '+' : ''}${health}`);
    if (happiness) items.push(`😊 幸福 ${happiness > 0 ? '+' : ''}${happiness}`);
    return items;
  }

  function cardHtml(card, { note = '', warn = false, extra = [], hideEffects = false } = {}) {
    const items = hideEffects ? [] : [...effectItems(card), ...extra];
    const job = card.job && GameData.jobs.find((j) => j.id === card.job);
    return `
      <div class="event-card" data-kind="${card.kind}">
        <div class="card-kind"><span>${GameData.tileTypes[card.kind].icon} ${KIND_LABEL[card.kind]}${job ? `<span class="card-job">${job.icon} ${UI.escape(job.name)}職業事件</span>` : ''}</span><span class="card-id">${UI.escape(card.id)}</span></div>
        <p class="card-text">${UI.escape(card.text)}</p>
        ${items.length ? `<ul class="effect-list" aria-label="影響">${items.map((t) => `<li>${UI.escape(t)}</li>`).join('')}</ul>` : ''}
        ${note ? `<p class="card-note${warn ? ' warn' : ''}">${UI.escape(note)}</p>` : ''}
      </div>`;
  }

  // 預先抽牌：擲出點數就知道會停在哪一格，趁棋子移動時先向伺服器抽牌，停下時就不用等
  let prefetched = null; // { kind, promise }
  function prefetch(kind, stage, ctx) {
    prefetched = null;
    const gameId = ctx.gameId();
    if (!gameId || (kind !== 'chance' && kind !== 'fate')) return;
    const promise = API.draw(gameId, kind, stage);
    promise.catch(() => {}); // 錯誤留到 drawCard 再處理
    prefetched = { kind, promise };
  }

  // 抽牌；無法抽時以提示訊息帶過並回傳 null
  async function drawCard(kind, ctx) {
    const gameId = ctx.gameId();
    if (!gameId) {
      UI.toast('未連線事件資料庫，本格略過');
      return null;
    }
    const pre = prefetched?.kind === kind ? prefetched.promise : null;
    prefetched = null;
    try {
      const card = await (pre || API.draw(gameId, kind, ctx.stageId()));
      if (!card) UI.toast(`這個階段的${KIND_LABEL[kind]}牌已全部抽過`);
      return card;
    } catch (e) {
      console.error(e);
      UI.toast('抽牌失敗，本格略過');
      return null;
    }
  }

  async function chance(tile, ctx) {
    const raw = await drawCard('chance', ctx);
    if (!raw) return;
    const card = ctx.inflate(raw);
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
      const before = { cash: ctx.state.cash, netIncomeAdj: ctx.state.netIncomeAdj, health: ctx.state.health, happiness: ctx.state.happiness };
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
      rows.push(['📅 每月淨收入',`${UI.fmtSigned(before.netIncomeAdj)}/月`, `${UI.fmtSigned(after.netIncomeAdj)}/月`,
        `${UI.fmtSigned(card.netIncome)}/月`, card.netIncome > 0]);
    }
    if (card.health) {
      const diff = after.health - before.health;
      rows.push(['❤️ 健康', before.health, after.health, `${diff >= 0 ? '+' : ''}${diff}`, diff >= 0]);
    }
    if (card.happiness) {
      const diff = after.happiness - before.happiness;
      rows.push(['😊 幸福', before.happiness, after.happiness, `${diff >= 0 ? '+' : ''}${diff}`, diff >= 0]);
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
    const raw = await drawCard('fate', ctx);
    if (!raw) return;
    const card = ctx.inflate(raw);
    ctx.stats.fateCount++;
    await resolveFate(card, ctx, { title: '抽到命運牌', tag: GameData.cardTagOf[card.id] || null });
  }

  // 重大疾病（js/game.js 依年齡與健康觸發）
  async function illness(ev, ctx) {
    const card = ctx.inflate({ kind: 'fate', id: '重大疾病', cash: 0, netIncome: 0, health: 0, happiness: 0, ...ev });
    await resolveFate(card, ctx, { title: '🚑 健康警訊', tag: ev.tag });
  }

  // 命運事件：依疾病標籤理賠，再套用影響
  async function resolveFate(card, ctx, { title, tag, days, reason = `命運：${card.text}` }) {
    const cost = card.cash < 0 ? -card.cash : 0;
    if (tag && cost) ctx.stats.medicalCost += cost;
    const result = ctx.insurance.claim({ tag, cost, days });
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
          <div class="offer-actions">
            <button class="btn btn-sm btn-ghost" type="button" data-proposal="${prod.id}">產生建議書</button>
            <button class="btn btn-sm btn-primary" value="buy:${prod.id}">投保</button>
          </div>
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

  // 保險格：連得上伺服器時和 AI 業務員對話，否則改用「隨機介紹 3 種險種」
  async function insurance(tile, ctx) {
    if (ctx.gameId()) await agentChat(ctx);
    else await offerList(ctx);
  }

  // 給 AI 業務員的玩家狀況與目前報價
  function agentContext(ctx) {
    const ins = ctx.insurance;
    return {
      jobName: ctx.job.name,
      salary: ctx.salaryNow(),
      expense: ctx.expenseNow(),
      age: ctx.age(),
      health: ctx.state.health,
      cash: Math.round(ctx.state.cash),
      medicalHistory: ctx.state.medicalHistory,
      monthlyPremium: ins.monthlyPremium(),
      policies: ins.summary().filter((p) => !['已解約', '停效', '已到期', '已理賠結束'].includes(p.status)).map((p) => ({ name: p.name, status: p.status })),
      quotes: GameData.insurance.products.map((p) => {
        const q = ins.quote(p);
        return { id: p.id, name: p.name, ok: q.ok, premium: q.premium || 0, reason: q.reason || '' };
      }),
    };
  }

  const AGENT_MAX_QUESTIONS = 6;
  const AGENT_SUGGESTIONS = ['我現在最需要什麼保險？', '醫療險和住院日額險差在哪？', '我的保費會不會太高？'];

  // AI 業務員對話視窗；「看險種清單」會暫時切到清單，看完回到對話，按「結束對話」才結束來訪
  function agentChat(ctx) {
    return new Promise((resolve) => {
      const history = [];
      let asked = 0;
      let bought = 0;
      let busy = false;
      const dlg = document.createElement('dialog');
      dlg.className = 'modal modal-wide agent-chat';
      dlg.setAttribute('aria-labelledby', 'agent-title');
      dlg.dataset.dismissible = 'false';
      dlg.innerHTML = `
        <div class="modal-head">
          <h2 id="agent-title">🛡️ 保險業務員來訪</h2>
        </div>
        <div class="modal-body">
          <ol class="chat-log" aria-live="polite"></ol>
          <div class="chat-suggest">${AGENT_SUGGESTIONS.map((t) => `<button class="btn btn-sm btn-ghost" type="button" data-suggest>${UI.escape(t)}</button>`).join('')}</div>
          <form class="chat-form">
            <label class="sr-only" for="agent-input">問業務員</label>
            <input id="agent-input" type="text" maxlength="200" autocomplete="off" placeholder="問問業務員，例如：我該買哪種保險？">
            <button class="btn btn-primary" type="submit">送出</button>
          </form>
          <p class="chat-meta"></p>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-mine>🗂️ 我的保單</button>
          <button class="btn btn-ghost" type="button" data-list>📋 險種清單</button>
          <button class="btn btn-primary" type="button" data-done>結束對話</button>
        </div>`;
      const log = dlg.querySelector('.chat-log');
      const input = dlg.querySelector('#agent-input');
      const meta = dlg.querySelector('.chat-meta');
      const sendBtn = dlg.querySelector('.chat-form button');

      const updateMeta = () => {
        const left = AGENT_MAX_QUESTIONS - asked;
        meta.textContent = left > 0 ? `這次還可以問 ${left} 個問題` : '業務員還有其他客戶，這次就聊到這裡。';
        input.disabled = sendBtn.disabled = busy || left <= 0;
        dlg.querySelectorAll('[data-suggest]').forEach((b) => { b.disabled = busy || left <= 0; });
      };

      function addLine(role, html) {
        const li = document.createElement('li');
        li.className = `chat-msg ${role}`;
        li.innerHTML = html;
        log.append(li);
        li.scrollIntoView({ block: 'nearest' });
        return li;
      }

      function recHtml(r) {
        const prod = Insurance.PRODUCTS[r.productId];
        const q = ctx.insurance.quote(prod);
        const price = !q.ok ? `無法投保：${q.reason}` : prod.amounts ? '月繳金額自選' : `月繳 ${UI.fmtMoney(q.premium)}`;
        return `
          <div class="chat-rec">
            <div><strong>${prod.icon} ${UI.escape(prod.name)}</strong><span class="chat-rec-price">${UI.escape(price)}</span></div>
            <p>${UI.escape(r.reason)}</p>
            <div class="chat-rec-actions">
              <button class="btn btn-sm btn-ghost" type="button" data-proposal="${prod.id}">產生建議書</button>
              <button class="btn btn-sm btn-primary" type="button" data-rec="${prod.id}" ${q.ok ? '' : 'disabled'}>投保</button>
            </div>
          </div>`;
      }

      async function ask(text) {
        if (busy || asked >= AGENT_MAX_QUESTIONS) return;
        busy = true;
        asked++;
        history.push({ role: 'user', content: text });
        addLine('user', UI.escape(text));
        const typing = addLine('agent typing', '<span class="dots" aria-label="業務員輸入中">…</span>');
        updateMeta();
        try {
          const res = await API.agent(ctx.gameId(), agentContext(ctx), history);
          typing.remove();
          history.push({ role: 'assistant', content: res.reply });
          addLine('agent', UI.escape(res.reply).replace(/\n/g, '<br>') + (res.recommendations || []).map(recHtml).join(''));
          ctx.logDecision(`詢問保險業務員：「${text}」`, 'insurance-ask');
        } catch (e) {
          typing.remove();
          history.pop();
          asked--;
          addLine('agent error', e.code === 'daily_limit'
            ? '今天和業務員聊太多次了，可以改看險種清單，或在右側「保險」分頁自己投保。'
            : '業務員暫時無法回覆，可以改看險種清單。');
        }
        busy = false;
        updateMeta();
        input.focus();
      }

      function finish() {
        dlg.close();
        dlg.remove();
        if (!bought) ctx.logDecision(`${ctx.age()} 歲和保險業務員聊過，暫不投保`, 'insurance-decline');
        resolve();
      }

      // 切到險種清單，關閉清單後回到同一段對話
      async function showList() {
        dlg.close();
        bought += await offerList(ctx, { fromChat: true });
        refreshRecs();
        dlg.showModal();
        updateMeta();
        if (!input.disabled) input.focus();
      }

      // 在清單或保險頁投保／解約後，推薦按鈕依最新報價更新
      function refreshRecs() {
        dlg.querySelectorAll('[data-rec]').forEach((b) => {
          const q = ctx.insurance.quote(Insurance.PRODUCTS[b.dataset.rec]);
          b.disabled = !q.ok;
          b.textContent = q.ok ? '投保' : q.reason === '已經投保' ? '已投保' : '無法投保';
        });
      }

      dlg.querySelector('.chat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        ask(text);
      });
      dlg.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.matches('[data-suggest]')) ask(btn.textContent);
        else if (btn.matches('[data-done]')) finish();
        else if (btn.matches('[data-list]')) showList();
        else if (btn.matches('[data-mine]')) { await ctx.showMyPolicies(); refreshRecs(); }
        else if (btn.dataset.proposal) ctx.openProposal(btn.dataset.proposal);
        else if (btn.dataset.rec) {
          const res = await purchase(Insurance.PRODUCTS[btn.dataset.rec], ctx);
          if (res) {
            bought++;
            btn.disabled = true;
            btn.textContent = '已投保';
          }
        }
      });
      dlg.addEventListener('cancel', (e) => e.preventDefault());

      document.body.append(dlg);
      addLine('agent', `你好！我是保險業務員。你今年 ${ctx.age()} 歲，目前每月保費 ${UI.escape(UI.fmtMoney(ctx.insurance.monthlyPremium()))}。想了解哪方面的保障？有任何保險問題都可以問我。`);
      updateMeta();
      dlg.showModal();
      input.focus();
    });
  }

  // 業務員隨機介紹 3 種符合年齡與健康條件的險種，可以買其中幾種；回傳投保了幾種
  // fromChat：從 AI 對話切過來，離開按鈕改為「回到對話」，婉拒紀錄交給對話結束時處理
  async function offerList(ctx, { fromChat = false } = {}) {
    const ins = ctx.insurance;
    let offers = ins.offers();
    if (!offers.length) {
      UI.toast('🛡️ 目前沒有你能投保的新險種');
      return 0;
    }
    const shown = offers.map((p) => p.name);
    let bought = 0;
    while (offers.length) {
      const body = document.createElement('div');
      body.className = 'event-card';
      body.dataset.kind = 'insurance';
      body.innerHTML = `
        <p class="card-text">業務員帶來 ${offers.length} 種你目前可以投保的保險：</p>
        <div class="policy-offers">${offers.map((p) => offerHtml(p, ins)).join('')}</div>
        <p class="card-note">目前每月保費 ${UI.fmtMoney(ins.monthlyPremium())}，月薪的 ${Math.round((ins.monthlyPremium() / ctx.job.salary) * 100)}%（雙十原則建議約 ${Math.round(GameData.insurance.budgetRate * 100)}%）。
          <button class="btn btn-sm btn-ghost" type="button" data-mine>🗂️ 我的保單</button></p>`;
      body.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-proposal],[data-mine]');
        if (!btn) return;
        if (btn.dataset.proposal) ctx.openProposal(btn.dataset.proposal);
        else ctx.showMyPolicies();
      });
      const choice = await UI.modal({
        title: '🛡️ 保險業務員來訪',
        body,
        actions: [{ label: fromChat ? '回到對話' : bought ? '完成' : '暫不投保', value: 'skip', variant: 'ghost' }],
        dismissible: false,
        className: 'modal-wide',
      });
      if (!choice.startsWith('buy:')) break;
      const prod = offers.find((p) => p.id === choice.slice(4));
      if (!(await purchase(prod, ctx))) continue;
      bought++;
      offers = offers.filter((p) => p.id !== prod.id);
    }
    if (!bought && !fromChat) ctx.logDecision(`${ctx.age()} 歲婉拒投保（${shown.join('、')}）`, 'insurance-decline');
    return bought;
  }

  // 投保流程（保險格與保險頁共用）：選金額、風險確認、投保；成功回傳 buy() 的結果，取消回傳 null
  async function purchase(prod, ctx) {
    let amount;
    if (prod.amounts) {
      amount = await chooseAmount(prod);
      if (!amount) return null;
    }
    if (prod.id === 'invest' && ctx.stats.trades === 0) {
      const ok = await UI.confirm({
        title: '風險屬性評估',
        message: '投資型保險的帳戶價值會跟著台灣50 ETF 漲跌，可能虧損本金，而且前 5 年要扣 25% 費用。你還沒有任何投資經驗，確定了解風險嗎？',
        okText: '我了解，投保',
        cancelText: '再想想',
      });
      if (!ok) return null;
    }
    const res = ctx.insurance.buy(prod.id, amount);
    if (!res) return null;
    ctx.renderStatus();
    UI.toast(`🛡️ 已投保${prod.name}`);
    if (res.overBudget) UI.toast(`⚠️ 保費總額 ${UI.fmtMoney(res.total)}，已超過月薪的 ${Math.round(GameData.insurance.budgetRate * 100)}%`);
    return res;
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
    const cost = ctx.inflateAmount(days * GameData.byStage(cfg.costPerDay, ctx.stageId()));
    ctx.stats.hospitalDays += days;
    const card = {
      kind: 'hospital', id: '住院', cash: -cost, netIncome: 0, health: 0,
      text: `擲出 ${pip} 點，住院 ${days} 天，醫療費 ${UI.fmtMoney(cost)}。出院後要休養，下回合暫停移動。`,
    };
    await resolveFate(card, ctx, { title: '🏥 住院', tag: 'hospital', days, reason: `住院 ${days} 天` });
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
  // 依目前人生階段取值；現金獎懲再依物價調整（和事件牌一樣）
  const atStage = (ctx, v) => GameData.byStage(v, ctx.stageId());
  const cashAt = (ctx, v) => ctx.inflateAmount(atStage(ctx, v));
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
    const cash = cashAt(ctx, cfg.cash);
    const coupon = { rate: cfg.coupon.rate, cap: atStage(ctx, cfg.coupon.cap) };
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
        { label: `🏷️ 下次投保首年保費折抵 ${pct(coupon.rate)}（上限 ${UI.fmtMoney(coupon.cap)}）`, value: 'coupon', variant: 'ghost' },
        { label: `💰 現金 ${UI.fmtSigned(cash)}`, value: 'cash', variant: 'primary' },
      ],
      dismissible: false,
    });
    if (reward === 'coupon') {
      grantDiscount(ctx, coupon, '保單健檢優惠');
      ctx.logDecision('保單健檢答對，選擇保費優惠', 'special');
    } else {
      ctx.applyEffects({ cash }, '保單健檢答對獎勵', '🩺');
      ctx.logDecision(`保單健檢答對，選擇現金 ${UI.fmtMoney(cash)}`, 'special');
    }
  }

  // 2. 理財講座：第一頁讀完一篇文章（捲到底才能進下一頁），第二頁回答依文章出的題目
  //    出席給基本現金，每答對一題再加 perCorrect
  async function seminar(tile, ctx) {
    const cfg = SP().seminar;
    const base = cashAt(ctx, cfg.cash);
    const perCorrect = cashAt(ctx, cfg.perCorrect);
    const title = '🎓 理財講座';
    const used = (ctx.state.seminarUsed ||= []);
    const art = Seminar.pick(used);
    used.push(art.id);

    // ---- 第一頁：文章 ----
    const article = document.createElement('div');
    article.innerHTML = `
      <article class="event-card seminar-article" data-kind="special">
        <h3 class="seminar-title">${UI.escape(art.title)}</h3>
        <p class="seminar-lead">${UI.escape(art.lead)}</p>
        ${art.sections.map((s) => `
          <h4>${UI.escape(s.h)}</h4>
          ${s.p.map((t) => `<p>${UI.escape(t)}</p>`).join('')}`).join('')}
        <p class="seminar-end">— 文章結束，接下來請回答 ${art.questions.length} 題問答 —</p>
      </article>`;
    const reading = UI.modal({
      title,
      body: article,
      actions: [{ label: '請先往下滑讀完文章', value: 'next', variant: 'primary' }],
      dismissible: false,
      className: 'modal-wide modal-seminar',
    });
    const scroller = article.closest('.modal-body');
    const nextBtn = article.closest('dialog').querySelector('.modal-actions .btn');
    nextBtn.disabled = true;
    const unlock = () => {
      if (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 8) return;
      nextBtn.disabled = false;
      nextBtn.textContent = '下一頁：開始問答';
      scroller.removeEventListener('scroll', unlock);
    };
    scroller.addEventListener('scroll', unlock, { passive: true });
    requestAnimationFrame(unlock); // 文章短到不用捲動時直接解鎖
    await reading;

    // ---- 第二頁：問答 ----
    const letters = ['A', 'B', 'C', 'D'];
    const picked = art.questions.map(() => null);
    const quiz = document.createElement('div');
    quiz.innerHTML = `
      <div class="event-card" data-kind="special">
        <p class="card-text">根據剛剛讀的「${UI.escape(art.title)}」，回答下列問題：</p>
        ${art.questions.map((q, qi) => `
          <fieldset class="seminar-q">
            <legend>${qi + 1}. ${UI.escape(q.q)}</legend>
            ${q.options.map((o, oi) => `<button type="button" class="btn btn-ghost seminar-opt" data-q="${qi}" data-o="${oi}" aria-pressed="false">${letters[oi]}. ${UI.escape(o)}</button>`).join('')}
          </fieldset>`).join('')}
      </div>`;
    const answering = UI.modal({
      title,
      body: quiz,
      actions: [{ label: '送出答案', value: 'submit', variant: 'primary' }],
      dismissible: false,
      className: 'modal-wide modal-seminar',
    });
    const submitBtn = quiz.closest('dialog').querySelector('.modal-actions .btn');
    submitBtn.disabled = true;
    quiz.addEventListener('click', (e) => {
      const opt = e.target.closest('.seminar-opt');
      if (!opt) return;
      const qi = Number(opt.dataset.q);
      picked[qi] = Number(opt.dataset.o);
      quiz.querySelectorAll(`.seminar-opt[data-q="${qi}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === opt)));
      submitBtn.disabled = picked.includes(null);
    });
    await answering;

    // ---- 結果 ----
    const correct = art.questions.filter((q, i) => picked[i] === q.answer).length;
    const cash = base + correct * perCorrect;
    await UI.alert({
      title,
      html: `
        <div class="event-card" data-kind="special">
          <p class="quiz-result ${correct === art.questions.length ? 'pos' : correct ? '' : 'neg'}">答對 ${correct} / ${art.questions.length} 題</p>
          <ol class="seminar-review">
            ${art.questions.map((q, i) => `
              <li>${picked[i] === q.answer ? '⭕' : '❌'} ${UI.escape(q.q)}<br>
                <span class="card-note">正確答案：<strong>${UI.escape(q.options[q.answer])}</strong></span></li>`).join('')}
          </ol>
          <ul class="effect-list"><li>💰 出席獎勵 ${UI.fmtSigned(base)}</li>${correct ? `<li>🧠 答對獎勵 ${UI.fmtSigned(correct * perCorrect)}</li>` : ''}</ul>
        </div>`,
      dismissible: false,
    });
    ctx.logDecision(`理財講座「${art.title}」問答答對 ${correct}/${art.questions.length}`, 'special');
    ctx.applyEffects({ cash }, '參加理財講座', '🎓');
  }

  // 3. 保障觀念挑戰：答對加現金，答錯買到不符合需求的保單
  async function myth(tile, ctx) {
    const cfg = SP().myth;
    const title = '🧐 保障觀念挑戰';
    const res = await askQuiz(ctx, { title, intro: '你看到一則宣稱「買了保險，所有醫療費用都能理賠」的廣告。先想想看：', preferMyth: true });
    const cash = cashAt(ctx, res.correct ? cfg.win : cfg.lose);
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
    const cfg = { rate: SP().promo.rate, cap: atStage(ctx, SP().promo.cap) };
    await UI.alert({
      title: '🏷️ 保險優惠活動',
      html: specialHtml('你發現某項符合自身需求的保險推出優惠方案。',
        [`🏷️ 下一次投保首年保費折抵 ${pct(cfg.rate)}（上限 ${UI.fmtMoney(cfg.cap)}）`], '優惠會在下一次投保時自動結算，以退回現金的方式給付。'),
      dismissible: false,
    });
    grantDiscount(ctx, cfg, '保險優惠活動');
  }

  // 6. 保單整理日：從初始保單池抽 1 張；舊保單都有了就改給現金
  async function attic(tile, ctx) {
    const p = ctx.insurance.drawLegacy('保單整理日');
    if (p) {
      const prod = Insurance.PRODUCTS[p.id];
      await UI.alert({
        title: '🗂️ 保單整理日',
        html: specialHtml('你整理舊文件時，發現一張父母過去替你購買、但你一直不知道的保單。',
          [`${prod.icon} ${prod.name}`, prod.summary], prod.note),
        dismissible: false,
      });
      ctx.logDecision(`保單整理日發現舊保單：${prod.name}`, 'special');
      ctx.renderStatus();
      return;
    }
    const cash = cashAt(ctx, SP().attic.cash);
    await UI.alert({
      title: '🗂️ 保單整理日',
      html: specialHtml('你整理舊文件時，發現父母過去替你存的一筆小額保單紅利。', [`💰 現金 ${UI.fmtSigned(cash)}`]),
      dismissible: false,
    });
    ctx.applyEffects({ cash }, '保單整理日：發現舊保單紅利', '🗂️');
  }

  // 7. 錯過優惠：下一次投保需額外支付
  async function missed(tile, ctx) {
    const surcharge = atStage(ctx, SP().missed.surcharge);
    await UI.alert({
      title: '⌛ 錯過優惠',
      html: specialHtml('你原本打算購買的保單優惠活動結束了。', [`💸 下一次投保需額外支付 ${UI.fmtMoney(surcharge)}`]),
      dismissible: false,
    });
    ctx.state.policyPerks.surcharge += surcharge;
    ctx.addHistory('life', '⌛', `錯過優惠：下次投保加付 ${UI.fmtMoney(surcharge)}`);
    ctx.renderStatus();
  }

  window.TileEvents = {
    start: async () => {}, // 停在起點不觸發事件
    prefetch, // 不是格子，擲骰後先抽好停留格的牌
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
    purchase, // 不是格子，保險頁投保也用這個流程
  };
})();
