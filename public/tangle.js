(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  const canvas = document.querySelector("canvas.tangle");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const NODE_COUNT = 64;
  const LINK_DIST = 170;
  const SPEED = 0.18;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let width = 0;
  let height = 0;
  let nodes = [];
  let pointer = { x: -9999, y: -9999, active: false };

  function resize() {
    width = canvas.clientWidth = window.innerWidth;
    height = canvas.clientHeight = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    nodes = new Array(NODE_COUNT).fill(0).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * SPEED,
      vy: (Math.random() - 0.5) * SPEED,
      r: Math.random() * 1.4 + 0.6,
      hue: Math.random() < 0.5 ? "teal" : "indigo",
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function step(t) {
    ctx.clearRect(0, 0, width, height);

    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < -20) n.x = width + 20;
      if (n.x > width + 20) n.x = -20;
      if (n.y < -20) n.y = height + 20;
      if (n.y > height + 20) n.y = -20;

      if (pointer.active) {
        const dx = n.x - pointer.x;
        const dy = n.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 200 * 200) {
          const f = (1 - Math.sqrt(d2) / 200) * 0.4;
          n.vx += (dx / Math.sqrt(d2 || 1)) * f * 0.04;
          n.vy += (dy / Math.sqrt(d2 || 1)) * f * 0.04;
        }
      }

      // gentle damping
      n.vx *= 0.995;
      n.vy *= 0.995;
      // re-energize so it doesn't stall
      if (Math.abs(n.vx) < 0.04) n.vx += (Math.random() - 0.5) * 0.06;
      if (Math.abs(n.vy) < 0.04) n.vy += (Math.random() - 0.5) * 0.06;
    }

    // links
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < LINK_DIST) {
          const alpha = (1 - d / LINK_DIST) * 0.35;
          const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          grad.addColorStop(0, `rgba(94, 234, 212, ${alpha})`);
          grad.addColorStop(1, `rgba(99, 102, 241, ${alpha})`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // nodes
    for (const n of nodes) {
      const pulse = 0.5 + 0.5 * Math.sin(t / 700 + n.phase);
      const r = n.r + pulse * 0.6;
      const color =
        n.hue === "teal"
          ? `rgba(94, 234, 212, ${0.55 + pulse * 0.35})`
          : `rgba(99, 102, 241, ${0.5 + pulse * 0.35})`;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    requestAnimationFrame(step);
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener(
    "pointermove",
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    },
    { passive: true },
  );
  window.addEventListener("pointerleave", () => {
    pointer.active = false;
  });

  resize();
  requestAnimationFrame(step);
})();
