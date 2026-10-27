/*
 * 遊戲主頁：地圖、棋子、拖曳與縮放
 * 有 WebGL 時用 3D 潘洛斯階梯（js/art/，鏡頭固定、跟著棋子走）；
 * 不支援或 WebGL 中斷時退回原本的 SVG 地圖（js/world.js）。
 * 兩種模式都保留 <ol class="tiles"> 給螢幕閱讀器。
 */
(function (G) {
  if (!G) return;
  const { D, E, $, job, state, clamp, stage } = G;

  // ===== 地圖：三個人生階段共用一圈 =====
  const WORLD = GameWorld.build(E.tilesPerLap);
  const loopsEl = $('#loops');
  const roadsEl = $('#roads');
  const token = $('#token');

  const TILES = D.board.map((type, i) => ({ index: i, type, ...D.tileTypes[type] }));
  const currentTile = () => TILES[state.position];

  // ===== 3D 地圖 =====
  // 格子上的字（一個全形字）與底色：C 為主題特殊色，A／B 為一般色
  const GLYPH = {
    start: '起', chance: '機', fate: '命', insurance: '保', hospital: '醫', rest: '休',
    checkup: '檢', seminar: '講', myth: '觀', mentor: '貴', promo: '惠', attic: '整', missed: '錯',
  };
  const toneOf = (type, i) => (type === 'chance' ? 'A' : type === 'fate' ? 'B' : type === 'rest' ? (i % 2 ? 'B' : 'A') : 'C');
  const pageTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const hopMs = () => (UI.reducedMotion() ? 60 : 220);

  const vp = $('#board-viewport');
  const canvas3d = $('#board-3d');
  let art = null;
  if (canvas3d && window.RealLifeArt && RealLifeArt.create) {
    art = RealLifeArt.create(canvas3d, {
      character: job.id,
      mode: pageTheme(),
      tiles: TILES.map((t, i) => ({ glyph: GLYPH[t.type] || '', tone: toneOf(t.type, i) })),
      reduced: () => UI.reducedMotion(),
    });
  }
  if (art) {
    vp.classList.add('is-3d');
    $('#map-help').textContent = '地圖以固定視角跟著棋子移動，可拖曳移動、滾輪或雙指縮放。鍵盤操作：方向鍵移動，加號與減號縮放，0 跟著棋子，9 顯示整圈。';
    // 網站的淺色／深色設定改變時，地圖主題跟著切換
    new MutationObserver(() => art && art.setMode(pageTheme()))
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // WebGL 中斷：改用 SVG 地圖
    art.on('lost', () => {
      art.dispose();
      art = null;
      vp.classList.remove('is-3d');
      $('#map-help').textContent = '可拖曳移動地圖、滾輪或雙指縮放。鍵盤操作：方向鍵移動，加號與減號縮放，0 或 9 顯示整圈。';
      placeToken(false);
      fitBoard(false);
    });
    window.addEventListener('pagehide', () => art && art.dispose());
  }

  // 地圖鋪滿整個畫面，狀態列、骰子與電腦版右側欄疊在上面：告訴 3D 舞台被遮住多少，棋子才會在可見區域中央
  function updateInsets() {
    if (!art) return;
    const r = vp.getBoundingClientRect();
    const sub = $('.game-sub').getBoundingClientRect();
    const dice = $('.dice-area').getBoundingClientRect();
    const side = $('#side-panel').getBoundingClientRect();
    art.setInsets({
      top: sub.bottom > r.top && sub.top < r.bottom ? sub.bottom - r.top : 0,
      bottom: dice.top < r.bottom && dice.bottom > r.top ? r.bottom - dice.top : 0,
      right: side.width && side.left < r.right ? r.right - side.left : 0,
    });
  }

  // 只建立一次：道路（SVG）與格子
  function buildWorld() {
    const boardEl = $('#board');
    boardEl.style.width = WORLD.width + 'px';
    boardEl.style.height = WORLD.height + 'px';
    roadsEl.setAttribute('viewBox', `0 0 ${WORLD.width} ${WORLD.height}`);
    roadsEl.setAttribute('width', WORLD.width);
    roadsEl.setAttribute('height', WORLD.height);
    roadsEl.innerHTML = `
      <g class="road">
        <path class="road-edge" d="${WORLD.path}"/>
        <path class="road-bed" d="${WORLD.path}"/>
        <path class="road-line" d="${WORLD.path}"/>
      </g>`;

    const counts = D.boardCounts;
    const legend = [['chance', counts.chance], ['fate', counts.fate], ['insurance', counts.insurance], ['hospital', counts.hospital]]
      .map(([t, n]) => `<span>${D.tileTypes[t].icon} ${n}</span>`).join('') + `<span>⭐ ${counts.special}</span>`;
    loopsEl.innerHTML = `
      <section class="loop" aria-label="人生圈">
        <div class="loop-label" style="left:${WORLD.center.x}px;top:${WORLD.center.y}px" aria-hidden="true">
          <div class="loop-name" id="loop-name"></div>
          <div class="loop-ages" id="loop-ages"></div>
          <div class="loop-status" id="loop-status"></div>
          <div class="loop-legend">${legend}</div>
        </div>
        <ol class="tiles" aria-label="人生圈的格子">
          ${TILES.map((t) => {
            const p = WORLD.points[t.index];
            const rot = ((t.index * 37) % 13) - 6; // 固定的小角度傾斜（-6°～6°）
            return `<li class="tile${t.index === 0 ? ' start' : ''}" data-type="${t.type}"${t.group ? ` data-group="${t.group}"` : ''} data-index="${t.index}"
                      style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px;--rot:${rot}deg">
              <span class="tile-no" aria-hidden="true">${t.index + 1}</span>
              <span class="tile-icon" aria-hidden="true">${t.icon}</span>
              <span class="tile-name">${UI.escape(t.name)}</span>
            </li>`;
          }).join('')}
        </ol>
      </section>`;
    token.textContent = job.icon;
    token.style.setProperty('--job-color', job.color);
  }

  // 圈的顏色與中央標籤跟著目前的人生階段
  // 換人生階段時也會呼叫；3D 棋子此時可能正要跳過起點，只在第一次建立時直接放好
  function buildBoard() {
    const first = !loopsEl.children.length;
    if (first) buildWorld();
    document.body.dataset.stage = stage().id;
    const s = stage();
    $('#loop-name').textContent = s.name;
    $('#loop-ages').textContent = `${s.ageFrom}${s.ageTo ? `–${s.ageTo} 歲` : ' 歲以上'}`;
    if (first || !art) placeToken(false);
    G.renderStatus();
  }

  function tokenCenter() {
    return WORLD.points[state.position];
  }

  function placeToken(hop) {
    if (art) {
      if (hop) art.moveTo(state.position, { hopMs: hopMs() });
      else art.teleportTo(state.position);
    }
    const { x, y } = tokenCenter();
    token.style.left = x + 'px';
    token.style.top = y + 'px';
    loopsEl.querySelectorAll('.tile.current').forEach((t) => {
      t.classList.remove('current');
      t.removeAttribute('aria-current');
    });
    const cur = loopsEl.querySelector(`[data-index="${state.position}"]`);
    if (cur) {
      cur.classList.add('current');
      cur.setAttribute('aria-current', 'location');
    }
    if (hop && !UI.reducedMotion()) {
      token.classList.remove('hop');
      void token.offsetWidth;
      token.classList.add('hop');
    }
  }

  // ===== 地圖拖曳 / 縮放 =====
  const board = $('#board');
  const MIN_S = 0.05;
  const MAX_S = 2;
  const READABLE_S = 0.6; // 小螢幕整圈放不下時，改用此倍率並跟著棋子
  const DICE_SPACE = 150; // 底部預留給骰子
  const view = { x: 0, y: 0, s: 1 };
  let userMoved = false;

  function applyView(animate) {
    board.classList.toggle('animate', !!animate && !UI.reducedMotion());
    board.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
  }

  // 把地圖上的矩形區域放進畫面；readable 為 true 時，縮太小就改成跟著棋子
  function fitRect(rect, animate, readable) {
    // 3D：readable（跟著棋子）或整圈
    if (art) { updateInsets(); art.setOverview(!readable); return; }
    const r = vp.getBoundingClientRect();
    const usableH = Math.max(200, r.height - DICE_SPACE);
    const s = clamp(Math.min(r.width / rect.w, usableH / rect.h) * 0.94, MIN_S, MAX_S);
    if (readable && s < READABLE_S * 0.8) {
      view.s = READABLE_S;
      centerOnToken(animate);
      return;
    }
    view.s = s;
    view.x = (r.width - rect.w * s) / 2 - rect.x * s;
    view.y = (usableH - rect.h * s) / 2 - rect.y * s;
    applyView(animate);
  }

  const fitBoard = (animate) => fitRect(WORLD.bbox, animate, true);
  const fitWorld = (animate) => fitRect(WORLD.bbox, animate, false);
  // 版面大小改變時（視窗縮放、側欄出現），玩家沒手動移動過地圖才重新置中
  const refit = () => { if (art) updateInsets(); else if (!userMoved) fitBoard(false); };

  function zoomAt(factor, cx, cy) {
    if (art) { art.zoomAt(factor, cx, cy); userMoved = true; return; }
    const ns = clamp(view.s * factor, MIN_S, MAX_S);
    const k = ns / view.s;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.s = ns;
    userMoved = true;
    applyView(false);
  }

  function zoomCenter(factor) {
    const r = vp.getBoundingClientRect();
    zoomAt(factor, r.width / 2, r.height / 2);
  }

  function centerOnToken(animate) {
    if (art) { art.setOverview(false); return; }
    const r = vp.getBoundingClientRect();
    const { x, y } = tokenCenter();
    view.x = r.width / 2 - x * view.s;
    view.y = (r.height - DICE_SPACE) / 2 - y * view.s;
    applyView(animate);
  }

  function ensureTokenVisible() {
    // 3D 鏡頭會跟著棋子；玩家拖走或放大到看不見棋子時才回到棋子身上
    if (art) { if (!art.tokenVisible()) art.setOverview(false); return; }
    const r = vp.getBoundingClientRect();
    const { x, y } = tokenCenter();
    const sx = view.x + x * view.s;
    const sy = view.y + y * view.s;
    const pad = 40;
    if (sx < pad || sx > r.width - pad || sy < pad || sy > r.height - DICE_SPACE) centerOnToken(true);
  }

  const pointers = new Map();
  let pinch = null;

  vp.addEventListener('pointerdown', (e) => {
    vp.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    vp.classList.add('dragging');
    if (pointers.size === 2) pinch = pinchInfo();
  });

  vp.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      if (art) { art.panBy(cur.x - prev.x, cur.y - prev.y); userMoved = true; pointers.set(e.pointerId, cur); return; }
      view.x += cur.x - prev.x;
      view.y += cur.y - prev.y;
      userMoved = true;
      pointers.set(e.pointerId, cur);
      applyView(false);
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, cur);
      const next = pinchInfo();
      const r = vp.getBoundingClientRect();
      if (art) art.panBy(next.mx - pinch.mx, next.my - pinch.my);
      view.x += next.mx - pinch.mx;
      view.y += next.my - pinch.my;
      zoomAt(next.dist / pinch.dist, next.mx - r.left, next.my - r.top);
      pinch = next;
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) vp.classList.remove('dragging');
  }
  vp.addEventListener('pointerup', endPointer);
  vp.addEventListener('pointercancel', endPointer);

  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  vp.addEventListener('keydown', (e) => {
    const step = 48;
    const keys = {
      ArrowLeft: () => { view.x += step; },
      ArrowRight: () => { view.x -= step; },
      ArrowUp: () => { view.y += step; },
      ArrowDown: () => { view.y -= step; },
    };
    if (keys[e.key] && art) {
      const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      art.panBy(d[0], d[1]); userMoved = true; e.preventDefault();
    } else if (keys[e.key]) { keys[e.key](); userMoved = true; applyView(false); e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') { zoomCenter(1.2); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { zoomCenter(1 / 1.2); e.preventDefault(); }
    else if (e.key === '0') { userMoved = false; fitBoard(true); e.preventDefault(); }
    else if (e.key === '9') { userMoved = true; fitWorld(true); e.preventDefault(); }
  });

  $('#btn-zoom-in').addEventListener('click', () => zoomCenter(1.25));
  $('#btn-zoom-out').addEventListener('click', () => zoomCenter(1 / 1.25));
  $('#btn-zoom-me').addEventListener('click', () => { userMoved = true; centerOnToken(true); });
  $('#btn-zoom-all').addEventListener('click', () => { userMoved = true; fitWorld(true); });
  window.addEventListener('resize', refit);

  Object.assign(G, { currentTile, buildBoard, placeToken, fitBoard, refit, ensureTokenVisible });
})(window.Game);
