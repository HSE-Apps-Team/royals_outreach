// Matching a scanned student ID to a student. Ported from the nithiksajjaWeb attendance scanner.

// Clean up a scanned or typed ID so the same card always matches.
// Code 39 barcodes sometimes include the * start/stop characters.
export function normalizeId(rawId: unknown): string {
  return String(rawId ?? "")
    .trim()
    .replace(/^\*+|\*+$/g, "")
    .trim()
    .toUpperCase();
}

// Spreadsheet apps often drop leading zeros ("00123" becomes "123"),
// so we also compare IDs with the leading zeros removed.
function stripLeadingZeros(id: string): string {
  const stripped = id.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
}

export function idsMatch(idA: string, idB: string): boolean {
  if (idA === idB) return true;
  return stripLeadingZeros(idA) === stripLeadingZeros(idB);
}

// HSE cards encode the 6 digit school ID, and student_user_data.student_id stores it as an
// integer, so a scan only names a student when it is all digits. Leading zeros are dropped the
// same way idsMatch drops them. Returns null for anything that cannot be a student ID.
export function scannedStudentId(rawId: unknown): number | null {
  const id = normalizeId(rawId);
  if (!/^\d{1,9}$/.test(id)) return null;

  const studentId = Number(stripLeadingZeros(id));
  return studentId > 0 && idsMatch(String(studentId), id) ? studentId : null;
}
