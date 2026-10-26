/* 首頁：隨機職業、開始遊戲、選單彈窗 */
(function () {
  const { jobs, tips } = GameData;
  const $ = (s) => document.querySelector(s);

  UI.fillIcons();
  UI.bindDialogs();

  // ---- 職業 ----
  // 開場隨機一個職業，之後按 ⤨ 依序換下一個；整頁配色與角色圖跟著職業
  let current = null;

  function renderJob(job, animate) {
    current = job;
    UI.applyJobTheme(job);
    // 角色圖尚未提供，之後放 assets/jobs/<jobId>.png 再打開
    // $('#hero-art').style.backgroundImage = `url("assets/jobs/${job.id}.png")`;
    $('#job-name').textContent = job.name;
    $('#job-salary').textContent = UI.fmtMoney(job.salary);
    if (animate) {
      const btn = $('#btn-reroll');
      btn.classList.remove('spin');
      void btn.offsetWidth; // 重新觸發動畫
      btn.classList.add('spin');
      $('#job-live').textContent = `職業更換為${job.name}，月薪 ${job.salary.toLocaleString('zh-TW')} 元。`;
    }
  }

  $('#btn-reroll').addEventListener('click', () => {
    renderJob(jobs[(jobs.indexOf(current) + 1) % jobs.length], true);
  });

  $('#btn-start').addEventListener('click', () => {
    Store.session.set('newGame', { jobId: current.id, startedAt: Date.now() });
    Store.session.remove('lastResult');
    location.href = 'game.html';
  });

  renderJob(jobs[Math.floor(Math.random() * jobs.length)], false);

  // ---- 選單：關掉選單再開對應的視窗 ----
  const menu = $('#dlg-menu');
  document.querySelectorAll('[data-menu]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dlg = document.getElementById(btn.dataset.menu);
      menu.close();
      dlg.dispatchEvent(new CustomEvent('beforeopen'));
      dlg.showModal();
    });
  });

  $('#btn-leaderboard').addEventListener('click', () => { menu.close(); Leaderboard.open(); });

  // ---- 歷史遊玩紀錄 ----
  const END_LABEL = { bankrupt: '破產', death: '健康耗盡', unhappy: '幸福歸零', maxAge: '壽終正寢' };

  $('#dlg-history').addEventListener('beforeopen', () => {
    const list = Store.getHistory();
    const body = $('#history-body');
    if (!list.length) {
      body.innerHTML = '<p class="empty">還沒有任何紀錄，開始你的第一場人生吧！</p>';
      return;
    }
    body.innerHTML = `
      <div class="best-score"><span>個人最高分</span><strong>${Store.getBestScore()}</strong></div>
      <ul class="history-list">
        ${list.map((h) => `
          <li class="history-item">
            <span class="h-title">${UI.escape(h.jobName)}・${h.finalAge} 歲・${END_LABEL[h.endReason] || ''}</span>
            <span class="h-meta">${new Date(h.endedAt).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })}・淨資產 ${UI.fmtMoney(h.netWorth)}</span>
            <span class="h-score" aria-label="評分 ${h.score} 分">${h.score}<small>${UI.escape(h.grade)} 級</small></span>
          </li>`).join('')}
      </ul>`;
  });

  // ---- 歷史取得提示 ----
  $('#dlg-tips').addEventListener('beforeopen', () => {
    const owned = new Set(Store.getTips());
    $('#tips-body').innerHTML = `
      <p class="tip-progress">已解鎖 ${owned.size} / ${tips.length} 則理財提示</p>
      <ul class="tip-list">
        ${tips.map((t) => owned.has(t.id)
          ? `<li class="tip-item"><h3>💡 ${UI.escape(t.title)}</h3><p>${UI.escape(t.text)}</p></li>`
          : '<li class="tip-item locked"><h3>🔒 尚未解鎖</h3><p>完成遊戲並閱讀 AI 建議即可解鎖。</p></li>').join('')}
      </ul>`;
  });

  // ---- 設定 ----
  const form = $('#settings-form');
  function loadSettings() {
    const s = Store.getSettings();
    form.lang.value = s.lang;
    form.querySelector(`input[name="theme"][value="${s.theme}"]`).checked = true;
    form.querySelector(`input[name="font"][value="${s.font}"]`).checked = true;
    form.querySelector(`input[name="stockColor"][value="${s.stockColor}"]`).checked = true;
    form.reduceMotion.checked = s.reduceMotion;
    form.highContrast.checked = s.highContrast;
  }
  $('#dlg-settings').addEventListener('beforeopen', loadSettings);
  form.addEventListener('change', () => {
    Store.saveSettings({
      lang: form.lang.value,
      theme: form.querySelector('input[name="theme"]:checked').value,
      font: form.querySelector('input[name="font"]:checked').value,
      stockColor: form.querySelector('input[name="stockColor"]:checked').value,
      reduceMotion: form.reduceMotion.checked,
      highContrast: form.highContrast.checked,
    });
    UI.applySettings();
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  $('#btn-clear').addEventListener('click', async () => {
    const ok = await UI.confirm({
      title: '清除紀錄',
      message: '確定要清除所有遊玩紀錄與已解鎖的提示嗎？此動作無法復原。',
      okText: '清除',
      danger: true,
    });
    if (ok) {
      Store.clearAll();
      UI.toast('已清除所有紀錄');
    }
  });
})();
