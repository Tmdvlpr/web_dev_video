import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi } from "../api/auth";
import { storage } from "../utils/storage";
import type { User } from "../types";

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["me"],
    queryFn: authApi.getMe,
    // Always enabled: supports both Bearer (localStorage, Telegram Mini App)
    // and httpOnly cookie auth (web browser). 401 is handled by the axios interceptor.
    enabled: true,
    retry: false,
    staleTime: 60_000,
  });

  const setToken = async (token: string) => {
    storage.setToken(token);
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  };

  const logout = () => {
    storage.removeToken();
    authApi.logout().catch(() => {});  // clear httpOnly cookie server-side
    queryClient.clear();
  };

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    setToken,
    logout,
  };
}
