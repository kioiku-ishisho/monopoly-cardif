/* 全服排行榜彈出視窗（首頁與結算頁共用） */
(function () {
  function rowHtml(p) {
    const who = `${p.jobIcon ? `<span aria-hidden="true">${UI.escape(p.jobIcon)}</span> ` : ''}${UI.escape(p.jobName || '玩家')}`;
    return `
      <tr class="${p.isMe ? 'is-me' : ''}"${p.isMe ? ' aria-current="true"' : ''}>
        <td class="lb-rank"><span aria-hidden="true">${p.rank <= 3 ? UI.icon('medal') + ' ' : ''}${p.rank}</span><span class="sr-only">第 ${p.rank} 名</span></td>
        <td>${who}${p.isMe ? ' <strong class="lb-me">（你）</strong>' : ''}</td>
        <td>${p.finalAge != null ? `${p.finalAge} 歲` : '—'}</td>
        <td class="lb-score">${p.score}<small>${UI.escape(p.grade)}</small></td>
      </tr>`;
  }

  function render(box, { top, me }) {
    const meHtml = me
      ? `<p class="lb-mine">你的最高分 <strong>${me.best}</strong> 分，全服第 <strong>${me.rank.toLocaleString('zh-TW')}</strong> 名（前 ${me.topPercent}%，共 ${me.total.toLocaleString('zh-TW')} 位玩家）</p>`
      : '<p class="lb-mine">你還沒有上榜的成績，完成一局並由 AI 評分後就會列入排行。</p>';
    box.innerHTML = meHtml + (top.length
      ? `<div class="table-wrap"><table class="data-table lb-table">
          <caption class="sr-only">全服前 ${top.length} 名</caption>
          <thead><tr><th scope="col">名次</th><th scope="col">職業</th><th scope="col">享壽</th><th scope="col">最高分</th></tr></thead>
          <tbody>${top.map(rowHtml).join('')}</tbody>
        </table></div>`
      : '<p class="empty">排行榜目前還沒有任何成績。</p>');
    box.setAttribute('aria-busy', 'false');
  }

  async function open() {
    const box = document.createElement('div');
    box.className = 'leaderboard';
    box.setAttribute('aria-live', 'polite');
    box.setAttribute('aria-busy', 'true');
    box.innerHTML = '<p class="empty">載入排行榜中…</p>';
    const shown = UI.modal({ title: '🏆 全服排行榜', body: box, actions: [{ label: '關閉', value: 'ok', variant: 'primary' }] });
    try {
      render(box, await API.leaderboard());
    } catch (e) {
      console.warn('排行榜載入失敗', e);
      box.innerHTML = '<p class="empty">無法載入排行榜，請確認已連線遊戲伺服器。</p>';
      box.setAttribute('aria-busy', 'false');
    }
    return shown;
  }

  window.Leaderboard = { open };
})();
