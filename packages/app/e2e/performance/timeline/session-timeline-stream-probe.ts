import type { Page } from "@playwright/test"

const STREAM_MARKER_PATTERN = "stream-(\\d+)"
const STREAM_FRAGMENT_COUNT = 18

type TimelineProbeState = {
  started: number
  ended: number
  profileVisual: boolean
  minimal: boolean
  frames: number[]
  frameAt: number[]
  applied: { at: number; index: number }[]
  geometry: {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
    distance: number
    virtualHeight: number
    headerHeight: number
  }[]
  blanks: number
  longTasks: number[]
  layoutShifts: number[]
  visibleMounts: number
  visibleUnmounts: number
  visibleRows: Set<Element>
  visibleSubtreeMounts: string[]
  visibleSubtreeUnmounts: string[]
  visibleSubtreeReplacements: number
  visibleSubtreeDropouts: string[]
  visibleSubtrees: Map<string, Element>
  subtreeKeys: WeakMap<Element, string>
  maxOverlap: number
  maxGap: number
  maxPartTopMovement: number
  previousPartTop: number
  slowFrames: {
    duration: number
    index: number
    phase: "stream" | "boundary" | "complete" | "unknown"
    tokenSpans: number
    blocks: number
    codeBlocks: number
    height: number
    distance: number
  }[]
  scroll: {
    calls: number
    callNoops: number
    sameFrameCalls: number
    assignments: number
    assignmentNoops: number
    lastCallFrame: number
    frame: number
  }
  row: HTMLElement
  markdown: HTMLElement
  running: boolean
  previous: number
  cleanup: () => void
  start: () => void
}

