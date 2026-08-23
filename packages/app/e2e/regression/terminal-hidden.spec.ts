import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/HiddenTerminalRegression"
const projectID = "proj_hidden_terminal_regression"
const sessionID = "ses_hidden_terminal_regression"
const title = "Hidden terminal regression"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test("animates review and terminal panels while caching hidden terminal content", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "hidden-terminal-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "hidden-terminal-regression",
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    vcsDiff: [
      {
        file: "src/animation.ts",
        additions: 1,
        deletions: 1,
        status: "modified",
        patch:
          "diff --git a/src/animation.ts b/src/animation.ts\n--- a/src/animation.ts\n+++ b/src/animation.ts\n@@ -1 +1 @@\n-export const value = 'before'\n+export const value = 'after'\n",
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/api/pty*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: { directory, project: { id: projectID, directory } },
        data: {
          id: "pty_hidden_terminal",
          title: "Terminal 1",
          command: "cmd.exe",
          args: [],
          cwd: directory,
          status: "running",
          pid: 1,
        },
      }),
    }),
  )
  await page.route("**/api/pty/pty_hidden_terminal*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: { directory, project: { id: projectID, directory } },
        data: {
          id: "pty_hidden_terminal",
          title: "Terminal 1",
          command: "cmd.exe",
          args: [],
          cwd: directory,
          status: "running",
          pid: 1,
        },
      }),
    }),
  )
  await page.route("**/api/pty/pty_hidden_terminal/connect-token*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: { directory, project: { id: projectID, directory } },
        data: { ticket: "e2e-ticket", expires_in: 60 },
      }),
    }),
  )
  await page.routeWebSocket("**/api/pty/pty_hidden_terminal/connect", () => undefined)

  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await installMotionProbe(page)

  const reviewToggle = page.getByRole("button", { name: "Toggle review" })
  await reviewToggle.click()
  await expect(page.locator("#review-panel")).toBeVisible()
  await expectWidthMotions(page, 1)
  await expectReviewWidthStable(page)
  await expectLogicalSideAlignment(page, "ltr")
  await page.evaluate(() => (document.documentElement.dir = "rtl"))
  await expectLogicalSideAlignment(page, "rtl")
  await page.evaluate(() => (document.documentElement.dir = "ltr"))

  const panel = page.locator("#terminal-panel")
  const terminalContent = page.locator('[data-component="terminal"]')
  await page.keyboard.press("Control+Backquote")
  await expect(panel).toBeVisible()
  await expect(terminalContent).toBeVisible()
  await terminalContent.evaluate((element) => element.setAttribute("data-cache-probe", "original"))
  await expectHeightMotions(page, "session-side-region", 1)
  await expectHeightMotions(page, "session-side-terminal-region", 1)
  await expectStackedGeometry(page)
  await expectPanelGapHeld(page)

  await resetTerminalTopMotion(page)
  await resetTerminalBottomMotion(page)
  await resetTerminalAnchorGaps(page)
  await resetPanelGaps(page)
  await reviewToggle.click()
  await expect(page.locator("#review-panel")).toHaveCount(0)
  await expect(panel).toBeVisible()
  await expectHeightMotions(page, "session-side-region", 2)
  await expectHeightMotions(page, "session-side-terminal-region", 2)
  await expectTerminalTopMotion(page)
  await expectTerminalBottomFixed(page)
  await expectTerminalTopAnchored(page)
  await expectPanelGapHeld(page)
  await reviewToggle.click()
  await expect(page.locator("#review-panel")).toBeVisible()
  await expectHeightMotions(page, "session-side-region", 3)
  await expectHeightMotions(page, "session-side-terminal-region", 3)

  await resetTerminalContentSizes(page)
  await resetPanelGaps(page)
  await page.keyboard.press("Control+Backquote")
  await expect(page.locator('[data-slot="side-terminal-panel-clip"]')).toHaveCSS("overflow", "clip")
  await expectHeightMotions(page, "session-side-region", 4)
  await expectHeightMotions(page, "session-side-terminal-region", 4)
  await expect(panel).toBeHidden()
  await expect(terminalContent).toHaveAttribute("data-cache-probe", "original")
  await expectTerminalContentCachedSize(page)
  await expectStackPainted(page)
  await expectPanelGapHeld(page)
  await expect(page.locator('[data-slot="session-side-panel-gap"]')).toHaveCSS("height", "0px")

  await reviewToggle.click()
  await expect(page.locator("#review-panel")).toHaveCount(0)
  await expectWidthMotions(page, 2)

  await resetHeightMotions(page)
  await page.keyboard.press("Control+Backquote")
  await expect(panel).toHaveAttribute("aria-hidden", "false")
  await expect(page.locator('[data-component="terminal"]')).toBeVisible()
  await expectWidthMotions(page, 3)
  await expectSideMotionSettled(page)
  await expectNoHeightMotion(page)

  await page.keyboard.press("Control+Backquote")
  await expect(panel).toBeHidden()
  await expect(terminalContent).toHaveAttribute("data-cache-probe", "original")
  await expectWidthMotions(page, 4)

  await page.setViewportSize({ width: 1200, height: 700 })
  await expect(terminalContent).toHaveAttribute("data-cache-probe", "original")

  await page.keyboard.press("Control+Backquote")
  await expect(panel).toBeVisible()
  await expect(terminalContent).toBeVisible()
  await expect(terminalContent).toHaveAttribute("data-cache-probe", "original")
  await expectWidthMotions(page, 5)

  await page.keyboard.press("Control+Backquote")
  await expect(panel).toBeHidden()

  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem("settings.v3") ?? "{}")
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ ...settings, general: { ...settings.general, terminalPlacement: "bottom" } }),
    )
  })
  await page.reload()
  await expectSessionTitle(page, title)
  await installMotionProbe(page)

  await page.keyboard.press("Control+Backquote")
  await expect(panel).toBeVisible()
  await expectAnimation(page, "terminal-panel-size-in")
  await page.keyboard.press("Control+Backquote")
  await expectAnimation(page, "terminal-panel-size-out")
  await expect(panel).toBeHidden()
  await expect(page.locator('[data-component="terminal"]')).toBeAttached()
})

