import { apiClient } from "./axios";
import type { AdminStats, User } from "../types";

export interface AdminAnalytics {
  period_days: number;
  workspace_id: number | null;
  total_members: number;
  total_meetings: number;
  new_members: Array<{ date: string; count: number }>;
  meetings_by_day: Array<{ date: string; count: number }>;
  top_organizers: Array<{ user_id: number; user_name: string; count: number }>;
  workspaces: Array<{ id: number; name: string }>;
}

export const usersApi = {
  getMe: async (): Promise<User> => {
    const res = await apiClient.get<User>("/api/v1/users/me");
    return res.data;
  },

  search: async (q: string): Promise<User[]> => {
    const res = await apiClient.get<User[]>("/api/v1/users/search", { params: { q } });
    return res.data;
  },

  getFeedToken: async (): Promise<string> => {
    const res = await apiClient.post<{ feed_token: string }>("/api/v1/users/feed-token");
    return res.data.feed_token;
  },

  adminListUsers: async (): Promise<User[]> => {
    const res = await apiClient.get<User[]>("/api/v1/users/admin/users");
    return res.data;
  },

  adminStats: async (): Promise<AdminStats> => {
    const res = await apiClient.get<AdminStats>("/api/v1/users/admin/stats");
    return res.data;
  },

  adminSetRole: async (userId: number, role: "user" | "admin"): Promise<void> => {
    await apiClient.patch(`/api/v1/users/admin/users/${userId}/role`, { role });
  },

  adminCreateUser: async (name: string, username?: string, role?: string): Promise<User> => {
    const res = await apiClient.post<User>("/api/v1/users/admin/users", { name, username, role });
    return res.data;
  },

  adminDeleteUser: async (userId: number): Promise<void> => {
    await apiClient.delete(`/api/v1/users/admin/users/${userId}`);
  },

  adminInvite: async (username: string): Promise<{ created: boolean; sent: boolean; link: string }> => {
    const res = await apiClient.post<{ created: boolean; sent: boolean; link: string }>("/api/v1/users/admin/invite", { username });
    return res.data;
  },

  setAvatar: async (avatar: string | null): Promise<void> => {
    await apiClient.patch("/api/v1/users/me/avatar", { avatar });
  },
  adminGetAnalytics: async (params: { period_days?: number; workspace_id?: number } = {}): Promise<AdminAnalytics> => {
    const res = await apiClient.get<AdminAnalytics>("/api/v1/users/admin/analytics", { params });
    return res.data;
  },
};