export async function installTimelineStreamProbe(
  page: Page,
  options: { textPartID: string; finalIndex: number; profileVisual: boolean; minimal: boolean },
) {
  await page.evaluate(
    ({ textPartID, finalIndex, profileVisual, minimal, markerPattern, fragmentCount }) => {
      const part = document.querySelector<HTMLElement>(`[data-timeline-part-id="${textPartID}"]`)
      const row = part?.closest<HTMLElement>("[data-timeline-row]")
      const markdown = part?.querySelector<HTMLElement>('[data-component="markdown"]')
      const root = part?.closest<HTMLElement>(".scroll-view__viewport")
      if (!part || !row || !markdown || !root) throw new Error("missing streaming benchmark nodes")
      const viewport = root.getBoundingClientRect()
      const state: TimelineProbeState = {
        started: 0,
        ended: Infinity,
        profileVisual,
        minimal,
        frames: [],
        frameAt: [],
        applied: [],
        geometry: [],
        blanks: 0,
        longTasks: [],
        layoutShifts: [],
        visibleMounts: 0,
        visibleUnmounts: 0,
        visibleRows: new Set(
          [...root.querySelectorAll("[data-timeline-key]")].filter((element) => {
            const rect = element.getBoundingClientRect()
            return rect.bottom > viewport.top && rect.top < viewport.bottom
          }),
        ),
        visibleSubtreeMounts: [],
        visibleSubtreeUnmounts: [],
        visibleSubtreeReplacements: 0,
        visibleSubtreeDropouts: [],
        visibleSubtrees: new Map<string, Element>(),
        subtreeKeys: new WeakMap<Element, string>(),
        maxOverlap: 0,
        maxGap: 0,
        maxPartTopMovement: 0,
        previousPartTop: part.getBoundingClientRect().top,
        slowFrames: [],
        scroll: {
          calls: 0,
          callNoops: 0,
          sameFrameCalls: 0,
          assignments: 0,
          assignmentNoops: 0,
          lastCallFrame: -1,
          frame: 0,
        },
        row,
        markdown,
        running: false,
        previous: 0,
        cleanup: () => {},
        start: () => {},
      }
      ;(window as Window & { __timelineStreamBenchmark?: TimelineProbeState }).__timelineStreamBenchmark = state
      const scrollTo = Element.prototype.scrollTo
      const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!
      if (profileVisual) {
        Element.prototype.scrollTo = function (...args) {
          state.scroll.calls += 1
          const top = typeof args[0] === "object" ? args[0]?.top : args[1]
          if (typeof top === "number") {
            const target = Math.min(top, this.scrollHeight - this.clientHeight)
            if (Math.abs(this.scrollTop - target) < 1) state.scroll.callNoops += 1
          }
          if (state.scroll.lastCallFrame === state.scroll.frame) state.scroll.sameFrameCalls += 1
          state.scroll.lastCallFrame = state.scroll.frame
          return scrollTo.apply(this, args)
        }
        Object.defineProperty(Element.prototype, "scrollTop", {
          configurable: true,
          get: scrollTop.get,
          set(value) {
            state.scroll.assignments += 1
            if (Math.abs(this.scrollTop - value) < 1) state.scroll.assignmentNoops += 1
            scrollTop.set!.call(this, value)
          },
        })
      }

      const recordLongTasks = (entries: PerformanceEntry[]) => {
        if (!state.running) return
        state.longTasks.push(
          ...entries
            .filter((entry) => entry.startTime >= state.started && entry.startTime <= state.ended)
            .map((entry) => entry.duration),
        )
      }
      const longTaskObserver = new PerformanceObserver((list) => recordLongTasks(list.getEntries()))
      longTaskObserver.observe({ type: "longtask" })
      const recordLayoutShifts = (entries: PerformanceEntry[]) => {
        if (!state.running) return
        state.layoutShifts.push(
          ...entries
            .map((entry) => {
              const shift = entry as LayoutShiftEntry
              if (shift.startTime < state.started || shift.hadRecentInput) return
              return shift.value
            })
            .filter((value): value is number => value !== undefined),
        )
      }
      const layoutShiftObserver = profileVisual
        ? new PerformanceObserver((list) => recordLayoutShifts(list.getEntries()))
        : undefined
      layoutShiftObserver?.observe({ type: "layout-shift", buffered: true })

      const visible = (element: Element) => {
        const rect = element.getBoundingClientRect()
        const viewport = root.getBoundingClientRect()
        const style = getComputedStyle(element)
        return (
          element.isConnected &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > viewport.top &&
          rect.top < viewport.bottom &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0
        )
      }
      const critical = [
        "[data-timeline-part-id]",
        '[data-component="edit-content"]',
        '[data-component="apply-patch-file-diff"]',
        '[data-component="file"]',
        '[data-component="markdown-code"]',
        "[data-markdown-block]",
      ].join(",")
      const describe = (element: Element) => {
        const cached = state.subtreeKeys.get(element)
        if (!element.isConnected && cached) return cached
        const part = element.closest<HTMLElement>("[data-timeline-part-id]")?.dataset.timelinePartId ?? "unknown"
        const block = element
          .closest<HTMLElement>("[data-markdown-key]")
          ?.dataset.markdownKey?.replace(/:(?:code|full|live)$/, "")
        const component =
          element.getAttribute("data-component") ?? element.getAttribute("data-markdown-block") ?? element.tagName
        const key = `${part}:${block ?? "root"}:${component}`
        state.subtreeKeys.set(element, key)
        return key
      }
      const recordMutations = (records: MutationRecord[]) => {
        if (!state.running) return
        records.forEach((record) => {
          record.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement && node.matches("[data-timeline-key]") && visible(node)) {
              state.visibleMounts += 1
              state.visibleRows.add(node)
            }
            if (!(node instanceof Element)) return
            const added = [node, ...node.querySelectorAll(critical)].filter((element) => element.matches(critical))
            added.forEach((element) => {
              if (visible(element)) state.visibleSubtreeMounts.push(describe(element))
            })
          })
          record.removedNodes.forEach((node) => {
            if (node instanceof HTMLElement && node.matches("[data-timeline-key]") && state.visibleRows.delete(node))
              state.visibleUnmounts += 1
            if (!(node instanceof Element)) return
            const removed = [node, ...node.querySelectorAll(critical)].filter((element) => element.matches(critical))
            removed.forEach((element) => {
              const key = describe(element)
              if (state.visibleSubtrees.get(key) === element) state.visibleSubtreeUnmounts.push(key)
            })
          })
        })
      }
      const mutationObserver = profileVisual ? new MutationObserver(recordMutations) : undefined
      mutationObserver?.observe(root, { childList: true, subtree: true })
      const currentPart = () => root.querySelector<HTMLElement>(`[data-timeline-part-id="${textPartID}"]`)
      const observeProgress = (at: number) => {
        if (!state.running) return
        const content = currentPart()?.textContent ?? ""
        const index = content.includes("benchmark-complete")
          ? finalIndex
          : Number(content.match(new RegExp(markerPattern, "g"))?.at(-1)?.match(/\d+/)?.[0] ?? -1)
        if (index >= 0 && index !== state.applied.at(-1)?.index) state.applied.push({ at, index })
      }
      const progressObserver = new MutationObserver(() => observeProgress(performance.now()))
      progressObserver.observe(root, { characterData: true, childList: true, subtree: true })
      state.cleanup = () => {
        recordLongTasks(longTaskObserver.takeRecords())
        recordLayoutShifts(layoutShiftObserver?.takeRecords() ?? [])
        recordMutations(mutationObserver?.takeRecords() ?? [])
        if (progressObserver.takeRecords().length) observeProgress(performance.now())
        longTaskObserver.disconnect()
        layoutShiftObserver?.disconnect()
        mutationObserver?.disconnect()
        progressObserver.disconnect()
        if (!profileVisual) return
        Element.prototype.scrollTo = scrollTo
        Object.defineProperty(Element.prototype, "scrollTop", scrollTop)
      }

      const sample = (now: number) => {
        if (!state.running) return
        state.frameAt.push(now)
        observeProgress(now)
        if (minimal) {
          state.frames.push(now - state.previous)
          state.previous = now
          requestAnimationFrame(sample)
          return
        }
        setTimeout(() => {
          if (!state.running) return
          state.scroll.frame += 1
          const duration = now - state.previous
          state.frames.push(duration)
          state.previous = now
          const virtualRoot = root.querySelector<HTMLElement>("[data-timeline-virtual-content]")
          const header = root.querySelector<HTMLElement>("[data-session-title]")
          state.geometry.push({
            scrollTop: root.scrollTop,
            scrollHeight: root.scrollHeight,
            clientHeight: root.clientHeight,
            distance: root.scrollHeight - root.clientHeight - root.scrollTop,
            virtualHeight: virtualRoot?.getBoundingClientRect().height ?? 0,
            headerHeight: header?.getBoundingClientRect().height ?? 0,
          })
          const viewport = root.getBoundingClientRect()
          if (profileVisual) {
            const visibleRows = [...root.querySelectorAll<HTMLElement>("[data-timeline-key]")]
              .map((element) => ({ element, rect: element.getBoundingClientRect() }))
              .filter((item) => item.rect.bottom > viewport.top && item.rect.top < viewport.bottom)
              .sort((a, b) => a.rect.top - b.rect.top)
            state.visibleRows = new Set(visibleRows.map((item) => item.element))
            const rows = visibleRows.map((item) => item.rect)
            rows.slice(1).forEach((rect, index) => {
              const previous = rows[index]!
              state.maxOverlap = Math.max(state.maxOverlap, previous.bottom - rect.top)
              state.maxGap = Math.max(state.maxGap, rect.top - previous.bottom)
            })
            const partTop = part.getBoundingClientRect().top
            state.maxPartTopMovement = Math.max(state.maxPartTopMovement, Math.abs(partTop - state.previousPartTop))
            state.previousPartTop = partTop
          }
          const visibleRow = [...root.querySelectorAll<HTMLElement>("[data-timeline-row]")].some((element) => {
            const rect = element.getBoundingClientRect()
            return rect.bottom > viewport.top && rect.top < viewport.bottom
          })
          if (!visibleRow) state.blanks += 1
          if (profileVisual) {
            const subtrees = new Map<string, { element: Element; rendered: boolean }>()
            const visibleSubtrees = new Map<string, Element>()
            root.querySelectorAll(critical).forEach((element) => {
              const key = describe(element)
              const rect = element.getBoundingClientRect()
              const style = getComputedStyle(element)
              const rendered =
                element.isConnected &&
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                Number(style.opacity) > 0
              subtrees.set(key, { element, rendered })
              if (rendered && rect.bottom > viewport.top && rect.top < viewport.bottom) {
                const previous = state.visibleSubtrees.get(key)
                if (previous && previous !== element && key.startsWith(`${textPartID}:`))
                  state.visibleSubtreeReplacements += 1
                visibleSubtrees.set(key, element)
              }
            })
            state.visibleSubtrees.forEach((element, key) => {
              const current = subtrees.get(key)
              if (key.startsWith(`${textPartID}:`) && !current?.rendered) {
                const markdown = part.querySelector<HTMLElement>('[data-component="markdown"]')
                state.visibleSubtreeDropouts.push(
                  `${key}:projection=${markdown?.dataset.markdownProjectionLength}/${markdown?.dataset.markdownProjectionBlocks}:result=${markdown?.dataset.markdownResultLength}/${markdown?.dataset.markdownResultBlocks}:applied=${markdown?.dataset.markdownAppliedBlocks}:dom=${markdown?.children.length}`,
                )
              }
              if (element.matches('[data-component="file"]')) {
                const hadLines = element.hasAttribute("data-profiler-had-lines")
                const hasLines = element.shadowRoot?.querySelector("[data-line]") != null
                if (hasLines) element.setAttribute("data-profiler-had-lines", "")
                if (hadLines && !hasLines) state.visibleSubtreeDropouts.push(`${key}:shadow-lines`)
              }
            })
            state.visibleSubtrees = visibleSubtrees
          }
          if (profileVisual && duration > 33.34) {
            const livePart = currentPart()
            const content = livePart?.textContent ?? ""
            const complete = content.includes("benchmark-complete")
            const index = complete
              ? finalIndex
              : Number(content.match(new RegExp(markerPattern, "g"))?.at(-1)?.match(/\d+/)?.[0] ?? -1)
            state.slowFrames.push({
              duration,
              index,
              phase: complete
                ? "complete"
                : index >= 0 && index % fragmentCount === 0
                  ? "boundary"
                  : index >= 0
                    ? "stream"
                    : "unknown",
              tokenSpans: livePart?.querySelectorAll(".shiki span").length ?? 0,
              blocks: livePart?.querySelectorAll("[data-markdown-block]").length ?? 0,
              codeBlocks: livePart?.querySelectorAll('[data-component="markdown-code"]').length ?? 0,
              height: livePart?.getBoundingClientRect().height ?? 0,
              distance: root.scrollHeight - root.clientHeight - root.scrollTop,
            })
          }
          requestAnimationFrame(sample)
        }, 0)
      }
      state.start = () => {
        state.started = performance.now()
        state.previous = state.started
        state.running = true
        requestAnimationFrame(sample)
      }
    },
    { ...options, markerPattern: STREAM_MARKER_PATTERN, fragmentCount: STREAM_FRAGMENT_COUNT },
  )
}

