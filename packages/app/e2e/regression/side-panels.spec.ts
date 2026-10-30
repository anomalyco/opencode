import { expect, test, type Locator, type Page } from "@playwright/test"
import { tabKey } from "../utils/app"
import { fileDiff, openSession } from "../utils/workspace"
import { openReviewLauncher } from "../utils/side-panel"
import { expectSessionTitle } from "../utils/waits"
import { base64Encode } from "@opencode/util/encode"

test("review and terminal tabs follow the session tab and the terminal stays mounted", async ({ page }) => {
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
    seed: { panes: { [a.id]: { sessionWidth: 580 }, [b.id]: { sessionWidth: 520 } } },
  })

  const chat = page.locator('[data-slot="session-chat-panel"]')
  const review = page.locator('#review-panel [data-component="session-review-v2"]')
  const terminal = page.locator('[data-component="terminal"]')
  const reviewTab = page.locator("#session-side-panel-review-tab")
  const terminalTab = page.locator("#review-panel").getByRole("tab", { name: "Terminal 1", exact: true })

  const switchTab = async (title: string) => {
    await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
    await expectSessionTitle(page, title)
  }

  await page.getByRole("button", { name: "Toggle review" }).click()
  await openReviewLauncher(page.locator("#review-panel"))
  await expect(review).toBeVisible()
  await expect(chat).toHaveCSS("width", "580px")
  await expect(reviewTab).toHaveText("Files Changed 2740")

  // The terminal opens as a tab beside review in the same strip.
  await page.keyboard.press("Control+Backquote")
  await expect(terminalTab).toHaveAttribute("aria-selected", "true")
  await expect(terminal).toBeVisible()
  await expect(review).toBeHidden()
  await expect.poll(() => pty.sockets.length).toBe(1)
  await mark(terminal)

  await switchTab(b.title)
  await expect(terminal).toBeHidden()
  await expectMarked(terminal)
  await page.getByRole("button", { name: "Toggle review" }).click()
  await openReviewLauncher(page.locator("#review-panel"))
  await expect(review).toBeVisible()
  await expect(chat).toHaveCSS("width", "520px")
  // The workspace's terminal reopens in this session's strip instead of starting another shell.
  await page.keyboard.press("Control+Backquote")
  await expect(terminalTab).toHaveAttribute("aria-selected", "true")
  await expect(terminal).toBeVisible()
  await expectMarked(terminal)

  await switchTab(a.title)
  await expect(terminal).toBeVisible()
  await expect(chat).toHaveCSS("width", "580px")
  await expectMarked(terminal)
  await reviewTab.click()
  await expect(review).toBeVisible()
  expect(pty.sockets).toHaveLength(1)
  expect(pty.created).toHaveLength(1)
  expect(pty.sockets[0]!.url.searchParams.get("location[directory]")).toBe(directory)
  expect(pty.sockets[0]!.url.searchParams.get("ticket")).toBe("e2e-ticket")
  expect(pty.tokens[0]?.headers["x-opencode-ticket"]).toBe("1")

  await terminalTab.click()
  await expect(terminal).toBeVisible()
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
  await expect(terminalTab).toHaveAttribute("aria-selected", "true")
  await expect(terminal).toBeVisible()
  await expect(chat).toHaveCSS("width", "580px")
  await reviewTab.click()
  await expect(review).toBeVisible()

  const tree = page.locator('#review-panel [data-component="file-tree-v2"]')
  await expect(tree.getByRole("treeitem", { name: "generated-0000.ts" })).toBeVisible()
  expect(await tree.locator('[data-type="item"]').count()).toBeLessThanOrEqual(60)
  const viewport = tree.locator("[data-file-tree-virtualized-scroll]")
  await viewport.hover()
  await page.mouse.wheel(0, 100_000)
  await expect(tree.getByRole("treeitem", { name: "generated-2739.ts" })).toBeVisible()
})

test("review content stays aligned with the side region in both directions", async ({ page }) => {
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

  await openSession(page, { name: "SideStack", vcsDiff: diffs })
  const toggle = page.getByRole("button", { name: "Toggle review" })
  await toggle.click()
  await openReviewLauncher(page.locator("#review-panel"))
  await expectTreeSentinel(page)

  for (const direction of ["ltr", "rtl"] as const) {
    await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
    await expect.poll(() => sideContentOffset(page, direction)).toBeLessThanOrEqual(1)
  }

  await page.reload()
  await expect(page.locator("#review-panel")).toBeVisible()
  await expectTreeSentinel(page)
})

