import { apiClient } from "./axios";

export type SubmissionStatus = "new" | "in_progress" | "closed";

export interface Submission {
  id: number;
  user: { id: number; display_name: string; username: string | null };
  text: string;
  photo_b64: string | null;
  status: SubmissionStatus;
  created_at: string;
}

export const submissionsApi = {
  create: async (text: string, photoB64?: string | null): Promise<Submission> => {
    const res = await apiClient.post<Submission>("/api/v1/submissions", {
      text,
      photo_b64: photoB64 ?? null,
    });
    return res.data;
  },

  myList: async (): Promise<Submission[]> => {
    const res = await apiClient.get<Submission[]>("/api/v1/submissions/me");
    return res.data;
  },

  adminList: async (): Promise<Submission[]> => {
    const res = await apiClient.get<Submission[]>("/api/v1/submissions/admin");
    return res.data;
  },

  adminUpdateStatus: async (id: number, status: SubmissionStatus): Promise<Submission> => {
    const res = await apiClient.patch<Submission>(`/api/v1/submissions/admin/${id}`, { status });
    return res.data;
  },

  adminDelete: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/v1/submissions/admin/${id}`);
  },
};
