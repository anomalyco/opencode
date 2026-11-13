import { expect, test, type Locator, type Page } from "@playwright/test"
import type { OpenCodeEvent, SessionMessageInfo, WorktreeDirectory } from "@opencode/client/promise"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { draftHref, expectPath, holdRoute, NO_PROVIDER, project, provider, seed, sessionHref, T0 } from "../utils/app"
import { mockOpenCodeServer } from "../utils/mock-server"
import {
  newSessionBranch,
  newSessionLocation,
  openDraft,
  openSession,
  openWorktreeDraft,
  type WorkspaceInput,
} from "../utils/workspace"

const directory = "C:/OpenCode/WorkspacePending"

const workspace = "C:/OpenCode/pending-workspace"

const projectID = "proj_workspace_pending"

const draftID = "draft_workspace_pending"

const otherID = "ses_workspace_pending_other"

const text = "Create the workspace, then explain the pending session."

const followUp = "Then explain the setup scripts.\nInclude the install command."

const headers = { "access-control-allow-origin": "*" }

const editor = (page: Page) => page.locator('[data-component="composer-editor"]')

const submit = (page: Page) => page.locator('[data-action="composer-submit"]')

const tabLink = (page: Page, sessionID: string) =>
  page.locator(`[data-titlebar-tab-link][href="${sessionHref(sessionID)}"]`)

// A draft on the local project (C:/OpenCode/WorkspacePending) beside one other session tab.
const pendingDraft = {
  name: "WorkspacePending",
  draftID,
  project: { id: projectID, name: "workspace-pending" },
  provider: provider({ id: "pending-model", name: "Pending Model" }),
  sessions: [{ id: otherID, title: "Other session" }],
  createdSessionTitle: "Created workspace session",
} satisfies WorkspaceInput & { draftID: string }

const failFirstCreate: NonNullable<WorkspaceInput["onSessionCreate"]> = (_body, attempt) =>
  attempt === 1 ? { status: 500, body: { message: "Session creation failed in the fixture" } } : undefined

test.use({
  serviceWorkers: "block",
  viewport: { width: 1280, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
})

test("the new session screen does not show session details", async ({ page }) => {
  await openDraft(page, { name: "Summary" })
  await expect(page.getByRole("button", { name: "Session details", exact: true })).toHaveCount(0)
})

test("the location shortcuts choose worktrees from every state and keep cycling", async ({ page }) => {
  const root = "C:/OpenCode/LocationShortcut"

  const existing = `${root}/.worktrees/quiet-river`

  const view = await openDraft(page, {
    name: "LocationShortcut",
    worktrees: () => [{ directory: root }, { directory: existing, strategy: "git" }],
    vcs: (directory) =>
      directory === existing ? { current: "fix-login", default: "main" } : { current: "main", default: "main" },
  })

  const modifier = await page.evaluate(() => (/Mac/i.test(navigator.platform) ? "Meta" : "Control"))

  const path = page.locator('[data-slot="new-session-location-path"]')

  const search = page.getByRole("combobox", { name: "Search worktrees", exact: true })

  const screen = page.locator('[data-component="new-session"]')

  const expectBranchOnly = async () => {
    await expect(screen).not.toContainText("Local")
    await expect(screen).not.toContainText("New worktree")
    await expect(screen).not.toContainText("from ")
    await expect(screen.locator('[data-action="prompt-worktree"]')).toHaveCount(0)
  }

  await expect(path).toHaveText(root)
  await expect(newSessionBranch(page)).toHaveText("main")
  await expectBranchOnly()
  await view.editor.press(`${modifier}+Alt+KeyO`)
  await expect(search).toBeFocused()
  await page.getByRole("option", { name: /^quiet-river / }).click()
  await expect(view.editor).toBeFocused()
  await expect(path).toHaveText(existing)
  await expect(newSessionBranch(page)).toHaveText("fix-login")
  await expectBranchOnly()
  await view.editor.press(`${modifier}+Alt+KeyO`)
  await expect(search).toBeFocused()
  await page.getByRole("option", { name: /LocationShortcut main C:\/OpenCode\/LocationShortcut$/ }).click()
  await expect(newSessionBranch(page)).toHaveText("main")
  await expect(path).toHaveText(root)
  await view.editor.press(`${modifier}+Alt+KeyL`)
  await expect(newSessionBranch(page)).toHaveText("main")
  await expect(path).toHaveText(root)
  await expectBranchOnly()
  await view.editor.press(`${modifier}+Alt+KeyO`)
  await expect(search).toBeFocused()
  await page.getByRole("option", { name: /^quiet-river / }).click()
  await expect(path).toHaveText(existing)
  await expect(newSessionBranch(page)).toHaveText("fix-login")
  await expect(view.editor).toBeFocused()
})

test("a draft opened in a worktree starts on the main checkout and targets it", async ({ page }) => {
  const root = "C:/OpenCode/LocalFromWorktree"

  const worktree = `${root}/.worktrees/quiet-river`

  const created: unknown[] = []

  const view = await openDraft(page, {
    name: "LocalFromWorktree",
    project: { sandboxes: [worktree] },
    worktrees: () => [{ directory: root }, { directory: worktree, strategy: "git" }],
    vcs: (directory) =>
      directory === worktree
        ? { current: "worktree-branch", default: "dev" }
        : { current: "checkout-branch", default: "dev" },
    onSessionCreate: (body) => void created.push(body.location),
    seed: { tabs: [{ draft: "draft_localfromworktree", directory: worktree }] },
  })

  const screen = page.locator('[data-component="new-session"]')

  await expect(newSessionBranch(page)).toHaveText("checkout-branch")
  await expect(page.locator('[data-slot="new-session-location-path"]')).toHaveText(root)
  await expect(screen.getByText("worktree-branch", { exact: true })).toHaveCount(0)
  await view.editor.fill("Run in the main checkout")
  await submit(page).click()
  await expect.poll(() => created).toEqual([{ directory: root }])
})

test("the branch chip holds a placeholder while the checkout loads, then reads No branch without one", async ({
  page,
}) => {
  const vcs = Promise.withResolvers<Awaited<ReturnType<typeof holdRoute>>>()

  await openDraft(page, {
    name: "DetachedCheckout",
    vcs: { default: "main" },
    beforeOpen: async () => {
      vcs.resolve(await holdRoute(page, /\/api\/vcs\?/))
    },
  })

  const held = await vcs.promise
  const trigger = newSessionBranch(page)

  await held.arrived
  await expect(trigger).toHaveAttribute("aria-busy", "true")
  await expect(trigger).toHaveAccessibleName("Choose worktree")
  held.release()
  await expect(trigger).not.toHaveAttribute("aria-busy", "true")
  await expect(trigger).toHaveText("No branch")
  await expect(trigger).toHaveAccessibleName("No branch")
  await trigger.click()
  await expect(page.getByRole("combobox", { name: "Search worktrees", exact: true })).toBeFocused()
})

for (const binding of ["custom", "none"]) {
  test(`the picker tooltips reflect ${binding} shortcuts`, async ({ page }) => {
    const view = await openDraft(page, {
      name: "PickerShortcuts",
      seed: {
        settings: {
          keybinds: {
            "project.select": binding === "custom" ? "mod+alt+p" : "none",
            "session.location.select": binding === "custom" ? "mod+alt+x" : "none",
            "session.location.cycle": binding === "custom" ? "mod+alt+k" : "none",
          },
        },
      },
    })

    const tooltip = page.getByRole("tooltip").and(page.locator("[data-expanded]"))

    const keys = tooltip.locator('[data-component="keybind-v2"]')

    await newSessionLocation(page).hover()
    await expect(tooltip).toContainText("Choose project")

    await expect(keys).toHaveText(binding === "custom" ? [/P$/] : [])
    await newSessionBranch(page).hover()
    await expect(tooltip).toContainText("Isolate sessions with worktrees")

    await expect(keys).toHaveText(binding === "custom" ? [/X$/] : [])

    const modifier = await page.evaluate(() => (/Mac/i.test(navigator.platform) ? "Meta" : "Control"))

    if (binding === "none") {
      await view.editor.press(`${modifier}+Alt+o`)
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await expect(newSessionBranch(page)).toHaveText("main")

      return
    }

    await view.editor.press(`${modifier}+Alt+k`)
    await expect(newSessionBranch(page)).toHaveText("main")
    await view.editor.press(`${modifier}+Alt+x`)
    const search = page.getByRole("combobox", { name: "Search worktrees", exact: true })

    await expect(search).toBeFocused()
    await search.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(newSessionBranch(page)).toHaveText("main")
    await expect(view.editor).toBeFocused()
    await view.editor.press(`${modifier}+Alt+p`)
    await expect(page.getByRole("combobox", { name: "Search projects", exact: true })).toBeFocused()
  })
}

test("the worktree picker shortcut is disabled for non-Git projects", async ({ page }) => {
  const view = await openDraft(page, { name: "NoWorktrees", project: { vcs: undefined } })

  const screen = page.locator('[data-component="new-session"]')

  const modifier = await page.evaluate(() => (/Mac/i.test(navigator.platform) ? "Meta" : "Control"))

  await expect(newSessionBranch(page)).toHaveCount(0)
  await expect(screen.getByText("main", { exact: true })).toHaveCount(0)
  await view.editor.press(`${modifier}+Alt+o`)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await view.editor.press(`${modifier}+Alt+b`)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await view.editor.fill("Keep working locally")
  await expect(view.editor).toHaveText("Keep working locally")
})

test("a detached HEAD keeps the branch chip and opens the worktree step", async ({ page }) => {
  const view = await openDraft(page, {
    name: "DetachedHead",
    // SAFETY: the mock reads `current` for the chip; an absent branch is how git reports a detached HEAD.
    vcs: () => ({ current: undefined as never, default: "main" }),
  })

  const dialog = page.getByRole("dialog")
  const search = dialog.getByRole("combobox", { name: "Search worktrees", exact: true })

  await expect(newSessionBranch(page)).toHaveText("No branch")
  await expect(page.locator('[data-slot="new-session-location-path"]')).toHaveText(view.directory)
  await newSessionBranch(page).click()
  await expect(search).toBeFocused()
  await expect(dialog.getByRole("option", { name: /^from No branch/ })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})

test("picker scrollbars overlay full-width rows and support dragging", async ({ page }) => {
  const root = "C:/OpenCode/OverlayMenus"

  await openDraft(page, {
    name: "OverlayMenus",
    worktrees: () => [
      { directory: root },
      ...Array.from({ length: 24 }, (_, index) => ({
        directory: `${root}/worktree-${index}`,
        strategy: "git" as const,
      })),
    ],
  })
  await newSessionBranch(page).click()
  await expect(page.getByRole("combobox", { name: "Search worktrees", exact: true })).toBeFocused()

  const menu = page.locator('[data-component="menu-scroll"]')

  const viewport = menu.locator('[data-slot="menu-scroll-viewport"]')

  const thumb = menu.locator('[data-slot="menu-scroll-thumb"]')

  await menu.hover()
  await expect(thumb).toHaveCSS("opacity", "0")
  await page.mouse.wheel(0, 100)
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await expect(thumb).toHaveCSS("opacity", "1")
  await expect(thumb).toHaveCSS("opacity", "0")

  await page.mouse.wheel(0, 100)
  await expect(thumb).toHaveCSS("opacity", "1")
  await thumb.hover()
  await expect(menu).not.toHaveAttribute("data-scrolling")
  await expect(thumb).toHaveCSS("opacity", "1")

  const track = (await menu.boundingBox())!

  const handle = (await thumb.boundingBox())!

  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, track.y + track.height - 4)
  await page.mouse.up()
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop > 0)).toBe(true)
  await expect(page.getByRole("option", { name: /^worktree-23 / })).toBeInViewport()
  await thumb.hover()
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, track.y + 4)
  await page.mouse.up()
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBe(0)
})

