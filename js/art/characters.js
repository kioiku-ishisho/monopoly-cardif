/*
 * 3D 美術模組：角色（圓頭＋半橢圓身體，沒有手腳）
 * A.characters(K) → { make(key), idle(root, t) }
 * 規格見 handoff docs/02-characters.md；造型直接取自原型 BUILD。
 */
(function () {
  'use strict';
  const A = window.RealLifeArt;
  if (!A || !window.THREE) return;
  const T = THREE;
  const { INK, SKIN, mixHex, shade } = A;

  A.characters = function (K) {
    const { part, group, limb, lam, textSprite } = K;
    const reduce = K.reduced;

    // 身體前表面的 z：胸前的東西貼在 BZ(x, y) + 0.01～0.04
    const BZ = (x, y) => 0.56 * Math.sqrt(Math.max(0.0001, 1 - (x / 0.74) * (x / 0.74) - (y / 0.8) * (y / 0.8)));
    function setBody(root, color) { root.userData.body.material = lam(color); root.userData.cap.material = lam(color); }
    function ringE(rig, color, rx, tube, y, zs) {
      return part(rig, new T.TorusGeometry(rx, tube, 8, 32), color, { p: [0, y, 0], r: [Math.PI / 2, 0, 0], s: [1, zs, 1], ink: false });
    }
    function dome(rig, color, rad, theta, p, rot) {
      return part(rig, new T.SphereGeometry(rad, 28, 14, 0, Math.PI * 2, 0, Math.PI * theta), color, { p: p || [0, 1.2, 0], r: rot });
    }
    function baseChar() {
      const root = new T.Group();
      const rig = new T.Group(); root.add(rig);
      const shadow = new T.Mesh(new T.CircleGeometry(0.86, 32), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.scale.y = 0.72; shadow.position.y = 0.012; root.add(shadow);
      const body = part(rig, new T.SphereGeometry(1, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), '#888888', { s: [0.74, 0.8, 0.56], t: 0.035 });
      const cap = part(rig, new T.CircleGeometry(1, 32), '#888888', { p: [0, 0.004, 0], s: [0.74, 0.56, 1], r: [Math.PI / 2, 0, 0], ink: false });
      part(rig, new T.SphereGeometry(0.55, 28, 20), SKIN, { p: [0, 1.2, 0], s: [0.96, 1.04, 0.96] });
      [-1, 1].forEach((sx) => part(rig, new T.SphereGeometry(0.06, 12, 10), INK, { p: [sx * 0.2, 1.2, 0.5], s: [0.8, 1.7, 0.5], ink: false }));
      root.userData = { rig, body, cap };
      return root;
    }

    const BUILD = {
      doctor(rig, c, root) {
        const [coat, scrub, mask, steth, mirror] = c; setBody(root, coat);
        part(rig, new T.BoxGeometry(0.2, 0.42, 0.03), scrub, { p: [0, 0.46, BZ(0, 0.46) + 0.005], ink: false });
        [-1, 1].forEach((s) => part(rig, new T.BoxGeometry(0.09, 0.4, 0.03), mixHex(coat, '#9aa8b4', 0.2), { p: [s * 0.14, 0.5, BZ(s * 0.14, 0.5) + 0.012], r: [0, 0, s * 0.28], ink: false }));
        ringE(rig, steth, 0.42, 0.025, 0.66, 0.76);
        part(rig, new T.TorusGeometry(0.2, 0.022, 8, 20, Math.PI), steth, { p: [0, 0.62, BZ(0, 0.62) + 0.02], r: [0, 0, Math.PI], ink: false });
        part(rig, new T.SphereGeometry(0.06, 12, 10), '#cfd6dd', { p: [0, 0.4, BZ(0, 0.4) + 0.03] });
        part(rig, new T.SphereGeometry(0.5, 20, 12), mask, { p: [0, 1.02, 0.2], s: [0.95, 0.5, 0.8] });
        ringE(rig, '#2b2f36', 0.46, 0.03, 1.5, 1);
        part(rig, new T.CylinderGeometry(0.2, 0.2, 0.04, 24), mirror, { p: [0, 1.52, 0.46], r: [Math.PI / 2, 0, 0] });
        part(rig, new T.CylinderGeometry(0.07, 0.07, 0.05, 16), '#2b2f36', { p: [0, 1.52, 0.485], r: [Math.PI / 2, 0, 0], ink: false });
      },
      engineer(rig, c, root) {
        const [hood, phone, green, frame, silver] = c; setBody(root, hood);
        ringE(rig, mixHex(hood, '#ffffff', 0.1), 0.43, 0.07, 0.66, 0.76);
        [-1, 1].forEach((s) => part(rig, new T.CylinderGeometry(0.014, 0.014, 0.26, 6), '#e8e8e8', { p: [s * 0.1, 0.5, BZ(s * 0.1, 0.5) + 0.02], ink: false }));
        part(rig, new T.TorusGeometry(0.6, 0.035, 8, 28, Math.PI), phone, { p: [0, 1.2, 0], ink: false });
        [-1, 1].forEach((s) => {
          part(rig, new T.CylinderGeometry(0.16, 0.16, 0.1, 20), phone, { p: [s * 0.6, 1.18, 0], r: [0, 0, Math.PI / 2] });
          part(rig, new T.CylinderGeometry(0.1, 0.1, 0.02, 16), green, { p: [s * 0.665, 1.18, 0], r: [0, 0, Math.PI / 2], basic: true, ink: false });
          part(rig, new T.TorusGeometry(0.12, 0.017, 8, 24), frame, { p: [s * 0.2, 1.2, 0.52], ink: false });
        });
        part(rig, new T.BoxGeometry(0.1, 0.02, 0.02), frame, { p: [0, 1.22, 0.53], ink: false });
        part(rig, new T.BoxGeometry(0.72, 0.04, 0.42), silver, { p: [0, 0.3, 0.76] });
        part(rig, new T.BoxGeometry(0.72, 0.46, 0.035), silver, { p: [0, 0.53, 0.97], r: [-0.3, 0, 0] });
        part(rig, new T.BoxGeometry(0.11, 0.11, 0.02), green, { p: [0, 0.55, 0.995], r: [-0.3, 0, 0], basic: true, ink: false });
        const sps = ['0101', '1101', '0010', '1011', '001', '110'].map((w) => { const s = textSprite(w, green); rig.add(s); return s; });
        root.userData.tick = (t) => sps.forEach((s, k) => {
          const a = (reduce() ? 0 : t * 0.8) + k * (Math.PI * 2 / sps.length);
          s.position.set(Math.cos(a) * 1.05, 1.3 + Math.sin(a * 1.5 + k) * 0.35, Math.sin(a) * 1.05);
        });
      },
      nurse(rig, c, root) {
        const [pink, capc, cross, tag, pen] = c; setBody(root, pink);
        [-1, 1].forEach((s) => part(rig, new T.BoxGeometry(0.1, 0.34, 0.03), '#ffffff', { p: [s * 0.1, 0.55, BZ(s * 0.1, 0.55) + 0.01], r: [0, 0, s * 0.35], ink: false }));
        part(rig, new T.BoxGeometry(0.22, 0.11, 0.03), tag, { p: [-0.27, 0.36, BZ(-0.27, 0.36) + 0.012] });
        part(rig, new T.BoxGeometry(0.1, 0.02, 0.032), cross, { p: [-0.27, 0.36, BZ(-0.27, 0.36) + 0.016], basic: true, ink: false });
        part(rig, new T.CylinderGeometry(0.014, 0.014, 0.2, 6), pen, { p: [0.27, 0.4, BZ(0.27, 0.4) + 0.02], r: [0, 0, 0.1], ink: false });
        part(rig, new T.CylinderGeometry(0.32, 0.38, 0.22, 24), capc, { p: [0, 1.8, 0.02] });
        part(rig, new T.BoxGeometry(0.2, 0.06, 0.02), cross, { p: [0, 1.8, 0.4], ink: false });
        part(rig, new T.BoxGeometry(0.06, 0.2, 0.02), cross, { p: [0, 1.8, 0.4], ink: false });
      },
      teacher(rig, c, root) {
        const [cardi, collar, hair, frame, apple, stick] = c; setBody(root, cardi);
        [-1, 1].forEach((s) => part(rig, new T.BoxGeometry(0.1, 0.34, 0.03), collar, { p: [s * 0.1, 0.56, BZ(s * 0.1, 0.56) + 0.01], r: [0, 0, s * 0.35], ink: false }));
        [0.5, 0.36, 0.22].forEach((y) => part(rig, new T.SphereGeometry(0.03, 8, 8), shade(cardi, 0.4), { p: [0, y, BZ(0, y) + 0.01], ink: false }));
        part(rig, new T.SphereGeometry(0.075, 12, 10), apple, { p: [-0.28, 0.42, BZ(-0.28, 0.42) + 0.04] });
        part(rig, new T.BoxGeometry(0.05, 0.03, 0.02), '#3f8f4f', { p: [-0.26, 0.5, BZ(-0.26, 0.5) + 0.05], r: [0, 0, 0.5], ink: false });
        dome(rig, hair, 0.565, 0.36, [0, 1.22, -0.02], [-0.2, 0, 0]);
        part(rig, new T.SphereGeometry(0.2, 16, 12), hair, { p: [0, 1.74, -0.3] });
        [-1, 1].forEach((s) => part(rig, new T.TorusGeometry(0.13, 0.02, 8, 24), frame, { p: [s * 0.2, 1.2, 0.53], ink: false }));
        part(rig, new T.BoxGeometry(0.1, 0.02, 0.02), frame, { p: [0, 1.22, 0.54], ink: false });
        limb(rig, [0.62, 0.05, -0.28], [0.92, 1.62, -0.3], 0.03, stick);
        part(rig, new T.SphereGeometry(0.055, 10, 8), apple, { p: [0.92, 1.62, -0.3], ink: false });
      },
      civil(rig, c, root) {
        const [shirt, tie, hair, lan, badge] = c; setBody(root, shirt);
        ringE(rig, mixHex(shirt, '#c8ccd0', 0.4), 0.42, 0.04, 0.67, 0.76);
        part(rig, new T.BoxGeometry(0.09, 0.4, 0.04), tie, { p: [0, 0.46, BZ(0, 0.46) + 0.012], ink: false });
        part(rig, new T.BoxGeometry(0.12, 0.08, 0.05), tie, { p: [0, 0.66, BZ(0, 0.66) + 0.012], ink: false });
        [-1, 1].forEach((s) => part(rig, new T.BoxGeometry(0.035, 0.5, 0.02), lan, { p: [s * 0.1, 0.5, BZ(s * 0.1, 0.5) + 0.012], r: [0, 0, -s * 0.28], ink: false }));
        part(rig, new T.BoxGeometry(0.2, 0.26, 0.03), badge, { p: [0, 0.2, BZ(0, 0.2) + 0.03] });
        part(rig, new T.BoxGeometry(0.2, 0.06, 0.034), lan, { p: [0, 0.31, BZ(0, 0.31) + 0.032], ink: false });
        dome(rig, hair, 0.565, 0.38, [0, 1.22, -0.01], [-0.12, 0, 0]);
        [-1, 1].forEach((s) => part(rig, new T.SphereGeometry(0.09, 12, 10), hair, { p: [s * 0.1, 1.02, 0.5], s: [1.5, 0.6, 0.6], ink: false }));
      },
      sales(rig, c, root) {
        const [suit, shirt, tie, hair, phone] = c; setBody(root, suit);
        part(rig, new T.BoxGeometry(0.22, 0.5, 0.03), shirt, { p: [0, 0.5, BZ(0, 0.5) + 0.006], ink: false });
        [-1, 1].forEach((s) => part(rig, new T.BoxGeometry(0.1, 0.46, 0.03), shade(suit, 0.25), { p: [s * 0.16, 0.5, BZ(s * 0.16, 0.5) + 0.012], r: [0, 0, s * 0.22], ink: false }));
        part(rig, new T.BoxGeometry(0.07, 0.4, 0.04), tie, { p: [0, 0.46, BZ(0, 0.46) + 0.016], ink: false });
        part(rig, new T.BoxGeometry(0.1, 0.07, 0.045), tie, { p: [0, 0.66, BZ(0, 0.66) + 0.016], ink: false });
        part(rig, new T.BoxGeometry(0.12, 0.06, 0.02), '#ffffff', { p: [-0.32, 0.4, BZ(-0.32, 0.4) + 0.012], r: [0, 0, 0.2], ink: false });
        dome(rig, hair, 0.565, 0.36, [0, 1.22, -0.02], [-0.2, 0, 0]);
        [-1, 1].forEach((s) => {
          part(rig, new T.TorusGeometry(0.12, 0.02, 6, 4), hair, { p: [s * 0.2, 1.2, 0.53], r: [0, 0, Math.PI / 4], ink: false });
          part(rig, new T.CylinderGeometry(0.13, 0.13, 0.1, 16), phone, { p: [s * 0.58, 1.15, 0], r: [0, 0, Math.PI / 2] });
        });
        part(rig, new T.TorusGeometry(0.6, 0.03, 8, 24, Math.PI), phone, { p: [0, 1.2, 0], ink: false });
        limb(rig, [0.58, 1.12, 0.05], [0.3, 0.92, 0.5], 0.015, phone);
        part(rig, new T.SphereGeometry(0.04, 8, 8), phone, { p: [0.3, 0.92, 0.5], ink: false });
      },
      designer(rig, c, root) {
        const [turtle, beret, pencil, dot1, dot2] = c; setBody(root, turtle);
        ringE(rig, mixHex(turtle, '#ffffff', 0.1), 0.4, 0.085, 0.69, 0.78);
        [[-0.2, 0.42, dot1], [0.14, 0.3, pencil], [0.27, 0.5, dot2]].forEach((d) =>
          part(rig, new T.CylinderGeometry(0.05, 0.05, 0.02, 12), d[2], { p: [d[0], d[1], BZ(d[0], d[1]) + 0.012], r: [Math.PI / 2, 0, 0], ink: false }));
        part(rig, new T.SphereGeometry(0.5, 24, 12), beret, { p: [0.06, 1.74, 0], s: [1.15, 0.45, 1.15], r: [0, 0, -0.15] });
        part(rig, new T.CylinderGeometry(0.03, 0.03, 0.1, 8), beret, { p: [0.06, 1.97, 0], ink: false });
        [-1, 1].forEach((s) => {
          part(rig, new T.TorusGeometry(0.14, 0.03, 8, 24), '#1c1c1f', { p: [s * 0.2, 1.2, 0.53], ink: false });
          part(rig, new T.SphereGeometry(0.1, 10, 8), '#2a2420', { p: [s * 0.5, 1.4, 0], ink: false });
        });
        limb(rig, [0.52, 1.3, -0.04], [0.64, 1.74, -0.04], 0.035, pencil);
        part(rig, new T.ConeGeometry(0.035, 0.09, 8), '#e6c9a0', { p: [0.64, 1.78, -0.04], ink: false });
      },
      chef(rig, c, root) {
        const [white, scarf, btn, silver, fold] = c; setBody(root, white);
        [-1, 1].forEach((s) => [0.52, 0.34].forEach((y) => part(rig, new T.SphereGeometry(0.04, 10, 8), btn, { p: [s * 0.13, y, BZ(s * 0.13, y) + 0.015], ink: false })));
        part(rig, new T.BoxGeometry(0.014, 0.5, 0.02), fold, { p: [0, 0.42, BZ(0, 0.42) + 0.005], ink: false });
        ringE(rig, scarf, 0.43, 0.06, 0.66, 0.76);
        part(rig, new T.SphereGeometry(0.08, 10, 8), scarf, { p: [0, 0.6, BZ(0, 0.6) + 0.035], ink: false });
        [-1, 1].forEach((s) => part(rig, new T.BoxGeometry(0.06, 0.18, 0.02), scarf, { p: [s * 0.06, 0.48, BZ(s * 0.06, 0.48) + 0.025], r: [0, 0, s * 0.3], ink: false }));
        part(rig, new T.CylinderGeometry(0.4, 0.4, 0.22, 24), white, { p: [0, 1.8, 0] });
        part(rig, new T.CylinderGeometry(0.52, 0.4, 0.5, 24), white, { p: [0, 2.16, 0] });
        part(rig, new T.SphereGeometry(0.52, 20, 10), white, { p: [0, 2.4, 0], s: [1, 0.4, 1] });
        limb(rig, [0.6, 0.15, -0.3], [0.88, 1.5, -0.38], 0.03, silver);
        part(rig, new T.SphereGeometry(0.17, 16, 10), silver, { p: [0.9, 1.58, -0.38], s: [1, 0.55, 1], r: [0.5, 0, 0.2] });
        const dots = [scarf, btn, silver, scarf, silver].map((col) => part(rig, new T.SphereGeometry(0.04, 8, 8), col, { ink: false }));
        root.userData.tick = (t) => dots.forEach((d, k) => {
          const u = ((reduce() ? 0 : t * 0.5) + k * 0.2) % 1;
          d.position.set(0.9 + Math.sin(k * 2.4) * 0.2 + u * 0.1, 1.7 + u * 0.55, -0.38 + Math.cos(k * 1.7) * 0.15);
          d.scale.setScalar(1 - u * 0.6);
        });
      },
      courier(rig, c, root) {
        const [green, helmet, refl, white, visor] = c; setBody(root, green);
        ringE(rig, refl, 0.665, 0.04, 0.4, 0.76);
        [-1, 1].forEach((s) => part(rig, new T.BoxGeometry(0.08, 0.5, 0.03), '#1b1b1b', { p: [s * 0.24, 0.55, BZ(s * 0.24, 0.55) + 0.012], r: [0, 0, -s * 0.12], ink: false }));
        dome(rig, helmet, 0.6, 0.42);
        [-1, 1].forEach((s) => part(rig, new T.SphereGeometry(0.17, 12, 10), helmet, { p: [s * 0.5, 1.2, 0], s: [0.7, 1, 1] }));
        part(rig, new T.BoxGeometry(0.62, 0.07, 0.3), visor, { p: [0, 1.42, 0.5], r: [0.2, 0, 0], ink: false });
        const b1 = group(rig, [0, 0.55, -0.7]);
        part(b1, new T.BoxGeometry(0.74, 0.64, 0.56), green);
        part(b1, new T.BoxGeometry(0.76, 0.1, 0.58), white, { ink: false });
        const b2 = group(rig, [0.02, 1.08, -0.72], [0, 0.25, 0]);
        part(b2, new T.BoxGeometry(0.54, 0.32, 0.42), white);
        part(b2, new T.BoxGeometry(0.06, 0.33, 0.43), green, { ink: false });
      },
      farmer(rig, c, root) {
        const [straw, shirt, denim, scarf, wood, iron] = c; setBody(root, shirt);
        part(rig, new T.BoxGeometry(0.4, 0.46, 0.03), denim, { p: [0, 0.3, BZ(0, 0.3) + 0.012] });
        [-1, 1].forEach((s) => {
          part(rig, new T.BoxGeometry(0.08, 0.62, 0.03), denim, { p: [s * 0.17, 0.6, BZ(s * 0.17, 0.6) + 0.012], r: [0, 0, -s * 0.1], ink: false });
          part(rig, new T.SphereGeometry(0.03, 8, 8), '#d9b44a', { p: [s * 0.18, 0.5, BZ(s * 0.18, 0.5) + 0.03], ink: false });
        });
        part(rig, new T.BoxGeometry(0.2, 0.14, 0.03), shade(denim, 0.2), { p: [0, 0.24, BZ(0, 0.24) + 0.03], ink: false });
        ringE(rig, scarf, 0.43, 0.05, 0.66, 0.76);
        part(rig, new T.CylinderGeometry(0.95, 0.95, 0.05, 32), straw, { p: [0, 1.7, 0], r: [0.06, 0, 0.04] });
        part(rig, new T.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), straw, { p: [0, 1.7, 0] });
        part(rig, new T.CylinderGeometry(0.505, 0.505, 0.1, 24), scarf, { p: [0, 1.76, 0], ink: false });
        limb(rig, [0.42, 1.76, 0.3], [0.56, 2.1, 0.3], 0.012, '#d0a63a');
        part(rig, new T.SphereGeometry(0.04, 8, 8), '#e0b341', { p: [0.56, 2.14, 0.3], s: [1, 2.2, 1], ink: false });
        limb(rig, [-0.62, 0.0, -0.3], [-0.5, 1.7, -0.34], 0.035, wood);
        part(rig, new T.BoxGeometry(0.38, 0.08, 0.05), iron, { p: [-0.31, 1.7, -0.34] });
      },
    };

    function make(key) {
      const root = baseChar();
      BUILD[key](root.userData.rig, A.PRO[key].cos, root);
      root.userData.key = key;
      root.userData.phase = Math.random() * 6;
      return root;
    }
    function idle(root, t) {
      root.userData.rig.position.y = reduce() ? 0 : Math.abs(Math.sin(t * 2.4 + root.userData.phase)) * 0.035;
      if (root.userData.tick) root.userData.tick(t);
    }
    return { make, idle };
  };
})();
