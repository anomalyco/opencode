import { expect, test, type Page } from "@playwright/test"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { mockStressTimeline, stressSessionHref } from "../performance/timeline/timeline-test-helpers"
import { expectAppVisible } from "../utils/waits"

const GRAPH_PATH = "/api/vcs/graph"

type GraphRef = { name: string; kind: "branch" | "remote" | "tag" | "head" }
type GraphCommit = {
  hash: string
  parents: string[]
  refs: GraphRef[]
  subject: string
  authorName: string | null
  authoredAtMs: number | null
}

test.use({ viewport: { width: 1440, height: 900 } })

// The dialog resolves every row through its accessible name, so subjects stay
// the stable identity for assertions instead of positional selectors.
const fullHash = (index: number) => `${index.toString(16).padStart(2, "0")}${"0".repeat(38)}`
const shortHash = (index: number) => fullHash(index).slice(0, 8)

function commit(index: number, input: Partial<Omit<GraphCommit, "hash">> = {}): GraphCommit {
  return {
    hash: fullHash(index),
    parents: input.parents ?? [],
    refs: input.refs ?? [],
    subject: input.subject ?? `Commit ${index}`,
    authorName: input.authorName === undefined ? "Ada Lovelace" : input.authorName,
    authoredAtMs:
      input.authoredAtMs === undefined ? Date.UTC(2026, 8, 20, 12, 0, 0) - index * 60_000 : input.authoredAtMs,
  }
}

function branchHistory(): GraphCommit[] {
  return [
    commit(0, {
      parents: [fullHash(1), fullHash(2)],
      refs: [
        { name: "HEAD", kind: "head" },
        { name: "main", kind: "branch" },
      ],
      subject: "Merge feature/header into main",
    }),
    commit(1, {
      parents: [fullHash(3)],
      refs: [{ name: "origin/feature", kind: "remote" }],
      subject: "Add header layout",
      authorName: "Grace Hopper",
    }),
    commit(2, {
      parents: [fullHash(3)],
      refs: [{ name: "feature/header", kind: "branch" }],
      subject: "Add feature flag",
    }),
    commit(3, {
      parents: [fullHash(4)],
      refs: [{ name: "v1.0.0", kind: "tag" }],
      subject: "Tag the first release",
    }),
    commit(4, { parents: [fullHash(5)], subject: "Prepare changelog" }),
    commit(5, { parents: [], subject: "Initial commit", authorName: null, authoredAtMs: null }),
  ]
}

function graphRequests(page: Page) {
  const requests: number[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname !== GRAPH_PATH) return
    requests.push(Number(url.searchParams.get("skip") ?? 0))
  })
  return requests
}

function graphBody(commits: GraphCommit[], hasMore: boolean) {
  return { location: { directory: fixture.directory }, data: { commits, hasMore } }
}

async function openGraph(page: Page) {
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  await summary.getByRole("button", { name: "Git graph", exact: true }).click()
  return summary
}

function graphDialog(page: Page) {
  return page.getByRole("dialog", { name: "Git graph", exact: true })
}

async function gotoSession(page: Page) {
  await page.goto(stressSessionHref(fixture.targetID))
  await expectAppVisible(page.locator('[data-component="composer-editor"]'))
}

