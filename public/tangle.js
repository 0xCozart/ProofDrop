(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  // Skip on small screens / low-power devices entirely.
  if (window.innerWidth < 720) return;
  const lowMem = navigator.deviceMemory && navigator.deviceMemory <= 4;
  const lowCpu = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
  if (lowMem || lowCpu) return;

  const canvas = document.querySelector("canvas.tangle");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const NODE_COUNT = 32;
  const LINK_DIST = 140;
  const LINK_DIST_SQ = LINK_DIST * LINK_DIST;
  const SPEED = 0.16;
  const FPS_CAP = 30;
  const FRAME_MIN = 1000 / FPS_CAP;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

  let width = 0;
  let height = 0;
  let nodes = [];
  let last = 0;
  let running = true;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!nodes.length) seed();
  }

  function seed() {
    nodes = new Array(NODE_COUNT).fill(0).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * SPEED,
      vy: (Math.random() - 0.5) * SPEED,
    }));
  }

  function step(t) {
    if (!running) return;
    if (t - last < FRAME_MIN) {
      requestAnimationFrame(step);
      return;
    }
    last = t;

    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < -20) n.x = width + 20;
      else if (n.x > width + 20) n.x = -20;
      if (n.y < -20) n.y = height + 20;
      else if (n.y > height + 20) n.y = -20;
    }

    // Single-pass link draw with one batched stroke per alpha bucket
    // would be ideal, but keeping it readable: use a single solid stroke
    // colour. No per-link gradient (the previous hot path).
    ctx.lineWidth = 0.7;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < LINK_DIST_SQ) {
          const alpha = (1 - Math.sqrt(d2) / LINK_DIST) * 0.28;
          ctx.strokeStyle = `rgba(120, 200, 230, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // Nodes — solid fill, no shadowBlur (very expensive per frame).
    ctx.fillStyle = "rgba(120, 220, 230, 0.85)";
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      ctx.beginPath();
      ctx.arc(n.x, n.y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(step);
  }

  // Pause when tab is hidden.
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) {
      last = 0;
      requestAnimationFrame(step);
    }
  });

  // Debounced resize.
  let rid = 0;
  window.addEventListener(
    "resize",
    () => {
      cancelAnimationFrame(rid);
      rid = requestAnimationFrame(resize);
    },
    { passive: true },
  );

  resize();
  requestAnimationFrame(step);
})();
