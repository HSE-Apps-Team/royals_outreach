// HSE is in Fishers, Indiana, so "today" is the school's date, not the server's.
const SCHOOL_TIME_ZONE = "America/Indiana/Indianapolis";

// Today's date at the school as an ISO date, e.g. "2026-10-27".
export function schoolToday(): string {
  // en-CA formats dates as YYYY-MM-DD
  return new Date().toLocaleDateString("en-CA", { timeZone: SCHOOL_TIME_ZONE });
}

// A moment's date at the school as an ISO date, e.g. "2026-10-27".
export function schoolDateOf(moment: Date): string {
  return moment.toLocaleDateString("en-CA", { timeZone: SCHOOL_TIME_ZONE });
}

// A moment's wall-clock time at the school as 24-hour "HH:MM", e.g. "14:47" (formatTime shows it).
export function schoolClockOf(moment: Date): string {
  return moment.toLocaleTimeString("en-GB", { timeZone: SCHOOL_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
}

// Whole days from one ISO date to a later one, e.g. ("2026-10-20", "2026-10-27") is 7.
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

// A wall-clock time on a school date as a moment, e.g. ("2026-11-30", 0, 0) is midnight in
// Indiana that day, whether daylight saving time is on (UTC-4) or off (UTC-5).
export function schoolMoment(isoDate: string, hour: number, minute: number): Date {
  const wallClock = Date.parse(`${isoDate}T00:00:00Z`) + (hour * 60 + minute) * 60_000;
  const pad = (n: number) => String(n).padStart(2, "0");
  for (const offset of [4, 5]) {
    const guess = new Date(wallClock + offset * 3_600_000);
    const local = guess.toLocaleString("sv-SE", { timeZone: SCHOOL_TIME_ZONE }).slice(0, 16);
    if (local === `${isoDate} ${pad(hour)}:${pad(minute)}`) return guess;
  }
  return new Date(wallClock + 5 * 3_600_000);
}