test("opens the Git graph from the project summary and renders refs, merge rows, and the first selection", async ({
  page,
}) => {
  await mockStressTimeline(page, { vcsGraph: { commits: branchHistory(), hasMore: false } })
  await gotoSession(page)
  const summary = await openGraph(page)
  const dialog = graphDialog(page)

  await expect(summary).toBeHidden()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("img", { name: "Commit graph with branch and merge connections" })).toBeVisible()
  await expect(dialog.locator(".git-graph-row")).toHaveCount(6)

  const merge = dialog.getByRole("button", { name: /Merge feature\/header into main/ })
  await expect(merge.locator('.git-graph-ref[data-kind="head"]')).toHaveText("HEAD")
  await expect(merge.locator('.git-graph-ref[data-kind="branch"]')).toHaveText("main")
  await expect(merge.getByTitle("Merge commit")).toBeVisible()
  await expect(dialog.locator('.git-graph-ref[data-kind="remote"]')).toHaveText("origin/feature")
  await expect(dialog.locator('.git-graph-ref[data-kind="tag"]')).toHaveText("v1.0.0")
  await expect(dialog.getByRole("button", { name: /Add header layout/ }).locator(".git-graph-author")).toHaveText(
    "Grace Hopper",
  )

  const unknown = dialog.getByRole("button", { name: /Initial commit/ })
  await expect(unknown.locator(".git-graph-author")).toHaveText("Unknown")
  await expect(unknown.locator(".git-graph-date")).toHaveText("Unknown")
  await expect(unknown.locator(".git-graph-hash")).toHaveText(shortHash(5))

  await expect(dialog.locator('.git-graph-row[data-selected="true"]')).toHaveCount(1)
  await expect(merge).toHaveAttribute("data-selected", "true")
  await expect(dialog.getByRole("complementary", { name: "Selected commit details" })).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0)
})

