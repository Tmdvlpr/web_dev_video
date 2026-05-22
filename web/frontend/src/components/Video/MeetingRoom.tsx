import "@livekit/components-styles";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useIsSpeaking,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder, TrackReference } from "@livekit/components-react";
import { Track, Room, VideoPresets } from "livekit-client";
import type { LocalAudioTrack, LocalVideoTrack, Participant } from "livekit-client";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackgroundBlur } from "@livekit/track-processors";
import { KrispNoiseFilter, isKrispNoiseFilterSupported } from "@livekit/krisp-noise-filter";
import { meetingsApi } from "../../api/meetings";
import type { ChatMessage } from "../../types";
import { useTheme } from "../../contexts/ThemeContext";
import "./conference.css";

// ─── SVG system ───────────────────────────────────────────────────────────────
function Svg({
  sz = 20, fill = "none", stroke = "currentColor", sw = 2, vb = "0 0 24 24",
  children, style, className,
}: {
  sz?: number; fill?: string; stroke?: string; sw?: number; vb?: string;
  children: React.ReactNode; style?: React.CSSProperties; className?: string;
}) {
  return (
    <svg width={sz} height={sz} viewBox={vb} fill={fill} stroke={stroke}
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      style={style} className={className}>
      {children}
    </svg>
  );
}

