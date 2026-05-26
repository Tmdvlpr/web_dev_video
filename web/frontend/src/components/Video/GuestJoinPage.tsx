import React, { useCallback, useEffect, useRef, useState } from "react";
import { meetingsApi } from "../../api/meetings";
import { useLocale } from "../../contexts/LocaleContext";
import type { GuestJoinInfo } from "../../types";
import { MeetingRoom } from "./MeetingRoom";
import "./conference.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(d: Date, locale: string): string {
  return d.toLocaleTimeString(locale === "uz" ? "uz-UZ" : "ru-RU", { hour: "2-digit", minute: "2-digit" });
}

// ─── Camera preview ───────────────────────────────────────────────────────────
function CameraPreview({ micOn, camOn, camOffLabel, micOffLabel }: { micOn: boolean; camOn: boolean; camOffLabel: string; micOffLabel: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!camOn) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: micOn })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {});
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [camOn, micOn]);

  return (
    <div
      style={{
        width: 280, height: 180, borderRadius: 6, overflow: "hidden",
        background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative",
      }}
    >
      {camOn ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
        />
      ) : (
        <div style={{ color: "#64748b", fontSize: 13, textAlign: "center" }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>📷</div>
          {camOffLabel}
        </div>
      )}
      {!micOn && camOn && (
        <div style={{
          position: "absolute", bottom: 8, right: 8,
          background: "rgba(239,68,68,0.85)", borderRadius: 6, padding: "2px 6px",
          fontSize: 11, color: "#fff",
        }}>
          {micOffLabel}
        </div>
      )}
    </div>
  );
}

// ─── Status screens ───────────────────────────────────────────────────────────
function Spinner({ text }: { text: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
      color: "#94a3b8", fontSize: 13,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%",
        border: "2px solid #3b82f6", borderTopColor: "transparent",
        animation: "spin 0.9s linear infinite",
      }} />
      {text}
    </div>
  );
}