for (const row of [
  {
    name: "POSIX",
    directory: "/Users/alice/.local/share/opencode/worktree/123456/my-project",
    pattern: /^\/Users\/.*…\/123456\/my-project$/,
  },
  {
    name: "Windows",
    directory: "C:\\Users\\alice\\Documents\\opencode\\worktree\\123456\\my-project",
    pattern: /^C:\\.*…\\123456\\my-project$/,
  },
]) {
  test(`the location path keeps its start and final two segments on ${row.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 700 })
    await openDraft(page, { name: "A project with a long name", directory: row.directory })
    const path = page.locator('[data-slot="new-session-location-path"]')
    await expect(path).toHaveText(row.pattern)
    await expect.poll(() => path.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await path.hover()
    await expect(page.getByRole("tooltip")).toHaveText(row.directory)

    if (row.name !== "POSIX") return
    await expect(path).toHaveCSS("user-select", "text")
    await path.click()
    await path.evaluate((element) => {
      const range = document.createRange()

      range.selectNodeContents(element)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    })
    const modifier = await page.evaluate(() => (/Mac/i.test(navigator.platform) ? "Meta" : "Control"))

    await page.keyboard.press(`${modifier}+c`)
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(row.directory)
  })
}

test("the dialog chooses the base branch for a new worktree", async ({ page }) => {
  const listed = Promise.withResolvers<string[]>()
  const searches: { directory: string; search?: string; limit?: number }[] = []

  const view = await openWorktreeDraft(page, {
    name: "BranchContext",
    project: { name: "Custom project" },
    vcs: () => ({ current: "timeline-quotes", default: "main" }),
    branches: (input) => {
      searches.push(input)

      return listed.promise
    },
  })

  const screen = page.locator('[data-component="new-session"]')
  const dialog = page.getByRole("dialog")
  const search = dialog.getByRole("combobox", { name: "Search branches", exact: true })
  const options = dialog.getByRole("option")

  await expect(newSessionBranch(page)).toHaveText("timeline-quotes")
  await expect(page.locator('[data-slot="new-session-location-path"]')).toHaveText(view.directory)
  await expect(screen).not.toContainText("from ")
  await expect(screen).not.toContainText("New worktree")
  await expect(screen).not.toContainText("Local")

  await newSessionBranch(page).click()
  const base = dialog.getByRole("option", { name: /^from timeline-quotes/ })
  await expect(base).toBeVisible()
  await base.click()
  await expect(search).toBeFocused()
  listed.resolve(["timeline-quotes", "release/base", "origin/dev"])
  await expect(search).not.toHaveAttribute("aria-busy", "true")
  await expect(page.getByRole("option", { name: "release/base", exact: true })).toBeVisible()
  await search.fill("release")
  await expect(search).not.toHaveAttribute("aria-busy", "true")
  await expect(page.getByRole("option")).toHaveText(["release/base"])
  await page.getByRole("option", { name: "release/base", exact: true }).click()

  // Choosing a base returns to the worktree step with that branch selected.
  await expect(dialog.getByRole("option", { name: /^from release\/base/ })).toBeVisible()
  await expect(search).toHaveCount(0)
  await dialog.getByRole("option", { name: /^New worktree/ }).click()
  await expect(dialog).toHaveCount(0)
  await expect(newSessionBranch(page)).toHaveText("release/base")
  await expect(page.locator('[data-slot="new-session-location-path"]')).toHaveText(view.directory)

  await view.editor.fill("Use the selected base")
  await submit(page).click()
  await expect
    .poll(() => view.worktreeRequests.map((request) => request.body))
    .toEqual([expect.objectContaining({ from: view.directory, branch: "release/base" })])
  expect(searches).toContainEqual({ directory: view.directory, search: "release", limit: 50 })
  view.worktree.resolve({ status: 200, json: { directory: "C:/OpenCode/BranchContext/.worktrees/stellar-orchid" } })
  await expect
    .poll(() => view.prompts)
    .toEqual([expect.objectContaining({ body: expect.objectContaining({ text: "Use the selected base" }) })])
})

test("the checkout branch opens the current project's worktree step", async ({ page }) => {
  const existing = "C:/OpenCode/BranchWorktrees/.worktrees/quiet-river"

  const view = await openDraft(page, {
    name: "BranchWorktrees",
    vcs: (directory) => ({ current: directory === existing ? "quiet-river-branch" : "dev", default: "main" }),
    worktrees: () => [{ directory: "C:/OpenCode/BranchWorktrees" }, { directory: existing, strategy: "git" }],
  })

  const screen = page.locator('[data-component="new-session"]')
  // The checkout branch is the worktree control; once a worktree is chosen its trigger shows the name.
  const branch = newSessionBranch(page)
  const dialog = page.getByRole("dialog")
  const search = dialog.getByRole("combobox", { name: "Search worktrees", exact: true })
  const options = dialog.getByRole("option")
  const back = dialog.getByRole("button", { name: "Back to projects", exact: true })

  await expect(screen.getByText("Local", { exact: true })).toHaveCount(0)
  await branch.click()
  await expect(search).toBeFocused()
  await expect(back).toHaveText("Run session in")
  await expect(options.locator(".command-palette-title")).toHaveText([
    "BranchWorktrees",
    "New worktree",
    "from dev",
    "quiet-river",
  ])
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true")

  // Stepping back lands on the projects step with the drilled project active, as after drilling in with →.
  await search.press("Backspace")
  const projects = dialog.getByRole("combobox", { name: "Search projects", exact: true })
  await expect(projects).toBeFocused()
  await expect(back).toHaveCount(0)
  await expect(options.filter({ hasText: "BranchWorktrees" })).toHaveAttribute("aria-selected", "true")
  await projects.press("ArrowRight")
  await expect(search).toBeFocused()
  await search.press("Escape")
  await expect(projects).toBeFocused()
  await projects.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(view.editor).toBeFocused()

  // A directly opened worktree picker closes on Escape without showing projects first.
  await branch.focus()
  await page.keyboard.press("Enter")
  await expect(search).toBeFocused()
  await search.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(view.editor).toBeFocused()

  // Drilling in from the project picker still makes Escape step back.
  await newSessionLocation(page).click()
  await expect(projects).toBeFocused()
  await projects.press("ArrowRight")
  await expect(search).toBeFocused()
  await search.press("Escape")
  await expect(projects).toBeFocused()
  await projects.press("Escape")
  await expect(dialog).toHaveCount(0)

  await branch.click()
  await options.filter({ hasText: "quiet-river" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(newSessionBranch(page)).toHaveText("quiet-river-branch")
  await expect(page.locator('[data-slot="new-session-location-path"]')).toHaveText(existing)
  await expect(view.editor).toBeFocused()

  // Reopening from the worktree starts New worktree from the checkout's branch, not the worktree's.
  await newSessionBranch(page).click()
  await expect(dialog.getByRole("option", { name: /^from dev/ })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})

test("the branch shortcut opens the base branch step", async ({ page }) => {
  const view = await openDraft(page, {
    name: "BranchShortcut",
    vcs: () => ({ current: "dev", default: "dev" }),
    branches: () => ["dev", "release/base"],
  })

  const modifier = await page.evaluate(() => (/Mac/i.test(navigator.platform) ? "Meta" : "Control"))

  const dialog = page.getByRole("dialog")
  const search = page.getByRole("combobox", { name: "Search branches", exact: true })

  await view.editor.press(`${modifier}+Alt+KeyB`)
  await expect(search).toBeFocused()
  await expect(page.getByRole("option")).toHaveText(["dev", "release/base"])
  await search.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(view.editor).toBeFocused()

  await view.editor.press(`${modifier}+Alt+KeyB`)
  await page.getByRole("option", { name: "release/base", exact: true }).click()

  // Choosing a base returns to the worktree step; selecting New worktree applies it to the row.
  await expect(dialog.getByRole("option", { name: /^from release\/base/ })).toBeVisible()
  await dialog.getByRole("option", { name: /^New worktree/ }).click()
  await expect(dialog).toHaveCount(0)
  await expect(newSessionBranch(page)).toHaveText("release/base")
  await expect(view.editor).toBeFocused()

  await view.editor.press(`${modifier}+Alt+KeyB`)
  await expect(search).toBeFocused()
  await expect(search).toHaveValue("")
  await search.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(view.editor).toBeFocused()
})

test("the dark new session panel exposes no lighter background at its rounded corners", async ({ page }) => {
  await page.setViewportSize({ width: 935, height: 522 })
  await openDraft(page, { name: "PanelCorner", seed: { theme: { id: "oc-2", scheme: "dark" } } })
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  const box = await page.locator('[data-component="new-session"]').boundingBox()

  if (!box) throw new Error("New-session panel bounds are unavailable")
  const screenshot = await page.screenshot()

  // Sample the four corner pixels, which lie outside the rounded panel.
  const corners = await page.evaluate(
    async ({ source, points }) => {
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement("canvas")
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext("2d")!
      context.drawImage(image, 0, 0)

      return points.map((point) => Array.from(context.getImageData(point.x, point.y, 1, 1).data))
    },
    {
      source: `data:image/png;base64,${screenshot.toString("base64")}`,
      points: [
        { x: Math.floor(box.x), y: Math.floor(box.y) },
        { x: Math.ceil(box.x + box.width) - 1, y: Math.floor(box.y) },
        { x: Math.floor(box.x), y: Math.ceil(box.y + box.height) - 1 },
        { x: Math.ceil(box.x + box.width) - 1, y: Math.ceil(box.y + box.height) - 1 },
      ],
    },
  )

  expect(corners.filter(([red, green, blue, alpha]) => red > 8 || green > 8 || blue > 8 || alpha !== 255)).toEqual([])
})

test("a pending worktree session shows immediately, keeps its draft, and hands off to the created session", async ({
  page,
}) => {
  const mock = await openWorktreeDraft(page, { ...pendingDraft, createdSessionTitle: "" })
  const label = page.locator('[data-titlebar-tab-slot][data-active="true"] [data-titlebar-tab-title]')
  await expect(label).toHaveText("Session")
  const pending = await submitPending(page, mock)

  const spinner = page.locator(
    `[data-titlebar-tab-slot]:has(a[href="${sessionHref(pending.sessionID)}"]) [data-component="activity-ring"]`,
  )

  await expect(spinner).toBeVisible()
  await expect(label).toHaveText("Session")

  await draftFollowUp(page)
  await expect(submit(page)).toBeDisabled()
  await editor(page).press("Enter")
  await editor(page).press("ControlOrMeta+Enter")
  await page.locator('[data-component="composer"]').dispatchEvent("submit")
  await expect(editor(page)).toHaveText(followUp)
  expect(mock.worktreeRequests.map((request) => request.body)).toEqual([expect.objectContaining({ from: directory })])

  await tabLink(page, otherID).click()
  await expectPath(page, sessionHref(otherID))
  await expect(pending.shimmer).toBeHidden()
  await expect(spinner).toBeVisible()
  await tabLink(page, pending.sessionID).click()
  await expect(page).toHaveURL(pending.url)
  await expect(pending.message).toHaveAttribute("data-timeline-part-id", `${pending.messageID}:text:0`)
  await expect(pending.shimmer).toHaveAttribute("data-active", "true")
  await expect(editor(page)).toHaveText(followUp)

  await tabLink(page, otherID).click()
  await expectPath(page, sessionHref(otherID))
  await editor(page).fill("Keep focus in this other session")
  await expect(editor(page)).toBeFocused()
  expect(mock.calls).toEqual(["worktree"])
  mock.worktree.resolve({ status: 200, json: { directory: workspace } })
  await expect
    .poll(() => mock.prompts)
    .toEqual([{ sessionID: pending.sessionID, body: expect.objectContaining({ id: pending.messageID, text }) }])
  expect(mock.creates).toEqual([expect.objectContaining({ id: pending.sessionID, location: { directory: workspace } })])
  expect(mock.calls).toEqual(["worktree", "session", "prompt"])
  await expectPath(page, sessionHref(otherID))
  await expect(editor(page)).toHaveText("Keep focus in this other session")
  await expect(editor(page)).toBeFocused()

  await tabLink(page, pending.sessionID).click()
  await expect(pending.shimmer).toHaveCount(0)
  await expect(pending.message.locator('[data-slot="user-message-text"]')).toHaveText(text)
  await expect(editor(page)).toHaveText(followUp)
  await expect(label).toHaveText("Session")
  await submit(page).click()
  await expect
    .poll(() => mock.prompts)
    .toEqual([
      { sessionID: pending.sessionID, body: expect.objectContaining({ id: pending.messageID, text }) },
      { sessionID: pending.sessionID, body: expect.objectContaining({ text: followUp }) },
    ])

  await mock.push([renamed(pending.sessionID)])
  await expect(label).toHaveText("Generated session title")
})

test("a variant picked on a worktree draft stays with the session it starts, even while another tab is open", async ({
  page,
}) => {
  const mock = await openWorktreeDraft(page, {
    ...pendingDraft,
    provider: provider({ id: "pending-model", name: "Pending Model", variants: { balanced: {}, high: {} } }),
  })

  const composer = page.locator('[data-component="composer"]')
  const variant = composer.getByRole("button", { name: "Choose model variant", exact: true })

  // The Default variant control shows only while the pointer is over the composer.
  await composer.hover()
  await variant.click()
  await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
  await expect(variant).toHaveText("high")
  const pending = await submitPending(page, mock)

  // The session starts while another tab shows, so nothing shows the worktree when its selection is handed over.
  await tabLink(page, otherID).click()
  await expectPath(page, sessionHref(otherID))
  mock.worktree.resolve({ status: 200, json: { directory: workspace } })
  await expect.poll(() => mock.prompts.map((prompt) => prompt.sessionID)).toEqual([pending.sessionID])
  expect(mock.creates).toEqual([
    expect.objectContaining({
      id: pending.sessionID,
      location: { directory: workspace },
      model: expect.objectContaining({ id: "pending-model", variant: "high" }),
    }),
  ])

  await tabLink(page, pending.sessionID).click()
  await expect(page).toHaveURL(pending.url)
  await expect(pending.message.locator('[data-slot="user-message-text"]')).toHaveText(text)
  await expect(variant).toHaveText("high")
  await page.reload()
  await expect(composer.locator('[data-action="composer-model"]')).toHaveText("Pending Model")
  await expect(variant).toHaveText("high")
})

test("a pending worktree session keeps Session as its mobile title until the generated title arrives", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const mock = await openWorktreeDraft(page, { ...pendingDraft, createdSessionTitle: "" })
  const label = page.locator('[data-slot="mobile-tab-title"]')
  await expect(label).toHaveText("Session")
  const pending = await submitPending(page, mock)
  await expect(page.locator('[data-slot="mobile-tabs-trigger"] [data-component="activity-ring"]')).toBeVisible()
  mock.worktree.resolve({ status: 200, json: { directory: workspace } })
  await expect(pending.shimmer).toHaveCount(0)
  await expect(submit(page)).toBeEnabled()
  await expect(label).toHaveText("Session")
  await mock.push([renamed(pending.sessionID)])
  await expect(label).toHaveText("Generated session title")
})

test("the title and message stay stable through worktree creation", async ({ page }) => {
  const mock = await openWorktreeDraft(page, pendingDraft)
  const pending = await submitPending(page, mock)
  await draftFollowUp(page)
  await editor(page).press("ControlOrMeta+Home")
  const title = page.locator("[data-session-title]").getByRole("heading", { level: 1 })
  const before = await title.boundingBox()
  const messageBefore = await pending.message.boundingBox()

  // Observe painted frames during the handoff, without using frame counts to wait for readiness.
  const observation = await page.evaluateHandle(() => {
    const frames: { title: string | null; message: boolean; spinner: boolean; draft: string | null }[] = []
    let frame = 0

    const visible = (element: Element | null) =>
      !!element?.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })

    const sample = () => {
      const title = document.querySelector<HTMLElement>("[data-session-title] h1")
      const editor = document.querySelector('[data-component="composer-editor"]')
      frames.push({
        title: visible(title) ? title!.textContent : null,
        message: visible(document.querySelector('[data-component="user-message"]')),
        spinner: visible(
          document.querySelector('[data-titlebar-tab-slot][data-active="true"] [data-component="activity-ring"]'),
        ),
        draft: visible(editor) ? editor!.textContent : null,
      })
      frame = requestAnimationFrame(sample)
    }

    sample()

    return {
      // A frame painted after the synchronous first sample that already shows the created session's title.
      handedOff: () => frames.slice(1).some((frame) => frame.title === "Created workspace session"),
      stop: () => {
        cancelAnimationFrame(frame)

        return frames
      },
    }
  })

  mock.worktree.resolve({ status: 200, json: { directory: workspace } })

  await expect(title).toHaveText("Created workspace session")
  await expect(pending.shimmer).toHaveCount(0)
  await expect(pending.message.locator('[data-slot="user-message-text"]')).toHaveText(text)
  await expect(editor(page)).toHaveText(followUp)
  await expect(editor(page)).toBeFocused()
  // The DOM can reach the final state before the sampler's next frame; wait until a sample has observed it.
  await expect.poll(() => observation.evaluate((observation) => observation.handedOff())).toBe(true)
  const frames = await observation.evaluate((observation) => observation.stop())
  await observation.dispose()
  // At least one painted frame after the handoff, beyond the synchronous first sample.
  expect(frames.slice(1).some((frame) => frame.title === "Created workspace session")).toBe(true)
  expect(
    frames.filter(
      (frame) =>
        !frame.message ||
        !frame.spinner ||
        frame.draft !== followUp ||
        !["Session", "Created workspace session"].includes(frame.title ?? ""),
    ),
  ).toEqual([])
  const after = await title.boundingBox()
  expect(after?.y).toBe(before?.y)
  expect(after?.height).toBe(before?.height)
  expect(await pending.message.boundingBox()).toEqual(messageBefore)
  await editor(page).pressSequentially("Also: ")
  await expect(editor(page)).toHaveText(`Also: ${followUp}`)
  await expect.poll(() => mock.calls).toEqual(["worktree", "session", "prompt"])
})

test("the created session's composer keeps focus and a caret placed mid-draft", async ({ page }) => {
  const mock = await openWorktreeDraft(page, pendingDraft)
  const pending = await submitPending(page, mock)
  await draftFollowUp(page)
  // The start of the second line: not where focusing the editor alone would put the caret.
  await editor(page).press("ControlOrMeta+End")
  await editor(page).press("Home")
  mock.worktree.resolve({ status: 200, json: { directory: workspace } })

  await expect(page.locator("[data-session-title]").getByRole("heading", { level: 1 })).toHaveText(
    "Created workspace session",
  )
  await expect(pending.shimmer).toHaveCount(0)
  await expect(editor(page)).toHaveText(followUp)
  await expect(editor(page)).toBeFocused()
  // Types into whatever holds focus, without focusing the editor again.
  await page.keyboard.type("Also: ")
  await expect(editor(page)).toHaveText(followUp.replace("\n", "\nAlso: "))
})

test("a user who leaves the pending composer keeps focus there once the session is created", async ({ page }) => {
  const mock = await openWorktreeDraft(page, pendingDraft)
  const pending = await submitPending(page, mock)
  await draftFollowUp(page)
  await pending.shimmer.click()
  await expect(editor(page)).not.toBeFocused()
  mock.worktree.resolve({ status: 200, json: { directory: workspace } })

  await expect(page.locator("[data-session-title]").getByRole("heading", { level: 1 })).toHaveText(
    "Created workspace session",
  )
  await expect(pending.shimmer).toHaveCount(0)
  await expect(editor(page)).toHaveText(followUp)
  await expect(submit(page)).toBeEnabled()
  await expect(editor(page)).not.toBeFocused()
  await expect.poll(() => mock.calls).toEqual(["worktree", "session", "prompt"])
  await expect(editor(page)).not.toBeFocused()
})

for (const row of [
  { failure: "worktree", followUp: true, calls: ["worktree"] },
  { failure: "session", followUp: true, calls: ["worktree", "session"] },
  { failure: "prompt", followUp: true, calls: ["worktree", "session", "prompt", "prompt"] },
  { failure: "worktree", followUp: false, calls: ["worktree"] },
]) {
  test(`a ${row.failure} failure restores the draft (follow-up: ${row.followUp})`, async ({ page }) => {
    const mock = await openWorktreeDraft(page, {
      ...pendingDraft,
      onSessionCreate: row.failure === "session" ? failFirstCreate : undefined,
    })

    const pending = await submitPending(page, mock)

    if (row.followUp) await draftFollowUp(page)

    if (row.failure === "prompt")
      await page.route(`**/api/session/${pending.sessionID}/prompt`, (route) =>
        route.fulfill({ status: 500, json: { message: "Prompt admission failed" }, headers }),
      )

    mock.worktree.resolve(
      row.failure === "worktree"
        ? { status: 500, json: { message: "Worktree creation failed" } }
        : { status: 200, json: { directory: workspace } },
    )

    if (row.failure !== "prompt") await expectPath(page, draftHref(draftID))
    await expect(editor(page)).toHaveText(row.followUp ? `${text}\n\n${followUp}` : text)
    await expect(submit(page)).toBeEnabled()
    await expect(pending.shimmer).toHaveCount(0)
    await expect.poll(() => mock.calls).toEqual(row.calls)
    expect(mock.prompts).toEqual([])

    if (row.followUp) return
    await expect(page.getByText("Failed to create worktree", { exact: true })).toBeVisible()
    await expect(newSessionBranch(page)).toHaveText("main")
    await expect(page.locator('[data-slot="new-session-location-path"]')).toHaveText(directory)
    await expect(pending.message).toHaveCount(0)
    await expect(tabLink(page, pending.sessionID)).toHaveCount(0)
    expect(mock.creates).toEqual([])
  })
}

test("retains the draft and reuses the created workspace after session creation fails", async ({ page }) => {
  const mock = await openWorktreeDraft(page, { ...pendingDraft, onSessionCreate: failFirstCreate })
  const pending = await submitPending(page, mock)

  mock.worktree.resolve({ status: 200, json: { directory: workspace } })

  await expectPath(page, draftHref(draftID))
  await expect(page.getByText("Failed to create session", { exact: true })).toBeVisible()
  await expect(editor(page)).toHaveText(text)
  await expect(submit(page)).toBeEnabled()
  await expect(newSessionBranch(page)).toHaveText("main")
  await expect(page.locator('[data-slot="new-session-location-path"]')).toHaveText(workspace)
  await expect(pending.shimmer).toHaveCount(0)
  await expect(pending.message).toHaveCount(0)
  expect(mock.creates).toEqual([expect.objectContaining({ id: pending.sessionID, location: { directory: workspace } })])
  expect(mock.calls).toEqual(["worktree", "session"])
  expect(mock.prompts).toEqual([])

  await submit(page).click()

  await expect.poll(() => mock.prompts.length).toBe(1)
  expect(mock.creates).toHaveLength(2)
  expect(mock.creates[1]).toMatchObject({ location: { directory: workspace } })
  expect(mock.prompts[0]).toMatchObject({ sessionID: mock.creates[1]!.id, body: { text } })
  expect(mock.calls).toEqual(["worktree", "session", "session", "prompt"])
  await expectPath(page, sessionHref(String(mock.creates[1]!.id)))
  await expect(page.locator('[data-component="user-message"] [data-slot="user-message-text"]')).toHaveText(text)
})

test("keeps the draft on the main checkout when session creation fails, then retries from it", async ({ page }) => {
  const creates: string[] = []

  const view = await openDraft(page, {
    ...pendingDraft,
    onSessionCreate: (body, attempt) => {
      creates.push(String(body.id))

      return failFirstCreate(body, attempt)
    },
  })

  await view.editor.fill(text)
  await submit(page).click()

  await expect(page.getByText("Failed to create session", { exact: true })).toBeVisible()
  await expectPath(page, draftHref(draftID))
  await expect(view.editor).toHaveText(text)
  await expect(submit(page)).toBeEnabled()
  expect(creates).toHaveLength(1)
  await expect(tabLink(page, creates[0]!)).toHaveCount(0)
  await expect(page.locator('[data-component="user-message"]')).toHaveCount(0)

  await submit(page).click()

  await expect.poll(() => creates.length).toBe(2)
  await expectPath(page, sessionHref(creates[1]!))
  await expect(page.locator('[data-component="user-message"] [data-slot="user-message-text"]')).toHaveText(text)
})

// Before, a create whose response stalled left the pending tab on "Starting session" with the prompt locked.
test("a stalled session create returns to the draft, and the Session it creates later is deleted unused", async ({
  page,
}) => {
  const held = Promise.withResolvers<void>()
  const creates: string[] = []
  const prompts: string[] = []
  await page.clock.install()

  const view = await openDraft(page, {
    ...pendingDraft,
    onPrompt: (prompt) => void prompts.push(prompt.sessionID),
    onSessionCreate: async (body, attempt) => {
      creates.push(String(body.id))

      if (attempt === 1) await held.promise
    },
  })

  await view.editor.fill(text)
  await submit(page).click()
  await expect.poll(() => creates.length).toBe(1)
  const stalled = creates[0]!
  await expectPath(page, sessionHref(stalled))
  await expect(page.locator('[data-component="session-preparing"]').getByRole("status")).toContainText(
    "Starting session",
  )

  // The create phase's time limit, below the request queue's 60 s wait for response headers.
  await page.clock.fastForward(30_000)

  await expectPath(page, draftHref(draftID))
  await expect(page.getByText("Failed to create session", { exact: true })).toBeVisible()
  await expect(
    page.getByText("The server took too long to respond. Send again to retry.", { exact: true }),
  ).toBeVisible()
  await expect(view.editor).toHaveText(text)
  await expect(submit(page)).toBeEnabled()
  await expect(tabLink(page, stalled)).toHaveCount(0)

  const removed = page.waitForRequest(
    (request) => request.method() === "DELETE" && new URL(request.url()).pathname === `/api/session/${stalled}`,
  )

  held.resolve()
  await removed

  await submit(page).click()

  await expect.poll(() => creates.length).toBe(2)
  await expect.poll(() => prompts).toEqual([creates[1]])
  await expectPath(page, sessionHref(creates[1]!))
  await expect(page.locator('[data-component="user-message"] [data-slot="user-message-text"]')).toHaveText(text)
})

test("a new session's first prompt stays once its missed admission echo resyncs the session", async ({ page }) => {
  const messages: SessionMessageInfo[] = []
  const created: string[] = []

  // The mock admits the prompt without its session.inbox.enqueued echo.
  const view = await openDraft(page, {
    ...pendingDraft,
    pageMessages: () => ({ items: messages }),
    onSessionCreate: (body) => void created.push(String(body.id)),
    seed: { settings: { general: { timelineDetail: timelinePresets[0].value } } },
  })

  await view.editor.fill(text)
  await submit(page).click()
  await expect.poll(() => created).toHaveLength(1)
  const sessionID = created[0]!
  await expectPath(page, sessionHref(sessionID))
  const prompt = page.locator('[data-component="user-message"] [data-slot="user-message-text"]')
  await expect(prompt).toHaveText([text])

  // Another client switches the agent. Only its own notice shows: the admitted prompt no longer projects one.
  messages.push({
    id: "msg_first_agent_plan",
    type: "agent-switched",
    agent: "plan",
    previous: "build",
    time: { created: T0 },
  })
  await view.push([
    {
      id: "evt_first_agent_plan",
      type: "session.agent.selected",
      created: T0,
      durable: { aggregateID: sessionID, seq: 1, version: 1 },
      data: { sessionID, agent: "plan" },
    },
  ])
  await expect(page.locator('[data-slot="session-timeline-notice"]')).toHaveText([/^Agent changed\s*Build → Plan$/])
  await expect(prompt).toHaveText([text])
})

test("restores the draft after closing and revisiting a pending session that fails", async ({ page }) => {
  const mock = await openWorktreeDraft(page, pendingDraft)
  const pending = await submitPending(page, mock)
  await draftFollowUp(page)
  const tab = tabLink(page, pending.sessionID)

  await page.locator("[data-titlebar-tab-slot]").filter({ has: tab }).locator('[data-slot="tab-close"] button').click()

  await expectPath(page, sessionHref(otherID))
  await expect(editor(page)).toBeEditable()
  await expect(tab).toHaveCount(0)
  await expect(pending.shimmer).toHaveCount(0)

  await page.goBack()

  await expect(page).toHaveURL(pending.url)
  await expect(tab).toBeVisible()
  await expect(pending.message.locator('[data-slot="user-message-text"]')).toHaveText(text)
  await expect(pending.message).toHaveAttribute("data-timeline-part-id", `${pending.messageID}:text:0`)
  await expect(pending.shimmer).toContainText("Creating worktree")
  await expect(pending.shimmer).toHaveAttribute("data-active", "true")
  await expect(editor(page)).toHaveText(followUp)
  expect(mock.calls).toEqual(["worktree"])

  mock.worktree.resolve({ status: 500, json: { message: "Worktree creation failed after revisiting the session" } })

  await expectPath(page, draftHref(draftID))
  await expect(page.getByText("Failed to create worktree", { exact: true })).toBeVisible()
  await expect(editor(page)).toHaveText(`${text}\n\n${followUp}`)
  await expect(submit(page)).toBeEnabled()
  await expect(newSessionBranch(page)).toHaveText("main")
  await expect(page.locator('[data-slot="new-session-location-path"]')).toHaveText(directory)
  await expect(page.locator(`[data-titlebar-tab-link][href="${draftHref(draftID)}"]`)).toHaveCount(1)
  await expect(tab).toHaveCount(0)
  await expect(pending.message).toHaveCount(0)
  expect(mock.calls).toEqual(["worktree"])
  expect(mock.creates).toEqual([])
  expect(mock.prompts).toEqual([])
})

test("executes a selected slash command after creating its worktree", async ({ page }) => {
  const commands: { sessionID: string; body: unknown }[] = []

  const mock = await openWorktreeDraft(page, {
    ...pendingDraft,
    commands: [{ name: "review", description: "Review changes" }],
    onCommand: (input) => commands.push(input),
  })

  const expanded =
    "Review the latest commit for correctness and regressions. Check the relevant tests and report actionable findings."

  await editor(page).fill("/review")
  const suggestion = page.getByRole("button", { name: "/review Review changes", exact: true })
  await suggestion.click()
  await expect(editor(page)).toHaveText("/review")
  const pending = await submitPending(page, mock, "/review latest commit")
  await draftFollowUp(page)

  mock.worktree.resolve({ status: 200, json: { directory: workspace } })

  await expect
    .poll(() => commands)
    .toEqual([
      {
        sessionID: pending.sessionID,
        body: { name: "review", text: "latest commit", files: [], agents: [], skills: [], delivery: "steer" },
      },
    ])
  // The server owns command expansion; the client receives the expanded inbox item.
  // SAFETY: the fixture event matches the generated OpenCodeEvent shape for its type.
  await mock.push([
    {
      id: "evt_workspace_review",
      type: "session.inbox.enqueued",
      created: Date.now(),
      durable: { aggregateID: pending.sessionID, seq: 1, version: 1 },
      data: {
        sessionID: pending.sessionID,
        inboxID: "msg_workspace_review",
        item: { type: "user", payload: { text: expanded }, delivery: "steer" },
      },
    } as OpenCodeEvent,
  ])
  await expect(pending.shimmer).toHaveCount(0)
  await expect(page.locator('[data-slot="user-message-text"]')).toHaveText(expanded)
  await expect(editor(page)).toHaveText(followUp)
  await expect(submit(page)).toBeEnabled()
  expect(mock.creates).toEqual([expect.objectContaining({ id: pending.sessionID, location: { directory: workspace } })])
  expect(mock.prompts).toEqual([])
})

test("the location dialog separates added projects from server projects and tags the remote ones", async ({ page }) => {
  const apollo = "http://apollo.test:4096"

  const entry = (id: string, directory: string, active: number) =>
    project({ id, directory, time: { created: T0, updated: T0, active: T0 + active } })

  const remote = entry("proj_apollo_opencode", "/home/dax/opencode", 4)
  const files: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())

    if (url.origin === apollo && url.pathname === "/api/fs/list") files.push(url.pathname)
  })
  await mockOpenCodeServer(page, {
    server: apollo,
    directory: remote.worktree,
    project: remote,
    projects: () => [remote, entry("proj_apollo_sst", "/home/dax/sst", 3)],
    worktrees: () => [{ directory: remote.worktree }, { directory: "/home/dax/opencode-beta", strategy: "git" }],
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: () => [],
  })
  // romulus is listed but unreachable, so it contributes no projects and cannot take a new one.
  await seed(page, {
    servers: [
      { url: apollo, name: "apollo" },
      { url: "http://127.0.0.1:4999", name: "romulus" },
    ],
    usedProjects: { [apollo]: [remote.id] },
  })
  const local = entry("proj_opencode", "C:/work/opencode", 2)
  await openDraft(page, {
    name: "opencode",
    hostname: "hailmary",
    directory: local.worktree,
    project: { time: local.time },
    projects: () => [local, entry("proj_console", "C:/work/console", 9)],
  })

  await newSessionLocation(page).click()
  const dialog = page.getByRole("dialog")
  const search = dialog.getByRole("combobox")
  await expect(search).toBeFocused()
  const options = dialog.getByRole("option")
  const add = options.filter({ hasText: "Add project" })
  await expect(add.locator('[data-component="keybind-v2"]')).toContainText("O")
  const rows = options.filter({ has: page.locator(".new-session-location-name") })
  const names = options.locator(".new-session-location-name")
  const paths = options.locator(".command-palette-description")
  const back = dialog.getByRole("button", { name: "Back to projects", exact: true })
  // Only the projects added to this client open expanded; other ready-server projects remain discoverable.
  await expect(names).toHaveText(["opencodeapollo", "opencode"])
  await expect(paths).toHaveText(["/home/dax/opencode", "C:/work/opencode"])
  const others = options.filter({ hasText: "Other projects" })
  await expect(others).toBeVisible()
  await expect(others.locator(".new-session-location-count")).toHaveText("2")
  await expect(dialog.locator(".command-palette-group-title")).toHaveCount(0)
  await expect(options.locator(".command-palette-title")).toHaveText([
    "opencode",
    "opencode",
    "Other projects",
    "Add project",
  ])
  // It opens on the first row, not on the draft's current project (the second row).
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true")

  // The picker shares the palette's full-width search, compact rows, and single-line titles.
  await expect(options.nth(0)).toHaveCSS("height", "28px")
  await expect(dialog.locator(".palette-menu-search [data-component='text-input-v2']")).toHaveCSS("height", "28px")
  await expect(dialog.locator(".new-session-location-hints")).toHaveCount(0)
  await expect(dialog.locator("..")).toHaveCSS("width", "480px")
  await expect(options.nth(0)).toHaveCSS("display", "flex")
  await expect(names.nth(0).locator(".command-palette-title")).toHaveCSS("font-size", "13px")
  await expect(names.nth(0).locator(".command-palette-title")).toHaveCSS("white-space", "nowrap")
  await expect(rows.nth(0)).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  // "Add project" shares the project rows' width and icon column.
  await expect
    .poll(async () => {
      const field = await dialog.locator('[data-component="text-input-v2"]').boundingBox()
      const row = await rows.nth(0).boundingBox()
      const first = await add.boundingBox()
      const icon = await add.locator(".command-palette-row-icon").boundingBox()
      const avatar = await rows.nth(0).locator('[data-component="project-avatar-v2"]').boundingBox()

      return field && row && first && icon && avatar
        ? Math.max(Math.abs(field.width - row.width), Math.abs(first.width - row.width), Math.abs(icon.x - avatar.x))
        : Infinity
    })
    .toBeLessThanOrEqual(1)

  await others.click()
  await expect(names).toHaveText(["console", "sstapollo"])
  await expect(back).toHaveText("Other projects")
  await search.fill("no-project-matches")
  await expect(options).toHaveCount(0)
  await expect(back).toBeVisible()
  await search.fill("")
  await expect(names).toHaveText(["console", "sstapollo"])
  await search.press("ArrowLeft")
  await expect(names).toHaveText(["opencodeapollo", "opencode"])
  await search.press("ArrowRight")
  await expect(names).toHaveText(["console", "sstapollo"])
  await search.press("Backspace")
  await search.press("Enter")
  await expect(names).toHaveText(["console", "sstapollo"])
  await search.press("Escape")
  await expect(names).toHaveText(["opencodeapollo", "opencode"])
  await others.click()
  await back.click()
  await expect(names).toHaveText(["opencodeapollo", "opencode"])

  await search.fill("apollo")
  await expect(names).toHaveText(["opencodeapollo", "sstapollo"])
  await expect(dialog.locator(".command-palette-group-title")).toHaveText("Other projects")

  // The worktree step keeps the project's avatar and server tag in its main-checkout row.
  await search.fill("opencode")
  await expect(paths).toHaveText(["/home/dax/opencode", "C:/work/opencode"])
  await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowRight")
  // The worktree step has no "Add project".
  await expect(add).toHaveCount(0)
  await expect(back).toHaveText("Run session in")
  await expect(options.nth(0).locator('[data-component="tag"]')).toHaveText("apollo")
  await expect(options.locator(".command-palette-title")).toHaveText([
    "opencode",
    "New worktree",
    "from main",
    "opencode-beta",
  ])
  await expect(dialog.getByRole("separator")).toHaveCount(1)
  await search.fill("opencode-beta")
  await expect(options).toHaveCount(1)
  await expect(dialog.getByRole("separator")).toHaveCount(0)
  await search.fill("no-worktree-matches")
  await expect(options).toHaveCount(0)
  await expect(dialog.getByRole("separator")).toHaveCount(0)
  // Open project from the worktree step returns to that step with its search, not to the projects.
  const open = (await page.evaluate(() => navigator.platform.includes("Mac"))) ? "Meta+o" : "Control+o"
  await search.fill("open")
  await page.keyboard.press(open)
  await expect(back).toHaveText("Servers")
  await expect(search).toHaveValue("")
  await page.keyboard.press("Escape")
  await expect(back).toHaveText("Run session in")
  await expect(search).toHaveValue("open")
  await expect(options.locator(".command-palette-title")).toHaveText([
    "opencode",
    "New worktree",
    "from main",
    "opencode-beta",
  ])
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true")
  await search.fill("")
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Backspace")
  await expect(search).toHaveValue("opencode")
  await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true")

  // Adding a project picks one of the ready servers first, then browses that server.
  await search.fill("")
  await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowUp")
  await expect(options.nth(3)).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press(open)
  await expect(back).toHaveText("Servers")
  // The server the app runs beside shows its hostname and "This computer" instead of its address.
  await expect(options).toHaveText(["hailmaryThis computer", "apollo"])
  await back.click()
  await options.filter({ hasText: "Add project" }).click()
  await expect(options).toHaveText(["hailmaryThis computer", "apollo"])
  await options.filter({ hasText: "apollo" }).click()
  await expect(page.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await expect.poll(() => files.length).toBeGreaterThan(0)
})

for (const binding of ["mod+alt+p", "none"]) {
  test(`the location dialog honors the Open project shortcut override: ${binding}`, async ({ page }) => {
    await openDraft(page, {
      name: "ProjectShortcut",
      fileList: () => [],
      seed: { settings: { keybinds: { "project.open": binding } } },
    })
    await newSessionLocation(page).click()
    const search = page.getByRole("combobox", { name: "Search projects", exact: true })
    await expect(search).toBeFocused()
    const keys = page.getByRole("option", { name: /^Add project/ }).locator('[data-component="keybind-v2"]')

    if (binding === "none") await expect(keys).toHaveCount(0)

    if (binding !== "none") await expect(keys).toContainText("P")

    const modifier = (await page.evaluate(() => navigator.platform.includes("Mac"))) ? "Meta" : "Control"
    await search.press(`${modifier}+o`)
    await search.fill("still searching")
    await expect(search).toHaveValue("still searching")

    if (binding === "none") return

    await search.press(`${modifier}+Alt+p`)
    await expect(page.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  })
}

const accentRoot = "C:/OpenCode/WorkspaceAccent"

const accentWorkspace = `${accentRoot}/.worktrees/feature`

for (const row of [
  { name: "a managed worktree", directory: accentWorkspace, accent: true },
  {
    name: "the main root written with Windows case and separators",
    directory: "c:\\OPENCODE\\workspaceaccent\\",
    accent: false,
  },
]) {
  test(`keeps the user message grey for ${row.name}`, async ({ page }) => {
    const inventory: WorktreeDirectory[] = [{ directory: accentRoot }, { directory: accentWorkspace, strategy: "git" }]

    const listed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/worktree" &&
        new URL(response.url()).searchParams.get("projectID") === "proj_workspaceaccent" &&
        response.request().method() === "GET",
    )

    const view = await openSession(page, {
      name: "WorkspaceAccent",
      // The mock answers every location with the session directory while the project stays rooted at main.
      directory: row.directory,
      project: { worktree: accentRoot, canonical: accentRoot },
      provider: provider({ id: "accent-model", name: "Accent Model" }),
      sessions: [
        {
          id: "ses_workspace_accent",
          title: "Workspace accent",
          model: { id: "accent-model", providerID: "opencode" },
        },
      ],
      pageMessages: () => ({
        items: [
          { id: "msg_workspace_accent", type: "user", text: "Check this fixture workspace.", time: { created: 1 } },
        ],
      }),
      worktrees: () => inventory,
      seed: { theme: { id: "oc-2", scheme: "light" } },
    })

    expect((await listed).ok()).toBe(true)
    const composer = page.locator('[data-component="composer"]')
    const send = composer.getByRole("button", { name: "Send", exact: true })
    await expect(composer.locator('[data-action="composer-model"]')).toHaveText("Accent Model")
    await view.editor.fill("Inspect this fixture workspace.")
    await expect(send).toBeEnabled()
    await expectBackground(send, "icon-button-contrast")
    await send.hover()
    await expectBackground(send, "icon-button-contrast")
    await composer.locator('[data-action="composer-model"]').press("Tab")
    await expect(send).toBeFocused()
    await expectBackground(send, "icon-button-contrast")
    const message = page.locator('[data-slot="user-message-text"]')
    await expect(message).toHaveText("Check this fixture workspace.")
    await expectToken(message, "background-color", "--v2-background-bg-layer-02")
    await expectToken(message, "color", "--v2-text-text-base")

    if (!row.accent) return

    const url = page.url()

    const refreshed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/worktree" && response.request().method() === "GET",
    )

    // SAFETY: the fixture event matches the generated OpenCodeEvent shape for its type.
    await view.push([
      {
        id: "evt_accent_inventory",
        created: 1700000001000,
        type: "worktree.updated",
        data: { projectID: "proj_workspaceaccent" },
      },
    ] as OpenCodeEvent[])
    expect((await refreshed).ok()).toBe(true)
    await expect(page).toHaveURL(url)
    await expect(view.editor).toHaveText("Inspect this fixture workspace.")
    await expectBackground(send, "icon-button-contrast")
    // SAFETY: the fixture event matches the generated OpenCodeEvent shape for its type.
    await view.push([
      {
        id: "evt_accent_running",
        created: 1700000002000,
        type: "session.execution.started",
        durable: { aggregateID: "ses_workspace_accent", seq: 1, version: 1 },
        data: { sessionID: "ses_workspace_accent" },
      },
    ] as OpenCodeEvent[])
    await view.editor.fill("")
    const stop = composer.getByRole("button", { name: "Stop", exact: true })
    await expect(stop).toBeEnabled()
    await expectBackground(stop, "icon-button-contrast")
  })
}

function renamed(sessionID: string) {
  // SAFETY: the fixture event matches the generated OpenCodeEvent shape for its type.
  return {
    id: "evt_generated_title",
    type: "session.renamed",
    created: Date.now(),
    location: { directory: workspace },
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, title: "Generated session title" },
  } as OpenCodeEvent
}

async function draftFollowUp(page: Page) {
  await editor(page).pressSequentially("!")
  await expect(editor(page)).toHaveText("!")
  await expect(editor(page)).toHaveAttribute("dir", "auto")
  await editor(page).fill("")
  await page.evaluate((text) => navigator.clipboard.writeText(text), followUp)
  await editor(page).press("ControlOrMeta+V")
  await expect(editor(page)).toHaveText(followUp)
}

async function submitPending(page: Page, mock: Awaited<ReturnType<typeof openWorktreeDraft>>, prompt = text) {
  await editor(page).fill(prompt)
  await expect(submit(page)).toBeEnabled()
  await submit(page).click()
  const sessionPath = sessionHref("")
  await expect(page).toHaveURL((url) => url.pathname.startsWith(sessionPath) && /\/ses_[^/]+$/.test(url.pathname))
  const url = page.url()
  const sessionID = new URL(url).pathname.slice(sessionPath.length)
  const preparing = page.locator('[data-component="session-preparing"]')
  const message = page.locator('[data-component="user-message"]')
  const shimmer = preparing.getByRole("status").locator('[data-component="text-shimmer"]')
  await expect(preparing.getByRole("heading", { level: 1 })).toHaveText("Session")
  await expect(editor(page)).toBeEditable()
  await expect(submit(page)).toBeDisabled()
  await expect(preparing.locator('[data-component="user-message"]')).toHaveCount(1)
  await expect(message.locator('[data-slot="user-message-text"]')).toHaveText(prompt)
  await expect(message).toHaveAttribute("data-timeline-part-id", /^.+:text:0$/)
  const messageID = (await message.getAttribute("data-timeline-part-id"))!.replace(/:text:0$/, "")
  await expect(shimmer).toContainText("Creating worktree")
  await expect(shimmer).toHaveAttribute("data-active", "true")
  await expect.poll(() => mock.calls).toEqual(["worktree"])
  // Worktrees are created by project, without a location.
  expect(mock.worktreeRequests.map((request) => request.url.searchParams.has("location[directory]"))).toEqual([false])
  expect(mock.worktreeRequests.map((request) => request.body)).toEqual([expect.objectContaining({ projectID })])
  expect(mock.creates).toEqual([])
  expect(mock.prompts).toEqual([])

  return { url, sessionID, messageID, message, shimmer }
}

// Resolves semantic colors through the browser, without reproducing the button's gradient.
async function expectBackground(element: Locator, token: string) {
  const color = await element.evaluate((element, token) => {
    const probe = document.createElement("span")
    probe.hidden = true
    probe.style.backgroundColor = `var(--v2-background-bg-${token})`
    element.append(probe)
    const color = getComputedStyle(probe).backgroundColor
    probe.remove()

    return color
  }, token)

  await expect(element).toHaveCSS("background-image", new RegExp(color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
}

async function expectToken(element: Locator, property: string, token: string) {
  const color = await element.evaluate((element, token) => {
    const probe = document.createElement("span")
    probe.hidden = true
    probe.style.color = `var(${token})`
    element.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()

    return color
  }, token)

  await expect(element).toHaveCSS(property, color)
}
