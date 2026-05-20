import { AnimatePresence, motion } from "framer-motion";
import { useRef, useState } from "react";

interface Pulse { id: number; x: number }

interface InteractiveStripeProps {
  edge?: "top" | "bottom";
  onDragStart?: () => void;
  /** Live delta in px */
  onDragUpdate?: (deltaX: number) => void;
  /** Final delta in px and velocity px/ms on release */
  onDragEnd?: (finalDeltaX: number, velocityX: number) => void;
  dayWidth?: number;
}

export function InteractiveStripe({
  edge = "top",
  onDragStart,
  onDragUpdate,
  onDragEnd,
  dayWidth = 100,
}: InteractiveStripeProps) {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);
  const lastDeltaX = useRef(0);
  const hasDragged = useRef(false);
  const prevMoveX = useRef(0);
  const prevMoveTime = useRef(0);
  const velX = useRef(0);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (hasDragged.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const id = Date.now();
    setPulses(p => [...p, { id, x }]);
    setTimeout(() => setPulses(p => p.filter(pulse => pulse.id !== id)), 900);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    lastDeltaX.current = 0;
    hasDragged.current = false;
    prevMoveX.current = e.clientX;
    prevMoveTime.current = performance.now();
    velX.current = 0;
    setDragging(true);
    setDragX(0);
    onDragStart?.();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startX.current === null) return;
    const now = performance.now();
    const dt = now - prevMoveTime.current;
    if (dt > 0) velX.current = (e.clientX - prevMoveX.current) / dt;
    prevMoveX.current = e.clientX;
    prevMoveTime.current = now;
    const delta = e.clientX - startX.current;
    lastDeltaX.current = delta;
    if (Math.abs(delta) > 3) hasDragged.current = true;
    setDragX(delta);
    onDragUpdate?.(delta);
  };

  const handlePointerUp = () => {
    onDragEnd?.(lastDeltaX.current, velX.current);
    startX.current = null;
    lastDeltaX.current = 0;
    velX.current = 0;
    setDragging(false);
    setDragX(0);
  };

  const daysPreview = Math.round(-dragX / dayWidth);

  return (
    <div
      className={`absolute ${edge === "bottom" ? "bottom-0" : "top-0"} left-0 right-0 overflow-visible ${edge === "top" ? "rounded-t-2xl" : ""}`}
      style={{
        height: dragging ? 6 : 4,
        cursor: dragging ? "grabbing" : (onDragStart ? "grab" : "crosshair"),
        zIndex: 10,
        transition: "height 0.15s ease",
      }}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <motion.div
        className={`absolute inset-0 ${edge === "top" ? "rounded-t-2xl" : ""}`}
        animate={{ backgroundPosition: ["0% 50%", "100% 50%"] }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
        style={{
          background: "linear-gradient(90deg, #c4b5fd, #f9a8d4, #fdba74, #fde68a, #86efac, #67e8f9, #93c5fd, #d8b4fe, #fca5a5, #c4b5fd)",
          backgroundSize: "400% 100%",
          boxShadow: dragging
            ? "0 0 16px rgba(196,181,253,0.9), 0 0 32px rgba(249,168,212,0.5)"
            : "0 0 10px rgba(196,181,253,0.6), 0 0 22px rgba(249,168,212,0.3)",
        }}
      />

      {dragging && daysPreview !== 0 && (
        <div
          className="absolute pointer-events-none flex items-center px-2 py-0.5 rounded-lg font-bold"
          style={{
            top: 8, left: "50%", transform: "translateX(-50%)",
            background: "rgba(255,255,255,0.95)",
            color: "#6d28d9",
            boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
            fontSize: 11,
            whiteSpace: "nowrap",
          }}
        >
          {daysPreview > 0 ? `→ +${daysPreview} д` : `← ${daysPreview} д`}
        </div>
      )}

      <AnimatePresence>
        {pulses.map(pulse => (
          <motion.div
            key={pulse.id}
            className="absolute pointer-events-none"
            style={{ left: `${pulse.x}%`, top: "50%", translateX: "-50%", translateY: "-50%" }}
            initial={{ width: 0, height: 0, opacity: 0.9 }}
            animate={{ width: 120, height: 120, opacity: 0 }}
            exit={{}}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <div className="w-full h-full rounded-full" style={{
              background: "radial-gradient(circle, rgba(168,85,247,0.6) 0%, rgba(6,182,212,0.3) 40%, transparent 70%)"
            }} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
