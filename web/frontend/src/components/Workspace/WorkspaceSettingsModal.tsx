import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { roomsApi } from "../../api/rooms";
import { workspacesApi } from "../../api/workspaces";
import { addNotification } from "../Dashboard/NotificationCenter";
import type { WorkspaceAnalytics } from "../../api/workspaces";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { RoomJoinRequest, WorkspaceMember, WorkspaceRoom } from "../../types";

interface WorkspaceSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = "general" | "members" | "rooms" | "analytics";

const TIMEZONES = [
  "UTC",
  "Europe/Moscow",
  "Asia/Tashkent",
  "Asia/Almaty",
  "Asia/Baku",
];

const POSITIONS = [
  "Начальник департамента/отдела",
  "PM",
  "Аналитик",
  "Программист и др.",
  "Дизайнер",
];

const POSITION_T_KEYS: Record<string, string> = {
  "Начальник департамента/отдела": "pos.chief",
  "PM": "pos.pm",
  "Аналитик": "pos.analyst",
  "Программист и др.": "pos.programmer",
  "Дизайнер": "pos.designer",
};

export function WorkspaceSettingsModal({ open, onClose }: WorkspaceSettingsModalProps) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const { user } = useAuth();
  const { activeWorkspace, myRooms, refetchWorkspaces, refetchRooms } = useWorkspace();
  const [tab, setTab] = useState<Tab>("general");
  const TAB_KEYS: Tab[] = ["general", "members", "rooms", "analytics"];
  const prevTabRef = useRef<Tab>("general");
  const tabDirRef = useRef<1 | -1>(1);

  const handleTabChange = (newTab: Tab) => {
    const oldIdx = TAB_KEYS.indexOf(prevTabRef.current);
    const newIdx = TAB_KEYS.indexOf(newTab);
    tabDirRef.current = newIdx >= oldIdx ? 1 : -1;
    prevTabRef.current = newTab;
    setTab(newTab);
  };

  useEffect(() => {
    if (open) refetchRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  if (!activeWorkspace) {
    return (
      <Overlay isDark={isDark} onClose={onClose}>
        <div className="p-8 text-center">
          <p style={{ color: "var(--text-sec)" }}>{t("ws.noActive")}</p>
        </div>
      </Overlay>
    );
  }

  const isOwner = activeWorkspace.my_role === "owner";
  const isSuperadmin = user?.role === "superadmin";
  const isAdmin = isOwner || activeWorkspace.my_role === "admin" || isSuperadmin;

  return (
    <Overlay isDark={isDark} onClose={onClose}>
      <div className="px-6 pt-5 pb-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border)" }}>
        <div>
          <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>
            {t("ws.settingsTitle")} · {activeWorkspace.name}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {t("ws.myRole")} {roleLabel(activeWorkspace.my_role, t)}
          </p>
        </div>
        <button onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full transition-all"
          style={{ color: "var(--text-muted)", background: "var(--elevated)" }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/>
          </svg>
        </button>
      </div>

      <div className="flex gap-1 px-6 pt-3" style={{ borderBottom: "1px solid var(--border)" }}>
        {([["general", t("ws.tabGeneral")], ["members", t("ws.tabMembers")], ["rooms", t("ws.tabRooms")], ["analytics", t("ws.tabAnalytics")]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => handleTabChange(k)}
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

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div key={tab} className="t-tab-enter" data-dir={String(tabDirRef.current)}>
          {tab === "general" && (
            <GeneralTab
              workspaceId={activeWorkspace.id}
              initialName={activeWorkspace.name}
              initialTz={activeWorkspace.timezone}
              inviteCode={activeWorkspace.invite_code}
              tgInviteLink={activeWorkspace.tg_invite_link ?? null}
              isOwner={isOwner}
              isAdmin={isAdmin}
              isSuperadmin={isSuperadmin}
              onChanged={refetchWorkspaces}
              onArchived={() => { refetchWorkspaces(); onClose(); }}
            />
          )}
          {tab === "members" && (
            <MembersTab
              workspaceId={activeWorkspace.id}
              myUserId={user?.id ?? null}
              isAdmin={isAdmin}
              isOwner={isOwner}
              isSuperadmin={isSuperadmin}
            />
          )}
          {tab === "rooms" && (
            <RoomsTab
              workspaceId={activeWorkspace.id}
              rooms={myRooms.filter(r => r.workspace_id === activeWorkspace.id)}
              isAdmin={isAdmin}
              isSuperadmin={isSuperadmin}
              onRefetch={refetchRooms}
            />
          )}
          {tab === "analytics" && isAdmin && (
            <AnalyticsTab workspaceId={activeWorkspace.id} />
          )}
        </div>
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
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          onClick={e => e.stopPropagation()}
          className="w-full rounded flex flex-col"
          style={{
            background: "var(--modal)",
            border: "1px solid var(--border)",
            boxShadow: isDark ? "0 32px 80px rgba(0,0,0,0.7)" : "0 24px 64px rgba(15,23,42,0.18)",
            maxWidth: 640,
            height: "min(640px, 80vh)",
          }}
        >
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function roleLabel(role: string | null, t: (k: string) => string): string {
  if (role === "owner") return t("ws.roleOwner");
  if (role === "admin") return t("ws.roleAdmin");
  if (role === "member") return t("ws.roleMember");
  return "—";
}

function GeneralTab({
  workspaceId, initialName, initialTz, inviteCode, tgInviteLink, isOwner, isAdmin, isSuperadmin,
  onChanged, onArchived,
}: {
  workspaceId: number;
  initialName: string;
  initialTz: string;
  inviteCode: string;
  tgInviteLink: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  isSuperadmin: boolean;
  onChanged: () => void;
  onArchived: () => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState(initialName);
  const [tz, setTz] = useState(initialTz);
  const [code, setCode] = useState(inviteCode);
  const [tgLink, setTgLink] = useState(tgInviteLink);
  const [copied, setCopied] = useState(false);
  const [copiedTg, setCopiedTg] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingTz, setSavingTz] = useState(false);
  const [regenerating, setRegen] = useState(false);
  const [archiving, setArch] = useState(false);
  const [confirmArchive, setConfirmArch] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setName(initialName); setTz(initialTz); setCode(inviteCode); setTgLink(tgInviteLink); }, [initialName, initialTz, inviteCode, tgInviteLink]);

  const errRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!err || !errRef.current) return;
    const el = errRef.current;
    el.classList.remove("is-shaking");
    void el.offsetWidth;
    el.classList.add("is-shaking");
    const id = setTimeout(() => el.classList.remove("is-shaking"), 280);
    return () => clearTimeout(id);
  }, [err]);

  const saveName = async () => {
    setErr(null);
    if (!name.trim()) { setErr(t("ws.nameEmpty")); return; }
    setSavingName(true);
    try {
      await workspacesApi.update(workspaceId, { name: name.trim() });
      onChanged();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? t("ws.saveFail"));
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
      setErr(msg ?? t("ws.saveFail"));
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
      setTgLink(ws.tg_invite_link ?? null);
      onChanged();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? t("ws.regenFail"));
    } finally { setRegen(false); }
  };

  const handleArchive = async () => {
    setErr(null); setArch(true);
    try {
      await workspacesApi.archive(workspaceId);
      onArchived();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? t("ws.archiveFail"));
      setArch(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <Label>{t("ws.labelName")}</Label>
        <div className="flex gap-2">
          <input
            disabled={!isAdmin}
            value={name} onChange={e => setName(e.target.value)}
            className="flex-1 rounded-md px-3 py-2 text-sm outline-none"
            style={{ background: "var(--input-bg)", border: "1.5px solid var(--input-border)", color: "var(--text)" }}
          />
          <button onClick={saveName} disabled={!isAdmin || savingName || name === initialName}
            className="px-4 rounded-md text-xs font-bold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#1565a8,#114e85)" }}>
            {savingName ? "…" : t("common.save")}
          </button>
        </div>
      </div>

      <div>
        <Label>{t("ws.labelTimezone")}</Label>
        <CustomSelect
          disabled={!isAdmin || savingTz}
          value={tz}
          onChange={saveTz}
          options={[
            ...(TIMEZONES.includes(tz) ? [] : [{ value: tz, label: tz }]),
            ...TIMEZONES.map(tz => ({ value: tz, label: tz })),
          ]}
        />
      </div>

      <div>
        <Label>{t("ws.labelInviteCode")}</Label>
        <div className="flex gap-2">
          <div className="flex-1 rounded-md px-3 py-2 text-sm font-mono tracking-wider"
            style={{ background: "var(--input-bg)", border: "1.5px solid var(--input-border)", color: "var(--text)" }}>
            {code}
          </div>
          <button onClick={handleCopy}
            className="px-3 rounded-md text-xs font-bold transition-all flex items-center gap-1"
            style={{ background: copied ? "rgba(34,197,94,0.15)" : "var(--elevated)", border: `1.5px solid ${copied ? "rgba(34,197,94,0.5)" : "var(--border)"}`, color: copied ? "#16a34a" : "var(--text-sec)" }}>
            {copied && (
              <span className="t-success-check" data-state="in" aria-hidden="true"
                style={{ "--check-y-amount": "5px", "--check-blur-from": "3px", "--check-rotate-from": "25deg" } as CSSProperties}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M1.5 5.5L4 8L9.5 2.5" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            )}
            {copied ? t("ws.copied") : t("ws.copy")}
          </button>
          {(isOwner || isSuperadmin) && (
            <button onClick={handleRegen} disabled={regenerating}
              className="px-3 rounded-md text-xs font-bold disabled:opacity-50"
              style={{ background: "var(--elevated)", border: "1.5px solid var(--border)", color: "var(--text-sec)" }}>
              {regenerating ? "…" : t("ws.update")}
            </button>
          )}
        </div>
      </div>

      {tgLink && (isOwner || isSuperadmin) && (
        <div>
          <Label>{t("ws.tgPublicLink")}</Label>
          <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            {t("ws.tgPublicLinkDesc")}
          </p>
          <div className="flex gap-2">
            <div className="flex-1 rounded-md px-3 py-2 text-xs font-mono truncate"
              style={{ background: "var(--input-bg)", border: "1.5px solid var(--input-border)", color: "var(--text)" }}>
              {tgLink}
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(tgLink); setCopiedTg(true); setTimeout(() => setCopiedTg(false), 1500); }}
              className="px-3 rounded-md text-xs font-bold transition-all"
              style={{ background: copiedTg ? "rgba(34,197,94,0.15)" : "var(--elevated)", border: `1.5px solid ${copiedTg ? "rgba(34,197,94,0.5)" : "var(--border)"}`, color: copiedTg ? "#16a34a" : "var(--text-sec)" }}>
              {copiedTg ? t("ws.copied") : t("ws.copy")}
            </button>
            <button onClick={handleRegen} disabled={regenerating}
              className="px-3 rounded-md text-xs font-bold disabled:opacity-50"
              style={{ background: "var(--elevated)", border: "1.5px solid var(--border)", color: "var(--text-sec)" }}>
              {regenerating ? "…" : t("ws.update")}
            </button>
          </div>
        </div>
      )}

      {err && <p ref={errRef} className="t-shake-target text-xs px-3 py-2 rounded-md" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#dc2626" }}>{err}</p>}

      {isOwner && (
        <div className="pt-4 mt-2" style={{ borderTop: "1px dashed var(--border)" }}>
          <Label>{t("ws.labelArchive")}</Label>
          {!confirmArchive ? (
            <button onClick={() => setConfirmArch(true)}
              className="px-4 py-2 rounded-md text-xs font-bold"
              style={{ background: "rgba(239,68,68,0.08)", border: "1.5px solid rgba(239,68,68,0.35)", color: "#dc2626" }}>
              {t("ws.archiveBtn")}
            </button>
          ) : (
            <div className="rounded-md p-3 space-y-2" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)" }}>
              <p className="text-xs font-semibold" style={{ color: "#dc2626" }}>
                {t("ws.archiveConfirm")}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmArch(false)}
                  className="flex-1 py-1.5 rounded text-xs font-semibold"
                  style={{ background: "var(--elevated)", border: "1px solid var(--border)", color: "var(--text-sec)" }}>
                  {t("common.cancel")}
                </button>
                <button onClick={handleArchive} disabled={archiving}
                  className="flex-1 py-1.5 rounded text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#dc2626,#ef4444)" }}>
                  {archiving ? "…" : t("ws.archive")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MembersTab({ workspaceId, myUserId, isAdmin, isOwner, isSuperadmin }: { workspaceId: number; myUserId: number | null; isAdmin: boolean; isOwner: boolean; isSuperadmin: boolean }) {
  const { t } = useLocale();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editMemberId, setEditMemberId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ first_name: "", last_name: "", position: "", role: "member" });
  const [saving, setSaving] = useState(false);

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
    setErr(null);
    setInviting(true);
    try {
      const result = await workspacesApi.generateInviteLink(workspaceId);
      if (result.invite_deep_link) {
        await navigator.clipboard.writeText(result.invite_deep_link);
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 2000);
      }
      await load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? t("ws.inviteCreateFail"));
    } finally { setInviting(false); }
  };

  const handleApprove = async (memberId: number, approve: boolean) => {
    try {
      await workspacesApi.updateMember(workspaceId, memberId, { approve });
      if (approve) addNotification({ id: `member-approved-${memberId}-${Date.now()}`, title: "✅ Участник принят", body: `Заявка на вступление в пространство одобрена`, time: Date.now(), type: "member_joined" });
      await load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? t("ws.approveFail"));
    }
  };

  const handleRemove = async (memberId: number) => {
    try {
      await workspacesApi.removeMember(workspaceId, memberId);
      await load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? t("ws.deleteFail"));
    }
  };

  return (
    <div className="space-y-5">
      {(isAdmin || isSuperadmin) && (
        <div>
          <Label>{t("ws.inviteLinkLabel")}</Label>
          <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            {t("ws.inviteLinkDesc")}
          </p>
          <button onClick={handleInvite} disabled={inviting || inviteCopied}
            className="px-4 py-2 rounded-md text-xs font-bold text-white disabled:opacity-50 transition-all"
            style={{ background: inviteCopied ? "rgba(22,163,74,0.85)" : "linear-gradient(135deg,#1565a8,#114e85)" }}>
            {inviting ? "…" : inviteCopied ? t("ws.inviteLinkCopied") : t("ws.inviteLinkCreate")}
          </button>
          {err && <p className="text-xs mt-1.5" style={{ color: "#dc2626" }}>{err}</p>}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-center py-4" style={{ color: "var(--text-muted)" }}>{t("ws.loading")}</p>
      ) : (
        <>
          {pending.length > 0 && (
            <div>
              <Label>{t("ws.pendingLabel")}</Label>
              <div className="space-y-2">
                {pending.map(m => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-md"
                    style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
                    <MemberAvatar member={m} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
                        {memberName(m)}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("ws.statusPending")}</p>
                      {m.invite_expires_at && (
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {t("ws.inviteExpiresAt")}: {new Date(m.invite_expires_at).toLocaleDateString()}
                        </p>
                      )}
                      {m.invite_deep_link && (
                        <button
                          onClick={() => navigator.clipboard.writeText(m.invite_deep_link!)}
                          className="text-xs mt-0.5 truncate max-w-full text-left"
                          style={{ color: "var(--primary)", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                          title={t("ws.copyTgLink")}>
                          {t("ws.copyTgLink")}
                        </button>
                      )}
                    </div>
                    {isAdmin && m.user_id === null && (
                      <button onClick={() => handleRemove(m.id)}
                        className="px-2.5 py-1 rounded text-xs font-bold"
                        style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#dc2626" }}>
                        {t("ws.revokeInvite")}
                      </button>
                    )}
                    {isAdmin && m.user_id !== null && (
                      <div className="flex gap-1.5">
                        <button onClick={() => handleApprove(m.id, true)}
                          className="px-2.5 py-1 rounded text-xs font-bold"
                          style={{ background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.3)", color: "#16a34a" }}>
                          {t("ws.accept")}
                        </button>
                        <button onClick={() => handleApprove(m.id, false)}
                          className="px-2.5 py-1 rounded text-xs font-bold"
                          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#dc2626" }}>
                          {t("ws.reject")}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label>{t("ws.activeLabel", { n: active.length })}</Label>
            <div className="space-y-2">
              {active.map(m => {
                const canRemove = (isAdmin || isSuperadmin) && m.user_id !== myUserId && m.role !== "owner";
                return (
                  <div key={m.id}>
                    <div className="flex items-center gap-3 px-3 py-2 rounded-md"
                      style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
                      <MemberAvatar member={m} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
                          {memberName(m)}
                        </p>
                        <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                          {[
                            m.user?.position ? (POSITION_T_KEYS[m.user.position] ? t(POSITION_T_KEYS[m.user.position] as Parameters<typeof t>[0]) : m.user.position) : undefined,
                            m.user?.role && m.user.role !== "user" ? (m.user.role === "superadmin" ? t("ws.roleSuperadmin") : t("ws.roleAdminLabel")) : null,
                          ].filter(Boolean).join(" · ") || roleLabel(m.role, t)}
                        </p>
                      </div>
                      <RoleBadge role={m.role} />
                      {(isAdmin || isSuperadmin) && m.user && (
                        <button onClick={() => {
                          setEditMemberId(editMemberId === m.id ? null : m.id);
                          setEditForm({
                            first_name: m.user?.first_name ?? "",
                            last_name: m.user?.last_name ?? "",
                            position: m.user?.position ?? "",
                            role: m.role,
                          });
                        }}
                          title={t("profile.editTitle")}
                          className="w-7 h-7 flex items-center justify-center rounded transition-all"
                          style={editMemberId === m.id
                            ? { background: "var(--primary)", color: "#fff", border: "1px solid var(--primary)" }
                            : { background: "var(--elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                      )}
                      {canRemove && (
                        <button onClick={() => handleRemove(m.id)}
                          title={t("common.delete")}
                          className="w-7 h-7 flex items-center justify-center rounded"
                          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#dc2626" }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {editMemberId === m.id && (
                      <PanelReveal>
                      <div className="mt-1 px-3 py-3 rounded-md space-y-2" style={{ background: "var(--input-bg)", border: "1px solid var(--primary-border)" }}>
                        <div className="grid grid-cols-2 gap-2">
                          <input value={editForm.first_name} onChange={e => setEditForm(f => ({ ...f, first_name: e.target.value }))}
                            placeholder={t("profile.firstName")}
                            className="rounded px-2.5 py-1.5 text-xs outline-none"
                            style={{ background: "var(--elevated)", border: "1px solid var(--border)", color: "var(--text)" }} />
                          <input value={editForm.last_name} onChange={e => setEditForm(f => ({ ...f, last_name: e.target.value }))}
                            placeholder={t("profile.lastName")}
                            className="rounded px-2.5 py-1.5 text-xs outline-none"
                            style={{ background: "var(--elevated)", border: "1px solid var(--border)", color: "var(--text)" }} />
                        </div>
                        <CustomSelect size="xs"
                          value={editForm.position}
                          onChange={v => setEditForm(f => ({ ...f, position: v }))}
                          options={[
                            ...(editForm.position && !POSITIONS.includes(editForm.position)
                              ? [{ value: editForm.position, label: editForm.position }]
                              : []),
                            ...POSITIONS.map(p => ({ value: p, label: POSITION_T_KEYS[p] ? t(POSITION_T_KEYS[p] as Parameters<typeof t>[0]) : p })),
                          ]}
                        />
                        {(isOwner || isSuperadmin) && (m.role !== "owner" || isSuperadmin) && (
                          <CustomSelect size="xs"
                            value={editForm.role}
                            onChange={v => setEditForm(f => ({ ...f, role: v }))}
                            options={[
                              { value: "member", label: t("ws.memberMember") },
                              { value: "admin", label: t("ws.memberAdmin") },
                              ...(isSuperadmin ? [{ value: "owner", label: t("ws.memberOwner") }] : []),
                            ]}
                          />
                        )}
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setEditMemberId(null)}
                            className="px-3 py-1.5 rounded text-xs font-semibold"
                            style={{ background: "var(--elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                            {t("common.cancel")}
                          </button>
                          <button disabled={saving} onClick={async () => {
                            setErr(null);
                            setSaving(true);
                            try {
                              await workspacesApi.updateMemberProfile(workspaceId, m.id, {
                                first_name: editForm.first_name || undefined,
                                last_name: editForm.last_name || undefined,
                                position: editForm.position || undefined,
                              });
                            } catch { setErr(t("ws.saveFail")); setSaving(false); return; }
                            try {
                              if ((isOwner || isSuperadmin) && (m.role !== "owner" || isSuperadmin) && editForm.role !== m.role) {
                                await workspacesApi.updateMember(workspaceId, m.id, { role: editForm.role });
                              }
                              setEditMemberId(null);
                              await load();
                            } catch { setErr(t("ws.updateFail")); }
                            finally { setSaving(false); }
                          }}
                            className="px-3 py-1.5 rounded text-xs font-bold text-white disabled:opacity-50"
                            style={{ background: "linear-gradient(135deg,#1565a8,#114e85)" }}>
                            {saving ? "…" : t("common.save")}
                          </button>
                        </div>
                      </div>
                      </PanelReveal>
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
  const { t } = useLocale();
  const palette: Record<string, { bg: string; color: string }> = {
    owner: { bg: "rgba(217,119,6,0.12)", color: "#d97706" },
    admin: { bg: "rgba(21,101,168,0.12)", color: "#1565a8" },
    member: { bg: "var(--elevated)", color: "var(--text-muted)" },
  };
  const p = palette[role] ?? palette.member;
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded"
      style={{ background: p.bg, color: p.color }}>
      {roleLabel(role, t)}
    </span>
  );
}

function RoomsTab({ workspaceId, rooms, isAdmin, isSuperadmin, onRefetch }:
  { workspaceId: number; rooms: WorkspaceRoom[]; isAdmin: boolean; isSuperadmin: boolean; onRefetch: () => void }) {
  const { t } = useLocale();
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
    if (!newName.trim()) { setErr(t("ws.rooms.nameEmpty")); return; }
    setBusy(true);
    try {
      await roomsApi.create({ name: newName.trim(), description: newDesc.trim() || undefined, workspace_id: workspaceId });
      setNewName(""); setNewDesc(""); setCreating(false);
      onRefetch();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? t("ws.createFail"));
    } finally { setBusy(false); }
  };

  const handleJoin = async () => {
    setErr(null); setJoinInfo(null);
    if (!joinCode.trim()) { setErr(t("ws.rooms.codeEmpty")); return; }
    setBusy(true);
    try {
      const result = await roomsApi.join(joinCode.trim(), workspaceId);
      if (result.status === 201) {
        setJoinCode(""); setJoining(false);
        onRefetch();
      } else if (result.status === 202) {
        setJoinCode("");
        setJoinInfo(t("ws.rooms.requestSent"));
        addNotification({ id: `room-req-${Date.now()}`, title: t("ws.rooms.requestNotifTitle"), body: t("ws.rooms.requestNotifBody"), time: Date.now(), type: "room_request" });
      }
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number; data?: { detail?: string } } })?.response?.status;
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (status === 403 && !msg) {
        setErr(t("ws.rooms.codeDisabled"));
      } else {
        setErr(msg ?? t("ws.rooms.addFail"));
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {rooms.length === 0 && (
        <p className="text-xs text-center py-4" style={{ color: "var(--text-muted)" }}>{t("ws.rooms.empty")}</p>
      )}
      {rooms.map(r => (
        <RoomRow key={r.id} wr={r} workspaceId={workspaceId} isAdmin={isAdmin} isSuperadmin={isSuperadmin} onRefetch={onRefetch} />
      ))}

      {isAdmin && (
        <div className="pt-3 space-y-2" style={{ borderTop: "1px dashed var(--border)" }}>
          {!creating && !joining && (
            <div className="flex gap-2">
              <button onClick={() => setCreating(true)}
                className="flex-1 py-2 rounded-md text-xs font-bold"
                style={{ background: "var(--primary-light)", border: "1.5px solid var(--primary-border)", color: "var(--primary)" }}>
                {t("ws.rooms.create")}
              </button>
              <button onClick={() => setJoining(true)}
                className="flex-1 py-2 rounded-md text-xs font-bold"
                style={{ background: "var(--elevated)", border: "1.5px solid var(--border)", color: "var(--text-sec)" }}>
                {t("ws.rooms.addByCode")}
              </button>
            </div>
          )}
          {creating && (
            <PanelReveal>
            <div className="space-y-2 rounded-md p-3" style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
              <input
                autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder={t("ws.rooms.namePh")}
                className="w-full rounded px-2.5 py-1.5 text-sm outline-none"
                style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }}
              />
              <input
                value={newDesc} onChange={e => setNewDesc(e.target.value)}
                placeholder={t("ws.rooms.descPh")}
                className="w-full rounded px-2.5 py-1.5 text-sm outline-none"
                style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }}
              />
              {err && <p className="text-xs" style={{ color: "#dc2626" }}>{err}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setCreating(false); setNewName(""); setNewDesc(""); setErr(null); }}
                  className="flex-1 py-1.5 rounded text-xs font-semibold"
                  style={{ background: "var(--elevated)", border: "1px solid var(--border)", color: "var(--text-sec)" }}>
                  {t("common.cancel")}
                </button>
                <button onClick={handleCreate} disabled={busy}
                  className="flex-1 py-1.5 rounded text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#1565a8,#114e85)" }}>
                  {busy ? "…" : t("common.create")}
                </button>
              </div>
            </div>
            </PanelReveal>
          )}
          {joining && (
            <PanelReveal>
            <div className="space-y-2 rounded-md p-3" style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                {t("ws.rooms.codeInstruction")}
              </p>
              <input
                autoFocus value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
                placeholder={t("ws.rooms.codePh")}
                className="w-full rounded px-2.5 py-1.5 text-sm outline-none font-mono"
                style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)", letterSpacing: "0.1em" }}
                onKeyDown={e => { if (e.key === "Enter") handleJoin(); }}
              />
              {err && <p className="text-xs" style={{ color: "#dc2626" }}>{err}</p>}
              {joinInfo && <p className="text-xs" style={{ color: "#0891b2" }}>{joinInfo}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setJoining(false); setJoinCode(""); setErr(null); setJoinInfo(null); }}
                  className="flex-1 py-1.5 rounded text-xs font-semibold"
                  style={{ background: "var(--elevated)", border: "1px solid var(--border)", color: "var(--text-sec)" }}>
                  {t("common.cancel")}
                </button>
                <button onClick={handleJoin} disabled={busy}
                  className="flex-1 py-1.5 rounded text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#1565a8,#114e85)" }}>
                  {busy ? "…" : t("ws.rooms.add")}
                </button>
              </div>
            </div>
            </PanelReveal>
          )}
        </div>
      )}
    </div>
  );
}

function RoomRow({ wr, workspaceId, isAdmin, isSuperadmin, onRefetch }:
  { wr: WorkspaceRoom; workspaceId: number; isAdmin: boolean; isSuperadmin: boolean; onRefetch: () => void }) {
  const { t } = useLocale();
  const { workspaces } = useWorkspace();
  const [showShare, setShowShare] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmArch, setConfirmArch] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [joinRequests, setJoinRequests] = useState<RoomJoinRequest[]>([]);
  const [sharedWorkspaces, setSharedWorkspaces] = useState<{ workspace_id: number; workspace_name: string }[]>([]);
  const [localJoinMode, setLocalJoinMode] = useState<"open" | "approval" | "closed">(wr.room.join_mode ?? "approval");
  const [localVis, setLocalVis] = useState<"full" | "busy_only">(wr.visibility ?? "full");
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferWsId, setTransferWsId] = useState<number | "">("");

  const isOwnerRoom = wr.role === "owner";

  const handleTransfer = async () => {
    if (!transferWsId) { setErr(t("ws.rooms.wsRequired")); return; }
    setErr(null); setBusy(true);
    try {
      await roomsApi.transferOwner(wr.room.id, Number(transferWsId));
      setShowTransfer(false); setTransferWsId("");
      onRefetch();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? t("ws.rooms.transferFail"));
    } finally { setBusy(false); }
  };

  useEffect(() => {
    setLocalJoinMode(wr.room.join_mode ?? "approval");
    setLocalVis(wr.visibility ?? "full");
  }, [wr.room.join_mode, wr.visibility]);

  useEffect(() => {
    if (!isOwnerRoom) return;
    roomsApi.listSharedWorkspaces(wr.room.id).then(setSharedWorkspaces).catch(() => {});
  }, [wr.room.id, isOwnerRoom]);

  const handleRevokeShare = async (targetWsId: number) => {
    try {
      await roomsApi.revokeShare(wr.room.id, targetWsId);
      setSharedWorkspaces(prev => prev.filter(w => w.workspace_id !== targetWsId));
      onRefetch();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? t("ws.rooms.revokeFail"));
    }
  };

  useEffect(() => {
    if (!isOwnerRoom || !isAdmin) return;
    roomsApi.listJoinRequests(wr.room.id).then(setJoinRequests).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wr.room.id]);

  const handleVis = (v: "full" | "busy_only") => {
    setLocalVis(v);
    roomsApi.updateVisibility(wr.room.id, workspaceId, v)
      .then(() => onRefetch())
      .catch(() => { setLocalVis(wr.visibility ?? "full"); setErr(t("ws.rooms.updateFail")); });
  };

  const handleJoinMode = async (mode: "open" | "approval" | "closed") => {
    if (busy) return;
    setLocalJoinMode(mode);
    setBusy(true);
    setErr(null);
    try {
      const updated = await roomsApi.update(wr.room.id, { join_mode: mode });
      setLocalJoinMode((updated.room.join_mode ?? "approval") as "open" | "approval" | "closed");
      onRefetch();
    } catch (e: unknown) {
      setLocalJoinMode(wr.room.join_mode ?? "approval");
      onRefetch();
      setErr(t("ws.rooms.modeFail"));
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    setErr(null);
    if (!shareCode.trim()) { setErr(t("ws.rooms.codeEmpty")); return; }
    setBusy(true);
    try {
      await roomsApi.share(wr.room.id, shareCode.trim());
      setShareCode(""); setShowShare(false);
      onRefetch();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? t("ws.rooms.shareFail"));
    } finally { setBusy(false); }
  };

  const handleArchive = async () => {
    setErr(null); setBusy(true);
    try {
      await roomsApi.archive(wr.room.id);
      onRefetch();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? t("ws.rooms.archiveFail"));
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
      setErr(msg ?? t("ws.rooms.regenFail"));
      setBusy(false);
    }
  };

  const handleApproveRequest = async (reqId: number) => {
    try {
      await roomsApi.approveJoinRequest(wr.room.id, reqId);
      setJoinRequests(r => r.filter(x => x.id !== reqId));
      addNotification({ id: `room-approved-${reqId}`, title: t("ws.rooms.requestApproved"), body: t("ws.rooms.requestApprovedBody", { name: wr.room.name }), time: Date.now(), type: "room_approved" });
      onRefetch();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? t("ws.accept"));
    }
  };

  const handleRejectRequest = async (reqId: number) => {
    try {
      await roomsApi.rejectJoinRequest(wr.room.id, reqId);
      setJoinRequests(r => r.filter(x => x.id !== reqId));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? t("ws.rejectFail"));
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
    <div className="rounded-md p-3"
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
          <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{t("ws.rooms.codeLabel")}</span>
          <code className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: "var(--bg)", color: "var(--primary)", border: "1px solid var(--primary-border)", letterSpacing: "0.1em" }}>
            {wr.room.invite_code}
          </code>
          <button onClick={handleCopyCode}
            className="px-2 py-0.5 rounded text-xs font-semibold transition-all"
            style={{ background: copiedCode ? "rgba(34,197,94,0.12)" : "var(--bg)", color: copiedCode ? "#16a34a" : "var(--text-muted)", border: `1px solid ${copiedCode ? "rgba(34,197,94,0.4)" : "var(--border)"}` }}>
            {copiedCode ? "✓" : t("ws.copy")}
          </button>
          {!confirmRegen ? (
            <button onClick={() => setConfirmRegen(true)}
              className="px-2 py-0.5 rounded text-xs font-semibold"
              style={{ background: "var(--bg)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
              {t("ws.rooms.changeCode")}
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-1 mt-1 w-full">
              <p className="w-full text-xs mb-1" style={{ color: "var(--text-muted)" }}>
                {t("ws.rooms.changeCodeConfirm")}
              </p>
              <button onClick={handleRegen} disabled={busy}
                className="px-2 py-0.5 rounded text-xs font-bold text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#d97706,#b45309)" }}>
                {busy ? "…" : t("ws.rooms.changeCodeBtn")}
              </button>
              <button onClick={() => setConfirmRegen(false)}
                className="px-2 py-0.5 rounded text-xs font-semibold"
                style={{ background: "var(--elevated)", color: "var(--text-sec)", border: "1px solid var(--border)" }}>
                {t("common.cancel")}
              </button>
            </div>
          )}
        </div>
      )}

      {isOwnerRoom && isAdmin && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold shrink-0" style={{ color: "var(--text-muted)" }}>{t("ws.rooms.connection")}</span>
          <div className="flex rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            {([
              { v: "open",     label: t("ws.rooms.open") },
              { v: "approval", label: t("ws.rooms.approval") },
              { v: "closed",   label: t("ws.rooms.closed") },
            ] as const).map(({ v, label }) => {
              const active = localJoinMode === v;
              return (
                <button key={v} onClick={() => handleJoinMode(v)} disabled={active || busy}
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
          <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{t("ws.rooms.visibility")}</span>
          <div className="flex rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            {(["full", "busy_only"] as const).map(v => {
              const active = localVis === v;
              return (
                <button key={v} onClick={() => handleVis(v)} disabled={active}
                  className="px-2.5 py-1 text-xs font-semibold transition-all"
                  style={{
                    background: active ? "var(--primary)" : "transparent",
                    color: active ? "#fff" : "var(--text-sec)",
                  }}>
                  {v === "full" ? t("ws.rooms.visFull") : t("ws.rooms.visBusy")}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {joinRequests.length > 0 && (
        <div className="mb-2 space-y-1">
          <p className="text-xs font-semibold" style={{ color: "var(--text-sec)" }}>{t("ws.rooms.requests")}</p>
          {joinRequests.map(req => (
            <div key={req.id} className="flex items-center gap-2 px-2 py-1 rounded"
              style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold truncate" style={{ color: "var(--text)" }}>{req.workspace_name}</span>
                {req.requested_by && (
                  <span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>· {req.requested_by}</span>
                )}
              </div>
              <button onClick={() => handleApproveRequest(req.id)}
                className="px-2 py-0.5 rounded text-xs font-bold shrink-0"
                style={{ background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.3)", color: "#16a34a" }}>
                {t("ws.accept")}
              </button>
              <button onClick={() => handleRejectRequest(req.id)}
                className="px-2 py-0.5 rounded text-xs font-bold shrink-0"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#dc2626" }}>
                {t("ws.reject")}
              </button>
            </div>
          ))}
        </div>
      )}

      {isOwnerRoom && sharedWorkspaces.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-muted)" }}>{t("ws.rooms.sharedWith")}</p>
          <div className="flex flex-wrap gap-1">
            {sharedWorkspaces.map(ws => (
              <div key={ws.workspace_id} className="flex items-center gap-1 px-2 py-0.5 rounded"
                style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                <span className="text-xs" style={{ color: "var(--text-sec)" }}>{ws.workspace_name}</span>
                <button onClick={() => handleRevokeShare(ws.workspace_id)}
                  className="text-xs font-bold leading-none transition-all"
                  style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: "0 1px" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#dc2626"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}
                  title={t("ws.rooms.revokeAccess")}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {isOwnerRoom && (
          <button onClick={() => setShowShare(v => !v)}
            className="px-2.5 py-1 rounded text-xs font-semibold"
            style={{ background: "var(--primary-light)", border: "1px solid var(--primary-border)", color: "var(--primary)" }}>
            {t("ws.rooms.share")}
          </button>
        )}
        {isSuperadmin && isOwnerRoom && (
          <button onClick={() => setShowTransfer(v => !v)}
            className="px-2.5 py-1 rounded text-xs font-semibold"
            style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", color: "#d97706" }}>
            {t("ws.rooms.transferOwner")}
          </button>
        )}
        {isOwnerRoom && isAdmin && !confirmArch && (
          <button onClick={() => setConfirmArch(true)}
            className="px-2.5 py-1 rounded text-xs font-semibold"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "#dc2626" }}>
            {t("ws.archive")}
          </button>
        )}
        {confirmArch && (
          <div className="flex gap-1.5">
            <button onClick={() => setConfirmArch(false)}
              className="px-2.5 py-1 rounded text-xs font-semibold"
              style={{ background: "var(--elevated)", border: "1px solid var(--border)", color: "var(--text-sec)" }}>
              {t("common.cancel")}
            </button>
            <button onClick={handleArchive} disabled={busy}
              className="px-2.5 py-1 rounded text-xs font-bold text-white disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#dc2626,#ef4444)" }}>
              {busy ? "…" : t("common.confirm")}
            </button>
          </div>
        )}
      </div>

      {showShare && isOwnerRoom && (
        <div className="mt-2 flex gap-2">
          <input
            autoFocus value={shareCode} onChange={e => setShareCode(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleShare(); }}
            placeholder={t("ws.rooms.shareCodePh")}
            className="flex-1 rounded px-2.5 py-1.5 text-xs outline-none font-mono"
            style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }}
          />
          <button onClick={handleShare} disabled={busy}
            className="px-3 rounded text-xs font-bold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#1565a8,#114e85)" }}>
            {busy ? "…" : t("ws.rooms.send")}
          </button>
        </div>
      )}

      {showTransfer && isSuperadmin && isOwnerRoom && (
        <div className="mt-2 space-y-2 rounded-md p-3" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.25)" }}>
          <p className="text-xs font-semibold" style={{ color: "#d97706" }}>{t("ws.rooms.transferTitle")}</p>
          <select
            value={transferWsId}
            onChange={e => setTransferWsId(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
            style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }}
          >
            <option value="">{t("ws.rooms.selectWs")}</option>
            {workspaces.filter(ws => ws.id !== workspaceId).map(ws => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button onClick={() => { setShowTransfer(false); setTransferWsId(""); setErr(null); }}
              className="flex-1 py-1.5 rounded text-xs font-semibold"
              style={{ background: "var(--elevated)", border: "1px solid var(--border)", color: "var(--text-sec)" }}>
              {t("common.cancel")}
            </button>
            <button onClick={handleTransfer} disabled={busy || transferWsId === ""}
              className="flex-1 py-1.5 rounded text-xs font-bold text-white disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#d97706,#b45309)" }}>
              {busy ? "…" : t("ws.rooms.transfer")}
            </button>
          </div>
        </div>
      )}

      {err && <p className="text-xs mt-2" style={{ color: "#dc2626" }}>{err}</p>}
    </div>
  );
}

