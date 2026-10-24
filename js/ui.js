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
    shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'),
    layers: svg('<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>'),
    trophy: svg('<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
    home: svg('<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>'),
  };

  // 把 data-icon="名稱" 的元素填上圖示
  UI.fillIcons = (root = document) => {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      el.insertAdjacentHTML('afterbegin', UI.icons[el.dataset.icon] || '');
    });
  };

  UI.applySettings();
  window.UI = UI;
})();
