import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../api/axios";
import { meetingsApi } from "../../api/meetings";
import type { ChatFile, ChatMessage } from "../../types";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

function getToken(): string {
  return localStorage.getItem("access_token") ?? "";
}

function wsBase(): string {
  // When API_BASE is empty (relative URLs mode) derive WS base from current page origin
  const base = API_BASE || window.location.origin;
  return base.replace(/^https/, "wss").replace(/^http/, "ws");
}

interface Props {
  bookingId: number;
}

export function MeetingChatPanel({ bookingId }: Props) {
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
      alert("Файл слишком большой (максимум 20 МБ)");
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
        // WS не открыт — сохраняем через REST и показываем локально
        const msg = await meetingsApi.sendChatMessage(bookingId, "", chatFile.id);
        setMessages(prev => [...prev, msg as unknown as ChatMessage]);
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } }; message?: string })
        ?.response?.data?.detail ?? (err as { message?: string })?.message ?? "Неизвестная ошибка";
      alert(`Ошибка загрузки файла: ${detail}`);
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
      alert("Не удалось скачать файл");
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
      }}
    >
      {/* Header */}
      <div
        className="px-3 py-2.5 text-sm font-semibold"
        style={{ borderBottom: "1px solid #1f2937", color: "#9ca3af" }}
      >
        Чат встречи
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 text-sm">
        {messages.length === 0 && (
          <p className="text-center py-4 text-xs" style={{ color: "#4b5563" }}>
            Сообщений пока нет
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id}>
            <span className="font-semibold text-xs" style={{ color: "#60a5fa" }}>
              {m.user_name}
            </span>
            {m.body && (
              <p className="mt-0.5 text-sm break-words" style={{ color: "#e5e7eb" }}>
                {m.body}
              </p>
            )}
            {m.file && (
              <button
                onClick={() => handleDownload(m.file!.id, m.file!.filename)}
                className="flex items-center gap-1.5 mt-0.5 text-xs rounded-lg px-2 py-1.5 w-full text-left"
                style={{ background: "#1f2937", color: "#93c5fd", cursor: "pointer" }}
              >
                <span>📎</span>
                <span className="truncate max-w-[160px]">{m.file.filename}</span>
                <span style={{ color: "#6b7280" }}>
                  ({(m.file.size / 1024).toFixed(0)} КБ)
                </span>
              </button>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Upload progress */}
      {uploading && (
        <div className="px-3 py-1.5 text-xs" style={{ color: "#9ca3af", borderTop: "1px solid #1f2937" }}>
          Загрузка: {uploadProgress}%
          <div className="mt-1 rounded-full overflow-hidden" style={{ height: 3, background: "#374151" }}>
            <div style={{ width: `${uploadProgress}%`, height: "100%", background: "#3b82f6", transition: "width 0.2s" }} />
          </div>
        </div>
      )}

      {/* Input */}
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
          placeholder="Сообщение..."
          disabled={uploading}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Прикрепить файл (до 50 МБ)"
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
    </div>
  );
}
