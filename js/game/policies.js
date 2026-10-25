/* 遊戲主頁：保險視窗（已投保保單、可投保險種）、保單表格、建議書 */
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

  // ===== 保險視窗：已投保保單與可投保險種，商品內容一律看建議書 =====
  // 建議書（可列印成 PDF）：依目前年齡、職業、健康加費試算
  function openProposal(id) {
    const prod = Insurance.PRODUCTS[id];
    const q = Ins.quote(prod);
    // 傳精確年齡，建議書的首年保費才會和業務員／保險頁的報價一致
    const params = new URLSearchParams({ product: id, age: Math.round(age() * 100) / 100, job: job.id, surcharge: q.surcharge || 1 });
    window.open(`proposal.html?${params}`, '_blank');
  }

  function productRow(p) {
    const q = Ins.quote(p);
    const price = !q.ok ? UI.escape(q.reason) : p.amounts ? '自選' : UI.fmtMoney(q.premium);
    return `<tr>
      <td>${UI.escape(p.name)}</td>
      <td>${p.maxEntryAge} 歲</td>
      <td>${price}</td>
      <td class="policy-actions">
        <button class="btn btn-sm btn-ghost" type="button" data-proposal="${p.id}">產生建議書</button>
        <button class="btn btn-sm btn-primary" type="button" data-buy-product="${p.id}" ${!q.ok || state.over ? 'disabled' : ''}>投保</button>
      </td>
    </tr>`;
  }

  function renderPolicyDialog() {
    const cfg = D.insurance;
    const perk = G.perkText();
    $('#policy-body').innerHTML = `
      ${perk ? `<p class="policy-perk">${UI.escape(perk)}</p>` : ''}
      <p class="policy-total">每月保費合計 <strong>${UI.fmtMoney(Ins.monthlyPremium())}</strong>
        ・建議上限（月薪 ${Math.round(cfg.budgetRate * 100)}%）${UI.fmtMoney(job.salary * cfg.budgetRate)}</p>
      <h3 class="policy-h">已投保保單</h3>
      ${policyTable()}
      <h3 class="policy-h">可投保險種</h3>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th scope="col">險種</th><th scope="col">最高投保年齡</th><th scope="col">首期月繳</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead>
        <tbody>${Object.values(Insurance.PRODUCTS).filter((p) => !p.legacy).map(productRow).join('')}</tbody>
      </table></div>
      <p class="e-meta">保障範圍、給付方式、等待期間及除外責任，請詳閱建議書或洽保險業務員。</p>`;
  }

  // 疊在目前的視窗上開啟「我的保單」，關閉時 resolve（保險業務員格使用）
  function showMyPolicies() {
    renderPolicyDialog();
    const dlg = $('#dlg-policy');
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', resolve, { once: true }));
  }

  $('#btn-policy').addEventListener('click', () => { renderPolicyDialog(); $('#dlg-policy').showModal(); });

  Object.assign(G, { policyTable, openProposal, showMyPolicies });
})(window.Game);