type MotionProbe = {
  widths: number
  reviewWidths: number[]
  paintGaps: { review: number; terminalSurface: number }[]
  terminalContentSizes: { width: number; height: number }[]
  terminalAnchorGaps: number[]
  resetAnchorOnMotion: boolean
  panelGaps: number[]
  terminalTops: number[]
  terminalBottoms: number[]
  heights: string[]
  animations: string[]
}

async function installMotionProbe(page: Page) {
  await page.evaluate(() => {
    const probe: MotionProbe = {
      widths: 0,
      reviewWidths: [],
      paintGaps: [],
      terminalContentSizes: [],
      terminalAnchorGaps: [],
      resetAnchorOnMotion: false,
      panelGaps: [],
      terminalTops: [],
      terminalBottoms: [],
      heights: [],
      animations: [],
    }
    const observed = new WeakSet<Element>()
    const observers: ResizeObserver[] = []
    const observeReview = () => {
      const review = document.querySelector('[data-component="session-review-v2"]')
      if (!review || observed.has(review)) return
      observed.add(review)
      const observer = new ResizeObserver(([entry]) => probe.reviewWidths.push(entry.contentRect.width))
      observer.observe(review)
      observers.push(observer)
    }
    const observedRegions = new WeakSet<Element>()
    const observeStack = () => {
      const reviewRegion = document.querySelector<HTMLElement>('[data-slot="session-side-region"]')
      const terminalRegion = document.querySelector<HTMLElement>('[data-slot="session-side-terminal-region"]')
      if (!reviewRegion || !terminalRegion || observedRegions.has(reviewRegion)) return
      observedRegions.add(reviewRegion)
      const observer = new ResizeObserver(() => {
        const review = document.querySelector<HTMLElement>("#review-panel")
        const terminal = document.querySelector<HTMLElement>("#terminal-panel")
        const terminalContent = document.querySelector<HTMLElement>('[data-slot="terminal-panel-content"]')
        const panelGap = document.querySelector<HTMLElement>('[data-slot="session-side-panel-gap"]')
        if (!terminal || !terminalContent) return
        probe.terminalTops.push(terminal.getBoundingClientRect().top)
        probe.terminalBottoms.push(terminal.getBoundingClientRect().bottom)
        probe.terminalContentSizes.push({
          width: terminalContent.getBoundingClientRect().width,
          height: terminalContent.getBoundingClientRect().height,
        })
        const anchorGap = Math.abs(terminal.getBoundingClientRect().top - terminalContent.getBoundingClientRect().top)
        if (probe.resetAnchorOnMotion) {
          if (anchorGap > 8) return
          probe.terminalAnchorGaps = []
          probe.resetAnchorOnMotion = false
        }
        probe.terminalAnchorGaps.push(anchorGap)
        if (panelGap && terminalRegion.getBoundingClientRect().height > 1)
          probe.panelGaps.push(panelGap.getBoundingClientRect().height)
        if (!review) return
        probe.paintGaps.push({
          review: Math.abs(reviewRegion.getBoundingClientRect().height - review.getBoundingClientRect().height),
          terminalSurface: Math.abs(
            terminalRegion.getBoundingClientRect().height - terminal.getBoundingClientRect().height,
          ),
        })
      })
      observer.observe(reviewRegion)
      observer.observe(terminalRegion)
      observers.push(observer)
    }
    new MutationObserver(() => {
      observeReview()
      observeStack()
    }).observe(document.body, { childList: true, subtree: true })
    observeReview()
    observeStack()
    document.addEventListener("transitionrun", (event) => {
      if (!(event.target instanceof Element)) return
      const slot = event.target.getAttribute("data-slot")
      if (event.propertyName === "width" && slot === "session-chat-panel") probe.widths++
      if (event.propertyName === "height" && slot) {
        probe.heights.push(slot)
      }
    })
    document.addEventListener("animationstart", (event) => {
      if (!(event.target instanceof Element) || event.target.getAttribute("data-component") !== "terminal-panel") return
      probe.animations.push(event.animationName)
    })
    ;(window as Window & { __panelMotion?: MotionProbe }).__panelMotion = probe
  })
}

