const ALT_TOGGLE_RE = /\x1b\[\?(?:47|1047|1049)[hl]/g
const MOUSE_FOCUS_RE = /\x1b\[\?(?:9|1000|1001|1002|1003|1004|1005|1006)[hl]/g

export function isLikelyTui(input: {
  snapshotWasAltScreen: boolean
  initialCommand?: string
  title?: string
}) {
  if (input.snapshotWasAltScreen) return true
  if (/\b(?:codex|claude|opencode)\b/i.test(input.initialCommand ?? "")) return true
  if (/\b(?:codex|claude|opencode)\b/i.test(input.title ?? "")) return true
  return false
}

export function filterModeSequences(input: { raw?: string; likelyTui: boolean }) {
  const base = (input.raw ?? "").replace(ALT_TOGGLE_RE, "")
  if (input.likelyTui) return base
  return base.replace(MOUSE_FOCUS_RE, "")
}

export function cursorPlan(input: {
  likelyTui: boolean
  splitWidthChanged: boolean
  isReload: boolean
  snapshotHasBuffer: boolean
  snapshotWasAltScreen: boolean
  snapshotCursor?: number
  lookbackBytes?: number
}) {
  const LOOKBACK_BYTES = input.lookbackBytes ?? 256 * 1024

  const hasPersistedBuffer = input.snapshotHasBuffer
  const tailOnReload = input.isReload && !input.snapshotHasBuffer && input.snapshotCursor === undefined
  const hasAltSnapshot = input.snapshotWasAltScreen && input.snapshotHasBuffer
  const splitTuiLiveTail = input.likelyTui && input.splitWidthChanged && input.snapshotHasBuffer

  const lookback =
    input.likelyTui &&
    typeof input.snapshotCursor === "number" &&
    Number.isSafeInteger(input.snapshotCursor) &&
    input.snapshotCursor > 0
      ? Math.max(0, input.snapshotCursor - LOOKBACK_BYTES)
      : undefined

  const tuiLiveTail = input.isReload && hasAltSnapshot
  const useLiveTailCursor =
    (!input.likelyTui && hasPersistedBuffer) || tailOnReload || tuiLiveTail || splitTuiLiveTail

  const cursorStart = input.likelyTui
    ? useLiveTailCursor
      ? undefined
      : lookback ?? input.snapshotCursor
    : useLiveTailCursor
      ? undefined
      : input.snapshotCursor

  const cursorParam = cursorStart !== undefined ? cursorStart : useLiveTailCursor ? -1 : 0

  return { cursorStart, cursorParam, useLiveTailCursor }
}

export function restoreSize(input: {
  likelyTui: boolean
  splitWidthChanged: boolean
  mountCols: number
  snapshotCols?: number
  snapshotRows?: number
  backendCols: number
  backendRows: number
}) {
  const rows = input.snapshotRows && input.snapshotRows > 0 ? input.snapshotRows : input.backendRows
  const cols =
    input.likelyTui && input.splitWidthChanged
      ? input.mountCols
      : input.snapshotCols && input.snapshotCols > 2
        ? input.snapshotCols
        : input.backendCols

  return { cols, rows }
}

