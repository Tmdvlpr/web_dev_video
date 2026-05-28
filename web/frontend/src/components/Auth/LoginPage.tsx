import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useMotionValue, useTransform, useSpring } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { authApi } from "../../api/auth";
import { workspacesApi } from "../../api/workspaces";
import { storage } from "../../utils/storage";
import { useTelegram } from "../../hooks/useTelegram";
import { useAuth } from "../../hooks/useAuth";
import { useLocale } from "../../contexts/LocaleContext";
import { useTheme } from "../../contexts/ThemeContext";
import LoadingSpinner from "../Common/LoadingSpinner";


/* ─────────────────────────────────────────────────────
   QR AUTH — scan to authorize via Telegram bot
───────────────────────────────────────────────────── */
function QrAuth() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const { isDark } = useTheme();
  const queryClient = useQueryClient();
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const popupRef = useRef<Window | null>(null);

  const openTgPopup = () => {
    if (!botUrl) return;
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }
    const w = 520, h = 700;
    const left = Math.max(0, (window.screen.width - w) / 2);
    const top  = Math.max(0, (window.screen.height - h) / 2);
    popupRef.current = window.open(
      botUrl,
      "corpmeet_tg_auth",
      `popup,width=${w},height=${h},left=${left},top=${top}`
    );
  };

  const createSession = useCallback(async () => {
    setExpired(false);
    try {
      const data = await authApi.createQrSession();
      setToken(data.token);
      setBotUrl(data.bot_url);
    } catch {
      setBotUrl(null);
    }
  }, []);

  useEffect(() => { createSession(); }, [createSession]);

  // Poll for session completion
  useEffect(() => {
    if (!token) return;
    let active = true;
    const poll = async () => {
      while (active) {
        await new Promise(r => setTimeout(r, 2000));
        if (!active) break;
        try {
          const res = await authApi.pollSession(token);
          if ("access_token" in res) {
            // Backend sets the httpOnly cookie; invalidate /me so auth state updates
            await queryClient.invalidateQueries({ queryKey: ["me"] });
            sessionStorage.setItem("__corpmeet_replay_splash", "1"); window.dispatchEvent(new CustomEvent("corpmeet:replay-splash"));
            if (popupRef.current && !popupRef.current.closed) {
              try { popupRef.current.close(); } catch {}
            }
            navigate("/bookings", { replace: true });
            return;
          }
        } catch (e: any) {
          if (e?.response?.status === 410) { setExpired(true); return; }
          if (e?.response?.status === 404) { setExpired(true); return; }
        }
      }
    };
    poll();
    return () => { active = false; };
  }, [token, navigate]);

  if (expired) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="flex flex-col items-center gap-3">
        <p className="text-sm font-semibold" style={{ color: "rgba(239,68,68,0.8)" }}>{t("auth.qrExpired")}</p>
        <button onClick={createSession}
          className="px-4 py-2 rounded-md text-sm font-bold text-white"
          style={{ background: "linear-gradient(135deg, #2563eb, #6366f1)" }}>
          {t("auth.createNew")}
        </button>
      </motion.div>
    );
  }

  if (!botUrl) {
    return (
      <div className="flex items-center justify-center py-8">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 rounded-full border-2"
          style={{ borderColor: isDark ? "rgba(96,165,250,0.3)" : "rgba(37,99,235,0.3)", borderTopColor: isDark ? "rgba(96,165,250,0.85)" : "rgba(37,99,235,0.8)" }}
        />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }}
      className="flex flex-col items-center gap-4">
      {/* QR Code */}
      <div className="p-3 rounded-md" style={{ background: "white", boxShadow: isDark ? "0 2px 16px rgba(96,165,250,0.15)" : "0 2px 16px rgba(37,99,235,0.12)" }}>
        <QRCodeSVG
          value={botUrl}
          size={180}
          level="M"
          bgColor="#ffffff"
          fgColor="#1e293b"
          style={{ display: "block" }}
        />
      </div>

      <p className="text-xs text-center" style={{ color: isDark ? "rgba(255,255,255,0.55)" : "rgba(37,99,235,0.55)", maxWidth: 240, lineHeight: 1.6 }}>
        {t("auth.qrHint")}
      </p>

      {/* Open Telegram in a popup — glowing pill button */}
      <div className="tg-glow-wrap">
        <button onClick={openTgPopup} className="tg-glow-btn"
          style={!isDark ? { background: "rgba(255,255,255,0.93)", color: "#0f172a" } : undefined}>
          <motion.svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          >
            <circle cx="12" cy="12" r="9"
              stroke={isDark ? "rgba(147,197,253,0.9)" : "rgba(37,99,235,0.8)"}
              strokeWidth="2.5" strokeLinecap="round" strokeDasharray="42 14" />
          </motion.svg>
          {t("auth.openTelegram")}
        </button>
      </div>

      {/* Polling indicator */}
      <div className="flex items-center gap-2">
        {[0, 0.2, 0.4].map((d, i) => (
          <motion.div key={i} className="w-1.5 h-1.5 rounded-full"
            style={{ background: isDark ? "rgba(255,255,255,0.65)" : "rgba(37,99,235,0.65)" }}
            animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.4, 0.8] }}
            transition={{ duration: 1.4, repeat: Infinity, delay: d }} />
        ))}
        <span className="text-xs ml-1 font-semibold" style={{ color: isDark ? "rgba(255,255,255,0.5)" : "rgba(37,99,235,0.4)", letterSpacing: "0.06em" }}>
          {t("auth.waiting")}
        </span>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────
   DIGITAL CIRCUIT CANVAS
