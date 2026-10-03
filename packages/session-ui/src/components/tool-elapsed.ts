// Pure elapsed-time math for the per-tool badge in BasicTool.
// `format` renders whole seconds using the caller's i18n strings (same keys
// as the assistant-message duration in message-part.tsx), which keeps this
// module free of i18n context so it stays unit-testable. Empty string means
// "nothing to show yet" (unknown start, clock skew, or zero-length finished
// span).
export function formatToolElapsed(
  startedAt: number | undefined,
  endedAt: number | undefined,
  nowMs: number,
  format: (totalSeconds: number) => string,
): string {
  if (startedAt === undefined || !Number.isFinite(startedAt)) return ""
  if (endedAt !== undefined) {
    if (!Number.isFinite(endedAt) || endedAt <= startedAt) return ""
    return format(Math.max(0, Math.round((endedAt - startedAt) / 1000)))
  }
  if (!Number.isFinite(nowMs) || nowMs < startedAt) return ""
  return format(Math.max(0, Math.round((nowMs - startedAt) / 1000)))
}