const Ic = {
  Mic:      ({ sz = 20 }: { sz?: number }) => <Svg sz={sz}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></Svg>,
  MicOff:   ({ sz = 20 }: { sz?: number }) => <Svg sz={sz}><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></Svg>,
  Cam:      ({ sz = 20 }: { sz?: number }) => <Svg sz={sz}><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></Svg>,
  CamOff:   ({ sz = 20 }: { sz?: number }) => <Svg sz={sz}><line x1="1" y1="1" x2="23" y2="23" /><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" /></Svg>,
  Monitor:  ({ sz = 20 }: { sz?: number }) => <Svg sz={sz}><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></Svg>,
  Record:   ({ sz = 20 }: { sz?: number }) => <Svg sz={sz}><circle cx="12" cy="12" r="8" /></Svg>,
  Hand:     ({ sz = 20 }: { sz?: number }) => <Svg sz={sz}><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" /><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" /><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></Svg>,
  Users:    ({ sz = 20 }: { sz?: number }) => <Svg sz={sz}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>,
  Chat:     ({ sz = 20 }: { sz?: number }) => <Svg sz={sz}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Svg>,
  Settings: ({ sz = 20 }: { sz?: number }) => <Svg sz={sz}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></Svg>,
  Leave:    ({ sz = 20 }: { sz?: number }) => <Svg sz={sz}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></Svg>,
  Send:     ({ sz = 18 }: { sz?: number }) => <Svg sz={sz}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></Svg>,
  Close:    ({ sz = 16 }: { sz?: number }) => <Svg sz={sz}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Svg>,
  Crown:    ({ sz = 12 }: { sz?: number }) => <Svg sz={sz} fill="#f59e0b" stroke="none"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></Svg>,
  Info:     ({ sz = 18 }: { sz?: number }) => <Svg sz={sz}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></Svg>,
  Emoji:    ({ sz = 20 }: { sz?: number }) => <Svg sz={sz}><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></Svg>,
  Grid:     ({ sz = 18 }: { sz?: number }) => <Svg sz={sz}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></Svg>,
  Focus:    ({ sz = 18 }: { sz?: number }) => <Svg sz={sz}><rect x="2" y="3" width="13" height="18" rx="2" /><rect x="18" y="3" width="4" height="5" rx="1" /><rect x="18" y="10" width="4" height="5" rx="1" /><rect x="18" y="17" width="4" height="4" rx="1" /></Svg>,
  Cinema:   ({ sz = 18 }: { sz?: number }) => <Svg sz={sz}><rect x="2" y="3" width="20" height="12" rx="2" /><rect x="2" y="18" width="5" height="3" rx="1" /><rect x="9" y="18" width="5" height="3" rx="1" /><rect x="16" y="18" width="6" height="3" rx="1" /></Svg>,
  Copy:     ({ sz = 15 }: { sz?: number }) => <Svg sz={sz}><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Svg>,
  Check:    ({ sz = 14 }: { sz?: number }) => <Svg sz={sz}><polyline points="20 6 9 17 4 12" /></Svg>,
  Clock:    ({ sz = 13 }: { sz?: number }) => <Svg sz={sz}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Svg>,
  Cal:      ({ sz = 13 }: { sz?: number }) => <Svg sz={sz}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></Svg>,
  Shield:   ({ sz = 13 }: { sz?: number }) => <Svg sz={sz}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Svg>,
  Attach:   ({ sz = 18 }: { sz?: number }) => <Svg sz={sz}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></Svg>,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const COLORS = ["#4f7cff","#a855f7","#06b6d4","#f59e0b","#22c55e","#f43f5e","#ec4899"];

function colorFromIdentity(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}

function initialsFromName(name: string): string {
  const p = name.trim().split(/\s+/);
  return p.length >= 2
    ? (p[0][0] + p[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function wsBase(): string {
  const base = (import.meta.env.VITE_API_URL || window.location.origin) as string;
  return base.replace(/^https/, "wss").replace(/^http/, "ws");
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// Stable track sources — module-level prevents useTracks from re-subscribing on every render
const TRACK_SOURCES = [
  { source: Track.Source.Camera, withPlaceholder: true },
  { source: Track.Source.ScreenShare, withPlaceholder: false },
];
const TRACK_OPTIONS = { onlySubscribed: false };

// ─── Chat hook ────────────────────────────────────────────────────────────────
interface AdmissionRequest {
  invite_token: string;
  guest_name: string;
}

function useMeetingChat(
  bookingId: number,
  chatVisible: boolean,
  onReaction?: (emoji: string, userName: string) => void,
  onAdmissionRequest?: (req: AdmissionRequest) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [uploading, setUploading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const chatVisibleRef = useRef(chatVisible);
  useEffect(() => { chatVisibleRef.current = chatVisible; }, [chatVisible]);
  const onReactionRef = useRef(onReaction);
  useEffect(() => { onReactionRef.current = onReaction; }, [onReaction]);
  const onAdmissionRef = useRef(onAdmissionRequest);
  useEffect(() => { onAdmissionRef.current = onAdmissionRequest; }, [onAdmissionRequest]);

  useEffect(() => {
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 2000;

    meetingsApi.getChatHistory(bookingId)
      .then((msgs) => { if (mounted) setMessages(msgs); })
      .catch((err) => console.warn("Chat history fetch failed:", err));

    function connect() {
      if (!mounted) return;
      const token = localStorage.getItem("access_token") ?? "";
      const ws = new WebSocket(`${wsBase()}/api/v1/meetings/${bookingId}/chat/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => { retryDelay = 2000; };

      ws.onmessage = (e) => {
        if (!mounted) return;
        try {
          const msg = JSON.parse(e.data) as (ChatMessage & { type?: string; emoji?: string; user_name?: string; invite_token?: string; guest_name?: string; error?: string });
          if (msg.error) { console.warn("Chat WS auth error:", msg.error); return; }
          if (msg.type === "reaction") {
            onReactionRef.current?.(msg.emoji ?? "", msg.user_name ?? "");
            return;
          }
          if (msg.type === "admission_request") {
            onAdmissionRef.current?.({ invite_token: msg.invite_token ?? "", guest_name: msg.guest_name ?? "Гость" });
            return;
          }
          if (msg.type === "admission_response") return;
          setMessages((prev) => [...prev, msg]);
          if (!chatVisibleRef.current) setUnread((n) => n + 1);
        } catch (err) { console.warn("Chat WS parse error:", err, e.data); }
      };

      ws.onerror = (e) => console.warn("Chat WS error:", e);

      ws.onclose = (e) => {
        wsRef.current = null;
        if (!mounted) return;
        if (e.code === 4401) {
          console.warn("Chat WS 4401: auth failed, not reconnecting");
          return;
        }
        if (e.code === 4403) {
          console.warn("Chat WS closed: forbidden (4403), no access to this meeting");
          return;
        }
        console.warn(`Chat WS closed (${e.code}), reconnecting in ${retryDelay}ms…`);
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 1.5, 30_000);
          connect();
        }, retryDelay);
      };
    }

    connect();
    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  useEffect(() => {
    if (chatVisible) setUnread(0);
  }, [chatVisible]);

  const send = useCallback((body: string, fileId?: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ body, file_id: fileId ?? null }));
    }
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "reaction", emoji }));
    }
  }, []);

  const uploadAndSend = useCallback(async (file: File) => {
    if (file.size > 50 * 1024 * 1024) { alert("Файл слишком большой (макс. 50 МБ)"); return; }
    setUploading(true);
    try {
      const cf = await meetingsApi.uploadFile(bookingId, file);
      send("", cf.id);
    } finally {
      setUploading(false);
    }
  }, [bookingId, send]);

  return { messages, unread, send, sendReaction, uploadAndSend, uploading };
}

// ─── Video tile ───────────────────────────────────────────────────────────────
const LiveVideoTile = React.memo(function LiveVideoTile({
  trackRef,
  isActive,
  localIdentity,
  size = "sm",
  onClick,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  isActive: boolean;
  localIdentity: string;
  size?: "sm" | "md" | "lg" | "cinema" | "csm";
  onClick?: () => void;
}) {
  const participant = trackRef.participant as Participant | undefined;
  const isSpeaking = useIsSpeaking(participant);
  if (!participant) return null;
  const hasVideo = !!(trackRef.publication?.isEnabled && trackRef.publication?.track);
  const isLocal = participant.identity === localIdentity;
  const color = colorFromIdentity(participant.identity);
  const displayName = participant.name ?? participant.identity;
  const initials = initialsFromName(displayName);
  const shortName = isLocal ? "Вы" : displayName.split(" ").slice(0, 2).join(" ");

  return (
    <div
      className={`vtile vtile--${size}${isSpeaking ? " vtile--speaking" : ""}${isActive && !isSpeaking ? " vtile--active" : ""}`}
      onClick={onClick}
    >
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
        <div className="vtile__namewrap">
          <span className="vtile__name">{shortName}</span>
        </div>
        {!participant.isMicrophoneEnabled && (
          <div className="vtile__mutebadge"><Ic.MicOff sz={10} /></div>
        )}
      </div>
      {isSpeaking && <div className="vtile__sring" />}
    </div>
  );
});

// ─── Layouts ──────────────────────────────────────────────────────────────────
function FocusLayout({
  camTracks, screenTrack, pinnedId, localIdentity, onPin,
}: {
  camTracks: TrackReferenceOrPlaceholder[];
  screenTrack: TrackReferenceOrPlaceholder | null;
  pinnedId: string | null;
  localIdentity: string;
  onPin: (id: string | null) => void;
}) {
  const mainTrack = screenTrack
    ?? (pinnedId ? camTracks.find((t) => t.participant.identity === pinnedId) : null)
    ?? camTracks.find((t) => (t.participant as Participant).isSpeaking)
    ?? camTracks[0];
  const thumbs = camTracks.filter((t) => t !== mainTrack);

  return (
    <>
      <div className="thumbstrip">
        {thumbs.map((t) => (
          <LiveVideoTile
            key={t.participant.identity}
            trackRef={t}
            isActive={pinnedId === t.participant.identity}
            localIdentity={localIdentity}
            size="sm"
            onClick={() => onPin(pinnedId === t.participant.identity ? null : t.participant.identity)}
          />
        ))}
      </div>
      <div className="mainspeaker">
        {mainTrack && (
          <LiveVideoTile
            trackRef={mainTrack}
            isActive
            localIdentity={localIdentity}
            size="lg"
          />
        )}
      </div>
    </>
  );
}

function GalleryLayout({ camTracks, localIdentity }: { camTracks: TrackReferenceOrPlaceholder[]; localIdentity: string }) {
  return (
    <div className="gallerygrid">
      {camTracks.slice(0, 6).map((t) => (
        <LiveVideoTile key={t.participant.identity} trackRef={t} isActive={false} localIdentity={localIdentity} size="md" />
      ))}
    </div>
  );
}

function CinemaLayout({
  camTracks, screenTrack, pinnedId, localIdentity, onPin,
}: {
  camTracks: TrackReferenceOrPlaceholder[];
  screenTrack: TrackReferenceOrPlaceholder | null;
  pinnedId: string | null;
  localIdentity: string;
  onPin: (id: string | null) => void;
}) {
  const mainTrack = screenTrack
    ?? (pinnedId ? camTracks.find((t) => t.participant.identity === pinnedId) : null)
    ?? camTracks.find((t) => (t.participant as Participant).isSpeaking)
    ?? camTracks[0];
  const strip = camTracks.filter((t) => t !== mainTrack);

  return (
    <>
      <div className="cinemaspeaker">
        {mainTrack && <LiveVideoTile trackRef={mainTrack} isActive localIdentity={localIdentity} size="cinema" />}
      </div>
      <div className="cinemastrip">
        {strip.map((t) => (
          <LiveVideoTile
            key={t.participant.identity}
            trackRef={t}
            isActive={pinnedId === t.participant.identity}
            localIdentity={localIdentity}
            size="csm"
            onClick={() => onPin(pinnedId === t.participant.identity ? null : t.participant.identity)}
          />
        ))}
      </div>
    </>
  );
}

// ─── Control button ───────────────────────────────────────────────────────────
function CtrlBtn({
  icon, label, active = false, danger = false, onClick, badge, disabled = false,
}: {
  icon: React.ReactNode; label: string; active?: boolean; danger?: boolean;
  onClick?: () => void; badge?: number | null; disabled?: boolean;
}) {
  return (
    <button
      className={`ctrlbtn${active ? " ctrlbtn--active" : ""}${danger ? " ctrlbtn--danger" : ""}`}
      onClick={onClick} disabled={disabled} title={label}
    >
      <div className="ctrlbtn__icon">
        {icon}
        {badge != null && badge > 0 && <span className="ctrlbtn__badge">{badge}</span>}
      </div>
      <span className="ctrlbtn__label">{label}</span>
    </button>
  );
}

const REACTIONS = ["👍","❤️","😂","😮","👏","🎉","✋","🤔"];

function ReactionsPopup({ onReact, onClose }: { onReact: (e: string) => void; onClose: () => void }) {
  return (
    <div className="react-popup">
      {REACTIONS.map((r) => (
        <button key={r} className="react-popup__btn" onClick={() => { onReact(r); onClose(); }}>{r}</button>
      ))}
    </div>
  );
}

function ControlBar({
  micOn, camOn, screenOn, handUp, isRecording, showReactions, activePanel, participantCount, unread,
  onMic, onCam, onScreen, onHand, onRecord, onReact, setShowReactions,
  onParticipants, onChat, onSettings, onLeave,
}: {
  micOn: boolean; camOn: boolean; screenOn: boolean; handUp: boolean; isRecording: boolean;
  showReactions: boolean; activePanel: string | null; participantCount: number; unread: number;
  onMic: () => void; onCam: () => void; onScreen: () => void; onHand: () => void; onRecord: () => void;
  onReact: (e: string) => void; setShowReactions: (v: boolean | ((p: boolean) => boolean)) => void;
  onParticipants: () => void; onChat: () => void; onSettings: () => void; onLeave: () => void;
}) {
  return (
    <div className="ctrlbar">
      <div className="ctrlbar__inner">
        <div className="ctrlbar__group">
          <CtrlBtn icon={micOn ? <Ic.Mic sz={20} /> : <Ic.MicOff sz={20} />}
            label={micOn ? "Мут" : "Анмут"} active={!micOn} onClick={onMic} />
          <CtrlBtn icon={camOn ? <Ic.Cam sz={20} /> : <Ic.CamOff sz={20} />}
            label={camOn ? "Камера" : "Камера вкл"} active={!camOn} onClick={onCam} />
          <CtrlBtn icon={<Ic.Monitor sz={20} />}
            label={screenOn ? "Стоп" : "Экран"} active={screenOn} onClick={onScreen} />
          <div className="ctrlbar__sep" />
          <div style={{ position: "relative" }}>
            <CtrlBtn icon={<Ic.Emoji sz={20} />} label="Реакции"
              active={showReactions} onClick={() => setShowReactions((v) => !v)} />
            {showReactions && (
              <ReactionsPopup onReact={onReact} onClose={() => setShowReactions(false)} />
            )}
          </div>
          <CtrlBtn icon={<Ic.Hand sz={20} />} label={handUp ? "Опустить" : "Рука"} active={handUp} onClick={onHand} />
          <div className="ctrlbar__sep" />
          <CtrlBtn icon={<Ic.Record sz={20} />} label={isRecording ? "REC" : "Запись"}
            active={isRecording} danger={isRecording} onClick={onRecord} />
        </div>

        <div className="ctrlbar__group ctrlbar__group--center">
          <CtrlBtn icon={<Ic.Users sz={20} />} label="Участники"
            active={activePanel === "participants"} badge={participantCount} onClick={onParticipants} />
          <CtrlBtn icon={<Ic.Chat sz={20} />} label="Чат"
            active={activePanel === "chat"} badge={unread > 0 ? unread : null} onClick={onChat} />
          <CtrlBtn icon={<Ic.Settings sz={20} />} label="Настройки" onClick={onSettings} />
        </div>

        <div className="ctrlbar__group ctrlbar__group--right">
          <button className="ctrlbtn ctrlbtn--leave" onClick={onLeave}>
            <div className="ctrlbtn__icon"><Ic.Leave sz={20} /></div>
            <span className="ctrlbtn__label">Покинуть</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Chat panel ───────────────────────────────────────────────────────────────
function ChatPanelInner({
  messages, bookingId, localUserId, onSend, onFile, uploading,
}: {
  messages: ChatMessage[];
  bookingId: number;
  localUserId: number;
  onSend: (body: string) => void;
  onFile: (file: File) => void;
  uploading: boolean;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    const t = draft.trim();
    if (!t) return;
    onSend(t);
    setDraft("");
  };

  return (
    <div className="chatpanel">
      <div className="chatpanel__msgs" ref={listRef}>
        {messages.length === 0 && <div className="chatpanel__empty">Сообщений пока нет</div>}
        {messages.map((m) => {
          const color = colorFromIdentity(String(m.user_id));
          const initials = initialsFromName(m.user_name);
          const isSelf = m.user_id === localUserId;
          return (
            <div key={m.id} className={`cmsg${isSelf ? " cmsg--self" : ""}`}>
              <div className="cmsg__av" style={{ background: `${color}22`, color }}>{initials}</div>
              <div className="cmsg__body">
                <div className="cmsg__author" style={{ color }}>{m.user_name}</div>
                <div className="cmsg__bubble">
                  {m.body && <span className="cmsg__text">{m.body}</span>}
                  {m.file && (
                    <a
                      className="cmsg__file"
                      href={meetingsApi.downloadFileUrl(bookingId, m.file.id)}
                      download={m.file.filename}
                    >
                      📎 {m.file.filename} <span className="cmsg__filesz">({(m.file.size / 1024).toFixed(0)} KB)</span>
                    </a>
                  )}
                  <span className="cmsg__time">{fmtTime(new Date(m.created_at))}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {uploading && <div className="chatpanel__uploading">Загрузка файла…</div>}
      <div className="chatpanel__input">
        <button className="chatpanel__attach" onClick={() => fileRef.current?.click()} title="Прикрепить файл">
          <Ic.Attach sz={16} />
        </button>
        <input
          className="chatpanel__field"
          placeholder="Написать сообщение…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        />
        <button
          className="chatpanel__send"
          onClick={handleSend}
          disabled={!draft.trim()}
          style={{ background: "var(--accent)" }}
        >
          <Ic.Send sz={15} />
        </button>
        <input
          ref={fileRef} type="file" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
        />
      </div>
    </div>
  );
}

// ─── Participants panel ───────────────────────────────────────────────────────
function ParticipantsPanel({
  participants, localIdentity, bookingId, isOrganizer,
}: {
  participants: Participant[];
  localIdentity: string;
  bookingId: number;
  isOrganizer: boolean;
}) {
  const [search, setSearch] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);

  const deduped = useMemo(() => {
    const seen = new Set<string>();
    return participants.filter((p) => {
      if (seen.has(p.identity)) return false;
      seen.add(p.identity);
      return true;
    });
  }, [participants]);
  const filtered = deduped.filter((p) =>
    (p.name ?? p.identity).toLowerCase().includes(search.toLowerCase())
  );

  const handleCreateInvite = async () => {
    setInviteLoading(true);
    try {
      const res = await meetingsApi.createInvite(bookingId);
      setInviteUrl(res.invite_url);
    } catch (e) {
      alert("Не удалось создать ссылку-приглашение");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopy = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="ppanel">
      <div className="ppanel__top">
        <input className="ppanel__search" placeholder="Поиск…" value={search}
          onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="ppanel__list">
        {filtered.map((p) => {
          const color = colorFromIdentity(p.identity);
          const name = p.name ?? p.identity;
          const initials = initialsFromName(name);
          const isLocal = p.identity === localIdentity;
          return (
            <div key={p.identity} className="prow">
              <div className="prow__av" style={{ background: `${color}22`, color }}>{initials}</div>
              <div className="prow__info">
                <div className="prow__name"><span>{isLocal ? "Вы" : name}</span></div>
              </div>
              <div className="prow__icons">
                <span className={`prow__ico${!p.isMicrophoneEnabled ? " prow__ico--muted" : ""}`}>
                  {p.isMicrophoneEnabled ? <Ic.Mic sz={13} /> : <Ic.MicOff sz={13} />}
                </span>
                <span className={`prow__ico${!p.isCameraEnabled ? " prow__ico--muted" : ""}`}>
                  {p.isCameraEnabled ? <Ic.Cam sz={13} /> : <Ic.CamOff sz={13} />}
                </span>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="ppanel__empty">Не найдено</div>}
      </div>

      {/* Invite external guest — only organizer */}
      {isOrganizer && (
        <div style={{ padding: "10px 10px 12px", borderTop: "1px solid var(--brd)" }}>
          {!inviteUrl ? (
            <button
              onClick={handleCreateInvite}
              disabled={inviteLoading}
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 8,
                background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)",
                color: "#60a5fa", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              {inviteLoading ? "Создание…" : "🔗 Пригласить внешнего гостя"}
            </button>
          ) : (
            <div>
              <p style={{ fontSize: 11, color: "var(--tx3)", marginBottom: 6 }}>
                Ссылка действительна 24 часа:
              </p>
              <div style={{
                display: "flex", gap: 6, alignItems: "center",
                background: "var(--bg)", borderRadius: 8, padding: "6px 8px",
                border: "1px solid var(--brd)",
              }}>
                <span style={{
                  flex: 1, fontSize: 10, color: "var(--tx2)", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {inviteUrl}
                </span>
                <button
                  onClick={handleCopy}
                  style={{
                    flexShrink: 0, padding: "4px 8px", borderRadius: 6,
                    background: copied ? "rgba(34,197,94,0.15)" : "rgba(59,130,246,0.15)",
                    border: "none", color: copied ? "#4ade80" : "#60a5fa",
                    fontSize: 11, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {copied ? <Ic.Check sz={12} /> : <Ic.Copy sz={12} />}
                </button>
              </div>
              <button
                onClick={() => { setInviteUrl(null); setCopied(false); }}
                style={{
                  marginTop: 6, width: "100%", padding: "6px", borderRadius: 6,
                  background: "transparent", border: "1px solid var(--brd)",
                  color: "var(--tx3)", fontSize: 11, cursor: "pointer",
                }}
              >
                Создать новую ссылку
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({
  activePanel, onPanelChange, onClose, messages, participants, localIdentity,
  localUserId, bookingId, isOrganizer, onSend, onFile, uploading,
  noiseOn, blurOn, onNoise, onBlur,
}: {
  activePanel: "chat" | "participants" | "settings";
  onPanelChange: (p: "chat" | "participants" | "settings") => void;
  onClose: () => void;
  messages: ChatMessage[];
  participants: Participant[];
  localIdentity: string;
  localUserId: number;
  bookingId: number;
  isOrganizer: boolean;
  onSend: (body: string) => void;
  onFile: (file: File) => void;
  uploading: boolean;
  noiseOn: boolean;
  blurOn: boolean;
  onNoise: () => void;
  onBlur: () => void;
}) {
  return (
    <div className="sidebar">
      <div className="sidebar__hd">
        <div className="sidebar__tabs">
          <button className={`sidebar__tab${activePanel === "chat" ? " sidebar__tab--on" : ""}`}
            onClick={() => onPanelChange("chat")}>
            <Ic.Chat sz={13} /><span>Чат</span>
          </button>
          <button className={`sidebar__tab${activePanel === "participants" ? " sidebar__tab--on" : ""}`}
            onClick={() => onPanelChange("participants")}>
            <Ic.Users sz={13} /><span>Участники ({participants.length})</span>
          </button>
          <button className={`sidebar__tab${activePanel === "settings" ? " sidebar__tab--on" : ""}`}
            onClick={() => onPanelChange("settings")}>
            <Ic.Settings sz={13} /><span>Настройки</span>
          </button>
        </div>
        <button className="sidebar__close" onClick={onClose}><Ic.Close sz={14} /></button>
      </div>
      <div className="sidebar__body">
        {activePanel === "chat" && (
          <ChatPanelInner
            messages={messages} bookingId={bookingId} localUserId={localUserId}
            onSend={onSend} onFile={onFile} uploading={uploading}
          />
        )}
        {activePanel === "participants" && (
          <ParticipantsPanel
            participants={participants}
            localIdentity={localIdentity}
            bookingId={bookingId}
            isOrganizer={isOrganizer}
          />
        )}
        {activePanel === "settings" && (
          <SettingsPanel bookingId={bookingId} noiseOn={noiseOn} blurOn={blurOn} onNoise={onNoise} onBlur={onBlur} />
        )}
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
function MeetingHeader({
  title, elapsed, isRecording, isSharingScreen, layoutMode, participantCount,
  onLayoutChange, onInfoClick,
}: {
  title: string; elapsed: number; isRecording: boolean; isSharingScreen: boolean;
  layoutMode: string; participantCount: number;
  onLayoutChange: (m: string) => void; onInfoClick: () => void;
}) {
  return (
    <div className="mhdr">
      <div className="mhdr__left">
        <span className="mhdr__title">{title}</span>
        <div className="mhdr__badges">
          <span className="mhdr__badge"><Ic.Clock sz={11} />{fmtElapsed(elapsed)}</span>
          <span className="mhdr__badge"><Ic.Users sz={11} />{participantCount}</span>
          {isRecording && (
            <span className="mhdr__badge mhdr__badge--rec">
              <span className="mhdr__recdot" />REC
            </span>
          )}
          {isSharingScreen && (
            <span className="mhdr__badge mhdr__badge--share">
              <Ic.Monitor sz={11} />Демонстрация
            </span>
          )}
        </div>
      </div>
      <div className="mhdr__center">
        <div className="mhdr__layouts">
          {(["focus","gallery","cinema"] as const).map((mode) => (
            <button key={mode}
              className={`mhdr__lbtn${layoutMode === mode ? " mhdr__lbtn--on" : ""}`}
              onClick={() => onLayoutChange(mode)} title={mode}>
              {mode === "focus" ? <Ic.Focus sz={15} /> : mode === "gallery" ? <Ic.Grid sz={15} /> : <Ic.Cinema sz={15} />}
            </button>
          ))}
        </div>
      </div>
      <div className="mhdr__right">
        <button className="mhdr__infobtn" onClick={onInfoClick}>
          <Ic.Info sz={15} /><span>Инфо</span>
        </button>
      </div>
    </div>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function MeetingInfoModal({ title, startTime, endTime, participantCount, meetingUrl, onClose }: {
  title: string; startTime: string; endTime: string; participantCount: number;
  meetingUrl: string; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(meetingUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const start = new Date(startTime);
  const end = new Date(endTime);
  const dateStr = start.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const timeStr = `${fmtTime(start)}–${fmtTime(end)}`;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__hd"><span>Информация о встрече</span><button className="modal__x" onClick={onClose}><Ic.Close sz={14} /></button></div>
        <div className="modal__bd">
          <div className="modal__row"><span className="modal__rowicon"><Ic.Cal sz={13} /></span><div><div className="modal__rowlabel">Название</div><div className="modal__rowval">{title}</div></div></div>
          <div className="modal__row"><span className="modal__rowicon"><Ic.Clock sz={13} /></span><div><div className="modal__rowlabel">Дата и время</div><div className="modal__rowval">{dateStr}, {timeStr}</div></div></div>
          <div className="modal__row"><span className="modal__rowicon"><Ic.Users sz={13} /></span><div><div className="modal__rowlabel">Участники</div><div className="modal__rowval">{participantCount} чел.</div></div></div>
          <div className="modal__divider" />
          <div className="modal__linklabel">Ссылка на встречу</div>
          <div className="modal__linkrow">
            <code className="modal__link">{meetingUrl}</code>
            <button className="modal__copybtn" onClick={copy}>
              {copied ? <Ic.Check sz={13} /> : <Ic.Copy sz={13} />}
              {copied ? "Скопировано" : "Копировать"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LeaveModal({ onClose, onLeave }: { onClose: () => void; onLeave: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal__hd"><span>Покинуть встречу?</span><button className="modal__x" onClick={onClose}><Ic.Close sz={14} /></button></div>
        <div className="modal__bd"><p className="modal__text">Вы хотите покинуть эту видеоконференцию?</p></div>
        <div className="modal__ft modal__ft--col">
          <button className="modal__btn modal__btn--danger" onClick={onLeave}>Покинуть встречу</button>
          <button className="modal__btn" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

// ─── Floating reaction ────────────────────────────────────────────────────────
function FloatingReaction({ emoji, id, onDone }: { emoji: string; id: number; onDone: () => void }) {
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  // Empty deps: timer starts once on mount, calls latest onDone via ref to avoid resets
  useEffect(() => { const t = setTimeout(() => onDoneRef.current(), 3200); return () => clearTimeout(t); }, []);
  const rx = `${((id % 7) - 3) * 18}px`;
  return <div className="floatreact" style={{ ["--rx" as string]: rx }}>{emoji}</div>;
}

// ─── Waiting room ─────────────────────────────────────────────────────────────
function WaitingRoom({ startTime, onLeave, bookingId, onJoin, localUserId }: { startTime: string; onLeave: () => void; bookingId: number; onJoin: () => void; localUserId: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(startTime).getTime() - Date.now()));
  const [chatOpen, setChatOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { isDark } = useTheme();
  const isDarkRef = useRef(isDark);
  useEffect(() => { isDarkRef.current = isDark; }, [isDark]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf: number;
    let tick = 0;
    const mouse = { x: -9999, y: -9999 };
    const vel = { v: 0 };
    let lastMX = 0, lastMY = 0;

    const COLS = 18, ROWS = 11;
    type Node = { x: number; y: number; active: boolean; pulse: number };
    let nodes: Node[] = [];

    const buildNodes = () => {
      const W = canvas.width, H = canvas.height;
      nodes = Array.from({ length: (COLS + 1) * (ROWS + 1) }, (_, i) => {
        const c = i % (COLS + 1), r = Math.floor(i / (COLS + 1));
        return { x: (c / COLS) * W, y: (r / ROWS) * H, active: Math.random() > 0.42, pulse: Math.random() * Math.PI * 2 };
      });
    };

    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; buildNodes(); };
    resize();

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const dx = e.clientX - lastMX, dy = e.clientY - lastMY;
      vel.v = Math.min(Math.sqrt(dx * dx + dy * dy) / 20, 4);
      mouse.x = e.clientX - rect.left; mouse.y = e.clientY - rect.top;
      lastMX = e.clientX; lastMY = e.clientY;
    };
    window.addEventListener("mousemove", onMove);

    type DP = { nx: number; ny: number; t: number; speed: number; horiz: boolean };
    const dps: DP[] = Array.from({ length: 65 }, () => ({
      nx: Math.floor(Math.random() * COLS), ny: Math.floor(Math.random() * ROWS),
      t: Math.random(), speed: 0.004 + Math.random() * 0.006, horiz: Math.random() > 0.5,
    }));

    let rebuildCd = 0;
    const draw = () => {
      tick++; vel.v *= 0.88; rebuildCd--;
      if (vel.v > 1.8 && rebuildCd <= 0) { rebuildCd = 18; buildNodes(); }
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // grid lines
      for (let r = 0; r <= ROWS; r++) {
        for (let c = 0; c <= COLS; c++) {
          const nd = nodes[r * (COLS + 1) + c];
          if (!nd?.active) continue;
          const nd2 = c < COLS ? nodes[r * (COLS + 1) + c + 1] : null;
          if (nd2?.active) {
            ctx.beginPath(); ctx.moveTo(nd.x, nd.y); ctx.lineTo(nd2.x, nd2.y);
            ctx.strokeStyle = isDarkRef.current ? "rgba(79,124,255,0.12)" : "rgba(59,130,246,0.15)";
            ctx.lineWidth = 1; ctx.stroke();
          }
          const nd3 = r < ROWS ? nodes[(r + 1) * (COLS + 1) + c] : null;
          if (nd3?.active) {
            ctx.beginPath(); ctx.moveTo(nd.x, nd.y); ctx.lineTo(nd3.x, nd3.y);
            ctx.strokeStyle = isDarkRef.current ? "rgba(99,102,241,0.10)" : "rgba(99,102,241,0.12)";
            ctx.lineWidth = 1; ctx.stroke();
          }
        }
      }

      // nodes
      for (const nd of nodes) {
        if (!nd.active) continue;
        const pulse = 0.3 + Math.abs(Math.sin(nd.pulse + tick * 0.012)) * 0.5;
        const dist = Math.sqrt((nd.x - mouse.x) ** 2 + (nd.y - mouse.y) ** 2);
        const prox = Math.max(0, 1 - dist / 220);
        ctx.beginPath(); ctx.arc(nd.x, nd.y, 1.5 + prox * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = isDarkRef.current
          ? `rgba(96,165,250,${pulse * 0.45 + prox * 0.55})`
          : `rgba(37,99,235,${pulse * 0.38 + prox * 0.48})`; ctx.fill();
      }

      // data particles — comet style
      const vb = 1 + vel.v * 2.5;
      const dark = isDarkRef.current;
      for (const p of dps) {
        p.t += p.speed * vb;
        if (p.t > 1) { p.t = 0; p.nx = Math.floor(Math.random() * COLS); p.ny = Math.floor(Math.random() * ROWS); }
        const base = nodes[p.ny * (COLS + 1) + p.nx];
        const next = p.horiz ? nodes[p.ny * (COLS + 1) + Math.min(p.nx + 1, COLS)] : nodes[Math.min(p.ny + 1, ROWS) * (COLS + 1) + p.nx];
        if (!base?.active || !next?.active) continue;
        const px = base.x + (next.x - base.x) * p.t, py = base.y + (next.y - base.y) * p.t;
        const ddx = next.x - base.x, ddy = next.y - base.y;
        const dlen = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dlen < 0.001) continue;
        const dnx = ddx / dlen, dny = ddy / dlen;
        const tailLen = 42 + vel.v * 14;
        const tx = px - dnx * tailLen, ty = py - dny * tailLen;
        const tailGrad = ctx.createLinearGradient(px, py, tx, ty);
        if (dark) {
          tailGrad.addColorStop(0, "rgba(147,197,253,0.88)");
          tailGrad.addColorStop(0.35, "rgba(96,165,250,0.42)");
          tailGrad.addColorStop(1, "rgba(79,124,255,0)");
        } else {
          tailGrad.addColorStop(0, "rgba(37,99,235,0.82)");
          tailGrad.addColorStop(0.38, "rgba(59,130,246,0.35)");
          tailGrad.addColorStop(1, "rgba(99,102,241,0)");
        }
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty);
        ctx.strokeStyle = tailGrad; ctx.lineWidth = 1.5; ctx.lineCap = "round"; ctx.stroke();
        const headG = ctx.createRadialGradient(px, py, 0, px, py, 8);
        headG.addColorStop(0, dark ? "rgba(147,220,255,0.55)" : "rgba(37,99,235,0.42)");
        headG.addColorStop(1, "transparent");
        ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fillStyle = headG; ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = dark ? "rgba(220,240,255,0.95)" : "rgba(30,64,175,0.92)"; ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("mousemove", onMove); };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setRemaining(Math.max(0, new Date(startTime).getTime() - Date.now())), 1000);
    return () => clearInterval(t);
  }, [startTime]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onLeave(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLeave]);

  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1_000);

  const startDate = new Date(startTime);
  const timeStr = fmtTime(startDate);
  const dateStr = startDate.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

  const { messages, send, uploadAndSend, uploading } = useMeetingChat(bookingId, chatOpen);

  return (
    <div className="conf-root fixed inset-0 z-[9999] flex" style={{ background: "var(--bg)" }}>
      <div className="waitroom">
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
        {/* Chat toggle — top-right */}
        <button
          className={`waitroom__chattoggle${chatOpen ? " waitroom__chattoggle--on" : ""}`}
          onClick={() => setChatOpen((v) => !v)}
        >
          <Ic.Chat sz={15} /><span>Чат</span>
        </button>

        <div className="waitroom__content">
          {/* Icon circle */}
          <div className="waitroom__icon-circle">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 10l4.553-2.069A1 1 0 0121 8.854v6.292a1 1 0 01-1.447.894L15 14M5 8h10a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4a2 2 0 012-2z"/>
            </svg>
          </div>

          {/* Label with separator lines */}
          <div className="waitroom__dlabel">
            <span>Конференция запланирована на</span>
          </div>

          {/* Big time */}
          <p className="waitroom__time">{timeStr}</p>

          {/* Date */}
          <p className="waitroom__date">{dateStr}</p>

          {/* Flat countdown */}
          {remaining > 0 && (
            <div className="waitroom__countdown">
              {h > 0 && (
                <>
                  <div className="waitroom__cblock">
                    <span className="waitroom__cnum">{String(h).padStart(2, "0")}</span>
                    <span className="waitroom__cunit">{h === 1 ? "час" : h < 5 ? "часа" : "часов"}</span>
                  </div>
                  <span className="waitroom__csep">:</span>
                </>
              )}
              <div className="waitroom__cblock">
                <span className="waitroom__cnum">{String(m).padStart(2, "0")}</span>
                <span className="waitroom__cunit">минут</span>
              </div>
              <span className="waitroom__csep">:</span>
              <div className="waitroom__cblock">
                <span className="waitroom__cnum">{String(s).padStart(2, "0")}</span>
                <span className="waitroom__cunit">секунд</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="waitroom__actions">
            <button className="waitroom__join" onClick={onJoin}>Войти заранее</button>
            <button className="waitroom__leave" onClick={onLeave}>Выйти</button>
          </div>
        </div>
      </div>

      {/* Chat sidebar — animated slide in/out */}
      <div className={`swrap${chatOpen ? " swrap--on" : ""}`}>
        <div className="sidebar">
          <div className="sidebar__hd">
            <div className="sidebar__tabs">
              <button className="sidebar__tab sidebar__tab--on"><Ic.Chat sz={13} /><span>Чат встречи</span></button>
            </div>
            <button className="sidebar__close" onClick={() => setChatOpen(false)}><Ic.Close sz={14} /></button>
          </div>
          <div className="sidebar__body">
            <ChatPanelInner
              messages={messages} bookingId={bookingId} localUserId={localUserId}
              onSend={send} onFile={uploadAndSend} uploading={uploading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Settings panel (noise/blur + recordings) ────────────────────────────────
function SettingsPanel({ bookingId, noiseOn, blurOn, onNoise, onBlur }: {
  bookingId: number;
  noiseOn: boolean;
  blurOn: boolean;
  onNoise: () => void;
  onBlur: () => void;
}) {
  const { data: recordings = [], isLoading } = useQuery({
    queryKey: ["recordings", bookingId],
    queryFn: () => meetingsApi.getRecordings(bookingId),
    refetchInterval: 15_000,
  });

  function fmtDur(sec: number | null) {
    if (sec == null) return "—";
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 12px", borderRadius: 8, background: "var(--bg)",
    border: "1px solid var(--brd)", marginBottom: 8,
  };
  const knobStyle = (on: boolean): React.CSSProperties => ({
    position: "absolute", top: "50%", transform: "translateY(-50%)",
    left: on ? 21 : 2, width: 16, height: 16,
    borderRadius: "50%", background: "#fff",
    transition: "left 0.2s",
  });
  const trackStyle = (on: boolean): React.CSSProperties => ({
    position: "relative", width: 40, height: 22, borderRadius: 11, flexShrink: 0,
    background: on ? "var(--accent)" : "var(--brd)", cursor: "pointer",
    border: "none", transition: "background 0.2s",
  });

  return (
    <div className="chatpanel">
      <div className="chatpanel__msgs" style={{ padding: "12px 10px" }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: "var(--tx2)", marginBottom: 10 }}>
          Настройки
        </p>
        <div style={rowStyle}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--tx1)", margin: 0 }}>Шумоподавление</p>
            <p style={{ fontSize: 11, color: "var(--tx3)", margin: 0 }}>Krisp AI</p>
          </div>
          <button style={trackStyle(noiseOn)} onClick={onNoise}>
            <span style={knobStyle(noiseOn)} />
          </button>
        </div>
        <div style={rowStyle}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--tx1)", margin: 0 }}>Размытие фона</p>
            <p style={{ fontSize: 11, color: "var(--tx3)", margin: 0 }}>Камера</p>
          </div>
          <button style={trackStyle(blurOn)} onClick={onBlur}>
            <span style={knobStyle(blurOn)} />
          </button>
        </div>
        <p style={{ fontSize: 12, fontWeight: 700, color: "var(--tx2)", margin: "16px 0 10px" }}>
          Записи встречи
        </p>
        {isLoading && <p style={{ fontSize: 12, color: "var(--tx3)" }}>Загрузка…</p>}
        {!isLoading && recordings.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--tx3)" }}>
            Записей пока нет. Нажмите «Запись» чтобы начать.
          </p>
        )}
        {recordings.map((r) => (
          <div key={r.session_id} style={{
            marginBottom: 8, padding: "8px 10px",
            background: "var(--bg)", borderRadius: 8, border: "1px solid var(--brd)",
          }}>
            <p style={{ fontSize: 11, color: "var(--tx3)", marginBottom: 4 }}>
              {new Date(r.started_at).toLocaleString("ru-RU")} · {fmtDur(r.recording_duration_seconds)}
            </p>
            {r.has_recording ? (
              <a
                href={meetingsApi.downloadRecordingUrl(bookingId, r.session_id)}
                download={`recording-${r.session_id}.mp4`}
                style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}
              >
                ⬇ Скачать запись
              </a>
            ) : (
              <p style={{ fontSize: 12, color: "var(--tx3)" }}>Обрабатывается…</p>
            )}
          </div>
        ))}
        <p style={{ fontSize: 11, color: "var(--tx3)", marginTop: 12, lineHeight: 1.5 }}>
          Файлы чата и записи сохраняются на сервере.<br />
          При скачивании браузер откроет диалог выбора папки.
        </p>
      </div>
    </div>
  );
}

// ─── Conference UI (inner, uses LiveKit hooks) ────────────────────────────────
function ConferenceUI({
  bookingId, onLeave, joinData, isOrganizer,
}: {
  bookingId: number;
  onLeave: () => void;
  joinData: { start_time: string; end_time: string; room_name: string; user_identity: string };
  isOrganizer: boolean;
}) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();
  const _allRemote = useRemoteParticipants();
  // Explicitly exclude any remote participant whose identity matches ours — this eliminates
  // ghost connections (old WebRTC session still alive in LiveKit) that appear as a remote
  // participant before the server-side kick completes.
  const remoteParticipants = useMemo(() => {
    // Guard: if our identity isn't set yet (room still connecting), hide all remotes
    // to prevent ghost connections from slipping in before the kick completes.
    // Use joinData.user_identity as fallback so the filter works even before
    // localParticipant.identity is populated.
    const localId = localParticipant.identity || joinData.user_identity;
    if (!localId) return [];
    return _allRemote.filter((p) => p.identity !== localId);
  }, [_allRemote, localParticipant.identity, joinData.user_identity]);
  const allParticipants: Participant[] = useMemo(() => {
    const seen = new Set<string>();
    const result: Participant[] = [];
    for (const p of [localParticipant as Participant, ...remoteParticipants]) {
      if (!seen.has(p.identity)) {
        seen.add(p.identity);
        result.push(p);
      }
    }
    return result;
  }, [localParticipant, remoteParticipants]);

  // ── Krisp noise cancellation (auto-apply from profile settings) ────────────
  const noiseApplied = useRef(false);
  useEffect(() => {
    if (noiseApplied.current || !isMicrophoneEnabled) return;
    if (localStorage.getItem("meeting.noise_filter") !== "true") return;
    if (!isKrispNoiseFilterSupported()) return;
    const pub = localParticipant.getTrackPublication(Track.Source.Microphone);
    const micTrack = pub?.track as LocalAudioTrack | undefined;
    if (!micTrack) return;
    noiseApplied.current = true;
    micTrack.setProcessor(KrispNoiseFilter()).catch(console.warn);
  }, [localParticipant, isMicrophoneEnabled]);

  // ── Background blur: reset flag when camera turns off so it re-applies on next enable ──
  const blurApplied = useRef(false);
  useEffect(() => {
    if (!isCameraEnabled) {
      // Camera turned off — stop processor on current track to prevent crash on re-enable
      const pub = localParticipant.getTrackPublication(Track.Source.Camera);
      const camTrack = pub?.track as LocalVideoTrack | undefined;
      if (camTrack) camTrack.stopProcessor().catch(() => {});
      blurApplied.current = false;
      return;
    }
    if (blurApplied.current) return;
    if (localStorage.getItem("meeting.background_blur") !== "true") return;
    const pub = localParticipant.getTrackPublication(Track.Source.Camera);
    const camTrack = pub?.track as LocalVideoTrack | undefined;
    if (!camTrack) return;
    blurApplied.current = true;
    camTrack.setProcessor(BackgroundBlur(10)).catch(console.warn);
  }, [localParticipant, isCameraEnabled]);

  // ── Noise/blur toggle state (for settings panel) ──────────────────────────
  const [noiseOn, setNoiseOn] = useState(() => localStorage.getItem("meeting.noise_filter") === "true");
  const [blurOn, setBlurOn] = useState(() => localStorage.getItem("meeting.background_blur") === "true");

  const toggleNoise = useCallback(async () => {
    const next = !noiseOn;
    setNoiseOn(next);
    localStorage.setItem("meeting.noise_filter", String(next));
    const pub = localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = pub?.track as LocalAudioTrack | undefined;
    if (!track) return;
    if (next && isKrispNoiseFilterSupported()) await track.setProcessor(KrispNoiseFilter()).catch(console.warn);
    else await track.stopProcessor().catch(console.warn);
  }, [noiseOn, localParticipant]);

  const toggleBlur = useCallback(async () => {
    const next = !blurOn;
    setBlurOn(next);
    localStorage.setItem("meeting.background_blur", String(next));
    const pub = localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.track as LocalVideoTrack | undefined;
    if (!track) return;
    if (next) await track.setProcessor(BackgroundBlur(10)).catch(console.warn);
    else await track.stopProcessor().catch(console.warn);
  }, [blurOn, localParticipant]);

  const allTracks = useTracks(TRACK_SOURCES, TRACK_OPTIONS);

  // Deduplicate camera tracks by identity: prefer local participant's track over any ghost remote
  // track with the same identity. Without this, duplicate video tiles appear in the grid.
  const camTracks = useMemo(() => {
    const localId = localParticipant.identity;
    const seen = new Set<string>();
    const result: TrackReferenceOrPlaceholder[] = [];
    // Local participant first so their track wins over any ghost with the same identity
    const sorted = [...allTracks].sort((a, b) => {
      if (a.participant.identity === localId) return -1;
      if (b.participant.identity === localId) return 1;
      return 0;
    });
    for (const t of sorted) {
      if (t.source !== Track.Source.Camera) continue;
      if (!seen.has(t.participant.identity)) {
        seen.add(t.participant.identity);
        result.push(t);
      }
    }
    return result;
  }, [allTracks, localParticipant]);
  const screenTrack = allTracks.find((t) => t.source === Track.Source.ScreenShare && t.publication?.isEnabled) ?? null;

  const localUserId = parseInt(joinData.user_identity.replace("user-", ""), 10) || 0;

  const [layoutMode, setLayoutMode] = useState<"focus" | "gallery" | "cinema">("focus");
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<"chat" | "participants" | "settings" | null>(null);
  const [showReactions, setShowReactions] = useState(false);
  const [handUp, setHandUp] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [floatReactions, setFloatReactions] = useState<{ id: number; emoji: string }[]>([]);
  const [modal, setModal] = useState<"info" | "leave" | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(new Date(joinData.start_time).getTime());
  const [pendingAdmissions, setPendingAdmissions] = useState<AdmissionRequest[]>([]);
  const dismissedAdmissions = useRef<Set<string>>(new Set());

  const chatVisible = activePanel === "chat";
  const { messages, unread, send, sendReaction, uploadAndSend, uploading } = useMeetingChat(
    bookingId,
    chatVisible,
    (emoji) => {
      setFloatReactions((prev) => [...prev, { id: Date.now() + Math.random(), emoji }]);
    },
    isOrganizer
      ? (req) => setPendingAdmissions((prev) => {
          if (prev.some((r) => r.invite_token === req.invite_token)) return prev;
          return [...prev, req];
        })
      : undefined,
  );

  const handleAdmit = useCallback(async (inviteToken: string, action: "approve" | "reject") => {
    dismissedAdmissions.current.add(inviteToken);
    setPendingAdmissions((prev) => prev.filter((r) => r.invite_token !== inviteToken));
    try {
      await meetingsApi.admitGuest(bookingId, inviteToken, action);
    } catch (err) {
      console.warn("admit failed:", err);
    }
  }, [bookingId]);

  // Polling fallback — catches admission requests missed by WS broadcast
  useEffect(() => {
    if (!isOrganizer) return;
    const poll = async () => {
      try {
        const pending = await meetingsApi.getPendingAdmissions(bookingId);
        if (pending.length > 0) {
          setPendingAdmissions((prev) => {
            const existing = new Set(prev.map((r) => r.invite_token));
            const fresh = pending.filter(
              (r) => !existing.has(r.invite_token) && !dismissedAdmissions.current.has(r.invite_token),
            );
            return fresh.length > 0 ? [...prev, ...fresh] : prev;
          });
        }
      } catch { /* silent */ }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [bookingId, isOrganizer]);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const togglePanel = (panel: "chat" | "participants" | "settings") =>
    setActivePanel((p) => (p === panel ? null : panel));

  const addReaction = (emoji: string) => {
    sendReaction(emoji);
    setFloatReactions((prev) => [...prev, { id: Date.now(), emoji }]);
  };

  const [recordingError, setRecordingError] = useState<string | null>(null);
  const recordingPending = useRef(false);
  const handleRecord = async () => {
    if (recordingPending.current) return;
    recordingPending.current = true;
    setRecordingError(null);
    try {
      if (isRecording) {
        await meetingsApi.stopRecording(bookingId);
        setIsRecording(false);
      } else {
        await meetingsApi.startRecording(bookingId);
        setIsRecording(true);
      }
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      const msg = detail ?? (isRecording ? "Не удалось остановить запись" : "Не удалось начать запись");
      setRecordingError(msg);
      setTimeout(() => setRecordingError(null), 4000);
      console.warn("Recording toggle failed:", err);
    } finally {
      recordingPending.current = false;
    }
  };

  const handleLeave = () => { setModal(null); onLeave(); };

  const meetingUrl = `${window.location.origin}/meeting/${bookingId}`;

  return (
    <div className={`conf conf-root fixed inset-0 z-[9999] l-${layoutMode}`}>
      <MeetingHeader
        title="Видеоконференция"
        elapsed={elapsed}
        isRecording={isRecording}
        isSharingScreen={!!screenTrack}
        layoutMode={layoutMode}
        participantCount={allParticipants.length}
        onLayoutChange={(m) => setLayoutMode(m as "focus" | "gallery" | "cinema")}
        onInfoClick={() => setModal("info")}
      />

      <div className="conf__main">
        <div className="conf__videos">
          {layoutMode === "focus" && (
            <FocusLayout
              camTracks={camTracks} screenTrack={screenTrack}
              pinnedId={pinnedId} localIdentity={localParticipant.identity}
              onPin={setPinnedId}
            />
          )}
          {layoutMode === "gallery" && (
            <GalleryLayout camTracks={camTracks} localIdentity={localParticipant.identity} />
          )}
          {layoutMode === "cinema" && (
            <CinemaLayout
              camTracks={camTracks} screenTrack={screenTrack}
              pinnedId={pinnedId} localIdentity={localParticipant.identity}
              onPin={setPinnedId}
            />
          )}
        </div>

        {activePanel && (
          <Sidebar
            activePanel={activePanel}
            onPanelChange={setActivePanel}
            onClose={() => setActivePanel(null)}
            messages={messages}
            participants={allParticipants}
            localIdentity={localParticipant.identity}
            localUserId={localUserId}
            bookingId={bookingId}
            isOrganizer={isOrganizer}
            onSend={send}
            onFile={uploadAndSend}
            uploading={uploading}
            noiseOn={noiseOn}
            blurOn={blurOn}
            onNoise={toggleNoise}
            onBlur={toggleBlur}
          />
        )}
      </div>

      <ControlBar
        micOn={isMicrophoneEnabled}
        camOn={isCameraEnabled}
        screenOn={isScreenShareEnabled}
        handUp={handUp}
        isRecording={isRecording}
        showReactions={showReactions}
        activePanel={activePanel}
        participantCount={allParticipants.length}
        unread={unread}
        onMic={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(console.warn)}
        onCam={() => localParticipant.setCameraEnabled(!isCameraEnabled).catch(console.warn)}
        onScreen={() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled).catch(console.warn)}
        onHand={() => setHandUp((v) => !v)}
        onRecord={handleRecord}
        onReact={addReaction}
        setShowReactions={setShowReactions}
        onParticipants={() => togglePanel("participants")}
        onChat={() => togglePanel("chat")}
        onSettings={() => togglePanel("settings")}
        onLeave={() => setModal("leave")}
      />

      {/* Floating reactions */}
      <div className="floatreacts">
        {floatReactions.map((r) => (
          <FloatingReaction
            key={r.id} emoji={r.emoji} id={r.id}
            onDone={() => setFloatReactions((prev) => prev.filter((x) => x.id !== r.id))}
          />
        ))}
      </div>

      {/* Recording error toast */}
      {recordingError && (
        <div style={{
          position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)",
          background: "rgba(239,68,68,0.9)", color: "#fff", padding: "10px 20px",
          borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 10001,
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}>
          ⚠️ {recordingError}
        </div>
      )}

      {/* Modals */}
      {modal === "info" && (
        <MeetingInfoModal
          title="Видеоконференция"
          startTime={joinData.start_time}
          endTime={joinData.end_time}
          participantCount={allParticipants.length}
          meetingUrl={meetingUrl}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "leave" && (
        <LeaveModal onClose={() => setModal(null)} onLeave={handleLeave} />
      )}

      {/* Admission requests — organizer only */}
      {pendingAdmissions.length > 0 && (
        <div style={{
          position: "fixed", bottom: 80, right: 16, zIndex: 10000,
          display: "flex", flexDirection: "column", gap: 10,
          maxWidth: 320,
        }}>
          {pendingAdmissions.map((req) => (
            <div
              key={req.invite_token}
              style={{
                background: "rgba(15,23,42,0.95)",
                border: "1px solid rgba(59,130,246,0.4)",
                borderRadius: 14, padding: "14px 16px",
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                backdropFilter: "blur(20px)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16,
                }}>
                  👤
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>
                    {req.guest_name}
                  </p>
                  <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>
                    Запрашивает доступ к встрече
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => handleAdmit(req.invite_token, "approve")}
                  style={{
                    flex: 1, padding: "8px", borderRadius: 8, border: "none",
                    background: "linear-gradient(135deg,#16a34a,#22c55e)",
                    color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  ✓ Разрешить
                </button>
                <button
                  onClick={() => handleAdmit(req.invite_token, "reject")}
                  style={{
                    flex: 1, padding: "8px", borderRadius: 8,
                    background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)",
                    color: "#f87171", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  } as React.CSSProperties}
                >
                  ✕ Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Loading / error screens ──────────────────────────────────────────────────
function FullscreenSpinner({ text }: { text: string }) {
  return (
    <div className="conf-root fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4"
      style={{ background: "var(--bg)", color: "var(--tx2)" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin"
        style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
      <p className="text-sm">{text}</p>
    </div>
  );
}

function FullscreenError({ message, onClose, onRetry }: { message: string; onClose: () => void; onRetry?: () => void }) {
  return (
    <div className="conf-root fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4"
      style={{ background: "var(--bg)", color: "var(--red)" }}>
      <p className="text-base font-semibold">Не удалось подключиться</p>
      <p className="text-sm" style={{ color: "var(--tx2)" }}>{message}</p>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        {onRetry && (
          <button onClick={onRetry} className="px-5 py-2 rounded-xl text-sm font-semibold"
            style={{ background: "linear-gradient(135deg,#1565a8,#3b82f6)", color: "#fff", border: "none", cursor: "pointer" }}>
            Переподключиться
          </button>
        )}
        <button onClick={onClose} className="px-5 py-2 rounded-xl text-sm font-semibold"
          style={{ background: "var(--elev)", color: "var(--tx)" }}>
          Назад
        </button>
      </div>
    </div>
  );
}

// ─── Waiting for organizer screen ────────────────────────────────────────────
function WaitingForOrganizer({ onLeave, onRetry }: { onLeave: () => void; onRetry: () => void }) {
  const [seconds, setSeconds] = useState(10);
  const onRetryRef = useRef(onRetry);
  useEffect(() => { onRetryRef.current = onRetry; }, [onRetry]);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => {
      if (s <= 1) { onRetryRef.current(); return 10; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="conf-root fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-5"
      style={{ background: "var(--bg)", color: "var(--tx2)" }}>
      <div style={{ fontSize: 56 }}>⏳</div>
      <p style={{ fontSize: 18, fontWeight: 700, color: "var(--tx)" }}>
        Ожидание организатора
      </p>
      <p style={{ fontSize: 13, color: "var(--tx3)", textAlign: "center", maxWidth: 320 }}>
        Встреча начнётся, когда организатор подключится.<br />
        Следующая проверка через <strong style={{ color: "var(--accent)" }}>{seconds}с</strong>.
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button
          onClick={onRetry}
          style={{
            padding: "10px 20px", borderRadius: 10,
            background: "linear-gradient(135deg,#1565a8,#3b82f6)",
            color: "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
          }}
        >
          Проверить сейчас
        </button>
        <button
          onClick={onLeave}
          style={{
            padding: "10px 20px", borderRadius: 10,
            background: "var(--elevated)", color: "var(--tx2)",
            fontSize: 13, fontWeight: 600, border: "1px solid var(--border)", cursor: "pointer",
          }}
        >
          Выйти
        </button>
      </div>
    </div>
  );
}

// ─── Exported component ───────────────────────────────────────────────────────
export function MeetingRoom({ bookingId, onLeave }: { bookingId: number; onLeave: () => void }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["meeting-join", bookingId],
    queryFn: () => meetingsApi.join(bookingId),
    retry: false,
    staleTime: Infinity,          // never refetch — prevents double-connection on re-render
    refetchOnWindowFocus: false,
  });

  const [isMeetingTime, setIsMeetingTime] = useState(false);
  const [lkDisconnected, setLkDisconnected] = useState(false);
  const intentionalLeaveRef = useRef(false);
  const lkRoom = useMemo(() => new Room({
    publishDefaults: {
      simulcast: false,
      videoCodec: 'h264',           // VP9 AMD GPU decoder produces pink/magenta artifacts
      videoEncoding: {
        maxBitrate: 1_500_000,
        maxFramerate: 30,
      },
      screenShareEncoding: {
        maxBitrate: 3_000_000,
        maxFramerate: 15,
      },
    },
    videoCaptureDefaults: {
      resolution: VideoPresets.h720.resolution,
    },
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    adaptiveStream: true,
    dynacast: false,                 // dynacast needs simulcast to work
    reconnectPolicy: {
      nextRetryDelayInMs: (context) => {
        if (context.retryCount > 8) return null;
        if (context.retryCount < 3) return 1000;
        if (context.retryCount < 6) return 3000;
        return 10000;
      },
    },
  }), []);

  // Disconnect room on unmount so LiveKit doesn't show ghost participants
  useEffect(() => {
    return () => { lkRoom.disconnect().catch(() => {}); };
  }, [lkRoom]);

  const isOrganizerNotPresent =
    !data &&
    (error as { response?: { status?: number; data?: { detail?: string } } })?.response?.status === 403 &&
    (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail === "organizer_not_present";

  const handleRetry = useCallback(() => { refetch(); }, [refetch]);

  useEffect(() => {
    if (!data) return;
    const start = new Date(data.start_time).getTime();
    if (Date.now() >= start) { setIsMeetingTime(true); return; }
    const ms = start - Date.now();
    const t = setTimeout(() => setIsMeetingTime(true), ms);
    return () => clearTimeout(t);
  }, [data]);

  const handleLeave = useCallback(() => {
    intentionalLeaveRef.current = true;
    lkRoom.disconnect().catch(() => {});
    onLeave();
  }, [lkRoom, onLeave, intentionalLeaveRef]);

  if (isLoading) return <FullscreenSpinner text="Подключение к встрече…" />;

  if (isOrganizerNotPresent) {
    return <WaitingForOrganizer onLeave={onLeave} onRetry={handleRetry} />;
  }

  if (error || !data) {
    const msg =
      (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
      "Проверьте, что встреча активна и видеоконференция включена.";
    return <FullscreenError message={msg} onClose={onLeave} />;
  }

  if (!isMeetingTime) {
    const localUserId = parseInt(data.user_identity.replace("user-", ""), 10) || 0;
    return <WaitingRoom startTime={data.start_time} onLeave={onLeave} bookingId={bookingId} onJoin={() => setIsMeetingTime(true)} localUserId={localUserId} />;
  }

  if (lkDisconnected) {
    return (
      <FullscreenError
        message="Соединение с конференцией прервано."
        onClose={onLeave}
        onRetry={() => { setLkDisconnected(false); intentionalLeaveRef.current = false; refetch(); }}
      />
    );
  }

  return (
    <LiveKitRoom
      room={lkRoom}
      token={data.access_token}
      serverUrl={data.livekit_url}
      connect
      video
      audio
      onDisconnected={() => { if (!intentionalLeaveRef.current) setLkDisconnected(true); }}
    >
      <RoomAudioRenderer />
      <ConferenceUI
        bookingId={bookingId}
        onLeave={handleLeave}
        joinData={data}
        isOrganizer={data.is_organizer}
      />
    </LiveKitRoom>
  );
}
