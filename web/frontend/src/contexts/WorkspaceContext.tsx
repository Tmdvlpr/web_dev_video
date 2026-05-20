import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { workspacesApi } from "../api/workspaces";
import { roomsApi } from "../api/rooms";
import type { Workspace, WorkspaceRoom } from "../types";

interface WorkspaceContextValue {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  setActiveWorkspaceId: (id: number | null) => void;
  myRooms: WorkspaceRoom[];
  isLoading: boolean;
  refetchWorkspaces: () => void;
  refetchRooms: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaces: [],
  activeWorkspace: null,
  setActiveWorkspaceId: () => {},
  myRooms: [],
  isLoading: false,
  refetchWorkspaces: () => {},
  refetchRooms: () => {},
});

const STORAGE_KEY = "__corpmeet_active_ws";

export function WorkspaceProvider({ children, enabled }: { children: React.ReactNode; enabled: boolean }) {
  const queryClient = useQueryClient();

  const { data: workspaces = [], isLoading: wsLoading, refetch: refetchWorkspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: workspacesApi.list,
    enabled,
    staleTime: 30_000,
  });

  const { data: myRooms = [], isLoading: roomsLoading, refetch: refetchRooms } = useQuery({
    queryKey: ["rooms"],
    queryFn: roomsApi.list,
    enabled,
    staleTime: 30_000,
  });

  const [activeId, setActiveId] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored, 10) : null;
  });

  // Auto-select first workspace if none selected
  useEffect(() => {
    if (!workspaces.length) return;
    const valid = activeId && workspaces.some(w => w.id === activeId);
    if (!valid) {
      const first = workspaces[0].id;
      setActiveId(first);
      localStorage.setItem(STORAGE_KEY, String(first));
    }
  }, [workspaces, activeId]);

  const setActiveWorkspaceId = useCallback((id: number | null) => {
    setActiveId(id);
    if (id != null) localStorage.setItem(STORAGE_KEY, String(id));
    else localStorage.removeItem(STORAGE_KEY);
    queryClient.invalidateQueries({ queryKey: ["bookings"] });
  }, [queryClient]);

  const activeWorkspace = workspaces.find(w => w.id === activeId) ?? null;

  return (
    <WorkspaceContext.Provider value={{
      workspaces,
      activeWorkspace,
      setActiveWorkspaceId,
      myRooms,
      isLoading: wsLoading || roomsLoading,
      refetchWorkspaces,
      refetchRooms,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
