import { apiClient } from "./axios";
import type { SlotResponse } from "../types";

export const slotsApi = {
  getSlots: async (date: string): Promise<SlotResponse[]> => {
    const res = await apiClient.get<SlotResponse[]>("/api/v1/slots", { params: { date } });
    return res.data;
  },
};