// ─── Main guest page ──────────────────────────────────────────────────────────
export function GuestJoinPage({ inviteToken }: { inviteToken: string }) {
  const { t, locale } = useLocale();
  const [info, setInfo] = useState<GuestJoinInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [phase, setPhase] = useState<"preview" | "requesting" | "waiting" | "approved" | "rejected" | "left">("preview");
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const [guestBookingId, setGuestBookingId] = useState(0);
  const [guestSessionToken, setGuestSessionToken] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load meeting info
  useEffect(() => {
    meetingsApi.getGuestInfo(inviteToken).then(setInfo).catch((err) => {
      const detail = err?.response?.data?.detail ?? t("guest.invalidLink");
      setLoadErr(detail);
    });
  }, [inviteToken]);

  // Poll for status after requesting
  useEffect(() => {
    if (phase !== "waiting") {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const s = await meetingsApi.pollInviteStatus(inviteToken);
        if (s.status === "approved" && s.livekit_token) {
          setLivekitToken(s.livekit_token);
          setLivekitUrl(s.livekit_url ?? "");
          setGuestBookingId(s.booking_id ?? 0);
          setGuestSessionToken(s.guest_session_token ?? "");
          setPhase("approved");
        } else if (s.status === "rejected") {
          setPhase("rejected");
        }
      } catch {}
    }, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [phase, inviteToken]);

  const handleRequest = useCallback(async () => {
    if (!name.trim()) return;
    setPhase("requesting");
    try {
      await meetingsApi.requestAdmission(inviteToken, name.trim());
      setPhase("waiting");
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t("guest.sendError");
      alert(detail);
      setPhase("preview");
    }
  }, [inviteToken, name]);

  // ── Error state ──────────────────────────────────────────────────────────────
  if (loadErr) {
    return (
      <PageShell>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#f87171", marginBottom: 8 }}>
            {t("guest.invalidLinkTitle")}
          </p>
          <p style={{ fontSize: 13, color: "#94a3b8" }}>{loadErr}</p>
        </div>
      </PageShell>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (!info) {
    return (
      <PageShell>
        <Spinner text={t("guest.loadingMeeting")} />
      </PageShell>
    );
  }

  // ── Approved — enter LiveKit room ────────────────────────────────────────────
  if (phase === "approved" && livekitToken && livekitUrl) {
    return (
      <MeetingRoom
        bookingId={guestBookingId}
        guestToken={livekitToken}
        guestServerUrl={livekitUrl}
        guestName={name}
        guestSessionToken={guestSessionToken}
        initialVideo={camOn}
        initialAudio={micOn}
        onLeave={() => setPhase("left")}
      />
    );
  }

  // ── Left ─────────────────────────────────────────────────────────────────────
  if (phase === "left") {
    return (
      <PageShell>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>👋</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>{t("guest.leftMeeting")}</p>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 8 }}>{t("guest.closeWindow")}</p>
        </div>
      </PageShell>
    );
  }

  // ── Rejected ──────────────────────────────────────────────────────────────────
  if (phase === "rejected") {
    return (
      <PageShell>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#f87171", marginBottom: 8 }}>
            {t("guest.accessDenied")}
          </p>
          <p style={{ fontSize: 13, color: "#94a3b8" }}>
            {t("guest.accessDeniedMsg")}
          </p>
        </div>
      </PageShell>
    );
  }

  // ── Waiting for organizer decision ───────────────────────────────────────────
  if (phase === "waiting") {
    return (
      <PageShell>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>
            {t("guest.waitingTitle")}
          </p>
          <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 24 }}>
            {t("guest.waitingMsg")}
          </p>
          <Spinner text={t("guest.waitingStatus")} />
        </div>
      </PageShell>
    );
  }

  // ── Preview + form ────────────────────────────────────────────────────────────
  const startDate = new Date(info.start_time);
  const endDate = new Date(info.end_time);
  const dateStr = startDate.toLocaleDateString(locale === "uz" ? "uz-UZ" : "ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const timeStr = `${fmtTime(startDate, locale)}–${fmtTime(endDate, locale)}`;

  return (
    <PageShell>
      {/* Meeting info */}
      <div style={{ marginBottom: 20, textAlign: "center" }}>
        <p style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
          {t("guest.meetingInvite")}
        </p>
        <p style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>{info.title}</p>
        <p style={{ fontSize: 13, color: "#94a3b8" }}>{dateStr}, {timeStr}</p>
      </div>

      {/* Camera preview */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <CameraPreview
          micOn={micOn}
          camOn={camOn}
          camOffLabel={t("guest.camOff")}
          micOffLabel={t("guest.micOff")}
        />
      </div>

      {/* Device toggles */}
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 24 }}>
        <button
          onClick={() => setMicOn((v) => !v)}
          style={{
            padding: "8px 16px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)",
            background: micOn ? "rgba(59,130,246,0.15)" : "rgba(239,68,68,0.15)",
            color: micOn ? "#60a5fa" : "#f87171",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          {micOn ? t("guest.micOn") : t("guest.micOffBtn")}
        </button>
        <button
          onClick={() => setCamOn((v) => !v)}
          style={{
            padding: "8px 16px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)",
            background: camOn ? "rgba(59,130,246,0.15)" : "rgba(239,68,68,0.15)",
            color: camOn ? "#60a5fa" : "#f87171",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          {camOn ? t("guest.camOn") : t("guest.camOffBtn")}
        </button>
      </div>

      {/* Name input */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: "#94a3b8", display: "block", marginBottom: 6 }}>
          {t("guest.nameLabel")}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleRequest(); }}
          placeholder={t("guest.namePlaceholder")}
          maxLength={128}
          style={{
            width: "100%", padding: "10px 14px", borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)", color: "#e2e8f0",
            fontSize: 13, outline: "none", boxSizing: "border-box",
          }}
        />
      </div>

      {/* Submit */}
      <button
        onClick={handleRequest}
        disabled={!name.trim() || phase === "requesting"}
        style={{
          width: "100%", padding: "12px", borderRadius: 6,
          background: name.trim() ? "linear-gradient(135deg,#1565a8,#3b82f6)" : "rgba(255,255,255,0.08)",
          color: name.trim() ? "#fff" : "#64748b",
          fontSize: 13, fontWeight: 700, cursor: name.trim() ? "pointer" : "not-allowed",
          border: "none", transition: "all 0.2s",
        }}
      >
        {phase === "requesting" ? t("guest.requesting") : t("guest.requestAccess")}
      </button>

      <p style={{ fontSize: 11, color: "#475569", textAlign: "center", marginTop: 12 }}>
        {t("guest.requestHint")}
      </p>
    </PageShell>
  );
}

// ─── Page shell ───────────────────────────────────────────────────────────────
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100dvh", background: "#0f1117",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, fontFamily: "Gilroy, sans-serif",
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{
        width: "100%", maxWidth: 360,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 6, padding: "28px 24px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <span style={{
            fontFamily: "Gilroy, sans-serif", fontWeight: 800, fontSize: 22,
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            <span style={{ color: "#f8fafc" }}>Corp</span>
            <span style={{ color: "#5ba3df" }}>meet</span>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