test("expands and collapses commit details by click and keyboard, and closes with Escape", async ({ page }) => {
  await mockStressTimeline(page, { vcsGraph: { commits: branchHistory(), hasMore: false } })
  await gotoSession(page)
  const summary = await openGraph(page)
  const dialog = graphDialog(page)
  const trigger = page.getByRole("button", { name: "Session details", exact: true })
  const row = dialog.getByRole("button", { name: /Tag the first release/ })
  const detail = dialog.getByRole("complementary", { name: "Selected commit details" })

  await row.click()
  await expect(row).toHaveAttribute("aria-expanded", "true")
  await expect(row).toHaveAttribute("data-selected", "true")
  await expect(detail).toContainText("Tag the first release")
  await expect(detail.locator("code")).toHaveText(fullHash(3))
  await expect(detail).toContainText("v1.0.0")
  await expect(detail).toContainText(shortHash(4))

  await row.click()
  await expect(row).toHaveAttribute("aria-expanded", "false")
  await expect(detail).toHaveCount(0)

  await row.focus()
  await expect(row).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(detail).toBeVisible()
  await page.keyboard.press("Space")
  await expect(detail).toHaveCount(0)

  await expect(summary).toBeHidden()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test("appends pages with the raw consumed offset and de-duplicates repeated hashes", async ({ page }) => {
  const requests = graphRequests(page)
  const pages: Record<number, { commits: GraphCommit[]; hasMore: boolean }> = {
    0: { commits: Array.from({ length: 10 }, (_, index) => commit(index)), hasMore: true },
    10: {
      commits: [
        ...Array.from({ length: 5 }, (_, index) => commit(index + 5)),
        ...Array.from({ length: 10 }, (_, index) => commit(index + 10)),
      ],
      hasMore: true,
    },
    25: { commits: Array.from({ length: 5 }, (_, index) => commit(index + 20)), hasMore: false },
  }
  await mockStressTimeline(page, { vcsGraph: (query) => pages[query.skip ?? 0] ?? { commits: [], hasMore: false } })
  await gotoSession(page)
  await openGraph(page)
  const dialog = graphDialog(page)
  const loadMore = dialog.getByRole("button", { name: "Load more", exact: true })

  await expect(dialog.locator(".git-graph-row")).toHaveCount(10)
  await loadMore.click()
  await expect(dialog.locator(".git-graph-row")).toHaveCount(20)
  await loadMore.click()
  await expect(dialog.locator(".git-graph-row")).toHaveCount(25)
  await expect(loadMore).toHaveCount(0)

  // Offset tracks consumed records, not the de-duplicated display count.
  expect(requests).toEqual([0, 10, 25])
  const hashes = await dialog.locator(".git-graph-hash").allTextContents()
  expect(new Set(hashes).size).toBe(hashes.length)
})

test("auto-loads near the bottom and keeps the button disabled while a page is in flight", async ({ page }) => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  let gated = true
  await mockStressTimeline(page)
  await page.route(
    (url) => url.pathname === GRAPH_PATH,
    async (route) => {
      const skip = Number(new URL(route.request().url()).searchParams.get("skip") ?? 0)
      const commits =
        skip === 0
          ? Array.from({ length: 50 }, (_, index) => commit(index))
          : Array.from({ length: 10 }, (_, index) => commit(index + 50))
      if (skip > 0 && gated) await gate
      await route.fulfill({ json: graphBody(commits, skip === 0) })
    },
  )
  await gotoSession(page)
  await openGraph(page)
  const dialog = graphDialog(page)
  const scroller = dialog.locator(".git-graph-scroll")

  await expect(dialog.locator(".git-graph-row")).toHaveCount(50)
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  const loadMore = dialog.getByRole("button", { name: "Loading more…", exact: true })
  await expect(loadMore).toBeDisabled()
  gated = false
  release()
  await expect(dialog.locator(".git-graph-row")).toHaveCount(60)
  await expect(dialog.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0)
})

test("keeps the loaded history on refresh and load-more failures and recovers on retry", async ({ page }) => {
  const state = { refresh: false, more: false }
  await mockStressTimeline(page, {
    vcsGraph: (query) =>
      (query.skip ?? 0) === 0
        ? { commits: Array.from({ length: 10 }, (_, index) => commit(index)), hasMore: true }
        : { commits: Array.from({ length: 10 }, (_, index) => commit(index + 10)), hasMore: false },
  })
  await page.route(
    (url) => url.pathname === GRAPH_PATH,
    async (route) => {
      const skip = Number(new URL(route.request().url()).searchParams.get("skip") ?? 0)
      const fail = skip === 0 ? state.refresh : state.more
      if (fail) return route.fulfill({ status: 503, json: { message: "Graph unavailable" } })
      return route.fallback()
    },
  )
  await gotoSession(page)
  await openGraph(page)
  const dialog = graphDialog(page)

  await expect(dialog.locator(".git-graph-row")).toHaveCount(10)
  state.refresh = true
  await dialog.getByRole("button", { name: "Refresh Git graph", exact: true }).click()
  const refreshAlert = dialog.getByRole("alert")
  await expect(refreshAlert).toContainText("Could not refresh Git history. The existing graph is still shown.")
  await expect(dialog.locator(".git-graph-row")).toHaveCount(10)
  state.refresh = false
  await refreshAlert.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(dialog.getByRole("alert")).toHaveCount(0)
  await expect(dialog.locator(".git-graph-row")).toHaveCount(10)

  state.more = true
  await dialog.getByRole("button", { name: "Load more", exact: true }).click()
  const moreAlert = dialog.getByRole("alert")
  await expect(moreAlert).toContainText("Could not load more commits.")
  await expect(dialog.locator(".git-graph-row")).toHaveCount(10)
  state.more = false
  // A failed append keeps the existing rows and retries through the same button.
  await dialog.getByRole("button", { name: "Load more", exact: true }).click()
  await expect(dialog.locator(".git-graph-row")).toHaveCount(20)
  await expect(dialog.getByRole("alert")).toHaveCount(0)
})

test("replaces the window and resets selection and detail after a successful refresh", async ({ page }) => {
  const state = { refreshed: false }
  await mockStressTimeline(page, {
    vcsGraph: () =>
      state.refreshed
        ? {
            commits: [commit(90, { subject: "Refreshed head commit", refs: [{ name: "HEAD", kind: "head" }] })],
            hasMore: false,
          }
        : { commits: branchHistory(), hasMore: false },
  })
  await gotoSession(page)
  await openGraph(page)
  const dialog = graphDialog(page)

  await dialog.getByRole("button", { name: /Tag the first release/ }).click()
  await expect(dialog.getByRole("complementary", { name: "Selected commit details" })).toBeVisible()
  state.refreshed = true
  await dialog.getByRole("button", { name: "Refresh Git graph", exact: true }).click()

  await expect(dialog.locator(".git-graph-row")).toHaveCount(1)
  await expect(dialog.getByRole("button", { name: /Refreshed head commit/ })).toHaveAttribute("data-selected", "true")
  await expect(dialog.getByRole("complementary", { name: "Selected commit details" })).toHaveCount(0)
})

test("shows the unsupported and empty states for providers without graph history", async ({ page }) => {
  let mode: "unsupported" | "empty" = "unsupported"
  await mockStressTimeline(page, { vcsGraph: () => (mode === "unsupported" ? null : { commits: [], hasMore: false }) })
  await gotoSession(page)
  await openGraph(page)
  const dialog = graphDialog(page)

  await expect(dialog).toContainText("Git graph is unavailable")
  await expect(dialog.locator(".git-graph-row")).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()

  mode = "empty"
  await openGraph(page)
  await expect(graphDialog(page)).toContainText("No commits yet")
  await expect(graphDialog(page)).toContainText("This repository does not have any visible commits.")
})

test("does not request the graph before opening and ignores a response that lands after close", async ({ page }) => {
  const requests = graphRequests(page)
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  let held = true
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() !== "error") return
    // Chromium reports benign ResizeObserver loop notifications as window errors.
    if (message.text().includes("ResizeObserver loop")) return
    errors.push(message.text())
  })
  await mockStressTimeline(page, { vcsGraph: { commits: branchHistory(), hasMore: false } })
  await page.route(
    (url) => url.pathname === GRAPH_PATH,
    async (route) => {
      if (held) await gate
      try {
        await route.fulfill({ json: graphBody(branchHistory(), false) })
      } catch {}
    },
  )
  await gotoSession(page)
  expect(requests).toEqual([])

  await openGraph(page)
  const dialog = graphDialog(page)
  await expect(dialog).toContainText("Loading Git history…")
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  held = false
  release()
  await expect(dialog).toHaveCount(0)
  expect(errors).toEqual([])

  await openGraph(page)
  await expect(graphDialog(page).locator(".git-graph-row")).toHaveCount(6)
  expect(requests).toEqual([0, 0])
})

