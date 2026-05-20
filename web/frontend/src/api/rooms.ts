import { apiClient } from "./axios";
import type { WorkspaceRoom } from "../types";

export const roomsApi = {
  list: async (): Promise<WorkspaceRoom[]> => {
    const res = await apiClient.get<WorkspaceRoom[]>("/api/v1/rooms");
    return res.data;
  },
  create: async (payload: { name: string; description?: string; workspace_id: number }): Promise<WorkspaceRoom> => {
    const res = await apiClient.post<WorkspaceRoom>("/api/v1/rooms", payload);
    return res.data;
  },
  update: async (id: number, payload: { name?: string; description?: string }): Promise<WorkspaceRoom> => {
    const res = await apiClient.patch<WorkspaceRoom>(`/api/v1/rooms/${id}`, payload);
    return res.data;
  },
  archive: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/v1/rooms/${id}`);
  },
  share: async (id: number, target_workspace_invite_code: string): Promise<WorkspaceRoom> => {
    const res = await apiClient.post<WorkspaceRoom>(`/api/v1/rooms/${id}/share`, { target_workspace_invite_code });
    return res.data;
  },
  revokeShare: async (id: number, targetWorkspaceId: number): Promise<void> => {
    await apiClient.delete(`/api/v1/rooms/${id}/share/${targetWorkspaceId}`);
  },
  updateVisibility: async (id: number, workspaceId: number, visibility: "full" | "busy_only"): Promise<WorkspaceRoom> => {
    const res = await apiClient.patch<WorkspaceRoom>(`/api/v1/rooms/${id}/workspaces/${workspaceId}/visibility`, { visibility });
    return res.data;
  },
};
