import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bookingsApi } from "../api/bookings";
import { slotsApi } from "../api/slots";
import { usersApi } from "../api/users";
import { workspacesApi } from "../api/workspaces";
import type { AttachmentMeta, Booking, BookingCreate, BookingUpdate, User } from "../types";

export function useBookings(date: string | undefined, workspaceId?: number) {
  return useQuery({
    queryKey: ["bookings", date, workspaceId ?? null],
    queryFn: () => bookingsApi.getByDate(date!, workspaceId),
    enabled: !!date,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useActiveBookings() {
  return useQuery({
    queryKey: ["bookings", "active"],
    queryFn: bookingsApi.getActive,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useUsers(query: string = "") {
  return useQuery({
    queryKey: ["users", "search", query],
    queryFn: () => usersApi.search(query),
    staleTime: 30_000,
  });
}

export function useWorkspaceUsers(workspaceId: number | null | undefined): User[] {
  const { data: members = [] } = useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => workspacesApi.listMembers(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 10_000,
  });
  return members
    .filter(m => m.status === "active" && m.user != null)
    .map(m => m.user as User);
}

export function useSlots(date: string | undefined) {
  return useQuery({
    queryKey: ["slots", date],
    queryFn: () => slotsApi.getSlots(date!),
    enabled: !!date,
    staleTime: 60_000,
  });
}

export function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: BookingCreate) => bookingsApi.create(payload),
    onMutate: async (payload) => {
      const dateStr = payload.start_time.split("T")[0];
      await queryClient.cancelQueries({ queryKey: ["bookings", dateStr] });
      const allEntries = queryClient.getQueriesData<Booking[]>({ queryKey: ["bookings", dateStr] });
      const optimistic: Booking = {
        id: -Date.now(),
        title: payload.title,
        description: payload.description ?? null,
        start_time: payload.start_time,
        end_time: payload.end_time,
        user_id: 0,
        user: { id: 0, telegram_id: 0, first_name: null, last_name: null, username: null, role: "user", display_name: "..." },
        created_at: new Date().toISOString(),
        guests: payload.guests ?? [],
        recurrence: (payload.recurrence as Booking["recurrence"]) ?? "none",
        recurrence_until: null,
        recurrence_group_id: null,
        recurrence_days: [],
        workspace_id: payload.workspace_id ?? null,
        room_id: payload.room_id ?? null,
        video_enabled: payload.video_enabled ?? false,
        video_room_name: null,
        booking_type: payload.booking_type ?? "physical",
      };
      queryClient.setQueriesData<Booking[]>({ queryKey: ["bookings", dateStr] }, (old = []) => [...old, optimistic]);
      return { allEntries, dateStr };
    },
    onError: (_err, _payload, ctx) => {
      if (ctx) {
        for (const [key, data] of ctx.allEntries ?? []) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: (_data, _err, payload) => {
      const dateStr = payload.start_time.split("T")[0];
      queryClient.invalidateQueries({ queryKey: ["bookings", dateStr] });
      queryClient.invalidateQueries({ queryKey: ["bookings", "active"] });
      queryClient.invalidateQueries({ queryKey: ["slots", dateStr] });
    },
  });
}

export function useUpdateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: BookingUpdate }) => {
      return bookingsApi.update(id, payload);
    },
    onMutate: async ({ id, payload }) => {
      const newDateStr = payload.start_time?.split("T")[0];

      // Find booking in date-keyed caches only (skip "active" and other non-date keys)
      const allEntries = queryClient.getQueriesData<Booking[]>({ queryKey: ["bookings"] });
      let oldDateStr: string | undefined;
      let oldBooking: Booking | undefined;
      let oldQueryKey: readonly unknown[] | undefined;
      const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
      for (const [key, data] of allEntries) {
        const k = key[1] as string;
        if (!ISO_DATE.test(k)) continue;
        if (Array.isArray(data)) {
          const found = data.find((b) => b.id === id);
          if (found) { oldBooking = found; oldDateStr = k; oldQueryKey = key; break; }
        }
      }
      if (!oldBooking) return {};

      await queryClient.cancelQueries({ queryKey: ["bookings", oldDateStr] });
      if (newDateStr && newDateStr !== oldDateStr)
        await queryClient.cancelQueries({ queryKey: ["bookings", newDateStr] });

      const previousOld = queryClient.getQueryData<Booking[]>(oldQueryKey as any);
      const previousNew = newDateStr && newDateStr !== oldDateStr
        ? queryClient.getQueryData<Booking[]>(["bookings", newDateStr]) : undefined;

      const optimistic: Booking = { ...oldBooking, ...payload } as Booking;

      if (newDateStr && newDateStr !== oldDateStr) {
        queryClient.setQueriesData<Booking[]>({ queryKey: ["bookings", oldDateStr] }, (old = []) =>
          old.filter((b) => b.id !== id));
        queryClient.setQueriesData<Booking[]>({ queryKey: ["bookings", newDateStr] }, (old = []) =>
          [...(old ?? []), optimistic]);
      } else {
        queryClient.setQueriesData<Booking[]>({ queryKey: ["bookings", oldDateStr] }, (old = []) =>
          old.map((b) => b.id === id ? optimistic : b));
      }

      return { previousOld, previousNew, oldDateStr, newDateStr, oldQueryKey };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.previousOld && ctx?.oldQueryKey)
        queryClient.setQueryData(ctx.oldQueryKey, ctx.previousOld);
      if (ctx?.previousNew && ctx?.newDateStr)
        queryClient.setQueryData(["bookings", ctx.newDateStr], ctx.previousNew);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: ["slots"] });
    },
  });
}

export function useDeleteBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deleteSeries }: { id: number; deleteSeries?: boolean }) =>
      bookingsApi.delete(id, deleteSeries),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ["bookings"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["bookings"] });
      queryClient.setQueriesData({ queryKey: ["bookings"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.filter((b: any) => b.id !== id);
      });
      return { previousData };
    },
    onError: (_err: any, _vars: any, context: any) => {
      context?.previousData?.forEach(([queryKey, data]: [any, any]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookings"] }),
  });
}

export function useAdminBookings() {
  return useQuery({
    queryKey: ["admin", "bookings"],
    queryFn: bookingsApi.adminListAll,
    staleTime: 120000,
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: usersApi.adminListUsers,
    staleTime: 120000,
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: ["admin", "stats"],
    queryFn: usersApi.adminStats,
    staleTime: 120000,
    refetchInterval: 30_000,
  });
}

export function useAttachments(bookingId: number | undefined) {
  return useQuery<AttachmentMeta[]>({
    queryKey: ["attachments", bookingId],
    queryFn: () => bookingsApi.listAttachments(bookingId!),
    enabled: !!bookingId,
    staleTime: 10_000,
  });
}

export function useUploadAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, file }: { bookingId: number; file: File }) =>
      bookingsApi.uploadAttachment(bookingId, file),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["attachments", vars.bookingId] });
    },
  });
}

export function useDeleteAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, attachmentId }: { bookingId: number; attachmentId: number }) =>
      bookingsApi.deleteAttachment(bookingId, attachmentId),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["attachments", vars.bookingId] });
    },
  });
}
