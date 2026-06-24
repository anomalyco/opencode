import type { Page } from "@playwright/test"
import { summarizeFirstNavigation, type FirstNavigationSample } from "./first-navigation-metrics"

type FirstNavigationProbe = {
  samples: FirstNavigationSample[]
  stop: () => void
}

export async function measureFirstNavigation(
  page: Page,
  input: {
    href: string
    destinationPath: string
    sourceSelector: string
    destinationSelector: string
    contentSelector: string
    navigate: () => Promise<void>
  },
) {
  await page.evaluate(
    ({ href, destinationPath, sourceSelector, destinationSelector, contentSelector }) => {
      const samples: FirstNavigationSample[] = []
      let started: number | undefined
      let running = true
      const visible = (selector: string) =>
        [...document.querySelectorAll<HTMLElement>(selector)].some((element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
        })
      const sample = () => {
        if (!running || started === undefined) return
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (!running || started === undefined) return
            samples.push({
              observedAtMs: performance.now() - started,
              source: visible(sourceSelector),
              destination: `${location.pathname}${location.search}` === destinationPath && visible(destinationSelector),
              content: visible(contentSelector),
              pathname: `${location.pathname}${location.search}`,
              center: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.textContent?.slice(0, 80),
            })
            sample()
          }, 0)
        })
      }
      document.addEventListener(
        "click",
        (event) => {
          const link = event.target instanceof Element ? event.target.closest("a") : undefined
          if (link?.getAttribute("href") !== href) return
          started = performance.now()
          sample()
        },
        { capture: true, once: true },
      )
      ;(window as Window & { __firstNavigationProbe?: FirstNavigationProbe }).__firstNavigationProbe = {
        samples,
        stop: () => {
          running = false
        },
      }
    },
    {
      href: input.href,
      destinationPath: input.destinationPath,
      sourceSelector: input.sourceSelector,
      destinationSelector: input.destinationSelector,
      contentSelector: input.contentSelector,
    },
  )
  await input.navigate()
  await page.waitForFunction(() => {
    const samples = (window as Window & { __firstNavigationProbe?: FirstNavigationProbe }).__firstNavigationProbe
      ?.samples
    if (!samples) return false
    return samples.length >= 3 && samples.slice(-3).every((sample) => sample.destination && !sample.source)
  })
  const samples = await page.evaluate(() => {
    const probe = (window as Window & { __firstNavigationProbe?: FirstNavigationProbe }).__firstNavigationProbe!
    probe.stop()
    return probe.samples
  })
  return { summary: summarizeFirstNavigation(samples), samples }
}
