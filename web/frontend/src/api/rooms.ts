import { apiClient } from "./axios";
import type { RoomJoinRequest, WorkspaceRoom } from "../types";

export const roomsApi = {
  list: async (): Promise<WorkspaceRoom[]> => {
    const res = await apiClient.get<WorkspaceRoom[]>("/api/v1/rooms");
    return res.data;
  },
  create: async (payload: { name: string; description?: string; workspace_id: number }): Promise<WorkspaceRoom> => {
    const res = await apiClient.post<WorkspaceRoom>("/api/v1/rooms", payload);
    return res.data;
  },
  update: async (id: number, payload: { name?: string; description?: string; join_mode?: "open" | "approval" | "closed" }): Promise<WorkspaceRoom> => {
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
  join: async (roomInviteCode: string, workspaceId: number): Promise<{ status: number; data: WorkspaceRoom | { status: string; request_id: number } }> => {
    const res = await apiClient.post("/api/v1/rooms/join", {
      room_invite_code: roomInviteCode,
      workspace_id: workspaceId,
    });
    return { status: res.status, data: res.data };
  },
  updateVisibility: async (id: number, workspaceId: number, visibility: "full" | "busy_only"): Promise<WorkspaceRoom> => {
    const res = await apiClient.patch<WorkspaceRoom>(`/api/v1/rooms/${id}/workspaces/${workspaceId}/visibility`, { visibility });
    return res.data;
  },
  listJoinRequests: async (roomId: number): Promise<RoomJoinRequest[]> => {
    const res = await apiClient.get<RoomJoinRequest[]>(`/api/v1/rooms/${roomId}/join-requests`);
    return res.data;
  },
  approveJoinRequest: async (roomId: number, requestId: number): Promise<void> => {
    await apiClient.post(`/api/v1/rooms/${roomId}/join-requests/${requestId}/approve`);
  },
  rejectJoinRequest: async (roomId: number, requestId: number): Promise<void> => {
    await apiClient.post(`/api/v1/rooms/${roomId}/join-requests/${requestId}/reject`);
  },
  regenerateCode: async (id: number): Promise<WorkspaceRoom> => {
    const res = await apiClient.post<WorkspaceRoom>(`/api/v1/rooms/${id}/regenerate-code`);
    return res.data;
  },
  transferOwner: async (roomId: number, targetWorkspaceId: number): Promise<WorkspaceRoom> => {
    const res = await apiClient.post<WorkspaceRoom>(`/api/v1/rooms/${roomId}/transfer-owner`, { target_workspace_id: targetWorkspaceId });
    return res.data;
  },
  listSharedWorkspaces: async (roomId: number): Promise<{ workspace_id: number; workspace_name: string }[]> => {
    const res = await apiClient.get(`/api/v1/rooms/${roomId}/shared-workspaces`);
    return res.data;
  },
};