test("opens the graph from the mobile summary and returns focus to the trigger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockStressTimeline(page, { vcsGraph: { commits: branchHistory(), hasMore: false } })
  await gotoSession(page)
  await page
    .locator('[data-slot="session-mobile-view-navigation"]')
    .getByRole("button", { name: "More options", exact: true })
    .click()
  await page.getByRole("menuitem", { name: "Session details", exact: true }).click()
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  await summary.getByRole("button", { name: "Git graph", exact: true }).click()
  const dialog = graphDialog(page)

  await expect(summary).toBeHidden()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator(".git-graph-row")).toHaveCount(6)
  // The lane column is the point of the feature, so it stays in view while the
  // narrow viewport scrolls the table horizontally.
  await expect(dialog.getByRole("img", { name: "Commit graph with branch and merge connections" })).toBeVisible()
  const openedColumn = await dialog.locator(".git-graph-canvas").boundingBox()
  expect(openedColumn).not.toBeNull()
  expect(openedColumn!.x + openedColumn!.width).toBeLessThanOrEqual(390)
  const bounds = await dialog.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)

  await dialog.getByRole("button", { name: /Tag the first release/ }).click()
  await expect(dialog.getByRole("complementary", { name: "Selected commit details" })).toBeVisible()
  // Selecting a row must not push the lane column out of view on a narrow viewport.
  const graphColumn = await dialog.locator(".git-graph-canvas").boundingBox()
  expect(graphColumn).not.toBeNull()
  expect(graphColumn!.x).toBeGreaterThanOrEqual(0)
  expect(graphColumn!.x + graphColumn!.width).toBeLessThanOrEqual(390)
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-action="session-mobile-summary-trigger"]')).toBeFocused()
})