async function expectWidthMotions(page: Page, count: number) {
  await expect
    .poll(() => page.evaluate(() => (window as Window & { __panelMotion?: MotionProbe }).__panelMotion?.widths ?? 0))
    .toBeGreaterThanOrEqual(count)
}

async function resetHeightMotions(page: Page) {
  await page.evaluate(() => {
    const probe = (window as Window & { __panelMotion?: MotionProbe }).__panelMotion
    if (probe) probe.heights = []
  })
}

async function expectSideMotionSettled(page: Page) {
  const side = page.locator('[data-slot="session-side-panel-presence"]')
  await expect
    .poll(() => side.evaluate((element) => element.getAnimations().every((item) => item.playState === "finished")))
    .toBe(true)
}

async function expectNoHeightMotion(page: Page) {
  const heights = await page.evaluate(
    () => (window as Window & { __panelMotion?: MotionProbe }).__panelMotion?.heights ?? [],
  )
  expect(heights).toEqual([])
}

async function expectReviewWidthStable(page: Page) {
  const side = page.locator('[data-slot="session-side-panel-presence"]')
  await expect
    .poll(() => side.evaluate((element) => element.getAnimations().every((item) => item.playState === "finished")))
    .toBe(true)
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { __panelMotion?: MotionProbe }).__panelMotion?.reviewWidths.length ?? 0),
    )
    .toBeGreaterThan(0)
  const widths = await page.evaluate(
    () => (window as Window & { __panelMotion?: MotionProbe }).__panelMotion?.reviewWidths.map(Math.round) ?? [],
  )
  expect(new Set(widths).size).toBe(1)
}

async function expectStackedGeometry(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const review = document.querySelector<HTMLElement>("#review-panel")?.getBoundingClientRect()
        const terminal = document.querySelector<HTMLElement>("#terminal-panel")?.getBoundingClientRect()
        if (!review || !terminal) return Number.POSITIVE_INFINITY
        return terminal.top - review.bottom
      }),
    )
    .toBeLessThanOrEqual(9)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const review = document.querySelector<HTMLElement>("#review-panel")?.getBoundingClientRect()
        const terminal = document.querySelector<HTMLElement>("#terminal-panel")?.getBoundingClientRect()
        if (!review || !terminal) return Number.NEGATIVE_INFINITY
        return terminal.top - review.bottom
      }),
    )
    .toBeGreaterThanOrEqual(7)
}

async function expectLogicalSideAlignment(page: Page, direction: "ltr" | "rtl") {
  await expect
    .poll(() =>
      page.evaluate((direction) => {
        const frame = document.querySelector('[data-slot="session-side-panel-presence"]')?.getBoundingClientRect()
        const content = document.querySelector('[data-slot="session-side-panel-content"]')?.getBoundingClientRect()
        if (!frame || !content) return Number.POSITIVE_INFINITY
        return direction === "rtl" ? Math.abs(frame.right - content.right) : Math.abs(frame.left - content.left)
      }, direction),
    )
    .toBeLessThanOrEqual(1)
}

