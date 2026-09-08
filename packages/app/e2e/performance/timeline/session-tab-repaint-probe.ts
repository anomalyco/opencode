import type { Page } from "@playwright/test"

type CachedRepaintTrace = {
  timeOriginEpochMs: number
  startedAtPerformanceMs: number
  samples: {
    observedAtMs: number
    root: number | undefined
    scrollTop: number
    scrollHeight: number
    bottomErrorPx: number | undefined
    last: boolean
    rows: { key: string | undefined; node: number; top: number; bottom: number }[]
    mounted: number
    center: string | undefined
    destination: string[]
    source: string[]
  }[]
  mutations: { observedAtMs: number; changed: { type: string; node: number }[] }[]
  shifts: { occurredAtMs: number; value: number }[]
  windowMs: number
  running: boolean
  stop: () => void
}

export async function installCachedRepaintProbe(
  page: Page,
  input: { targetHref: string; destination: string[]; source: string[]; last: string; windowMs: number },
) {
  await page.evaluate(({ targetHref, destination, source, last, windowMs }) => {
    const destinationIDs = new Set(destination)
    const sourceIDs = new Set(source)
    const nodeIDs = new WeakMap<Node, number>()
    let nextNodeID = 1
    const id = (node: Node) => {
      const current = nodeIDs.get(node)
      if (current) return current
      nodeIDs.set(node, nextNodeID)
      return nextNodeID++
    }
    const state: CachedRepaintTrace = {
      timeOriginEpochMs: performance.timeOrigin,
      startedAtPerformanceMs: 0,
      samples: [],
      mutations: [],
      shifts: [],
      windowMs,
      running: false,
      stop: () => {},
    }
    const recordShifts = (entries: PerformanceEntry[]) => {
      if (!state.running) return
      state.shifts.push(
        ...entries
          .map((entry) => {
            if (
              entry.startTime < state.startedAtPerformanceMs ||
              entry.startTime > state.startedAtPerformanceMs + state.windowMs
            )
              return
            return {
              occurredAtMs: entry.startTime - state.startedAtPerformanceMs,
              value: (entry as PerformanceEntry & { value: number }).value,
            }
          })
          .filter((entry): entry is { occurredAtMs: number; value: number } => entry !== undefined),
      )
    }
    const shiftObserver = new PerformanceObserver((entries) => recordShifts(entries.getEntries()))
    shiftObserver.observe({ type: "layout-shift" })
    const recordMutations = (entries: MutationRecord[]) => {
      if (!state.running) return
      const observedAtMs = performance.now() - state.startedAtPerformanceMs
      if (observedAtMs > state.windowMs) return
      const changed = entries.flatMap((entry) => [
        ...[...entry.addedNodes].map((node) => ({ type: "add", node: id(node) })),
        ...[...entry.removedNodes].map((node) => ({ type: "remove", node: id(node) })),
      ])
      if (changed.length) state.mutations.push({ observedAtMs, changed })
    }
    const mutationObserver = new MutationObserver(recordMutations)
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true })
    state.stop = () => {
      recordShifts(shiftObserver.takeRecords())
      recordMutations(mutationObserver.takeRecords())
      state.running = false
      shiftObserver.disconnect()
      mutationObserver.disconnect()
    }
    const sample = () => {
      if (!state.running) return
      setTimeout(() => {
        if (!state.running) return
        const observedAtMs = performance.now() - state.startedAtPerformanceMs
        if (observedAtMs > state.windowMs) return
        const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
          element.querySelector("[data-timeline-row]"),
        )
        if (root) {
          const view = root.getBoundingClientRect()
          const rows = [...root.querySelectorAll<HTMLElement>("[data-timeline-key]")]
            .map((element) => ({
              key: element.dataset.timelineKey,
              node: id(element),
              rect: element.getBoundingClientRect(),
            }))
            .filter((item) => item.rect.bottom > view.top && item.rect.top < view.bottom)
            .map((item) => ({
              key: item.key,
              node: item.node,
              top: item.rect.top - view.top,
              bottom: item.rect.bottom - view.top,
            }))
          const messages = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
            .filter((element) => {
              const rect = element.getBoundingClientRect()
              return rect.bottom > view.top && rect.top < view.bottom
            })
            .map((element) => element.dataset.messageId!)
          const spacer = root.querySelector<HTMLElement>('[data-timeline-row="bottom-spacer"]')?.getBoundingClientRect()
          state.samples.push({
            observedAtMs,
            root: id(root),
            scrollTop: root.scrollTop,
            scrollHeight: root.scrollHeight,
            bottomErrorPx: spacer ? spacer.bottom - view.bottom : undefined,
            last: messages.includes(last),
            rows,
            mounted: root.querySelectorAll("[data-timeline-key]").length,
            center: document
              .elementFromPoint(view.left + view.width / 2, view.top + view.height / 2)
              ?.textContent?.slice(0, 80),
            destination: messages.filter((messageID) => destinationIDs.has(messageID)),
            source: messages.filter((messageID) => sourceIDs.has(messageID)),
          })
        } else {
          state.samples.push({
            observedAtMs,
            root: undefined,
            scrollTop: 0,
            scrollHeight: 0,
            bottomErrorPx: undefined,
            last: false,
            rows: [],
            mounted: 0,
            center: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.textContent?.slice(0, 80),
            destination: [],
            source: [],
          })
        }
        requestAnimationFrame(sample)
      }, 0)
    }
    document.addEventListener(
      "click",
      (event) => {
        const link = event.target instanceof Element ? event.target.closest("a") : undefined
        if (link?.getAttribute("href") !== targetHref) return
        state.startedAtPerformanceMs = performance.now()
        state.running = true
        requestAnimationFrame(sample)
      },
      { capture: true, once: true },
    )
    ;(window as Window & { __cachedFlash?: CachedRepaintTrace }).__cachedFlash = state
  }, input)
}

