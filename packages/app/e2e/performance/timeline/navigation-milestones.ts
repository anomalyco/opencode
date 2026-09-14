import type { Page } from "@playwright/test"

export type NavigationMilestoneSample = {
  observedAtMs: number
  milestones: Record<string, boolean>
}

export function summarizeNavigationMilestones(samples: NavigationMilestoneSample[]) {
  const names = Object.keys(samples[0]?.milestones ?? {})
  const summarize = (matches: (sample: NavigationMilestoneSample) => boolean) => {
    const first = samples.find(matches)
    const stable = samples.findIndex(
      (sample, index) =>
        index + 2 < samples.length && matches(sample) && matches(samples[index + 1]!) && matches(samples[index + 2]!),
    )
    return {
      firstObservedMs: first?.observedAtMs ?? null,
      stableObservedMs: stable === -1 ? null : samples[stable + 2]!.observedAtMs,
    }
  }
  return {
    samples: samples.length,
    milestones: Object.fromEntries(
      names.map((name) => [name, summarize((sample) => sample.milestones[name] === true)]),
    ),
    all: summarize((sample) => names.every((name) => sample.milestones[name] === true)),
  }
}

type NavigationMilestoneProbe = {
  samples: NavigationMilestoneSample[]
  stop: () => void
}

export async function measureNavigationMilestones(
  page: Page,
  input: {
    triggerSelector: string
    milestones: Record<string, { selector: string; visible?: boolean; text?: string }>
    navigate: () => Promise<void>
  },
) {
  await page.evaluate(
    ({ triggerSelector, milestones }) => {
      const samples: NavigationMilestoneSample[] = []
      const streaks = new Map<string, number>()
      const marked = new Set<string>()
      let started: number | undefined
      let running = true
      const visible = (selector: string, text?: string) =>
        [...document.querySelectorAll<HTMLElement>(selector)].some((element) => {
          if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
          if (text !== undefined && element.textContent?.replace(/\s+/g, " ").trim() !== text) return false
          const rect = element.getBoundingClientRect()
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.top < innerHeight &&
            rect.right > 0 &&
            rect.left < innerWidth
          )
        })
      const sample = () => {
        if (!running || started === undefined) return
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (!running || started === undefined) return
            const current = Object.fromEntries(
              Object.entries(milestones).map(([name, milestone]) => [
                name,
                milestone.visible === false
                  ? !document.querySelector(milestone.selector)
                  : visible(milestone.selector, milestone.text),
              ]),
            )
            samples.push({
              observedAtMs: performance.now() - started,
              milestones: current,
            })
            Object.entries(current).forEach(([name, value]) => {
              if (!value) {
                streaks.set(name, 0)
                return
              }
              if (!marked.has(`${name}.first`)) {
                performance.mark(`opencode.navigation.${name}.first`)
                marked.add(`${name}.first`)
              }
              const streak = (streaks.get(name) ?? 0) + 1
              streaks.set(name, streak)
              if (streak === 3) performance.mark(`opencode.navigation.${name}.stable`)
            })
            const all = Object.values(current).every(Boolean)
            const allStreak = all ? (streaks.get("all") ?? 0) + 1 : 0
            streaks.set("all", allStreak)
            if (all && !marked.has("all.first")) {
              performance.mark("opencode.navigation.all.first")
              marked.add("all.first")
            }
            if (allStreak === 3) performance.mark("opencode.navigation.all.stable")
            sample()
          }, 0)
        })
      }
      const start = (event: MouseEvent) => {
        if (started !== undefined || event.button !== 0) return
        if (!(event.target instanceof Element) || !event.target.closest(triggerSelector)) return
        started = performance.now()
        performance.mark("opencode.navigation.start")
        sample()
      }
      document.addEventListener("mousedown", start, true)
      document.addEventListener("click", start, true)
      ;(window as Window & { __navigationMilestones?: NavigationMilestoneProbe }).__navigationMilestones = {
        samples,
        stop: () => {
          running = false
          document.removeEventListener("mousedown", start, true)
          document.removeEventListener("click", start, true)
        },
      }
    },
    { triggerSelector: input.triggerSelector, milestones: input.milestones },
  )
  try {
    await input.navigate()
    await page.waitForFunction(() => {
      const samples = (window as Window & { __navigationMilestones?: NavigationMilestoneProbe }).__navigationMilestones
        ?.samples
      return (
        samples &&
        samples.length >= 3 &&
        samples.slice(-3).every((sample) => Object.values(sample.milestones).every(Boolean))
      )
    })
    const samples = await page.evaluate(
      () => (window as Window & { __navigationMilestones?: NavigationMilestoneProbe }).__navigationMilestones!.samples,
    )
    return { summary: summarizeNavigationMilestones(samples), samples }
  } finally {
    await page.evaluate(() => {
      const host = window as Window & { __navigationMilestones?: NavigationMilestoneProbe }
      host.__navigationMilestones?.stop()
      delete host.__navigationMilestones
    })
  }
}
