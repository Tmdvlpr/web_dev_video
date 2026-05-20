import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";
import { useUsers } from "../../hooks/useBookings";

const POSITIONS = ["Начальник департамента/отдела", "PM", "Аналитик", "Программист и др.", "Дизайнер"] as const;

const POSITION_T_KEYS: Record<string, string> = {
  "Начальник департамента/отдела": "pos.chief",
  "PM": "pos.pm",
  "Аналитик": "pos.analyst",
  "Программист и др.": "pos.programmer",
  "Дизайнер": "pos.designer",
};

type GuestMode = null | "position" | "username";

/* ── Guest picker: two-mode dropdown (by position accordion or username search) ── */
export function GuestInput({
  guests, setGuests,
}: { guests: string[]; setGuests: React.Dispatch<React.SetStateAction<string[]>> }) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const { data: allUsers = [] } = useUsers();
  const [mode, setMode] = useState<GuestMode>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setFocused(false);
        setMode(null);
        setInput("");
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const byPosition = POSITIONS.reduce<Record<string, typeof allUsers>>((acc, pos) => {
    acc[pos] = allUsers.filter(u => u.username && u.position === pos);
    return acc;
  }, {} as Record<string, typeof allUsers>);

  const suggestions = mode === "username" ? allUsers.filter(u =>
    u.username && (
      input.length === 0 ||
      u.username.toLowerCase().includes(input.toLowerCase()) ||
      u.display_name.toLowerCase().includes(input.toLowerCase())
    )
  ).slice(0, 8) : [];

  const isGuest = (username: string) =>
    guests.includes(username.trim().toLowerCase().replace(/^@/, ""));

  const toggleGuest = (username: string) => {
    const u = username.trim().toLowerCase().replace(/^@/, "");
    if (!u) return;
    setGuests(gs => gs.includes(u) ? gs.filter(x => x !== u) : [...gs, u]);
  };

  const toggleExpanded = (pos: string) =>
    setExpanded(e => { const n = new Set(e); n.has(pos) ? n.delete(pos) : n.add(pos); return n; });

  const dropShadow = isDark ? "0 8px 32px rgba(0,0,0,0.6)" : "0 4px 16px rgba(0,0,0,0.12)";

  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-sec)" }}>
        {t("booking.guests")}
      </label>
      <div ref={wrapRef} className="relative">
        {/* Tag area — click opens dropdown */}
        <div
          className="rounded-xl px-3 py-2 flex flex-wrap gap-1.5 min-h-[40px] transition-all cursor-pointer"
          style={{
            background: "var(--input-bg)",
            border: focused ? "1.5px solid var(--primary)" : "1.5px solid var(--input-border)",
            boxShadow: focused ? "0 0 0 3px rgba(21,101,168,0.12)" : "none",
          }}
          onClick={() => setFocused(true)}
        >
          {guests.map(g => (
            <motion.span key={g} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold"
              style={{ background: "var(--primary-light)", border: "1px solid var(--primary-border)", color: "var(--primary)" }}>
              @{g}
              <button type="button"
                onClick={e => { e.stopPropagation(); setGuests(gs => gs.filter(x => x !== g)); }}
                className="opacity-60 hover:opacity-100 leading-none" style={{ fontSize: 14 }}>×</button>
            </motion.span>
          ))}
          {guests.length === 0 && (
            <span className="text-xs self-center" style={{ color: "var(--text-sec)", opacity: 0.5 }}>
              {t("booking.guestsPlaceholder")}
            </span>
          )}
        </div>

        <AnimatePresence>
          {focused && (
            <motion.div
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden"
              style={{ background: isDark ? "#0f172a" : "#ffffff", border: "1px solid var(--border)", boxShadow: dropShadow, maxHeight: 320, overflowY: "auto" }}
              onPointerDown={e => e.stopPropagation()}>

              {/* Mode selector */}
              {mode === null && (
                <div className="p-1">
                  {([
                    { key: "position" as const, emoji: "🏢", label: t("booking.byPosition"), sub: t("booking.byPositionSub") },
                    { key: "username" as const, emoji: "@",  label: t("booking.byUsername"),  sub: t("booking.byUsernameSub") },
                  ] as const).map(opt => (
                    <button key={opt.key} type="button"
                      onClick={e => { e.stopPropagation(); setMode(opt.key); if (opt.key === "username") setTimeout(() => inputRef.current?.focus(), 30); }}
                      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-all"
                      onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                      <span className="text-base leading-none">{opt.emoji}</span>
                      <div>
                        <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>{opt.label}</div>
                        <div className="text-xs" style={{ color: "var(--text-sec)" }}>{opt.sub}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Position accordion */}
              {mode === "position" && (
                <div>
                  <button type="button"
                    onClick={e => { e.stopPropagation(); setMode(null); }}
                    className="flex items-center gap-1.5 px-3 py-2 w-full text-xs font-semibold transition-all"
                    style={{ color: "var(--text-sec)", borderBottom: "1px solid var(--border)" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                    ← {t("booking.guestsBack")}
                  </button>
                  {POSITIONS.map(pos => {
                    const members = byPosition[pos] ?? [];
                    const open = expanded.has(pos);
                    const allChecked = members.length > 0 && members.every(u => isGuest(u.username!));
                    const someChecked = !allChecked && members.some(u => isGuest(u.username!));
                    return (
                      <div key={pos}>
                        <div className="flex items-center w-full">
                          {/* Position-level checkbox — selects/deselects all members */}
                          <button type="button"
                            onClick={e => {
                              e.stopPropagation();
                              if (members.length === 0) return;
                              if (allChecked) members.forEach(u => toggleGuest(u.username!));
                              else members.filter(u => !isGuest(u.username!)).forEach(u => toggleGuest(u.username!));
                            }}
                            className="pl-3 pr-2 py-2 shrink-0 flex items-center"
                            style={{ cursor: members.length === 0 ? "default" : "pointer" }}>
                            <div className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                              style={{
                                border: `1.5px solid ${allChecked || someChecked ? "var(--primary)" : "var(--input-border)"}`,
                                background: allChecked ? "var(--primary)" : "transparent",
                                color: "#fff",
                                fontSize: 9,
                                opacity: members.length === 0 ? 0.3 : 1,
                              }}>
                              {allChecked && "✓"}
                              {someChecked && <span style={{ fontSize: 11, lineHeight: 1, fontWeight: 700 }}>−</span>}
                            </div>
                          </button>
                          {/* Expand toggle */}
                          <button type="button"
                            onClick={e => { e.stopPropagation(); toggleExpanded(pos); }}
                            className="flex items-center gap-2 flex-1 pr-3 py-2 text-xs font-semibold transition-all"
                            style={{ color: "var(--text)" }}
                            onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                            <span style={{ width: 12, display: "inline-block", opacity: 0.5, fontSize: 9 }}>
                              {open ? "▼" : "▶"}
                            </span>
                            <span className="flex-1 text-left">{t(POSITION_T_KEYS[pos] as Parameters<typeof t>[0])}</span>
                            <span className="opacity-40 font-normal">({members.length})</span>
                          </button>
                        </div>
                        {open && members.map(u => {
                          const checked = isGuest(u.username!);
                          return (
                            <button key={u.id} type="button"
                              onClick={e => { e.stopPropagation(); toggleGuest(u.username!); }}
                              className="flex items-center gap-2 w-full pl-10 pr-3 py-1.5 text-left text-xs transition-all"
                              style={{ color: "var(--text)" }}
                              onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                              <div className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                                style={{
                                  border: `1.5px solid ${checked ? "var(--primary)" : "var(--input-border)"}`,
                                  background: checked ? "var(--primary)" : "transparent",
                                  color: "#fff",
                                  fontSize: 9,
                                }}>
                                {checked && "✓"}
                              </div>
                              {u.avatar ? (
                                <img src={u.avatar} alt={u.display_name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                              ) : (
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                                  style={{ background: "var(--primary-light)", color: "var(--primary)" }}>
                                  {u.display_name.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <span className="flex-1">{u.display_name}</span>
                              {u.username && <span style={{ color: "var(--text-muted)" }}>@{u.username}</span>}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Username search */}
              {mode === "username" && (
                <div>
                  <div className="flex items-center gap-1" style={{ borderBottom: "1px solid var(--border)" }}>
                    <button type="button"
                      onClick={e => { e.stopPropagation(); setMode(null); setInput(""); }}
                      className="px-3 py-2 text-xs font-semibold shrink-0 transition-all"
                      style={{ color: "var(--text-sec)" }}
                      onMouseEnter={e => { e.currentTarget.style.color = "var(--text)"; }}
                      onMouseLeave={e => { e.currentTarget.style.color = "var(--text-sec)"; }}>
                      ←
                    </button>
                    <input
                      ref={inputRef}
                      type="text"
                      value={input}
                      onChange={e => setInput(e.target.value.replace(/\s/g, ""))}
                      placeholder={t("booking.searchUserPh")}
                      className="flex-1 py-2 pr-3 text-xs outline-none bg-transparent"
                      style={{ color: "var(--text)" }}
                    />
                  </div>
                  {suggestions.map(u => {
                    const checked = isGuest(u.username!);
                    return (
                      <button key={u.id} type="button"
                        onClick={e => { e.stopPropagation(); toggleGuest(u.username!); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs transition-all"
                        style={{ color: "var(--text)" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                        {u.avatar ? (
                          <img src={u.avatar} alt={u.display_name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                            style={{ background: "var(--primary-light)", color: "var(--primary)" }}>
                            {u.display_name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1">
                          <div className="font-semibold">{u.display_name}</div>
                          <div style={{ color: "var(--text-muted)" }}>
                            {u.username && <span>@{u.username}</span>}
                            {u.position && <span style={{ marginLeft: u.username ? 6 : 0, color: "var(--primary)", fontWeight: 600 }}>{POSITION_T_KEYS[u.position] ? t(POSITION_T_KEYS[u.position] as Parameters<typeof t>[0]) : u.position}</span>}
                          </div>
                        </div>
                        <div className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                          style={{
                            border: `1.5px solid ${checked ? "var(--primary)" : "var(--input-border)"}`,
                            background: checked ? "var(--primary)" : "transparent",
                            color: "#fff",
                            fontSize: 9,
                          }}>
                          {checked && "✓"}
                        </div>
                      </button>
                    );
                  })}
                  {suggestions.length === 0 && input.length > 0 && (
                    <div className="px-3 py-3 text-xs text-center" style={{ color: "var(--text-sec)" }}>{t("booking.usersNotFound")}</div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
