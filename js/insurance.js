/*
 * 保險模組：投保、每月扣保費、理賠、長照、身故給付、保單價值、初始保單、建議書試算
 * 險種設定在 js/data.js 的 insurance（products 可投保，legacy 為開局的舊保單）；時間以「月」計，每走一格處理 economy.monthsPerStep 個月
 *
 * Insurance.create(env) 由 js/game.js 建立，env：
 *   state / job / stats / age() / etfPrice()
 *   addHistory(kind, icon, text) / logDecision(text, category) / toast(text)
 */
(function () {
  const D = GameData;
  const CFG = D.insurance;
  const MPS = D.economy.monthsPerStep;
  const ALL = [...CFG.products, ...CFG.legacy.map((p) => ({ ...p, legacy: true }))];
  const PRODUCTS = Object.fromEntries(ALL.map((p) => [p.id, p]));
  const claimTypeOf = (prod) => prod.claimType || prod.id;
  const MAJOR_TAGS = ['cancer', 'heart', 'stroke', 'esrd']; // 會記入病史的疾病
  const TAG_NAME = { accident: '意外', hospital: '一般住院', cancer: '癌症', heart: '心肌梗塞', stroke: '腦中風', esrd: '末期腎病', ltc: '長照' };
  const DEFAULT_SURCHARGES = [{ below: 70, rate: 0.3 }];

  // 依年齡表線性內插；超出最後一個年齡時沿最後一段斜率外插
  function interp(table, age) {
    const pts = Object.keys(table).map(Number).sort((a, b) => a - b);
    if (age <= pts[0]) return table[pts[0]];
    let i = pts.findIndex((p) => p >= age);
    if (i < 0) i = pts.length - 1;
    const [a, b] = [pts[i - 1], pts[i]];
    return table[a] + ((table[b] - table[a]) * (age - a)) / (b - a);
  }

  const round10 = (n) => Math.round(n / 10) * 10;

  // 本金 pv、月利率 r、n 期的每期年金
  const annuityPayment = (pv, r, n) => Math.round((pv * r) / (1 - Math.pow(1 + r, -n)));

  function payTermText(p) {
    if (p.legacy) return '已繳清';
    if (p.payMonths) return `繳 ${p.payMonths / 12} 年`;
    if (p.payUntilAge) return `繳到 ${p.payUntilAge} 歲`;
    if (p.id === 'invest') return '彈性，可隨時停繳';
    return '一年期，每圈續約';
  }
  const coverText = (p) => (p.coverUntilAge === Infinity ? '終身' : `保障到 ${p.coverUntilAge} 歲`);

  // 沒有住院天數的事件（命運牌、重大疾病）依醫藥費估算：約每 6,000 元 1 天
  const estimateDays = (cost) => Math.min(30, Math.max(1, Math.round(cost / 6000)));

  // 終身壽險解約金：累計已繳保費 × 依保單年度內插的倍數
  const cashValueOf = (prod, paid, years) => Math.round(paid * interp(prod.cashValue, years));

  function startPremium(prod, age, { jobId, surcharge = 1 } = {}) {
    if (prod.pricing === 'job') return prod.jobPremium[jobId] ?? prod.jobPremium.default;
    return Math.round(round10(interp(prod.premium, age)) * surcharge);
  }

  /*
   * 建議書逐年試算（proposal.html），不需要遊戲狀態
   * opts：{ age, jobId, amount（amount 型險種的月繳）, surcharge }
   * 回傳 [{ year, age, premium（年繳）, total（累計）, death（身故給付，null 表示沒有）, surrender（解約金）, note }]
   */
  function illustrate(prod, { age, jobId, amount, surcharge = 1 }) {
    const rows = [];
    const endAge = Math.min(prod.coverUntilAge, 100);
    let total = 0;
    let account = 0; // 投資型帳戶 / 年金帳戶
    let payout = 0;
    for (let year = 1; age + year - 1 < endAge; year++) {
      const a = age + year - 1;
      const monthly = prod.pricing === 'amount' ? amount
        : prod.pricing === 'natural' ? startPremium(prod, a, { surcharge }) : startPremium(prod, age, { jobId, surcharge });
      let paying = true;
      if (prod.payMonths) paying = year <= prod.payMonths / 12;
      else if (prod.payUntilAge) paying = a < prod.payUntilAge;
      else if (prod.id === 'invest') paying = a < 65; // 試算假設繳到 65 歲
      if (prod.id === 'annuity' && a >= prod.payoutAge) paying = false;
      const premium = paying ? monthly * 12 : 0;
      total += premium;
      let death = null;
      let surrender = 0;
      let note = '';
      if (prod.id === 'invest') {
        const fee = year <= prod.fee.months / 12 ? prod.fee.early : prod.fee.later;
        account = Math.max(0, (account + premium * (1 - fee)) * (1 + CFG.illustrateReturn) - interp(prod.costPerLap, a) / 5);
        death = Math.max(prod.benefit.death, account);
        surrender = account * (year <= prod.surrenderPenalty.months / 12 ? 1 - prod.surrenderPenalty.rate : 1);
      } else if (prod.id === 'annuity') {
        if (a < prod.payoutAge) {
          account = (account + premium) * (1 + prod.rate);
          death = account;
          surrender = account * (1 - (prod.surrenderByYear[year - 1] || 0));
        } else {
          if (!payout) payout = annuityPayment(account, prod.rate / 12, prod.guaranteeMonths);
          note = `年金每月 ${Math.round(payout).toLocaleString('zh-TW')}`;
        }
      } else if (prod.id === 'wholelife') {
        surrender = cashValueOf(prod, total, year);
        death = Math.max(prod.benefit.death, surrender);
      } else if (claimTypeOf(prod) === 'life') {
        death = prod.benefit.death;
      }
      rows.push({ year, age: a, premium, total, death: death == null ? null : Math.round(death), surrender: Math.round(surrender), note });
    }
    return rows;
  }
  const waitText = (p) => (p.waitMonths ? `等待期 ${p.waitMonths} 個月` : '立即生效');

  function create(env) {
    const { state, job, stats } = env;
    const fmt = UI.fmtMoney;
    let nextUid = 1;

    const months = () => state.steps * MPS; // 已經過的月數
    const inForce = (p) => p.status === 'active';
    const premiumDue = (p) => inForce(p) && !p.paidUp && !p.stopped;
    const product = (p) => PRODUCTS[p.id];

    // ===== 報價與核保 =====
    function surchargeOf(prod) {
      const list = prod.surcharges || DEFAULT_SURCHARGES;
      const hit = list.find((s) => state.health < s.below);
      return hit ? 1 + hit.rate : 1;
    }

    const basePremium = (prod, age) => startPremium(prod, age, { jobId: job.id });

    // 回傳 { ok, reason, premium, surcharge }；amount 型險種的 premium 為 null（由玩家選擇）
    function quote(prod) {
      const age = env.age();
      const fail = (reason) => ({ ok: false, reason });
      if (prod.legacy) return fail('舊保單，已停售');
      if (state.policies.some((p) => p.id === prod.id && inForce(p))) return fail('已經投保');
      if (age > prod.maxEntryAge) return fail(`超過最高投保年齡 ${prod.maxEntryAge} 歲`);
      if (state.health < prod.minHealth) return fail(`健康低於 ${prod.minHealth}，拒保`);
      const history = [...state.medicalHistory, ...(state.ltc ? ['ltc'] : [])];
      const hit = (prod.excludeHistory || []).find((t) => history.includes(t));
      if (hit) return fail(`有${TAG_NAME[hit]}病史，不可投保`);
      const surcharge = surchargeOf(prod);
      const premium = prod.pricing === 'amount' ? null : Math.round(basePremium(prod, age) * surcharge);
      return { ok: true, premium, surcharge };
    }

    // 隨機挑 offerCount 種符合條件的險種
    function offers() {
      const pool = CFG.products.filter((p) => quote(p).ok);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, CFG.offerCount).sort((a, b) => CFG.products.indexOf(a) - CFG.products.indexOf(b));
    }

    function buy(id, amount) {
      const prod = PRODUCTS[id];
      const q = quote(prod);
      if (!q.ok) return null;
      const age = env.age();
      const now = months();
      let payUntil = Infinity;
      if (prod.payUntilAge) payUntil = now + Math.round((prod.payUntilAge - age) * 12);
      else if (prod.payMonths) payUntil = now + prod.payMonths;
      const p = {
        uid: nextUid++,
        id,
        name: prod.name,
        entryAge: Math.floor(age),
        start: now,
        waitUntil: now + prod.waitMonths,
        payUntil,
        surcharge: q.surcharge,
        monthly: amount || q.premium,
        status: 'active',
        paidUp: false,
        stopped: false,
        paid: 0,
        claimed: 0,
        historyAtIssue: [...state.medicalHistory],
      };
      if (id === 'invest') p.units = 0;
      if (id === 'annuity') Object.assign(p, { balance: 0, payout: 0, guaranteeLeft: prod.guaranteeMonths });
      if (id === 'specific') p.paidTags = [];
      state.policies.push(p);
      if (!stats.firstInsuredAge) stats.firstInsuredAge = p.entryAge;
      const extra = q.surcharge > 1 ? `（健康加費 ${Math.round((q.surcharge - 1) * 100)}%）` : '';
      env.addHistory('life', '🛡️', `投保${prod.name}，月繳 ${fmt(p.monthly)}${extra}`);
      env.logDecision(`${p.entryAge} 歲投保${prod.name}，月繳 ${fmt(p.monthly)}${extra}`, 'insurance');
      applyPerks(p);
      const total = monthlyPremium();
      stats.maxPremiumRatio = Math.max(stats.maxPremiumRatio || 0, total / job.salary);
      return { policy: p, overBudget: total > job.salary * CFG.budgetRate, total };
    }

    // 特殊格給的下次投保優惠（首年保費折抵）與加價，在投保時一次結算
    function applyPerks(p) {
      const { discount, surcharge } = state.policyPerks;
      if (discount) {
        const refund = Math.min(discount.cap, Math.round(p.monthly * 12 * discount.rate));
        state.cash += refund;
        env.addHistory('life', '🏷️', `${p.name}首年保費折抵 ${Math.round(discount.rate * 100)}%，退回 ${fmt(refund)}`);
        env.toast(`🏷️ 保險優惠：退回 ${fmt(refund)}`);
      }
      if (surcharge) {
        state.cash -= surcharge;
        env.addHistory('life', '⌛', `錯過優惠，投保${p.name}加付 ${fmt(surcharge)}`);
        env.toast(`⌛ 錯過優惠：加付 ${fmt(surcharge)}`);
      }
      state.policyPerks = { discount: null, surcharge: 0 };
    }

    // ===== 初始保單（父母買的舊保單，已繳清）=====
    function grantLegacy(id, text) {
      const prod = PRODUCTS[id];
      const now = months();
      const p = {
        uid: nextUid++, id, name: prod.name, entryAge: Math.floor(env.age()), start: now, waitUntil: now, payUntil: now,
        surcharge: 1, monthly: 0, status: 'active', paidUp: true, stopped: false, paid: 0, claimed: 0,
        historyAtIssue: [...state.medicalHistory], legacy: true,
      };
      state.policies.push(p);
      env.addHistory('life', '🗂️', `${text}：${prod.name}（${prod.summary}）`);
      return p;
    }

    // 還沒有的舊保單
    const legacyLeft = () => CFG.legacy.filter((x) => !state.policies.some((p) => p.id === x.id));

    function drawLegacy(text) {
      const left = legacyLeft();
      if (!left.length) return null;
      return grantLegacy(left[Math.floor(Math.random() * left.length)].id, text);
    }

    // 開局：依機率決定保單類型，再抽不重複的舊保單
    function rollStarting() {
      const tiers = CFG.starting;
      let r = Math.random() * tiers.reduce((s, t) => s + t.weight, 0);
      const tier = tiers.find((t) => (r -= t.weight) < 0) || tiers[0];
      const policies = [];
      for (let i = 0; i < tier.count; i++) policies.push(drawLegacy('初始保單'));
      env.logDecision(`開局保單類型：${tier.name}${policies.length ? `（${policies.map((p) => p.name).join('、')}）` : ''}`, 'milestone');
      return { tier, policies };
    }

    // ===== 每月：保費、給付、年金累積 =====
    const monthlyPremium = () => state.policies.filter(premiumDue).reduce((s, p) => s + p.monthly, 0);

    // 目前每月固定領取的給付（年金、長照金、癌症治療金）
    function monthlyBenefit() {
      return state.policies.reduce((s, p) => {
        const prod = product(p);
        if (p.payout) return s + p.payout;
        if (p.cancerLeft) return s + prod.benefit.monthly;
        if (p.ltcFrom != null && months() >= p.ltcFrom) return s + prod.benefit.monthly;
        return s;
      }, 0);
    }

    function end(p, status, text, icon = '📄') {
      p.status = status;
      env.addHistory('life', icon, text);
    }

    // isClaim = false：年金、滿期金屬於自己存的錢，不算保險理賠
    function payBenefit(p, amount, text, isClaim = true) {
      if (!amount) return 0;
      p.claimed += amount;
      if (isClaim) stats.claimTotal += amount;
      if (text) env.addHistory('life', '🛡️', `${text}（${UI.fmtSigned(amount)}）`);
      return amount;
    }

    function monthly() {
      const age = env.age();
      const now = months();
      let benefit = 0;

      for (const p of state.policies) {
        if (!inForce(p)) continue;
        const prod = product(p);
        if (age >= prod.coverUntilAge) {
          // 投資型保險到期時領回帳戶價值
          const maturity = p.id === 'invest' ? payBenefit(p, investValue(p), '', false) : 0;
          benefit += maturity;
          const tail = p.id === 'life' ? '（定期壽險沒有解約金）' : maturity ? `，領回帳戶價值 ${fmt(maturity)}` : '';
          end(p, 'expired', `${prod.name}保障到 ${prod.coverUntilAge} 歲，保單結束${tail}`);
          continue;
        }
        if (!p.paidUp && now >= p.payUntil) {
          p.paidUp = true;
          env.addHistory('life', '✅', `${prod.name}已繳費期滿，之後不用再繳保費`);
        }
        // 年金：65 歲起把帳戶換成每月年金
        if (p.id === 'annuity' && !p.payout && age >= prod.payoutAge && p.balance > 0) {
          p.payout = annuityPayment(p.balance, prod.rate / 12, prod.guaranteeMonths);
          p.paidUp = true;
          env.addHistory('life', '🏦', `年金險開始給付，每月 ${fmt(p.payout)}（累積 ${fmt(p.balance)}）`);
          env.logDecision(`${Math.floor(age)} 歲年金險開始給付，帳戶累積 ${fmt(p.balance)}，每月領 ${fmt(p.payout)}`, 'insurance-claim');
          p.balance = 0;
        }
        if (p.payout) {
          benefit += payBenefit(p, p.payout * MPS, '', false);
          p.guaranteeLeft = Math.max(0, p.guaranteeLeft - MPS);
        }
        if (p.cancerLeft) {
          const n = Math.min(MPS, p.cancerLeft);
          benefit += payBenefit(p, prod.benefit.monthly * n);
          p.cancerLeft -= n;
          if (!p.cancerLeft) end(p, 'claimed', '癌症險治療金給付完畢，保單結束');
        }
        if (p.ltcFrom != null && now >= p.ltcFrom) {
          if (!p.ltcStarted) {
            p.ltcStarted = true;
            benefit += payBenefit(p, prod.benefit.lumpSum, '長照險一次給付');
          }
          benefit += payBenefit(p, prod.benefit.monthly * MPS);
        }
      }

      // 保費：現金不足時有寬限期，仍繳不出就停效
      const due = state.policies.filter(premiumDue);
      const total = due.reduce((s, p) => s + p.monthly, 0) * MPS;
      let paid = 0;
      if (total > 0) {
        if (state.cash >= total) {
          state.cash -= total;
          paid = total;
          state.premiumArrears = 0;
          stats.premiumsPaid += total;
          for (const p of due) {
            const amount = p.monthly * MPS;
            p.paid += amount;
            if (p.id === 'invest') {
              const fee = months() - p.start < product(p).fee.months ? product(p).fee.early : product(p).fee.later;
              p.units += (amount * (1 - fee)) / env.etfPrice();
            }
            if (p.id === 'annuity') p.balance += amount;
          }
        } else {
          state.premiumArrears = (state.premiumArrears || 0) + MPS;
          if (state.premiumArrears > CFG.graceMonths) {
            state.premiumArrears = 0;
            for (const p of due) {
              if (p.id === 'invest') {
                p.stopped = true;
                env.addHistory('life', '⚠️', '繳不出保費，投資型保險改為停繳（保險成本繼續從帳戶扣）');
              } else if (p.id === 'annuity') {
                p.paidUp = true;
                env.addHistory('life', '⚠️', '繳不出保費，年金險停止繳費，已累積的金額繼續計息');
              } else {
                end(p, 'lapsed', `繳不出保費，${p.name}停效`, '⚠️');
                stats.lapses = (stats.lapses || 0) + 1;
              }
            }
            env.logDecision(`${Math.floor(age)} 歲現金不足繳保費，${due.map((p) => p.name).join('、')}停效或停繳`, 'insurance-lapse');
            env.toast('⚠️ 保費繳不出，保單已停效');
          } else {
            env.addHistory('life', '⏰', `現金不足繳保費 ${fmt(total)}，進入 ${CFG.graceMonths} 個月寬限期`);
            env.toast(`⏰ 現金不足繳保費，寬限期 ${CFG.graceMonths} 個月內要補上`);
          }
        }
      }

      // 年金帳戶依宣告利率計息
      for (const p of state.policies) {
        if (p.id === 'annuity' && inForce(p) && !p.payout) p.balance *= Math.pow(1 + product(p).rate, MPS / 12);
      }
      state.cash += benefit;
      return { paid, benefit };
    }

    // ===== 每圈：自然費率重算、投資型保險扣保險成本 =====
    function onLap() {
      const age = env.age();
      for (const p of state.policies) {
        if (!inForce(p)) continue;
        const prod = product(p);
        if (prod.pricing === 'natural' && !p.paidUp) {
          const next = Math.round(basePremium(prod, age) * p.surcharge);
          if (next !== p.monthly) env.addHistory('life', '🧾', `${prod.name}續約，依年齡調整保費為每月 ${fmt(next)}`);
          p.monthly = next;
        }
        if (p.id === 'invest') {
          const cost = round10(interp(prod.costPerLap, age));
          p.units = Math.max(0, p.units - cost / env.etfPrice());
          env.addHistory('life', '🧾', `投資型保險從帳戶扣保險成本 ${fmt(cost)}`);
          if (p.units <= 0) end(p, 'lapsed', '投資型保險帳戶歸零，保單停效', '⚠️');
        }
      }
    }

    // ===== 理賠 =====
    // event：{ tag, cost, days }，cost 為事件的醫療支出（正數），days 為住院天數（沒有時依醫藥費估算）
    // 回傳 { total, items: [{ name, amount, note }], denied: [{ name, reason }] }
    function claim({ tag, cost = 0, days }) {
      const items = [];
      const denied = [];
      if (!tag) return { total: 0, items, denied };
      const now = months();
      let remaining = cost; // 實支實付類以剩下的醫藥費計算，合計不超過實際支出
      // 依 data.js 的順序處理：意外險先付，醫療險再付剩下的 80%
      const order = (p) => (claimTypeOf(product(p)) === 'accident' ? -100 : 0) + ALL.findIndex((x) => x.id === p.id);
      for (const p of state.policies.filter(inForce).sort((a, b) => order(a) - order(b))) {
        const prod = product(p);
        if (!prod.covers || !prod.covers.includes(tag)) continue;
        if (p.historyAtIssue.includes(tag)) { denied.push({ name: prod.name, reason: '投保前已有此病史' }); continue; }
        const type = claimTypeOf(prod);
        const waiting = now < p.waitUntil && !((type === 'medical' || type === 'daily') && tag === 'accident');
        if (waiting) {
          if (prod.refundInWait) {
            items.push({ name: prod.name, amount: p.paid, note: '等待期內確診，退還已繳保費，保單終止' });
            end(p, 'cancelled', `${prod.name}等待期內確診，退還保費 ${fmt(p.paid)}`);
          } else {
            denied.push({ name: prod.name, reason: '仍在等待期' });
          }
          continue;
        }
        let amount = 0;
        let note = '';
        if (type === 'accident') {
          amount = Math.min(remaining, prod.benefit.medicalMax);
          note = '意外醫療實支實付';
        } else if (type === 'daily') {
          const d = Math.min(days || estimateDays(cost), prod.benefit.maxDays);
          amount = d * prod.benefit.perDay;
          note = `住院 ${d} 天 × ${fmt(prod.benefit.perDay)}${days ? '' : '（依醫藥費估算天數）'}`;
        } else if (type === 'lump') {
          amount = prod.benefit.lumpSum;
          note = '一次給付，保單結束';
          p.status = 'claimed';
        } else if (type === 'surgery') {
          if (cost < prod.benefit.minCost) continue;
          amount = prod.benefit.perSurgery;
          note = '手術給付';
        } else if (p.id === 'medical') {
          amount = Math.round(Math.min(remaining * prod.benefit.rate, prod.benefit.max));
          note = `醫藥費 ${Math.round(prod.benefit.rate * 100)}%`;
        } else if (p.id === 'major') {
          amount = prod.benefit.lumpSum;
          note = '一次給付，保單結束';
          p.status = 'claimed';
        } else if (p.id === 'specific') {
          if (p.paidTags.includes(tag)) { denied.push({ name: prod.name, reason: `${TAG_NAME[tag]}已理賠過` }); continue; }
          amount = prod.benefit.lumpSum;
          p.paidTags.push(tag);
          note = `${TAG_NAME[tag]}一次給付`;
          if (prod.covers.every((t) => p.paidTags.includes(t))) p.status = 'claimed';
        } else if (p.id === 'cancer') {
          amount = prod.benefit.lumpSum;
          p.cancerLeft = prod.benefit.months;
          p.paidUp = true;
          note = `確診給付，之後每月 ${fmt(prod.benefit.monthly)} 治療金，共 ${prod.benefit.months} 個月`;
        }
        if (!amount) continue;
        if (type === 'accident' || type === 'medical') remaining -= amount;
        p.claimed += amount;
        items.push({ name: prod.name, amount, note });
      }
      const total = items.reduce((s, i) => s + i.amount, 0);
      if (total) {
        stats.claims++;
        stats.claimTotal += total;
      }
      if (MAJOR_TAGS.includes(tag) && !state.medicalHistory.includes(tag)) state.medicalHistory.push(tag);
      return { total, items, denied };
    }

    // ===== 長照：健康 ≤ 門檻時進入長照狀態 =====
    // 回傳 null（沒有變化）或 { notes: [] }
    function checkLtc() {
      if (state.ltc || state.health > CFG.ltc.health) return null;
      const now = months();
      state.ltc = { since: now, age: Math.floor(env.age()) };
      const notes = [];
      for (const p of state.policies.filter((x) => x.id === 'ltc' && inForce(x))) {
        const prod = product(p);
        if (now < p.waitUntil) {
          notes.push(`${prod.name}仍在等待期，無法理賠`);
          continue;
        }
        p.ltcFrom = now + prod.benefit.delayMonths;
        p.paidUp = true;
        stats.claims++;
        notes.push(`${prod.name}：${prod.benefit.delayMonths} 個月後開始給付 ${fmt(prod.benefit.lumpSum)}，之後每月 ${fmt(prod.benefit.monthly)}，並免繳保費`);
      }
      env.addHistory('life', '🧑‍🦽', `健康降到 ${state.health}，進入長照狀態，每月多 ${fmt(CFG.ltc.careCost)} 照護費`);
      env.logDecision(`${state.ltc.age} 歲進入長照狀態${notes.length ? `（${notes.join('；')}）` : '（沒有長照險）'}`, notes.length ? 'insurance-claim' : 'uninsured-loss');
      return { notes };
    }

    // ===== 身故：給付計入「留給家人」，不是玩家自己的現金 =====
    function deathBenefits(lastTag) {
      const age = env.age();
      const items = [];
      for (const p of state.policies.filter(inForce)) {
        const prod = product(p);
        let amount = 0;
        const type = claimTypeOf(prod);
        if (type === 'life') amount = prod.benefit.death;
        if (type === 'wholelife') amount = Math.max(prod.benefit.death, wholeLifeValue(p));
        if (type === 'accident' && lastTag === 'accident') amount = prod.benefit.death || 0;
        if (p.id === 'invest') amount = Math.max(prod.benefit.death, investValue(p));
        if (p.id === 'annuity') amount = p.payout ? p.payout * p.guaranteeLeft : Math.round(p.balance);
        if (!amount) continue;
        p.claimed += amount;
        p.status = 'claimed';
        items.push({ name: prod.name, amount });
      }
      const total = items.reduce((s, i) => s + i.amount, 0);
      if (total) env.logDecision(`${Math.floor(age)} 歲身故，保險給付家人 ${fmt(total)}（${items.map((i) => `${i.name} ${fmt(i.amount)}`).join('、')}）`, 'insurance-claim');
      return { total, items };
    }

    // ===== 保單價值與解約 =====
    const investValue = (p) => Math.round(p.units * env.etfPrice());
    const wholeLifeValue = (p) => cashValueOf(product(p), p.paid, (months() - p.start) / 12);

    function policyValue(p) {
      if (!inForce(p)) return 0;
      if (p.id === 'invest') return investValue(p);
      if (p.id === 'annuity') return p.payout ? p.payout * p.guaranteeLeft : Math.round(p.balance);
      if (p.id === 'wholelife') return wholeLifeValue(p);
      return 0;
    }
    const value = () => state.policies.reduce((s, p) => s + policyValue(p), 0);

    function surrenderValue(p) {
      if (!inForce(p)) return 0;
      const prod = product(p);
      const held = months() - p.start;
      if (p.id === 'invest') return Math.round(investValue(p) * (held < prod.surrenderPenalty.months ? 1 - prod.surrenderPenalty.rate : 1));
      if (p.id === 'annuity' && !p.payout) {
        const penalty = prod.surrenderByYear[Math.floor(held / 12)] || 0;
        return Math.round(p.balance * (1 - penalty));
      }
      if (p.id === 'wholelife') return wholeLifeValue(p);
      return prod.surrenderFlat || 0;
    }

    const canSurrender = (p) => inForce(p) && !(p.id === 'annuity' && p.payout) && !p.cancerLeft && p.ltcFrom == null;

    function surrender(uid) {
      const p = state.policies.find((x) => x.uid === uid);
      if (!p || !canSurrender(p)) return 0;
      const cash = surrenderValue(p);
      state.cash += cash;
      end(p, 'cancelled', `解約${p.name}${cash ? `，領回 ${fmt(cash)}` : '（沒有解約金）'}`);
      env.logDecision(`${Math.floor(env.age())} 歲解約${p.name}${cash ? `，領回 ${fmt(cash)}` : ''}`, 'insurance-cancel');
      return cash;
    }

    function toggleStop(uid) {
      const p = state.policies.find((x) => x.uid === uid && x.id === 'invest' && inForce(x));
      if (!p) return;
      p.stopped = !p.stopped;
      env.addHistory('life', '📄', `投資型保險${p.stopped ? '停繳（保險成本繼續從帳戶扣）' : '恢復繳費'}`);
      env.logDecision(`${Math.floor(env.age())} 歲投資型保險${p.stopped ? '停繳' : '恢復繳費'}`, 'insurance');
    }

    function statusText(p) {
      if (p.status === 'lapsed') return '停效';
      if (p.status === 'cancelled') return '已解約';
      if (p.status === 'expired') return '已到期';
      if (p.status === 'claimed') return '已理賠結束';
      if (p.payout) return '領年金中';
      if (p.cancerLeft) return `領治療金（剩 ${p.cancerLeft} 個月）`;
      if (p.ltcFrom != null) return months() >= p.ltcFrom ? '領長照金中' : '長照免責期';
      if (months() < p.waitUntil) return `等待期（剩 ${p.waitUntil - months()} 個月）`;
      if (p.stopped) return '停繳中';
      if (p.legacy) return '舊保單，已繳清';
      if (p.paidUp) return '繳清，保障中';
      return '保障中';
    }

    // 結算用的摘要
    function summary() {
      return state.policies.map((p) => ({
        id: p.id,
        name: p.name,
        entryAge: p.entryAge,
        monthly: p.monthly,
        status: statusText(p),
        legacy: !!p.legacy,
        paid: Math.round(p.paid),
        claimed: Math.round(p.claimed),
      }));
    }

    return {
      quote, offers, buy, grantLegacy, drawLegacy, legacyLeft, rollStarting, monthly, monthlyPremium, monthlyBenefit, onLap, claim, checkLtc, deathBenefits,
      value, policyValue, surrenderValue, canSurrender, surrender, toggleStop, statusText, summary,
      careCost: () => (state.ltc ? CFG.ltc.careCost : 0),
    };
  }

  window.Insurance = { create, interp, payTermText, coverText, waitText, illustrate, startPremium, claimTypeOf, TAG_NAME, PRODUCTS };
})();
