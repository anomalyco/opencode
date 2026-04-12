import type { ToolPart } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"

export function toolStartTime(part: ToolPart): number | undefined {
  switch (part.state.status) {
    case "running":
    case "completed":
    case "error":
      return part.state.time.start
    default:
      return undefined
  }
}

export function toolEndTime(part: ToolPart): number | undefined {
  switch (part.state.status) {
    case "completed":
    case "error":
      return part.state.time.end
    default:
      return undefined
  }
}

export function formatToolDuration(ms: number, locale = "en-US") {
  const total = ms <= 0 ? 0 : Math.max(1, Math.round(ms / 1000))
  const numfmt = new Intl.NumberFormat(locale)
  if (total < 60) return `${numfmt.format(total)}s`

  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  if (hours > 0) {
    return `${numfmt.format(hours)}h ${numfmt.format(minutes)}m ${numfmt.format(seconds)}s`
  }

  return `${numfmt.format(minutes)}m ${numfmt.format(seconds)}s`
}

export function formatToolExecutionTime(timestamp: number, locale = "en-US", timeZone?: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(timestamp)
}

export function formatToolHeaderTiming(input: {
  start?: number
  end?: number
  now?: number
  locale?: string
  timeZone?: string
}) {
  if (typeof input.start !== "number") return ""
  const locale = input.locale ?? "en-US"
  const pieces = [formatToolExecutionTime(input.start, locale, input.timeZone)]
  const finish = typeof input.end === "number" ? input.end : input.now
  if (typeof finish === "number") {
    pieces.push(formatToolDuration(Math.max(0, finish - input.start), locale))
  }
  return pieces.join(" · ")
}

function createNow(active: () => boolean) {
  const [now, setNow] = createSignal(Date.now())
  let interval: ReturnType<typeof setInterval> | undefined

  const clear = () => {
    if (interval === undefined) return
    clearInterval(interval)
    interval = undefined
  }

  createEffect(() => {
    clear()
    if (!active()) return
    setNow(Date.now())
    interval = setInterval(() => setNow(Date.now()), 1000)
  })

  onCleanup(clear)

  return now
}

export function isToolInterrupted(part: ToolPart): boolean {
  if (part.state.status !== "error") return false
  return part.state.metadata?.interrupted === true
}

export function createToolInterrupted(part: () => ToolPart) {
  return createMemo(() => isToolInterrupted(part()))
}

export function createToolTimingMeta(part: () => ToolPart, locale: () => string) {
  const now = createNow(() => part().state.status === "running")
  const [displayMs, setDisplayMs] = createSignal(0)

  createEffect(
    on(
      () => part().id,
      () => {
        setDisplayMs(0)
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const value = part()
    const start = toolStartTime(value)
    if (typeof start !== "number") return
    const end = toolEndTime(value)
    const finish = value.state.status === "running" ? now() : end
    if (typeof finish !== "number") return
    setDisplayMs((prev) => Math.max(prev, finish - start))
  })

  return createMemo(() => {
    const value = part()
    const start = toolStartTime(value)
    if (typeof start !== "number") return ""

    if (isToolInterrupted(value)) {
      return formatToolExecutionTime(start, locale()) + " · Interrupted"
    }

    if (displayMs() > 0) {
      return formatToolHeaderTiming({
        start,
        now: start + displayMs(),
        locale: locale(),
      })
    }

    const end = toolEndTime(value)
    if (typeof end === "number") {
      return formatToolHeaderTiming({
        start,
        now: start + Math.max(1, end - start),
        locale: locale(),
      })
    }

    return formatToolHeaderTiming({
      start,
      locale: locale(),
    })
  })
}
