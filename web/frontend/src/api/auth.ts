import { apiClient } from "./axios";
import type { BrowserSessionResponse, TokenResponse, User } from "../types";

export const authApi = {
  register: async (
    initData: string,
    first_name: string,
    last_name: string,
    opts?: { position?: string; invite_token?: string; ws_code?: string }
  ): Promise<TokenResponse> => {
    const res = await apiClient.post<TokenResponse>("/api/v1/auth/register", {
      initData,
      first_name,
      last_name,
      ...opts,
    });
    return res.data;
  },

  login: async (initData: string): Promise<TokenResponse> => {
    const res = await apiClient.post<TokenResponse>("/api/v1/auth/login", { initData });
    return res.data;
  },

  getMe: async (): Promise<User> => {
    const res = await apiClient.get<User>("/api/v1/auth/me");
    return res.data;
  },

  createBrowserSession: async (): Promise<BrowserSessionResponse> => {
    const res = await apiClient.post<BrowserSessionResponse>("/api/v1/auth/browser/session");
    return res.data;
  },

  consumeSession: async (sessionToken: string): Promise<TokenResponse> => {
    const res = await apiClient.get<TokenResponse>(`/api/v1/auth/session/${sessionToken}`);
    return res.data;
  },

  createQrSession: async (): Promise<{ token: string; bot_url: string | null; expires_in: number }> => {
    const res = await apiClient.post<{ token: string; bot_url: string | null; expires_in: number }>("/api/v1/auth/qr-session");
    return res.data;
  },

  pollSession: async (token: string): Promise<{ status: "pending" } | TokenResponse> => {
    const res = await apiClient.get(`/api/v1/auth/session/${token}`);
    if (res.status === 202) return { status: "pending" };
    return res.data;
  },

  webRegister: async (first_name: string, last_name: string): Promise<TokenResponse> => {
    const res = await apiClient.post<TokenResponse>("/api/v1/auth/web-register", { first_name, last_name });
    return res.data;
  },

  updateMe: async (body: { first_name: string; last_name?: string; position?: string | null }): Promise<User> => {
    const res = await apiClient.patch<User>("/api/v1/auth/me", body);
    return res.data;
  },

  devLogin: async (): Promise<TokenResponse> => {
    const res = await apiClient.post<TokenResponse>("/api/v1/auth/dev-login");
    return res.data;
  },

  logout: async (): Promise<void> => {
    await apiClient.post("/api/v1/auth/logout");
  },
};
