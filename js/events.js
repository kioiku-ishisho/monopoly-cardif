/*
 * 格子事件
 *   機會：從資料庫抽一張本局未抽過的機會牌，玩家選擇接受或放棄
 *   命運：從資料庫抽一張本局未抽過的命運牌，抽到即發生
 *   保險：可投保醫療險（js/data.js 的 insurance 設定）
 *   休息：什麼事都沒發生
 *
 * handler 為 async (tile, ctx) => void，ctx 由 js/game.js 提供：
 *   ctx.state / ctx.stats / ctx.stageId() / ctx.gameId()
 *   ctx.applyEffects({ cash, netIncome, health }, 原因, 圖示)
 *   ctx.buyInsurance() / ctx.logDecision(文字, 分類) / ctx.alert(opts)
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
    // 醫療險：同時造成現金損失與健康下降的命運牌，理賠部分現金
    let claim = 0;
    if (ctx.state.insurance && card.cash < 0 && card.health < 0) {
      claim = Math.round(-card.cash * GameData.insurance.coverRate);
    }
    await UI.modal({
      title: '抽到命運牌',
      body: cardHtml(card, {
        extra: claim ? [`🛡️ ${GameData.insurance.name}理賠 ${UI.fmtSigned(claim)}`] : [],
        note: claim ? '還好有投保，減輕了這次的損失。' : '命運無法選擇，只能面對。',
      }),
      actions: [{ label: '確定', value: 'ok', variant: 'primary' }],
      dismissible: false,
    });
    ctx.applyEffects({ ...card, cash: card.cash + claim }, `命運：${card.text}`, '🎴');
    if (claim) {
      ctx.stats.claims++;
      ctx.stats.claimTotal += claim;
      ctx.logDecision(`保險理賠 ${UI.fmtMoney(claim)}（${card.text}）`, 'insurance-claim');
    } else if (card.cash < 0 && card.health < 0) {
      ctx.logDecision(`未投保，自付醫療相關支出 ${UI.fmtMoney(-card.cash)}（${card.text}）`, 'uninsured-loss');
    }
  }

  async function insurance(tile, ctx) {
    const cfg = GameData.insurance;
    if (ctx.state.insurance) {
      UI.toast(`🛡️ 你的${cfg.name}保障中`);
      return;
    }
    const premium = cfg.premium[ctx.stageId()];
    const choice = await UI.modal({
      title: `🛡️ ${cfg.name}`,
      body: `
        <div class="event-card" data-kind="insurance">
          <p class="card-text">保險業務員向你介紹${cfg.name}，要投保嗎？</p>
          <ul class="effect-list" aria-label="保單內容">
            <li>保費 ${UI.fmtMoney(premium)}/月</li>
            <li>理賠醫療類命運牌 ${Math.round(cfg.coverRate * 100)}% 現金損失</li>
          </ul>
          <p class="card-note">保費依投保時的年齡固定，越早投保越便宜（青年 ${UI.fmtMoney(cfg.premium.youth)}、中年 ${UI.fmtMoney(cfg.premium.middle)}、老年 ${UI.fmtMoney(cfg.premium.elder)}）。</p>
        </div>`,
      actions: [
        { label: '暫不投保', value: 'skip', variant: 'ghost' },
        { label: '投保', value: 'buy', variant: 'primary' },
      ],
      dismissible: false,
    });
    if (choice === 'buy') ctx.buyInsurance();
    else ctx.logDecision(`${GameData.stages.find((s) => s.id === ctx.stageId()).name}時婉拒投保${cfg.name}`, 'insurance-decline');
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
  };
})();
