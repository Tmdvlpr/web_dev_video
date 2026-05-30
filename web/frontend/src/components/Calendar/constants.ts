export const HOUR_HEIGHT_PX = 64;
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR   = 22;
export const TOTAL_HOURS    = DAY_END_HOUR - DAY_START_HOUR;
export const HOURS          = Array.from({ length: TOTAL_HOURS }, (_, i) => i + DAY_START_HOUR);
