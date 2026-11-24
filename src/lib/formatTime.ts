// Formats a 24-hour "HH:MM" time (as an <input type="time"> gives it) for display, e.g.:
//   formatTime("09:00")                 -> "9:00 AM"
//   formatTime("13:30")                 -> "1:30 PM"
//   formatTimeRange("09:00", "12:00")   -> "9:00 AM to 12:00 PM"
// Anything else is returned trimmed, so hand-typed times still show.
export function formatTime(time: string | null | undefined): string {
  if (!time) return "";

  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return time.trim();

  const hour = Number(match[1]);
  if (hour > 23) return time.trim();

  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

export function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  return [formatTime(start), formatTime(end)].filter(Boolean).join(" to ");
}
