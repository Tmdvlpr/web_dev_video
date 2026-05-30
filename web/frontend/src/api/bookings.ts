import { apiClient } from "./axios";
import type { AttachmentMeta, Booking, BookingCreate, BookingUpdate, GuestStatusItem } from "../types";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export const bookingsApi = {
  getActive: async (): Promise<Booking[]> => {
    const res = await apiClient.get<Booking[]>("/api/v1/bookings/active");
    return res.data;
  },

  getRoomStatus: async (workspaceId?: number): Promise<Booking[]> => {
    const params: Record<string, number> = {};
    if (workspaceId != null) params.workspace_id = workspaceId;
    const res = await apiClient.get<Booking[]>("/api/v1/bookings/room-status", { params });
    return res.data;
  },

  getByDate: async (date: string, workspaceId?: number): Promise<Booking[]> => {
    const params: Record<string, string | number> = { date_from: date, date_to: date };
    if (workspaceId != null) params.workspace_id = workspaceId;
    const res = await apiClient.get<Booking[]>("/api/v1/bookings", { params });
    return res.data;
  },

  create: async (payload: BookingCreate): Promise<Booking[]> => {
    const res = await apiClient.post<Booking[]>("/api/v1/bookings", payload);
    return res.data;
  },

  update: async (id: number, payload: BookingUpdate): Promise<Booking> => {
    const res = await apiClient.patch<Booking>(`/api/v1/bookings/${id}`, payload);
    return res.data;
  },

  delete: async (id: number, deleteSeries = false): Promise<void> => {
    await apiClient.delete(`/api/v1/bookings/${id}`, {
      params: deleteSeries ? { delete_series: true } : {},
    });
  },

  exportHistory: async (): Promise<void> => {
    const res = await apiClient.get("/api/v1/bookings/export", { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `corpmeet_${new Date().toISOString().slice(0, 10)}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },

  getFeedUrl: (feedToken: string): string =>
    `${API_BASE}/api/v1/bookings/feed/${feedToken}`,

  adminListAll: async (): Promise<Booking[]> => {
    const res = await apiClient.get<Booking[]>("/api/v1/bookings/admin/all");
    return res.data;
  },

  listAttachments: async (bookingId: number): Promise<AttachmentMeta[]> => {
    const res = await apiClient.get<AttachmentMeta[]>(`/api/v1/bookings/${bookingId}/attachments`);
    return res.data;
  },

  uploadAttachment: async (bookingId: number, file: File): Promise<AttachmentMeta> => {
    const form = new FormData();
    form.append("file", file);
    const res = await apiClient.post<AttachmentMeta>(`/api/v1/bookings/${bookingId}/attachments`, form);
    return res.data;
  },

  deleteAttachment: async (bookingId: number, attachmentId: number): Promise<void> => {
    await apiClient.delete(`/api/v1/bookings/${bookingId}/attachments/${attachmentId}`);
  },

  getAttachmentUrl: (bookingId: number, attachmentId: number): string =>
    `${API_BASE}/api/v1/bookings/${bookingId}/attachments/${attachmentId}`,

  getGuestStatuses: async (bookingId: number): Promise<GuestStatusItem[]> => {
    const res = await apiClient.get<GuestStatusItem[]>(`/api/v1/bookings/${bookingId}/guests`);
    return res.data;
  },

  rsvp: async (bookingId: number, status: "accepted" | "declined"): Promise<Booking> => {
    const res = await apiClient.patch<Booking>(`/api/v1/bookings/${bookingId}/guests/me`, { status });
    return res.data;
  },

  downloadAttachmentBlob: async (bookingId: number, attachmentId: number, filename: string): Promise<void> => {
    const res = await apiClient.get(
      `/api/v1/bookings/${bookingId}/attachments/${attachmentId}`,
      { responseType: "blob" },
    );
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },
};
