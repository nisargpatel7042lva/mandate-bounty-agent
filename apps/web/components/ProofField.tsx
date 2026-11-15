"use client";

import { useEffect, useRef } from "react";

/**
 * The hero's particle field. Points start scattered across the screen and settle onto a tilted,
 * slowly turning torus (the vault), the way scattered claims converge into one proof. The cursor
 * pushes and swirls nearby points; they drift back onto the ring within a second or two.
 * Canvas 2D with additive blending: no WebGL or library, ~1-2 ms per frame for 9k points.
 */
export function ProofField({ className = "hero-canvas" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = matchMedia("(max-width: 760px)").matches;
    const N = small ? 3800 : 9000;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // per particle: torus angles, tube radius, screen position and velocity, a random seed
    const U = new Float32Array(N), V = new Float32Array(N), R = new Float32Array(N), SPD = new Float32Array(N);
    const X = new Float32Array(N), Y = new Float32Array(N), VX = new Float32Array(N), VY = new Float32Array(N);
    const Z = new Float32Array(N), SEED = new Float32Array(N);
    const SEAL = new Uint8Array(N), ORBIT = new Uint8Array(N);

    let W = 0, H = 0, cx = 0, cy = 0, scale = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const wide = W > 1100;
      cx = wide ? W * 0.6 : W * 0.5;
      cy = small ? H * 0.34 : H * 0.44;
      scale = Math.min(W, H) * (small ? 0.36 : wide ? 0.42 : 0.4);
    };
    resize();

    for (let i = 0; i < N; i++) {
      U[i] = Math.random() * Math.PI * 2;
      V[i] = Math.random() * Math.PI * 2;
      // 84% sit on a slim tube's skin (the vault ring); 16% trace a fine outer orbit for depth
      ORBIT[i] = Math.random() < 0.16 ? 1 : 0;
      R[i] = ORBIT[i] ? 0.012 * Math.random() : Math.random() < 0.85 ? 0.105 + Math.random() * 0.02 : Math.random() * 0.1;
      SPD[i] = 0.4 + Math.random() * 1.2;
      SEED[i] = Math.random();
      SEAL[i] = Math.random() < 0.035 ? 1 : 0;
      X[i] = Math.random() * W;
      Y[i] = Math.random() * H;
    }

    const mouse = { x: -9999, y: -9999, px: -9999, py: -9999, speed: 0 };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const onLeave = () => {
      mouse.x = mouse.y = -9999;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", resize);

    // colour buckets: draw each with one fillStyle, cheaper than per-point styles
    const BUCKETS = ["rgba(243,241,236,0.14)", "rgba(243,241,236,0.3)", "rgba(243,241,236,0.55)", "rgba(243,241,236,0.9)"];
    const SEAL_STYLE = "rgba(255,91,46,0.95)";

    let t = 0;
    let raf = 0;
    let running = true;

    const step = (dt: number) => {
      t += dt;
      // ring orientation: a fixed tilt, a slow turn, a small breathing wobble
      const tilt = 1.08 + Math.sin(t * 0.21) * 0.05;
      const yaw = t * 0.12;
      const ct = Math.cos(tilt), st = Math.sin(tilt), cyw = Math.cos(yaw), syw = Math.sin(yaw);
      const persp = 3.4;

      const mvx = mouse.x - mouse.px, mvy = mouse.y - mouse.py;
      const msp = Math.min(60, Math.hypot(mvx, mvy));
      mouse.speed += (msp - mouse.speed) * 0.25;
      mouse.px = mouse.x;
      mouse.py = mouse.y;
      const radius = 70 + mouse.speed * 4;
      // time-based, so the ring forms in ~1.5 s at any frame rate: a pull rate per second, ramped up on load
      const k = 1.8 + Math.min(1, t / 1.6) * 3.6;
      const ease = 1 - Math.exp(-k * dt);
      const damp = Math.pow(0.9, dt * 60);

      for (let i = 0; i < N; i++) {
        const u = (U[i] as number) + 0.0016 * (SPD[i] as number) * dt * 60;
        U[i] = u;
        const r = R[i] as number;
        const v = (V[i] as number) + Math.sin(t * 0.6 + (SEED[i] as number) * 6.28) * 0.15;
        const ring = (ORBIT[i] ? 1.48 : 1) + r * Math.cos(v);
        const x0 = ring * Math.cos(u), y0 = ring * Math.sin(u), z0 = r * Math.sin(v);
        // tilt around X, then yaw around Y
        const y = y0 * ct - z0 * st, z1 = y0 * st + z0 * ct;
        const x = x0 * cyw + z1 * syw, z = -x0 * syw + z1 * cyw;
        const p = persp / (persp - z);
        const tx = cx + x * scale * p, ty = cy + y * scale * p;
        Z[i] = z;

        // cursor: push out and swirl, stronger when the cursor moves fast
        const px = X[i] as number, py = Y[i] as number;
        let vx = (VX[i] as number) * damp, vy = (VY[i] as number) * damp;
        const dx = px - mouse.x, dy = py - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < radius * radius) {
          const d = Math.sqrt(d2) || 1, f = (1 - d / radius) * (0.6 + mouse.speed * 0.06);
          vx += (dx / d) * f * 1.6 + (-dy / d) * f * 1.1 + mvx * f * 0.05;
          vy += (dy / d) * f * 1.6 + (dx / d) * f * 1.1 + mvy * f * 0.05;
        }
        VX[i] = vx;
        VY[i] = vy;
        X[i] = px + (tx - px) * ease + vx;
        Y[i] = py + (ty - py) * ease + vy;
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      for (let b = 0; b < BUCKETS.length; b++) {
        ctx.fillStyle = BUCKETS[b] as string;
        for (let i = 0; i < N; i++) {
          if (SEAL[i]) continue;
          // depth (z in roughly -0.3..1.3 after tilt) picks brightness and size
          const zb = Math.max(0, Math.min(3, Math.floor(((Z[i] as number) + 1.1) * 1.55)));
          if (zb !== b) continue;
          const s = 0.7 + zb * 0.32;
          ctx.fillRect(X[i] as number, Y[i] as number, s, s);
        }
      }
      ctx.fillStyle = SEAL_STYLE;
      for (let i = 0; i < N; i++) {
        if (!SEAL[i]) continue;
        const s = 1.4 + Math.max(0, Z[i] as number) * 1.2;
        ctx.fillRect(X[i] as number, Y[i] as number, s, s);
      }
      ctx.globalCompositeOperation = "source-over";
    };

    if (reduce) {
      // settle instantly and paint one still frame
      for (let k = 0; k < 240; k++) step(1 / 60);
      for (let i = 0; i < N; i++) {
        VX[i] = VY[i] = 0;
      }
      draw();
    } else {
      let last = performance.now();
      const loop = (now: number) => {
        const dt = Math.min(0.25, (now - last) / 1000);
        last = now;
        if (running) {
          step(dt);
          draw();
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    // stop work when the hero is off screen or the tab is hidden
    const io = new IntersectionObserver(([e]) => {
      running = !!e?.isIntersecting && !document.hidden;
    });
    io.observe(canvas);
    const onVis = () => {
      running = !document.hidden;
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
