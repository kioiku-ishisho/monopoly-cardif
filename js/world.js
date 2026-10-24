/*
 * 地圖幾何：三個人生階段共用一圈
 * 這一圈是「不規則的封閉曲線」：以橢圓為底，疊加幾道正弦波讓邊緣起伏，
 * 再依弧長把格子平均排在曲線上。形狀參數固定，每次開遊戲地圖都一樣。
 */
(function () {
  // cx, cy：圈的中心；R：基準半徑；sx, sy：橫向／縱向拉伸；waves：[頻率, 幅度, 相位]
  const SHAPE = { cx: 0, cy: 0, R: 640, sx: 1.12, sy: 0.92, waves: [[2, 0.1, 0.6], [3, 0.07, 1.9], [5, 0.035, 0.3]] };
  // 整體放大倍率：圈越大，格子間距越大（1.3 倍時約 90px），格子才能做大
  SHAPE.R *= 1.3;
  const START_ANGLE = -Math.PI / 2; // 起點在圈的正上方
  const MARGIN = 240; // 地圖四周留白
  const SAMPLES = 1440;

  function radius(shape, theta) {
    return shape.R * (1 + shape.waves.reduce((sum, [k, a, phi]) => sum + a * Math.sin(k * theta + phi), 0));
  }

  function pointAt(shape, theta) {
    const r = radius(shape, theta);
    return { x: shape.cx + r * shape.sx * Math.cos(theta), y: shape.cy + r * shape.sy * Math.sin(theta) };
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

  // 回傳 { width, height, bbox, points, path, center, spacing }
  function build(count) {
    const raw = buildLoop(SHAPE, START_ANGLE, count);
    // 平移到正座標並留白
    const box = bboxOf(raw.outline);
    const dx = MARGIN - box.x;
    const dy = MARGIN - box.y;
    const shift = (p) => ({ x: p.x + dx, y: p.y + dy });
    const width = box.w + MARGIN * 2;
    const height = box.h + MARGIN * 2;
    return {
      width,
      height,
      bbox: { x: 0, y: 0, w: width, h: height },
      points: raw.points.map(shift),
      path: pathOf(raw.outline.map(shift)),
      center: { x: SHAPE.cx + dx, y: SHAPE.cy + dy },
      spacing: raw.spacing,
    };
  }

  window.GameWorld = { build };
})();
