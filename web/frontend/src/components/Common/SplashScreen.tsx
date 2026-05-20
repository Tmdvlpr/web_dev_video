import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";

interface SplashScreenProps {
  onFinish: () => void;
  userName?: string | null;
}

const WORD = "CORPMEET";
const ACCENT_FROM = 4;
const BRAND = "#1565a8";

// Square with straight top-right corner, rx=24 on the other three corners
// Using SVG arc commands (A) instead of quadratic beziers (Q) for pixel-perfect circular corners
const BG_PATH =
  "M 24 0 L 183.477 0 L 183.477 159.476 A 24 24 0 0 1 159.477 183.476 L 24 183.476 A 24 24 0 0 1 0 159.476 L 0 24 A 24 24 0 0 1 24 0 Z";

const WING1 =
  "M183.477 -0.000213652H24.1003C10.8448 -0.000213652 0 10.8442 0 24.1002V29.4577C4.35965 30.1241 9.2007 31.4108 14.4453 33.2707C30.9597 39.1299 51.5212 50.7097 73.5983 66.6973C91.5408 53.3303 108.051 43.7672 121.444 39.0204C134.526 34.3831 144.68 34.3293 150.36 39.7837C156.794 45.9587 156.535 58.3064 150.797 74.4786C144.935 90.9937 133.356 111.555 117.37 133.632C130.738 151.575 140.298 168.087 145.045 181.48C145.286 182.154 145.511 182.818 145.725 183.476H159.377C172.632 183.476 183.477 172.634 183.477 159.378V-0.000213652Z";

const WING2 =
  "M0 101.189V159.376C0 168.393 5.01728 176.29 12.3973 180.42C18.0218 180.586 24.8281 179.206 32.5683 176.422C48.3471 170.754 67.9784 159.273 89.4463 143.198C89.6156 143.069 89.8609 143.105 89.9921 143.275C90.1104 143.434 90.0894 143.658 89.949 143.793C83.9014 149.56 77.876 155.016 71.9314 160.131C65.8788 165.336 59.906 170.191 54.0732 174.655L54.0705 174.658L50.6656 177.231L50.6641 177.232L50.6599 177.235L50.6572 177.237C47.73 179.421 44.8397 181.502 41.9898 183.475H116.387C121.896 177.132 121.584 165.949 116.392 151.497C110.722 135.719 99.2405 116.088 83.1656 94.6182C83.0359 94.4481 83.071 94.2006 83.2423 94.0716C83.4017 93.9534 83.6256 93.9747 83.7592 94.1147H83.7611C89.5271 100.163 94.9865 106.19 100.101 112.134C105.16 118.017 109.887 123.825 114.25 129.503C121.803 114.774 126.675 101.709 128.415 91.1596C130.095 80.9622 128.849 73.1332 124.268 68.4527C118.097 62.1511 106.564 62.2476 91.463 67.6745C75.6841 73.3441 56.0556 84.8229 34.5862 100.899C34.4156 101.028 34.1715 100.994 34.0391 100.821C33.9217 100.663 33.943 100.438 34.0842 100.305H34.083C40.1287 94.5412 46.1515 89.0841 52.0938 83.9737C57.9766 78.9107 63.7907 74.1829 69.4702 69.8191C54.7411 62.2655 41.6766 57.3913 31.1279 55.6515C20.9285 53.9692 13.1007 55.2151 8.42024 59.7979C2.11631 65.9691 2.21587 77.5024 7.64207 92.6007C13.3097 108.38 24.7911 128.011 40.8664 149.476C40.9965 149.648 40.9587 149.894 40.7867 150.023C40.6299 150.143 40.4056 150.122 40.2706 149.979V149.982C34.5064 143.936 29.052 137.913 23.9397 131.971C18.7325 125.916 13.8754 119.941 9.4105 114.105L9.40821 114.104L6.83453 110.699L6.83148 110.697L6.83034 110.692L6.8269 110.69C4.42679 107.474 2.15065 104.304 0 101.189Z";

