import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { roomsApi } from "../../api/rooms";
import { workspacesApi } from "../../api/workspaces";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../contexts/ThemeContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { RoomJoinRequest, WorkspaceMember, WorkspaceRoom } from "../../types";

interface WorkspaceSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = "general" | "members" | "rooms";

const TIMEZONES = [
  "UTC",
  "Europe/Moscow",
  "Asia/Tashkent",
  "Asia/Almaty",
  "Asia/Baku",
];

export function WorkspaceSettingsModal({ open, onClose }: WorkspaceSettingsModalProps) {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const { activeWorkspace, myRooms, refetchWorkspaces, refetchRooms } = useWorkspace();
  const [tab, setTab] = useState<Tab>("general");

  if (!open) return null;
  if (!activeWorkspace) {
    return (
      <Overlay isDark={isDark} onClose={onClose}>
        <div className="p-8 text-center">
          <p style={{ color: "var(--text-sec)" }}>Нет активного пространства</p>
        </div>
      </Overlay>
    );
  }

  const isOwner = activeWorkspace.my_role === "owner";
  const isAdmin = isOwner || activeWorkspace.my_role === "admin";

  return (
    <Overlay isDark={isDark} onClose={onClose}>
      <div className="px-6 pt-5 pb-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border)" }}>
        <div>
          <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>
            Настройки · {activeWorkspace.name}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Ваша роль: {roleLabel(activeWorkspace.my_role)}
          </p>
        </div>
        <button onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full text-xl leading-none"
          style={{ color: "var(--text-muted)", background: "var(--elevated)" }}>
          ×
        </button>
      </div>

      <div className="flex gap-1 px-6 pt-3" style={{ borderBottom: "1px solid var(--border)" }}>
        {([["general", "Общее"], ["members", "Участники"], ["rooms", "Переговорные"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="px-3 py-2 text-xs font-semibold transition-all"
            style={{
              color: tab === k ? "var(--primary)" : "var(--text-muted)",
              borderBottom: tab === k ? "2px solid var(--primary)" : "2px solid transparent",
              marginBottom: -1,
            }}>
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "calc(80vh - 130px)" }}>
        {tab === "general" && (
          <GeneralTab
            workspaceId={activeWorkspace.id}
            initialName={activeWorkspace.name}
            initialTz={activeWorkspace.timezone}
            inviteCode={activeWorkspace.invite_code}
            isOwner={isOwner}
            isAdmin={isAdmin}
            onChanged={refetchWorkspaces}
            onArchived={() => { refetchWorkspaces(); onClose(); }}
          />
        )}
        {tab === "members" && (
          <MembersTab
            workspaceId={activeWorkspace.id}
            myUserId={user?.id ?? null}
            isAdmin={isAdmin}
          />
        )}
        {tab === "rooms" && (
          <RoomsTab
            workspaceId={activeWorkspace.id}
            rooms={myRooms.filter(r => r.workspace_id === activeWorkspace.id)}
            isAdmin={isAdmin}
            onRefetch={refetchRooms}
          />
        )}
      </div>
    </Overlay>
  );
}