───────────────────────────────────────────────────── */
function DigitalCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tick = useRef(0);
  const velocityRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0 });
  const { isDark } = useTheme();
  const isDarkRef = useRef(isDark);
  useEffect(() => { isDarkRef.current = isDark; }, [isDark]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    // track mouse position + velocity
    let lastMX = 0, lastMY = 0;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - lastMX, dy = e.clientY - lastMY;
      const v = Math.sqrt(dx * dx + dy * dy) / 20;
      velocityRef.current = Math.min(v, 4);
      mouseRef.current = { x: e.clientX, y: e.clientY };
      lastMX = e.clientX; lastMY = e.clientY;
    };
    window.addEventListener("mousemove", onMove);

    const COLS = 18, ROWS = 11;
    type Node = { x: number; y: number; active: boolean; pulse: number };
    let nodes: Node[] = [];
    const buildNodes = () => {
      const W = canvas.width, H = canvas.height;
      nodes = [];
      for (let r = 0; r <= ROWS; r++)
        for (let c = 0; c <= COLS; c++)
          nodes.push({ x: (c / COLS) * W, y: (r / ROWS) * H, active: Math.random() > 0.42, pulse: Math.random() * Math.PI * 2 });
    };
    buildNodes();

    type DataParticle = { nx: number; ny: number; t: number; speed: number; horiz: boolean };
    const dataParticles: DataParticle[] = Array.from({ length: 80 }, () => ({
      nx: Math.floor(Math.random() * COLS), ny: Math.floor(Math.random() * ROWS),
      t: Math.random(), speed: 0.004 + Math.random() * 0.006, horiz: Math.random() > 0.5,
    }));

    type BinCol = { x: number; y: number; speed: number; chars: string[] };
    const binCols: BinCol[] = Array.from({ length: 22 }, () => ({
      x: Math.random() * window.innerWidth, y: -Math.random() * 400,
      speed: 0.4 + Math.random() * 0.8,
      chars: Array.from({ length: 10 }, () => String.fromCharCode(0x30 + Math.floor(Math.random() * 2))),
    }));

    let raf: number;
    let rebuildCooldown = 0;
    const draw = () => {
      tick.current++;
      // decay velocity smoothly each frame
      const vel = velocityRef.current;
      velocityRef.current *= 0.88;

      // rebuild node pattern on fast mouse movement (throttled)
      rebuildCooldown--;
      if (vel > 1.8 && rebuildCooldown <= 0) {
        rebuildCooldown = 18;
        buildNodes();
      }

      const W = canvas.width, H = canvas.height;
      const mx = mouseRef.current.x, my = mouseRef.current.y;
      ctx.clearRect(0, 0, W, H);

      // background
      const bg = ctx.createLinearGradient(0, 0, W, H);
      if (isDarkRef.current) {
        bg.addColorStop(0, "#07070d"); bg.addColorStop(0.4, "#07070d"); bg.addColorStop(1, "#07070d");
      } else {
        bg.addColorStop(0, "#e8f0fe"); bg.addColorStop(0.4, "#f0f7ff"); bg.addColorStop(1, "#e2eeff");
      }
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      // ── circuit grid ──
      void (W / COLS); void (H / ROWS);
      for (let r = 0; r <= ROWS; r++) {
        for (let c = 0; c <= COLS; c++) {
          const nd = nodes[r * (COLS + 1) + c];
          if (!nd) continue;
          if (c < COLS) {
            const nd2 = nodes[r * (COLS + 1) + c + 1];
            if (nd.active && nd2?.active) {
              ctx.beginPath(); ctx.moveTo(nd.x, nd.y); ctx.lineTo(nd2.x, nd2.y);
              ctx.strokeStyle = isDarkRef.current ? "rgba(79,124,255,0.12)" : "rgba(59,130,246,0.12)"; ctx.lineWidth = 1; ctx.stroke();
            }
          }
          if (r < ROWS) {
            const nd3 = nodes[(r + 1) * (COLS + 1) + c];
            if (nd.active && nd3?.active) {
              ctx.beginPath(); ctx.moveTo(nd.x, nd.y); ctx.lineTo(nd3.x, nd3.y);
              ctx.strokeStyle = "rgba(99,102,241,0.10)"; ctx.lineWidth = 1; ctx.stroke();
            }
          }
        }
      }
      nodes.forEach(nd => {
        if (!nd.active) return;
        const pulse = 0.3 + Math.abs(Math.sin(nd.pulse + tick.current * 0.012)) * 0.5;
        // nodes near cursor glow brighter
        const dist = Math.sqrt((nd.x - mx) ** 2 + (nd.y - my) ** 2);
        const proximity = Math.max(0, 1 - dist / 220);
        const alpha = pulse * 0.5 + proximity * 0.55;
        const radius = 2 + proximity * 2.5;
        ctx.beginPath(); ctx.arc(nd.x, nd.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isDarkRef.current ? `rgba(96,165,250,${alpha})` : `rgba(59,130,246,${alpha})`; ctx.fill();
      });

      // ── data particles ── (speed scales with mouse velocity)
      const vBoost = 1 + velocityRef.current * 2.5;
      dataParticles.forEach(p => {
        p.t += p.speed * vBoost;
        if (p.t > 1) { p.t = 0; p.nx = Math.floor(Math.random() * COLS); p.ny = Math.floor(Math.random() * ROWS); }
        const base = nodes[p.ny * (COLS + 1) + p.nx];
        const next = p.horiz ? nodes[p.ny * (COLS + 1) + Math.min(p.nx + 1, COLS)] : nodes[Math.min(p.ny + 1, ROWS) * (COLS + 1) + p.nx];
        if (!base || !next || !base.active || !next.active) return;
        const px = base.x + (next.x - base.x) * p.t;
        const py = base.y + (next.y - base.y) * p.t;
        const ddx = next.x - base.x, ddy = next.y - base.y;
        const dlen = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dlen < 0.001) return;
        const dnx = ddx / dlen, dny = ddy / dlen;
        const tailLen = 38 + velocityRef.current * 12;
        const tailX = px - dnx * tailLen, tailY = py - dny * tailLen;
        const tailGrad = ctx.createLinearGradient(px, py, tailX, tailY);
        if (isDarkRef.current) {
          tailGrad.addColorStop(0, "rgba(147,197,253,0.88)");
          tailGrad.addColorStop(0.4, "rgba(96,165,250,0.42)");
        } else {
          tailGrad.addColorStop(0, "rgba(37,99,235,0.82)");
          tailGrad.addColorStop(0.4, "rgba(59,130,246,0.35)");
        }
        tailGrad.addColorStop(1, "rgba(99,102,241,0)");
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tailX, tailY);
        ctx.strokeStyle = tailGrad; ctx.lineWidth = 1.5; ctx.lineCap = "round"; ctx.stroke();
        const headG = ctx.createRadialGradient(px, py, 0, px, py, 7);
        headG.addColorStop(0, isDarkRef.current ? "rgba(147,220,255,0.5)" : "rgba(37,99,235,0.42)"); headG.addColorStop(1, "transparent");
        ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fillStyle = headG; ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = isDarkRef.current ? "rgba(220,240,255,0.95)" : "rgba(30,64,175,0.95)"; ctx.fill();
      });

      // ── binary rain ──
      ctx.font = "10px 'Courier New', monospace";
      binCols.forEach(bc => {
        bc.y += bc.speed * (1 + velocityRef.current * 1.5);
        if (bc.y > H + 200) { bc.y = -120; bc.x = Math.random() * W; }
        bc.chars.forEach((ch, i) => {
          const a = Math.max(0, 0.06 - i * 0.006);
          ctx.fillStyle = isDarkRef.current ? `rgba(79,124,255,${a})` : `rgba(37,99,235,${a})`; ctx.fillText(ch, bc.x, bc.y - i * 13);
        });
      });

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); window.removeEventListener("mousemove", onMove); };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 w-full h-full" style={{ zIndex: 0 }} />;
}

