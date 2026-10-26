/* 共用 UI 工具：設定套用、彈出視窗、提示訊息、格式化 */
(function () {
  const UI = {};

  UI.escape = (str) => String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  UI.fmtMoney = (n) => (n < 0 ? '-' : '') + 'NT$ ' + Math.abs(Math.round(n)).toLocaleString('zh-TW');
  UI.fmtSigned = (n) => (n >= 0 ? '+' : '-') + 'NT$ ' + Math.abs(Math.round(n)).toLocaleString('zh-TW');
  UI.fmtPct = (r) => (r >= 0 ? '+' : '') + (r * 100).toFixed(1) + '%';

  UI.applySettings = () => {
    const s = Store.getSettings();
    const root = document.documentElement;
    root.dataset.font = s.font;
    root.dataset.motion = s.reduceMotion ? 'reduce' : 'auto';
    root.dataset.contrast = s.highContrast ? 'high' : 'normal';
    root.dataset.stock = s.stockColor;
    root.dataset.theme = s.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : s.theme;
  };

  // 職業配色（js/data.js 的 light／dark／btn／btnText）寫進 CSS 變數 --job-*，首頁與遊戲頁共用
  UI.applyJobTheme = (job) => {
    const root = document.documentElement;
    root.dataset.job = job.id;
    root.style.setProperty('--job-light', job.light);
    root.style.setProperty('--job-dark', job.dark);
    root.style.setProperty('--job-btn', job.btn);
    root.style.setProperty('--job-btn-text', job.btnText);
  };

  // 「跟隨系統」時，系統切換深淺色要即時反映
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  darkQuery.addEventListener('change', () => { if (Store.getSettings().theme === 'system') UI.applySettings(); });

  UI.reducedMotion = () => document.documentElement.dataset.motion === 'reduce'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  UI.wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // 綁定頁面上靜態的 <dialog>：[data-open="id"] 開啟、[data-close] 關閉、點背景關閉
  UI.bindDialogs = (root = document) => {
    root.querySelectorAll('[data-open]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dlg = document.getElementById(btn.dataset.open);
        if (!dlg) return;
        dlg.dispatchEvent(new CustomEvent('beforeopen'));
        dlg.showModal();
      });
    });
    root.querySelectorAll('dialog.modal').forEach(bindBackdropClose);
    root.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => btn.closest('dialog').close());
    });
  };

  function bindBackdropClose(dlg) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg && dlg.dataset.dismissible !== 'false') dlg.close('cancel');
    });
  }

  /**
   * 動態彈出視窗，回傳 Promise，值為按下按鈕的 value（按 Esc / 背景為 'cancel'）
   * actions: [{ label, value, variant: 'primary' | 'ghost' | 'danger' }]
   */
  UI.modal = ({ title, body = '', actions = [{ label: '確定', value: 'ok', variant: 'primary' }], dismissible = true, className = '' }) => {
    return new Promise((resolve) => {
      const opener = document.activeElement;
      const id = 'dlg-' + Math.random().toString(36).slice(2, 8);
      const dlg = document.createElement('dialog');
      dlg.className = 'modal ' + className;
      dlg.setAttribute('aria-labelledby', id + '-title');
      dlg.setAttribute('aria-describedby', id + '-body');
      dlg.dataset.dismissible = String(dismissible);
      dlg.innerHTML = `
        <form method="dialog">
          <div class="modal-head">
            <h2 id="${id}-title">${UI.escape(title)}</h2>
            ${dismissible ? '<button class="icon-btn" value="cancel" aria-label="關閉">' + UI.icons.close + '</button>' : ''}
          </div>
          <div class="modal-body" id="${id}-body"></div>
          <div class="modal-actions">
            ${actions.map((a, i) => `<button class="btn btn-${a.variant || 'ghost'}" value="${UI.escape(a.value)}" ${i === actions.length - 1 ? 'autofocus' : ''}>${UI.escape(a.label)}</button>`).join('')}
          </div>
        </form>`;
      const bodyEl = dlg.querySelector('.modal-body');
      if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.append(body);
      // 不只依賴 close 事件（部分環境會延遲或不觸發），按鈕送出時就直接結束
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        if (dlg.open) dlg.close(value);
        resolve(value || 'cancel');
        dlg.remove();
        if (opener && document.contains(opener)) opener.focus();
      };
      dlg.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        finish(e.submitter ? e.submitter.value : 'cancel');
      });
      dlg.addEventListener('cancel', (e) => {
        e.preventDefault();
        if (dismissible) finish('cancel');
      });
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg && dismissible) finish('cancel');
      });
      dlg.addEventListener('close', () => finish(dlg.returnValue));
      document.body.append(dlg);
      dlg.showModal();
    });
  };

  UI.alert = ({ title, message = '', html, okText = '確定', dismissible = true }) =>
    UI.modal({ title, body: html || `<p>${UI.escape(message)}</p>`, actions: [{ label: okText, value: 'ok', variant: 'primary' }], dismissible });

  UI.confirm = async ({ title, message = '', html, okText = '確定', cancelText = '取消', danger = false }) => {
    const v = await UI.modal({
      title,
      body: html || `<p>${UI.escape(message)}</p>`,
      actions: [
        { label: cancelText, value: 'cancel', variant: 'ghost' },
        { label: okText, value: 'ok', variant: danger ? 'danger' : 'primary' },
      ],
    });
    return v === 'ok';
  };

  // 畫面短暫提示，同時朗讀給螢幕閱讀器
  UI.toast = (msg) => {
    let region = document.getElementById('toast-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'toast-region';
      region.className = 'toast-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.append(region);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    region.append(t);
    setTimeout(() => t.classList.add('hide'), 2600);
    setTimeout(() => t.remove(), 3000);
  };

  const svg = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  UI.icons = {
    close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    help: svg('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
    bulb: svg('<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    shuffle: svg('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>'),
    quit: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
    pause: svg('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'),
    chart: svg('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>'),
    news: svg('<path d="M4 4h13a2 2 0 0 1 2 2v12a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M8 8h7M8 12h7M8 16h4"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'),
    chevronUp: svg('<path d="m18 15-6-6-6 6"/>'),
    chevronRight: svg('<path d="m9 18 6-6-6-6"/>'),
    shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'),
    layers: svg('<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>'),
    trophy: svg('<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
    menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    home: svg('<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>'),
  };

  // 把 data-icon="名稱" 的元素填上圖示
  UI.fillIcons = (root = document) => {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      el.insertAdjacentHTML('afterbegin', UI.icons[el.dataset.icon] || '');
    });
  };

  // ===== 線條圖示：全站不顯示 emoji =====
  // 遊戲資料、事件牌、伺服器紀錄（排行榜的職業圖示）與 AI 回覆裡的 emoji 都在畫面上換成同風格的線條圖示；
  // 對照表沒有的 emoji 直接拿掉。程式裡的 emoji 只當作圖示代號。
  const dot = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="1.3" fill="currentColor" stroke="none"/>`;
  const die = (...pts) => '<rect x="3" y="3" width="18" height="18"/>' + pts.map(([x, y]) => dot(x, y)).join('');
  const LINE = {
    tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h.01"/>',
    folder: '<path d="M3 5h6l2 2h10v12H3z"/>',
    coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-4c0-1.6-2.3-2.9-5.4-3"/>',
    cash: '<rect x="2" y="6" width="20" height="12"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    cashOut: '<rect x="2" y="9" width="15" height="10"/><circle cx="9.5" cy="14" r="2"/><path d="M15 3h6v6M21 3l-6 6"/>',
    hospital: '<path d="M4 21V5h16v16M2 21h20"/><path d="M12 8v6M9 11h6"/><path d="M10 21v-3h4v3"/>',
    trendUp: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    trendDown: '<path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
    hourglass: '<path d="M6 2h12M6 22h12"/><path d="M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4"/>',
    dice: die([8, 8], [12, 12], [16, 16]),
    die1: die([12, 12]),
    die2: die([8, 8], [16, 16]),
    die3: die([8, 8], [12, 12], [16, 16]),
    die4: die([8, 8], [16, 8], [8, 16], [16, 16]),
    die5: die([8, 8], [16, 8], [12, 12], [8, 16], [16, 16]),
    die6: die([8, 7], [16, 7], [8, 12], [16, 12], [8, 17], [16, 17]),
    bed: '<path d="M2 19V5M2 15h20v4M22 15v-4a3 3 0 0 0-3-3h-8v7"/><circle cx="6.5" cy="11" r="2"/>',
    bank: '<path d="m3 9 9-5 9 5"/><path d="M4 9h16M6 9v9M10 9v9M14 9v9M18 9v9M3 21h18M3 18h18"/>',
    idCard: '<rect x="2" y="5" width="20" height="14"/><circle cx="8" cy="11" r="2"/><path d="M5 16a3 3 0 0 1 6 0M14 9h5M14 13h5"/>',
    cards: '<rect x="3" y="7" width="12" height="15"/><path d="M8 7V3h13v15h-6"/>',
    coffee: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10h2a2 2 0 0 1 0 4h-2"/><path d="M8 2v3M12 2v3M3 22h16"/>',
    stethoscope: '<path d="M5 3v6a5 5 0 0 0 10 0V3"/><path d="M10 14v2a5 5 0 0 0 10 0v-3"/><circle cx="20" cy="11" r="2"/>',
    medical: '<rect x="3" y="3" width="18" height="18"/><path d="M12 7v10M7 12h10"/>',
    feather: '<path d="M20 4C11 4 6 10 6 18"/><path d="M20 4c0 8-5 14-14 14"/><path d="m3 21 4-4M10 13h5"/>',
    heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>',
    flag: '<path d="M5 21V4h13l-3 4.5L18 13H5"/>',
    graduation: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    microscope: '<path d="M8 3h4v8H8zM10 11v3M5 21h14M7 17h6"/><path d="M14 8a6 6 0 0 1 1 11"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 6 4.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14a5 5 0 0 0 8 0M9 9.5h.01M15 9.5h.01"/>',
    frown: '<circle cx="12" cy="12" r="9"/><path d="M16 16a5 5 0 0 0-8 0M9 9.5h.01M15 9.5h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    receipt: '<path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5-2 1.5-2.5-1.5L5 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    barChart: '<path d="M3 21h18M6 17v-6M11 17V5M16 17V9M20 17v-4"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13"/><path d="M8 7V4h8v3M3 13h18"/>',
    hardhat: '<path d="M4 17v-2a8 8 0 0 1 16 0v2"/><path d="M10 7V4h4v3M2 17h20v3H2z"/>',
    virus: '<circle cx="12" cy="12" r="5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19"/>',
    thermometer: '<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    ambulance: '<path d="M2 17V7h12v10M14 10h4l4 4v3h-2M8 9v4M6 11h4M8.5 17h7"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>',
    clipboard: '<rect x="5" y="4" width="14" height="18"/><path d="M9 2h6v4H9zM9 11h6M9 15h6"/>',
    file: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h5"/>',
    wheelchair: '<circle cx="11" cy="4" r="2"/><path d="M11 7v6h5l3 6"/><path d="M8 10a6 6 0 1 0 8 7"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h12l2-8H6"/>',
    cloudRain: '<path d="M7 16a5 5 0 1 1 1.5-9.8A6 6 0 0 1 20 9a4 4 0 0 1-1 7.9"/><path d="M8 19v2M12 18v3M16 19v2"/>',
    laptop: '<rect x="4" y="4" width="16" height="11"/><path d="M2 19h20"/>',
    book: '<path d="M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2z"/><path d="M22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z"/>',
    chefHat: '<path d="M6 13a4 4 0 1 1 2-7.5 4 4 0 0 1 8 0A4 4 0 1 1 18 13v7H6z"/><path d="M6 17h12"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    sprout: '<path d="M12 21v-9"/><path d="M12 12C12 8 9 5 4 5c0 4 3 7 8 7zM12 14c0-3.5 2.5-6 7-6 0 3.5-2.5 6-7 6z"/>',
    scooter: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M9 17h6l3-8h-3M15 9h4M4 13h7"/>',
    ribbon: '<path d="M12 3a3 3 0 0 0-3 3c0 2 3 6 3 6s3-4 3-6a3 3 0 0 0-3-3z"/><path d="M12 12 7 21M12 12l5 9"/>',
    tree: '<path d="M12 22v-6"/><path d="M12 16a6 6 0 0 0 5-9.5A5 5 0 0 0 7 6.5 6 6 0 0 0 12 16z"/>',
    bandage: '<path d="m3.5 14.5 11-11 6 6-11 11z"/><path d="M10 12h.01M14 12h.01M12 10h.01M12 14h.01"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
    bot: '<rect x="4" y="8" width="16" height="12"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6"/><circle cx="12" cy="3" r="1"/>',
    flame: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-9-1 2-2 3-3 3 0-2-1-4-3-6 0 4-4 7-4 12a7 7 0 0 0 7 7z"/>',
    pill: '<path d="m10.5 20.5-7-7a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7z"/><path d="m7 10 7 7"/>',
    scale: '<path d="M12 3v18M7 21h10M4 7h16"/><path d="m4 7-3 7a3 3 0 0 0 6 0zM20 7l-3 7a3 3 0 0 0 6 0z"/>',
    brain: '<path d="M12 5a3 3 0 0 0-6 2 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1z"/><path d="M12 5a3 3 0 0 1 6 2 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
    footprints: '<path d="M5 15c-1-3-1-7 1.5-8S9 9 9 12s-1 4-1 5H5zM5 19h3"/><path d="M19 11c1-3 1-7-1.5-8S15 5 15 8s1 4 1 5h3zM16 16h3"/>',
    film: '<rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M8 4 6 9M14 4l-2 5M20 4l-2 5"/>',
    lock: '<rect x="4" y="11" width="16" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    medal: '<circle cx="12" cy="15" r="6"/><path d="M8.5 10 5 2h4l3 6 3-6h4l-3.5 8"/>',
    hand: '<path d="M7 11V5a1.5 1.5 0 0 1 3 0v5M10 10V3.5a1.5 1.5 0 0 1 3 0V10M13 10V5a1.5 1.5 0 0 1 3 0v6"/><path d="M16 11V8a1.5 1.5 0 0 1 3 0v6a8 8 0 0 1-8 8 7 7 0 0 1-6-3.5L3 14a1.5 1.5 0 0 1 2.5-1.5L7 14v-3"/>',
    message: '<path d="M4 4h16v12H9l-5 4z"/>',
    sparkles: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15v4M17 17h4M5 3v3M3.5 4.5h3"/>',
    cake: '<path d="M4 21v-8h16v8M2 21h20M12 13V9"/><path d="M4 16c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 4 0"/><path d="M12 6c-.8-1-.8-2 0-3 .8 1 .8 2 0 3z"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  };
  Object.entries(LINE).forEach(([name, d]) => { UI.icons[name] = svg(d); });

  // emoji → 圖示名稱（比對時忽略變體選擇字元 U+FE0F）
  const EMOJI_ICON = {
    '🛡': 'shield', '🏷': 'tag', '⚠': 'alert', '🗂': 'folder', '💰': 'coins', '💵': 'cash', '💸': 'cashOut',
    '🏥': 'hospital', '📈': 'trendUp', '📉': 'trendDown', '⌛': 'hourglass', '⏳': 'hourglass',
    '🎲': 'dice', '⚀': 'die1', '⚁': 'die2', '⚂': 'die3', '⚃': 'die4', '⚄': 'die5', '⚅': 'die6',
    '❓': 'help', '🛏': 'bed', '🏦': 'bank', '🪪': 'idCard', '🎴': 'cards', '☕': 'coffee', '🩺': 'stethoscope',
    '🕊': 'feather', '❤': 'heart', '💚': 'heart', '🫀': 'heart', '⏸': 'pause', '⭐': 'star', '🏁': 'flag',
    '🎓': 'graduation', '🧐': 'search', '🔬': 'microscope', '🤝': 'users', '😊': 'smile', '😞': 'frown',
    '⏰': 'clock', '❌': 'xCircle', '✅': 'check', '⭕': 'circle', '🧾': 'receipt', '📊': 'barChart',
    '📰': 'news', '💼': 'briefcase', '🧑‍💼': 'briefcase', '🦺': 'hardhat', '🧓': 'user', '🦠': 'virus',
    '😷': 'virus', '🤒': 'thermometer', '📅': 'calendar', '🚑': 'ambulance', '📋': 'clipboard', '📄': 'file',
    '📝': 'file', '💡': 'bulb', '🧑‍🦽': 'wheelchair', '🧭': 'compass', '🗺': 'map', '🛒': 'cart',
    '🌧': 'cloudRain', '👩‍💻': 'laptop', '👨‍🏫': 'book', '👩‍⚕': 'stethoscope', '🧑‍⚕': 'medical',
    '👨‍🍳': 'chefHat', '🧑‍🎨': 'palette', '🧑‍🌾': 'sprout', '🌱': 'sprout', '🛵': 'scooter', '🎗': 'ribbon',
    '🌳': 'tree', '🩹': 'bandage', '💥': 'zap', '🇪🇺': 'globe', '🤖': 'bot', '🔥': 'flame', '🕯': 'flame',
    '💊': 'pill', '⚖': 'scale', '🧠': 'brain', '👣': 'footprints', '🎬': 'film', '🔒': 'lock',
    '🥇': 'medal', '🥈': 'medal', '🥉': 'medal', '🏅': 'medal', '🏆': 'trophy', '👋': 'hand', '⚙': 'gear',
    '💬': 'message', '🎉': 'sparkles', '🎂': 'cake', '💪': 'activity',
  };
  // 骰子點數 ⚀–⚅ 不屬於 Extended_Pictographic，另外列出
  const EMOJI_RE = /\p{Regional_Indicator}{2}|[⚀-⚅]|\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*/gu;
  const KEEP = new Set(['©', '®', '™']); // 文字符號，不是圖示
  const iconOf = (emoji) => EMOJI_ICON[emoji.replace(/️/g, '')];

  // 單一圖示的 HTML：大小跟著文字（1em），顏色跟著文字顏色
  UI.icon = (name) => (UI.icons[name] || '').replace('<svg ', '<svg class="ico" ');

  // 字串裡的 emoji 拿掉（用在不能放 SVG 的地方：<title>、<option>、屬性）
  UI.stripEmoji = (str) => String(str).replace(EMOJI_RE, (m) => (KEEP.has(m) ? m : '')).replace(/\s{2,}/g, ' ');

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);
  function iconizeText(node) {
    const text = node.nodeValue;
    EMOJI_RE.lastIndex = 0;
    if (!EMOJI_RE.test(text)) return;
    const parent = node.parentNode;
    if (!parent || SKIP.has(parent.nodeName) || parent.closest?.('svg')) return;
    if (parent.nodeName === 'OPTION' || parent.nodeName === 'TITLE') { node.nodeValue = UI.stripEmoji(text); return; }
    const tpl = document.createElement('template');
    tpl.innerHTML = UI.escape(text).replace(EMOJI_RE, (m) => (KEEP.has(m) ? m : iconOf(m) ? UI.icon(iconOf(m)) : ''));
    parent.replaceChild(tpl.content, node);
  }
  function iconize(root) {
    if (root.nodeType === Node.TEXT_NODE) { iconizeText(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE || SKIP.has(root.nodeName)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(iconizeText);
  }
  UI.iconize = iconize;

  document.title = UI.stripEmoji(document.title);
  iconize(document.body);
  new MutationObserver((records) => {
    records.forEach((r) => {
      if (r.type === 'characterData') iconizeText(r.target);
      else r.addedNodes.forEach(iconize);
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  UI.applySettings();
  window.UI = UI;
})();