export function startTimelineStreamProbe(page: Page) {
  return page.evaluate(() => {
    const state = (window as Window & { __timelineStreamBenchmark?: TimelineProbeState }).__timelineStreamBenchmark
    if (!state) throw new Error("missing streaming benchmark state")
    state.start()
  })
}

type LayoutShiftEntry = PerformanceEntry & { value: number; hadRecentInput?: boolean }

export function layoutShiftValue(
  entry: Pick<LayoutShiftEntry, "startTime" | "value" | "hadRecentInput">,
  start: number,
) {
  if (entry.startTime < start || entry.hadRecentInput) return
  return entry.value
}

export function removeVisibleRow<T>(visible: Set<T>, row: T) {
  return visible.delete(row)
}

export function streamProgress(content: string) {
  const index = Number(content.match(new RegExp(STREAM_MARKER_PATTERN, "g"))?.at(-1)?.match(/\d+/)?.[0] ?? -1)
  return {
    index,
    phase: content.includes("benchmark-complete")
      ? ("complete" as const)
      : index >= 0 && index % STREAM_FRAGMENT_COUNT === 0
        ? ("boundary" as const)
        : index >= 0
          ? ("stream" as const)
          : ("unknown" as const),
  }
}

export async function collectTimelineStreamMetrics(
  page: Page,
  options: { textPartID: string; finalIndex: number; navigations: string[] },
) {
  return page.evaluate(({ textPartID, finalIndex, navigations }) => {
    const state = (window as Window & { __timelineStreamBenchmark?: TimelineProbeState }).__timelineStreamBenchmark
    if (!state) throw new Error(`missing streaming benchmark state after navigation: ${JSON.stringify(navigations)}`)
    state.ended = performance.now()
    state.cleanup()
    state.running = false
    const part = document.querySelector<HTMLElement>(`[data-timeline-part-id="${textPartID}"]`)
    const row = part?.closest<HTMLElement>("[data-timeline-row]")
    const markdown = part?.querySelector<HTMLElement>('[data-component="markdown"]')
    const sorted = state.frames.slice().sort((a, b) => a - b)
    const duration = state.frames.reduce((sum, value) => sum + value, 0)
    const longestSlowStreak = state.frames.reduce(
      (result, value) => {
        const current = value > 33.34 ? result.current + 1 : 0
        return { current, longest: Math.max(result.longest, current) }
      },
      { current: 0, longest: 0 },
    ).longest
    const busyStart = state.applied.at(0)?.at
    const completion = state.applied.find((value) => value.index === finalIndex)
    const busyEnd = completion?.at
    const busyFrames =
      busyStart === undefined || busyEnd === undefined
        ? []
        : state.frames.filter((_, index) => state.frameAt[index]! >= busyStart && state.frameAt[index]! <= busyEnd)
    const busySorted = busyFrames.slice().sort((a, b) => a - b)
    const busyDuration = busyFrames.reduce((sum, value) => sum + value, 0)
    const completionObservedMs = (completion?.at ?? NaN) - state.started
    const visual = state.profileVisual
      ? {
          layoutShiftValueSum: state.layoutShifts.reduce((sum, value) => sum + value, 0),
          maxLayoutShiftValue: Math.max(0, ...state.layoutShifts),
          visibleMounts: state.visibleMounts,
          visibleUnmounts: state.visibleUnmounts,
          visibleSubtreeMounts: state.visibleSubtreeMounts,
          visibleSubtreeUnmounts: [...new Set(state.visibleSubtreeUnmounts)],
          visibleSubtreeReplacements: state.visibleSubtreeReplacements,
          visibleSubtreeDropouts: [...new Set(state.visibleSubtreeDropouts)],
          maxOverlapPx: state.maxOverlap,
          maxGapPx: state.maxGap,
          maxPartTopMovementPx: state.maxPartTopMovement,
          slowestRafGaps: state.slowFrames
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 20)
            .map((frame) => ({
              durationMs: frame.duration,
              index: frame.index,
              phase: frame.phase,
              tokenSpans: frame.tokenSpans,
              blocks: frame.blocks,
              codeBlocks: frame.codeBlocks,
              heightPx: frame.height,
              distancePx: frame.distance,
            })),
          slowRafGapPhases: Object.fromEntries(
            ["stream", "boundary", "complete", "unknown"].map((phase) => {
              const frames = state.slowFrames.filter((frame) => frame.phase === phase)
              return [
                phase,
                {
                  count: frames.length,
                  totalMs: frames.reduce((sum, frame) => sum + frame.duration, 0),
                  maxMs: Math.max(0, ...frames.map((frame) => frame.duration)),
                },
              ]
            }),
          ),
          scroll: state.scroll,
        }
      : null
    const geometry = state.minimal
      ? null
      : {
          maxDistancePx: Math.max(0, ...state.geometry.map((sample) => sample.distance)),
          finalDistancePx: state.geometry.at(-1)?.distance ?? 0,
          final: state.geometry.at(-1),
          distanceTransitionsPx: state.geometry
            .map((sample) => Math.round(sample.distance))
            .filter((value, index, values) => index === 0 || value !== values[index - 1]),
          bottomDriftTransitions: state.geometry.slice(1).filter((value, index) => {
            const previous = state.geometry[index]?.distance ?? 0
            return previous <= 1 && value.distance > 1
          }).length,
          blankSamples: state.blanks,
        }
    return {
      capabilities: { visual: state.profileVisual, geometry: !state.minimal },
      completionObservedMs,
      deltasPerSecond: Number.isFinite(completionObservedMs) ? finalIndex / (completionObservedMs / 1_000) : null,
      rafGapSamples: state.frames.length,
      rafCallbackRate: duration ? (state.frames.length * 1000) / duration : 0,
      observedProgressWindowRafCallbackRate: busyDuration ? (busyFrames.length * 1000) / busyDuration : null,
      observedProgressWindowRafGapP95Ms: busySorted[Math.floor(busySorted.length * 0.95)] ?? null,
      observedProgressWindowRafGaps: busyFrames.length,
      maxObservedProgressIndex: Math.max(-1, ...state.applied.map((value) => value.index)),
      observedProgressTransitions: state.applied.length,
      rafGapP50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      rafGapP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      rafGapP99Ms: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
      maxRafGapMs: sorted.at(-1) ?? 0,
      rafGapsOver33Ms: state.frames.filter((value) => value > 33.34).length,
      rafGapsOver50Ms: state.frames.filter((value) => value > 50).length,
      missedFrameBudgetEquivalents: state.frames.reduce(
        (sum, value) => sum + Math.max(0, Math.round(value / 16.67) - 1),
        0,
      ),
      longestRafGapOver33MsStreak: longestSlowStreak,
      longTaskCount: state.longTasks.length,
      longTaskTimeMs: state.longTasks.reduce((sum, value) => sum + value, 0),
      visual,
      geometry,
      rowReplaced: row !== state.row,
      markdownReplaced: markdown !== state.markdown,
      domTextCharacters: part?.textContent?.length ?? 0,
    }
  }, options)
}
