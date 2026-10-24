/* 遊戲主頁：保險視窗（我的保單、全部險種）、保單表格、建議書 */
(function (G) {
  if (!G) return;
  const { D, $, job, state, Ins, age } = G;

  function policyTable() {
    if (!state.policies.length) return '<p class="empty">目前沒有保單，踩到「保險業務員」格時可以投保。</p>';
    return `
      <div class="table-wrap"><table class="data-table policy-table">
        <thead><tr><th scope="col">險種</th><th scope="col">投保</th><th scope="col">狀態</th><th scope="col">月繳</th><th scope="col">已繳</th><th scope="col">已領給付</th><th scope="col">保單價值</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead>
        <tbody>${state.policies.map((p) => {
          const active = p.status === 'active';
          const due = active && !p.paidUp && !p.stopped;
          const surrender = Ins.surrenderValue(p);
          const actions = [];
          if (active && p.id === 'invest') actions.push(`<button class="btn btn-sm btn-ghost" type="button" data-policy-stop="${p.uid}" ${state.over ? 'disabled' : ''}>${p.stopped ? '恢復繳費' : '停繳'}</button>`);
          if (Ins.canSurrender(p)) actions.push(`<button class="btn btn-sm btn-ghost" type="button" data-policy-cancel="${p.uid}" ${state.over ? 'disabled' : ''}>解約${surrender ? `（${UI.fmtMoney(surrender)}）` : ''}</button>`);
          return `<tr class="${active ? '' : 'inactive'}">
            <td>${Insurance.PRODUCTS[p.id].icon} ${UI.escape(p.name)}</td>
            <td>${p.entryAge} 歲</td>
            <td>${Ins.statusText(p)}</td>
            <td>${due ? UI.fmtMoney(p.monthly) : '—'}</td>
            <td>${UI.fmtMoney(p.paid)}</td>
            <td>${UI.fmtMoney(p.claimed)}</td>
            <td>${UI.fmtMoney(Ins.policyValue(p))}</td>
            <td class="policy-actions">${actions.join('')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="e-meta">保費與生活費一起每月扣款；現金不足時有 ${D.insurance.graceMonths} 個月寬限期，之後仍繳不出就停效。</p>`;
  }

  // 個人資料面板與保險視窗共用：解約、停繳、投保、建議書
  async function onPolicyAction(e) {
    const btn = e.target.closest('[data-policy-cancel],[data-policy-stop],[data-buy-product],[data-proposal]');
    if (!btn) return;
    if (btn.dataset.proposal) { openProposal(btn.dataset.proposal); return; }
    if (state.over) return;
    if (btn.dataset.buyProduct) {
      const prod = Insurance.PRODUCTS[btn.dataset.buyProduct];
      const q = Ins.quote(prod);
      if (!q.ok) { UI.toast(q.reason); return; }
      if (!prod.amounts) {
        const ok = await UI.confirm({
          title: `投保${prod.name}`,
          message: `每月保費 ${UI.fmtMoney(q.premium)}，${Insurance.payTermText(prod)}，${Insurance.coverText(prod)}。確定投保嗎？`,
          okText: '投保',
          cancelText: '再想想',
        });
        if (!ok) return;
      }
      if (!(await TileEvents.purchase(prod, G.ctx))) return;
    } else if (btn.dataset.policyStop) {
      Ins.toggleStop(Number(btn.dataset.policyStop));
    } else {
      const uid = Number(btn.dataset.policyCancel);
      const p = state.policies.find((x) => x.uid === uid);
      const cash = Ins.surrenderValue(p);
      const ok = await UI.confirm({
        title: `解約${p.name}`,
        message: cash ? `解約後可領回 ${UI.fmtMoney(cash)}，保障立即結束。` : '這張保單沒有解約金，解約後保障立即結束，之後重新投保要再核保。',
        okText: '解約',
        cancelText: '保留',
        danger: true,
      });
      if (!ok) return;
      Ins.surrender(uid);
      UI.toast(`已解約${p.name}`);
    }
    G.renderStatus();
    if (G.isSheetOpen()) G.renderSheet();
    if ($('#dlg-policy').open) renderPolicyDialog();
  }
  $('#sheet-body').addEventListener('click', onPolicyAction);
  $('#policy-body').addEventListener('click', onPolicyAction);

  // ===== 保單與保險規則 =====
  const PRICING_TEXT = {
    level: '投保時鎖定保費',
    natural: '每圈依年齡調整保費',
    job: '依職業決定保費',
    amount: '自選每月金額',
  };
  let policyTab = 'mine';

  function premiumText(p) {
    if (p.pricing === 'amount') return `每月 ${p.amounts.map((a) => UI.fmtMoney(a)).join(' / ')} 擇一`;
    if (p.pricing === 'job') return `你的職業：每月 ${UI.fmtMoney(p.jobPremium[job.id] ?? p.jobPremium.default)}`;
    return Object.entries(p.premium).map(([a, v]) => `${a} 歲 ${UI.fmtMoney(v)}`).join('、') + '（每月）';
  }

  // shop：在「全部險種」分頁顯示目前的報價與投保、建議書按鈕
  function productCard(p, owned, shop = false) {
    const chips = p.legacy ? ['已繳清', Insurance.coverText(p)] : [
      PRICING_TEXT[p.pricing],
      Insurance.payTermText(p),
      Insurance.coverText(p),
      Insurance.waitText(p),
      `${p.maxEntryAge} 歲前可投保`,
      p.minHealth ? `健康需 ≥ ${p.minHealth}` : '不需核保',
    ];
    let quote = '';
    if (shop) {
      const q = Ins.quote(p);
      const price = !q.ok ? `<span class="neg">無法投保：${UI.escape(q.reason)}</span>`
        : p.amounts ? '你可以自選月繳金額'
        : `你現在投保：每月 <strong>${UI.fmtMoney(q.premium)}</strong>${q.surcharge > 1 ? `（健康加費 ${Math.round((q.surcharge - 1) * 100)}%）` : ''}`;
      quote = `
        <p class="product-quote">${price}</p>
        <div class="product-actions">
          <button class="btn btn-sm btn-ghost" type="button" data-proposal="${p.id}">📄 建議書</button>
          <button class="btn btn-sm btn-primary" type="button" data-buy-product="${p.id}" ${!q.ok || state.over ? 'disabled' : ''}>投保</button>
        </div>`;
    }
    return `
      <article class="product-card${owned ? ' owned' : ''}">
        <h3><span aria-hidden="true">${p.icon}</span> ${UI.escape(p.name)}${owned ? ` <span class="owned-badge">${p.legacy ? '舊保單' : '已投保'}</span>` : ''}</h3>
        <p class="product-summary">${UI.escape(p.summary)}</p>
        <ul class="effect-list">${chips.map((c) => `<li>${UI.escape(c)}</li>`).join('')}</ul>
        ${p.legacy ? '' : `<p class="product-premium">保費表：${UI.escape(premiumText(p))}</p>`}
        <p class="card-note">${UI.escape(p.note)}</p>
        ${quote}
      </article>`;
  }

  // 建議書（可列印成 PDF）：依目前年齡、職業、健康加費試算
  function openProposal(id) {
    const prod = Insurance.PRODUCTS[id];
    const q = Ins.quote(prod);
    // 傳精確年齡，建議書的首年保費才會和業務員／保險頁的報價一致
    const params = new URLSearchParams({ product: id, age: Math.round(age() * 100) / 100, job: job.id, surcharge: q.surcharge || 1 });
    window.open(`proposal.html?${params}`, '_blank');
  }

  function renderPolicyDialog() {
    document.querySelectorAll('[data-policy-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.policyTab === policyTab)));
    const cfg = D.insurance;
    const ownedIds = new Set(state.policies.filter((p) => p.status === 'active').map((p) => p.id));
    const products = Object.values(Insurance.PRODUCTS);
    if (policyTab === 'mine') {
      const mine = products.filter((p) => ownedIds.has(p.id));
      $('#policy-body').innerHTML = `
        <p class="policy-total">每月保費合計 <strong>${UI.fmtMoney(Ins.monthlyPremium())}</strong>
          ・建議上限（月薪 ${Math.round(cfg.budgetRate * 100)}%）${UI.fmtMoney(job.salary * cfg.budgetRate)}</p>
        ${policyTable()}
        ${mine.length ? `<h3 class="policy-h">保障內容</h3><div class="product-list">${mine.map((p) => productCard(p, true)).join('')}</div>` : ''}`;
    } else {
      const perk = G.perkText();
      $('#policy-body').innerHTML = `
        ${perk ? `<p class="policy-perk">${UI.escape(perk)}</p>` : ''}
        <h3 class="policy-h">通用規則</h3>
        <ul class="rule-list">
          <li>隨時都可以在這裡自己閱讀條款並投保；踩到「保險業務員」格時，業務員會介紹適合你的險種並回答問題。</li>
          <li>每個險種都有「建議書」，列出逐年的保費、身故給付與解約金，可以列印或另存成 PDF。</li>
          <li>保單可以隨時解約，有解約金的會領回現金，保障立即結束。</li>
          <li>保費與生活費一起每月扣款；現金不足時有 ${cfg.graceMonths} 個月寬限期，之後仍繳不出就停效。</li>
          <li>雙十原則：保費總額建議不超過月薪的 ${Math.round(cfg.budgetRate * 100)}%。</li>
          <li>健康降到 ${cfg.ltc.health} 以下會進入長照狀態，之後每月多 ${UI.fmtMoney(cfg.ltc.careCost)} 照護費。</li>
          <li>健康較差時投保可能加費或被拒保；有等待期的險種，生效前發生的事故不理賠。</li>
        </ul>
        <h3 class="policy-h">全部險種</h3>
        <div class="product-list">${products.filter((p) => !p.legacy).map((p) => productCard(p, ownedIds.has(p.id), true)).join('')}</div>`;
    }
  }

  // 疊在目前的視窗上開啟「我的保單」，關閉時 resolve（保險業務員格使用）
  function showMyPolicies() {
    policyTab = 'mine';
    renderPolicyDialog();
    const dlg = $('#dlg-policy');
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', resolve, { once: true }));
  }

  document.querySelectorAll('[data-policy-tab]').forEach((btn) => {
    btn.addEventListener('click', () => { policyTab = btn.dataset.policyTab; renderPolicyDialog(); });
  });
  $('#btn-policy').addEventListener('click', () => { renderPolicyDialog(); $('#dlg-policy').showModal(); });

  Object.assign(G, { policyTable, openProposal, showMyPolicies });
})(window.Game);
