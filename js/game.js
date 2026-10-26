/*
 * 遊戲主頁：開局流程
 * 各功能在 js/game/ 底下：
 *   core.js     狀態、統計、收支計算、歷史事件紀錄（window.Game）
 *   map.js      地圖、棋子、拖曳與縮放
 *   panels.js   狀態列、電腦版右側欄、個人資料、歷史事件、暫停與離開
 *   policies.js 保險視窗、保單表格、建議書
 *   market.js   股價、經濟劇本、股票視窗與買賣
 *   context.js  給 js/events.js 的事件 context
 *   report.js   人生階段報告、遊戲結束與結算紀錄
 *   turn.js     擲骰子與回合流程、過起點、重大疾病、結束判定
 */
(function (G) {
  if (!G) return;
  const { job, state, Ins, addHistory, logDecision } = G;

  addHistory('life', '🎬', `以「${job.name}」身分開始人生，起始現金 ${UI.fmtMoney(state.cash)}`);
  logDecision(`以${job.name}開始，月薪 ${UI.fmtMoney(job.salary)}`, 'milestone');
  G.buildBoard();
  requestAnimationFrame(() => G.fitBoard(false));
  G.announce('');

  state.story.schedule = G.buildStory();
  G.stageStats = G.newStageStats();

  // 開局保單類型與初始保單（父母買的舊保單）
  async function showStartingPolicies() {
    const { tier, policies } = Ins.rollStarting();
    G.renderStatus();
    const list = policies.map((p) => {
      const prod = Insurance.PRODUCTS[p.id];
      return `<li><strong>${prod.icon} ${UI.escape(prod.name)}</strong>：${UI.escape(prod.summary)}</li>`;
    }).join('');
    await UI.alert({
      title: '🗂️ 你的保險現況',
      html: `
        <div class="event-card" data-kind="insurance">
          <p class="card-text">你的保單類型是「<strong>${tier.name}</strong>」。</p>
          ${policies.length
            ? `<p>父母過去替你買了 ${policies.length} 張保單，已經繳清，不用再繳保費：</p><ul>${list}</ul>
               <p class="card-note">這些舊保單保障偏低，可以在右側「保險」分頁查看，或之後自己補強。</p>`
            : '<p class="card-note">你目前沒有任何保單。可以在右側「保險」分頁閱讀各險種條款並投保，或等保險業務員來介紹。</p>'}
        </div>`,
      okText: '開始人生',
      dismissible: false,
    });
  }

  // 向伺服器建立本局，之後的抽牌都以此 id 避免重複
  // 這台裝置第一次遊玩時先播新手教學，再顯示保險現況；連線失敗的提示等開場視窗都結束後才出現
  G.setDiceEnabled(false);
  const starting = Tutorial.maybeRun().then(showStartingPolicies);
  API.createGame(job.id)
    .then((id) => { state.gameId = id; })
    .catch(async () => {
      await starting;
      await UI.alert({
        title: '無法連線遊戲伺服器',
        message: '機會與命運牌、AI 評分與全服排名都需要伺服器。目前仍可遊玩，但抽不到牌，結算也會改用本機評分。',
      });
    })
    .finally(() => starting.then(() => G.setDiceEnabled(true)));
})(window.Game);
