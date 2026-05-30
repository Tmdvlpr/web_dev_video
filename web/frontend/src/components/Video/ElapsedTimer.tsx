import { useEffect, useRef } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

function formatElapsed(totalSec: number): string {
  if (totalSec <= 0) return "00:00";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

interface ElapsedTimerProps {
  /** Unix timestamp in milliseconds for when the meeting started */
  startedAt: number;
  className?: string;
}

/**
 * Displays an elapsed time counter (MM:SS or HH:MM:SS) that updates every
 * second by writing directly to the DOM via a ref — the parent component
 * does NOT re-render on each tick.
 */
export default function ElapsedTimer({ startedAt, className }: ElapsedTimerProps) {
  const spanRef = useRef<HTMLSpanElement>(null);

  // Capture the performance.now() baseline and the elapsed-at-mount offset once.
  // This avoids clock drift from Date.now() comparisons and keeps the timer
  // accurate even if the tab is backgrounded and then foregrounded.
  const perfStartRef = useRef<number>(0);
  const mountOffsetRef = useRef<number>(0);

  useEffect(() => {
    const now = Date.now();
    const mountOffsetSec = Math.max(0, Math.floor((now - startedAt) / 1000));
    perfStartRef.current = performance.now();
    mountOffsetRef.current = mountOffsetSec;

    // Write initial value immediately so the span shows something before the
    // first tick fires.
    if (spanRef.current) {
      spanRef.current.textContent = formatElapsed(mountOffsetSec);
    }

    const id = setInterval(() => {
      const elapsed = performance.now() - perfStartRef.current;
      const totalSec = mountOffsetRef.current + Math.floor(elapsed / 1000);
      if (spanRef.current) {
        spanRef.current.textContent = formatElapsed(totalSec);
      }
    }, 1000);

    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <span ref={spanRef} className={className} />;
}
