import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { workspacesApi } from "../../api/workspaces";
import { useTheme } from "../../contexts/ThemeContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { Workspace } from "../../types";

interface WorkspaceOnboardingProps {
  onCreated: () => void;
}

type Flow = "menu" | "create" | "join" | "search";

// --- Framer Motion animation constants (stable references, no per-render allocation) ---
const MODAL_INITIAL = { opacity: 0, scale: 0.96 } as const;
const MODAL_ANIMATE = { opacity: 1, scale: 1 } as const;
const MODAL_TRANSITION = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const } as const;

const FADE_INITIAL = { opacity: 0 } as const;
const FADE_ANIMATE = { opacity: 1 } as const;
const FADE_EXIT = { opacity: 0 } as const;
const FADE_TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const } as const;

const SLIDE_INITIAL = { opacity: 0, x: 10 } as const;
const SLIDE_ANIMATE = { opacity: 1, x: 0 } as const;
const SLIDE_EXIT = { opacity: 0, x: -10 } as const;
const SLIDE_TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const } as const;

const CARD_HOVER = { y: -3 } as const;
const CARD_TAP = { scale: 0.97 } as const;
const CARD_TRANSITION = { duration: 0.15, ease: [0.22, 1, 0.36, 1] as const } as const;
// ---------------------------------------------------------------------------------

const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "Europe/Moscow", label: "Europe/Moscow (МСК)" },
  { value: "Asia/Tashkent", label: "Asia/Tashkent (Ташкент)" },
  { value: "Asia/Almaty", label: "Asia/Almaty (Алматы)" },
  { value: "Asia/Baku", label: "Asia/Baku (Баку)" },
];

