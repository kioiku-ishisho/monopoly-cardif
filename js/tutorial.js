/*
 * 新手教學：逐步聚光燈導覽
 * 這台裝置第一次進入遊戲時自動播放（localStorage lf.tutorialDone），也可以從暫停視窗重看。
 * 每一步可指定 target（CSS 選擇器），會把該元素挖空打亮，說明卡片放在它旁邊；沒有 target 時卡片置中。
 */
(function () {
  const DONE_KEY = 'tutorialDone';

  const STEPS = [
    {
      icon: '👋',
      title: '歡迎來到現實人生',
      html: `
        <p>你將從 <strong>25 歲</strong> 出發，用擲骰子走完一生，一路上做出保險、投資與生活上的選擇。</p>
        <p>接下來用 1 分鐘帶你認識畫面上的每個功能，隨時可以按「略過教學」。</p>`,
    },
    {
      target: '#stage-chip',
      icon: '🧭',
      title: '遊戲流程：三個人生階段',
      html: `
        <ol class="tut-stages">
          <li><span class="tut-badge" style="--c: var(--youth)">青年</span>25–40 歲・走 3 圈・正常領薪水</li>
          <li><span class="tut-badge" style="--c: var(--middle)">中年</span>40–65 歲・走 5 圈・收入提高，但健康開始下滑</li>
          <li><span class="tut-badge" style="--c: var(--elder)">老年</span>65 歲以後・改領退休金，一直走到遊戲結束</li>
        </ol>
        <p class="tut-note">上方這個標籤會顯示你目前的階段與年齡；每走完一個階段會有一份人生階段報告。</p>`,
    },
    {
      target: '#board-viewport',
      icon: '🗺️',
      title: '一圈 5 年、一格 1 個月',
      html: `
        <ul>
          <li>一圈有 <strong>60 格</strong>，走完一圈就是 <strong>5 年</strong>，所以每一格代表 <strong>1 個月</strong>。</li>
          <li>每走一格會自動 <strong>領薪水、付生活費</strong>，現金也會有銀行利息。</li>
          <li>物價每年通膨，薪水每圈小幅調升；每過一次起點，健康與幸福會自然變化。</li>
        </ul>
        <p class="tut-note">地圖可以拖曳、雙指或滾輪縮放，右側按鈕可回到自己的位置或看整圈。</p>`,
    },
    {
      target: '#board-viewport',
      icon: '❓',
      title: '機會與命運',
      html: `
        <div class="tut-pair">
          <div><strong>❓ 機會</strong><p>抽一張機會牌，你可以 <strong>選擇接受或放棄</strong>，例如進修、旅遊、創業。</p></div>
          <div><strong>🎴 命運</strong><p>抽一張命運牌，<strong>抽到就一定會發生</strong>，例如生病、意外、加薪。</p></div>
        </div>
        <p class="tut-note">同一局不會抽到重複的牌。職業會影響事件機率；有保險時，命運帶來的醫療支出可以理賠。地圖上還有 🛡️ 保險業務員、🏥 住院、⭐ 特殊格與 ☕ 休息格。</p>`,
    },
    {
      icon: '🏁',
      title: '遊戲什麼時候結束？',
      html: `
        <ul class="tut-ends">
          <li><span aria-hidden="true">💸</span><span><strong>破產</strong>：現金歸零（持股會先被迫賣出換現）</span></li>
          <li><span aria-hidden="true">❤️</span><span><strong>健康耗盡</strong>：健康指數歸零</span></li>
          <li><span aria-hidden="true">😞</span><span><strong>幸福歸零</strong>：幸福指數歸零，失去生活動力</span></li>
          <li><span aria-hidden="true">🕊️</span><span><strong>壽終正寢</strong>：平安活到 100 歲</span></li>
        </ul>
        <p class="tut-note">結束後 AI 會替你的人生評分，並給你理財與保險建議。</p>`,
    },
    {
      target: '#btn-sheet',
      icon: '📊',
      title: '個人數值面板',
      html: `
        <p>畫面下方隨時顯示 <strong>現金、健康指數、幸福指數</strong>。</p>
        <p>點一下這一列，會從下方滑出完整的 <strong>個人資料</strong>：每月收入與生活費、保費占月薪比例、每月結餘、淨資產、持股明細與保單。</p>
        <p class="tut-note">每月結餘變成負數時要特別注意，現金會慢慢被吃光。</p>`,
    },
    {
      target: '#btn-policy',
      icon: '🛡️',
      title: '保險',
      html: `
        <ul>
          <li>開局時父母可能已替你買了幾張舊保單，保障偏低，可以自己補強。</li>
          <li>「全部險種」可以閱讀條款、看 <strong>📄 建議書</strong>，直接投保。</li>
          <li>踩到 🛡️ 保險業務員格，可以和 AI 業務員聊天、問問題，並按推薦直接投保。</li>
          <li><strong>越年輕投保越便宜</strong>；保費每月自動扣款，繳不出來保單會停效。</li>
        </ul>
        <p class="tut-note">建議保費總額約為月薪的 10%（雙十原則）。生病後部分險種會拒保。</p>`,
    },
    {
      target: '#btn-stock',
      icon: '📈',
      title: '股票',
      html: `
        <ul>
          <li>隨時可以在這裡 <strong>買賣股票</strong>，看每檔股票的走勢與持股損益。</li>
          <li>每走一格股價都會波動，遊戲中還會出現真實歷史上的經濟事件（例如金融海嘯）。</li>
          <li>地圖上方的 <strong>市場跑馬燈</strong> 會顯示最新一次的市場波動。</li>
        </ul>
        <p class="tut-note">現金不夠付生活費時，持股會被迫賣出，記得保留緊急預備金。</p>`,
    },
    {
      target: '#btn-pause',
      icon: '⏸️',
      title: '暫停與個人化設定',
      html: `
        <p>按 <strong>暫停</strong> 可以隨時休息，暫停視窗裡也能直接調整：</p>
        <ul>
          <li><strong>外觀主題</strong>：跟隨系統、淺色、深色</li>
          <li><strong>股票漲跌顏色</strong>：紅漲綠跌（台股）或綠漲紅跌（美股）</li>
        </ul>
        <p class="tut-note">想重看這份教學，也可以從暫停視窗開啟。文字大小、減少動態、高對比在首頁右上角 ⚙️ 設定。</p>`,
    },
    {
      target: '#btn-history',
      icon: '📰',
      title: '歷史事件紀錄',
      html: `
        <p>這一局發生過的所有事情都記錄在這裡，並標示是第幾回合、幾歲時發生。</p>
        <p>可以篩選「市場波動」或「人生事件」；點地圖上方的跑馬燈，也會直接打開市場波動紀錄。</p>`,
    },
    {
      target: '#btn-dice',
      icon: '🎲',
      title: '準備好了嗎？',
      html: `
        <p>按 <strong>擲骰子</strong> 就會依點數前進，踩到的格子會發生事件。</p>
        <p>祝你的人生精彩又財務自由！</p>`,
    },
  ];

  let running = null;

  // 回傳 Promise，教學結束（完成或略過）時 resolve
  function run() {
    if (running) return running;
    running = new Promise((resolve) => {
      const opener = document.activeElement;
      const dlg = document.createElement('dialog');
      dlg.className = 'tutorial';
      dlg.setAttribute('aria-labelledby', 'tut-title');
      dlg.setAttribute('aria-describedby', 'tut-body');
      dlg.innerHTML = `
        <div class="tut-hole" aria-hidden="true"></div>
        <section class="tut-card">
          <div class="tut-progress" aria-hidden="true"><span></span></div>
          <p class="tut-step" id="tut-step"></p>
          <h2 class="tut-title" id="tut-title"><span class="tut-icon" aria-hidden="true"></span><span class="tut-title-text"></span></h2>
          <div class="tut-body" id="tut-body"></div>
          <div class="tut-actions">
            <button class="btn btn-sm btn-ghost tut-skip" type="button">略過教學</button>
            <span class="tut-nav">
              <button class="btn btn-sm btn-ghost tut-prev" type="button">上一步</button>
              <button class="btn btn-sm btn-primary tut-next" type="button"></button>
            </span>
          </div>
        </section>`;
      const hole = dlg.querySelector('.tut-hole');
      const card = dlg.querySelector('.tut-card');
      const prevBtn = dlg.querySelector('.tut-prev');
      const nextBtn = dlg.querySelector('.tut-next');
      let index = 0;

      function render() {
        const step = STEPS[index];
        const last = index === STEPS.length - 1;
        dlg.querySelector('#tut-step').textContent = `新手教學 ${index + 1} / ${STEPS.length}`;
        dlg.querySelector('.tut-progress span').style.width = `${((index + 1) / STEPS.length) * 100}%`;
        dlg.querySelector('.tut-icon').textContent = step.icon;
        dlg.querySelector('.tut-title-text').textContent = step.title;
        dlg.querySelector('#tut-body').innerHTML = step.html;
        dlg.querySelector('#tut-body').scrollTop = 0;
        prevBtn.hidden = index === 0;
        nextBtn.textContent = last ? '開始遊戲' : '下一步';
        place();
        nextBtn.focus();
      }

      // 把聚光燈移到目標元素上，卡片放在上下空間較多的一側；放不下就疊在畫面下方
      function place() {
        const step = STEPS[index];
        const el = step.target && document.querySelector(step.target);
        const rect = el && el.getClientRects().length ? el.getBoundingClientRect() : null;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const gap = 12;
        const pad = 6;
        card.style.left = card.style.top = '';
        if (!rect) {
          dlg.classList.add('no-target');
          hole.style.cssText = '';
          card.dataset.place = 'center';
          return;
        }
        dlg.classList.remove('no-target');
        // 大面積目標（地圖）縮一點，讓卡片疊上去時仍看得出範圍
        const big = rect.height > vh * 0.5;
        const inset = big ? 12 : -pad;
        const box = {
          left: Math.max(4, rect.left + inset),
          top: Math.max(4, rect.top + inset),
          right: Math.min(vw - 4, rect.right - inset),
          bottom: Math.min(vh - 4, rect.bottom - inset),
        };
        Object.assign(hole.style, {
          left: box.left + 'px',
          top: box.top + 'px',
          width: box.right - box.left + 'px',
          height: box.bottom - box.top + 'px',
        });
        const ch = card.offsetHeight;
        const cw = card.offsetWidth;
        const below = vh - box.bottom - gap;
        const above = box.top - gap;
        let top;
        if (below >= ch + 8) { top = box.bottom + gap; card.dataset.place = 'below'; }
        else if (above >= ch + 8) { top = box.top - gap - ch; card.dataset.place = 'above'; }
        else { card.dataset.place = 'overlay'; return; }
        const center = (box.left + box.right) / 2;
        const left = Math.min(vw - cw - 16, Math.max(16, center - cw / 2));
        card.style.left = left + 'px';
        card.style.top = top + 'px';
      }

      function go(delta) {
        const next = index + delta;
        if (next < 0) return;
        if (next >= STEPS.length) { finish(); return; }
        index = next;
        render();
      }

      let done = false;
      function finish() {
        if (done) return;
        done = true;
        Store.set(DONE_KEY, true);
        window.removeEventListener('resize', place);
        if (dlg.open) dlg.close();
        dlg.remove();
        running = null;
        if (opener && document.contains(opener)) opener.focus();
        resolve();
      }

      nextBtn.addEventListener('click', () => go(1));
      prevBtn.addEventListener('click', () => go(-1));
      dlg.querySelector('.tut-skip').addEventListener('click', finish);
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(); });
      dlg.addEventListener('keydown', (e) => {
        if (e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      });
      window.addEventListener('resize', place);

      document.body.append(dlg);
      dlg.showModal();
      render();
    });
    return running;
  }

  // 第一次在這台裝置遊玩才自動播放
  const maybeRun = () => (Store.get(DONE_KEY) ? Promise.resolve() : run());

  window.Tutorial = { run, maybeRun };
})();
