import { useEffect, useRef } from "react";
import { useTheme } from "../../contexts/ThemeContext";

// Pre-baked color palette (avoid per-frame string concat)
const ZONE_COLORS: [number, number, number][] = [
  [30, 100, 255], [40, 30, 200], [180, 0, 210], [255, 10, 80],
  [255, 40, 30], [255, 180, 0], [0, 200, 80], [30, 100, 255],
];
const N_ZONES = ZONE_COLORS.length - 1;

// Optimized: reduced particle count, skip DPR for background
const DOT_SPACING = 55;
const CURSOR_RADIUS_MIN = 650;
const CURSOR_RADIUS_MAX = 1100;
const PUSH_STRENGTH = 40;
const SPRING = 0.032;
const DAMPING = 0.83;
const DRIFT_AMP = 5;
const DRIFT_SPEED = 0.6;
const WAVE_AMP = 14;
const WAVE_SPEED = 2.5;
const WAVE_SCALE = 0.015;

export function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { isDark } = useTheme();
  const darkRef = useRef(isDark);
  darkRef.current = isDark;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let animationId: number;
    let w = 0, h = 0;

    // Flat typed arrays for hot loop performance
    let hx: Float32Array, hy: Float32Array;
    let px: Float32Array, py: Float32Array;
    let vx: Float32Array, vy: Float32Array;
    let phase: Float32Array, driftFreq: Float32Array;
    let driftAmpX: Float32Array, driftAmpY: Float32Array;
    // Pre-baked per-particle color as rgb string (updated every ~30 frames)
    let colors: string[];
    let count = 0;
    let colorFrame = 0;

    const mouse = { x: -9999, y: -9999 };
    const smooth = { x: -9999, y: -9999 };

    function createDots() {
      const cols = Math.ceil(w / DOT_SPACING) + 2;
      const rows = Math.ceil(h / DOT_SPACING) + 2;
      count = cols * rows;
      hx = new Float32Array(count); hy = new Float32Array(count);
      px = new Float32Array(count); py = new Float32Array(count);
      vx = new Float32Array(count); vy = new Float32Array(count);
      phase = new Float32Array(count); driftFreq = new Float32Array(count);
      driftAmpX = new Float32Array(count); driftAmpY = new Float32Array(count);
      colors = new Array(count);

      let idx = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const jx = (Math.random() - 0.5) * DOT_SPACING * 0.4;
          const jy = (Math.random() - 0.5) * DOT_SPACING * 0.4;
          const x0 = c * DOT_SPACING + jx, y0 = r * DOT_SPACING + jy;
          hx[idx] = x0; hy[idx] = y0;
          px[idx] = x0; py[idx] = y0;
          vx[idx] = 0; vy[idx] = 0;
          phase[idx] = Math.random() * Math.PI * 2;
          driftFreq[idx] = DRIFT_SPEED + (Math.random() - 0.5) * 0.3;
          driftAmpX[idx] = DRIFT_AMP * (0.5 + Math.random());
          driftAmpY[idx] = DRIFT_AMP * (0.5 + Math.random());
          colors[idx] = "rgb(128,128,128)";
          idx++;
        }
      }
      colorFrame = 999; // force color update on first frame
    }

    function updateColors(time: number) {
      for (let i = 0; i < count; i++) {
        const x = hx[i], y = hy[i];
        const s1 = Math.sin(x * 0.003 + time * 1.2) * Math.cos(y * 0.004 - time * 0.95);
        const s2 = Math.sin(y * 0.0035 + time * 1.4 + 2) * Math.cos(x * 0.0025 + time * 0.85);
        const s3 = Math.sin((x + y) * 0.002 - time * 0.7);
        const t = ((s1 + s2 + s3) / 3 * 0.5 + 0.5);
        const idx = Math.min(t * N_ZONES | 0, N_ZONES - 1);
        const f = t * N_ZONES - idx;
        const a = ZONE_COLORS[idx], b = ZONE_COLORS[idx + 1];
        colors[i] = `rgb(${a[0] + (b[0] - a[0]) * f | 0},${a[1] + (b[1] - a[1]) * f | 0},${a[2] + (b[2] - a[2]) * f | 0})`;
      }
    }

    function resize() {
      // Skip DPR for background canvas — 1x is fine
      w = window.innerWidth; h = window.innerHeight;
      canvas!.width = w; canvas!.height = h;
      canvas!.style.width = w + "px"; canvas!.style.height = h + "px";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      createDots();
    }

    function onMouse(e: MouseEvent) { mouse.x = e.clientX; mouse.y = e.clientY; }
    function onLeave() { mouse.x = -9999; mouse.y = -9999; }

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMouse, { passive: true });
    document.addEventListener("mouseleave", onLeave);

    const t0 = performance.now();

    function frame() {
      if (document.visibilityState !== "visible") { animationId = requestAnimationFrame(frame); return; }

      const time = (performance.now() - t0) * 0.001;

      if (darkRef.current) {
        ctx.fillStyle = "#060810";
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.clearRect(0, 0, w, h);
      }

      smooth.x += (mouse.x - smooth.x) * 0.12;
      smooth.y += (mouse.y - smooth.y) * 0.12;
      const mx = smooth.x, my = smooth.y;

      // Pulsing radius (simplified — fewer sin calls)
      const rPulse = Math.sin(time * 1.4) * 0.25 + Math.sin(time * 2.265) * 0.18;
      const mouseVx = mouse.x - smooth.x, mouseVy = mouse.y - smooth.y;
      const speedBoost = Math.min(Math.sqrt(mouseVx * mouseVx + mouseVy * mouseVy) * 0.8, 150);
      const radiusT = Math.max(0, Math.min(1, 0.5 + rPulse));
      const CURSOR_RADIUS = CURSOR_RADIUS_MIN + (CURSOR_RADIUS_MAX - CURSOR_RADIUS_MIN) * radiusT + speedBoost;
      const rSq = CURSOR_RADIUS * CURSOR_RADIUS;
      const invR = 1 / CURSOR_RADIUS;

      // Update colors every 20 frames (~3x per second)
      colorFrame++;
      if (colorFrame >= 20) { updateColors(time); colorFrame = 0; }

      const scx = w * 0.5, scy = h * 0.5;
      const anchorX = mx > -5000 ? mx : scx;
      const anchorY = my > -5000 ? my : scy;
      const breathS = Math.sin(time * 0.35) * 0.01;

      for (let i = 0; i < count; i++) {
        const hxi = hx[i], hyi = hy[i];

        // Drift + wave (inlined, reduced trig)
        const tf = time * driftFreq[i], ph = phase[i];
        const dX = Math.sin(tf + ph) * driftAmpX[i] + Math.sin(tf * 1.7 + ph * 3.1) * driftAmpX[i] * 0.35;
        const dY = Math.cos(tf * 0.7 + ph + 2.1) * driftAmpY[i] + Math.cos(tf * 1.3 + ph * 2.3) * driftAmpY[i] * 0.35;
        const wp1 = hxi * WAVE_SCALE + time * WAVE_SPEED;
        const wp2 = hyi * WAVE_SCALE * 1.3 - time * WAVE_SPEED * 0.6;
        const wX = Math.sin(wp1) * WAVE_AMP + Math.sin(wp2) * WAVE_AMP * 0.4;
        const wY = Math.cos(wp1 * 0.8 + 1.5) * WAVE_AMP + Math.cos(wp2 * 0.6) * WAVE_AMP * 0.4;

        const homeX = hxi + dX + wX + (hxi - scx) * breathS;
        const homeY = hyi + dY + wY + (hyi - scy) * breathS;

        // Spring toward home
        let dvx = vx[i] + (homeX - px[i]) * SPRING;
        let dvy = vy[i] + (homeY - py[i]) * SPRING;

        // Cursor push
        const dxM = px[i] - mx, dyM = py[i] - my;
        const distSq = dxM * dxM + dyM * dyM;
        if (distSq < rSq && distSq > 1) {
          const invDist = 1 / Math.sqrt(distSq);
          const norm = 1 - Math.sqrt(distSq) * invR;
          const push = norm * norm * PUSH_STRENGTH * 0.06;
          dvx += dxM * invDist * push;
          dvy += dyM * invDist * push;
        }

        dvx *= DAMPING; dvy *= DAMPING;
        vx[i] = dvx; vy[i] = dvy;
        px[i] += dvx; py[i] += dvy;

        // Visibility check — skip drawing if outside radius
        const dist = Math.sqrt(distSq);
        const proximity = dist < CURSOR_RADIUS ? 1 - dist * invR : 0;
        if (proximity <= 0) continue;

        // Drawing — use setTransform instead of save/translate/rotate/restore
        const angle = Math.atan2(anchorY - py[i], anchorX - px[i]);
        const cosA = Math.cos(angle), sinA = Math.sin(angle);
        const alpha = Math.min(proximity * 1.3, 1);
        const distNorm = dist * invR;
        const growFactor = distNorm * distNorm;
        const sizeScale = 0.3 + growFactor * 1.8;

        const spd = Math.sqrt(dvx * dvx + dvy * dvy);
        const radialWave = Math.sin(dist * 0.06 - time * 1.4) * 0.5 + 0.5;
        const sweepAngle = Math.atan2(py[i] - my, px[i] - mx);
        const sweepWave = Math.sin(sweepAngle * 2 + time * 0.6) * 0.5 + 0.5;
        const blobWave = Math.sin(hxi * 0.008 + time * 0.44) * Math.cos(hyi * 0.007 + time * 0.36) * 0.5 + 0.5;
        const waveFactor = 0.15 + (radialWave * 0.35 + sweepWave * 0.35 + blobWave * 0.3) * 3.2;
        const stretchAmount = 6 * waveFactor + Math.min(spd * 4, 10);
        const halfA = Math.max(stretchAmount * 0.5 * sizeScale, 1.5);
        const halfB = Math.max((5 * sizeScale) / (1 + stretchAmount * 0.1), 1.5);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = colors[i];
        // setTransform is ~3x faster than save/translate/rotate/restore
        ctx.setTransform(cosA, sinA, -sinA, cosA, px[i], py[i]);
        ctx.beginPath();
        ctx.ellipse(0, 0, halfA, halfB, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      animationId = requestAnimationFrame(frame);
    }

    resize();
    frame();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouse);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" />;
}