const BuildingIcon = ({ size = 36 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21h18" />
    <path d="M5 21V7l8-4v18" />
    <path d="M19 21V11l-6-4" />
    <path d="M9 9v.01" />
    <path d="M9 12v.01" />
    <path d="M9 15v.01" />
    <path d="M9 18v.01" />
  </svg>
);

const KeyIcon = ({ size = 36 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-9.6 9.6" />
    <path d="m15.5 7.5 3 3L22 7l-3-3" />
  </svg>
);

const SearchIcon = ({ size = 36 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

export function WorkspaceOnboarding({ onCreated }: WorkspaceOnboardingProps) {
  const { isDark } = useTheme();
  const { refetchWorkspaces } = useWorkspace();
  const [flow, setFlow] = useState<Flow>("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [tz, setTz] = useState("Europe/Moscow");
  const [inviteCode, setInviteCode] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<Workspace[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (flow !== "search") return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQ.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await workspacesApi.search(searchQ.trim());
        setSearchResults(res);
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQ, flow]);

  const resetMessages = () => { setError(null); setSuccessMsg(null); };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    if (!name.trim()) { setError("Введите название"); return; }
    setBusy(true);
    try {
      await workspacesApi.create({ name: name.trim(), timezone: tz });
      await refetchWorkspaces();
      onCreated();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Не удалось создать пространство");
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (code: string) => {
    resetMessages();
    if (!code.trim()) { setError("Введите код"); return; }
    setBusy(true);
    try {
      const member = await workspacesApi.join(code.trim());
      await refetchWorkspaces();
      if (member.status === "active") {
        onCreated();
      } else {
        setSuccessMsg("Заявка отправлена, ожидайте подтверждения");
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Не удалось присоединиться");
    } finally {
      setBusy(false);
    }
  };

  const overlayBg = isDark ? "rgba(2,6,23,0.92)" : "rgba(248,250,252,0.96)";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 overflow-y-auto py-10"
      style={{ background: overlayBg, backdropFilter: "blur(8px)" }}
    >
      <motion.div
        initial={MODAL_INITIAL}
        animate={MODAL_ANIMATE}
        transition={MODAL_TRANSITION}
        className="w-full max-w-2xl rounded-md"
        style={{
          background: "var(--modal)",
          border: "1px solid var(--border)",
          boxShadow: isDark
            ? "0 32px 80px rgba(0,0,0,0.6)"
            : "0 24px 64px rgba(15,23,42,0.18)",
        }}
      >
        <div className="px-7 py-6">
          {flow !== "menu" && (
            <button
              onClick={() => { setFlow("menu"); resetMessages(); }}
              className="flex items-center gap-1.5 mb-4 px-2.5 py-1.5 rounded text-xs font-semibold transition-all"
              style={{ color: "var(--text-muted)", background: "var(--elevated)", border: "1px solid var(--border)", transition: "color 0.15s ease" }}
              onMouseEnter={e => { e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <BackIcon />
              Назад
            </button>
          )}

          <AnimatePresence mode="wait">
            {flow === "menu" && (
              <motion.div key="menu" initial={FADE_INITIAL} animate={FADE_ANIMATE} exit={FADE_EXIT} transition={FADE_TRANSITION}>
                <div className="text-center mb-7">
                  <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--text)" }}>
                    Добро пожаловать в CorpMeet
                  </h1>
                  <p className="text-sm" style={{ color: "var(--text-sec)" }}>
                    Создайте рабочее пространство или присоединитесь к существующему
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <MenuCard label="Создать рабочее пространство" desc="С нуля, для вашей команды" Icon={BuildingIcon} onClick={() => setFlow("create")} />
                  <MenuCard label="Войти по коду" desc="У меня есть инвайт-код" Icon={KeyIcon} onClick={() => setFlow("join")} />
                  <MenuCard label="Найти по названию" desc="Поиск открытых команд" Icon={SearchIcon} onClick={() => setFlow("search")} />
                </div>
              </motion.div>
            )}

            {flow === "create" && (
              <motion.form key="create" onSubmit={handleCreate}
                initial={SLIDE_INITIAL} animate={SLIDE_ANIMATE} exit={SLIDE_EXIT}
                transition={SLIDE_TRANSITION}
                className="space-y-4"
              >
                <h2 className="text-xl font-bold" style={{ color: "var(--text)" }}>Новое пространство</h2>
                <FieldLabel>Название</FieldLabel>
                <input
                  autoFocus value={name} onChange={e => setName(e.target.value)}
                  placeholder="Команда проектов"
                  className="w-full rounded-md px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--input-bg)", border: "1.5px solid var(--input-border)", color: "var(--text)" }}
                />
                <FieldLabel>Часовой пояс</FieldLabel>
                <select
                  value={tz} onChange={e => setTz(e.target.value)}
                  className="w-full rounded-md px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--input-bg)", border: "1.5px solid var(--input-border)", color: "var(--text)" }}
                >
                  {TIMEZONES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>

                {error && <ErrorBox>{error}</ErrorBox>}

                <button type="submit" disabled={busy}
                  className="w-full py-2.5 rounded-md text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#1565a8,#114e85)", boxShadow: "0 4px 16px rgba(21,101,168,0.25)" }}>
                  {busy ? "Создаём…" : "Создать"}
                </button>
              </motion.form>
            )}

            {flow === "join" && (
              <motion.form key="join"
                initial={SLIDE_INITIAL} animate={SLIDE_ANIMATE} exit={SLIDE_EXIT}
                transition={SLIDE_TRANSITION}
                onSubmit={e => { e.preventDefault(); handleJoin(inviteCode); }}
                className="space-y-4"
              >
                <h2 className="text-xl font-bold" style={{ color: "var(--text)" }}>Войти по коду</h2>
                <FieldLabel>Инвайт-код</FieldLabel>
                <input
                  autoFocus value={inviteCode} onChange={e => setInviteCode(e.target.value)}
                  placeholder="например: ABCDEF12"
                  className="w-full rounded-md px-3 py-2.5 text-sm outline-none font-mono tracking-wider"
                  style={{ background: "var(--input-bg)", border: "1.5px solid var(--input-border)", color: "var(--text)" }}
                />

                {error && <ErrorBox>{error}</ErrorBox>}
                {successMsg && <SuccessBox>{successMsg}</SuccessBox>}

                <button type="submit" disabled={busy}
                  className="w-full py-2.5 rounded-md text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#1565a8,#114e85)", boxShadow: "0 4px 16px rgba(21,101,168,0.25)" }}>
                  {busy ? "Отправляем…" : "Войти"}
                </button>
              </motion.form>
            )}

            {flow === "search" && (
              <motion.div key="search"
                initial={SLIDE_INITIAL} animate={SLIDE_ANIMATE} exit={SLIDE_EXIT}
                transition={SLIDE_TRANSITION}
                className="space-y-4"
              >
                <h2 className="text-xl font-bold" style={{ color: "var(--text)" }}>Найти по названию</h2>
                <input
                  autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)}
                  placeholder="Начните вводить название…"
                  className="w-full rounded-md px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--input-bg)", border: "1.5px solid var(--input-border)", color: "var(--text)" }}
                />

                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {searchResults.length === 0 && searchQ.trim() && (
                    <p className="text-xs text-center py-4" style={{ color: "var(--text-muted)" }}>
                      Ничего не найдено
                    </p>
                  )}
                  {searchResults.map(w => (
                    <button
                      key={w.id}
                      type="button"
                      disabled={busy}
                      onClick={() => handleJoin(w.invite_code)}
                      className="w-full text-left px-4 py-3 rounded-md transition-all disabled:opacity-50"
                      style={{ background: "var(--elevated)", border: "1px solid var(--border)", transition: "border-color 0.15s ease" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--primary)"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
                    >
                      <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{w.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                        Войти в «{w.name}»
                      </p>
                    </button>
                  ))}
                </div>

                {error && <ErrorBox>{error}</ErrorBox>}
                {successMsg && <SuccessBox>{successMsg}</SuccessBox>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

function MenuCard({ label, desc, Icon, onClick }: { label: string; desc: string; Icon: (p: { size?: number }) => React.ReactElement; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      whileHover={CARD_HOVER}
      whileTap={CARD_TAP}
      transition={CARD_TRANSITION}
      onClick={onClick}
      className="text-left p-5 rounded-md transition-all flex flex-col items-start gap-3"
      style={{
        background: "var(--elevated)",
        border: "1.5px solid var(--border)",
        color: "var(--text)",
        minHeight: 160,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = "var(--primary)";
        e.currentTarget.style.boxShadow = "0 8px 24px rgba(21,101,168,0.15)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ color: "var(--primary)" }}><Icon /></div>
      <div>
        <p className="text-sm font-bold mb-1">{label}</p>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{desc}</p>
      </div>
    </motion.button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-sec)" }}>{children}</label>;
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs rounded-md px-3 py-2.5 font-medium"
      style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#dc2626" }}>
      {children}
    </p>
  );
}

function SuccessBox({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs rounded-md px-3 py-2.5 font-medium"
      style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#16a34a" }}>
      {children}
    </p>
  );
}