export function layoutShiftSample(entry: Pick<PerformanceEntry, "startTime"> & { value: number }, started: number) {
  if (entry.startTime < started) return
  return { occurredAtMs: entry.startTime - started, value: entry.value }
}

export async function waitForCachedRepaintWindow(page: Page, durationMs: number) {
  await page.waitForFunction((durationMs) => {
    const state = (window as Window & { __cachedFlash?: CachedRepaintTrace }).__cachedFlash
    return !!state?.running && performance.now() - state.startedAtPerformanceMs >= durationMs
  }, durationMs)
}

export async function collectCachedRepaintTrace(page: Page) {
  return page.evaluate(() => {
    const state = (window as Window & { __cachedFlash?: CachedRepaintTrace }).__cachedFlash!
    state.stop()
    return state
  })
}

export function summarizeCachedRepaintTrace(trace: CachedRepaintTrace) {
  const roots = trace.samples.map((sample) => sample.root)
  const bottomErrors = trace.samples.flatMap((sample) =>
    sample.bottomErrorPx === undefined ? [] : [Math.abs(sample.bottomErrorPx)],
  )
  const category = (sample: CachedRepaintTrace["samples"][number]) => {
    if (sample.source.length) return "source"
    if (sample.root === undefined || sample.rows.length === 0) return "blank"
    if (!sample.destination.length) return "unknown"
    if (sample.last && Math.abs(sample.bottomErrorPx ?? Infinity) <= 1) return "correct"
    return "wrongDestination"
  }
  return {
    samples: trace.samples.length,
    durationMs: trace.samples.at(-1)?.observedAtMs ?? 0,
    firstSampleObservedMs: trace.samples[0]?.observedAtMs,
    firstSampleCorrect: trace.samples[0] ? category(trace.samples[0]) === "correct" : false,
    blankSamples: trace.samples.filter((sample) => category(sample) === "blank").length,
    sourceSamples: trace.samples.filter((sample) => category(sample) === "source").length,
    wrongDestinationSamples: trace.samples.filter((sample) => category(sample) === "wrongDestination").length,
    unknownSamples: trace.samples.filter((sample) => category(sample) === "unknown").length,
    rootChanges: roots.slice(1).filter((root, index) => root !== roots[index]).length,
    mountedMin: trace.samples.length ? Math.min(...trace.samples.map((sample) => sample.mounted)) : 0,
    mountedMax: Math.max(...trace.samples.map((sample) => sample.mounted)),
    maxBottomErrorPx: Math.max(0, ...bottomErrors),
    mutationBatches: trace.mutations.length,
    addedNodes: trace.mutations.reduce(
      (sum, batch) => sum + batch.changed.filter((change) => change.type === "add").length,
      0,
    ),
    removedNodes: trace.mutations.reduce(
      (sum, batch) => sum + batch.changed.filter((change) => change.type === "remove").length,
      0,
    ),
    layoutShiftValueSum: trace.shifts.reduce((sum, shift) => sum + shift.value, 0),
    maxLayoutShiftValue: Math.max(0, ...trace.shifts.map((shift) => shift.value)),
  }
}

export function compressCachedRepaintTrace(trace: CachedRepaintTrace) {
  const samples: {
    observedAtMs: number[]
    state: Omit<CachedRepaintTrace["samples"][number], "observedAtMs">
  }[] = []
  for (const sample of trace.samples) {
    const { observedAtMs, ...state } = sample
    const previous = samples.at(-1)
    if (previous && JSON.stringify(previous.state) === JSON.stringify(state)) {
      previous.observedAtMs.push(observedAtMs)
      continue
    }
    samples.push({ observedAtMs: [observedAtMs], state })
  }
  return {
    timeOriginEpochMs: trace.timeOriginEpochMs,
    startedAtPerformanceMs: trace.startedAtPerformanceMs,
    windowMs: trace.windowMs,
    summary: summarizeCachedRepaintTrace(trace),
    samples,
    mutations: trace.mutations,
    shifts: trace.shifts,
  }
}
