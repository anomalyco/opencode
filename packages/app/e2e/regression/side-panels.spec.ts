import { expect, test, type Locator, type Page } from "@playwright/test"
import { tabKey } from "../utils/app"
import { fileDiff, openSession } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

test("review and terminal follow the session tab and stay mounted", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const a = { id: "ses_side_a", title: "Alpha session" }
  const b = { id: "ses_side_b", title: "Beta session" }
  const { directory, pty } = await openSession(page, {
    name: "SidePanels",
    sessions: [a, b],
    pty: {},
    vcsDiff: Array.from({ length: 2_740 }, (_, index) =>
      fileDiff(`src/generated-${String(index).padStart(4, "0")}.ts`),
    ),
    seed: {
      panes: { [a.id]: { sessionWidth: 580, terminalHeight: 300 }, [b.id]: { sessionWidth: 520, terminalHeight: 180 } },
      settings: { general: { terminalPlacement: "bottom" } },
    },
  })
  const chat = page.locator('[data-slot="session-chat-panel"]')
  const review = page.locator('#review-panel [data-component="session-review-v2"]')
  const terminal = page.locator('[data-component="terminal"]')
  const terminalPanel = page.locator('[data-component="terminal-panel"]')
  const switchTab = async (title: string) => {
    await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
    await expectSessionTitle(page, title)
  }

  const transition = () => chat.evaluate((element) => getComputedStyle(element).transitionDuration)
  await page.getByRole("button", { name: "Toggle review" }).click()
  await expect.poll(transition).not.toBe("0s")
  await page.keyboard.press("Control+Backquote")
  await expect(review).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(terminalPanel).toHaveAttribute("data-size-animated", "true")
  await expect(chat).toHaveCSS("width", "580px")
  await expect(terminalPanel).toHaveCSS("height", "300px")
  await expect(page.locator("#session-side-panel-review-tab")).toHaveText("Files Changed 2740")
  await expect.poll(() => pty.sockets.length).toBe(1)
  await mark(review)
  await mark(terminal)

  await switchTab(b.title)
  await expect(review).toBeHidden()
  await expect(terminal).toBeHidden()
  await expect(terminalPanel).toHaveAttribute("data-size-animated", "false")
  await expect.poll(transition).toBe("0s")
  await expectMarked(review)
  await expectMarked(terminal)
  await page.getByRole("button", { name: "Toggle review" }).click()
  await page.keyboard.press("Control+Backquote")
  await expect(review).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(chat).toHaveCSS("width", "520px")
  await expect(terminalPanel).toHaveCSS("height", "180px")

  await switchTab(a.title)
  await expect(review).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(chat).toHaveCSS("width", "580px")
  await expect(terminalPanel).toHaveCSS("height", "300px")
  await expectMarked(review)
  await expectMarked(terminal)
  expect(pty.sockets).toHaveLength(1)
  expect(pty.sockets[0]!.url.searchParams.get("location[directory]")).toBe(directory)
  expect(pty.sockets[0]!.url.searchParams.get("ticket")).toBe("e2e-ticket")
  expect(pty.tokens[0]?.headers["x-opencode-ticket"]).toBe("1")

  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem("opencode.window.browser.dat:tabs.panes") ?? "{}")[key]?.review,
        tabKey(a.id),
      ),
    )
    .toBe(true)
  await page.reload()
  await expectSessionTitle(page, a.title)
  await expect(review).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(chat).toHaveCSS("width", "580px")
  await expect(terminalPanel).toHaveCSS("height", "300px")

  const tree = page.locator('#review-panel [data-component="file-tree-v2"]')
  await expect(tree.getByRole("button", { name: "generated-0000.ts" })).toBeVisible()
  expect(await tree.locator('[data-slot="file-tree-v2-row"]').count()).toBeLessThanOrEqual(60)
  const viewport = page.locator('#review-panel [data-slot="session-review-v2-sidebar-tree"] .scroll-view__viewport')
  await viewport.hover()
  await page.mouse.wheel(0, 100_000)
  await expect(tree.getByRole("button", { name: "generated-2739.ts" })).toBeVisible()
})

