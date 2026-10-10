import type { Page } from "@playwright/test"

const virtualContentSelector = "[data-timeline-virtual-content]"
const pendingMarkdownSelector = '[data-component="markdown"]:not([data-markdown-ready])'
const scrollerSelector = ".scroll-view__viewport"

type TimelineScrollProbe = {
  /** requestAnimationFrame timestamps collected across the measured scroll window. */
  frames: number[]
  longTasks: { startTime: number; duration: number }[]
  scrollEvents: number
  scrollTopStart: number
  scrollTopEnd: number
  /** Frames observed while the cold tail settle was still pending, the gate that owns the offsetHeight sweep. */
  coldPendingFrames: number
  peakPendingMarkdown: number
  offsetHeightReads: number
  offsetHeightReadsWhileColdPending: number
  startedAt?: number
  start: () => void
  stop: () => void
}

export type TimelineScrollMetrics = {
  frameCount: number
  frameGapMedianMs: number | null
  frameGapP95Ms: number | null
  frameGapMaxMs: number | null
  longTaskCount: number
  longTaskTotalMs: number
  maxLongTaskMs: number
  scrollEvents: number
  scrolledPx: number
  coldPendingFrameShare: number
  peakPendingMarkdown: number
  offsetHeightReads: number
  offsetHeightReadsWhileColdPending: number
}

/**
 * Records scroll-path frame pacing plus the visibility of the cold tail settle.
 *
 * The settle gate reads `offsetHeight` on every mounted row, so the probe counts those reads
 * instead of instrumenting production code. Reads are attributed to the gate only while
 * `[data-timeline-virtual-content]` still carries its inline `visibility: hidden`, which is the
 * element the settle owns until it finishes.
 */
export async function installTimelineScrollProbe(page: Page) {
  await page.evaluate(
    ({ virtualContentSelector, pendingMarkdownSelector, scrollerSelector }) => {
      const root = [...document.querySelectorAll<HTMLElement>(scrollerSelector)].find((element) =>
        element.querySelector("[data-timeline-row]"),
      )

      if (!root) throw new Error("timeline scroller is not mounted")

      // offsetHeight is declared on HTMLElement.prototype, so the read sweep is counted there.
      const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!
      let cached: HTMLElement | undefined
      const virtualContent = () => {
        if (cached?.isConnected) return cached
        cached = document.querySelector<HTMLElement>(virtualContentSelector) ?? undefined
        return cached
      }
      const coldPending = () => virtualContent()?.style.visibility === "hidden"

      const probe: TimelineScrollProbe = {
        frames: [],
        longTasks: [],
        scrollEvents: 0,
        scrollTopStart: 0,
        scrollTopEnd: 0,
        coldPendingFrames: 0,
        peakPendingMarkdown: 0,
        offsetHeightReads: 0,
        offsetHeightReadsWhileColdPending: 0,
        start: () => {
          probe.startedAt = performance.now()
          probe.scrollTopStart = root.scrollTop
          requestAnimationFrame(frame)
        },
        stop: () => {
          probe.startedAt = undefined
          observer?.disconnect()
          probe.scrollTopEnd = root.scrollTop
          Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight)
        },
      }

      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) {
          if (probe.startedAt !== undefined) {
            probe.offsetHeightReads += 1
            if (coldPending()) probe.offsetHeightReadsWhileColdPending += 1
          }

          return offsetHeight.get!.call(this)
        },
      })

      const observer = PerformanceObserver.supportedEntryTypes.includes("longtask")
        ? new PerformanceObserver((list) => {
            probe.longTasks.push(
              ...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })),
            )
          })
        : undefined

      observer?.observe({ type: "longtask" })

      function frame(time: number) {
        if (probe.startedAt === undefined) return

        probe.frames.push(time)
        if (coldPending()) probe.coldPendingFrames += 1
        // Pending markdown is sampled sparsely on purpose: a per-frame query would add the very
        // layout work this probe exists to observe.
        if (probe.frames.length % 15 === 0)
          probe.peakPendingMarkdown = Math.max(
            probe.peakPendingMarkdown,
            virtualContent()?.querySelectorAll(pendingMarkdownSelector).length ?? 0,
          )

        requestAnimationFrame(frame)
      }

      root.addEventListener(
        "scroll",
        () => {
          if (probe.startedAt === undefined) return
          probe.scrollEvents += 1
        },
        { passive: true },
      )

      ;(window as Window & { __timelineScrollProbe?: TimelineScrollProbe }).__timelineScrollProbe = probe
    },
    { virtualContentSelector, pendingMarkdownSelector, scrollerSelector },
  )
}

export async function startTimelineScrollProbe(page: Page) {
  await page.evaluate(() => {
    ;(window as Window & { __timelineScrollProbe?: TimelineScrollProbe }).__timelineScrollProbe!.start()
  })
}

export async function collectTimelineScrollMetrics(page: Page): Promise<TimelineScrollMetrics> {
  return page.evaluate(() => {
    const probe = (window as Window & { __timelineScrollProbe?: TimelineScrollProbe }).__timelineScrollProbe!
    const startedAt = probe.startedAt!
    const endedAt = performance.now()

    probe.stop()

    const frames = probe.frames
    const gaps = frames.map((time, index) => time - (frames[index - 1] ?? time)).filter((gap) => gap > 0)
    const longTasks = probe.longTasks.filter((entry) => entry.startTime >= startedAt && entry.startTime <= endedAt)

    return {
      frameCount: frames.length,
      frameGapMedianMs: median(gaps),
      frameGapP95Ms: nearestRank(gaps, 0.95),
      frameGapMaxMs: gaps.length === 0 ? null : Math.max(...gaps),
      longTaskCount: longTasks.length,
      longTaskTotalMs: longTasks.reduce((sum, entry) => sum + entry.duration, 0),
      maxLongTaskMs: longTasks.length === 0 ? 0 : Math.max(...longTasks.map((entry) => entry.duration)),
      scrollEvents: probe.scrollEvents,
      scrolledPx: Math.abs(probe.scrollTopEnd - probe.scrollTopStart),
      coldPendingFrameShare: frames.length === 0 ? 0 : probe.coldPendingFrames / frames.length,
      peakPendingMarkdown: probe.peakPendingMarkdown,
      offsetHeightReads: probe.offsetHeightReads,
      offsetHeightReadsWhileColdPending: probe.offsetHeightReadsWhileColdPending,
    }

    function median(values: number[]) {
      if (values.length === 0) return null
      const sorted = [...values].sort((a, b) => a - b)
      const middle = Math.floor(sorted.length / 2)

      return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
    }

    function nearestRank(values: number[], quantile: number) {
      if (values.length === 0) return null
      const sorted = [...values].sort((a, b) => a - b)
      return sorted[Math.min(sorted.length, Math.max(1, Math.ceil(quantile * sorted.length))) - 1]!
    }
  })
}
