// Consumer contract: the caller joins asked->replied permission windows per
// sessionID before calling; this module does no sessionID special-casing and
// applies no RATE_MIN_OUT gating (RATE_MIN_OUT never applies to latency).
export interface PermissionWindow {
  askedAt: number;
  repliedAt: number | null;
}
export interface TurnMarks {
  promptAt: number;
  firstPartAt: number | null;
  permissionWindows: PermissionWindow[];
}
function isGoodTime(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
export function blockedSeconds(marks: TurnMarks): number {
  const prompt = marks.promptAt;
  const first = marks.firstPartAt;
  if (!isGoodTime(prompt) || prompt <= 0) return 0;
  if (!isGoodTime(first) || first <= prompt) return 0;
  const wins = Array.isArray(marks.permissionWindows) ? marks.permissionWindows : [];
  const clipped: Array<[number, number]> = [];
  for (const w of wins) {
    if (!w) continue;
    const asked = w.askedAt;
    if (!isGoodTime(asked)) continue;
    const replied = w.repliedAt;
    const endRaw = replied == null ? first : replied;
    if (!isGoodTime(endRaw)) continue;
    const s = Math.max(asked, prompt);
    const e = Math.min(endRaw, first);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (e <= s) continue;
    clipped.push([s, e]);
  }
  if (clipped.length === 0) return 0;
  clipped.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cs = clipped[0][0];
  let ce = clipped[0][1];
  for (let i = 1; i < clipped.length; i++) {
    const [s, e] = clipped[i];
    if (s <= ce) {
      if (e > ce) ce = e;
    } else {
      total += ce - cs;
      cs = s;
      ce = e;
    }
  }
  total += ce - cs;
  return Math.max(0, total);
}
export function ttftSeconds(marks: TurnMarks): number | null {
  const prompt = marks.promptAt;
  const first = marks.firstPartAt;
  if (!isGoodTime(prompt) || prompt <= 0) return null;
  if (!isGoodTime(first)) return null;
  const blocked = blockedSeconds(marks);
  return Math.max(0, first - prompt - blocked);
}
export function permissionPending(marks: TurnMarks): boolean {
  const wins = Array.isArray(marks.permissionWindows) ? marks.permissionWindows : [];
  return wins.some((w) => w != null && w.repliedAt == null);
}
