import "@livekit/components-styles";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useIsSpeaking,
  useLocalParticipant,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder, TrackReference } from "@livekit/components-react";
import { Track } from "livekit-client";
import type { Participant } from "livekit-client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { meetingsApi } from "../../api/meetings";
import type { GuestJoinInfo } from "../../types";
import "./conference.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const COLORS = ["#4f7cff", "#a855f7", "#06b6d4", "#f59e0b", "#22c55e", "#f43f5e", "#ec4899"];

function colorFromIdentity(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}

function initialsFromName(name: string): string {
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

// ─── Stable track constants ───────────────────────────────────────────────────
const TRACK_SOURCES = [
  { source: Track.Source.Camera, withPlaceholder: true },
  { source: Track.Source.ScreenShare, withPlaceholder: false },
];
const TRACK_OPTIONS = { onlySubscribed: false };

// ─── Guest video tile ─────────────────────────────────────────────────────────
const GuestVideoTile = React.memo(function GuestVideoTile({
  trackRef,
  localIdentity,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  localIdentity: string;
}) {
  const participant = trackRef.participant as Participant;
  const isSpeaking = useIsSpeaking(participant);
  if (!participant) return null;
  const hasVideo = !!(trackRef.publication?.isEnabled && trackRef.publication?.track);
  const isLocal = participant.identity === localIdentity;
  const color = colorFromIdentity(participant.identity);
  const displayName = participant.name ?? participant.identity;
  const initials = initialsFromName(displayName);
  const shortName = isLocal ? "Вы" : displayName.split(" ").slice(0, 2).join(" ");

  return (
    <div className={`vtile vtile--md${isSpeaking ? " vtile--speaking" : ""}`}>
      <div className="vtile__bg" />
      {hasVideo ? (
        <VideoTrack
          trackRef={trackRef as TrackReference}
          className={`vtile__video${isLocal ? " vtile__video--mirror" : ""}`}
        />
      ) : (
        <div className="vtile__avwrap">
          <div className="vtile__av" style={{ background: `${color}1a`, border: `2px solid ${color}44`, color }}>
            {initials}
          </div>
        </div>
      )}
      <div className="vtile__footer">
        <span className="vtile__name">{shortName}</span>
        {!participant.isMicrophoneEnabled && (
          <div className="vtile__mutebadge" style={{ fontSize: 9 }}>🔇</div>
        )}
      </div>
      {isSpeaking && <div className="vtile__sring" />}
    </div>
  );
});

// ─── Guest conference UI (inner, uses LiveKit hooks) ──────────────────────────
function GuestConferenceUI({
  guestName,
  onLeave,
}: {
  guestName: string;
  onLeave: () => void;
}) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const remoteParticipants = useParticipants();
  const allTracks = useTracks(TRACK_SOURCES, TRACK_OPTIONS);
  const camTracks = allTracks.filter((t) => t.source === Track.Source.Camera);
  const [confirmLeave, setConfirmLeave] = useState(false);

  return (
    <div className="conf-root fixed inset-0 z-[9999] flex flex-col" style={{ background: "#0f1117" }}>
      {/* Header */}
      <div className="mhdr" style={{ background: "rgba(15,17,23,0.9)" }}>
        <div className="mhdr__left">
          <span className="mhdr__title">Видеоконференция</span>
          <span className="mhdr__badge" style={{ marginLeft: 8 }}>
            {remoteParticipants.length + 1} участн.
          </span>
          <span className="mhdr__badge" style={{ marginLeft: 4, color: "#94a3b8", fontSize: 11 }}>
            Гость: {guestName}
          </span>
        </div>
      </div>

      {/* Video grid */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <div className="gallerygrid" style={{ height: "100%", padding: 8 }}>
          {camTracks.slice(0, 9).map((t) => (
            <GuestVideoTile
              key={t.participant.identity}
              trackRef={t}
              localIdentity={localParticipant.identity}
            />
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="ctrlbar">
        <div className="ctrlbar__inner">
          <div className="ctrlbar__group">
            <button
              className={`ctrlbtn${!isMicrophoneEnabled ? " ctrlbtn--active" : ""}`}
              onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(console.warn)}
              title={isMicrophoneEnabled ? "Выключить микрофон" : "Включить микрофон"}
            >
              <div className="ctrlbtn__icon">{isMicrophoneEnabled ? "🎤" : "🔇"}</div>
              <span className="ctrlbtn__label">{isMicrophoneEnabled ? "Мут" : "Анмут"}</span>
            </button>
            <button
              className={`ctrlbtn${!isCameraEnabled ? " ctrlbtn--active" : ""}`}
              onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled).catch(console.warn)}
              title={isCameraEnabled ? "Выключить камеру" : "Включить камеру"}
            >
              <div className="ctrlbtn__icon">{isCameraEnabled ? "📹" : "📷"}</div>
              <span className="ctrlbtn__label">{isCameraEnabled ? "Камера" : "Вкл"}</span>
            </button>
          </div>
          <div className="ctrlbar__group ctrlbar__group--right">
            <button className="ctrlbtn ctrlbtn--leave" onClick={() => setConfirmLeave(true)}>
              <div className="ctrlbtn__icon">🚪</div>
              <span className="ctrlbtn__label">Покинуть</span>
            </button>
          </div>
        </div>
      </div>

      {/* Leave confirm */}
      {confirmLeave && (
        <div className="overlay" onClick={() => setConfirmLeave(false)}>
          <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal__hd">
              <span>Покинуть встречу?</span>
              <button className="modal__x" onClick={() => setConfirmLeave(false)}>✕</button>
            </div>
            <div className="modal__ft modal__ft--col">
              <button className="modal__btn modal__btn--danger" onClick={onLeave}>Покинуть</button>
              <button className="modal__btn" onClick={() => setConfirmLeave(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Camera preview ───────────────────────────────────────────────────────────
function CameraPreview({ micOn, camOn }: { micOn: boolean; camOn: boolean }) {
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
        width: 280, height: 180, borderRadius: 12, overflow: "hidden",
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
          <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
          Камера выключена
        </div>
      )}
      {!micOn && camOn && (
        <div style={{
          position: "absolute", bottom: 8, right: 8,
          background: "rgba(239,68,68,0.85)", borderRadius: 6, padding: "2px 6px",
          fontSize: 11, color: "#fff",
        }}>
          🔇 Микрофон выкл.
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
      color: "#94a3b8", fontSize: 14,
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
  const [info, setInfo] = useState<GuestJoinInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [phase, setPhase] = useState<"preview" | "requesting" | "waiting" | "approved" | "rejected" | "left">("preview");
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load meeting info
  useEffect(() => {
    meetingsApi.getGuestInfo(inviteToken).then(setInfo).catch((err) => {
      const detail = err?.response?.data?.detail ?? "Ссылка недействительна или устарела.";
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
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Ошибка отправки запроса.";
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
            Ссылка недействительна
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
        <Spinner text="Загрузка информации о встрече…" />
      </PageShell>
    );
  }

  // ── Approved — enter LiveKit room ────────────────────────────────────────────
  if (phase === "approved" && livekitToken && livekitUrl) {
    return (
      <LiveKitRoom
        token={livekitToken}
        serverUrl={livekitUrl}
        connect
        video={camOn}
        audio={micOn}
        onDisconnected={() => setPhase("left")}
      >
        <RoomAudioRenderer />
        <GuestConferenceUI guestName={name} onLeave={() => setPhase("left")} />
      </LiveKitRoom>
    );
  }

  // ── Left ─────────────────────────────────────────────────────────────────────
  if (phase === "left") {
    return (
      <PageShell>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>👋</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>Вы покинули встречу</p>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 8 }}>Можно закрыть это окно.</p>
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
            В доступе отказано
          </p>
          <p style={{ fontSize: 13, color: "#94a3b8" }}>
            Организатор отклонил ваш запрос на подключение.
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
            Ожидание разрешения
          </p>
          <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 24 }}>
            Организатор уведомлён о вашем запросе. Пожалуйста, подождите.
          </p>
          <Spinner text="Ожидаем ответ организатора…" />
        </div>
      </PageShell>
    );
  }

  // ── Preview + form ────────────────────────────────────────────────────────────
  const startDate = new Date(info.start_time);
  const endDate = new Date(info.end_time);
  const dateStr = startDate.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const timeStr = `${fmtTime(startDate)}–${fmtTime(endDate)}`;

  return (
    <PageShell>
      {/* Meeting info */}
      <div style={{ marginBottom: 20, textAlign: "center" }}>
        <p style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
          Приглашение на встречу
        </p>
        <p style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>{info.title}</p>
        <p style={{ fontSize: 12, color: "#94a3b8" }}>{dateStr}, {timeStr}</p>
      </div>

      {/* Camera preview */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <CameraPreview micOn={micOn} camOn={camOn} />
      </div>

      {/* Device toggles */}
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 24 }}>
        <button
          onClick={() => setMicOn((v) => !v)}
          style={{
            padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)",
            background: micOn ? "rgba(59,130,246,0.15)" : "rgba(239,68,68,0.15)",
            color: micOn ? "#60a5fa" : "#f87171",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          {micOn ? "🎤 Микрофон вкл." : "🔇 Микрофон выкл."}
        </button>
        <button
          onClick={() => setCamOn((v) => !v)}
          style={{
            padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)",
            background: camOn ? "rgba(59,130,246,0.15)" : "rgba(239,68,68,0.15)",
            color: camOn ? "#60a5fa" : "#f87171",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          {camOn ? "📹 Камера вкл." : "📷 Камера выкл."}
        </button>
      </div>

      {/* Name input */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 6 }}>
          Ваше имя *
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleRequest(); }}
          placeholder="Введите имя и фамилию"
          maxLength={128}
          style={{
            width: "100%", padding: "10px 14px", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)", color: "#e2e8f0",
            fontSize: 14, outline: "none", boxSizing: "border-box",
          }}
        />
      </div>

      {/* Submit */}
      <button
        onClick={handleRequest}
        disabled={!name.trim() || phase === "requesting"}
        style={{
          width: "100%", padding: "12px", borderRadius: 10,
          background: name.trim() ? "linear-gradient(135deg,#1565a8,#3b82f6)" : "rgba(255,255,255,0.08)",
          color: name.trim() ? "#fff" : "#64748b",
          fontSize: 14, fontWeight: 700, cursor: name.trim() ? "pointer" : "not-allowed",
          border: "none", transition: "all 0.2s",
        }}
      >
        {phase === "requesting" ? "Отправка…" : "Запросить доступ"}
      </button>

      <p style={{ fontSize: 11, color: "#475569", textAlign: "center", marginTop: 12 }}>
        Организатор получит уведомление и должен будет разрешить ваш вход
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
      padding: 20, fontFamily: "Manrope, sans-serif",
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{
        width: "100%", maxWidth: 360,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 20, padding: "28px 24px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <span style={{
            fontFamily: "Manrope, sans-serif", fontWeight: 800, fontSize: 22,
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
