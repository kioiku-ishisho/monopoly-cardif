/*
 * 3D 美術模組：10 套主題地圖（淺色／深色）
 * A.themes(K, S) → { THEMES, colors(key, dark), floorTex(key, C), env(key, g, C, dark) }
 * K：建模工具（core.js 的 kit）
 * S：棋盤提供的場景座標（board.js）
 *   place(parent, u, w, yaw)  以原型 24 格的版面座標擺放，自動放大到 60 格環的大小
 *   placeRaw(parent, u, w, yaw) 不放大，直接用 60 格環的版面座標
 *   map(u, w) → [u, w]       原型版面座標 → 60 格環的版面座標
 *   placeWorld(parent, x, z) 原型的世界座標（例如膠囊）→ 版面座標
 *   sky, skyAt(sx, sy, d)    跟著鏡頭的天空群組（太陽、雲、星星）
 *   anim(fn)                 每幀呼叫的動畫
 *   ku                       水平放大倍率
 * 配色與道具取自原型（handoff docs/03-themes.md），道具位置改為依 60 格環重新分佈。
 */
(function () {
  'use strict';
  const A = window.RealLifeArt;
  if (!A || !window.THREE) return;
  const T = THREE;
  const { INK, WOOD, mixHex, tint, shade, rng } = A;

  // 配色函式：P 為使用者配色檔的 5 個顏色（A.PRO[key].pal）
  const THEMES = {
    doctor: { name: '醫院', floor: 'checker',
      colors: (P, d) => d
        ? { sky: [P[1], P[4]], ground: shade(P[2], 0.55), ground2: shade(P[2], 0.4), A: P[2], B: P[3], C: P[0], glyph: P[1], wall: shade(P[3], 0.45), glow: P[0], p1: P[0], p2: P[2], p3: P[3] }
        : { sky: [tint(P[0], 0.75), tint(P[0], 0.2)], ground: tint(P[0], 0.35), ground2: tint(P[0], 0.7), A: P[0], B: mixHex(P[0], P[3], 0.4), C: P[2], glyph: tint(P[0], 0.9), wall: tint(P[0], 0.8), glow: P[0], p1: P[2], p2: P[3], p3: P[1] } },
    engineer: { name: '電路板機房', floor: 'circuit',
      colors: (P, d) => d
        ? { sky: [shade(P[0], 0.55), P[0]], ground: shade(P[2], 0.62), ground2: shade(P[2], 0.4), A: P[1], B: P[2], C: P[4], glyph: P[0], wall: shade(P[0], 0.3), glow: P[4], p1: P[1], p2: P[2], p3: P[3] }
        : { sky: [tint(P[4], 0.6), tint(P[3], 0.45)], ground: mixHex(P[2], '#ffffff', 0.25), ground2: P[3], A: P[2], B: P[3], C: P[0], glyph: P[4], wall: tint(P[1], 0.5), glow: P[0], p1: P[1], p2: P[0], p3: P[2] } },
    nurse: { name: '護理站病房', floor: 'checker',
      colors: (P, d) => d
        ? { sky: [P[4], P[3]], ground: shade(P[2], 0.5), ground2: shade(P[2], 0.35), A: P[2], B: P[1], C: P[0], glyph: P[4], wall: P[3], glow: tint(P[1], 0.3), p1: P[1], p2: P[0], p3: P[2] }
        : { sky: [tint(P[0], 0.7), P[0]], ground: tint(P[0], 0.35), ground2: tint(P[1], 0.5), A: P[1], B: P[0], C: P[2], glyph: tint(P[0], 0.85), wall: tint(P[0], 0.7), glow: P[1], p1: P[2], p2: P[3], p3: P[1] } },
    teacher: { name: '教室', floor: 'planks',
      colors: (P, d) => d
        ? { sky: [shade(P[3], 0.65), shade(P[3], 0.35)], ground: shade(P[1], 0.55), ground2: shade(P[1], 0.4), A: P[2], B: P[0], C: P[4], glyph: shade(P[4], 0.7), wall: shade(P[3], 0.3), glow: P[0], p1: P[3], p2: P[4], p3: P[2] }
        : { sky: [tint(P[0], 0.75), tint(P[0], 0.35)], ground: tint(P[1], 0.35), ground2: P[1], A: P[0], B: P[1], C: P[4], glyph: tint(P[4], 0.9), wall: tint(P[0], 0.6), glow: P[0], p1: P[3], p2: P[4], p3: P[2] } },
    civil: { name: '市政廣場', floor: 'stone',
      colors: (P, d) => d
        ? { sky: [P[0], shade(P[1], 0.45)], ground: shade(P[3], 0.6), ground2: shade(P[3], 0.45), A: P[2], B: P[1], C: P[3], glyph: P[0], wall: shade(P[1], 0.3), glow: P[3], p1: P[3], p2: P[2], p3: P[4] }
        : { sky: ['#f6f6f6', P[4]], ground: tint(P[3], 0.4), ground2: P[3], A: P[4], B: P[3], C: P[2], glyph: tint(P[4], 0.9), wall: P[4], glow: P[3], p1: P[1], p2: P[2], p3: P[0] } },
    sales: { name: '商業大樓區', floor: 'city',
      colors: (P, d) => d
        ? { sky: [P[0], P[1]], ground: shade(P[1], 0.45), ground2: P[1], A: P[3], B: mixHex(P[1], P[3], 0.35), C: P[2], glyph: P[0], wall: P[1], glow: P[2], p1: P[2], p2: P[1], p3: P[4] }
        : { sky: [P[4], P[3]], ground: P[3], ground2: shade(P[3], 0.14), A: P[1], B: P[3], C: P[2], glyph: P[0], wall: P[4], glow: P[2], p1: P[2], p2: P[1], p3: P[0] } },
    designer: { name: '設計工作室', floor: 'paper',
      colors: (P, d) => d
        ? { sky: [shade(P[1], 0.7), shade(P[1], 0.45)], ground: shade(P[1], 0.6), ground2: shade(P[1], 0.45), A: P[4], B: P[2], C: P[0], glyph: P[3], wall: shade(P[1], 0.3), glow: P[2], p1: P[0], p2: P[2], p3: P[4] }
        : { sky: [P[3], tint(P[4], 0.6)], ground: tint(P[2], 0.78), ground2: tint(P[1], 0.45), A: P[4], B: P[2], C: P[0], glyph: P[3], wall: P[3], glow: P[2], p1: P[0], p2: P[2], p3: P[4] } },
    chef: { name: '餐廳廚房', floor: 'diag',
      colors: (P, d) => d
        ? { sky: [shade(P[4], 0.7), shade(P[4], 0.45)], ground: shade(P[0], 0.55), ground2: shade(P[1], 0.4), A: P[4], B: P[3], C: P[0], glyph: P[1], wall: shade(P[4], 0.35), glow: P[4], p1: P[0], p2: P[2], p3: P[4] }
        : { sky: [tint(P[3], 0.7), P[3]], ground: P[1], ground2: mixHex(P[0], '#ffffff', 0.5), A: P[3], B: P[1], C: P[0], glyph: P[1], wall: P[1], glow: P[4], p1: P[0], p2: P[2], p3: P[4] } },
    courier: { name: '城市街道', floor: 'road',
      colors: (P, d) => d
        ? { sky: [P[0], P[1]], ground: shade(P[1], 0.45), ground2: mixHex(P[1], P[4], 0.35), A: P[2], B: P[3], C: P[4], glyph: P[0], wall: shade(P[1], 0.4), glow: tint(P[3], 0.35), p1: P[3], p2: P[2], p3: P[4] }
        : { sky: [P[4], tint(P[3], 0.6)], ground: mixHex(P[1], P[4], 0.7), ground2: P[4], A: P[2], B: P[3], C: P[1], glyph: P[4], wall: tint(P[1], 0.7), glow: P[3], p1: P[3], p2: P[2], p3: P[1] } },
    farmer: { name: '麥田', floor: 'field',
      colors: (P, d) => d
        ? { sky: [shade(P[1], 0.8), shade(P[1], 0.45)], ground: shade(P[2], 0.6), ground2: shade(P[0], 0.55), A: P[2], B: P[3], C: P[0], glyph: shade(P[2], 0.5), wall: shade(P[4], 0.5), glow: P[0], p1: shade(P[0], 0.25), p2: P[2], p3: P[1] }
        : { sky: [P[1], tint(P[1], 0.72)], ground: P[3], ground2: P[0], A: P[4], B: P[3], C: P[0], glyph: P[2], wall: P[4], glow: P[0], p1: P[0], p2: P[2], p3: P[1] } },
  };

  /* ---------- 地板貼圖：一塊 8×8 單位、可重複的圖樣（32 px = 1 單位） ---------- */
  const TU = 8, PPU = 32, TP = TU * PPU;
  const FLOORS = {
    checker(x, C) { for (let i = 0; i < TU; i++) for (let j = 0; j < TU; j++) { x.fillStyle = (i + j) % 2 ? C.ground : C.ground2; x.fillRect(i * PPU, j * PPU, PPU, PPU); } },
    diag(x, C) { FLOORS.checker(x, C); },
    planks(x, C) {
      for (let j = 0; j < TU * 2; j++) {
        x.fillStyle = j % 2 ? C.ground : mixHex(C.ground, C.ground2, 0.35); x.fillRect(0, j * 16, TP, 16);
        x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(0, j * 16, TP, 1);
        const r = rng(j + 3); for (let k = 0; k < 3; k++) x.fillRect(r() * TP, j * 16, 1, 16);
      }
    },
    stone(x, C) {
      x.fillStyle = C.ground; x.fillRect(0, 0, TP, TP);
      for (let i = 0; i < TU / 2; i++) for (let j = 0; j < TU / 2; j++) { x.fillStyle = (i + j) % 2 ? C.ground : C.ground2; x.fillRect(i * 64 + 2, j * 64 + 2, 60, 60); }
    },
    circuit(x, C) {
      x.fillStyle = C.ground; x.fillRect(0, 0, TP, TP);
      const r = rng(11); x.strokeStyle = C.ground2; x.lineWidth = 4; x.fillStyle = C.ground2;
      for (let k = 0; k < 9; k++) {
        let px = (1 + Math.floor(r() * 6)) * 32, py = (1 + Math.floor(r() * 6)) * 32;
        x.beginPath(); x.moveTo(px, py);
        for (let s = 0; s < 3; s++) {
          if (r() < 0.5) px = Math.min(TP - 16, Math.max(16, px + (r() < 0.5 ? -1 : 1) * 32 * (1 + Math.floor(r() * 2))));
          else py = Math.min(TP - 16, Math.max(16, py + (r() < 0.5 ? -1 : 1) * 32 * (1 + Math.floor(r() * 2))));
          x.lineTo(px, py);
        }
        x.stroke(); x.beginPath(); x.arc(px, py, 7, 0, 7); x.fill();
      }
    },
    road(x, C) {
      x.fillStyle = C.ground; x.fillRect(0, 0, TP, TP); x.fillStyle = C.ground2;
      for (let i = 0; i < TU / 2; i++) x.fillRect(i * 64 + 8, 3 * PPU, 36, 6);
      for (let k = 0; k < 5; k++) x.fillRect(5 * PPU + k * 22, 4.5 * PPU, 12, 96);
      x.globalAlpha = 0.5; x.fillRect(0, 0, TP, 4); x.globalAlpha = 1;
    },
    city(x, C) {
      x.fillStyle = C.ground; x.fillRect(0, 0, TP, TP); x.fillStyle = C.ground2;
      [0, 4].forEach((i) => { x.fillRect(i * PPU - 3, 0, 6, TP); x.fillRect(0, i * PPU - 3, TP, 6); });
      x.fillRect(TP - 3, 0, 3, TP); x.fillRect(0, TP - 3, TP, 3);
    },
    paper(x, C) {
      x.fillStyle = C.ground; x.fillRect(0, 0, TP, TP); x.strokeStyle = C.ground2; x.globalAlpha = 0.35; x.lineWidth = 1;
      for (let i = 0; i <= TU * 2; i++) { x.beginPath(); x.moveTo(i * 16 + 0.5, 0); x.lineTo(i * 16 + 0.5, TP); x.stroke(); x.beginPath(); x.moveTo(0, i * 16 + 0.5); x.lineTo(TP, i * 16 + 0.5); x.stroke(); }
      x.globalAlpha = 1; const r = rng(5);
      [C.p1, C.p2, C.p3].forEach((col) => { x.fillStyle = col; for (let k = 0; k < 3; k++) { x.beginPath(); x.arc(12 + r() * (TP - 24), 12 + r() * (TP - 24), 4 + r() * 5, 0, 7); x.fill(); } });
    },
    field(x, C) {
      x.fillStyle = C.ground; x.fillRect(0, 0, TP, TP);
      x.fillStyle = C.ground2; x.fillRect(0, 1 * PPU, TP, 4.5 * PPU);
      x.fillStyle = 'rgba(0,0,0,.12)'; for (let u = 0; u < TU; u += 0.5) x.fillRect(u * PPU, 1 * PPU, 2, 4.5 * PPU);
    },
  };

  A.THEME_NAMES = Object.fromEntries(Object.keys(THEMES).map((k) => [k, THEMES[k].name]));

  A.themes = function (K, S) {
    const { part, group, limb, bx, cy, sp, cn, lam, addEdges, canvasTex } = K;
    const { place, placeRaw, placeWorld, skyAt, FLOOR_Y } = S;
    const reduce = K.reduced;
    const mapAnim = { push: (f) => S.anim(f) };

    function colors(key, dark) { return THEMES[key].colors(A.PRO[key].pal, dark); }
    function floorTex(key, C, dark) {
      return canvasTex('floor|' + key + '|' + (dark ? 'd' : 'l'), TP, TP, (x) => FLOORS[THEMES[key].floor](x, C), true);
    }

    /* ---------- 共用小組件 ---------- */
    function winTex(w, h, wall, lit, unlit, prob, seed) {
      const cols = Math.max(2, Math.round(w * 2)), rows = Math.max(2, Math.round(h * 2)), cw = 24, r = rng(seed), on = [];
      for (let i = 0; i < cols * rows; i++) on.push(r() < prob);
      const key = ['win', cols, rows, wall, lit, unlit, seed].join('|');
      const map = canvasTex(key, cols * cw, rows * cw, (x) => { x.fillStyle = wall; x.fillRect(0, 0, cols * cw, rows * cw); for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { x.fillStyle = on[j * cols + i] ? lit : unlit; x.fillRect(i * cw + 5, j * cw + 5, cw - 10, cw - 8); } });
      const em = canvasTex(key + '|em', cols * cw, rows * cw, (x) => { x.fillStyle = '#000'; x.fillRect(0, 0, cols * cw, rows * cw); for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (on[j * cols + i]) { x.fillStyle = lit; x.fillRect(i * cw + 5, j * cw + 5, cw - 10, cw - 8); } });
      return { map, em };
    }
    function building(parent, w, h, d, C, dark, seed, prob, roof) {
      const unlit = dark ? shade(C.wall, 0.45) : mixHex(C.wall, C.p3, 0.3), t = winTex(w, h, C.wall, C.glow, unlit, prob, seed);
      const side = new T.MeshLambertMaterial({ map: t.map, emissive: dark ? 0xffffff : 0x000000, emissiveMap: t.em });
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), [side, side, lam(roof || C.wall), lam(roof || C.wall), side, side]);
      m.position.y = h / 2; parent.add(m); addEdges(m, INK, 0.6); return m;
    }
    // 原型以世界座標 (x, y, z) 擺放的膠囊：轉成版面座標，旋轉角扣掉 place 的 45°
    function capsule(g, len, r, c1, c2, x, y, z, rotY) {
      const k = group(placeWorld(g, x, z), [0, y - FLOOR_Y, 0], [0, (rotY || 0) - Math.PI / 4, 0]);
      cy(k, r, r, len / 2, c1, -len / 4, 0, 0, { r: [0, 0, Math.PI / 2], t: 0.04 }); cy(k, r, r, len / 2, c2, len / 4, 0, 0, { r: [0, 0, Math.PI / 2], t: 0.04 });
      sp(k, r, c1, -len / 2, 0, 0, { t: 0.04 }); sp(k, r, c2, len / 2, 0, 0, { t: 0.04 }); return k;
    }
    function cloud(g, x, y, z, s, col) { const k = group(g, [x, y, z]); [[0, 0, 1], [1.1, -0.2, 0.8], [-1.1, -0.2, 0.75], [0.5, 0.5, 0.7]].forEach((a) => sp(k, a[2] * s, col, a[0] * s, a[1] * s, 0, { ink: false })); return k; }
    function desk(g, u, w, C, yaw) { const k = place(g, u, w, yaw || 0); bx(k, 1.2, 0.1, 0.8, C.p2, 0, 0.8, 0); [[-0.5, -0.32], [0.5, -0.32], [-0.5, 0.32], [0.5, 0.32]].forEach((p) => bx(k, 0.07, 0.8, 0.07, C.p1, p[0], 0.4, p[1], { ink: false })); bx(k, 0.5, 0.06, 0.5, C.p3, 0, 0.5, 0.75); bx(k, 0.5, 0.5, 0.06, C.p3, 0, 0.8, 1.0); return k; }
    function pin(g, x, y, z, col) { const k = group(g, [x, y, z]); sp(k, 0.42, col, 0, 0.55, 0); cn(k, 0.34, 0.8, col, 0, -0.05, 0, { r: [Math.PI, 0, 0] }); sp(k, 0.16, '#ffffff', 0, 0.55, 0.3, { ink: false }); return k; }

    /* ---------- 各主題的場景道具（u、w 為原型 24 格的版面座標，place 會放大到 60 格） ---------- */
    const ENV = {
      doctor(g, C, dark) {
        const b = place(g, -6.6, -8.6); building(b, 4.6, 4.2, 2.4, C, dark, 1, 0.55);
        const cr = group(b, [0, 5.0, 0]); bx(cr, 1.5, 0.45, 0.3, C.p1, 0, 0, 0, { t: 0.03 }); bx(cr, 0.45, 1.5, 0.3, C.p1, 0, 0, 0, { t: 0.03 });
        const b2 = place(g, 6.8, -8.6); building(b2, 3.6, 3.2, 2.2, C, dark, 2, 0.5);
        const bd = place(g, 7.4, -1.6, -0.3); bx(bd, 2.3, 0.3, 1.1, C.p2, 0, 0.62, 0); bx(bd, 2.1, 0.24, 0.95, C.wall, 0, 0.88, 0); bx(bd, 0.6, 0.16, 0.7, tint(C.wall, 0.5), -0.7, 1.08, 0);
        [[-1, -0.45], [1, -0.45], [-1, 0.45], [1, 0.45]].forEach((p) => cy(bd, 0.05, 0.05, 0.5, C.p3, p[0], 0.25, p[1], { ink: false }));
        const iv = place(g, -7.4, -2.2); cy(iv, 0.04, 0.04, 2.8, C.p3, 0, 1.4, 0, { ink: false }); cy(iv, 0.4, 0.4, 0.08, C.p3, 0, 0.04, 0); bx(iv, 0.5, 0.7, 0.14, C.glow, 0.1, 2.5, 0, { t: 0.04 }); bx(iv, 0.7, 0.05, 0.05, C.p3, 0.2, 2.82, 0, { ink: false });
        capsule(g, 1.6, 0.34, C.p1, C.wall, -4.6, FLOOR_Y + 0.4, 0.5, 0.5); capsule(g, 1.3, 0.28, C.p2, C.wall, 4.8, FLOOR_Y + 0.34, 1.2, -0.4);
      },
      engineer(g, C, dark) {
        [-7.2, -4.4, 6.0, 8.6].forEach((u, i) => {
          const r = place(g, u, -8.2 + (i % 2) * 1.6); bx(r, 2, 4.4, 1.6, C.p1, 0, 2.2, 0, { t: 0.03 });
          for (let k = 0; k < 8; k++) { bx(r, 1.7, 0.1, 0.05, k % 3 === 0 ? C.p2 : C.glow, 0, 0.6 + k * 0.5, 0.82, { basic: true, ink: false }); bx(r, 0.12, 0.12, 0.06, k % 2 ? C.glow : C.p3, 0.65, 0.6 + k * 0.5, 0.84, { basic: true, ink: false }); }
        });
        const code = canvasTex('code' + C.glow + C.p1, 256, 160, (x) => { x.fillStyle = shade(C.wall, 0.4); x.fillRect(0, 0, 256, 160); const r = rng(9); for (let j = 0; j < 9; j++) { x.fillStyle = [C.glow, C.p2, C.p3, C.A][j % 4]; x.fillRect(14 + (j % 3) * 16, 14 + j * 16, 30 + r() * 150, 8); } });
        [[-6.6, -3.2, 3.2], [7.4, -2.6, 2.6]].forEach((p, i) => { const m = place(g, p[0], p[1]); const pl = new T.Mesh(new T.BoxGeometry(2.6, 1.6, 0.1), [lam(C.p1), lam(C.p1), lam(C.p1), lam(C.p1), new T.MeshBasicMaterial({ map: code }), lam(C.p1)]); pl.position.y = p[2]; m.add(pl); addEdges(pl, INK, 0.8); mapAnim.push((t) => { pl.position.y = p[2] + (reduce() ? 0 : Math.sin(t * 1.2 + i) * 0.12); }); });
        const sg = canvasTex('sign' + C.glow, 256, 128, (x) => { x.font = '900 90px monospace'; x.fillStyle = C.glow; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('</>', 128, 68); });
        const sgm = place(g, 0.6, -9.6); const sgp = new T.Mesh(new T.PlaneGeometry(4, 2), new T.MeshBasicMaterial({ map: sg, transparent: true })); sgp.position.set(0, 4.6, 0); sgm.add(sgp);
      },
      nurse(g, C) {
        [[-7.4, -5.6], [-7.4, -2.6]].forEach((p) => { const b = place(g, p[0], p[1]); bx(b, 2.2, 0.3, 1.0, C.p2, 0, 0.62, 0); bx(b, 2.0, 0.24, 0.9, C.wall, 0, 0.88, 0); bx(b, 0.6, 0.16, 0.7, C.A, -0.7, 1.08, 0); bx(b, 0.08, 1.0, 0.08, C.p3, 1.1, 1.2, 0.4, { ink: false }); [[-1, -0.4], [1, -0.4], [-1, 0.4], [1, 0.4]].forEach((q) => cy(b, 0.05, 0.05, 0.5, C.p3, q[0], 0.25, q[1], { ink: false })); });
        const cur = place(g, 7.8, -6.2); bx(cur, 3.2, 3.2, 0.1, C.p1, 0, 1.8, 0, { ink: false, mat: new T.MeshLambertMaterial({ color: C.p1, transparent: true, opacity: 0.8 }) }); bx(cur, 3.3, 0.1, 0.12, C.p3, 0, 3.4, 0, { ink: false });
        const cart = place(g, 6.6, -1.8); bx(cart, 1.4, 0.9, 0.8, C.wall, 0, 0.7, 0); bx(cart, 1.5, 0.06, 0.9, C.p3, 0, 1.18, 0); [-0.4, 0, 0.4].forEach((y) => bx(cart, 1.2, 0.05, 0.02, C.p3, 0, 0.7 + y * 0.6, 0.41, { ink: false }));
        const pl = place(g, -8.2, 0.6); cy(pl, 0.4, 0.3, 0.6, C.p2, 0, 0.3, 0); sp(pl, 0.55, C.p1, 0, 1.0, 0); sp(pl, 0.4, C.A, 0.3, 1.4, 0.1); sp(pl, 0.35, C.B, -0.3, 1.35, 0);
        const sg = place(g, 0.8, -9.4); bx(sg, 3, 3, 0.2, C.wall, 0, 2.6, 0); bx(sg, 1.8, 0.55, 0.22, C.p1, 0, 2.6, 0.02, { basic: true, ink: false }); bx(sg, 0.55, 1.8, 0.22, C.p1, 0, 2.6, 0.02, { basic: true, ink: false });
      },
      teacher(g, C) {
        const bd = place(g, -5.2, -9.4); bx(bd, 6.2, 3.4, 0.2, C.wall, 0, 3.2, 0, { t: 0.02 });
        const ch = canvasTex('chalk' + C.p1, 512, 256, (x) => { x.fillStyle = C.p1; x.fillRect(0, 0, 512, 256); x.fillStyle = tint(C.p1, 0.85); x.font = '700 56px "Noto Sans TC",sans-serif'; x.fillText('A B C  1+2=3', 30, 100); x.font = '700 50px "Noto Sans TC",sans-serif'; x.fillText('今天的功課', 30, 190); });
        const bp = new T.Mesh(new T.PlaneGeometry(5.6, 2.8), new T.MeshBasicMaterial({ map: ch })); bp.position.set(0, 3.2, 0.12); bd.add(bp);
        desk(g, 5.4, -4.2, C, 0.4); desk(g, 7.6, -2.2, C, 0.4); desk(g, -7.4, -1.4, C, 0.4);
        [[-8.6, -5.2, 3.0], [8.4, -7.0, 3.6]].forEach((p) => { const k = place(g, p[0], p[1]); cy(k, 0.3, 0.3, p[2], C.p2, 0, p[2] / 2, 0, { seg: 6 }); cn(k, 0.3, 0.6, tint(C.A, 0.3), 0, p[2] + 0.3, 0, { seg: 6 }); cn(k, 0.1, 0.2, '#2b2b30', 0, p[2] + 0.65, 0, { seg: 6, ink: false }); cy(k, 0.3, 0.3, 0.3, '#e9a1b1', 0, -0.1, 0, { seg: 6 }); });
        const gl = place(g, 4.0, 0.2); cy(gl, 0.4, 0.4, 0.1, C.p1, 0, 0.05, 0); cy(gl, 0.05, 0.05, 0.9, C.p1, 0, 0.5, 0, { ink: false }); sp(gl, 0.6, C.p3, 0, 1.3, 0);
        const bk = place(g, -4.0, 1.0); bx(bk, 1.2, 0.22, 0.9, C.p2, 0, 0.11, 0); bx(bk, 1.1, 0.22, 0.85, C.A, 0, 0.33, 0); sp(bk, 0.26, '#d62f2f', 0.1, 0.7, 0);
      },
      civil(g, C) {
        const h = place(g, -5.2, -8.6); h.scale.setScalar(0.82); [0, 1, 2].forEach((i) => bx(h, 6.4 - i * 0.5, 0.28, 2.8 - i * 0.2, C.wall, 0, 0.14 + i * 0.28, 0));
        for (let i = 0; i < 5; i++) cy(h, 0.24, 0.24, 2.6, C.wall, -2.2 + i * 1.1, 2.1, 0.2, { seg: 12, t: 0.03 });
        bx(h, 5.6, 0.45, 2.2, C.p1, 0, 3.6, 0);
        const shp = new T.Shape(); shp.moveTo(-2.9, 0); shp.lineTo(2.9, 0); shp.lineTo(0, 1.1); shp.lineTo(-2.9, 0);
        const pd = new T.Mesh(new T.ExtrudeGeometry(shp, { depth: 2.0, bevelEnabled: false }), lam(C.wall)); pd.position.set(0, 3.83, -1.0); h.add(pd); addEdges(pd, INK, 0.7);
        const fl = place(g, 6.2, -7.2); cy(fl, 0.05, 0.05, 6, C.A, 0, 3, 0, { ink: false }); bx(fl, 1.4, 0.9, 0.05, C.p1, 0.75, 5.4, 0, { t: 0.03 }); sp(fl, 0.12, C.glow, 0, 6.1, 0);
        [[-7.4, -2.2], [-7.4, -0.6]].forEach((p) => { const c = place(g, p[0], p[1]); bx(c, 1.1, 1.9, 0.8, C.p2, 0, 0.95, 0); [0.4, 0.95, 1.5].forEach((y) => { bx(c, 0.9, 0.4, 0.04, tint(C.p2, 0.25), 0, y, 0.42, { ink: false }); bx(c, 0.3, 0.05, 0.05, C.glow, 0, y, 0.46, { ink: false }); }); });
        const st = place(g, 7.0, 0.8); cy(st, 0.6, 0.6, 0.3, C.p1, 0, 0.15, 0); cy(st, 0.18, 0.18, 0.8, C.p3, 0, 0.7, 0); sp(st, 0.26, C.p3, 0, 1.25, 0);
      },
      sales(g, C, dark) {
        [[-8.4, 5.6, 2.6, 1], [-5.6, 7.6, 2.4, 2], [-2.8, 4.6, 2.4, 3], [5.2, 6.8, 2.6, 4], [8.0, 5.0, 2.6, 5]].forEach((p) => { const b = place(g, p[0], -8.6); building(b, p[2], p[1], 2.2, C, dark, p[3], dark ? 0.5 : 0.25, C.p2); });
        const ch = place(g, 7.2, -1.2); [0.8, 1.4, 2.0, 2.8, 3.8].forEach((h2, i) => bx(ch, 0.6, h2, 0.6, i % 2 ? C.p1 : shade(C.p1, 0.12), -1.4 + i * 0.7, h2 / 2, 0, { t: 0.03 })); cn(ch, 0.36, 0.7, C.p1, 2.1, 4.4, 0, { seg: 4 }); limb(ch, [-1.4, 1.2, 0], [1.9, 4.0, 0], 0.07, C.p3);
        const co = place(g, -6.6, -0.6); [0, 1, 2, 3].forEach((i) => cy(co, 0.5, 0.5, 0.14, C.p1, 0, 0.07 + i * 0.16, 0, { seg: 20, t: 0.03 })); [0, 1].forEach((i) => cy(co, 0.5, 0.5, 0.14, C.p1, 1.1, 0.07 + i * 0.16, 0.3, { seg: 20, t: 0.03 }));
      },
      designer(g, C) {
        const e = place(g, -7.0, -4.6); limb(e, [-0.9, 0, -0.5], [-0.4, 3.4, 0], 0.07, WOOD); limb(e, [0.9, 0, -0.5], [0.4, 3.4, 0], 0.07, WOOD); limb(e, [0, 0, 0.8], [0, 3.0, 0.1], 0.07, WOOD);
        const art = canvasTex('art' + C.p1 + C.p2, 128, 160, (x) => { x.fillStyle = C.wall; x.fillRect(0, 0, 128, 160); x.fillStyle = C.p1; x.beginPath(); x.arc(46, 52, 30, 0, 7); x.fill(); x.fillStyle = C.p2; x.fillRect(60, 70, 50, 60); x.fillStyle = C.p3; x.beginPath(); x.moveTo(20, 140); x.lineTo(60, 90); x.lineTo(70, 140); x.fill(); });
        const cv = new T.Mesh(new T.BoxGeometry(2, 2.5, 0.12), [lam(WOOD), lam(WOOD), lam(WOOD), lam(WOOD), new T.MeshBasicMaterial({ map: art }), lam(WOOD)]); cv.position.set(0, 2.5, 0.1); e.add(cv); addEdges(cv);
        [[-4.4, 1.2, C.p1, 0.2], [4.2, 1.6, C.p2, -0.3], [7.4, -2.2, C.p3, 0.5]].forEach((p) => { const t = place(g, p[0], p[1], p[3]); cy(t, 0.4, 0.4, 2.0, p[2], 0, 0.5, 0, { r: [0, 0, Math.PI / 2] }); cn(t, 0.4, 0.5, '#d8dbe0', 1.25, 0.5, 0, { r: [0, 0, -Math.PI / 2] }); cy(t, 0.16, 0.16, 0.3, '#2b2b30', 1.6, 0.5, 0, { r: [0, 0, Math.PI / 2], ink: false }); });
        [[(k) => sp(k, 0.7, C.p1, 0, 0, 0), -6.2, -6.4, 3.4], [(k) => cn(k, 0.7, 1.4, C.p2, 0, 0, 0), 6.6, -6.0, 3.6], [(k) => bx(k, 1.1, 1.1, 1.1, C.p3, 0, 0, 0), -1.4, -9.0, 4.2], [(k) => part(k, new T.TorusGeometry(0.6, 0.22, 10, 22), C.p1, {}), 3.8, -8.6, 4.4]].forEach((sh, i) => {
          const k = place(g, sh[1], sh[2]), o = group(k, [0, sh[3], 0]); sh[0](o);
          mapAnim.push((t) => { o.position.y = sh[3] + (reduce() ? 0 : Math.sin(t * 1.1 + i * 1.6) * 0.25); o.rotation.y = reduce() ? 0 : t * 0.4 + i; });
        });
        const fan = place(g, 6.4, 0.6); for (let i = 0; i < 6; i++) { const k = group(fan, [0, 0.1, 0], [0, 0, 0.3 + i * 0.28]); bx(k, 0.34, 1.6, 0.05, [C.p1, C.p2, C.p3, C.A, C.B, C.C][i], 0, 0.8, 0, { t: 0.03 }); }
      },
      chef(g, C, dark) {
        const wl = place(g, 0, -10.2); const tl = canvasTex('wall' + C.wall + C.p1, 512, 256, (x) => { x.fillStyle = C.wall; x.fillRect(0, 0, 512, 256); x.strokeStyle = mixHex(C.wall, C.p3, 0.35); x.lineWidth = 3; for (let i = 0; i <= 16; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, 256); x.stroke(); } for (let j = 0; j <= 8; j++) { x.beginPath(); x.moveTo(0, j * 32); x.lineTo(512, j * 32); x.stroke(); } x.fillStyle = C.p1; x.fillRect(0, 150, 512, 10); }, true);
        const ww = Math.round(22 * S.ku); tl.repeat.set(ww / 22, 1);
        const wp = new T.Mesh(new T.PlaneGeometry(ww, 5), new T.MeshLambertMaterial({ map: tl })); wp.position.set(0, 2.5, 0); wl.add(wp);
        const st = place(g, -4.6, -8.4); bx(st, 4.6, 1.6, 1.6, dark ? C.p3 : C.A, 0, 0.8, 0, { t: 0.03 }); bx(st, 4.7, 0.12, 1.7, C.p3, 0, 1.66, 0); [-1, 1].forEach((s) => cy(st, 0.5, 0.5, 0.06, '#2b2b30', s * 1.1, 1.74, 0, { seg: 20, ink: false }));
        const pot = group(st, [-1.1, 1.72, 0]); cy(pot, 0.6, 0.55, 0.8, '#aeb4bd', 0, 0.4, 0, { seg: 20 }); cy(pot, 0.62, 0.62, 0.08, C.p3, 0, 0.84, 0, { seg: 20 }); sp(pot, 0.1, C.p3, 0, 0.98, 0);
        const fl = [0, 1, 2].map((i) => cn(st, 0.12, 0.34, C.glow, 1.1 + (i - 1) * 0.2, 1.9, 0, { basic: true, ink: false, seg: 8 })); mapAnim.push((t) => fl.forEach((f, i) => { f.scale.y = reduce() ? 1 : 0.8 + Math.sin(t * 9 + i * 2) * 0.25; }));
        const pl = place(g, 6.6, -2.4); [0, 1, 2, 3, 4].forEach((i) => cy(pl, 0.7, 0.62, 0.1, '#f4f4f4', 0, 0.06 + i * 0.12, 0, { seg: 24, t: 0.03 })); cy(pl, 0.5, 0.5, 0.02, C.p1, 0, 0.66, 0, { seg: 24, ink: false });
        const vg = place(g, -6.6, -0.8); [[0, 0], [0.7, 0.3], [-0.6, 0.5]].forEach((p) => sp(vg, 0.4, C.p1, p[0], 0.4, p[1])); sp(vg, 0.55, C.p2, 1.7, 0.5, 0); sp(vg, 0.4, tint(C.p2, 0.2), 1.9, 0.55, 0.4); [0, 0.3].forEach((o) => cn(vg, 0.12, 0.8, C.p3, -1.6 + o, 0.15, o * 0.5, { r: [0, 0, 1.4], seg: 8 }));
        const ld = place(g, 4.6, 0.8); cy(ld, 0.05, 0.05, 2.6, '#c9ced6', 0, 1.3, 0, { ink: false }); sp(ld, 0.4, '#c9ced6', 0, 2.7, 0, { s: [1, 0.5, 1] });
      },
      courier(g, C, dark) {
        [[-8.2, 5.2, 2.4, 1], [-5.4, 7.0, 2.6, 2], [-2.6, 4.4, 2.2, 3], [5.0, 6.2, 2.6, 4], [7.8, 4.6, 2.4, 5]].forEach((p) => { const b = place(g, p[0], -9); building(b, p[2], p[1], 2.2, C, dark, p[3], dark ? 0.5 : 0.3, shade(C.wall, 0.2)); });
        [-3.6, 3.4].forEach((u) => { const l = place(g, u, -5.4); cy(l, 0.06, 0.06, 3.2, '#2b2b30', 0, 1.6, 0, { ink: false }); bx(l, 0.8, 0.1, 0.1, '#2b2b30', 0.4, 3.2, 0, { ink: false }); sp(l, 0.2, C.glow, 0.8, 3.1, 0, { basic: true, ink: false }); });
        const sc = place(g, -6.8, 0.2, 0.3); bx(sc, 1.6, 0.4, 0.5, C.p2, 0, 0.5, 0); bx(sc, 0.5, 1.0, 0.1, C.p2, 0.8, 0.9, 0, { r: [0, 0, 0.3] }); [-0.6, 0.7].forEach((x) => cy(sc, 0.28, 0.28, 0.2, '#222', x, 0.28, 0, { r: [Math.PI / 2, 0, 0], ink: true })); bx(sc, 0.7, 0.5, 0.6, C.p1, -0.6, 1.0, 0);
        [[-2.2, -6.4, 4.6, C.p1], [5.4, -5.6, 4.2, C.p2]].forEach((p, i) => {
          const k = place(g, p[0], p[1]), pn = pin(k, 0, p[2], 0, p[3]);
          mapAnim.push((t) => { pn.position.y = p[2] + (reduce() ? 0 : Math.sin(t * 1.6 + i * 2) * 0.3); pn.rotation.y = reduce() ? 0 : t * 0.8; });
        });
      },
      farmer(g, C, dark) {
        const mill = place(g, -6.6, -8.2); cy(mill, 0.9, 1.4, 4.2, C.wall, 0, 2.1, 0, { seg: 10, t: 0.03 }); cn(mill, 1.1, 1.2, C.p1, 0, 4.8, 0, { seg: 10, t: 0.03 }); bx(mill, 0.5, 0.9, 0.1, C.p2, 0, 0.5, 1.35, { ink: false });
        const hub = group(mill, [0, 4.0, 1.2]); sp(hub, 0.2, C.p1, 0, 0, 0); for (let i = 0; i < 4; i++) { const b = group(hub, [0, 0, 0], [0, 0, i * Math.PI / 2]); bx(b, 0.5, 2.6, 0.06, tint(C.wall, 0.1), 0, 1.5, 0.05, { t: 0.04 }); } mapAnim.push((t) => { hub.rotation.z = reduce() ? 0.4 : t * 0.7; });
        [[6.8, -7.4], [3.4, -9.0]].forEach((p) => { const h = place(g, p[0], p[1]); cy(h, 0.9, 1.0, 1.3, C.p1, 0, 0.65, 0, { seg: 14, t: 0.03 }); sp(h, 0.9, C.p1, 0, 1.3, 0, { s: [1, 0.7, 1], t: 0.03 }); });
        // 籬笆：起點照比例放大，柱距維持 0.6
        const f0 = S.map(-3.8, 3.5);
        for (let i = 0; i < 24; i++) { const f = placeRaw(g, f0[0] + i * 0.6, f0[1]); cy(f, 0.05, 0.05, 1.0, WOOD, 0, 0.5, 0, { ink: false, seg: 6 }); if (i < 23) bx(f, 0.62, 0.06, 0.05, WOOD, 0.3, 0.8, 0, { ink: false }); }
        // 麥穗：每 3 幀更新一次矩陣（手機效能待實測）
        const N = 520, stems = new T.InstancedMesh(new T.CylinderGeometry(0.012, 0.012, 0.8, 5), lam(shade(C.p1, 0.15)), N), heads = new T.InstancedMesh(new T.SphereGeometry(0.06, 6, 5), lam(C.p1), N);
        const r = rng(21), pos = [];
        const areas = [[-10.5, -8.2, -4.4, 3.5], [6.2, -6.5, 10.6, 3.5], [-4.2, 1.8, 6, 4.4]].map((a) => { const p = S.map(a[0], a[1]), q = S.map(a[2], a[3]); return [p[0], p[1], q[0], q[1]]; });
        for (let i = 0; i < N; i++) { const a = areas[i % 3]; pos.push([a[0] + r() * (a[2] - a[0]), a[1] + r() * (a[3] - a[1]), r() * 6]); }
        const dm = new T.Object3D(); const fieldG = placeRaw(g, 0, 0); fieldG.add(stems); fieldG.add(heads);
        const upd = (t) => pos.forEach((p, i) => { const tilt = reduce() ? 0 : Math.sin(t * 1.4 + p[2]) * 0.1; dm.position.set(p[0], 0.4, p[1]); dm.rotation.set(0, 0, tilt); dm.updateMatrix(); stems.setMatrixAt(i, dm.matrix); dm.position.set(p[0] - Math.sin(tilt) * 0.4, 0.4 + Math.cos(tilt) * 0.4 + 0.04, p[1]); dm.scale.set(1, 2.2, 1); dm.updateMatrix(); heads.setMatrixAt(i, dm.matrix); dm.scale.set(1, 1, 1); });
        upd(0); stems.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
        let acc = 0; mapAnim.push((t) => { if (reduce()) return; acc++; if (acc % 3) return; upd(t); stems.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true; });
        // 太陽／月亮與雲固定在天空（跟著鏡頭）
        if (dark) { const s = sp(S.sky, 1.1, '#f4efd8', 0, 0, 0, { basic: true, ink: false }); s.position.copy(skyAt(6.4, 4.4, -40)); } else { const s = sp(S.sky, 1.3, C.p1, 0, 0, 0, { basic: true, ink: false }); s.position.copy(skyAt(6.8, 4.6, -40)); }
        [[-6.6, 4.4, 1.0], [2.2, 5.2, 0.7], [7.6, 3.4, 0.8]].forEach((c) => { const k = cloud(S.sky, 0, 0, 0, c[2], dark ? shade(C.wall, 0.1) : '#ffffff'); k.position.copy(skyAt(c[0], c[1], -38)); k.scale.setScalar(1.6); });
      },
    };

    function env(key, g, C, dark) { ENV[key](g, C, dark); }
    return { THEMES, colors, floorTex, env };
  };
})();
