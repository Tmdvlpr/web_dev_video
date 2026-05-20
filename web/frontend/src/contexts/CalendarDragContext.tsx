import { createContext, useContext, useState } from "react";
import type { Booking } from "../types";

export interface DragPayload {
  booking: Booking;
  /** fraction (0–1) of where within the card height the grab happened */
  offsetFraction: number;
}

// Module-level ref: updated synchronously in dragstart before React re-renders,
// so dragover handlers in the same column can read it immediately.
export const activeDragRef = { current: null as DragPayload | null };

interface CalendarDragContextValue {
  drag: DragPayload | null;
  setDrag: (d: DragPayload | null) => void;
}

const CalendarDragContext = createContext<CalendarDragContextValue>({
  drag: null,
  setDrag: () => {},
});

export function CalendarDragProvider({ children }: { children: React.ReactNode }) {
  const [drag, setDragState] = useState<DragPayload | null>(null);
  const setDrag = (d: DragPayload | null) => {
    activeDragRef.current = d;
    setDragState(d);
  };
  return (
    <CalendarDragContext.Provider value={{ drag, setDrag }}>
      {children}
    </CalendarDragContext.Provider>
  );
}

export const useCalendarDrag = () => useContext(CalendarDragContext);