/* ─────────────────────────────────────────────────────
   CURSOR — crosshair only, no trail
───────────────────────────────────────────────────── */
function Cursor({ mouseX, mouseY }: { mouseX: number; mouseY: number }) {
  const { isDark } = useTheme();
  const cc = isDark ? "rgba(96,165,250," : "rgba(37,99,235,";
  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 5 }}>
      <div style={{ position: "absolute", left: mouseX, top: mouseY, transform: "translate(-50%,-50%)" }}>
        <div style={{ width: 20, height: 20, position: "relative" }}>
          <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, marginTop: -0.5, background: `${cc}0.85)` }} />
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, marginLeft: -0.5, background: `${cc}0.85)` }} />
          <div style={{ position: "absolute", top: "50%", left: "50%", width: 4, height: 4, borderRadius: "50%", background: `${cc}1)`, transform: "translate(-50%,-50%)" }} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   FLOATING CIRCUIT SHAPES
───────────────────────────────────────────────────── */
function CircuitShapes({ mouseX, mouseY }: { mouseX: number; mouseY: number }) {
  const { isDark } = useTheme();
  const shapes = useRef(Array.from({ length: 10 }, (_, i) => ({
    id: i, x: 5 + Math.random() * 90, y: 5 + Math.random() * 90,
    size: 16 + Math.random() * 28, rot: Math.random() * 360,
    speed: 0.2 + Math.random() * 0.4, depth: 0.2 + Math.random() * 0.8, type: i % 3,
  }))).current;
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 1 }}>
      {shapes.map(s => {
        const px = (mouseX / (window.innerWidth  || 1) - 0.5) * 25 * s.depth;
        const py = (mouseY / (window.innerHeight || 1) - 0.5) * 25 * s.depth;
        return (
          <motion.div key={s.id} className="absolute" style={{ left: `${s.x}%`, top: `${s.y}%` }}
            animate={{ x: px, y: py, rotate: [s.rot, s.rot + 360], opacity: [0.06, 0.18, 0.06] }}
            transition={{
              x: { duration: 1.2, ease: "easeOut" }, y: { duration: 1.2, ease: "easeOut" },
              rotate: { duration: 25 / s.speed, repeat: Infinity, ease: "linear" },
              opacity: { duration: 4 + s.speed * 2, repeat: Infinity, ease: "easeInOut" },
            }}>
            <svg width={s.size} height={s.size} viewBox="0 0 24 24" fill="none">
              {s.type === 0 && <rect x="3" y="3" width="18" height="18" rx="2" stroke={isDark ? "rgba(96,165,250,0.65)" : "rgba(37,99,235,0.8)"} strokeWidth="1.5" />}
              {s.type === 1 && <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke={isDark ? "rgba(129,140,248,0.65)" : "rgba(99,102,241,0.8)"} strokeWidth="1.5" />}
              {s.type === 2 && <><line x1="12" y1="2" x2="12" y2="22" stroke={isDark ? "rgba(96,165,250,0.5)" : "rgba(37,99,235,0.6)"} strokeWidth="1.5"/><line x1="2" y1="12" x2="22" y2="12" stroke={isDark ? "rgba(96,165,250,0.5)" : "rgba(37,99,235,0.6)"} strokeWidth="1.5"/><circle cx="12" cy="12" r="4" stroke={isDark ? "rgba(129,140,248,0.65)" : "rgba(99,102,241,0.8)"} strokeWidth="1.5"/></>}
            </svg>
          </motion.div>
        );
      })}
    </div>
  );
}


