import { expect, test, type Page } from "@playwright/test"
import pkg from "../../package.json" with { type: "json" }
import type { SeedInput } from "../utils/app"
import { openHeldStart } from "../utils/direction"
import { expectAppVisible } from "../utils/waits"
import { mockWorkspace } from "../utils/workspace"

// The web app's version, which What's New compares with the version last seen.
const current = pkg.version

const SEEN = "opencode.global.dat:extension.updater.seen"

const RELEASE_NOTES = "opencode.global.dat:extension.updater.releaseNotes"

const cors = { "access-control-allow-origin": "*" }

const splitPanes = {
  title: "Split panes",
  description: "Work side by side.",
  media: { type: "image", src: "/split.png" },
}

// Newest first. Since 1.9.1 the app shows five desktop highlights: the CLI group, the repeat and the sixth stay out.
const changelog = {
  releases: [
    {
      tag: `v${current}`,
      highlights: [
        {
          source: "Desktop",
          items: [
            splitPanes,
            {
              title: "Voice input",
              shortDescription: "Talk to the agent.",
              media: { type: "VIDEO", url: "/voice.mp4" },
            },
          ],
        },
        { source: "cli", items: [{ title: "Terminal only", description: "Not in the desktop app." }] },
      ],
    },
    {
      tag: "1.9.2",
      highlights: [
        { source: "desktop", title: "Faster startup", description: "Opens in half the time." },
        {
          source: "desktop",
          items: [
            splitPanes,
            { title: "Themes", description: "Pick a theme." },
            { title: "Session tabs", description: "Keep sessions open." },
            { title: "Sixth", description: "Past the limit." },
          ],
        },
      ],
    },
    { tag: "1.9.1", highlights: [{ source: "desktop", title: "Seen before", description: "Shown at 1.9.1." }] },
  ],
}

// The list form, whose one release in range has no desktop highlights.
const cliOnly = [{ tag: current, highlights: [{ source: "cli", title: "Terminal only", description: "Not here." }] }]

// A user who last saw 1.9.1, stored where the app kept it before the updater extension owned What's New.
const upgraded = { storage: { "highlights.v1": { version: "1.9.1" } } }

test("What's New shows the highlights since the version seen, pages to Get started, and is seen once shown", async ({
  page,
}) => {
  const requests = await serveChangelog(page)
  await start(page, upgraded)
  const dialog = page.getByRole("dialog")
  const title = dialog.getByRole("heading", { level: 1 })
  const next = dialog.getByRole("button", { name: "Next", exact: true })
  await expect(title).toHaveText("Split panes")
  await expect(dialog.getByText("Work side by side.", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("img", { name: "Split panes", exact: true })).toHaveAttribute("src", "/split.png")
  // Seen as soon as it shows, so however it closes, the next start shows nothing.
  await expect.poll(() => stored(page, SEEN)).toEqual({ version: current })

  await next.click()
  await expect(title).toHaveText("Voice input")
  await expect(dialog.getByText("Talk to the agent.", { exact: true })).toBeVisible()
  await expect(dialog.locator("video")).toHaveAttribute("src", "/voice.mp4")
  await page.keyboard.press("ArrowLeft")
  await expect(title).toHaveText("Split panes")
  await page.keyboard.press("ArrowRight")
  await expect(title).toHaveText("Voice input")

  await next.click()
  await expect(title).toHaveText("Faster startup")
  await expect(dialog.locator("img, video")).toHaveCount(0)
  await next.click()
  await expect(title).toHaveText("Themes")
  await next.click()
  await expect(title).toHaveText("Session tabs")
  await expect(next).toHaveCount(0)
  await dialog.getByRole("button", { name: "Get started", exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(requests).toHaveLength(1)
})

test("Don't show these in the future turns release notes off and closes What's New", async ({ page }) => {
  await serveChangelog(page)
  await start(page, upgraded)
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { level: 1 })).toHaveText("Split panes")
  await dialog.getByRole("button", { name: "Don't show these in the future", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => stored(page, RELEASE_NOTES)).toEqual({ enabled: false })
})

test("What's New ready before the app mounts shows over the restored Settings and keeps focus", async ({ page }) => {
  await serveChangelog(page)
  await mockWorkspace(page, { name: "Whats New", sessions: [], seed: upgraded })
  const app = await openHeldStart(page, "/settings")
  // What's New marks the release seen as it opens, here while the app is still starting.
  await expect.poll(() => stored(page, SEEN)).toEqual({ version: "test" })
  await app.start()

  const dialog = page.getByRole("dialog")
  const focused = () => dialog.evaluate((element) => element.contains(document.activeElement))
  await expect(page.getByTestId("settings-screen")).toBeAttached()
  await expect(dialog.getByRole("heading", { level: 1 })).toHaveText("Split panes")
  await expect.poll(focused).toBe(true)

  for (const key of ["Tab", "Tab", "Tab", "Tab", "Shift+Tab"]) {
    await page.keyboard.press(key)
    await expect.poll(focused).toBe(true)
  }
})

test("a failed changelog request leaves What's New for the next start", async ({ page }) => {
  const failed = Promise.withResolvers<void>()
  const requests: string[] = []

  await page.route("https://opencode.ai/changelog.json", async (route) => {
    requests.push(route.request().url())

    if (requests.length > 1) return route.fulfill({ headers: cors, json: changelog })

    await route.fulfill({ status: 503, headers: cors })
    failed.resolve()
  })

  await start(page, upgraded)
  await failed.promise
  expect(await stored(page, SEEN)).toEqual({ version: "1.9.1" })
  await page.reload()
  await expect(page.getByRole("dialog").getByRole("heading", { level: 1 })).toHaveText("Split panes")
})

// Each start ends with the current version seen and no dialog; only a release in range is worth a changelog request.
for (const row of [
  { name: "the first run only remembers the version", seed: {}, requests: 0 },
  {
    name: "a version seen before, stored as highlights.v1, shows nothing",
    seed: { storage: { "highlights.v1": { version: current } } },
    requests: 0,
  },
  {
    name: "release notes turned off before, in settings.v3, only remember the version",
    seed: { ...upgraded, settings: { general: { releaseNotes: false } } },
    requests: 0,
  },
  {
    name: "a changelog without desktop highlights since the version seen only remembers the version",
    seed: upgraded,
    changelog: cliOnly,
    requests: 1,
  },
]) {
  test(`What's New: ${row.name}`, async ({ page }) => {
    const requests = await serveChangelog(page, row.changelog)
    await start(page, row.seed)
    await expect.poll(() => stored(page, SEEN)).toEqual({ version: current })
    expect(requests).toHaveLength(row.requests)
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })
}

/** Serves this changelog and records each request for it. */
async function serveChangelog(page: Page, body: typeof changelog | typeof cliOnly = changelog) {
  const requests: string[] = []

  await page.route("https://opencode.ai/changelog.json", (route) => {
    requests.push(route.request().url())

    return route.fulfill({ headers: cors, json: body })
  })

  return requests
}

/** Opens Home over one empty project, with this storage, and waits until the window renders. */
async function start(page: Page, seed: SeedInput) {
  await mockWorkspace(page, { name: "Whats New", sessions: [], seed })
  await page.goto("/")
  await expectAppVisible(page.getByRole("button", { name: "Settings", exact: true }))
}

function stored(page: Page, key: string) {
  return page.evaluate((name) => localStorage.getItem(name), key).then((raw) => JSON.parse(raw ?? "null"))
}
