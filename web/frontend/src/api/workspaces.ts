import { apiClient } from "./axios";
import type { Workspace, WorkspaceDetail, WorkspaceMember, WorkspacePosition } from "../types";

export interface PendingJoinRequestItem {
  member_id: number;
  workspace_id: number;
  workspace_name: string;
  user_id: number;
  user_display_name: string;
  created_at: string;
}

export interface WorkspaceAnalytics {
  period_days: number;
  total_members: number;
  total_meetings: number;
  new_members: Array<{ date: string; count: number }>;
  meetings_by_day: Array<{ date: string; count: number }>;
  top_organizers: Array<{ user_id: number; user_name: string; count: number }>;
}

export const workspacesApi = {
  list: async (): Promise<Workspace[]> => {
    const res = await apiClient.get<Workspace[]>("/api/v1/workspaces");
    return res.data;
  },
  search: async (q: string): Promise<Workspace[]> => {
    const res = await apiClient.get<Workspace[]>("/api/v1/workspaces/search", { params: { q } });
    return res.data;
  },
  get: async (id: number): Promise<WorkspaceDetail> => {
    const res = await apiClient.get<WorkspaceDetail>(`/api/v1/workspaces/${id}`);
    return res.data;
  },
  create: async (payload: { name: string; timezone?: string }): Promise<Workspace> => {
    const res = await apiClient.post<Workspace>("/api/v1/workspaces", payload);
    return res.data;
  },
  update: async (id: number, payload: { name?: string; timezone?: string }): Promise<Workspace> => {
    const res = await apiClient.patch<Workspace>(`/api/v1/workspaces/${id}`, payload);
    return res.data;
  },
  archive: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/v1/workspaces/${id}`);
  },
  regenerateCode: async (id: number): Promise<Workspace> => {
    const res = await apiClient.post<Workspace>(`/api/v1/workspaces/${id}/regenerate-code`);
    return res.data;
  },
  listMembers: async (id: number): Promise<WorkspaceMember[]> => {
    const res = await apiClient.get<WorkspaceMember[]>(`/api/v1/workspaces/${id}/members`);
    return res.data;
  },
  generateInviteLink: async (id: number): Promise<WorkspaceMember> => {
    const res = await apiClient.post<WorkspaceMember>(`/api/v1/workspaces/${id}/generate-invite-link`);
    return res.data;
  },
  updateMember: async (wsId: number, memberId: number, payload: { approve?: boolean; role?: string }): Promise<WorkspaceMember | null> => {
    const res = await apiClient.patch<WorkspaceMember | null>(`/api/v1/workspaces/${wsId}/members/${memberId}`, payload);
    return res.data;
  },
  removeMember: async (wsId: number, memberId: number): Promise<void> => {
    await apiClient.delete(`/api/v1/workspaces/${wsId}/members/${memberId}`);
  },
  join: async (invite_code: string): Promise<WorkspaceMember> => {
    const res = await apiClient.post<WorkspaceMember>("/api/v1/workspaces/join", { invite_code });
    return res.data;
  },
  claimInvite: async (invite_token: string): Promise<WorkspaceMember> => {
    const res = await apiClient.post<WorkspaceMember>("/api/v1/workspaces/claim-invite", { invite_token });
    return res.data;
  },
  rebindTelegram: async (id: number, chatId: number | null): Promise<Workspace> => {
    const res = await apiClient.post<Workspace>(`/api/v1/workspaces/${id}/rebind`, { chat_id: chatId });
    return res.data;
  },
  getAnalytics: async (id: number, periodDays = 30): Promise<WorkspaceAnalytics> => {
    const res = await apiClient.get<WorkspaceAnalytics>(`/api/v1/workspaces/${id}/analytics`, { params: { period_days: periodDays } });
    return res.data;
  },
  updateMemberProfile: async (wsId: number, memberId: number, payload: { first_name?: string; last_name?: string; position?: string; position_id?: number | null }): Promise<WorkspaceMember> => {
    const res = await apiClient.patch<WorkspaceMember>(`/api/v1/workspaces/${wsId}/members/${memberId}`, payload);
    return res.data;
  },
  listPositions: async (wsId: number): Promise<WorkspacePosition[]> => {
    const res = await apiClient.get<WorkspacePosition[]>(`/api/v1/workspaces/${wsId}/positions`);
    return res.data;
  },
  createPosition: async (wsId: number, payload: { name_ru: string; name_uz: string }): Promise<WorkspacePosition> => {
    const res = await apiClient.post<WorkspacePosition>(`/api/v1/workspaces/${wsId}/positions`, payload);
    return res.data;
  },
  updatePosition: async (wsId: number, posId: number, payload: { name_ru?: string; name_uz?: string }): Promise<WorkspacePosition> => {
    const res = await apiClient.patch<WorkspacePosition>(`/api/v1/workspaces/${wsId}/positions/${posId}`, payload);
    return res.data;
  },
  deletePosition: async (wsId: number, posId: number): Promise<void> => {
    await apiClient.delete(`/api/v1/workspaces/${wsId}/positions/${posId}`);
  },
  getPendingJoinRequests: async (): Promise<PendingJoinRequestItem[]> => {
    const res = await apiClient.get<PendingJoinRequestItem[]>("/api/v1/workspaces/pending-requests");
    return res.data;
  },
};
