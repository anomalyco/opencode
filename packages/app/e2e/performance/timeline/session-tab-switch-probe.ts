import { expect, type Page } from "@playwright/test"
import { classifySessionSwitch, isStableDestination, type SessionSwitchSample } from "./session-tab-switch-metrics"

type SessionSwitchProbe = {
  samples: SessionSwitchSample[]
  stop: () => void
}

async function installSessionSwitchProbe(
  page: Page,
  input: { destinationIDs: string[]; sourceIDs: string[]; lastID: string; href: string },
) {
  await page.evaluate(({ destinationIDs, sourceIDs, lastID, href }) => {
    const destination = new Set(destinationIDs)
    const source = new Set(sourceIDs)
    const samples: SessionSwitchSample[] = []
    let started: number | undefined
    let running = true
    const sample = () => {
      if (!running || started === undefined) return
      setTimeout(() => {
        if (!running || started === undefined) return
        const observedAtMs = performance.now() - started
        const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
          element.querySelector("[data-timeline-row]"),
        )
        if (root) {
          const view = root.getBoundingClientRect()
          const visible = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
            .filter((element) => {
              const rect = element.getBoundingClientRect()
              return rect.bottom > view.top && rect.top < view.bottom
            })
            .map((element) => element.dataset.messageId!)
          const hasVisibleRows = [...root.querySelectorAll<HTMLElement>("[data-timeline-key]")].some((element) => {
            const rect = element.getBoundingClientRect()
            return rect.bottom > view.top && rect.top < view.bottom
          })
          const spacer = root.querySelector<HTMLElement>('[data-timeline-row="bottom-spacer"]')?.getBoundingClientRect()
          samples.push({
            observedAtMs,
            destination: visible.filter((id) => destination.has(id)),
            source: visible.filter((id) => source.has(id)),
            hasVisibleRows,
            last: visible.includes(lastID),
            bottomErrorPx: spacer ? spacer.bottom - view.bottom : undefined,
          })
        } else {
          samples.push({ observedAtMs, destination: [], source: [], hasVisibleRows: false, last: false })
        }
        requestAnimationFrame(sample)
      }, 0)
    }
    document.addEventListener(
      "click",
      (event) => {
        const link = event.target instanceof Element ? event.target.closest("a") : undefined
        if (link?.getAttribute("href") !== href) return
        started = performance.now()
        requestAnimationFrame(sample)
      },
      { capture: true, once: true },
    )
    ;(window as Window & { __sessionSwitchProbe?: SessionSwitchProbe }).__sessionSwitchProbe = {
      samples,
      stop: () => {
        running = false
      },
    }
  }, input)
}

async function waitForStableSessionSwitch(page: Page) {
  await page.waitForFunction(() => {
    const samples = (window as Window & { __sessionSwitchProbe?: SessionSwitchProbe }).__sessionSwitchProbe?.samples
    if (!samples) return false
    return samples.some((_, index) => {
      const stable = samples.slice(index, index + 3)
      return (
        stable.length === 3 &&
        stable.every(
          (sample) =>
            sample.destination.length > 0 &&
            sample.source.length === 0 &&
            sample.last &&
            Math.abs(sample.bottomErrorPx ?? Infinity) <= 1,
        )
      )
    })
  })
}

async function collectSessionSwitchResult(page: Page) {
  const samples = await page.evaluate(() => {
    const probe = (window as Window & { __sessionSwitchProbe?: SessionSwitchProbe }).__sessionSwitchProbe!
    probe.stop()
    return probe.samples
  })
  return classifySessionSwitch(samples)
}

export async function measureSessionSwitch(
  page: Page,
  input: { destinationIDs: string[]; sourceIDs: string[]; lastID: string; href: string; switch: () => Promise<void> },
) {
  const { switch: run, ...probe } = input
  await installSessionSwitchProbe(page, probe)
  await run()
  await waitForStableSessionSwitch(page)
  return collectSessionSwitchResult(page)
}

export async function waitForStableTimeline(page: Page, lastID: string) {
  const samples: Pick<SessionSwitchSample, "last" | "bottomErrorPx">[] = []
  await expect
    .poll(
      async () => {
        samples.push(
          await page.evaluate(
            (lastID) =>
              new Promise<Pick<SessionSwitchSample, "last" | "bottomErrorPx">>((resolve) => {
                requestAnimationFrame(() =>
                  setTimeout(() => {
                    const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
                      element.querySelector("[data-timeline-row]"),
                    )
                    if (!root) {
                      resolve({ last: false })
                      return
                    }
                    const view = root.getBoundingClientRect()
                    const last = [...root.querySelectorAll<HTMLElement>("[data-message-id]")].some((element) => {
                      if (element.dataset.messageId !== lastID) return false
                      const rect = element.getBoundingClientRect()
                      return rect.bottom > view.top && rect.top < view.bottom
                    })
                    const spacer = root
                      .querySelector<HTMLElement>('[data-timeline-row="bottom-spacer"]')
                      ?.getBoundingClientRect()
                    resolve({ last, bottomErrorPx: spacer ? spacer.bottom - view.bottom : undefined })
                  }, 0),
                )
              }),
            lastID,
          ),
        )
        return isStableDestination(samples.slice(-3))
      },
      { timeout: 30_000, intervals: [0] },
    )
    .toBe(true)
}