test("terminal stacks under review by default and spans the bottom when configured", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  // A large nested branch diff; its first file is the sentinel that proves the virtualized tree stays mounted.
  const diffs = [
    fileDiff(".github/actions/setup-bun/action.yml", { additions: 7 }),
    ...Array.from({ length: 2_739 }, (_, index) =>
      fileDiff(
        `src/branch/d${String(Math.floor(index / 100)).padStart(5, "0")}/generated-${String(index).padStart(4, "0")}.ts`,
        { additions: 100, loaded: false },
      ),
    ),
  ]
  await openSession(page, { name: "SideStack", pty: {}, vcsDiff: diffs })
  const toggle = page.getByRole("button", { name: "Toggle review" })
  const reviewPanel = page.locator("#review-panel")
  const terminalPanel = page.locator("#terminal-panel")
  const review = page.locator('[data-component="session-review-v2"]')
  const terminal = page.locator('[data-component="terminal"]')

  await toggle.click()
  await expect(reviewPanel).toBeVisible()
  await expectTreeSentinel(page)
  for (const direction of ["ltr", "rtl"] as const) {
    await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
    await expect.poll(() => sideContentOffset(page, direction)).toBeLessThanOrEqual(1)
  }
  await page.evaluate(() => (document.documentElement.dir = "ltr"))

  await page.keyboard.press("Control+Backquote")
  await expect(terminalPanel).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect
    .poll(async () => {
      const top = (await reviewPanel.boundingBox())!
      const bottom = (await terminalPanel.boundingBox())!
      const gap = bottom.y - top.y - top.height
      return (
        Math.abs(top.x - bottom.x) <= 1 &&
        Math.abs(top.x + top.width - bottom.x - bottom.width) <= 1 &&
        gap >= 7 &&
        gap <= 9
      )
    })
    .toBe(true)
  await expectTreeSentinel(page)
  await mark(review)
  await mark(terminal)

  // Closing review mid-motion: the terminal grows upward with its bottom fixed and its content top-anchored.
  const stacked = await stackGeometry(page)
  await holdTransitions(page)
  await toggle.click()
  const closing = await stackGeometry(page, 0.5)
  await releaseTransitions(page)
  await expect(reviewPanel).toBeHidden()
  await expect(terminalPanel).toBeVisible()
  const alone = await stackGeometry(page)
  expect(closing.moving).toEqual(expect.arrayContaining(["session-side-region", "session-side-terminal-region"]))
  expect(closing.terminalRegion).toBeGreaterThan(stacked.terminalRegion + 1)
  expect(closing.terminalRegion).toBeLessThan(alone.terminalRegion - 1)
  expect(Math.abs(closing.terminalBottom - stacked.terminalBottom)).toBeLessThanOrEqual(1)
  expect(closing.anchor).toBeLessThanOrEqual(8)
  expect(closing.terminalGap).toBeLessThanOrEqual(1)

  await toggle.click()
  await expect(reviewPanel).toBeVisible()
  await expectMarked(review)
  await expectTreeSentinel(page)

  // Hiding the terminal mid-motion: both surfaces fill their regions and the clipped terminal keeps its size.
  const open = await stackGeometry(page)
  await holdTransitions(page)
  await page.keyboard.press("Control+Backquote")
  const hiding = await stackGeometry(page, 0.5)
  await releaseTransitions(page)
  await expect(terminalPanel).toBeHidden()
  expect(hiding.moving).toEqual(expect.arrayContaining(["session-side-region", "session-side-terminal-region"]))
  expect(hiding.terminalRegion).toBeLessThan(open.terminalRegion - 1)
  expect(hiding.terminalRegion).toBeGreaterThan(1)
  expect(hiding.reviewGap).toBeLessThanOrEqual(1)
  expect(hiding.terminalGap).toBeLessThanOrEqual(1)
  expect(Math.abs(hiding.content.width - open.content.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(hiding.content.height - open.content.height)).toBeLessThanOrEqual(1)
  await expect(page.locator('[data-slot="side-terminal-panel-clip"]')).toHaveCSS("overflow", "clip")
  await expectMarked(terminal)
  await page.setViewportSize({ width: 1200, height: 700 })
  await page.keyboard.press("Control+Backquote")
  await expect(terminal).toBeVisible()
  await expectMarked(terminal)
  await expectTreeSentinel(page)
  expect(await page.evaluate(() => window.scrollX)).toBe(0)
  await page.keyboard.press("Control+Backquote")
  await expect(terminalPanel).toBeHidden()

  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem("settings.v3") ?? "{}")
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ ...settings, general: { ...settings.general, terminalPlacement: "bottom" } }),
    )
  })
  await page.reload()
  await expect(reviewPanel).toBeVisible()
  await page.keyboard.press("Control+Backquote")
  await expect(terminalPanel).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const review = document.querySelector("#review-panel")?.getBoundingClientRect()
        const terminal = document.querySelector("#terminal-panel")?.getBoundingClientRect()
        const sidebar = document.querySelector('#review-panel [data-slot="session-review-v2-sidebar"]')
        // The side region appears before its lazy review content after reload.
        if (!review || !terminal || !sidebar) return false
        const gap = terminal.top - review.bottom
        return (
          terminal.left <= 9 &&
          terminal.right >= window.innerWidth - 9 &&
          gap >= 7 &&
          gap <= 9 &&
          sidebar.getBoundingClientRect().width >= 240
        )
      }),
    )
    .toBe(true)
  await expectTreeSentinel(page)
  await page.keyboard.press("Control+Backquote")
  await expect(terminalPanel).toBeHidden()
  await expect(terminal).toBeAttached()
})

