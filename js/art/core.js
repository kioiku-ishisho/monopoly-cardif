/*
 * 3D 美術模組：共用工具（window.RealLifeArt）
 * 依賴 vendor/three.min.js（r128，全域 THREE）。
 * 載入順序：core.js → data.js → characters.js → themes.js → board.js
 *
 * 建模小工具都綁在一個「kit」上：每個 3D 實例有自己的材質與貼圖快取，
 * 切換主題或釋放時可以真的把 GPU 資源清掉（原型的 texCache 沒有釋放，會洩漏）。
 */
(function () {
  'use strict';
  const A = (window.RealLifeArt = window.RealLifeArt || {});
  if (!window.THREE) return;
  const T = THREE;

  A.INK = '#1b1b1b';
  A.SKIN = '#f6e6d4';
  A.WOOD = '#b98b5e';
  A.SQ2 = Math.SQRT2;

  A.mixHex = (a, b, t) => '#' + new T.Color(a).lerp(new T.Color(b), t).getHexString();
  A.tint = (a, t) => A.mixHex(a, '#ffffff', t);
  A.shade = (a, t) => A.mixHex(a, '#000000', t);
  A.rng = function (seed) {
    let a = seed;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // 相對亮度（WCAG），用來挑格子上字的顏色
  function lumOf(hex) {
    const c = new T.Color(hex);
    const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  A.contrast = (a, b) => {
    const x = lumOf(a), y = lumOf(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  // 釋放一棵物件樹的幾何與材質（材質上的貼圖由 kit 的快取統一釋放）
  A.disposeTree = function (o) {
    o.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      const m = n.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
    });
  };

  /*
   * 建立一組建模工具。options.reduced() 回傳是否減少動態。
   * 回傳的物件同時是角色與主題模組的 K。
   */
  A.kit = function (options) {
    const K = {};
    const reduced = options.reduced || (() => false);
    K.reduced = reduced;

    const matCache = new Map();
    const texCache = new Map();
    const INK_MAT = new T.MeshBasicMaterial({ color: A.INK, side: T.BackSide });

    K.lam = (color) => {
      if (!matCache.has(color)) matCache.set(color, new T.MeshLambertMaterial({ color }));
      return matCache.get(color);
    };
    K.part = function (parent, geo, color, o) {
      o = o || {};
      const m = new T.Mesh(geo, o.basic ? new T.MeshBasicMaterial({ color }) : (o.mat || K.lam(color)));
      if (o.p) m.position.set(o.p[0], o.p[1], o.p[2]);
      if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
      if (o.r) m.rotation.set(o.r[0], o.r[1], o.r[2]);
      if (o.ink !== false) {
        const ol = new T.Mesh(geo, INK_MAT);
        ol.scale.setScalar(1 + (o.t || 0.05));
        m.add(ol);
      }
      parent.add(m);
      return m;
    };
    K.group = function (parent, p, r) {
      const g = new T.Group();
      if (p) g.position.set(p[0], p[1], p[2]);
      if (r) g.rotation.set(r[0], r[1], r[2]);
      parent.add(g);
      return g;
    };
    K.limb = function (parent, a, b, r, color, ink) {
      const P = new T.Vector3(a[0], a[1], a[2]);
      const Q = new T.Vector3(b[0], b[1], b[2]);
      const m = K.part(parent, new T.CylinderGeometry(r, r, P.distanceTo(Q), 10), color, { ink: !!ink });
      m.position.copy(P).add(Q).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), Q.clone().sub(P).normalize());
      return m;
    };
    K.bx = (g, w, h, d, c, x, y, z, o) => K.part(g, new T.BoxGeometry(w, h, d), c, Object.assign({ p: [x, y, z] }, o));
    K.cy = (g, rt, rb, h, c, x, y, z, o) => K.part(g, new T.CylinderGeometry(rt, rb, h, (o && o.seg) || 16), c, Object.assign({ p: [x, y, z] }, o));
    K.sp = (g, r, c, x, y, z, o) => K.part(g, new T.SphereGeometry(r, 18, 14), c, Object.assign({ p: [x, y, z] }, o));
    K.cn = (g, r, h, c, x, y, z, o) => K.part(g, new T.ConeGeometry(r, h, (o && o.seg) || 12), c, Object.assign({ p: [x, y, z] }, o));
    K.addEdges = function (mesh, color, op) {
      const l = new T.LineSegments(new T.EdgesGeometry(mesh.geometry),
        new T.LineBasicMaterial({ color: color || A.INK, transparent: true, opacity: op || 0.75 }));
      mesh.add(l);
      return l;
    };

    K.canvasTex = function (key, w, h, draw, repeat) {
      if (texCache.has(key)) return texCache.get(key);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      draw(cv.getContext('2d'), w, h);
      const t = new T.CanvasTexture(cv);
      t.anisotropy = 4;
      if (repeat) { t.wrapS = T.RepeatWrapping; t.wrapT = T.RepeatWrapping; }
      texCache.set(key, t);
      return t;
    };
    K.textSprite = function (txt, color) {
      const map = K.canvasTex('sprite|' + txt + color, 128, 64, (x) => {
        x.font = 'bold 40px monospace'; x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(txt, 64, 34);
      });
      const s = new T.Sprite(new T.SpriteMaterial({ map, transparent: true, depthWrite: false }));
      s.scale.set(0.62, 0.31, 1);
      return s;
    };

    // 切換主題／模式或字型載入完成時呼叫：貼圖與材質快取全部釋放
    K.flush = function () {
      texCache.forEach((t) => t.dispose());
      texCache.clear();
      matCache.forEach((m) => m.dispose());
      matCache.clear();
    };
    K.dispose = function () {
      K.flush();
      INK_MAT.dispose();
    };
    return K;
  };
})();