function CustomSelect({
  value, onChange, options, disabled, size = "sm",
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  size?: "xs" | "sm";
}) {
  const [dropState, setDropState] = useState<"closed" | "open" | "closing">("closed");
  const [dropRect, setDropRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(o => o.value === value)?.label ?? value;
  const pad = size === "xs" ? "px-2.5 py-1.5" : "px-3 py-2";
  const fz = size === "xs" ? "text-xs" : "text-sm";

  useEffect(() => {
    if (dropState !== "open") return;
    const close = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      setDropState("closing");
      setTimeout(() => setDropState("closed"), 150);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [dropState]);

  const toggle = () => {
    if (disabled) return;
    if (dropState === "closed") {
      if (btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setDropRect({ top: r.bottom + 4, left: r.left, width: r.width });
      }
      setDropState("open");
    } else if (dropState === "open") {
      setDropState("closing");
      setTimeout(() => setDropState("closed"), 150);
    }
  };

  const isOpen = dropState !== "closed";

  return (
    <div>
      <button ref={btnRef} type="button" disabled={disabled} onClick={toggle}
        className={`w-full rounded-md ${pad} ${fz} text-left flex items-center justify-between gap-2 outline-none`}
        style={{
          background: "var(--input-bg)", color: "var(--text)",
          border: `1.5px solid ${isOpen ? "var(--primary)" : "var(--input-border)"}`,
          cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
          transition: "border-color 0.15s",
        }}>
        <span className="truncate min-w-0">{selected}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className="shrink-0"
          style={{ transform: isOpen ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>
          <path d="M1 1l4 4 4-4" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {isOpen && dropRect && (
        <div onMouseDown={e => e.stopPropagation()}
          className={"t-dropdown" + (dropState === "open" ? " is-open" : " is-closing")}
          data-origin="top-left"
          style={{
            position: "fixed", top: dropRect.top, left: dropRect.left, width: dropRect.width,
            zIndex: 9999, background: "var(--modal)", border: "1.5px solid var(--border)",
            borderRadius: 6, overflow: "hidden", boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
          }}>
          {options.map(o => (
            <button key={o.value} type="button"
              onMouseDown={() => { onChange(o.value); setDropState("closing"); setTimeout(() => setDropState("closed"), 150); }}
              className={`w-full ${pad} ${fz} text-left`}
              style={{
                background: o.value === value ? "var(--primary-light)" : "transparent",
                color: o.value === value ? "var(--primary)" : "var(--text)",
                fontWeight: o.value === value ? "600" : "400",
                transition: "background 0.1s",
              }}
              onMouseEnter={e => { if (o.value !== value) e.currentTarget.style.background = "var(--elevated)"; }}
              onMouseLeave={e => { if (o.value !== value) e.currentTarget.style.background = "transparent"; }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelReveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    requestAnimationFrame(() => requestAnimationFrame(() => { el.dataset.open = "true"; }));
  }, []);
  return <div ref={ref} className="t-panel-slide" data-open="false">{children}</div>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--text-sec)" }}>{children}</p>;
}

function AnalyticsTab({ workspaceId }: { workspaceId: number }) {
  const { t } = useLocale();
  const [period, setPeriod] = useState(30);

  const { data, isLoading } = useQuery<WorkspaceAnalytics>({
    queryKey: ["workspace-analytics", workspaceId, period],
    queryFn: () => workspacesApi.getAnalytics(workspaceId, period),
  });

  const membersNumRef = useRef<HTMLSpanElement>(null);
  const meetingsNumRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    [membersNumRef, meetingsNumRef].forEach(ref => {
      const el = ref.current;
      if (!el) return;
      el.classList.remove("is-animating");
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-animating")));
    });
  }, [data]);

  if (isLoading) return (
    <div className="space-y-3">
      {[1,2,3].map(i => <div key={i} className="h-24 rounded-md animate-pulse" style={{ background: "var(--elevated)" }} />)}
    </div>
  );

  return (
    <div className="space-y-5 pb-4">
      {/* Period selector */}
      <div className="flex gap-1.5">
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => setPeriod(d)}
            className="px-3 py-1 rounded text-xs font-semibold transition-all"
            style={{
              background: period === d ? "var(--primary)" : "var(--elevated)",
              color: period === d ? "#fff" : "var(--text-muted)",
              border: `1px solid ${period === d ? "var(--primary)" : "var(--border)"}`,
            }}>
            {d} {t("ws.analytics.days")}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="flex gap-2">
        <div className="flex items-center gap-2 rounded px-3 py-1.5 flex-1" style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
          <span ref={membersNumRef} className="t-digit-group text-base font-black" style={{ color: "var(--text)" }}>
            {String(data?.total_members ?? 0).split("").map((ch, i) => (
              <span key={i} className="t-digit" data-stagger={i > 0 ? Math.min(i, 2) : undefined}>{ch}</span>
            ))}
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("ws.analytics.members")}</span>
        </div>
        <div className="flex items-center gap-2 rounded px-3 py-1.5 flex-1" style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
          <span ref={meetingsNumRef} className="t-digit-group text-base font-black" style={{ color: "var(--text)" }}>
            {String(data?.total_meetings ?? 0).split("").map((ch, i) => (
              <span key={i} className="t-digit" data-stagger={i > 0 ? Math.min(i, 2) : undefined}>{ch}</span>
            ))}
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("ws.analytics.meetings")}</span>
        </div>
      </div>

      {/* New members chart */}
      <div>
        <p className="text-xs font-bold mb-2" style={{ color: "var(--text-sec)" }}>{t("ws.analytics.newMembers")}</p>
        <BarChart data={data?.new_members ?? []} color="#7c3aed" noDataText={t("ws.analytics.noData")} />
      </div>

      {/* Meetings chart */}
      <div>
        <p className="text-xs font-bold mb-2" style={{ color: "var(--text-sec)" }}>{t("ws.analytics.freq")}</p>
        <BarChart data={data?.meetings_by_day ?? []} color="#0891b2" noDataText={t("ws.analytics.noData")} />
      </div>

      {/* Top organizers */}
      {(data?.top_organizers?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs font-bold mb-2" style={{ color: "var(--text-sec)" }}>{t("ws.analytics.top")}</p>
          <TopOrgList items={data!.top_organizers} />
        </div>
      )}
    </div>
  );
}

function fmtChartDate(iso: string): string {
  const p = iso.split("-");
  return p.length === 3 ? `${p[2]}.${p[1]}` : iso;
}

function BarChart({ data, color, noDataText }: { data: Array<{ date: string; count: number }>; color: string; noDataText?: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (data.length === 0) return (
    <p className="text-xs py-3 text-center" style={{ color: "var(--text-muted)" }}>{noDataText ?? "—"}</p>
  );
  const H = 88;
  const TOP = 16;
  const BOTTOM_LABEL = 12;
  const barAreaH = H - TOP - 4 - BOTTOM_LABEL;
  const max = Math.max(...data.map(d => d.count), 1);
  const n = data.length;
  return (
    <svg width="100%" height={H} style={{ display: "block", overflow: "visible" }}>
      {data.map((d, i) => {
        const bH = Math.max(3, (d.count / max) * barAreaH);
        const xPct = (i / n) * 100;
        const wPct = (1 / n) * 100;
        const barY = TOP + barAreaH - bH;
        const cx = `${xPct + wPct * 0.5}%`;
        return (
          <g key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
            <rect
              x={`${xPct + wPct * 0.1}%`} y={barY}
              width={`${wPct * 0.8}%`} height={bH}
              rx={2} fill={color} opacity={hovered === i ? 1 : 0.75}
            />
            {d.count > 0 && (
              <text x={cx} y={barY - 3} textAnchor="middle" fontSize={11} fontWeight="700" fill={color}>
                {d.count}
              </text>
            )}
            <text x={cx} y={H - 1} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
              {fmtChartDate(d.date)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function TopOrgList({ items }: { items: Array<{ user_name: string; count: number }> }) {
  const max = Math.max(...items.map(i => i.count), 1);
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i}>
          <div className="flex justify-between mb-1" style={{ fontSize: 11 }}>
            <span className="font-semibold truncate" style={{ color: "var(--text)" }}>{item.user_name}</span>
            <span style={{ color: "var(--text-muted)", flexShrink: 0, marginLeft: 8 }}>{item.count}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--elevated)" }}>
            <div className="h-full rounded-full" style={{ width: `${(item.count / max) * 100}%`, background: "linear-gradient(90deg,#7c3aed,#a855f7)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
