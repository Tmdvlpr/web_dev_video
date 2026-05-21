import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { workspacesApi } from "../../api/workspaces";
import { useTheme } from "../../contexts/ThemeContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";

interface WorkspaceSelectorProps {
  onSettingsOpen: () => void;
}

type InlineMode = "none" | "create" | "join";

const BuildingIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21h18" />
    <path d="M5 21V7l8-4v18" />
    <path d="M19 21V11l-6-4" />
  </svg>
);

const ChevronDown = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const GearIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const PlusIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const KeyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-9.6 9.6" />
    <path d="m15.5 7.5 3 3L22 7l-3-3" />
  </svg>
);

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function WorkspaceSelector({ onSettingsOpen }: WorkspaceSelectorProps) {
  const { isDark } = useTheme();
  const { workspaces, activeWorkspace, setActiveWorkspaceId, refetchWorkspaces } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [inline, setInline] = useState<InlineMode>("none");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setInline("none");
        setName(""); setCode(""); setError(null); setInfo(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const handleCreate = async () => {
    setError(null); setInfo(null);
    if (!name.trim()) { setError("Введите название"); return; }
    setBusy(true);
    try {
      const ws = await workspacesApi.create({ name: name.trim() });
      await refetchWorkspaces();
      setActiveWorkspaceId(ws.id);
      setInline("none"); setName(""); setOpen(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Не удалось создать");
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    setError(null); setInfo(null);
    if (!code.trim()) { setError("Введите код"); return; }
    setBusy(true);
    try {
      const member = await workspacesApi.join(code.trim());
      await refetchWorkspaces();
      if (member.status === "active") {
        setActiveWorkspaceId(member.workspace_id);
        setInline("none"); setCode(""); setOpen(false);
      } else {
        setInfo("Заявка отправлена");
        setCode("");
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Не удалось присоединиться");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <div
        className="flex items-center gap-1 rounded-lg"
        style={{ border: "1px solid var(--border)", background: "var(--elevated)" }}
      >
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 px-2.5 h-7 text-xs font-semibold transition-all rounded-l-lg"
          style={{ color: "var(--text)" }}
          onMouseEnter={e => { e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = ""; }}
        >
          <span style={{ color: "var(--primary)" }}><BuildingIcon /></span>
          <span>{activeWorkspace ? truncate(activeWorkspace.name, 16) : "Без пространства"}</span>
          <span style={{ color: "var(--text-muted)" }}><ChevronDown /></span>
        </button>
        {activeWorkspace && (
          <button
            onClick={onSettingsOpen}
            title="Настройки пространства"
            className="flex items-center justify-center h-7 w-7 rounded-r-lg transition-all"
            style={{ color: "var(--text-muted)", borderLeft: "1px solid var(--border)" }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--primary)"; e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = ""; }}
          >
            <GearIcon />
          </button>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-9 z-50 rounded-xl py-2 w-72"
            style={{
              background: "var(--modal)",
              border: "1px solid var(--border)",
              boxShadow: isDark ? "0 16px 40px rgba(0,0,0,0.6)" : "0 16px 40px rgba(15,23,42,0.18)",
            }}
          >
            <div className="max-h-60 overflow-y-auto">
              {workspaces.length === 0 && (
                <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  Нет пространств
                </p>
              )}
              {workspaces.map(w => {
                const isActive = activeWorkspace?.id === w.id;
                return (
                  <button
                    key={w.id}
                    onClick={() => { setActiveWorkspaceId(w.id); setOpen(false); }}
                    className="w-full flex items-center justify-between px-3 py-2 text-left transition-all"
                    style={{ background: isActive ? "var(--primary-light)" : "transparent" }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--elevated)"; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span className="text-xs font-semibold truncate" style={{ color: isActive ? "var(--primary)" : "var(--text)" }}>
                      {w.name}
                    </span>
                    {isActive && <span style={{ color: "var(--primary)" }}><CheckIcon /></span>}
                  </button>
                );
              })}
            </div>

            <div className="h-px mx-2 my-1.5" style={{ background: "var(--border)" }} />

            {inline === "none" && (
              <div className="px-1.5 pb-1 space-y-0.5">
                <button onClick={() => { setInline("create"); setError(null); setInfo(null); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all text-left"
                  style={{ color: "var(--text-sec)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; e.currentTarget.style.color = "var(--primary)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-sec)"; }}
                >
                  <PlusIcon />
                  Создать
                </button>
                <button onClick={() => { setInline("join"); setError(null); setInfo(null); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all text-left"
                  style={{ color: "var(--text-sec)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; e.currentTarget.style.color = "var(--primary)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-sec)"; }}
                >
                  <KeyIcon />
                  Войти по коду
                </button>
              </div>
            )}

            {inline === "create" && (
              <div className="px-3 pb-2 pt-1 space-y-2">
                <input
                  autoFocus value={name} onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
                  placeholder="Название пространства"
                  className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none"
                  style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }}
                />
                {error && <p className="text-xs" style={{ color: "#dc2626" }}>{error}</p>}
                <div className="flex gap-2">
                  <button onClick={() => { setInline("none"); setName(""); setError(null); }}
                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: "var(--elevated)", border: "1px solid var(--border)", color: "var(--text-sec)" }}>
                    Отмена
                  </button>
                  <button onClick={handleCreate} disabled={busy}
                    className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg,#1565a8,#114e85)" }}>
                    {busy ? "…" : "Создать"}
                  </button>
                </div>
              </div>
            )}

            {inline === "join" && (
              <div className="px-3 pb-2 pt-1 space-y-2">
                <input
                  autoFocus value={code} onChange={e => setCode(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleJoin(); }}
                  placeholder="Инвайт-код"
                  className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none font-mono"
                  style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }}
                />
                {error && <p className="text-xs" style={{ color: "#dc2626" }}>{error}</p>}
                {info && <p className="text-xs" style={{ color: "#16a34a" }}>{info}</p>}
                <div className="flex gap-2">
                  <button onClick={() => { setInline("none"); setCode(""); setError(null); setInfo(null); }}
                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: "var(--elevated)", border: "1px solid var(--border)", color: "var(--text-sec)" }}>
                    Отмена
                  </button>
                  <button onClick={handleJoin} disabled={busy}
                    className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg,#1565a8,#114e85)" }}>
                    {busy ? "…" : "Войти"}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