async function expectStackPainted(page: Page) {
  const gaps = await page.evaluate(
    () => (window as Window & { __panelMotion?: MotionProbe }).__panelMotion?.paintGaps ?? [],
  )
  expect(gaps.length).toBeGreaterThan(0)
  expect(Math.max(...gaps.map((gap) => gap.review))).toBeLessThanOrEqual(1)
  expect(Math.max(...gaps.map((gap) => gap.terminalSurface)), JSON.stringify(gaps)).toBeLessThanOrEqual(1)
}

async function resetTerminalTopMotion(page: Page) {
  await page.evaluate(() => {
    const probe = (window as Window & { __panelMotion?: MotionProbe }).__panelMotion
    if (probe) probe.terminalTops = []
  })
}

async function resetTerminalBottomMotion(page: Page) {
  await page.evaluate(() => {
    const probe = (window as Window & { __panelMotion?: MotionProbe }).__panelMotion
    if (probe) probe.terminalBottoms = []
  })
}

async function expectTerminalBottomFixed(page: Page) {
  const bottoms = await page.evaluate(
    () => (window as Window & { __panelMotion?: MotionProbe }).__panelMotion?.terminalBottoms ?? [],
  )
  expect(bottoms.length).toBeGreaterThan(0)
  expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(1)
}

async function resetTerminalAnchorGaps(page: Page) {
  await page.evaluate(() => {
    const probe = (window as Window & { __panelMotion?: MotionProbe }).__panelMotion
    if (probe) probe.resetAnchorOnMotion = true
  })
}

async function resetPanelGaps(page: Page) {
  await page.evaluate(() => {
    const probe = (window as Window & { __panelMotion?: MotionProbe }).__panelMotion
    if (probe) probe.panelGaps = []
  })
}

async function expectPanelGapHeld(page: Page) {
  const gaps = await page.evaluate(
    () => (window as Window & { __panelMotion?: MotionProbe }).__panelMotion?.panelGaps ?? [],
  )
  expect(gaps.length).toBeGreaterThan(0)
  expect(gaps.filter((gap) => gap >= 7 && gap <= 9).length / gaps.length).toBeGreaterThan(0.6)
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0)
  expect(Math.max(...gaps)).toBeLessThanOrEqual(9)
}

async function expectTerminalTopAnchored(page: Page) {
  const gaps = await page.evaluate(
    () => (window as Window & { __panelMotion?: MotionProbe }).__panelMotion?.terminalAnchorGaps ?? [],
  )
  expect(gaps.length).toBeGreaterThan(0)
  expect(Math.max(...gaps), JSON.stringify(gaps)).toBeLessThanOrEqual(8)
}

async function resetTerminalContentSizes(page: Page) {
  await page.evaluate(() => {
    const probe = (window as Window & { __panelMotion?: MotionProbe }).__panelMotion
    if (probe) probe.terminalContentSizes = []
  })
}

async function expectTerminalContentCachedSize(page: Page) {
  const sizes = await page.evaluate(
    () => (window as Window & { __panelMotion?: MotionProbe }).__panelMotion?.terminalContentSizes ?? [],
  )
  expect(sizes.length).toBeGreaterThan(0)
  expect(Math.min(...sizes.map((size) => size.width))).toBeGreaterThan(100)
  expect(Math.min(...sizes.map((size) => size.height))).toBeGreaterThan(100)
}

async function expectTerminalTopMotion(page: Page) {
  const tops = await page.evaluate(
    () => (window as Window & { __panelMotion?: MotionProbe }).__panelMotion?.terminalTops.map(Math.round) ?? [],
  )
  const unique = [...new Set(tops)]
  const range = Math.max(...unique) - Math.min(...unique)
  const maxDelta = Math.max(...unique.slice(1).map((value, index) => Math.abs(value - unique[index])))
  expect(unique.length, JSON.stringify(unique)).toBeGreaterThan(6)
  expect(maxDelta, JSON.stringify({ unique, range, maxDelta })).toBeLessThan(range * 0.3)
}

async function expectHeightMotions(page: Page, slot: string, count: number) {
  await expect
    .poll(() =>
      page.evaluate(
        (slot) =>
          (window as Window & { __panelMotion?: MotionProbe }).__panelMotion?.heights.filter((value) => value === slot)
            .length ?? 0,
        slot,
      ),
    )
    .toBeGreaterThanOrEqual(count)
}

async function expectAnimation(page: Page, name: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (name) =>
          (window as Window & { __panelMotion?: MotionProbe }).__panelMotion?.animations.includes(name) ?? false,
        name,
      ),
    )
    .toBe(true)
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}
