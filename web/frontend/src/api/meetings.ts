import { apiClient } from "./axios";
import type { ChatFile, ChatMessage, GuestJoinInfo, InviteStatus, MeetingInviteLink, MeetingJoinResponse, Recording } from "../types";

export const meetingsApi = {
  join: async (bookingId: number): Promise<MeetingJoinResponse> => {
    const res = await apiClient.post<MeetingJoinResponse>(`/api/v1/meetings/${bookingId}/join`);
    return res.data;
  },

  getChatHistory: async (bookingId: number, limit = 500): Promise<ChatMessage[]> => {
    const res = await apiClient.get<ChatMessage[]>(`/api/v1/meetings/${bookingId}/chat`, {
      params: { limit },
    });
    return res.data;
  },

  sendChatMessage: async (
    bookingId: number,
    body: string,
    fileId?: number,
  ): Promise<ChatMessage> => {
    const res = await apiClient.post<ChatMessage>(`/api/v1/meetings/${bookingId}/chat`, {
      body,
      file_id: fileId ?? null,
    });
    return res.data;
  },

  uploadFile: async (
    bookingId: number,
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<ChatFile> => {
    const form = new FormData();
    form.append("file", file);
    const res = await apiClient.post<ChatFile>(`/api/v1/meetings/${bookingId}/chat/files`, form, {
      onUploadProgress: (e) =>
        onProgress?.(Math.round((e.loaded * 100) / (e.total ?? 1))),
    });
    return res.data;
  },

  downloadFileUrl: (bookingId: number, fileId: number): string =>
    `/api/v1/meetings/${bookingId}/chat/files/${fileId}`,

  downloadRecordingUrl: (bookingId: number, sessionId: number): string =>
    `/api/v1/meetings/${bookingId}/recordings/${sessionId}/download`,

  getRecordings: async (bookingId: number): Promise<Recording[]> => {
    const res = await apiClient.get<Recording[]>(`/api/v1/meetings/${bookingId}/recordings`);
    return res.data;
  },

  startRecording: async (bookingId: number): Promise<{ egress_id: string }> => {
    const res = await apiClient.post<{ egress_id: string }>(`/api/v1/meetings/${bookingId}/recording/start`);
    return res.data;
  },

  stopRecording: async (bookingId: number): Promise<void> => {
    await apiClient.post(`/api/v1/meetings/${bookingId}/recording/stop`);
  },

  // ── Guest invitations ──────────────────────────────────────────────────────

  createInvite: async (bookingId: number): Promise<MeetingInviteLink> => {
    const res = await apiClient.post<MeetingInviteLink>(`/api/v1/meetings/${bookingId}/invite`);
    return res.data;
  },

  getGuestInfo: async (inviteToken: string): Promise<GuestJoinInfo> => {
    const res = await apiClient.get<GuestJoinInfo>(`/api/v1/meetings/invite/${inviteToken}`);
    return res.data;
  },

  requestAdmission: async (inviteToken: string, guestName: string): Promise<void> => {
    await apiClient.post(`/api/v1/meetings/invite/${inviteToken}/request`, { guest_name: guestName });
  },

  pollInviteStatus: async (inviteToken: string): Promise<InviteStatus> => {
    const res = await apiClient.get<InviteStatus>(`/api/v1/meetings/invite/${inviteToken}/status`);
    return res.data;
  },

  admitGuest: async (bookingId: number, inviteToken: string, action: "approve" | "reject"): Promise<void> => {
    await apiClient.post(`/api/v1/meetings/${bookingId}/admit`, { invite_token: inviteToken, action });
  },

  getPendingAdmissions: async (bookingId: number): Promise<{ invite_token: string; guest_name: string }[]> => {
    const res = await apiClient.get<{ invite_token: string; guest_name: string }[]>(
      `/api/v1/meetings/${bookingId}/pending-admissions`,
    );
    return res.data;
  },

  muteParticipant: async (bookingId: number, identity: string, muted: boolean): Promise<void> => {
    await apiClient.post(`/api/v1/meetings/${bookingId}/participants/${encodeURIComponent(identity)}/mute`, { muted });
  },
};
