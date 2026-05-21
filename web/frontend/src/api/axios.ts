import axios from "axios";
import { storage } from "../utils/storage";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

export const apiClient = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,  // Send cookies (httpOnly access_token) with every request
});

apiClient.interceptors.request.use((config) => {
  const token = storage.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      storage.removeToken();
      const path = window.location.pathname;
      const isAuthPage = path.startsWith("/login") || path.startsWith("/register") || path.startsWith("/auth/");
      // Don't navigate away while user is in an active meeting — let the component handle it
      const isMeetingPage = path.startsWith("/meeting");
      if (!isAuthPage && !isMeetingPage) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);
