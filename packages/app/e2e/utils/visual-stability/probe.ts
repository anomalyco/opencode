import type { Page } from "@playwright/test"
import { startVisualCapture, stopVisualCapture, type VisualCapture } from "./capture"
import type { VisualMarker, VisualObservation, VisualProbeResult } from "./model"
import type { VisualRegionDefinition } from "./regions"

type ProbeWindow<RegionName extends string = string> = Window & {
  __visualStabilityProbe?: {
    startedAt: number
    markers: VisualMarker[]
    samples: VisualObservation<RegionName>[]
    stop: () => void
  }
}

const captures = new WeakMap<Page, VisualCapture>()

export async function startVisualProbe<Regions extends Record<string, VisualRegionDefinition>>(
  page: Page,
  regions: Regions,
) {
  await stopCapture(page)
  await page.evaluate(() => {
    ;(window as ProbeWindow).__visualStabilityProbe?.stop()
  })
  const startedAtEpoch = await page.evaluate((regions) => {
    const samples: VisualObservation[] = []
    const markers: VisualMarker[] = []
    const startedAt = performance.now()
    const nodes = new WeakMap<Node, number>()
    const lastBounds = new Map<string, { top: number; bottom: number }>()
    let nextNode = 1
    let running = true
    const round = (value: number) => Math.round(value * 10) / 10
    const opacity = (element: Element) => Number(getComputedStyle(element).opacity)
    const sample = () => {
      if (!running) return
      setTimeout(() => {
        if (!running) return
        const viewport = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
          element.querySelector("[data-timeline-row]"),
        )
        const viewportRect = viewport?.getBoundingClientRect()
        samples.push({
          at: performance.now() - startedAt,
          viewport: viewport
            ? {
                top: round(viewportRect!.top),
                bottom: round(viewportRect!.bottom),
                scrollTop: round(viewport.scrollTop),
                scrollHeight: round(viewport.scrollHeight),
                clientHeight: round(viewport.clientHeight),
                distanceFromBottom: round(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop),
              }
            : undefined,
          regions: Object.fromEntries(
            Object.entries(regions).map(([name, config]) => {
              const found = document.querySelector<HTMLElement>(config.selector)
              const count = document.querySelectorAll(config.selector).length
              const element = config.closest ? found?.closest<HTMLElement>(config.closest) : found
              if (!element)
                return [
                  name,
                  {
                    present: false,
                    visible: false,
                    inViewport: false,
                    top: 0,
                    bottom: 0,
                    width: 0,
                    height: 0,
                    opacity: 0,
                    count,
                    node: 0,
                    label: "",
                    text: "",
                  },
                ]
              const rect = element.getBoundingClientRect()
              const style = getComputedStyle(element)
              if (rect.height > 0) lastBounds.set(name, { top: rect.top, bottom: rect.bottom })
              const known = rect.height > 0 ? rect : lastBounds.get(name)
              const painted = (() => {
                const result = { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
                let parent = element.parentElement
                while (parent) {
                  const parentStyle = getComputedStyle(parent)
                  if (["hidden", "clip", "scroll", "auto"].includes(parentStyle.overflowY)) {
                    const parentRect = parent.getBoundingClientRect()
                    result.top = Math.max(result.top, parentRect.top)
                    result.bottom = Math.min(result.bottom, parentRect.bottom)
                  }
                  if (["hidden", "clip", "scroll", "auto"].includes(parentStyle.overflowX)) {
                    const parentRect = parent.getBoundingClientRect()
                    result.left = Math.max(result.left, parentRect.left)
                    result.right = Math.min(result.right, parentRect.right)
                  }
                  if (parent === viewport) break
                  parent = parent.parentElement
                }
                if (viewportRect) {
                  result.top = Math.max(result.top, viewportRect.top)
                  result.bottom = Math.min(result.bottom, viewportRect.bottom)
                  result.left = Math.max(result.left, viewportRect.left)
                  result.right = Math.min(result.right, viewportRect.right)
                }
                return result
              })()
              const contentOpacity = config.opacitySelectors?.length
                ? Math.max(
                    0,
                    ...config.opacitySelectors.flatMap((selector) =>
                      [...element.querySelectorAll(selector)].map((node) => {
                        let value = 1
                        let current: Element | null = node
                        while (current) {
                          value *= opacity(current)
                          if (current === element) break
                          current = current.parentElement
                        }
                        return value
                      }),
                    ),
                  )
                : opacity(element)
              let visibleOpacity = contentOpacity
              let ancestor = element.parentElement
              let ancestorHidden = false
              while (ancestor) {
                const ancestorStyle = getComputedStyle(ancestor)
                visibleOpacity *= Number(ancestorStyle.opacity)
                if (ancestorStyle.display === "none" || ancestorStyle.visibility === "hidden") ancestorHidden = true
                if (ancestor === viewport) break
                ancestor = ancestor.parentElement
              }
              const cssHidden =
                ancestorHidden || style.display === "none" || style.visibility === "hidden" || visibleOpacity === 0
              return [
                name,
                {
                  present: true,
                  visible:
                    style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    visibleOpacity > 0 &&
                    painted.right > painted.left &&
                    painted.bottom > painted.top,
                  inViewport:
                    !viewportRect || (!!known && known.bottom > viewportRect.top && known.top < viewportRect.bottom),
                  cssHidden,
                  top: round(painted.top),
                  bottom: round(painted.bottom),
                  layoutTop: round(rect.top),
                  layoutBottom: round(rect.bottom),
                  width: round(painted.right - painted.left),
                  height: round(painted.bottom - painted.top),
                  opacity: round(visibleOpacity),
                  count,
                  node: (() => {
                    const current = nodes.get(element)
                    if (current) return current
                    nodes.set(element, nextNode)
                    return nextNode++
                  })(),
                  label: element.getAttribute("aria-label") ?? "",
                  text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 500),
                },
              ]
            }),
          ),
        })
        requestAnimationFrame(sample)
      }, 0)
    }
    ;(window as ProbeWindow).__visualStabilityProbe = {
      startedAt,
      markers,
      samples,
      stop: () => {
        running = false
      },
    }
    requestAnimationFrame(sample)
    return new Promise<number>((resolve) => {
      const ready = () => {
        if (samples.length > 0) return resolve(performance.timeOrigin + startedAt)
        requestAnimationFrame(ready)
      }
      ready()
    })
  }, regions)
  const capture = await startVisualCapture(page, startedAtEpoch)
  if (capture) captures.set(page, capture)
}

export async function stopVisualProbe<RegionName extends string = string>(
  page: Page,
): Promise<VisualProbeResult<RegionName>> {
  return page
    .evaluate(() => {
      const probe = (window as ProbeWindow).__visualStabilityProbe
      if (!probe) throw new Error("Visual stability probe is not running")
      probe.stop()
      return { markers: probe.markers, samples: probe.samples }
    })
    .then(
      async (trace) => ({ ...trace, frames: await stopCapture(page) }) as unknown as VisualProbeResult<RegionName>,
      async (error: unknown) => {
        await stopCapture(page)
        throw error
      },
    )
}

export async function markVisualProbe(page: Page, label: string) {
  await page.evaluate((label) => {
    const probe = (window as ProbeWindow).__visualStabilityProbe
    if (!probe) return
    probe.markers.push({ at: performance.now() - probe.startedAt, label })
  }, label)
}

async function stopCapture(page: Page) {
  const capture = captures.get(page)
  if (capture) captures.delete(page)
  return stopVisualCapture(capture)
}
