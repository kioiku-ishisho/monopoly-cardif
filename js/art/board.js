/*
 * 3D 美術模組：潘洛斯階梯棋盤、棋子、跟隨鏡頭與對外 API
 *
 *   const art = RealLifeArt.create(canvas, {
 *     character: 'doctor',            // 角色＝主題（單人遊戲）
 *     mode: 'light',                  // 'light' | 'dark'
 *     board: { arms: [18, 18, 12, 12], step: 0.1 },
 *     tiles: [{ label: '起點', tone: 'C' }, ...], // 共 arms 總和筆；label：格子名稱（3 字以上分兩行）；tone：'C' 特殊色、'A'/'B' 一般色
 *     reduced: () => false,           // 是否減少動態
 *   });
 *   art.moveTo(12, { hopMs: 220 }) → Promise   逐格前進到第 12 格（繞圈自動處理）
 *   art.teleportTo(0) / art.getTokenIndex()
 *   art.setCharacter(key) / art.setMode(mode) / art.setZoom(z) / art.zoomAt(f, x, y) / art.panBy(dx, dy)
 *   art.setOverview(on) / art.setInsets({ top, bottom, left, right }) / art.tokenVisible()
 *   art.on('arrive' | 'lap' | 'themechange' | 'lost', fn)
 *   art.resize() / art.pause() / art.resume() / art.dispose() / art.info()
 *
 * 3D 只負責顯示，遊戲規則留在 js/game/。數學見 handoff docs/04-board-60.md。
 */
