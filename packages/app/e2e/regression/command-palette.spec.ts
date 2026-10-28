import type { OpenCodeEvent } from "@opencode/client/promise"
import { expect, test } from "@playwright/test"
import {
  captureConsoleWarnings,
  openCommandPalette,
  openPaletteWorkspace,
  paletteSession,
} from "../utils/command-palette"

test.use({ serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"] })

test("copies the session ID while file and session searches are still pending", async ({ page }) => {
  const warnings = captureConsoleWarnings(page)
  const { dialog, input } = await openCommandPalette(page)
  const release = Promise.withResolvers<void>()
  await page.route(/\/api\/(session\?|fs\/find\?)/, async (route) => {
    await release.promise
    await route.fallback()
  })
  await input.pressSequentially("copy session")
  const copy = dialog.getByRole("option", { name: "Copy Session ID", exact: true })
  await expect(copy).toHaveAttribute("aria-selected", "true")
  await input.press("Enter")
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(paletteSession.id)
  await expect(page.locator('[data-testid^="toast-v2-"] [data-slot="icon-svg"]')).toBeVisible()
  expect(warnings).toEqual([])
  release.resolve()
})

test("home commands do not wait for session search", async ({ page }) => {
  const { dialog, input } = await openCommandPalette(page, true)
  const release = Promise.withResolvers<void>()
  await page.route("**/api/session?*", async (route) => {
    await release.promise
    await route.fallback()
  })
  await input.fill("open settings")
  await expect(dialog.getByRole("option")).toHaveCount(1)
  await expect(dialog.getByRole("option", { name: /^Open settings/ })).toHaveAttribute("aria-selected", "true")
  await input.press("Enter")
  await expect(page).toHaveURL("/settings")
  await expect(page.getByTestId("settings-screen").getByRole("tab", { name: "Preferences", exact: true })).toBeVisible()
  release.resolve()
})

test("finds a setting and opens Settings with its row in view and highlighted", async ({ page }) => {
  await openPaletteWorkspace(page)
  await page.keyboard.press("Control+K")
  const dialog = page.getByRole("dialog")
  const input = dialog.getByRole("combobox")
  await expect(input).toBeFocused()
  await input.fill("theme")
  await expect(dialog.getByRole("option", { name: /^Theme/ })).toHaveAttribute("aria-selected", "true")

  // Settings list after commands, and the keyboard walks rows in their visual order.
  const searched = Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/session"),
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/fs/find"),
  ])

  await input.fill("model")
  await searched
  const titles = dialog.locator('[data-slot="search-list-header"]')
  await expect(titles.first()).toHaveText("Commands")
  await expect(titles.last()).toHaveText("Settings")
  const options = dialog.getByRole("option")

  for (const index of Array.from({ length: await options.count() }, (_, index) => index)) {
    await expect(options.nth(index)).toHaveAttribute("aria-selected", "true")
    await input.press("ArrowDown")
  }

  await input.fill("theme")
  await expect(dialog.getByRole("option", { name: /^Theme/ })).toHaveAttribute("aria-selected", "true")
  await input.press("Enter")
  await expect(page).toHaveURL("/settings?tab=appearance")
  const row = page.getByTestId("settings-screen").locator('[data-search-target="row"]')
  await expect(row).toContainText("Theme")
  await expect(row).toBeInViewport()
})

test("opens from the Settings page and finds another setting", async ({ page }) => {
  await openPaletteWorkspace(page, true)
  await page.keyboard.press("ControlOrMeta+,")
  await expect(page).toHaveURL("/settings")
  const screen = page.getByTestId("settings-screen")
  await expect(screen.getByRole("tab", { name: "Preferences", exact: true })).toBeVisible()

  await page.keyboard.press("ControlOrMeta+K")
  const dialog = page.getByRole("dialog")
  const input = dialog.getByRole("combobox")
  await expect(input).toBeFocused()
  await input.fill("theme")
  await expect(dialog.getByRole("option", { name: /^Theme/ })).toHaveAttribute("aria-selected", "true")
  await input.press("Enter")
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL("/settings?tab=appearance")
  const row = screen.locator('[data-search-target="row"]')
  await expect(row).toContainText("Theme")
  await expect(row).toBeInViewport()
})

