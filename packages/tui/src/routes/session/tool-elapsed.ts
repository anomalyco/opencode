import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Locale } from "../../util/locale"
import type { ToolPart } from "@opencode-ai/sdk/v2"

// Text for the per-tool elapsed badge (`· 3.2s`). Pure: the caller
// re-renders on a 1s tick while the part runs (see useToolElapsed) and the
// text freezes once endMs is set. Empty string when there is nothing
// meaningful to show (unknown start, clock skew, or zero-length completed
// span — mirroring span() in the non-interactive `run` renderer).
export function toolElapsedText(
  startMs: number | undefined,
  endMs: number | undefined,
  nowMs: number,
): string {
  if (startMs === undefined || !Number.isFinite(startMs)) return ""
  if (endMs !== undefined) {
    if (!Number.isFinite(endMs) || endMs <= startMs) return ""
    return `· ${Locale.duration(endMs - startMs)}`
  }
  if (!Number.isFinite(nowMs) || nowMs < startMs) return ""
  return `· ${Locale.duration(nowMs - startMs)}`
}

type PartTime = { start?: number; end?: number } | undefined

function partTime(part: ToolPart | undefined): PartTime {
  const state = part?.state
  if (!state || !("time" in state)) return undefined
  return state.time as { start?: number; end?: number }
}

// Live elapsed badge for one tool part. Ticks once per second while the part
// is active (pending/running without end); frozen text once it completes.
// Returns "" while there is nothing to show yet. Timer is stopped on
// completion and on unmount.
export function useToolElapsed(part: () => ToolPart | undefined) {
  const [now, setNow] = createSignal(0)
  let timer: ReturnType<typeof setInterval> | undefined
  const active = createMemo(() => {
    const p = part()
    if (!p) return false
    const status = p.state.status
    if (status !== "running" && status !== "pending") return false
    return partTime(p)?.end === undefined
  })
  createEffect(() => {
    if (active()) {
      if (timer === undefined) {
        setNow(Date.now())
        timer = setInterval(() => setNow(Date.now()), 1000)
      }
    } else if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  })
  onCleanup(() => {
    if (timer !== undefined) clearInterval(timer)
  })
  return createMemo(() => {
    const t = partTime(part())
    if (!t) return ""
    return toolElapsedText(t.start, t.end, now())
  })
}
