import type { Page } from "@playwright/test"

export type TimelineSearchSample = {
  observedAtMs: number
  counter: string
  targetMounted: boolean
  targetVisible: boolean
  targetTopPx?: number
  activeRanges: number
  activePartID?: string
  activeVisible: boolean
  scrollTopPx: number
}

type TimelineSearchProbe = {
  samples: TimelineSearchSample[]
  handlerDurationMs?: number
  initialScrollTopPx: number
  stop: () => void
}

export async function installTimelineSearchProbe(page: Page, input: { targetPartID: string }) {
  await page.evaluate(({ targetPartID }) => {
    const search = document.querySelector<HTMLElement>('[data-component="timeline-search-bar"]')
    const field = search?.querySelector<HTMLInputElement>('[data-slot="text-input-v2-input"]')
    const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
      element.querySelector("[data-timeline-row]"),
    )
    if (!search || !field || !root) throw new Error("missing timeline search benchmark nodes")

    const samples: TimelineSearchSample[] = []
    const initialScrollTopPx = root.scrollTop
    let startedAt: number | undefined
    let handlerDurationMs: number | undefined
    let frame: number | undefined
    let running = true

    const visibleInRoot = (rect: DOMRect) => {
      const viewport = root.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom
    }
    const sample = () => {
      if (!running || startedAt === undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        setTimeout(() => {
          if (!running || startedAt === undefined) return
          const target = root.querySelector<HTMLElement>(`[data-timeline-part-id="${targetPartID}"]`)
          const targetRect = target?.getBoundingClientRect()
          const highlight = CSS.highlights.get("timeline-search-hit-active")
          const ranges = highlight ? [...highlight] : []
          const active = ranges.find((range): range is Range => range instanceof Range)
          const activeRect = active?.getBoundingClientRect()
          const activeElement =
            active?.startContainer instanceof Element ? active.startContainer : active?.startContainer.parentElement

          samples.push({
            observedAtMs: performance.now() - startedAt,
            counter:
              search.querySelector<HTMLElement>('[data-slot="timeline-search-count"]')?.textContent?.trim() ?? "",
            targetMounted: !!target,
            targetVisible: !!targetRect && visibleInRoot(targetRect),
            targetTopPx: targetRect?.top,
            activeRanges: ranges.length,
            activePartID: activeElement?.closest<HTMLElement>("[data-timeline-part-id]")?.dataset.timelinePartId,
            activeVisible: !!activeRect && visibleInRoot(activeRect),
            scrollTopPx: root.scrollTop,
          })
          sample()
        }, 0)
      })
    }
    const onInputCapture = (event: Event) => {
      if (event.target !== field || startedAt !== undefined) return
      startedAt = performance.now()
      sample()
    }
    const onInput = (event: Event) => {
      if (event.target !== field || startedAt === undefined || handlerDurationMs !== undefined) return
      handlerDurationMs = performance.now() - startedAt
    }
    document.addEventListener("input", onInputCapture, { capture: true })
    document.addEventListener("input", onInput)
    ;(window as Window & { __timelineSearchBenchmark?: TimelineSearchProbe }).__timelineSearchBenchmark = {
      samples,
      initialScrollTopPx,
      get handlerDurationMs() {
        return handlerDurationMs
      },
      stop: () => {
        running = false
        document.removeEventListener("input", onInputCapture, { capture: true })
        document.removeEventListener("input", onInput)
        if (frame !== undefined) cancelAnimationFrame(frame)
      },
    }
  }, input)
}

export async function waitForStableTimelineSearch(
  page: Page,
  input: { counter: string; targetPartID: string; timeout: number },
) {
  await page.waitForFunction(
    ({ counter, targetPartID }) => {
      const samples = (window as Window & { __timelineSearchBenchmark?: TimelineSearchProbe }).__timelineSearchBenchmark
        ?.samples
      if (!samples) return false
      return samples.some((_, index) => {
        const stable = samples.slice(index, index + 3)
        if (stable.length !== 3) return false
        return stable.every(
          (sample, sampleIndex) =>
            sample.counter === counter &&
            sample.targetVisible &&
            sample.activeRanges === 1 &&
            sample.activePartID === targetPartID &&
            sample.activeVisible &&
            (sampleIndex === 0 ||
              (Math.abs(sample.scrollTopPx - stable[sampleIndex - 1]!.scrollTopPx) <= 1 &&
                Math.abs((sample.targetTopPx ?? Infinity) - (stable[sampleIndex - 1]!.targetTopPx ?? -Infinity)) <= 1)),
        )
      })
    },
    { counter: input.counter, targetPartID: input.targetPartID },
    { timeout: input.timeout },
  )
}

export async function collectTimelineSearchMetrics(page: Page, input: { counter: string; targetPartID: string }) {
  const result = await page.evaluate(() => {
    const probe = (window as Window & { __timelineSearchBenchmark?: TimelineSearchProbe }).__timelineSearchBenchmark
    if (!probe) throw new Error("missing timeline search benchmark probe")
    probe.stop()
    return {
      samples: probe.samples,
      handlerDurationMs: probe.handlerDurationMs,
      initialScrollTopPx: probe.initialScrollTopPx,
    }
  })
  const first = (predicate: (sample: TimelineSearchSample) => boolean) => result.samples.find(predicate)?.observedAtMs
  const stable = result.samples.findIndex((_, index) => {
    const samples = result.samples.slice(index, index + 3)
    if (samples.length !== 3) return false
    return samples.every(
      (sample, sampleIndex) =>
        sample.counter === input.counter &&
        sample.targetVisible &&
        sample.activeRanges === 1 &&
        sample.activePartID === input.targetPartID &&
        sample.activeVisible &&
        (sampleIndex === 0 ||
          (Math.abs(sample.scrollTopPx - samples[sampleIndex - 1]!.scrollTopPx) <= 1 &&
            Math.abs((sample.targetTopPx ?? Infinity) - (samples[sampleIndex - 1]!.targetTopPx ?? -Infinity)) <= 1)),
    )
  })
  const final = result.samples.at(-1)

  return {
    summary: {
      handlerDurationMs: result.handlerDurationMs,
      firstCountObservedMs: first((sample) => sample.counter === input.counter),
      firstTargetMountedMs: first((sample) => sample.targetMounted),
      firstTargetVisibleMs: first((sample) => sample.targetVisible),
      firstActiveHighlightObservedMs: first(
        (sample) => sample.activeRanges === 1 && sample.activePartID === input.targetPartID && sample.activeVisible,
      ),
      stableResultObservedMs: stable >= 0 ? result.samples[stable + 2]?.observedAtMs : undefined,
      initialScrollTopPx: result.initialScrollTopPx,
      finalScrollTopPx: final?.scrollTopPx,
      scrollDistancePx: final === undefined ? undefined : Math.abs(result.initialScrollTopPx - final.scrollTopPx),
      activeHighlightRanges: final?.activeRanges,
    },
    samples: result.samples,
  }
}