test("lists recent sessions before a query is entered", async ({ page }) => {
  const { dialog } = await openCommandPalette(page, true)
  const session = dialog.getByRole("option", { name: /Palette fixture session/ })
  await expect(dialog.getByText("Recent sessions", { exact: true })).toBeVisible()
  await expect(session).toHaveAttribute("aria-selected", "false")
  await session.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()
})

test("titlebar search lists recent sessions and opens the typed match", async ({ page }) => {
  await openPaletteWorkspace(page, true)
  await page.getByRole("banner").getByRole("button", { name: "Search sessions", exact: true }).click()
  const dialog = page.getByRole("dialog")
  const input = dialog.getByRole("combobox")
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute("placeholder", "Search sessions")
  await expect(dialog.getByText("Recent sessions", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("option", { name: /Palette fixture session/ })).toHaveAttribute("aria-selected", "true")
  // Session search lists sessions only, never commands.
  await input.fill("settings")
  await expect(dialog.getByText("No results found", { exact: true })).toBeVisible()
  await input.fill("Palette fixture")
  await expect(dialog.getByRole("option")).toHaveCount(1)
  await input.press("Enter")
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()
})

test("Search commands lists only commands and runs the chosen one", async ({ page }) => {
  const { dialog, input } = await openCommandPalette(page, true)
  await input.fill("search commands")
  await dialog.getByRole("option", { name: /^Search commands/ }).click()
  const search = page.getByRole("dialog").getByRole("combobox")
  await expect(search).toHaveAttribute("placeholder", "Search commands")
  await expect(search).toBeFocused()
  await expect(page.getByRole("dialog").getByRole("option", { name: /^Open settings/ })).toBeVisible()
  await search.fill("Palette fixture")
  await expect(page.getByRole("dialog").getByText("No results found", { exact: true })).toBeVisible()
  await search.fill("open settings")
  await expect(page.getByRole("dialog").getByRole("option")).toHaveCount(1)
  await search.press("Enter")
  await expect(page).toHaveURL("/settings")
})

test("Search projects opens a new session's project picker from a session and from Home", async ({ page }) => {
  const editor = page.locator('[data-component="composer-editor"]')
  const picker = page.getByRole("combobox", { name: "Search projects", exact: true })
  const { dialog, input } = await openCommandPalette(page)
  await input.fill("search projects")
  await dialog.getByRole("option", { name: /^Search projects/ }).click()
  await expect(page).toHaveURL(/\/new-session\?draftId=.+$/)
  await expect(picker).toBeFocused()
  // Just the projects: no "Add project", no worktrees and no key hints.
  const projects = page.getByRole("dialog").getByRole("option")
  await expect(projects).toHaveCount(1)
  await expect(projects).toHaveText(/command-palette/)
  await expect(projects.getByRole("button", { name: "Worktrees", exact: true })).toHaveCount(0)
  await expect(page.locator(".new-session-location-hints")).toHaveCount(0)
  await picker.press("Escape")
  await expect(picker).toHaveCount(0)
  await expect(editor).toBeFocused()

  await page.goto("/")
  await expect(
    page.getByRole("region", { name: "Recent sessions" }).getByRole("button", { name: /Palette fixture session/ }),
  ).toBeEnabled()
  await page.keyboard.press("ControlOrMeta+Shift+O")
  await expect(page).toHaveURL(/\/new-session\?draftId=.+$/)
  await expect(picker).toBeFocused()
})

declare global {
  interface Window {
    __paletteOrders?: string[][]
  }
}

test("titlebar search opens recent sessions in the server's order on every open", async ({ page }) => {
  const busy = { ...paletteSession, time: { ...paletteSession.time } }

  const fresh = {
    ...paletteSession,
    id: "ses_command_palette_fresh",
    title: "Fresh fixture session",
    time: { created: 1700000001000, updated: 1700000001000 },
  }

  const mock = await openPaletteWorkspace(page, true, [busy, fresh])
  // A step starts after Home loaded its index, so the server now lists the busy session first.
  busy.time.updated = 1700000002000
  // SAFETY: a step in a session whose transcript is not open; only its session ID and time matter here.
  await mock.push([
    {
      id: "evt_busy_step",
      created: busy.time.updated,
      type: "session.step.started",
      durable: { aggregateID: busy.id, seq: 1, version: 1 },
      location: { directory: busy.directory },
      data: {
        sessionID: busy.id,
        assistantMessageID: "msg_busy_step",
        agent: "build",
        model: { providerID: "test", id: "test" },
        started: busy.time.updated,
      },
    } as OpenCodeEvent,
  ])
  const home = page.getByRole("region", { name: "Recent sessions" }).getByRole("button", { name: /fixture session/ })
  await expect(home).toHaveText([/Palette fixture session/, /Fresh fixture session/])

  await page.evaluate(() => {
    const seen: string[][] = []
    window.__paletteOrders = seen

    new MutationObserver(() => {
      const order = [...document.querySelectorAll('[role="dialog"] [role="option"] .command-palette-title')].map(
        (title) => title.textContent ?? "",
      )

      if (order.length > 0 && order.join() !== seen.at(-1)?.join()) seen.push(order)
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })

  const dialog = page.getByRole("dialog")

  const openAndClose = async () => {
    const listed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/session")
    await page.getByRole("banner").getByRole("button", { name: "Search sessions", exact: true }).click()
    await listed
    await expect(dialog.getByRole("option")).toHaveText([/Palette fixture session/, /Fresh fixture session/])
    await dialog.getByRole("combobox").press("Escape")
    await expect(dialog).toHaveCount(0)
  }

  await openAndClose()
  await openAndClose()

  expect(await page.evaluate(() => window.__paletteOrders)).toEqual([[paletteSession.title, fresh.title]])
})

const olderSession = {
  ...paletteSession,
  id: "ses_command_palette_older",
  title: "Older fixture session",
  time: { created: 1699999999000, updated: 1699999999000 },
}

test("titlebar search drops a recent session deleted while it is open", async ({ page }) => {
  const mock = await openPaletteWorkspace(page, true, [paletteSession, olderSession])
  await page.getByRole("banner").getByRole("button", { name: "Search sessions", exact: true }).click()
  const options = page.getByRole("dialog").getByRole("option")
  await expect(options).toHaveText([/Palette fixture session/, /Older fixture session/])
  await mock.push([
    {
      id: "evt_older_deleted",
      created: 1700000003000,
      type: "session.deleted",
      durable: { aggregateID: olderSession.id, seq: 1, version: 2 },
      location: { directory: olderSession.directory },
      data: { sessionID: olderSession.id },
    },
  ])
  await expect(options).toHaveText([/Palette fixture session/])
})

test("reopens from its shortcut as soon as it closes", async ({ page }) => {
  const { dialog, input } = await openCommandPalette(page)
  await input.press("Escape")
  await expect(dialog).toHaveCount(0)
  // A closed dialog stops blocking shortcuts when it leaves the screen, not when it is disposed afterwards.
  await page.keyboard.press("ControlOrMeta+Shift+P")
  await expect(dialog.getByRole("combobox")).toBeFocused()
})

test("appends search results without resetting the selected command", async ({ page }) => {
  const { dialog, input } = await openCommandPalette(page)
  const files = Promise.withResolvers<void>()
  const sessions = Promise.withResolvers<void>()
  await page.route("**/api/fs/find?*", async (route) => {
    await files.promise
    await route.fulfill({ json: { data: [{ path: "copy.txt", type: "file" }] } })
  })
  await page.route("**/api/session?*", async (route) => {
    await sessions.promise
    // Like the server, only a matching title answers, so the session leaves the results for "copy session".
    const search = new URL(route.request().url()).searchParams.get("search") ?? ""
    await route.fulfill({
      json: {
        data: "copy fixture".includes(search.toLowerCase())
          ? [{ ...paletteSession, location: { directory: paletteSession.directory }, title: "Copy fixture" }]
          : [],
      },
    })
  })
  await input.fill("copy")
  const project = dialog.getByRole("option", { name: "Copy Project ID", exact: true })
  await expect(project).toBeVisible()
  // Select a non-first command with the keyboard before remote results arrive.
  await input.press("ArrowDown")
  await expect(project).toHaveAttribute("aria-selected", "true")
  files.resolve()
  await expect(dialog.getByRole("option", { name: "/ copy.txt", exact: true })).toBeVisible()
  await expect(project).toHaveAttribute("aria-selected", "true")
  // File results are usable even while sessions are still pending.
  sessions.resolve()
  await expect(dialog.getByRole("option", { name: /Copy fixture/ })).toBeVisible()
  await expect(project).toHaveAttribute("aria-selected", "true")
  await input.fill("copy session")
  await expect(dialog.getByRole("option", { name: "Copy Session ID", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(dialog.getByRole("option", { name: "Copy Project ID", exact: true })).toHaveCount(0)
})

test("lists matching sessions above commands and jumps between sections with Alt and the arrows", async ({ page }) => {
  const { dialog, input } = await openCommandPalette(page)
  await page.route("**/api/session?*", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            ...paletteSession,
            id: "ses_palette_copy",
            location: { directory: paletteSession.directory },
            title: "Copy fixture",
          },
        ],
      },
    }),
  )
  await input.fill("copy")
  const session = dialog.getByRole("option", { name: /Copy fixture/ })
  await expect(session).toHaveAttribute("aria-selected", "true")
  await expect(dialog.locator('[data-slot="search-list-header"]').first()).toHaveText("Session")
  const commands = dialog.getByRole("group", { name: "Commands", exact: true }).getByRole("option")
  await input.press("Alt+ArrowDown")
  await expect(commands.first()).toHaveAttribute("aria-selected", "true")
  await input.press("ArrowDown")
  await input.press("Alt+ArrowUp")
  await expect(commands.first()).toHaveAttribute("aria-selected", "true")
  await input.press("Alt+ArrowUp")
  await expect(session).toHaveAttribute("aria-selected", "true")
})

test("selects the first session when it arrives above automatically selected files", async ({ page }) => {
  const { dialog, input } = await openCommandPalette(page)
  const sessions = Promise.withResolvers<void>()
  await page.route("**/api/fs/find?*", (route) =>
    route.fulfill({ json: { data: [{ path: "README.md", type: "file" }] } }),
  )
  await page.route("**/api/session?*", async (route) => {
    await sessions.promise
    await route.fulfill({
      json: {
        data: Array.from({ length: 18 }, (_, index) => ({
          ...paletteSession,
          id: index === 0 ? paletteSession.id : `ses_palette_readme_${index}`,
          location: { directory: paletteSession.directory },
          title: `README work ${index + 1}`,
        })),
      },
    })
  })
  await input.fill("README")
  await expect(dialog.getByRole("option", { name: "/ README.md", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  sessions.resolve()
  const first = dialog.getByRole("option", { name: /README work 1 command-palette/ })
  const second = dialog.getByRole("option", { name: /README work 2 command-palette/ })
  await expect(first).toHaveAttribute("aria-selected", "true")
  await expect(first).toBeInViewport()
  await input.press("ArrowDown")
  await expect(second).toHaveAttribute("aria-selected", "true")
  await expect(second).toBeInViewport()
  await input.press("ArrowUp")
  await expect(first).toHaveAttribute("aria-selected", "true")
  await input.press("Enter")
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()
})

test("keeps a keyboard-selected file when session results arrive later", async ({ page }) => {
  const warnings = captureConsoleWarnings(page)
  const { dialog, input } = await openCommandPalette(page)
  const sessions = Promise.withResolvers<void>()
  await page.route("**/api/fs/find?*", (route) =>
    route.fulfill({
      json: {
        data: [
          { path: "README.txt", type: "file" },
          { path: "README.md", type: "file" },
        ],
      },
    }),
  )
  await page.route("**/api/session?*", async (route) => {
    await sessions.promise
    await route.fulfill({
      json: {
        data: [{ ...paletteSession, location: { directory: paletteSession.directory }, title: "README work" }],
      },
    })
  })
  await input.fill("README")
  const file = dialog.getByRole("option", { name: "/ README.md", exact: true })
  await expect(dialog.getByRole("option", { name: "/ README.txt", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await input.press("ArrowDown")
  await expect(file).toHaveAttribute("aria-selected", "true")
  sessions.resolve()
  await expect(dialog.getByRole("option", { name: /README work/ })).toBeVisible()
  await expect(file).toHaveAttribute("aria-selected", "true")
  await input.press("Enter")
  await expect(dialog).toHaveCount(0)
  const tab = page.getByRole("tab", { name: "README.md", exact: true })
  await expect(tab).toBeVisible()
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()
  await page
    .getByRole("complementary", { name: "Review and files" })
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await expect(tab).toHaveCount(0)
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()
  // The duplicate command ID warning is DEV-only, so only dev-server runs can catch duplicate tab commands here.
  expect(warnings).toEqual([])
})

test("navigation replaces commands without retaining disposed owners", async ({ page }) => {
  const warnings = captureConsoleWarnings(page)
  const palette = await openCommandPalette(page, true)
  await palette.input.press("Escape")
  await expect(palette.dialog).toHaveCount(0)
  await page
    .getByRole("region", { name: "Recent sessions" })
    .getByRole("button", { name: /Palette fixture session/ })
    .click()
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toBeEditable()
  await page.keyboard.press("ControlOrMeta+t")
  await expect(page).toHaveURL(/\/new-session\?/)
  await expect(editor).toBeEditable()
  await editor.blur()
  await page.keyboard.press("Control+l")
  await expect(editor).toBeFocused()
  await page.keyboard.press("ControlOrMeta+Shift+P")
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("combobox")).toBeFocused()
  await expect(dialog.getByRole("combobox")).toHaveAttribute("placeholder", "Search files, commands, and sessions")
  await dialog.getByRole("combobox").fill("copy session")
  await expect(dialog.getByRole("option", { name: "Copy Session ID", exact: true })).toHaveCount(0)
  await dialog.getByRole("combobox").press("Escape")
  await expect(dialog).toHaveCount(0)
  const tabs = page.locator("[data-titlebar-tab-link]")
  await tabs.filter({ hasText: paletteSession.title }).click()
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()

  for (const count of [3, 4]) {
    await page.getByRole("button", { name: "New session", exact: true }).click()
    await expect(tabs).toHaveCount(count)
    await expect(editor).toBeEditable()
  }

  await page.setViewportSize({ width: 600, height: 800 })
  await page.locator('[data-slot="mobile-tabs-trigger"]').click()
  await expect(page.locator('[data-slot="mobile-tabs-drawer"] [data-titlebar-tab-link]')).toHaveCount(4)
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('[data-slot="titlebar-tabs"] [data-titlebar-tab-link]')).toHaveCount(4)
  const active = new URL(page.url())
  const closing = page.locator(`[data-titlebar-tab-link][href="${active.pathname}${active.search}"]`)
  await expect(closing).toHaveCount(1)
  await page.keyboard.press("ControlOrMeta+w")
  await expect(tabs).toHaveCount(3)
  await expect(closing).toHaveCount(0)
  await expect(tabs.filter({ hasText: paletteSession.title })).toHaveCount(1)
  await tabs.filter({ hasText: paletteSession.title }).click()
  await expect(page.getByRole("heading", { name: paletteSession.title, exact: true })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+Shift+P")
  await expect(dialog.getByRole("combobox")).toBeFocused()
  await dialog.getByRole("combobox").fill("copy session")
  await expect(dialog.getByRole("option", { name: "Copy Session ID", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  expect(warnings).toEqual([])
})

test("keeps matching session and file results steady across keystrokes while searches are pending", async ({
  page,
}) => {
  await openPaletteWorkspace(page)
  const mac = await page.evaluate(() => /(Mac|iPod|iPhone|iPad)/.test(navigator.platform))
  await page.keyboard.press(mac ? "Meta+Shift+P" : "Control+Shift+P")
  const dialog = page.getByRole("dialog")
  const input = dialog.getByRole("combobox")
  await expect(input).toBeFocused()
  const sessionOption = dialog.getByRole("option", { name: /Palette fixture session/ })
  const matchingFile = dialog.getByRole("option", { name: "packages/desktop/ palette.ts", exact: true })
  const nonMatchingFile = dialog.getByRole("option", { name: "src/app/ other.ts", exact: true })
  await expect(sessionOption).toBeVisible()

  const pendingFiles = Promise.withResolvers<void>()
  const pendingSessions = Promise.withResolvers<void>()

  await page.route("**/api/fs/find?*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("query") ?? ""

    if (query !== "p") await pendingFiles.promise
    await route.fulfill({
      json: {
        data:
          query === "p"
            ? [
                { path: "packages/desktop/palette.ts", type: "file" },
                { path: "src/app/other.ts", type: "file" },
              ]
            : [{ path: "packages/desktop/palette.ts", type: "file" }],
      },
    })
  })

  await page.route("**/api/session?*", async (route) => {
    await pendingSessions.promise
    await route.fulfill({
      json: {
        data: [{ ...paletteSession, location: { directory: paletteSession.directory } }],
      },
    })
  })

  await input.press("p")
  await expect(matchingFile).toBeVisible()
  await expect(nonMatchingFile).toBeVisible()
  await expect(sessionOption).toBeVisible()

  const probe = await page.evaluateHandle(() => {
    const results = document.querySelector('[role="dialog"] [data-slot="search-list-scroll"]')!

    const state = {
      emptyFrames: 0,
      initialSessionEl:
        Array.from(results.querySelectorAll('[role="option"]')).find((el) =>
          el.textContent?.includes("Palette fixture session"),
        ) ?? null,
      initialFileEl:
        Array.from(results.querySelectorAll('[role="option"]')).find((el) => el.textContent?.includes("palette.ts")) ??
        null,
    }

    const observer = new MutationObserver(() => {
      if (
        results.querySelectorAll('[role="option"]').length === 0 ||
        results.querySelector('[data-slot="search-list-empty"]')
      ) {
        state.emptyFrames++
      }
    })

    observer.observe(results, { childList: true, subtree: true })

    return {
      finish() {
        observer.disconnect()

        const currentSessionEl = Array.from(results.querySelectorAll('[role="option"]')).find((el) =>
          el.textContent?.includes("Palette fixture session"),
        )

        const currentFileEl = Array.from(results.querySelectorAll('[role="option"]')).find((el) =>
          el.textContent?.includes("palette.ts"),
        )

        return {
          emptyFrames: state.emptyFrames,
          sameSessionNode: Boolean(state.initialSessionEl && state.initialSessionEl === currentSessionEl),
          sameFileNode: Boolean(state.initialFileEl && state.initialFileEl === currentFileEl),
        }
      },
    }
  })

  for (const key of "alette") {
    await input.press(key)
    await expect(sessionOption).toBeVisible()
    await expect(matchingFile).toBeVisible()
    await expect(nonMatchingFile).toHaveCount(0)
  }

  await expect(sessionOption).toHaveAttribute("aria-selected", "true")

  pendingFiles.resolve()
  pendingSessions.resolve()

  await expect(sessionOption).toBeVisible()
  await expect(matchingFile).toBeVisible()

  const stability = await probe.evaluate((tracker) => tracker.finish())

  expect(stability).toEqual({
    emptyFrames: 0,
    sameSessionNode: true,
    sameFileNode: true,
  })
})

test("keeps the same height as the number of results changes", async ({ page }) => {
  const { dialog, input } = await openCommandPalette(page)
  const container = page.locator('[data-component="dialog-v2"] [data-slot="dialog-container"]')
  const height = async () => (await container.boundingBox())?.height
  const initial = await height()
  expect(initial).toBe(480)

  await input.fill("copy session")
  await expect(dialog.getByRole("option")).toHaveCount(1)
  expect(await height()).toBe(initial)

  await input.fill("zzzz no palette match")
  await expect(dialog.getByText("No results found")).toBeVisible()
  expect(await height()).toBe(initial)
})
