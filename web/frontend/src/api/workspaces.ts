import { apiClient } from "./axios";
import type { Workspace, WorkspaceDetail, WorkspaceMember } from "../types";

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
};