function Overlay({ isDark, onClose, children }: { isDark: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[55] flex items-center justify-center px-4"
        style={{ background: isDark ? "rgba(0,0,0,0.72)" : "rgba(15,23,42,0.55)" }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97 }}
          transition={{ type: "spring", damping: 22, stiffness: 320 }}
          onClick={e => e.stopPropagation()}
          className="w-full rounded-2xl flex flex-col"
          style={{
            background: "var(--modal)",
            border: "1px solid var(--border)",
            boxShadow: isDark ? "0 32px 80px rgba(0,0,0,0.7)" : "0 24px 64px rgba(15,23,42,0.18)",
            maxWidth: 640,
            maxHeight: "80vh",
          }}
        >
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function roleLabel(role: string | null): string {
  if (role === "owner") return "владелец";
  if (role === "admin") return "администратор";
  if (role === "member") return "участник";
  return "—";
}

function GeneralTab({
  workspaceId, initialName, initialTz, inviteCode, isOwner, isAdmin,
  onChanged, onArchived,
}: {
  workspaceId: number;
  initialName: string;
  initialTz: string;
  inviteCode: string;
  isOwner: boolean;
  isAdmin: boolean;
  onChanged: () => void;
  onArchived: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [tz, setTz] = useState(initialTz);
  const [code, setCode] = useState(inviteCode);
  const [copied, setCopied] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingTz, setSavingTz] = useState(false);
  const [regenerating, setRegen] = useState(false);
  const [archiving, setArch] = useState(false);
  const [confirmArchive, setConfirmArch] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setName(initialName); setTz(initialTz); setCode(inviteCode); }, [initialName, initialTz, inviteCode]);

  const saveName = async () => {
    setErr(null);
    if (!name.trim()) { setErr("Название не может быть пустым"); return; }
    setSavingName(true);
    try {
      await workspacesApi.update(workspaceId, { name: name.trim() });
      onChanged();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Не удалось сохранить");
    } finally { setSavingName(false); }
  };

  const saveTz = async (next: string) => {
    setErr(null);
    setSavingTz(true);
    try {
      await workspacesApi.update(workspaceId, { timezone: next });
      setTz(next);
      onChanged();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Не удалось сохранить");
    } finally { setSavingTz(false); }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleRegen = async () => {
    setErr(null); setRegen(true);
    try {
      const ws = await workspacesApi.regenerateCode(workspaceId);
      setCode(ws.invite_code);
      onChanged();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Не удалось обновить код");
    } finally { setRegen(false); }
  };

  const handleArchive = async () => {
    setErr(null); setArch(true);
    try {
      await workspacesApi.archive(workspaceId);
      onArchived();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Не удалось архивировать");
      setArch(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <Label>Название</Label>
        <div className="flex gap-2">
          <input
            disabled={!isAdmin}
            value={name} onChange={e => setName(e.target.value)}
            className="flex-1 rounded-xl px-3 py-2 text-sm outline-none"
            style={{ background: "var(--input-bg)", border: "1.5px solid var(--input-border)", color: "var(--text)" }}
          />
          <button onClick={saveName} disabled={!isAdmin || savingName || name === initialName}
            className="px-4 rounded-xl text-xs font-bold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#1565a8,#114e85)" }}>
            {savingName ? "…" : "Сохранить"}
          </button>
        </div>
      </div>

      <div>
        <Label>Часовой пояс</Label>
        <select
          disabled={!isAdmin || savingTz}
          value={tz} onChange={e => saveTz(e.target.value)}
          className="w-full rounded-xl px-3 py-2 text-sm outline-none"
          style={{ background: "var(--input-bg)", border: "1.5px solid var(--input-border)", color: "var(--text)" }}
        >
          {TIMEZONES.includes(tz) ? null : <option value={tz}>{tz}</option>}
          {TIMEZONES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div>
        <Label>Инвайт-код</Label>
        <div className="flex gap-2">
          <div className="flex-1 rounded-xl px-3 py-2 text-sm font-mono tracking-wider"
            style={{ background: "var(--input-bg)", border: "1.5px solid var(--input-border)", color: "var(--text)" }}>
            {code}
          </div>
          <button onClick={handleCopy}
            className="px-3 rounded-xl text-xs font-bold transition-all"
            style={{ background: copied ? "rgba(34,197,94,0.15)" : "var(--elevated)", border: `1.5px solid ${copied ? "rgba(34,197,94,0.5)" : "var(--border)"}`, color: copied ? "#16a34a" : "var(--text-sec)" }}>
            {copied ? "Скопировано" : "Копировать"}
          </button>
          {isAdmin && (
            <button onClick={handleRegen} disabled={regenerating}
              className="px-3 rounded-xl text-xs font-bold disabled:opacity-50"
              style={{ background: "var(--elevated)", border: "1.5px solid var(--border)", color: "var(--text-sec)" }}>
              {regenerating ? "…" : "Обновить код"}
            </button>
          )}
        </div>
      </div>

      {err && <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#dc2626" }}>{err}</p>}

      {isOwner && (
        <div className="pt-4 mt-2" style={{ borderTop: "1px dashed var(--border)" }}>
          <Label>Удалить пространство</Label>
          {!confirmArchive ? (
            <button onClick={() => setConfirmArch(true)}
              className="px-4 py-2 rounded-xl text-xs font-bold"
              style={{ background: "rgba(239,68,68,0.08)", border: "1.5px solid rgba(239,68,68,0.35)", color: "#dc2626" }}>
              Архивировать пространство
            </button>
          ) : (
            <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)" }}>
              <p className="text-xs font-semibold" style={{ color: "#dc2626" }}>
                Точно архивировать? Это действие нельзя отменить.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmArch(false)}
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: "var(--elevated)", border: "1px solid var(--border)", color: "var(--text-sec)" }}>
                  Отмена
                </button>
                <button onClick={handleArchive} disabled={archiving}
                  className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#dc2626,#ef4444)" }}>
                  {archiving ? "…" : "Архивировать"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MembersTab({ workspaceId, myUserId, isAdmin }: { workspaceId: number; myUserId: number | null; isAdmin: boolean }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteName, setInviteName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = await workspacesApi.listMembers(workspaceId);
      setMembers(list);
    } catch { /* swallow */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workspaceId]);

  const active = members.filter(m => m.status === "active");
  const pending = members.filter(m => m.status === "pending");

  const handleInvite = async () => {
    setErr(null); setInfo(null);
    const u = inviteName.trim().replace(/^@/, "");
    if (!u) { setErr("Введите username"); return; }
    setInviting(true);
    try {
      await workspacesApi.invite(workspaceId, u);
      setInviteName("");
      setInfo("Приглашение отправлено");
      await load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Не удалось пригласить");
    } finally { setInviting(false); }
  };

  const handleApprove = async (memberId: number, approve: boolean) => {
    try {
      await workspacesApi.updateMember(workspaceId, memberId, { approve });
      await load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Не удалось обновить");
    }
  };

  const handleRemove = async (memberId: number) => {
    try {
      await workspacesApi.removeMember(workspaceId, memberId);
      await load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Не удалось удалить");
    }
  };

  return (
    <div className="space-y-5">
      {isAdmin && (
        <div>
          <Label>Пригласить по username</Label>
          <div className="flex gap-2">
            <input
              value={inviteName} onChange={e => setInviteName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleInvite(); }}
              placeholder="@username"
              className="flex-1 rounded-xl px-3 py-2 text-sm outline-none"
              style={{ background: "var(--input-bg)", border: "1.5px solid var(--input-border)", color: "var(--text)" }}
            />
            <button onClick={handleInvite} disabled={inviting}
              className="px-4 rounded-xl text-xs font-bold text-white disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#1565a8,#114e85)" }}>
              {inviting ? "…" : "Пригласить"}
            </button>
          </div>
          {err && <p className="text-xs mt-1.5" style={{ color: "#dc2626" }}>{err}</p>}
          {info && <p className="text-xs mt-1.5" style={{ color: "#16a34a" }}>{info}</p>}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-center py-4" style={{ color: "var(--text-muted)" }}>Загрузка…</p>
      ) : (
        <>
          {pending.length > 0 && (
            <div>
              <Label>Ожидают подтверждения</Label>
              <div className="space-y-2">
                {pending.map(m => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-xl"
                    style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
                    <MemberAvatar member={m} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
                        {memberName(m)}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>ожидает</p>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1.5">
                        <button onClick={() => handleApprove(m.id, true)}
                          className="px-2.5 py-1 rounded-lg text-xs font-bold text-white"
                          style={{ background: "linear-gradient(135deg,#16a34a,#15803d)" }}>
                          Принять
                        </button>
                        <button onClick={() => handleApprove(m.id, false)}
                          className="px-2.5 py-1 rounded-lg text-xs font-bold"
                          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#dc2626" }}>
                          Отклонить
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label>Активные ({active.length})</Label>
            <div className="space-y-2">
              {active.map(m => {
                const canRemove = isAdmin && m.user_id !== myUserId && m.role !== "owner";
                return (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-xl"
                    style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
                    <MemberAvatar member={m} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
                        {memberName(m)}
                      </p>
                      <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                        {[
                          m.user?.position,
                          m.user?.role && m.user.role !== "user" ? (m.user.role === "superadmin" ? "Суперадмин" : "Администратор") : null,
                          roleLabel(m.role),
                        ].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <RoleBadge role={m.role} />
                    {canRemove && (
                      <button onClick={() => handleRemove(m.id)}
                        title="Удалить"
                        className="w-7 h-7 flex items-center justify-center rounded-lg"
                        style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#dc2626" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function memberName(m: WorkspaceMember): string {
  if (m.user) return m.user.display_name;
  if (m.pending_username) return `@${m.pending_username}`;
  return "—";
}

function MemberAvatar({ member }: { member: WorkspaceMember }) {
  const name = memberName(member);
  const initial = name.replace("@", "").charAt(0).toUpperCase() || "?";
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
      style={{ background: "var(--primary-light)", color: "var(--primary)" }}>
      {initial}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const palette: Record<string, { bg: string; color: string }> = {
    owner: { bg: "rgba(217,119,6,0.12)", color: "#d97706" },
    admin: { bg: "rgba(21,101,168,0.12)", color: "#1565a8" },
    member: { bg: "var(--elevated)", color: "var(--text-muted)" },
  };
  const p = palette[role] ?? palette.member;
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-lg"
      style={{ background: p.bg, color: p.color }}>
      {roleLabel(role)}
    </span>
  );
}

function RoomsTab({ workspaceId, rooms, isAdmin, onRefetch }:
  { workspaceId: number; rooms: WorkspaceRoom[]; isAdmin: boolean; onRefetch: () => void }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinInfo, setJoinInfo] = useState<string | null>(null);

  const handleCreate = async () => {
    setErr(null);
    if (!newName.trim()) { setErr("Введите название"); return; }
    setBusy(true);
    try {
      await roomsApi.create({ name: newName.trim(), description: newDesc.trim() || undefined, workspace_id: workspaceId });
      setNewName(""); setNewDesc(""); setCreating(false);
      onRefetch();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Не удалось создать");
    } finally { setBusy(false); }
  };

  const handleJoin = async () => {
    setErr(null); setJoinInfo(null);
    if (!joinCode.trim()) { setErr("Введите код комнаты"); return; }
    setBusy(true);
    try {
      const result = await roomsApi.join(joinCode.trim(), workspaceId);
      if (result.status === 201) {
        setJoinCode(""); setJoining(false);
        onRefetch();
      } else if (result.status === 202) {
        setJoinCode("");
        setJoinInfo("⏳ Заявка отправлена. Ждём подтверждения от владельца комнаты.");
      }
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number; data?: { detail?: string } } })?.response?.status;
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (status === 403) {
        setErr("❌ Подключение по коду отключено для этой комнаты.");
      } else {
        setErr(msg ?? "Не удалось добавить комнату");
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {rooms.length === 0 && (
        <p className="text-xs text-center py-4" style={{ color: "var(--text-muted)" }}>Комнат пока нет</p>
      )}
      {rooms.map(r => (
        <RoomRow key={r.id} wr={r} workspaceId={workspaceId} isAdmin={isAdmin} onRefetch={onRefetch} />
      ))}

      {isAdmin && (
        <div className="pt-3 space-y-2" style={{ borderTop: "1px dashed var(--border)" }}>
          {!creating && !joining && (
            <div className="flex gap-2">
              <button onClick={() => setCreating(true)}
                className="flex-1 py-2 rounded-xl text-xs font-bold"
                style={{ background: "var(--primary-light)", border: "1.5px solid var(--primary-border)", color: "var(--primary)" }}>
                + Создать комнату
              </button>
              <button onClick={() => setJoining(true)}
                className="flex-1 py-2 rounded-xl text-xs font-bold"
                style={{ background: "var(--elevated)", border: "1.5px solid var(--border)", color: "var(--text-sec)" }}>
                Добавить по коду
              </button>
            </div>
          )}
          {creating && (
            <div className="space-y-2 rounded-xl p-3" style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
              <input
                autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Название переговорной"
                className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
                style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }}
              />
              <input
                value={newDesc} onChange={e => setNewDesc(e.target.value)}
                placeholder="Описание (необязательно)"
                className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
                style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }}
              />
              {err && <p className="text-xs" style={{ color: "#dc2626" }}>{err}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setCreating(false); setNewName(""); setNewDesc(""); setErr(null); }}
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
          {joining && (
            <div className="space-y-2 rounded-xl p-3" style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                Введите код комнаты из другого пространства
              </p>
              <input
                autoFocus value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Например: A1B2C3D4"
                className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none font-mono"
                style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)", letterSpacing: "0.1em" }}
                onKeyDown={e => { if (e.key === "Enter") handleJoin(); }}
              />
              {err && <p className="text-xs" style={{ color: "#dc2626" }}>{err}</p>}
              {joinInfo && <p className="text-xs" style={{ color: "#0891b2" }}>{joinInfo}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setJoining(false); setJoinCode(""); setErr(null); setJoinInfo(null); }}
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: "var(--elevated)", border: "1px solid var(--border)", color: "var(--text-sec)" }}>
                  Отмена
                </button>
                <button onClick={handleJoin} disabled={busy}
                  className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#1565a8,#114e85)" }}>
                  {busy ? "…" : "Добавить"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RoomRow({ wr, workspaceId, isAdmin, onRefetch }:
  { wr: WorkspaceRoom; workspaceId: number; isAdmin: boolean; onRefetch: () => void }) {
  const [showShare, setShowShare] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmArch, setConfirmArch] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [joinRequests, setJoinRequests] = useState<RoomJoinRequest[]>([]);
  const [localJoinMode, setLocalJoinMode] = useState<"open" | "approval" | "closed">(wr.room.join_mode ?? "approval");
  const [localVis, setLocalVis] = useState<"full" | "busy_only">(wr.visibility ?? "full");

  const isOwnerRoom = wr.role === "owner";

  useEffect(() => {
    setLocalJoinMode(wr.room.join_mode ?? "approval");
    setLocalVis(wr.visibility ?? "full");
  }, [wr.room.join_mode, wr.visibility]);

  useEffect(() => {
    if (!isOwnerRoom || !isAdmin) return;
    roomsApi.listJoinRequests(wr.room.id).then(setJoinRequests).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wr.room.id]);

  const handleVis = (v: "full" | "busy_only") => {
    setLocalVis(v);
    roomsApi.updateVisibility(wr.room.id, workspaceId, v)
      .then(() => onRefetch())
      .catch(() => { setLocalVis(wr.visibility ?? "full"); setErr("Не удалось обновить"); });
  };

  const handleJoinMode = (mode: "open" | "approval" | "closed") => {
    setLocalJoinMode(mode);
    roomsApi.update(wr.room.id, { join_mode: mode })
      .then(() => onRefetch())
      .catch(() => { setLocalJoinMode(wr.room.join_mode ?? "approval"); setErr("Не удалось обновить"); });
  };

  const handleShare = async () => {
    setErr(null);
    if (!shareCode.trim()) { setErr("Введите код"); return; }
    setBusy(true);
    try {
      await roomsApi.share(wr.room.id, shareCode.trim());
      setShareCode(""); setShowShare(false);
      onRefetch();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Не удалось поделиться");
    } finally { setBusy(false); }
  };

  const handleArchive = async () => {
    setErr(null); setBusy(true);
    try {
      await roomsApi.archive(wr.room.id);
      onRefetch();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Не удалось архивировать");
      setBusy(false);
    }
  };

  const handleRegen = async () => {
    setErr(null); setBusy(true);
    try {
      await roomsApi.regenerateCode(wr.room.id);
      setConfirmRegen(false);
      onRefetch();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Не удалось сменить код");
      setBusy(false);
    }
  };

  const handleApproveRequest = async (reqId: number) => {
    try {
      await roomsApi.approveJoinRequest(wr.room.id, reqId);
      setJoinRequests(r => r.filter(x => x.id !== reqId));
      onRefetch();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Не удалось принять");
    }
  };

  const handleRejectRequest = async (reqId: number) => {
    try {
      await roomsApi.rejectJoinRequest(wr.room.id, reqId);
      setJoinRequests(r => r.filter(x => x.id !== reqId));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Не удалось отклонить");
    }
  };

  const handleCopyCode = () => {
    if (!wr.room.invite_code) return;
    navigator.clipboard.writeText(wr.room.invite_code).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1500);
    });
  };

  return (
    <div className="rounded-xl p-3"
      style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold truncate" style={{ color: "var(--text)" }}>{wr.room.name}</p>
            {!isOwnerRoom && (
              <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                style={{ background: "rgba(124,58,237,0.12)", color: "#7c3aed" }}>
                shared
              </span>
            )}
          </div>
          {wr.room.description && (
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{wr.room.description}</p>
          )}
        </div>
      </div>

      {isOwnerRoom && wr.room.invite_code && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>Код:</span>
          <code className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: "var(--bg)", color: "var(--primary)", border: "1px solid var(--primary-border)", letterSpacing: "0.1em" }}>
            {wr.room.invite_code}
          </code>
          <button onClick={handleCopyCode}
            className="px-2 py-0.5 rounded text-xs font-semibold transition-all"
            style={{ background: copiedCode ? "rgba(34,197,94,0.12)" : "var(--bg)", color: copiedCode ? "#16a34a" : "var(--text-muted)", border: `1px solid ${copiedCode ? "rgba(34,197,94,0.4)" : "var(--border)"}` }}>
            {copiedCode ? "✓" : "Копировать"}
          </button>
          {!confirmRegen ? (
            <button onClick={() => setConfirmRegen(true)}
              className="px-2 py-0.5 rounded text-xs font-semibold"
              style={{ background: "var(--bg)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
              Сменить код
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs" style={{ color: "#d97706" }}>Сменить?</span>
              <button onClick={handleRegen} disabled={busy}
                className="px-2 py-0.5 rounded text-xs font-bold text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#d97706,#b45309)" }}>
                {busy ? "…" : "Да"}
              </button>
              <button onClick={() => setConfirmRegen(false)}
                className="px-2 py-0.5 rounded text-xs font-semibold"
                style={{ background: "var(--elevated)", color: "var(--text-sec)", border: "1px solid var(--border)" }}>
                Нет
              </button>
            </div>
          )}
        </div>
      )}

      {isOwnerRoom && isAdmin && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold shrink-0" style={{ color: "var(--text-muted)" }}>Подключение:</span>
          <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            {([
              { v: "open",     label: "Открытое" },
              { v: "approval", label: "С подтверждением" },
              { v: "closed",   label: "Закрытое" },
            ] as const).map(({ v, label }) => {
              const active = localJoinMode === v;
              return (
                <button key={v} onClick={() => handleJoinMode(v)} disabled={active}
                  className="px-2 py-1 text-xs font-semibold transition-all"
                  style={{
                    background: active ? "var(--primary)" : "transparent",
                    color: active ? "#fff" : "var(--text-sec)",
                  }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {(isOwnerRoom || isAdmin) && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>Видимость:</span>
          <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            {(["full", "busy_only"] as const).map(v => {
              const active = localVis === v;
              return (
                <button key={v} onClick={() => handleVis(v)} disabled={active}
                  className="px-2.5 py-1 text-xs font-semibold transition-all"
                  style={{
                    background: active ? "var(--primary)" : "transparent",
                    color: active ? "#fff" : "var(--text-sec)",
                  }}>
                  {v === "full" ? "полная" : "только занятость"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {joinRequests.length > 0 && (
        <div className="mb-2 space-y-1">
          <p className="text-xs font-semibold" style={{ color: "var(--text-sec)" }}>Заявки на подключение:</p>
          {joinRequests.map(req => (
            <div key={req.id} className="flex items-center gap-2 px-2 py-1 rounded-lg"
              style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold truncate" style={{ color: "var(--text)" }}>{req.workspace_name}</span>
                {req.requested_by && (
                  <span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>· {req.requested_by}</span>
                )}
              </div>
              <button onClick={() => handleApproveRequest(req.id)}
                className="px-2 py-0.5 rounded text-xs font-bold text-white shrink-0"
                style={{ background: "linear-gradient(135deg,#16a34a,#15803d)" }}>
                Принять
              </button>
              <button onClick={() => handleRejectRequest(req.id)}
                className="px-2 py-0.5 rounded text-xs font-bold shrink-0"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#dc2626" }}>
                Отклонить
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {isOwnerRoom && (
          <button onClick={() => setShowShare(v => !v)}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold"
            style={{ background: "var(--primary-light)", border: "1px solid var(--primary-border)", color: "var(--primary)" }}>
            Поделиться
          </button>
        )}
        {isOwnerRoom && isAdmin && !confirmArch && (
          <button onClick={() => setConfirmArch(true)}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "#dc2626" }}>
            Архивировать
          </button>
        )}
        {confirmArch && (
          <div className="flex gap-1.5">
            <button onClick={() => setConfirmArch(false)}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold"
              style={{ background: "var(--elevated)", border: "1px solid var(--border)", color: "var(--text-sec)" }}>
              Отмена
            </button>
            <button onClick={handleArchive} disabled={busy}
              className="px-2.5 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#dc2626,#ef4444)" }}>
              {busy ? "…" : "Подтвердить"}
            </button>
          </div>
        )}
      </div>

      {showShare && isOwnerRoom && (
        <div className="mt-2 flex gap-2">
          <input
            autoFocus value={shareCode} onChange={e => setShareCode(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleShare(); }}
            placeholder="Инвайт-код целевого пространства"
            className="flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none font-mono"
            style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }}
          />
          <button onClick={handleShare} disabled={busy}
            className="px-3 rounded-lg text-xs font-bold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#1565a8,#114e85)" }}>
            {busy ? "…" : "Отправить"}
          </button>
        </div>
      )}

      {err && <p className="text-xs mt-2" style={{ color: "#dc2626" }}>{err}</p>}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--text-sec)" }}>{children}</p>;
}
