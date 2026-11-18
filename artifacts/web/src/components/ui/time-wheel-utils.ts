// The pure half of TimePicker: converting between the `HH:MM` 24-hour string
// every activity due time is stored as and the hour / minute / AM-PM wheels a
// person scrolls. Kept free of React and `@/` aliases so node:test can run it.

export type Period = "am" | "pm";

export interface WheelTime {
  /** 1–12 */
  hour: number;
  /** 0–59 */
  minute: number;
  period: Period;
}

export const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const PERIODS: Period[] = ["am", "pm"];
const MINUTE_STEP = 5;

/** `HH:MM` (seconds tolerated) → wheel positions, or undefined if unparseable. */
export function parseHm(value: string | null | undefined): WheelTime | undefined {
  const match = /^(\d{1,2}):(\d{2})/.exec(value?.trim() ?? "");
  if (!match) return undefined;
  const h = Number(match[1]);
  const minute = Number(match[2]);
  if (h > 23 || minute > 59) return undefined;
  return { hour: h % 12 === 0 ? 12 : h % 12, minute, period: h < 12 ? "am" : "pm" };
}

/** Wheel positions → `HH:MM`. */
export function formatHm({ hour, minute, period }: WheelTime): string {
  const h = (hour % 12) + (period === "pm" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Minutes in 5-minute steps, plus the current minute when it is off-step
 *  (a time saved as 10:32 must still show 32, not silently become 10:30). */
export function minuteOptions(current?: number): number[] {
  const steps = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
  if (current == null || steps.includes(current)) return steps;
  return [...steps, current].sort((a, b) => a - b);
}

/** What the wheels show before a time is chosen: the next whole hour, which
 *  is what someone scheduling "later today" usually wants. */
export function defaultWheelTime(now: Date): WheelTime {
  const next = (now.getHours() + 1) % 24;
  return parseHm(`${next}:00`)!;
}