for (const direction of ["ltr", "rtl"] as const) {
  test(`terminal controls stay clear of the review toggle in ${direction}`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 })
    const { pty } = await openSession(page, { name: "TerminalControls", pty: { prefix: "pty_review_" } })
    await page.locator("html").evaluate((element, dir) => element.setAttribute("dir", dir), direction)

    const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await page.keyboard.press("Control+Backquote")
    const terminal = page.getByRole("region", { name: "Terminal", exact: true })
    await expect(terminal.getByRole("tab", { name: "Terminal 1", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    for (const number of [2, 3, 4]) {
      await terminal.getByRole("button", { name: "New terminal", exact: true }).click()
      await expect(terminal.getByRole("tab", { name: `Terminal ${number}`, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      )
    }

    await expect
      .poll(async () => {
        const tabs = (await terminal.getByRole("tablist").boundingBox())!
        const button = (await toggle.boundingBox())!
        return direction === "rtl" ? tabs.x >= button.x + button.width : tabs.x + tabs.width <= button.x
      })
      .toBe(true)
    await expectTerminalControlsAligned(terminal, toggle)
    await terminal
      .locator('[data-slot="tabs-trigger-wrapper"][data-value="pty_review_4"]')
      .getByRole("button", { name: "Close terminal", exact: true })
      .click()
    await expect(terminal.getByRole("tab")).toHaveText(["Terminal 1", "Terminal 2", "Terminal 3"])
    expect(pty.removed).toEqual(["pty_review_4"])
    await expect(toggle).toHaveAttribute("aria-expanded", "false")

    // The client names a new terminal with the lowest free number.
    await terminal.getByRole("button", { name: "New terminal", exact: true }).click()
    await expect(terminal.getByRole("tab", { name: "Terminal 4", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await expect(terminal.locator('[data-slot="tabs-trigger-wrapper"][data-value="pty_review_5"]')).toHaveCount(1)
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    const position = await toggle.boundingBox()
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(page.locator("#review-panel")).toHaveAttribute("aria-hidden", "false")
    await expect.poll(() => toggle.boundingBox()).toEqual(position)
    await expect
      .poll(async () => {
        const actions = (await page.locator('[data-slot="session-side-panel-actions"]').boundingBox())!
        const button = (await toggle.boundingBox())!
        return actions.y + actions.height / 2 - (button.y + button.height / 2)
      })
      .toBe(0)
    await toggle.press("Enter")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(toggle).toBeFocused()
    await expect.poll(() => toggle.boundingBox()).toEqual(position)
    await expectTerminalControlsAligned(terminal, toggle)
  })
}

// A DOM mark survives only while the same node stays mounted.
function mark(locator: Locator) {
  return locator.evaluate((element) => element.setAttribute("data-e2e-mounted", "original"))
}

function expectMarked(locator: Locator) {
  return expect(locator).toHaveAttribute("data-e2e-mounted", "original")
}

async function expectTreeSentinel(page: Page) {
  const tree = page.locator('#review-panel [data-component="file-tree-v2"]')
  await expect(tree.getByRole("button", { name: "action.yml" })).toBeVisible()
  const rows = await tree.locator('[data-slot="file-tree-v2-row"]').count()
  expect(rows).toBeGreaterThan(0)
  expect(rows).toBeLessThanOrEqual(60)
}

// Pauses each CSS transition as it starts, so a real toggle can be measured mid-motion.
function holdTransitions(page: Page) {
  return page.evaluate(() => {
    const host = window as Window & { e2eHold?: { active: boolean } }
    if (!host.e2eHold) {
      const hold = { active: false }
      host.e2eHold = hold
      document.addEventListener("transitionrun", (event) => {
        if (!hold.active || !(event.target instanceof Element)) return
        event.target
          .getAnimations()
          .filter((item) => item instanceof CSSTransition && item.transitionProperty === event.propertyName)
          .forEach((item) => item.pause())
      })
    }
    host.e2eHold.active = true
  })
}

function releaseTransitions(page: Page) {
  return page.evaluate(() => {
    ;(window as Window & { e2eHold?: { active: boolean } }).e2eHold!.active = false
    document
      .getAnimations()
      .filter((item) => item instanceof CSSTransition && item.playState === "paused")
      .forEach((item) => item.finish())
  })
}

// With `progress`, waits for the held region height transitions and seeks every held transition to that point first.
async function stackGeometry(page: Page, progress?: number) {
  const held = () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter(
          (item) =>
            item instanceof CSSTransition && item.playState === "paused" && item.transitionProperty === "height",
        )
        .map((item) => ((item.effect as KeyframeEffect).target as Element).getAttribute("data-slot")),
    )
  if (progress !== undefined) {
    await expect.poll(held).toEqual(expect.arrayContaining(["session-side-region", "session-side-terminal-region"]))
  }
  return page.evaluate((progress) => {
    const transitions = document
      .getAnimations()
      .filter((item): item is CSSTransition => item instanceof CSSTransition && item.playState === "paused")
    const region = transitions.find(
      (item) => ((item.effect as KeyframeEffect).target as Element).getAttribute("data-slot") === "session-side-region",
    )
    if (progress !== undefined) {
      const time = Number(region!.effect!.getTiming().duration) * progress
      transitions.forEach((item) => (item.currentTime = time))
    }
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
    const reviewRegion = box('[data-slot="session-side-region"]')!
    const terminalRegion = box('[data-slot="session-side-terminal-region"]')!
    const review = box("#review-panel")
    const terminal = box("#terminal-panel")!
    const content = box('[data-slot="terminal-panel-content"]')!
    return {
      moving: transitions.map((item) => ((item.effect as KeyframeEffect).target as Element).getAttribute("data-slot")),
      terminalRegion: terminalRegion.height,
      terminalBottom: terminal.bottom,
      anchor: Math.abs(terminal.top - content.top),
      reviewGap: review ? Math.abs(reviewRegion.height - review.height) : 0,
      terminalGap: Math.abs(terminalRegion.height - terminal.height),
      content: { width: content.width, height: content.height },
    }
  }, progress)
}

function sideContentOffset(page: Page, direction: "ltr" | "rtl") {
  return page.evaluate((direction) => {
    const frame = document.querySelector('[data-slot="session-side-panel-presence"]')!.getBoundingClientRect()
    const content = document.querySelector('[data-slot="session-side-panel-content"]')!.getBoundingClientRect()
    return direction === "rtl" ? Math.abs(frame.right - content.right) : Math.abs(frame.left - content.left)
  }, direction)
}

async function expectTerminalControlsAligned(terminal: Locator, toggle: Locator) {
  await expect
    .poll(async () => {
      const centers = await Promise.all(
        [terminal.getByRole("button", { name: "New terminal", exact: true }), toggle].map((button) =>
          button.locator("svg").evaluate((element) => {
            const svg = element as SVGSVGElement
            const path = svg.getBBox()
            return new DOMPoint(path.x + path.width / 2, path.y + path.height / 2).matrixTransform(svg.getScreenCTM()!)
              .y
          }),
        ),
      )
      return centers[0]! - centers[1]!
    })
    .toBeCloseTo(0, 1)
}