test("new tab selection and closing stay in the focused pane", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const directory = "C:/OpenCode/PaneNewTabs"
  const key = `local\u0000${base64Encode(directory)}/ses_panenewtabs`

  await openSession(page, {
    name: "PaneNewTabs",
    fileList: () => [],
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    seed: {
      panes: { ses_panenewtabs: { review: true } },
      storage: {
        "opencode.global.dat:layout": {
          sessionTabs: {
            [key]: {
              all: ["file://README.md", "file://notes.md"],
              active: "file://README.md",
              panes: { "file://notes.md": "split" },
              selected: { side: "file://README.md", split: "file://notes.md" },
            },
          },
        },
      },
    },
  })

  const side = page.locator('[data-pane-content="side"]')
  const split = page.locator('[data-pane-content="split"]')
  const mod = (await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))) ? "Meta" : "Control"
  const sideTabs = side.getByRole("tab", { name: "New tab", exact: true })
  const splitTabs = split.getByRole("tab", { name: "New tab", exact: true })
  await expect(side.getByRole("tab", { name: "README.md", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(split.getByRole("tab", { name: "notes.md", exact: true })).toHaveAttribute("aria-selected", "true")

  await side.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(sideTabs).toHaveCount(1)
  await side.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(sideTabs).toHaveCount(2)
  // Pick the older New tab, so a fallback to the newest one cannot pass unnoticed.
  await sideTabs.nth(0).click()
  await expect(sideTabs.nth(0)).toHaveAttribute("aria-selected", "true")

  await split.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(splitTabs).toHaveAttribute("aria-selected", "true")
  await expect(sideTabs.nth(0)).toHaveAttribute("aria-selected", "true")
  await expect(sideTabs.nth(1)).toHaveAttribute("aria-selected", "false")

  await splitTabs.click()
  await splitTabs.press(`${mod}+w`)
  await expect(splitTabs).toHaveCount(0)
  await expect(split.getByRole("tab", { name: "notes.md", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(sideTabs).toHaveCount(2)
  await expect(sideTabs.nth(0)).toHaveAttribute("aria-selected", "true")

  // With focus on the region itself, close falls back to the active pane, not another pane's New tab.
  await split.getByRole("tab", { name: "notes.md", exact: true }).click()
  await page.locator("#review-panel").focus()
  await page.keyboard.press(`${mod}+w`)
  await expect(split).toHaveCount(0)
  await expect(sideTabs).toHaveCount(2)
  await expect(sideTabs.nth(0)).toHaveAttribute("aria-selected", "true")
})

test("closing the last New tab closes the side region, and only a New tab lists the launchers", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSession(page, { name: "LastNewTab", seed: { panes: { ses_lastnewtab: { review: true } } } })

  const panel = page.locator("#review-panel")
  const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
  const newTab = panel.getByRole("tab", { name: "New tab", exact: true })
  const review = panel.getByRole("button", { name: /^Review/ })

  // An empty side region opens on a New tab listing the launchers.
  await expect(newTab).toHaveAttribute("aria-selected", "true")
  await expect(review).toBeVisible()

  // Closing it leaves no tab, so the region closes rather than listing the launchers without one.
  await newTab.locator("..").getByRole("button", { name: "Close tab" }).click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")

  await toggle.click()
  await expect(newTab).toHaveAttribute("aria-selected", "true")
  await expect(review).toBeVisible()
})

test("tabs in a narrow side strip shrink to keep their close buttons, and a tab's menu closes the others", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 })
  const directory = "C:/OpenCode/NarrowStrip"
  const key = `local\u0000${base64Encode(directory)}/ses_narrowstrip`
  const files = ["a.md", "a-file-name-long-enough-to-overflow-the-side-strip-by-itself.md", "b.md"]

  await openSession(page, {
    name: "NarrowStrip",
    fileList: () => [],
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    seed: {
      panes: { ses_narrowstrip: { review: true, sessionWidth: 640 } },
      storage: {
        "opencode.global.dat:layout": {
          sessionTabs: { [key]: { all: files.map((file) => `file://${file}`), active: `file://${files[1]}` } },
        },
      },
    },
  })

  const side = page.locator('[data-pane-content="side"]')
  const add = side.getByRole("button", { name: "Add tab", exact: true })
  await expect(side.getByRole("tab", { name: files[1], exact: true })).toHaveAttribute("aria-selected", "true")

  // Every tab's close button stays left of "+", instead of the strip scrolling it away under its edge fade.
  const end = (await add.boundingBox())!.x
  const closes = side.locator('[data-pane-strip="side"] [data-slot="tabs-trigger-close-button"]')
  await expect(closes).toHaveCount(files.length)

  for (const close of await closes.all()) {
    const box = (await close.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(end)
  }

  await side.getByRole("tab", { name: "b.md", exact: true }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Close other tabs", exact: true }).click()
  await expect(side.getByRole("tab")).toHaveCount(1)
  await expect(side.getByRole("tab", { name: "b.md", exact: true })).toHaveAttribute("aria-selected", "true")

  // With nothing else to close, the menu offers only the tab itself.
  await side.getByRole("tab", { name: "b.md", exact: true }).click({ button: "right" })
  await expect(page.getByRole("menuitem", { name: "Close other tabs", exact: true })).toBeDisabled()
  await page.getByRole("menuitem", { name: "Close tab", exact: true }).click()
  await expect(side.getByRole("tab", { name: "b.md", exact: true })).toHaveCount(0)
})

// A DOM mark survives only while the same node stays mounted.
function mark(locator: Locator) {
  return locator.evaluate((element) => element.setAttribute("data-e2e-mounted", "original"))
}

function expectMarked(locator: Locator) {
  return expect(locator).toHaveAttribute("data-e2e-mounted", "original")
}

async function expectTreeSentinel(page: Page) {
  const tree = page.locator('#review-panel [data-component="file-tree-v2"]')
  await expect(tree.getByRole("treeitem", { name: "action.yml" })).toBeVisible()
  const rows = await tree.locator('[data-type="item"]').count()
  expect(rows).toBeGreaterThan(0)
  expect(rows).toBeLessThanOrEqual(60)
}

function sideContentOffset(page: Page, direction: "ltr" | "rtl") {
  return page.evaluate((direction) => {
    const frame = document.querySelector('[data-slot="session-side-panel-presence"]')!.getBoundingClientRect()
    const content = document.querySelector('[data-slot="session-side-panel-content"]')!.getBoundingClientRect()

    return direction === "rtl" ? Math.abs(frame.right - content.right) : Math.abs(frame.left - content.left)
  }, direction)
}

test("the new tab view lists recently closed tabs, expands to the rest, and keeps them across a reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const directory = "C:/OpenCode/RecentlyClosed"
  const key = `local\u0000${base64Encode(directory)}/ses_recentlyclosed`

  // Twelve files closed earlier, newest first, as the app stores them beside the strip.
  const closed = Array.from({ length: 12 }, (_, index) => ({
    key: `file://src/closed-${String(index).padStart(2, "0")}.ts`,
    title: `closed-${String(index).padStart(2, "0")}.ts`,
    file: `src/closed-${String(index).padStart(2, "0")}.ts`,
    closed: 1_000 - index,
  }))

  await openSession(page, {
    name: "RecentlyClosed",
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    seed: {
      panes: { ses_recentlyclosed: { review: true } },
      storage: {
        "opencode.global.dat:layout": {
          sessionTabs: { [key]: { all: ["file://README.md"], active: "file://README.md" } },
          sessionView: { [key]: { scroll: {}, closed } },
        },
      },
    },
  })

  const panel = page.locator("#review-panel")
  const recent = panel.getByRole("region", { name: "Recently closed", exact: true })
  const rows = recent.locator('[data-slot="side-recently-closed-row"]')
  const toggle = page.getByRole("button", { name: "Toggle review", exact: true })

  // The latest five, then all of them once expanded.
  await panel.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(rows).toHaveCount(5)
  await expect(rows.first()).toContainText("closed-00.ts")
  const more = recent.getByRole("button", { name: "Show more", exact: true })
  await more.focus()
  await more.press("Enter")
  await expect(rows).toHaveCount(12)
  await expect(rows.filter({ hasText: "closed-05.ts" })).toBeFocused()
  await expect(recent.getByRole("button", { name: "Show more", exact: true })).toHaveCount(0)
  await expect(recent.getByRole("button", { name: "Show less", exact: true })).toHaveCount(0)

  // Closing the last tab closes the region; it opens on its launchers with that tab listed first.
  const readme = panel.getByRole("tab", { name: "README.md" })
  await readme.click()
  await readme.locator("..").getByRole("button", { name: "Close tab" }).click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await toggle.click()
  await expect(panel.getByRole("tab", { name: "New tab", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(rows.first()).toContainText("README.md")

  // The list survives a reload, and reopening a row brings its tab back and takes it off the list.
  await page.reload()
  await expect(rows.first()).toContainText("README.md")
  await rows.first().click()
  await expect(panel.getByRole("tab", { name: "README.md" })).toHaveAttribute("aria-selected", "true")
  await panel.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(rows.first()).toContainText("closed-00.ts")
  await expect(recent).not.toContainText("README.md")
})