/* ─────────────────────────────────────────────────────
   MAIN
───────────────────────────────────────────────────── */
const isTouchDevice = () => "ontouchstart" in window || navigator.maxTouchPoints > 0;

export default function LoginPage() {
  const { isMiniApp, initData, inviteParam } = useTelegram();
  const navigate = useNavigate();
  const { t } = useLocale();
  const { isAuthenticated } = useAuth();
  const { isDark } = useTheme();

  // If user is already authenticated (e.g. came back from TG with valid
  // token in localStorage), skip the QR flow entirely and go to bookings.
  useEffect(() => {
    if (isAuthenticated) navigate("/bookings", { replace: true });
  }, [isAuthenticated, navigate]);

  const isMobile = useRef(isTouchDevice());
  const initialBetaRef = useRef<number | null>(null);
  const centerX = isMobile.current ? window.innerWidth / 2 : 0;
  const centerY = isMobile.current ? window.innerHeight / 2 : 0;

  const [rawMX, setRawMX] = useState(centerX);
  const [rawMY, setRawMY] = useState(centerY);

  const mx = useMotionValue(centerX);
  const my = useMotionValue(centerY);
  const smx = useSpring(mx, { stiffness: 80, damping: 20 });
  const smy = useSpring(my, { stiffness: 80, damping: 20 });
  const rotateX = useTransform(smy, [0, window.innerHeight], [6, -6]);
  const rotateY = useTransform(smx, [0, window.innerWidth], [-6, 6]);
  const px2 = useTransform(smx, [0, window.innerWidth],  [-5, 5]);
  const py2 = useTransform(smy, [0, window.innerHeight], [-5, 5]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    setRawMX(e.clientX); setRawMY(e.clientY);
    mx.set(e.clientX); my.set(e.clientY);
  }, [mx, my]);

  const handleOrientation = useCallback((e: DeviceOrientationEvent) => {
    const gamma = e.gamma ?? 0;
    const beta = e.beta ?? 0;
    if (initialBetaRef.current === null) initialBetaRef.current = beta;
    const relBeta = beta - initialBetaRef.current;
    const W = window.innerWidth, H = window.innerHeight;
    const newMX = Math.max(0, Math.min(W, W / 2 - (gamma / 30) * (W / 2)));
    const newMY = Math.max(0, Math.min(H, H / 2 - (relBeta / 30) * (H / 2)));
    mx.set(newMX); my.set(newMY);
    setRawMX(newMX); setRawMY(newMY);
  }, [mx, my]);

  const attachGyro = useCallback(() => {
    window.addEventListener("deviceorientation", handleOrientation);
  }, [handleOrientation]);

  useEffect(() => {
    if (!isMobile.current) {
      window.addEventListener("mousemove", handleMouseMove);
      return () => window.removeEventListener("mousemove", handleMouseMove);
    }
    // Android and most browsers: no permission needed
    const DevOri = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DevOri.requestPermission === "function") {
      // iOS 13+: must be triggered by user gesture — attach on first tap
      const onTap = () => {
        DevOri.requestPermission!()
          .then(res => { if (res === "granted") attachGyro(); })
          .catch(() => {})
          .finally(() => document.removeEventListener("touchstart", onTap));
      };
      document.addEventListener("touchstart", onTap, { once: true });
      return () => {
        document.removeEventListener("touchstart", onTap);
        window.removeEventListener("deviceorientation", handleOrientation);
      };
    } else {
      attachGyro();
      return () => window.removeEventListener("deviceorientation", handleOrientation);
    }
  }, [handleMouseMove, handleOrientation, attachGyro]);

  useEffect(() => {
    if (!isMiniApp) return;
    const param = inviteParam;
    if (param) sessionStorage.setItem("__corpmeet_invite", JSON.stringify(param));
    authApi.login(initData)
      .then(async res => {
        storage.setToken(res.access_token);
        if (param) {
          try {
            if (param.invite_token) {
              await workspacesApi.claimInvite(param.invite_token);
            } else if (param.ws_code) {
              await workspacesApi.join(param.ws_code);
            }
          } catch { /* already member or invalid — ignore */ }
          sessionStorage.removeItem("__corpmeet_invite");
        }
        sessionStorage.setItem("__corpmeet_replay_splash", "1");
        window.dispatchEvent(new CustomEvent("corpmeet:replay-splash"));
        navigate("/bookings", { replace: true });
      })
      .catch(() => navigate("/register", { replace: true }));
  }, [isMiniApp, initData, inviteParam, navigate]);

  if (isMiniApp) return <LoadingSpinner />;

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ cursor: isMobile.current ? "auto" : "none", background: isDark ? "#07070d" : "#e8f0fe" }}>
      <DigitalCanvas />
      {!isMobile.current && <Cursor mouseX={rawMX} mouseY={rawMY} />}
      <CircuitShapes mouseX={rawMX} mouseY={rawMY} />

      <div className="relative flex flex-col items-center justify-center min-h-screen px-4" style={{ zIndex: 2 }}>
        <motion.div
          style={{ x: px2, y: py2, rotateX, rotateY, transformPerspective: 1200, transformStyle: "preserve-3d" }}
          initial={{ opacity: 0, scale: 0.88, y: 40 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1] }}
          className="relative w-full max-w-[480px]"
        >
          {/* glow */}
          <div className="absolute -inset-8 rounded-md pointer-events-none" style={{
            background: isDark ? "radial-gradient(ellipse, rgba(79,124,255,0.14) 0%, transparent 70%)" : "radial-gradient(ellipse, rgba(37,99,235,0.16) 0%, transparent 70%)",
            filter: "blur(20px)",
          }} />

          {/* card */}
          <div className="relative rounded-md overflow-hidden" style={{
            background: isDark ? "rgba(11,15,25,0.92)" : "rgba(255,255,255,0.92)",
            border: isDark ? "1px solid rgba(96,165,250,0.18)" : "1px solid rgba(37,99,235,0.2)",
            boxShadow: isDark ? "0 24px 70px rgba(79,124,255,0.18), 0 0 0 1px rgba(96,165,250,0.07), inset 0 1px 0 rgba(255,255,255,0.04)" : "0 24px 70px rgba(37,99,235,0.13), 0 0 0 1px rgba(99,102,241,0.07), inset 0 1px 0 rgba(255,255,255,1)",
            backdropFilter: "blur(24px)",
          }}>
            <div className="absolute top-0 inset-x-0 h-px" style={{
              background: isDark ? "linear-gradient(90deg, transparent, rgba(96,165,250,0.45), rgba(129,140,248,0.35), transparent)" : "linear-gradient(90deg, transparent, rgba(37,99,235,0.7), rgba(99,102,241,0.5), transparent)",
            }} />
            {["top-0 left-0 border-t border-l","top-0 right-0 border-t border-r","bottom-0 left-0 border-b border-l","bottom-0 right-0 border-b border-r"].map((cls, i) => (
              <div key={i} className={`absolute w-5 h-5 ${cls}`} style={{ borderColor: isDark ? "rgba(96,165,250,0.28)" : "rgba(37,99,235,0.35)" }} />
            ))}

            <div className="p-10" style={{ transform: "translateZ(24px)" }}>

              {/* Logo */}
              <div className="flex flex-col items-center mb-7 gap-3">
                <img src="/logo.png" alt="UZINFOCOM" className="h-24 w-24 object-contain" />
                <div className="flex items-center gap-2.5">
                  <div className="h-px w-10" style={{ background: isDark ? "linear-gradient(90deg, transparent, rgba(96,165,250,0.35))" : "linear-gradient(90deg, transparent, rgba(37,99,235,0.35))" }} />
                  <span style={{ color: isDark ? "rgba(96,165,250,0.9)" : "rgba(37,99,235,0.9)", fontSize: 16, letterSpacing: "0.18em", fontFamily: "Gilroy, sans-serif", fontWeight: 800 }}>CORPMEET</span>
                  <div className="h-px w-10" style={{ background: isDark ? "linear-gradient(90deg, rgba(96,165,250,0.35), transparent)" : "linear-gradient(90deg, rgba(37,99,235,0.35), transparent)" }} />
                </div>
              </div>

              {/* Title */}
              <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
                className="text-2xl font-bold text-center mb-2"
                style={{ color: isDark ? "#ffffff" : "#0f172a", letterSpacing: "-0.01em" }}>
                {t("common.welcome")}!
              </motion.h1>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
                className="text-center text-xs font-semibold mb-7"
                style={{ color: isDark ? "rgba(255,255,255,0.5)" : "rgba(37,99,235,0.5)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                {t("brand.subtitle")}
              </motion.p>

              <div className="mb-6 h-px" style={{
                background: isDark ? "linear-gradient(90deg, transparent, rgba(96,165,250,0.2), rgba(129,140,248,0.14), transparent)" : "linear-gradient(90deg, transparent, rgba(37,99,235,0.25), rgba(99,102,241,0.18), transparent)",
              }} />

              {/* QR Auth */}
              <QrAuth />

            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}
          className="mt-5 flex items-center gap-3">
          <div className="h-px w-16" style={{ background: isDark ? "linear-gradient(90deg, transparent, rgba(96,165,250,0.2))" : "linear-gradient(90deg, transparent, rgba(37,99,235,0.25))" }} />
          <span className="text-xs" style={{ color: isDark ? "rgba(255,255,255,0.35)" : "rgba(37,99,235,0.3)", letterSpacing: "0.06em" }}>
            Отсканируйте QR или откройте ссылку
          </span>
          <div className="h-px w-16" style={{ background: isDark ? "linear-gradient(90deg, rgba(96,165,250,0.2), transparent)" : "linear-gradient(90deg, rgba(37,99,235,0.25), transparent)" }} />
        </motion.div>
      </div>
    </div>
  );
}
