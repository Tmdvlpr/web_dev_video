import { useRef, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";
import { useAttachments, useUploadAttachment, useDeleteAttachment } from "../../hooks/useBookings";
import { bookingsApi } from "../../api/bookings";
import type { AttachmentMeta } from "../../types";

const MAX_ATT = 10 * 1024 * 1024;

function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📄";
  if (mime.includes("word")) return "📝";
  if (mime.includes("excel") || mime.includes("sheet")) return "📊";
  if (mime.includes("powerpoint") || mime.includes("presentation")) return "📋";
  return "📎";
}

function fmtSize(b: number) {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} КБ`;
  return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
}

export function AttachmentsSection({
  bookingId,
  canManage,
  pendingFiles,
  onAddPending,
  onRemovePending,
}: {
  bookingId?: number;
  canManage: boolean;
  pendingFiles: File[];
  onAddPending: (files: File[]) => void;
  onRemovePending: (idx: number) => void;
}) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: existing = [], isLoading } = useAttachments(bookingId);
  const upload = useUploadAttachment();
  const remove = useDeleteAttachment();
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<Set<number>>(new Set());

  const handleDownload = async (att: AttachmentMeta) => {
    setDownloading(prev => new Set(prev).add(att.id));
    try {
      await bookingsApi.downloadAttachmentBlob(att.booking_id, att.id, att.filename);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setUploadErr(`${t("attach.downloadErr")}${status ? ` (${status})` : ""}`);
    } finally {
      setDownloading(prev => { const n = new Set(prev); n.delete(att.id); return n; });
    }
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list) return;
    setUploadErr(null);
    const files = Array.from(list);
    const oversized = files.find(f => f.size > MAX_ATT);
    if (oversized) { setUploadErr(`«${oversized.name}» превышает 10 МБ`); return; }

    if (bookingId) {
      for (const f of files) {
        await upload.mutateAsync({ bookingId, file: f }).catch(e => {
          setUploadErr(e?.response?.data?.detail ?? "Ошибка загрузки");
        });
      }
    } else {
      onAddPending(files);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8,
    padding: "6px 10px", borderRadius: 6,
    background: "var(--elevated)", border: "1px solid var(--border)",
    marginBottom: 4,
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (!canManage) return;
    const items = Array.from(e.clipboardData.items);
    const files = items
      .filter(item => item.kind === "file")
      .map(item => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length > 0) handleFiles(files.reduce((dt, f) => { dt.items.add(f); return dt; }, new DataTransfer()).files);
  };

  return (
    <div onPaste={handlePaste}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold" style={{ color: "var(--text-sec)" }}>
          {t("attach.materials")} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{t("attach.optional")}</span>
        </label>
        {canManage && (
          <button type="button" onClick={() => fileRef.current?.click()}
            disabled={upload.isPending}
            className="text-xs font-semibold px-2.5 py-1 rounded transition-all"
            style={{ background: "var(--primary-light)", border: "1px solid var(--primary-border)", color: "var(--primary)" }}>
            {upload.isPending ? t("attach.uploading") : t("attach.attach")}
          </button>
        )}
      </div>

      <input ref={fileRef} type="file" multiple className="hidden"
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
        onChange={e => handleFiles(e.target.files)} />

      {uploadErr && (
        <p className="text-xs mb-1.5 font-medium" style={{ color: "#ef4444" }}>⚠️ {uploadErr}</p>
      )}

      {/* Existing attachments (edit mode) */}
      {isLoading && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("attach.loading")}</p>}
      {existing.map((att: AttachmentMeta) => (
        <div key={att.id} style={rowStyle}>
          <span style={{ fontSize: 16 }}>{fileIcon(att.mime_type)}</span>
          {att.expired ? (
            <span className="flex-1 text-xs truncate" style={{ color: "var(--text-muted)" }}>
              {att.filename} <span style={{ opacity: 0.5 }}>(удалён)</span>
            </span>
          ) : (
            <span className="flex-1 text-xs truncate" style={{ color: "var(--text)" }}>
              {att.filename}
            </span>
          )}
          <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>{fmtSize(att.size)}</span>
          {!att.expired && (
            <button type="button"
              onClick={() => handleDownload(att)}
              disabled={downloading.has(att.id)}
              title="Скачать"
              className="text-xs px-1.5 py-0.5 rounded font-bold shrink-0 transition-all disabled:opacity-50"
              style={{ background: "var(--primary-light)", border: "1px solid var(--primary-border)", color: "var(--primary)" }}>
              {downloading.has(att.id) ? "⏳" : "↓"}
            </button>
          )}
          {canManage && (
            <button type="button"
              onClick={() => remove.mutate({ bookingId: att.booking_id, attachmentId: att.id })}
              className="text-base leading-none opacity-50 hover:opacity-100 transition-opacity shrink-0"
              style={{ color: isDark ? "#f87171" : "#dc2626" }}>
              ×
            </button>
          )}
        </div>
      ))}

      {/* Pending files (create mode) */}
      {pendingFiles.map((f, i) => (
        <div key={i} style={rowStyle}>
          <span style={{ fontSize: 16 }}>{fileIcon(f.type)}</span>
          <span className="flex-1 text-xs truncate" style={{ color: "var(--text)" }}>{f.name}</span>
          <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>{fmtSize(f.size)}</span>
          <button type="button" onClick={() => onRemovePending(i)}
            className="text-base leading-none opacity-50 hover:opacity-100 transition-opacity shrink-0"
            style={{ color: isDark ? "#f87171" : "#dc2626" }}>
            ×
          </button>
        </div>
      ))}

      {existing.length === 0 && pendingFiles.length === 0 && !isLoading && (
        <div className="text-xs text-center py-3 rounded-md"
          style={{ border: "1.5px dashed var(--border)", color: "var(--text-muted)" }}>
          {t("attach.noFiles")}
        </div>
      )}
    </div>
  );
}