(function () {
  'use strict';
  const A = window.RealLifeArt;
  if (!A || !window.THREE) return;
  const T = THREE;
  const { INK, SQ2 } = A;
  const SQ3 = Math.sqrt(3), SQ6 = Math.sqrt(6);
  const ISO_EL = 35.26438968, ISO_AZ = 45;
  const FLOOR_Y = -3;
  const RV = new T.Vector3(1, 0, -1).normalize(), UV = new T.Vector3(-1, 2, -1).normalize(), VV = new T.Vector3(1, 1, 1).normalize();
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  // 等角投影：sx 往右、sy 往上（鏡頭在 +x,+y,+z 看向原點）
  const screen = (p) => [(p.x - p.z) / SQ2, (2 * p.y - p.x - p.z) / SQ6];

  // 潘洛斯環：四臂方向 +x, +z, −x, −z；閉環條件 n1−n3 = n2−n4 = N·s
  A.penrose = function (arms, step) {
    const pts = [], armStart = [];
    let x = 0, y = 0, z = 0;
    for (let a = 0; a < 4; a++) {
      armStart.push(pts.length);
      for (let k = 0; k < arms[a]; k++) { pts.push(new T.Vector3(x, y, z)); x += DIRS[a][0]; z += DIRS[a][1]; y += step; }
    }
    const end = new T.Vector3(x, y, z);
    const armOf = (i) => (i < armStart[1] ? 0 : i < armStart[2] ? 1 : i < armStart[3] ? 2 : 3);
    return { pts, end, m: end.y, armStart, armOf };
  };

  function bboxScreen(pts) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach((p) => { const s = screen(p); x0 = Math.min(x0, s[0]); x1 = Math.max(x1, s[0]); y0 = Math.min(y0, s[1]); y1 = Math.max(y1, s[1]); });
    return { c: [(x0 + x1) / 2, (y0 + y1) / 2], h: [(x1 - x0) / 2, (y1 - y0) / 2] };
  }

  A.create = function (canvas, options) {
    options = options || {};
    const listeners = {};
    const emit = (name, data) => (listeners[name] || []).forEach((f) => f(data));
    const reduced = options.reduced || (() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    let renderer;
    try {
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch (e) {
      return null;
    }
    renderer.setClearColor(0x000000, 0);

    const K = A.kit({ reduced });
    // 棋子用自己的快取：切換主題時地圖的快取整個釋放，不能連棋子的貼圖一起丟掉
    const KT = A.kit({ reduced });
    const chars = A.characters(KT);

    /* ---------- 棋盤幾何 ---------- */
    const boardOpt = Object.assign({ arms: [18, 18, 12, 12], step: 0.1 }, options.board);
    const pen = A.penrose(boardOpt.arms, boardOpt.step);
    const N = pen.pts.length;
    const M = new T.Vector3(pen.m, pen.m, pen.m);
    const tiles = (options.tiles || []).slice(0, N);

    // 原型 24 格環的版面 → 60 格環的版面（道具位置依環的大小等比例分佈）
    const box24 = bboxScreen(A.penrose([9, 9, 3, 3], 0.25).pts);
    const box60 = bboxScreen(pen.pts);
    const O24 = new T.Vector3(5.25, FLOOR_Y, 3.75), s24 = screen(O24);
    const ku = box60.h[0] / box24.h[0], kv = box60.h[1] / box24.h[1];
    const c = box60.c, sum = 2 * FLOOR_Y - c[1] * SQ6, dif = c[0] * SQ2;
    const O60 = new T.Vector3((sum + dif) / 2, FLOOR_Y, (sum - dif) / 2);
    // 環的範圍內照比例放大；超出環的部分維持原型的距離，道具才會貼著環的外圍
    const stretch = (n, h24, h60) => (Math.abs(n) <= 1 ? n * h60 : Math.sign(n) * (h60 + (Math.abs(n) - 1) * h24));
    const mapUW = (u, w) => {
      const nx = (s24[0] + u - box24.c[0]) / box24.h[0];
      const ny = (s24[1] - w / SQ3 - box24.c[1]) / box24.h[1];
      return [stretch(nx, box24.h[0], box60.h[0]), -SQ3 * stretch(ny, box24.h[1], box60.h[1])];
    };
    function placeRaw(parent, u, w, yaw) {
      const g = new T.Group();
      g.position.set(O60.x + (u + w) / SQ2, FLOOR_Y, O60.z + (w - u) / SQ2);
      g.rotation.y = Math.PI / 4 + (yaw || 0);
      parent.add(g);
      return g;
    }
    const place = (parent, u, w, yaw) => { const p = mapUW(u, w); return placeRaw(parent, p[0], p[1], yaw); };
    const placeWorld = (parent, x, z) => {
      const dx = x - O24.x, dz = z - O24.z;
      return place(parent, (dx - dz) / SQ2, (dx + dz) / SQ2);
    };
    const skyAt = (sx, sy, d) => new T.Vector3().addScaledVector(RV, sx).addScaledVector(UV, sy).addScaledVector(VV, d);

    /* ---------- 場景 ---------- */
    const scene = new T.Scene();
    scene.add(new T.AmbientLight(0xffffff, 0.6));
    const sun = new T.DirectionalLight(0xffffff, 0.52); sun.position.set(3, 6, 4); scene.add(sun);
    scene.add(new T.HemisphereLight(0xffffff, 0xc7d6e8, 0.18));
    const mapGroup = new T.Group(); scene.add(mapGroup);
    const skyGroup = new T.Group(); scene.add(skyGroup);
    const cam = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);

    let mapAnim = [];
    const S = { place, placeRaw, placeWorld, map: mapUW, skyAt, sky: skyGroup, FLOOR_Y, ku, anim: (f) => mapAnim.push(f) };
    const themes = A.themes(K, S);

    let character = A.PRO[options.character] ? options.character : 'doctor';
    let mode = options.mode === 'dark' ? 'dark' : 'light';
    let C = null;

    // 格子名稱：2 字一行，3 字以上分成兩行（前半較短），字級依最長一行縮到放得下
    function labelTex(text, color) {
      return K.canvasTex('g|' + text + color, 256, 256, (x) => {
        const chars = [...text];
        const lines = chars.length <= 2 ? [text] : [chars.slice(0, Math.floor(chars.length / 2)).join(''), chars.slice(Math.floor(chars.length / 2)).join('')];
        const longest = Math.max(...lines.map((l) => [...l].length));
        const size = Math.min(64, Math.floor(212 / longest));
        x.font = '900 ' + size + 'px "Noto Sans TC","PingFang TC","Microsoft JhengHei","Noto Sans CJK TC",sans-serif';
        x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle';
        const lh = size * 1.15, y0 = 132 - ((lines.length - 1) * lh) / 2;
        lines.forEach((l, i) => x.fillText(l, 128, y0 + i * lh));
      });
    }
    // 一般格（A／B 底色）上的字：從主題色裡挑對比最高的
    function glyphOn(bg) {
      return [C.C, C.glyph, INK, '#ffffff'].reduce((best, col) => (A.contrast(bg, col) > A.contrast(bg, best) + 0.6 ? col : best));
    }

    function clearMap() {
      [mapGroup, skyGroup].forEach((g) => g.children.slice().forEach((o) => { A.disposeTree(o); g.remove(o); }));
      mapAnim = [];
      K.flush();
    }

    function buildMap() {
      clearMap();
      const dark = mode === 'dark';
      C = themes.colors(character, dark);
      canvas.style.background = 'linear-gradient(180deg,' + C.sky[0] + ' 0%,' + C.sky[1] + ' 60%)';

      /* 地板：原型的範圍依比例放大，靠鏡頭那側再加長（鏡頭跟著角色走到環的前緣時仍有地板） */
      const a = mapUW(-11, -10.5), b = mapUW(11, 4.5);
      const u0 = a[0] - 6, u1 = b[0] + 6, w0 = a[1], w1 = b[1] + 18;
      const FW = u1 - u0, FD = w1 - w0;
      const fl = placeRaw(mapGroup, (u0 + u1) / 2, (w0 + w1) / 2);
      const slab = K.bx(fl, FW, 1.2, FD, C.ground2, 0, -0.6, 0, { ink: false }); K.addEdges(slab, INK, 0.5);
      const ftex = themes.floorTex(character, C, dark); ftex.repeat.set(FW / 8, FD / 8);
      const fp = new T.Mesh(new T.PlaneGeometry(FW, FD), new T.MeshLambertMaterial({ map: ftex }));
      fp.rotation.x = -Math.PI / 2; fp.position.set(0, 0.02, 0); fl.add(fp);

      /* 場景道具 */
      const envG = new T.Group(); mapGroup.add(envG);
      themes.env(character, envG, C, dark);
      if (dark) {
        const pg = new T.BufferGeometry(), r = A.rng(3), arr = [];
        for (let i = 0; i < 90; i++) { const p = skyAt((r() - 0.5) * 30, 2 + r() * 10, -60); arr.push(p.x, p.y, p.z); }
        pg.setAttribute('position', new T.Float32BufferAttribute(arr, 3));
        skyGroup.add(new T.Points(pg, new T.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.8 })));
      }

      /* 階梯本體：每格都是柱子，畫面上底面全部切齊地板。
         繞一圈會高 m，底面的落差一定要出現在某處：第 4 臂（轉角那格除外）整段浮高 m，
         沿視線看等於站在地板上，落差藏在左轉角、被第 3 臂的柱子擋住 */
      pen.pts.forEach((p, i) => {
        const t = tiles[i] || {};
        const tone = t.tone || (i % 2 ? 'B' : 'A');
        const col = C[tone] || C.A;
        const bottom = i > pen.armStart[3] ? FLOOR_Y + pen.m : FLOOR_Y;
        const m = new T.Mesh(new T.BoxGeometry(0.92, p.y - bottom, 0.92), K.lam(col));
        m.position.set(p.x, (p.y + bottom) / 2, p.z); mapGroup.add(m); K.addEdges(m, INK, 0.85);
        if (t.label) {
          const gc = tone === 'C' ? C.glyph : glyphOn(col);
          const gp = new T.Mesh(new T.PlaneGeometry(0.86, 0.86), new T.MeshBasicMaterial({ map: labelTex(t.label, gc), transparent: true, depthWrite: false }));
          gp.rotation.order = 'YXZ'; gp.rotation.set(-Math.PI / 2, Math.PI / 4, 0); gp.position.set(p.x, p.y + 0.012, p.z); mapGroup.add(gp);
        }
      });
      const st = pen.pts[0], flag = K.group(mapGroup, [st.x - 0.32, st.y, st.z - 0.32]);
      K.cy(flag, 0.025, 0.025, 1.0, INK, 0, 0.5, 0, { ink: false }); K.bx(flag, 0.4, 0.26, 0.02, C.C, 0.2, 0.86, 0, { t: 0.05 });
      emit('themechange', { key: character, mode, name: themes.THEMES[character].name, sky: C.sky });
    }

    /* ---------- 棋子 ---------- */
    let token = null, idx = 0, laps = 0, moving = null, goal = 0, hopMs = 220;
    let waiters = [];
    const focus = new T.Vector3();

    function buildToken() {
      if (token) { scene.remove(token); A.disposeTree(token); }
      KT.flush();
      token = chars.make(character);
      token.scale.setScalar(0.72);
      token.rotation.y = T.MathUtils.degToRad(ISO_AZ);
      scene.add(token);
      token.position.copy(pen.pts[idx]);
    }
    function settle() {
      const done = waiters.filter((w) => w.target === idx);
      waiters = waiters.filter((w) => w.target !== idx);
      done.forEach((w) => w.resolve(idx));
      emit('arrive', { index: idx, laps });
    }
    function step() {
      if (idx === goal) { moving = null; settle(); return; }
      const to = (idx + 1) % N;
      moving = { from: idx, to, wrap: to === 0, t: 0 };
    }
    function moveTo(target, opt) {
      target = ((target % N) + N) % N;
      if (opt && opt.hopMs) hopMs = opt.hopMs;
      return new Promise((resolve) => {
        waiters.push({ target, resolve });
        goal = target;
        if (!moving) step();
      });
    }
    function teleportTo(target) {
      idx = goal = ((target % N) + N) % N;
      moving = null;
      if (token) token.position.copy(pen.pts[idx]);
      focus.copy(pen.pts[idx]);
      if (!overview) camTarget.copy(focus);
      settle();
    }
    const lerpAngle = (a, b, t) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };

    /* ---------- 鏡頭：固定等角視角，只移動 target ---------- */
    const camTarget = new T.Vector3().copy(pen.pts[0]);
    const ringCenter = O60.clone();
    let zoom = 1, overview = false, insets = { top: 0, bottom: 0, left: 0, right: 0 };
    // 玩家拖曳的位移（螢幕平面上的世界單位：x 沿 RV 往右、y 沿 UV 往上），加在跟隨點上
    const pan = { x: 0, y: 0 }, PAN_MAX = 30;
    const look = new T.Vector3();
    let elev = ISO_EL, azim = ISO_AZ;
    let cssW = 1, cssH = 1;

    function fit() {
      cssW = canvas.clientWidth || 800; cssH = canvas.clientHeight || 600;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(cssW, cssH, false);
      const aspect = cssW / cssH;
      let halfW, halfH;
      if (overview) {
        // 整圈：環的螢幕外框加一點邊界
        const needW = box60.h[0] + 2.5, needH = box60.h[1] + 3;
        const usableH = Math.max(0.3, (cssH - insets.top - insets.bottom) / cssH);
        const usableW = Math.max(0.3, (cssW - insets.left - insets.right) / cssW);
        halfW = Math.max(needW / usableW, (needH / usableH) * aspect) / zoom;
        halfH = halfW / aspect;
      } else {
        halfW = (aspect >= 1 ? 16 : 10) / 2 / zoom;
        halfH = halfW / aspect;
      }
      // UI 疊在畫面上下左右時，把角色放在「可見區域」的中央
      const shiftY = ((insets.bottom - insets.top) / 2) * ((2 * halfH) / cssH);
      const shiftX = ((insets.right - insets.left) / 2) * ((2 * halfW) / cssW);
      cam.left = -halfW + shiftX; cam.right = halfW + shiftX; cam.top = halfH - shiftY; cam.bottom = -halfH - shiftY;
      cam.updateProjectionMatrix();
    }
    function placeCam() {
      const el = T.MathUtils.degToRad(elev), az = T.MathUtils.degToRad(azim), d = 80;
      look.copy(camTarget).addScaledVector(RV, pan.x).addScaledVector(UV, pan.y);
      cam.position.set(look.x + Math.sin(az) * Math.cos(el) * d, look.y + Math.sin(el) * d, look.z + Math.cos(az) * Math.cos(el) * d);
      cam.lookAt(look);
      skyGroup.position.copy(look);
    }
    const unitsPerPx = () => (cam.right - cam.left) / cssW;
    function panBy(dx, dy) {
      const k = unitsPerPx();
      pan.x = Math.max(-PAN_MAX, Math.min(PAN_MAX, pan.x - dx * k));
      pan.y = Math.max(-PAN_MAX, Math.min(PAN_MAX, pan.y + dy * k));
      placeCam();
    }
    // 以畫布上的 (x, y)（CSS px）為中心縮放：游標下的點不動
    function zoomAt(factor, x, y) {
      const next = Math.min(2.5, Math.max(0.4, zoom * factor));
      if (next === zoom) return;
      const k0 = unitsPerPx();
      const ox = (x - (-cam.left / (cam.right - cam.left)) * cssW) * k0;
      const oy = -(y - (cam.top / (cam.top - cam.bottom)) * cssH) * k0;
      const f = next / zoom;
      zoom = next; fit();
      pan.x = Math.max(-PAN_MAX, Math.min(PAN_MAX, pan.x + ox * (1 - 1 / f)));
      pan.y = Math.max(-PAN_MAX, Math.min(PAN_MAX, pan.y + oy * (1 - 1 / f)));
      placeCam();
    }
    // 棋子目前是否在畫面內（留 margin 比例的邊）
    function tokenVisible(margin) {
      if (!token) return true;
      const p = pen.pts[idx].clone().project(cam), m = 1 - (margin || 0.1);
      return Math.abs(p.x) <= m && Math.abs(p.y) <= m;
    }

    /* ---------- 主迴圈 ---------- */
    let time = 0, last = 0, raf = 0, running = false, disposed = false;
    function update(dt) {
      time += dt;
      mapAnim.forEach((f) => f(time));
      if (token) {
        chars.idle(token, time);
        if (moving) {
          moving.t += dt / (hopMs / 1000);
          const a = pen.pts[moving.from], b = moving.wrap ? pen.end : pen.pts[moving.to], k = Math.min(1, moving.t);
          token.position.copy(a).lerp(b, k);
          focus.copy(token.position);
          token.position.y += Math.sin(Math.PI * k) * 0.4;
          token.rotation.y = lerpAngle(token.rotation.y, Math.atan2(b.x - a.x, b.z - a.z), Math.min(1, dt * 14));
          if (moving.t >= 1) {
            idx = moving.to;
            token.position.copy(pen.pts[idx]);
            focus.copy(pen.pts[idx]);
            if (moving.wrap) {
              // 繞圈：棋子與鏡頭同時沿視線方向退回 (m,m,m)，螢幕上看不出來
              laps++;
              camTarget.sub(M);
              emit('lap', { laps });
            }
            step();
          }
        } else {
          token.rotation.y = lerpAngle(token.rotation.y, T.MathUtils.degToRad(azim), Math.min(1, dt * 6));
          focus.copy(pen.pts[idx]);
        }
      }
      const want = overview ? ringCenter : focus;
      camTarget.lerp(want, reduced() ? 1 : 1 - Math.exp(-dt * 6));
      placeCam();
    }
    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.max(0, Math.min((now - last) / 1000, 0.1)); last = now;
      update(dt);
      renderer.render(scene, cam);
    }
    function resume() {
      if (running || disposed || document.hidden) return;
      running = true; last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function pause() { running = false; cancelAnimationFrame(raf); }
    const onVisibility = () => (document.hidden ? pause() : resume());
    document.addEventListener('visibilitychange', onVisibility);
    const ro = window.ResizeObserver ? new ResizeObserver(() => fit()) : null;
    if (ro) ro.observe(canvas); else window.addEventListener('resize', fit);

    const onLost = (e) => { e.preventDefault(); pause(); emit('lost', {}); };
    canvas.addEventListener('webglcontextlost', onLost);

    /* ---------- 初始化 ---------- */
    buildToken();
    buildMap();
    teleportTo(0);
    fit(); placeCam();
    resume();
    // 格子上的中文字依賴 Noto Sans TC：字型載入完成後重建一次
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!disposed) buildMap(); });

    const api = {
      moveTo,
      teleportTo,
      getTokenIndex: () => idx,
      getLaps: () => laps,
      setCharacter(key) {
        if (!A.PRO[key] || key === character) return;
        character = key;
        buildToken(); buildMap();
      },
      setMode(m) {
        m = m === 'dark' ? 'dark' : 'light';
        if (m === mode) return;
        mode = m; buildMap();
      },
      setZoom(z) { zoom = Math.min(2.5, Math.max(0.4, z)); fit(); placeCam(); },
      getZoom: () => zoom,
      zoomAt,
      panBy,
      tokenVisible,
      // 回到跟著棋子（或整圈）：清掉拖曳位移與縮放
      setOverview(on) { overview = !!on; zoom = 1; pan.x = pan.y = 0; fit(); placeCam(); },
      isOverview: () => overview,
      setInsets(v) {
        const c = (n) => Math.max(0, n || 0);
        insets = { top: c(v.top), bottom: c(v.bottom), left: c(v.left), right: c(v.right) };
        fit(); placeCam();
      },
      // 除錯用：離開潘洛斯視角可以看到階梯其實是錯開的
      setAngles(e, a) { elev = e == null ? ISO_EL : e; azim = a == null ? ISO_AZ : a; placeCam(); },
      on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); return api; },
      resize: fit,
      pause,
      resume,
      render() { update(0); renderer.render(scene, cam); },
      info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, idx, laps, N, m: pen.m }),
      dispose() {
        if (disposed) return;
        disposed = true; pause();
        document.removeEventListener('visibilitychange', onVisibility);
        canvas.removeEventListener('webglcontextlost', onLost);
        if (ro) ro.disconnect(); else window.removeEventListener('resize', fit);
        clearMap();
        if (token) { scene.remove(token); A.disposeTree(token); token = null; }
        K.dispose();
        KT.dispose();
        renderer.dispose();
        waiters.forEach((w) => w.resolve(idx)); waiters = [];
      },
    };
    return api;
  };
})();
