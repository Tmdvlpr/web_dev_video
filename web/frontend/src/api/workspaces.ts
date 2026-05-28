import { apiClient } from "./axios";
import type { Workspace, WorkspaceDetail, WorkspaceMember } from "../types";

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
  invite: async (id: number, username: string): Promise<WorkspaceMember> => {
    const res = await apiClient.post<WorkspaceMember>(`/api/v1/workspaces/${id}/invite`, { username });
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
  getAnalytics: async (id: number, periodDays = 30): Promise<WorkspaceAnalytics> => {
    const res = await apiClient.get<WorkspaceAnalytics>(`/api/v1/workspaces/${id}/analytics`, { params: { period_days: periodDays } });
    return res.data;
  },
  updateMemberProfile: async (wsId: number, memberId: number, payload: { first_name?: string; last_name?: string; position?: string }): Promise<WorkspaceMember> => {
    const res = await apiClient.patch<WorkspaceMember>(`/api/v1/workspaces/${wsId}/members/${memberId}`, payload);
    return res.data;
  },
};
