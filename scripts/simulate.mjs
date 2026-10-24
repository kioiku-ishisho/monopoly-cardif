// 遊戲平衡模擬：不開瀏覽器，用兩種策略各跑很多局，統計失敗率與結束年齡，用數據調參數
//
// 用法：
//   node scripts/simulate.mjs                       每種策略 2,000 局
//   node scripts/simulate.mjs --games 5000
//   node scripts/simulate.mjs --set economy.inflation=0.03 --set economy.bankRate=0.01   試算參數（不會改檔案）
//
// 載入真正的 js/data.js、js/insurance.js 與 docs/event-cards.md，回合流程照 js/game.js 與 js/events.js 寫成無畫面版本。
// 簡化：股票只模擬台灣50 ETF；事件牌不分伺服器、直接從本機牌組抽（命運牌一樣依職業加權）。改 game.js 的規則時，這裡也要一起改。
//
// 策略：
//   none     不買保險、不投資，機會牌一半接受一半放棄（「不做規劃」）
//   planned  開局補齊醫療、意外、重大傷病等保障，30 歲起買年金險；保留 6 個月緊急預備金，多的錢定期定額買 ETF；
//            機會牌依現金、收入、健康、幸福權衡後才接受（「有做規劃」）
// 失敗：破產、幸福歸零，或 FAIL_DEATH_AGE 歲前健康歸零
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { parseCards, root } from './lib/cards.mjs';

const FAIL_DEATH_AGE = 75;
const args = process.argv.slice(2);
const GAMES = Number(args[args.indexOf('--games') + 1]) || 2000;
const overrides = args.flatMap((a, i) => (a === '--set' ? [args[i + 1]] : []));

