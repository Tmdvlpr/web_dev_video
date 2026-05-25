import React, { useEffect, useRef, useState } from "react";
import { apiClient } from "../../api/axios";
import { meetingsApi } from "../../api/meetings";
import { useLocale } from "../../contexts/LocaleContext";
import type { ChatFile, ChatMessage } from "../../types";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

const PALETTE = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#14b8a6","#f97316"];
function colorFromId(id: number) { return PALETTE[Math.abs(id) % PALETTE.length]; }
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getToken(): string {
  return localStorage.getItem("access_token") ?? "";
}

function wsBase(): string {
  const base = API_BASE || window.location.origin;
  return base.replace(/^https/, "wss").replace(/^http/, "ws");
}

interface Props {
  bookingId: number;
  readOnly?: boolean;
  onClose?: () => void;
  style?: React.CSSProperties;
}

export function MeetingChatPanel({ bookingId, readOnly, onClose, style }: Props) {
  const { t } = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    meetingsApi.getChatHistory(bookingId).then(setMessages).catch(() => {});

    const token = getToken();
    const ws = new WebSocket(
      `${wsBase()}/api/v1/meetings/${bookingId}/chat/ws?token=${encodeURIComponent(token)}`,
    );
    ws.onmessage = (e) => {
      try {
        const msg: ChatMessage = JSON.parse(e.data);
        setMessages((prev) => [...prev, msg]);
      } catch {
        // ignore malformed
      }
    };
    wsRef.current = ws;
    return () => ws.close();
  }, [bookingId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = () => {
    const body = input.trim();
    if (!body || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ body }));
    setInput("");
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      alert(t("chatpanel.fileTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const chatFile: ChatFile = await meetingsApi.uploadFile(bookingId, file, (pct) =>
        setUploadProgress(pct),
      );
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ body: "", file_id: chatFile.id }));
      } else {
        const msg = await meetingsApi.sendChatMessage(bookingId, "", chatFile.id);
        setMessages(prev => [...prev, msg as unknown as ChatMessage]);
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } }; message?: string })
        ?.response?.data?.detail ?? (err as { message?: string })?.message ?? "?";
      alert(t("chatpanel.uploadError", { detail }));
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownload = async (fileId: number, filename: string) => {
    try {
      const res = await apiClient.get(
        `/api/v1/meetings/${bookingId}/chat/files/${fileId}`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert(t("chatpanel.downloadError"));
    }
  };

  return (
    <div
      className="flex flex-col"
      style={{
        width: 280,
        minWidth: 280,
        background: "#111827",
        borderLeft: "1px solid #1f2937",
        color: "#f9fafb",
        ...style,
      }}
    >
      {/* Header */}
      <div
        className="px-3 text-sm font-semibold"
        style={{
          borderBottom: "1px solid #1f2937", color: "#9ca3af",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          minHeight: 44, flexShrink: 0,
        }}
      >
        <span>{t("chatpanel.title")}</span>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#6b7280", fontSize: 18, lineHeight: 1,
              padding: "4px 6px", borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "#f9fafb")}
            onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}
          >
            ✕
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 text-sm" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {messages.length === 0 && (
          <p className="text-center py-8 text-xs" style={{ color: "#4b5563" }}>
            {t("chatpanel.empty")}
          </p>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const isFirstInGroup = !prev || prev.user_id !== m.user_id;
          const color = colorFromId(m.user_id);
          const timeStr = fmtTime(new Date(m.created_at));
          return (
            <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: isFirstInGroup ? 10 : 2 }}>
              {/* Avatar placeholder — keeps alignment for non-first messages */}
              <div style={{ width: 28, flexShrink: 0 }}>
                {isFirstInGroup ? (
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: color + "33", color,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700,
                  }}>
                    {initials(m.user_name)}
                  </div>
                ) : null}
              </div>
              {/* Bubble column */}
              <div style={{ maxWidth: "calc(100% - 44px)", display: "flex", flexDirection: "column", gap: 1 }}>
                {isFirstInGroup && (
                  <span style={{ fontSize: 11, fontWeight: 600, color, paddingLeft: 4 }}>
                    {m.user_name}
                  </span>
                )}
                <div style={{
                  background: "#1e2736",
                  borderRadius: isFirstInGroup ? "4px 14px 14px 14px" : "6px 14px 14px 6px",
                  padding: "6px 10px 6px 10px",
                }}>
                  {m.body && !m.file && (
                    /* Text + time inline — Telegram style */
                    <span style={{ fontSize: 13, color: "#e2e8f0", lineHeight: 1.5, wordBreak: "break-word" }}>
                      {m.body}
                      <span style={{ fontSize: 10, color: "#64748b", marginLeft: 6, whiteSpace: "nowrap" }}>
                        {timeStr}
                      </span>
                    </span>
                  )}
                  {m.file && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <button
                        onClick={() => handleDownload(m.file!.id, m.file!.filename)}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          background: "#273244", border: "none", borderRadius: 8,
                          padding: "6px 8px", color: "#93c5fd", cursor: "pointer",
                          fontSize: 12, textAlign: "left", width: "100%",
                        }}
                      >
                        <span>📎</span>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.file.filename}
                        </span>
                        <span style={{ color: "#64748b", flexShrink: 0 }}>
                          {(m.file.size / 1024).toFixed(0)} {t("chatpanel.kb")}
                        </span>
                      </button>
                      {m.body && (
                        <span style={{ fontSize: 13, color: "#e2e8f0", lineHeight: 1.5, wordBreak: "break-word" }}>
                          {m.body}
                        </span>
                      )}
                      <span style={{ fontSize: 10, color: "#64748b", textAlign: "right" }}>{timeStr}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Upload progress */}
      {!readOnly && uploading && (
        <div className="px-3 py-1.5 text-xs" style={{ color: "#9ca3af", borderTop: "1px solid #1f2937" }}>
          {t("chatpanel.uploading", { progress: uploadProgress })}
          <div className="mt-1 rounded-full overflow-hidden" style={{ height: 3, background: "#374151" }}>
            <div style={{ width: `${uploadProgress}%`, height: "100%", background: "#3b82f6", transition: "width 0.2s" }} />
          </div>
        </div>
      )}

      {/* Input — hidden in read-only mode */}
      {!readOnly && (
        <div
          className="p-2 flex gap-1.5 items-center"
          style={{ borderTop: "1px solid #1f2937" }}
        >
          <input
            className="flex-1 rounded-lg px-2.5 py-1.5 text-sm outline-none"
            style={{ background: "#1f2937", color: "#f9fafb", border: "1px solid #374151" }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={t("chatpanel.placeholder")}
            disabled={uploading}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title={t("chatpanel.attachTitle")}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-colors disabled:opacity-40"
            style={{ color: "#9ca3af" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#f9fafb")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
          >
            📎
          </button>
          <button
            onClick={sendMessage}
            disabled={!input.trim() || uploading}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sm font-bold transition-colors disabled:opacity-40"
            style={{ color: "#60a5fa" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#93c5fd")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#60a5fa")}
          >
            →
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      )}
    </div>
  );
}
