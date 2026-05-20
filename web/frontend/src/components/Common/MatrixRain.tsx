import { useEffect, useRef, useState } from "react";

export default function MatrixRain({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const fontSize = 14;
    const cols = Math.floor(canvas.width / fontSize);
    const drops = Array.from({ length: cols }, () => Math.floor(Math.random() * -50));
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ";
    const draw = () => {
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${fontSize}px monospace`;
      drops.forEach((y, i) => {
        const char = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillStyle = y <= 1 ? "#ffffff" : "#00ff41";
        ctx.fillText(char, i * fontSize, y * fontSize);
        if (y * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      });
    };
    const interval = setInterval(draw, 40);
    const fadeOut = setTimeout(() => setFading(true), 5000);
    const done = setTimeout(() => { clearInterval(interval); onDone(); }, 5800);
    return () => { clearInterval(interval); clearTimeout(fadeOut); clearTimeout(done); };
  }, [onDone]);

  return (
    <canvas ref={canvasRef} style={{
      position: "fixed", top: 0, left: 0,
      width: "100vw", height: "100vh",
      zIndex: 9998, pointerEvents: "none",
      opacity: fading ? 0 : 1,
      transition: fading ? "opacity 0.8s ease" : "none",
    }} />
  );
}