// ===== 載入遊戲資料與保險模組 =====
const sandbox = { window: {}, console };
vm.createContext(sandbox);
const load = (file) => vm.runInContext(readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
load('js/data.js');
const D = sandbox.window.GameData;
for (const o of overrides) {
  const [key, raw] = o.split('=');
  const parts = key.split('.');
  const obj = parts.slice(0, -1).reduce((x, k) => x[k], D);
  obj[parts.at(-1)] = JSON.parse(raw);
}
sandbox.GameData = D;
sandbox.UI = { fmtMoney: (n) => String(Math.round(n)), fmtSigned: (n) => String(Math.round(n)) };
load('js/insurance.js');
const Insurance = sandbox.window.Insurance;
const E = D.economy;
const MPS = E.monthsPerStep;

const CARDS = parseCards();
const DECK = {};
for (const c of CARDS) (DECK[`${c.stage}-${c.kind}`] ||= []).push(c);

const rand = Math.random;
const d6 = () => 1 + Math.floor(rand() * 6);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const gaussian = () => {
  let u = 0, v = 0;
  while (!u) u = rand();
  while (!v) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pickWeighted = (list, weightOf) => {
  const total = list.reduce((s, x) => s + weightOf(x), 0);
  let r = rand() * total;
  return list.find((x) => (r -= weightOf(x)) < 0) || list[list.length - 1];
};

const PLANNED_POLICIES = [
  { id: 'medical', from: 25 },
  { id: 'accident', from: 25 },
  { id: 'major', from: 25 },
  { id: 'daily', from: 25 },
  { id: 'life', from: 28, until: 45 },
  { id: 'ltc', from: 35 },
  { id: 'annuity', from: 30, amount: 3000 },
];

function runGame(job, strategy) {
  const planned = strategy === 'planned';
  const state = {
    cash: job.salary * E.startCashMonths, health: 100, happiness: E.startHappiness, steps: 0, position: 0, lap: 0, stageIndex: 0,
    netIncomeAdj: 0, policies: [], medicalHistory: [], ltc: null, premiumArrears: 0, incomeStopUntil: 0, lastTag: null,
    skipTurns: 0, policyPerks: { discount: null, surcharge: 0 }, salaryIndex: 1, priceShock: 1,
  };
  const stats = { premiumsPaid: 0, claims: 0, claimTotal: 0, maxPremiumRatio: 0 };
  const etf = { price: D.stocks[0].price, shares: 0 };
  const drawn = new Set();
  const stage = () => D.stages[state.stageIndex];
  const age = () => E.startAge + (state.steps * MPS) / 12;
  const monthsPassed = () => state.steps * MPS;
  const priceIndex = () => Math.pow(1 + E.inflation, monthsPassed() / 12) * state.priceShock;
  const inflate = (n) => (n ? Math.round((n * priceIndex()) / 100) * 100 : 0);
  const expense = () => Math.round(job.expense * priceIndex());
  const Ins = Insurance.create({
    state, job, stats, age, etfPrice: () => etf.price, addHistory() {}, logDecision() {}, toast() {},
  });
  const incomeStopped = () => stage().id !== 'elder' && state.steps < state.incomeStopUntil;
  // 退休金依退休後的物價調整（economy.pensionIndexed）
  const pensionIndex = () => (stage().id === 'elder' && E.pensionIndexed && state.retirePrice ? priceIndex() / state.retirePrice : 1);
  const monthlyIncome = () => (incomeStopped() ? 0 : Math.round(job.salary * state.salaryIndex * E.incomeRate[stage().id] * pensionIndex()));
  const cashflow = () => monthlyIncome() - expense() - Ins.careCost() + state.netIncomeAdj;

  function stageIndexForLap(lap) {
    let acc = 0;
    for (let i = 0; i < D.stages.length; i++) {
      acc += D.stages[i].laps;
      if (lap < acc) return i;
    }
    return D.stages.length - 1;
  }

  function apply({ cash = 0, netIncome = 0, health = 0, happiness = 0 }) {
    state.cash = Math.round(state.cash + cash);
    state.netIncomeAdj += netIncome;
    state.health = clamp(Math.round(state.health + health), 0, 100);
    state.happiness = clamp(Math.round(state.happiness + happiness), 0, 100);
  }

  // ===== 經濟劇本（只看台灣50 ETF）=====
  const S = D.marketStory;
  const STORY = Object.fromEntries([...S.history, ...S.future].map((ep) => [ep.id, ep]));
  const between = ([a, b]) => a + Math.floor(rand() * (b - a + 1));
  let schedule = [];
  {
    const history = [...S.history];
    let future = [...S.future].sort(() => rand() - 0.5);
    for (let m = between(S.firstMonth); m < (E.maxAge - E.startAge) * 12; m += between(S.gapMonths)) {
      let ep;
      if (history.length && (rand() >= S.randomRate || !future.length)) ep = history.shift();
      else {
        if (!future.length) future = [...S.future].sort(() => rand() - 0.5);
        ep = future.shift();
      }
      schedule.push({ month: m, id: ep.id });
    }
  }
  let pending = [];
  let illness = null;

  function marketTick(months) {
    const now = monthsPassed();
    const due = schedule.filter((e) => e.month <= now).map((e) => STORY[e.id]);
    schedule = schedule.filter((e) => e.month > now);
    let move = 0;
    for (const p of pending) {
      const n = Math.min(p.left, months);
      move += p.per * n;
      p.left -= n;
    }
    pending = pending.filter((p) => p.left > 0);
    for (const ep of due) {
      move += ep.shock.ETF50 || 0;
      if (ep.recovery && ep.recovery.ETF50) pending.push({ left: ep.recovery.months, per: ep.recovery.ETF50 / ep.recovery.months });
      if (ep.price) state.priceShock *= 1 + ep.price;
      if (ep.illness) illness = { rate: ep.illness.rate, until: now + ep.illness.months };
      if (ep.life) {
        const cash = ep.life.workOnly && stage().id === 'elder' ? 0 : inflate(ep.life.cash || 0);
        apply({ cash, health: ep.life.health || 0, happiness: ep.life.happiness || 0 });
      }
    }
    const dt = months / 12;
    const s = D.stocks[0];
    const news = !due.length && rand() < 0.18 * dt ? D.marketNews[Math.floor(rand() * D.marketNews.length)] : null;
    const r = s.drift * dt + gaussian() * s.vol * Math.sqrt(dt) + (news ? news.effect * s.beta : 0) + move;
    etf.price = Math.max(1, etf.price * (1 + r));
  }

  function payMonth(noSalary = false) {
    if (state.cash > 0) state.cash += Math.round(state.cash * (E.bankRate / 12) * MPS);
    state.cash += (cashflow() - (noSalary ? monthlyIncome() : 0)) * MPS;
    Ins.monthly();
  }

  function passStart() {
    state.lap++;
    Ins.onLap();
    state.salaryIndex *= 1 + E.salaryGrowthPerLap;
    state.health = clamp(state.health - E.healthDecayPerLap[stage().id], 0, 100);
    const stress = state.cash < expense() * E.stress.months ? E.stress.happiness : 0;
    state.happiness = clamp(state.happiness - E.happinessDecayPerLap[stage().id] - stress, 0, 100);
    state.stageIndex = stageIndexForLap(state.lap);
    if (stage().id === 'elder' && !state.retirePrice) state.retirePrice = priceIndex();
  }

  function step() {
    state.position = (state.position + 1) % E.tilesPerLap;
    state.steps++;
    payMonth();
    if (state.position === 0) passStart();
  }

  function draw(kind) {
    const pool = DECK[`${stage().id}-${kind}`].filter((c) => !drawn.has(c.id));
    if (!pool.length) return null;
    const card = kind === 'fate' ? pickWeighted(pool, (c) => D.fateWeight(job, c)) : pool[Math.floor(rand() * pool.length)];
    drawn.add(card.id);
    return { ...card, cash: inflate(card.cash), netIncome: inflate(card.netIncome) };
  }

  function resolveFate(card, tag, days) {
    const cost = card.cash < 0 ? -card.cash : 0;
    const result = Ins.claim({ tag, cost, days });
    apply({ ...card, cash: card.cash + result.total });
    if (card.stopMonths) state.incomeStopUntil = Math.max(state.incomeStopUntil, state.steps + Math.ceil(card.stopMonths / MPS));
    if (tag) state.lastTag = { tag };
  }

  // 有規劃：依現金、收入、健康、幸福權衡機會牌，並確認付得起
  function acceptChance(card) {
    if (!planned) return rand() < 0.5;
    const ex = expense();
    const score = card.cash / ex + (card.netIncome * 24) / ex + card.health * 0.6 + card.happiness * 0.5;
    const affordable = card.cash >= 0 || state.cash + card.cash > ex * 6;
    const sustainable = card.netIncome >= 0 || cashflow() + card.netIncome > 0;
    return score > 0 && affordable && sustainable;
  }

  function buyPlanned() {
    if (!planned) return;
    const a = age();
    for (const plan of PLANNED_POLICIES) {
      if (a < plan.from || (plan.until && a > plan.until)) continue;
      const prod = Insurance.PRODUCTS[plan.id];
      if (!Ins.quote(prod).ok) continue;
      const projected = Ins.monthlyPremium() + (plan.amount || Ins.quote(prod).premium);
      if (projected > job.salary * 0.15) continue;
      Ins.buy(plan.id, plan.amount);
    }
  }

  // 有規劃：保留 6 個月生活費，多的錢一半買 ETF；現金不夠 2 個月時賣 ETF
  function rebalance() {
    if (!planned) return;
    const reserve = expense() * 6;
    if (state.cash > reserve * 1.5) {
      const money = (state.cash - reserve) * 0.5;
      const qty = Math.floor(money / etf.price);
      if (qty > 0) { etf.shares += qty; state.cash -= qty * etf.price; }
    } else if (state.cash < expense() * 2 && etf.shares) {
      const qty = Math.min(etf.shares, Math.ceil((reserve - state.cash) / etf.price));
      etf.shares -= qty;
      state.cash += qty * etf.price;
    }
  }

  const quizRate = planned ? 0.75 : 0.5;
  function runTile(type) {
    const SP = D.specialTiles;
    switch (type) {
      case 'chance': {
        const card = draw('chance');
        if (card && acceptChance(card)) apply(card);
        break;
      }
      case 'fate': {
        const card = draw('fate');
        if (card) resolveFate(card, D.cardTagOf[card.id] || null);
        break;
      }
      case 'hospital': {
        const days = d6() * D.hospital.daysPerPip;
        resolveFate({ cash: -inflate(days * D.hospital.costPerDay) }, 'hospital', days);
        state.skipTurns = D.hospital.skipTurns;
        break;
      }
      case 'insurance': buyPlanned(); break;
      case 'checkup': if (rand() < quizRate) apply({ cash: SP.checkup.cash }); break;
      case 'seminar': apply({ cash: SP.seminar.cash + 3 * SP.seminar.perCorrect * quizRate }); break;
      case 'myth': apply({ cash: rand() < quizRate ? SP.myth.win : SP.myth.lose }); break;
      case 'mentor':
        for (let i = 0; i < SP.mentor.steps; i++) step();
        runTile(D.board[state.position]);
        break;
      case 'promo': state.policyPerks.discount = { rate: SP.promo.rate, cap: SP.promo.cap }; break;
      case 'missed': state.policyPerks.surcharge += SP.missed.surcharge; break;
      case 'attic': if (!Ins.drawLegacy('')) apply({ cash: SP.attic.cash }); break;
      default: break;
    }
  }

  function maybeMajorIllness(months) {
    if (state.health <= 0) return;
    const cfg = D.majorIllness;
    const weightOf = (ev) => ev.weight * (['heart', 'stroke'].includes(ev.tag) ? job.risk.heart || 1 : 1);
    const base = cfg.events.reduce((s, ev) => s + ev.weight, 0);
    const total = cfg.events.reduce((s, ev) => s + weightOf(ev), 0);
    let rate = Insurance.interp(cfg.annualRate, age()) * (total / base) * (illness && monthsPassed() < illness.until ? illness.rate : 1);
    if (state.health < 70) rate *= 1 + ((70 - state.health) / 10) * 0.2;
    if (rand() >= (rate * months) / 12) return;
    const ev = pickWeighted(cfg.events, weightOf);
    resolveFate({ cash: 0, netIncome: 0, health: 0, happiness: 0, ...ev, cash: inflate(ev.cash || 0), netIncome: inflate(ev.netIncome || 0) }, ev.tag);
  }

  Ins.rollStarting();
  buyPlanned();
  for (let turn = 0; turn < 5000; turn++) {
    let months;
    if (state.skipTurns > 0) {
      state.skipTurns--;
      state.steps++;
      payMonth(stage().id !== 'elder');
      marketTick(MPS);
      months = MPS;
    } else {
      const n = d6();
      for (let i = 0; i < n; i++) step();
      marketTick(n * MPS);
      runTile(D.board[state.position]);
      months = n * MPS;
    }
    maybeMajorIllness(months);
    Ins.checkLtc();
    buyPlanned();
    rebalance();
    if (state.cash <= 0 && etf.shares) {
      state.cash += etf.shares * etf.price;
      etf.shares = 0;
    }
    let reason = null;
    if (state.cash <= 0) reason = 'bankrupt';
    else if (state.health <= 0) reason = 'death';
    else if (state.happiness <= 0) reason = 'unhappy';
    else if (age() >= E.maxAge) reason = 'maxAge';
    if (reason) return { reason, age: Math.floor(age()), happiness: state.happiness, health: state.health };
  }
  return { reason: 'timeout', age: Math.floor(age()) };
}

const isFail = (r) => r.reason === 'bankrupt' || r.reason === 'unhappy' || (r.reason === 'death' && r.age < FAIL_DEATH_AGE);
const pct = (n, total) => `${((n / total) * 100).toFixed(1)}%`;

function report(strategy) {
  const results = [];
  for (let i = 0; i < GAMES; i++) {
    const job = D.jobs[i % D.jobs.length];
    results.push({ job: job.id, ...runGame(job, strategy) });
  }
  const count = (fn) => results.filter(fn).length;
  const reasons = ['bankrupt', 'death', 'unhappy', 'maxAge'];
  const avgAge = results.reduce((s, r) => s + r.age, 0) / results.length;
  const agesOf = (reason) => results.filter((r) => r.reason === reason).map((r) => r.age).sort((a, b) => a - b);
  const quart = (xs) => (xs.length ? [0.25, 0.5, 0.75].map((q) => xs[Math.floor(xs.length * q)]).join('/') : '-');
  console.log(`\n## ${strategy}（${GAMES} 局）`);
  console.log(`失敗率 ${pct(count(isFail), GAMES)}　平均結束年齡 ${avgAge.toFixed(1)} 歲　破產年齡（25/50/75%）${quart(agesOf('bankrupt'))}　健康歸零年齡 ${quart(agesOf('death'))}`);
  console.log(reasons.map((r) => `${r} ${pct(count((x) => x.reason === r), GAMES)}`).join('　'));
  const byJob = D.jobs.map((j) => {
    const mine = results.filter((r) => r.job === j.id);
    return `${j.name} ${pct(mine.filter(isFail).length, mine.length)}`;
  });
  console.log('各職業失敗率：' + byJob.join('、'));
  return count(isFail) / GAMES;
}

console.log(`參數覆寫：${overrides.length ? overrides.join(' ') : '無'}　失敗定義：破產、幸福歸零、${FAIL_DEATH_AGE} 歲前健康歸零`);
report('none');
report('planned');
