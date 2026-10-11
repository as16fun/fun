// The Brand Brain sphere: creative work arranged on a rotating sphere of tiles.
// It turns on its own, spins with a drag (with inertia) and with the page scroll, pauses off screen,
// and stays still with reduced motion. Local tiles come from one sprite, so it also works offline;
// remote tiles (data-tiles) replace some of them as they load.

export function initSphere(stage) {
  const canvas = stage.querySelector('canvas');
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const remote = (stage.dataset.tiles ?? '').split(/\s+/).filter(Boolean);
  const TILE = 240;
  let localCount = 12;

  const sprite = new Image();
  let spriteReady = false;
  sprite.onload = () => {
    spriteReady = true;
    localCount = Math.max(1, Math.round(sprite.naturalWidth / sprite.naturalHeight));
    draw();
  };
  if (stage.dataset.sprite) sprite.src = stage.dataset.sprite;

  // A Fibonacci sphere spreads the tiles evenly.
  const N = 44;
  const tiles = [];
  let ri = 0;
  for (let i = 0; i < N; i++) {
    const y = 1 - ((i + 0.5) / N) * 2;
    const r = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    const tile = { x: Math.cos(phi) * r, y, z: Math.sin(phi) * r, local: i, img: null };
    if (i % 3 !== 2 && ri < remote.length) {
      const im = new Image();
      im.onload = () => { tile.img = im; draw(); };
      im.src = remote[ri++];
    }
    tiles.push(tile);
  }

  let rotY = 0.4;
  let rotX = -0.32;
  const AUTO = reduce ? 0 : 0.0032;
  let vel = AUTO;
  let W = 0;
  let H = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = stage.clientWidth;
    H = stage.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function roundRect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function draw() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W * 0.34, H * 0.34);
    const base = R * 0.33;
    const D = 2.8;
    const cyR = Math.cos(rotY);
    const syR = Math.sin(rotY);
    const cxR = Math.cos(rotX);
    const sxR = Math.sin(rotX);
    const list = tiles.map((t) => {
      const x1 = t.x * cyR + t.z * syR;
      const z1 = -t.x * syR + t.z * cyR;
      return { t, x: x1, y: t.y * cxR - z1 * sxR, z: t.y * sxR + z1 * cxR };
    }).sort((a, b) => a.z - b.z);
    for (const p of list) {
      const s = D / (D - p.z);
      const w = base * s * Math.max(0.28, Math.sqrt(1 - p.x * p.x));
      const h = base * s * Math.max(0.28, Math.sqrt(1 - p.y * p.y));
      const px = cx + p.x * R * s - w / 2;
      const py = cy + p.y * R * s - h / 2;
      ctx.globalAlpha = p.z < 0 ? 0.12 + (p.z + 1) * 0.25 : 0.55 + p.z * 0.45;
      ctx.save();
      roundRect(px, py, w, h, Math.max(4, 10 * s));
      ctx.clip();
      if (p.t.img) ctx.drawImage(p.t.img, px, py, w, h);
      else if (spriteReady) ctx.drawImage(sprite, (p.t.local % localCount) * TILE, 0, TILE, TILE, px, py, w, h);
      else { ctx.fillStyle = '#e4e9dd'; ctx.fillRect(px, py, w, h); }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // Drag with inertia
  let dragging = false;
  let lastX = 0;
  let lastT = 0;
  stage.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastT = performance.now();
    vel = 0;
    stage.classList.add('is-dragging');
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const now = performance.now();
    rotY += dx * 0.006;
    vel = ((dx * 0.006) / Math.max(16, now - lastT)) * 16;
    lastX = e.clientX;
    lastT = now;
    if (reduce) draw();
  });
  const end = () => { dragging = false; stage.classList.remove('is-dragging'); };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  // The page scroll nudges the rotation.
  let visible = true;
  let lastScroll = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const d = y - lastScroll;
    lastScroll = y;
    if (!visible) return;
    rotY += d * 0.0025;
    rotX = Math.max(-0.7, Math.min(0.2, rotX + d * 0.0006));
    if (reduce) draw();
  }, { passive: true });

  let raf = null;
  function loop() {
    if (!dragging) { vel += (AUTO - vel) * 0.03; rotY += vel; }
    draw();
    raf = visible && !reduce ? requestAnimationFrame(loop) : null;
  }
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible && !raf && !reduce) raf = requestAnimationFrame(loop);
  }).observe(stage);
  new ResizeObserver(resize).observe(stage);
  resize();
  if (!reduce) raf = requestAnimationFrame(loop);
}
