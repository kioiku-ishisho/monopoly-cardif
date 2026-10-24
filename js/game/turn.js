/* 遊戲主頁：擲骰子與回合流程、過起點、每月收支、重大疾病、長照、結束判定 */
(function (G) {
  if (!G) return;
  const { D, E, $, job, state, stats, Ins, clamp, stage, age, ageInt, priceIndex, salaryNow, expenseNow,
    monthlyIncome, monthlyCashflow, stockValue, netWorth, stageIndexForLap, addHistory, logDecision, announce } = G;

  // ===== 骰子 =====
  const diceBtn = $('#btn-dice');
  const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  function setDiceEnabled(on) { diceBtn.disabled = !on; }

  async function waitIfPaused() {
    while (state.paused) await UI.wait(120);
  }

  async function rollDice() {
    const n = 1 + Math.floor(Math.random() * 6);
    const face = $('#dice-face');
    if (!UI.reducedMotion()) {
      diceBtn.classList.add('rolling');
      for (let i = 0; i < 8; i++) {
        face.textContent = FACES[Math.floor(Math.random() * 6)];
        await UI.wait(70);
      }
      diceBtn.classList.remove('rolling');
    }
    face.textContent = FACES[n - 1];
    return n;
  }

  // ===== 過起點：換圈、調薪、健康與幸福的自然變化、人生階段轉換 =====
  async function passStart() {
    state.lap++;
    Ins.onLap();
    stats.lapSamples++;
    if (state.cash >= expenseNow() * 3) stats.emergencyLaps++;
    if (stage().id !== 'elder') {
      stats.premiumRatioSum += Ins.monthlyPremium() / salaryNow();
      stats.premiumSamples++;
    }
    state.salaryIndex *= 1 + E.salaryGrowthPerLap;
    addHistory('life', '🧾', `物價指數 ${priceIndex().toFixed(2)}，每月生活費調整為 ${UI.fmtMoney(expenseNow())}；薪資調升 ${Math.round(E.salaryGrowthPerLap * 100)}%，月薪 ${UI.fmtMoney(salaryNow())}`);
    const decay = E.healthDecayPerLap[stage().id];
    if (decay > 0) addHistory('life', '⏳', `歲月流逝，健康 -${decay}`);
    else if (decay < 0 && state.health < 100) addHistory('life', '💪', `年輕身體恢復得快，健康 +${-decay}`);
    state.health = clamp(state.health - decay, 0, 100);
    const sad = E.happinessDecayPerLap[stage().id];
    const stress = state.cash < expenseNow() * E.stress.months ? E.stress.happiness : 0;
    if (sad + stress) {
      state.happiness = clamp(state.happiness - sad - stress, 0, 100);
      addHistory('life', '🌧️', `${stress ? `存款不到 ${E.stress.months} 個月生活費，經濟壓力大；` : ''}生活的消磨讓幸福 -${sad + stress}`);
    }
    addHistory('life', '🏁', `完成第 ${state.lap} 圈，${ageInt()} 歲`);
    const idx = stageIndexForLap(state.lap);
    if (idx !== state.stageIndex) {
      await G.showStageReport(stage());
      G.stageStats = G.newStageStats();
      state.stageIndex = idx;
      if (stage().id === 'elder') state.retirePrice = priceIndex();
      G.buildBoard();
      const msg = {
        middle: '人生進入中年（40–65 歲）。收入提升為月薪的 1.3 倍，但家庭與健康的挑戰也變多了。',
        elder: `你退休了！之後收入改為退休金（約月薪的 ${Math.round(E.incomeRate.elder * 100)}%${E.pensionIndexed ? '，會隨物價調整' : ''}），健康也會開始下降。`,
      }[stage().id];
      addHistory('life', '🎂', `進入${stage().name}階段`);
      logDecision(`${ageInt()} 歲進入${stage().name}，淨資產 ${UI.fmtMoney(netWorth())}`, 'milestone');
      await UI.alert({ title: `進入${stage().name}階段`, message: msg, okText: '繼續' });
    }
  }

  // 過一個月：銀行利息、薪水與生活費、保費；noSalary 為住院期間沒有薪水
  function payMonth(noSalary = false) {
    if (state.cash > 0) {
      const interest = Math.round(state.cash * (E.bankRate / 12) * E.monthsPerStep);
      state.cash += interest;
      stats.interestTotal += interest;
    }
    state.cash += (monthlyCashflow() - (noSalary ? monthlyIncome() : 0)) * E.monthsPerStep;
    Ins.monthly();
  }

  // 前進一格 = 過一個月：領薪、扣生活費與保費，經過起點時換圈
  async function stepOnce(delay) {
    await waitIfPaused();
    state.position = (state.position + 1) % E.tilesPerLap;
    state.steps++;
    payMonth();
    if (state.position === 0) await passStart();
    G.placeToken(true);
    G.renderStatus();
    await UI.wait(delay);
  }

  const stepDelay = () => (UI.reducedMotion() ? 60 : 220);

  async function runTile(tile) {
    await waitIfPaused();
    await (TileEvents[tile.type] || TileEvents.default)(tile, G.ctx);
  }

  // ===== 回合 =====
  // 住院中：這回合不移動，仍過一個月（沒有薪水，退休金照領）
  async function hospitalTurn() {
    state.skipTurns--;
    const before = state.cash;
    state.steps++;
    const lost = stage().id === 'elder' ? 0 : monthlyIncome();
    payMonth(lost > 0);
    addHistory('life', '🛏️', `住院休養，暫停移動 1 回合${lost ? `，少領 1 個月薪水（${UI.fmtMoney(lost)}）` : ''}`);
    G.renderStatus();
    announce(`住院休養中，暫停移動・1 個月收支 ${UI.fmtSigned(state.cash - before)}`);
    const due = G.marketTick(E.monthsPerStep);
    await UI.alert({ title: '🛏️ 住院休養中', message: `這回合暫停移動。${lost ? '無法上班，這個月沒有薪水。' : '退休金照常入帳。'}`, okText: '繼續' });
    await G.showStory(due);
    return E.monthsPerStep;
  }

  async function moveTurn() {
    const n = await rollDice();
    announce(`擲出 ${n} 點`);
    const before = state.cash;
    for (let i = 0; i < n; i++) await stepOnce(stepDelay());
    G.ensureTokenVisible();
    const tile = G.currentTile();
    announce(`擲出 ${n} 點，來到「${tile.name}」・${n * E.monthsPerStep} 個月收支 ${UI.fmtSigned(state.cash - before)}`);
    await G.showStory(G.marketTick(n * E.monthsPerStep));
    await runTile(tile);
    return n * E.monthsPerStep;
  }

  async function turn() {
    if (state.busy || state.over || state.paused) return;
    state.busy = true;
    setDiceEnabled(false);
    state.turn++;
    const months = state.skipTurns > 0 ? await hospitalTurn() : await moveTurn();
    await maybeMajorIllness(months);
    await checkLtc();

    stats.peakNetWorth = Math.max(stats.peakNetWorth, netWorth());
    stats.minHealth = Math.min(stats.minHealth, state.health);
    stats.healthSum += state.health;
    stats.healthSamples++;
    stats.minHappiness = Math.min(stats.minHappiness, state.happiness);
    stats.happinessSum += state.happiness;
    G.renderStatus();

    if (await checkEnd()) return;
    state.busy = false;
    setDiceEnabled(true);
    diceBtn.querySelector('.dice-label').textContent = state.skipTurns > 0 ? '住院休養' : '擲骰子';
  }

  // 重大疾病：每回合依年齡與健康擲一次（命運牌裡的大病很少，補上才能體會重大傷病、癌症險的價值）
  async function maybeMajorIllness(months) {
    if (state.health <= 0) return;
    const cfg = D.majorIllness;
    // 職業倍率：心血管疾病（心肌梗塞、腦中風）依 job.risk.heart 調整，發生率與病種比例一起變
    const weightOf = (ev) => ev.weight * (['heart', 'stroke'].includes(ev.tag) ? job.risk.heart || 1 : 1);
    const baseWeight = cfg.events.reduce((s, ev) => s + ev.weight, 0);
    const totalWeight = cfg.events.reduce((s, ev) => s + weightOf(ev), 0);
    let rate = Insurance.interp(cfg.annualRate, age()) * (totalWeight / baseWeight) * G.illnessRate();
    if (state.health < 70) rate *= 1 + ((70 - state.health) / 10) * 0.2;
    if (Math.random() >= (rate * months) / 12) return;
    let r = Math.random() * totalWeight;
    const ev = cfg.events.find((x) => (r -= weightOf(x)) < 0) || cfg.events[0];
    stats.majorIllness++;
    await TileEvents.illness(ev, G.ctx);
    G.renderStatus();
  }

  async function checkLtc() {
    const res = Ins.checkLtc();
    if (!res) return;
    G.renderStatus();
    const notes = res.notes.length ? res.notes : ['你沒有長照險，照護費必須全部自付。'];
    await UI.alert({
      title: '🧑‍🦽 進入長照狀態',
      html: `<p>健康降到 ${state.health}，日常生活需要他人照顧，之後每月多 ${UI.fmtMoney(Ins.careCost())} 照護費。</p>
        <ul>${notes.map((t) => `<li>${UI.escape(t)}</li>`).join('')}</ul>`,
      okText: '我知道了',
      dismissible: false,
    });
  }

  async function checkEnd() {
    // 現金不足時先強制賣股
    if (state.cash <= 0 && stockValue() > 0) {
      for (const s of state.market) {
        if (state.cash > 0) break;
        const h = state.holdings[s.id];
        if (h) G.sell(s.id, h.shares, true);
      }
      stats.forcedSales++;
      G.renderStatus();
      await UI.alert({ title: '被迫賣股', message: '現金不足以支付生活開銷，你的持股被迫賣出換現。', okText: '我知道了' });
    }
    let reason = null;
    if (state.cash <= 0) reason = 'bankrupt';
    else if (state.health <= 0) reason = 'death';
    else if (state.happiness <= 0) reason = 'unhappy';
    else if (age() >= E.maxAge) reason = 'maxAge';
    if (!reason) return false;
    await G.endGame(reason);
    return true;
  }

  diceBtn.addEventListener('click', turn);

  Object.assign(G, { setDiceEnabled, rollDice, stepOnce, stepDelay, runTile });
})(window.Game);
