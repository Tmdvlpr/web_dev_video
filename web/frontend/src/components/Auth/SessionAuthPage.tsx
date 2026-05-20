import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { authApi } from "../../api/auth";
import LoadingSpinner from "../Common/LoadingSpinner";

/**
 * Handles the browser auth flow via one-time session token.
 * URL: /auth/session/:sessionToken
 * Backend sets an httpOnly cookie; we invalidate the /me query so auth state updates.
 */
export default function SessionAuthPage() {
  const { sessionToken } = useParams<{ sessionToken: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const authenticate = async () => {
      if (!sessionToken) {
        navigate("/login", { replace: true });
        return;
      }

      try {
        await authApi.consumeSession(sessionToken);
        // Backend set the httpOnly cookie; invalidate /me so useAuth picks up the new session
        await queryClient.invalidateQueries({ queryKey: ["me"] });
        sessionStorage.setItem("__corpmeet_replay_splash", "1");
        window.dispatchEvent(new CustomEvent("corpmeet:replay-splash"));
        navigate("/bookings", { replace: true });
      } catch {
        navigate("/login", { replace: true });
      }
    };

    authenticate();
  }, [sessionToken, navigate, queryClient]);

  return <LoadingSpinner />;
}