export function SplashScreen({ onFinish, userName }: SplashScreenProps) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);
  const [revealed, setRevealed] = useState(0);

  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const strokeP1Ref = useRef<SVGPathElement>(null);
  const strokeP2Ref = useRef<SVGPathElement>(null);
  const fillP1Ref = useRef<SVGPathElement>(null);
  const fillP2Ref = useRef<SVGPathElement>(null);
  const squareFillRef = useRef<SVGElement>(null);
  const squareBaseRef = useRef<SVGPathElement>(null);
  const sparksCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafIdRef = useRef<number | undefined>(undefined);

  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const play = useCallback(() => {
    const svg = svgRef.current;
    const g = groupRef.current;
    const sp1 = strokeP1Ref.current;
    const sp2 = strokeP2Ref.current;
    const fp1 = fillP1Ref.current;
    const fp2 = fillP2Ref.current;
    const sqFill = squareFillRef.current;
    const sqBase = squareBaseRef.current;
    if (!svg || !g || !sp1 || !sp2 || !fp1 || !fp2 || !sqFill || !sqBase) return;

    // Set initial state while SVG is still hidden
    g.style.transition = "none";
    g.style.transform = "scale(0.82)";
    sqFill.style.transition = "none";
    sqFill.style.opacity = "0";
    sqBase.style.transition = "none";
    sqBase.style.opacity = "0";
    [fp1, fp2].forEach((p) => { p.style.transition = "none"; p.style.opacity = "0"; });

    const l1 = sp1.getTotalLength();
    const l2 = sp2.getTotalLength();
    sp1.style.transition = "none";
    sp1.style.strokeDasharray = String(l1);
    sp1.style.strokeDashoffset = String(l1);
    sp1.style.opacity = "1";
    sp2.style.transition = "none";
    sp2.style.strokeDasharray = String(l2);
    sp2.style.strokeDashoffset = String(l2);
    sp2.style.opacity = "1";

    void g.getBBox(); // force reflow

    // ── Welder sparks canvas (synced with wing stroke draws) ─────────────
    const sparksCanvas = sparksCanvasRef.current;
    if (sparksCanvas) {
      const ctx = sparksCanvas.getContext("2d");
      if (ctx) {
        const CW = sparksCanvas.width;
        const CH = sparksCanvas.height;
        // SVG viewBox is -4 -4 192 192 → map to canvas coords
        const sx = (x: number) => (x + 4) * (CW / 192);
        const sy = (y: number) => (y + 4) * (CH / 192);
        // Matches cubic-bezier(0.45, 0, 0.55, 1) used by the stroke transition
        const ease = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

        type Spark = { x:number; y:number; vx:number; vy:number; life:number; size:number; hue:number };
        const sparks: Spark[] = [];

        const W1_START = 300;
        const W2_START = 500;
        const W_DUR   = 1100;
        const STOP_SPAWN = 1650; // stop emitting before square fill (1700ms)
        const STOP_LOOP  = 2600; // clear canvas after sparks dissipate

        const headScale = CW / 220; // size factor relative to 220px display

        const drawHead = (x: number, y: number) => {
          const R = 18 * headScale;
          const grad = ctx.createRadialGradient(x, y, 0, x, y, R);
          grad.addColorStop(0,   "rgba(255,255,255,1)");
          grad.addColorStop(0.4, "rgba(125,211,252,0.75)");
          grad.addColorStop(1,   "rgba(21,101,168,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, R, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(x, y, 2.8 * headScale, 0, Math.PI * 2);
          ctx.fill();
        };

        const spawnSparks = (x: number, y: number) => {
          for (let i = 0; i < 2; i++) {
            const a = Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.7;
            const s = (0.5 + Math.random() * 1.5) * headScale;
            sparks.push({
              x, y,
              vx: Math.cos(a) * s,
              vy: Math.sin(a) * s,
              life: 1,
              size: (0.8 + Math.random() * 1.6) * headScale,
              hue: 195 + Math.random() * 25,
            });
          }
        };

        const startTime = performance.now();

        const tick = (now: number) => {
          const el = now - startTime;
          ctx.clearRect(0, 0, CW, CH);

          // Wing 1 tip
          const p1 = (el - W1_START) / W_DUR;
          if (p1 > 0 && p1 < 1 && el < STOP_SPAWN) {
            const tip = sp1.getPointAtLength(l1 * ease(p1));
            const tx = sx(tip.x), ty = sy(tip.y);
            if (Math.random() < 0.4) spawnSparks(tx, ty);
            drawHead(tx, ty);
          }

          // Wing 2 tip
          const p2 = (el - W2_START) / W_DUR;
          if (p2 > 0 && p2 < 1 && el < STOP_SPAWN) {
            const tip = sp2.getPointAtLength(l2 * ease(p2));
            const tx = sx(tip.x), ty = sy(tip.y);
            if (Math.random() < 0.4) spawnSparks(tx, ty);
            drawHead(tx, ty);
          }

          // Update + draw sparks (downward gravity)
          for (let i = sparks.length - 1; i >= 0; i--) {
            const sp = sparks[i];
            sp.x += sp.vx;
            sp.y += sp.vy;
            sp.vy += 0.18 * headScale;
            sp.vx *= 0.99;
            sp.life -= 0.045;
            if (sp.life <= 0 || sp.y > CH) {
              sparks.splice(i, 1);
              continue;
            }
            ctx.globalAlpha = sp.life;
            ctx.fillStyle = `hsl(${sp.hue}, 95%, ${70 + sp.life * 20}%)`;
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;

          if (el < STOP_LOOP) {
            rafIdRef.current = requestAnimationFrame(tick);
          } else {
            ctx.clearRect(0, 0, CW, CH);
          }
        };

        if (rafIdRef.current !== undefined) cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = requestAnimationFrame(tick);
      }
    }

    // Reveal SVG then start scale entrance via double rAF (reliable CSS transition start)
    svg.style.opacity = "1";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        g.style.transition = "transform 0.85s cubic-bezier(0.34, 1.2, 0.64, 1)";
        g.style.transform = "scale(1)";
      });
    });

    // Draw wing 1
    setTimeout(() => {
      sp1.style.transition = "stroke-dashoffset 1.1s cubic-bezier(0.45, 0, 0.55, 1)";
      sp1.style.strokeDashoffset = "0";
    }, 300);

    // Draw wing 2
    setTimeout(() => {
      sp2.style.transition = "stroke-dashoffset 1.1s cubic-bezier(0.45, 0, 0.55, 1)";
      sp2.style.strokeDashoffset = "0";
    }, 500);

    // Wing fills start fading in EARLIER (1450ms) and SLOWER (0.4s) — by 1700ms they're ~63% white,
    // so when the blue square starts fading in behind, white already dominates and the wings never
    // look cyan/blue. Strokes fade with the fills.
    setTimeout(() => {
      [fp1, fp2].forEach((p) => { p.style.transition = "opacity 0.4s ease-out"; p.style.opacity = "1"; });
      sp1.style.transition += ", opacity 0.4s ease-out";
      sp2.style.transition += ", opacity 0.4s ease-out";
      sp1.style.opacity = "0";
      sp2.style.opacity = "0";
    }, 1450);

    // Blue square fades in BEHIND the (already mostly opaque) white wings.
    setTimeout(() => {
      sqBase.style.transition = "opacity 0.55s ease";
      sqBase.style.opacity = "1";
      sqFill.style.transition = "opacity 0.55s ease";
      sqFill.style.opacity = "1";
    }, 1700);

    // Wordmark letter-by-letter
    setTimeout(() => {
      let i = 0;
      const tick = () => { i++; setRevealed(i); if (i < WORD.length) setTimeout(tick, 90); };
      tick();
    }, 2200);

    // Fade out
    setTimeout(() => setFading(true), 3800);
    setTimeout(() => { setVisible(false); onFinishRef.current(); }, 4600);
  }, []);

  useEffect(() => {
    const id = setTimeout(play, 200);
    return () => {
      clearTimeout(id);
      if (rafIdRef.current !== undefined) cancelAnimationFrame(rafIdRef.current);
    };
  }, [play]);

  // Dark:  blue square + white wings
  // Light: white square + blue wings
  const squareBase = isDark ? "#0f172a" : "#dbeafe";
  const squareBgFill = isDark ? BRAND : "#ffffff";
  const logoFill = isDark ? "#ffffff" : BRAND;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status" aria-live="polite" aria-label={t("common.loading")}
          initial={{ opacity: 1 }}
          animate={{ opacity: fading ? 0 : 1 }}
          transition={{ duration: 0.7, ease: "easeInOut" }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
          style={{ background: isDark ? "#07070d" : "#f1f5f9" }}
        >
          <div style={{ position: "relative", width: 220, height: 220 }} aria-hidden="true">
          <canvas
            ref={sparksCanvasRef}
            width={440}
            height={440}
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 220,
              height: 220,
              pointerEvents: "none",
              zIndex: 1,
            }}
          />
          <svg ref={svgRef} viewBox="-4 -4 192 192" width="220" height="220" aria-hidden="true" style={{ overflow: "visible", opacity: 0, position: "relative", zIndex: 0 }}>
            <defs>
              <clipPath id="splash-clip">
                <path d={BG_PATH} />
              </clipPath>
            </defs>
            <g ref={groupRef} style={{ transformOrigin: "center" }}>
              {/* Square base — hidden initially, fades in with squareFill so beams "draw" the logo */}
              <path ref={squareBaseRef} d={BG_PATH} fill={squareBase} style={{ opacity: 0 }} />
              <g clipPath="url(#splash-clip)">
                {/* Square fill — BEHIND wings so blue (dark) / white (light) bg never paints over wing color */}
                <rect ref={squareFillRef as React.RefObject<SVGRectElement>} x="-2" y="-2" width="188" height="188" fill={squareBgFill} style={{ opacity: 0 }} />
                {/* Animated stroke paths */}
                <path
                  ref={strokeP1Ref}
                  d={WING1}
                  fill="none"
                  stroke={logoFill}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ opacity: 0 }}
                />
                <path
                  ref={strokeP2Ref}
                  d={WING2}
                  fill="none"
                  stroke={logoFill}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ opacity: 0 }}
                />
                {/* Final logo fills (on top of strokes for clean edges) */}
                <path ref={fillP1Ref} d={WING1} fill={logoFill} style={{ opacity: 0 }} />
                <path ref={fillP2Ref} d={WING2} fill={logoFill} style={{ opacity: 0 }} />
              </g>
            </g>
          </svg>
          </div>

          {/* Wordmark with staggered reveal */}
          <div
            style={{
              marginTop: 36,
              fontFamily: "Manrope, sans-serif",
              fontWeight: 800,
              fontSize: 38,
              letterSpacing: "0.18em",
              display: "flex",
              gap: 2,
            }}
          >
            {WORD.split("").map((ch, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 14 }}
                animate={i < revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
                transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
                style={{
                  color: i < ACCENT_FROM ? (isDark ? "#f8fafc" : "#1a1a1a") : BRAND,
                  display: "inline-block",
                }}
              >
                {ch}
              </motion.span>
            ))}
          </div>

          {/* Personal greeting */}
          {userName && (
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={revealed >= WORD.length ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: 0.45, delay: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
              style={{
                marginTop: 24,
                fontFamily: "Manrope, sans-serif",
                fontWeight: 500,
                fontSize: 16,
                letterSpacing: "0.02em",
                color: isDark ? "rgba(248,250,252,0.78)" : "rgba(26,26,26,0.72)",
                textAlign: "center",
                padding: "0 24px",
              }}
            >
              {t("common.welcome")}, <span style={{ fontWeight: 700, color: BRAND }}>{userName}</span>!
            </motion.p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
