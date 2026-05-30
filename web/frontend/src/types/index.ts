export interface User {
  id: number;
  telegram_id: number | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  role: "user" | "admin" | "superadmin";
  language_code?: string | null;
  display_name: string;
  avatar?: string | null;
  position?: string | null;
}

export interface Booking {
  id: number;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  user_id: number;
  user: User;
  created_at: string;
  guests: string[];
  guest_statuses?: GuestStatusItem[];
  recurrence: "none" | "daily" | "weekly" | "custom";
  recurrence_until: string | null;
  recurrence_group_id: number | null;
  recurrence_days: number[];
  workspace_id: number | null;
  room_id: number | null;
  video_enabled: boolean;
  video_room_name?: string | null;
  booking_type: "physical" | "virtual" | "hybrid";
}

export interface BookingCreate {
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  guests?: string[];
  recurrence?: "none" | "daily" | "weekly" | "custom";
  recurrence_until?: string;
  recurrence_days?: number[];
  workspace_id?: number;
  room_id?: number;
  video_enabled?: boolean;
  booking_type?: "physical" | "virtual" | "hybrid";
}

export interface BookingUpdate {
  title?: string;
  description?: string;
  start_time?: string;
  end_time?: string;
  guests?: string[];
  video_enabled?: boolean;
}

export interface MeetingJoinResponse {
  room_name: string;
  livekit_url: string;
  access_token: string;
  user_identity: string;
  start_time: string;
  end_time: string;
  is_organizer: boolean;
  e2ee_key: string;
}

export interface ChatFile {
  id: number;
  filename: string;
  mime_type: string;
  size: number;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  user_id: number;
  user_name: string;
  body: string;
  file: ChatFile | null;
  created_at: string;
}

export interface Recording {
  session_id: number;
  room_name: string;
  has_recording: boolean;
  recording_duration_seconds: number | null;
  started_at: string;
  ended_at: string | null;
}

export interface MeetingInviteLink {
  invite_url: string;
  token: string;
}

export interface GuestJoinInfo {
  title: string;
  start_time: string;
  end_time: string;
  status: string;
  booking_id: number;
}

export interface InviteStatus {
  status: string;
  livekit_token?: string | null;
  livekit_url?: string | null;
  room_name?: string | null;
  booking_id?: number | null;
  guest_session_token?: string | null;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface BrowserSessionResponse {
  session_token: string;
  browser_url: string;
}

export interface SlotResponse {
  start: string;
  end: string;
  available: boolean;
}

export interface AdminStats {
  total_users: number;
  total_bookings: number;
  active_bookings: number;
}

export interface AttachmentMeta {
  id: number;
  booking_id: number;
  filename: string;
  mime_type: string;
  size: number;
  created_at: string;
  expired: boolean;
}

export type GuestRsvpStatus = "pending" | "accepted" | "declined";

export interface GuestStatusItem {
  name: string;
  status: GuestRsvpStatus;
}

export interface NotificationRecord {
  id: string;
  title: string;
  body: string;
  time: number;
  type?: "reminder" | "room_request" | "room_approved" | "room_rejected" | "member_joined" | "member_invited" | "meeting_invited";
  bookingId?: number;
  reminderMinutes?: number;
  rsvpStatus?: GuestRsvpStatus;
}

export interface Room {
  id: number;
  name: string;
  description: string | null;
  invite_code: string | null;
  join_mode: "open" | "approval" | "closed";
  archived_at: string | null;
  created_at: string;
}

export interface RoomJoinRequest {
  id: number;
  room_id: number;
  workspace_id: number;
  workspace_name: string;
  requested_by: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export interface WorkspaceRoom {
  id: number;
  workspace_id: number;
  room: Room;
  role: "owner" | "shared";
  visibility: "full" | "busy_only";
  created_at: string;
}

export interface WorkspaceMember {
  id: number;
  workspace_id: number;
  user_id: number | null;
  pending_username: string | null;
  role: "owner" | "admin" | "member";
  status: "active" | "pending";
  user: User | null;
  created_at: string;
  invite_deep_link?: string | null;
  invite_expires_at?: string | null;
}

export interface Workspace {
  id: number;
  name: string;
  slug: string;
  invite_code: string;
  timezone: string;
  telegram_chat_id: number | null;
  created_at: string;
  my_role: "owner" | "admin" | "member" | null;
  tg_invite_link?: string | null;
}

export interface WorkspaceDetail extends Workspace {
  members: WorkspaceMember[];
  pending_members: WorkspaceMember[];
}
