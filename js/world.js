/*
 * 世界地圖幾何：三個人生階段各一圈，放在同一張大地圖上
 * 每圈是「不規則的封閉曲線」：以橢圓為底，疊加幾道正弦波讓邊緣起伏，
 * 再依弧長把格子平均排在曲線上。形狀參數固定，每次開遊戲地圖都一樣。
 */
(function () {
  // cx, cy：圈的中心；R：基準半徑；sx, sy：橫向／縱向拉伸；waves：[頻率, 幅度, 相位]
  const SHAPES = {
    youth: { cx: 900, cy: 900, R: 640, sx: 1.12, sy: 0.92, waves: [[2, 0.1, 0.6], [3, 0.07, 1.9], [5, 0.035, 0.3]] },
    middle: { cx: 2650, cy: 820, R: 640, sx: 0.95, sy: 1.08, waves: [[2, 0.09, 2.4], [3, 0.08, 0.2], [4, 0.04, 1.1]] },
    elder: { cx: 1750, cy: 2380, R: 640, sx: 1.18, sy: 0.88, waves: [[2, 0.07, 1.2], [3, 0.09, 2.8], [5, 0.04, 2.2]] },
  };
  const MARGIN = 220; // 地圖四周留白
  const SAMPLES = 1440;

  function radius(shape, theta) {
    return shape.R * (1 + shape.waves.reduce((sum, [k, a, phi]) => sum + a * Math.sin(k * theta + phi), 0));
  }

  function pointAt(shape, theta) {
    const r = radius(shape, theta);
    return { x: shape.cx + r * shape.sx * Math.cos(theta), y: shape.cy + r * shape.sy * Math.sin(theta) };
  }

  const angleTo = (from, to) => Math.atan2(to.cy - from.cy, to.cx - from.cx);

  // 起點朝向相鄰的圈，讓「換圈」的連接路線最短
  function startAngle(order, i) {
    const me = SHAPES[order[i]];
    const prev = SHAPES[order[i - 1]];
    const next = SHAPES[order[i + 1]];
    if (prev && next) {
      const a = angleTo(me, prev);
      const b = angleTo(me, next);
      return Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
    }
    return angleTo(me, next || prev);
  }

  // 沿曲線取樣，依弧長平均放置 count 個格子（順時針前進）
  function buildLoop(shape, theta0, count) {
    const samples = [];
    for (let i = 0; i <= SAMPLES; i++) samples.push(pointAt(shape, theta0 + (i / SAMPLES) * Math.PI * 2));
    const lengths = [0];
    for (let i = 1; i < samples.length; i++) {
      lengths.push(lengths[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
    }
    const total = lengths[lengths.length - 1];
    const points = [];
    let j = 1;
    for (let t = 0; t < count; t++) {
      const target = (t / count) * total;
      while (lengths[j] < target) j++;
      const k = (target - lengths[j - 1]) / (lengths[j] - lengths[j - 1] || 1);
      points.push({
        x: samples[j - 1].x + (samples[j].x - samples[j - 1].x) * k,
        y: samples[j - 1].y + (samples[j].y - samples[j - 1].y) * k,
      });
    }
    const step = Math.max(1, Math.round(SAMPLES / 240));
    const outline = samples.filter((_, i) => i % step === 0);
    return { points, outline, spacing: total / count };
  }

  function bboxOf(pts, pad = 0) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
  }

  const pathOf = (pts) => 'M' + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L') + 'Z';

  // 回傳 { width, height, loops: { [stageId]: { points, path, center, bbox } }, bridges: [{ from, to, d }] }
  function build(order, count) {
    const raw = {};
    order.forEach((id, i) => { raw[id] = buildLoop(SHAPES[id], startAngle(order, i), count); });

    // 平移到正座標並留白
    const all = bboxOf(order.flatMap((id) => raw[id].outline));
    const dx = MARGIN - all.x;
    const dy = MARGIN - all.y;
    const shift = (p) => ({ x: p.x + dx, y: p.y + dy });

    const loops = {};
    order.forEach((id) => {
      const points = raw[id].points.map(shift);
      const outline = raw[id].outline.map(shift);
      loops[id] = {
        points,
        path: pathOf(outline),
        center: { x: SHAPES[id].cx + dx, y: SHAPES[id].cy + dy },
        bbox: bboxOf(outline, 120),
        spacing: raw[id].spacing,
      };
    });

    // 相鄰兩圈的起點以弧線相連
    const bridges = order.slice(0, -1).map((id, i) => {
      const a = loops[id].points[0];
      const b = loops[order[i + 1]].points[0];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const bend = len * 0.25;
      const cx = mx + (-(b.y - a.y) / len) * bend;
      const cy = my + ((b.x - a.x) / len) * bend;
      return { from: id, to: order[i + 1], d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`, mid: { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 } };
    });

    return { width: all.w + MARGIN * 2, height: all.h + MARGIN * 2, loops, bridges, bbox: { x: 0, y: 0, w: all.w + MARGIN * 2, h: all.h + MARGIN * 2 } };
  }

  window.GameWorld = { build };
})();
