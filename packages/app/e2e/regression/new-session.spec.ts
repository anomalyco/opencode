import { expect, test, type Locator, type Page } from "@playwright/test"
import type { OpenCodeEvent, WorktreeDirectory } from "@opencode/client/promise"
import { draftHref, expectPath, NO_PROVIDER, project, provider, seed, sessionHref, T0 } from "../utils/app"
import { mockOpenCodeServer } from "../utils/mock-server"
import { newSessionLocation, openDraft, openSession, openWorktreeDraft, type WorkspaceInput } from "../utils/workspace"

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

test("the combined location picker shows checkout branches and chooses the base for a new worktree", async ({
  page,
}) => {
  const listed = Promise.withResolvers<string[]>()
  const searches: { directory: string; search?: string; limit?: number }[] = []
  const existing = "C:/OpenCode/BranchContext/.worktrees/stellar-orchid"

  const view = await openWorktreeDraft(page, {
    name: "BranchContext",
    project: { name: "OpenCode" },
    vcs: (directory) => ({
      current: directory === existing ? "model-picker-dialog" : "timeline-quotes",
      default: "main",
    }),
    worktrees: () => [{ directory: "C:/OpenCode/BranchContext" }, { directory: existing, strategy: "git" }],
    branches: (input) => {
      searches.push(input)

      return listed.promise
    },
  })

  const screen = page.locator('[data-component="new-session"]')
  const base = screen.getByRole("button", { name: "from timeline-quotes", exact: true })
  await expect(base).toBeVisible()
  await expect.poll(() => searches).toEqual([{ directory: view.directory, search: "", limit: 50 }])
  await base.click()
  const search = page.getByRole("combobox", { name: "Search branches", exact: true })
  await expect(search).toHaveCount(0)
  await expect(newSessionLocation(page)).toBeVisible()
  listed.resolve(["timeline-quotes", "release/base", "origin/dev"])
  await expect(search).toBeFocused()
  await expect(search).toHaveAttribute("aria-busy", "false")
  await expect(page.getByRole("option", { name: "release/base", exact: true })).toBeVisible()
  await search.fill("release")
  await expect(search).toHaveAttribute("aria-busy", "false")
  await expect(page.getByRole("option")).toHaveText(["release/base"])
  await page.getByRole("option", { name: "release/base", exact: true }).click()
  const selected = screen.getByRole("button", { name: "from release/base", exact: true })
  await expect(selected).toBeVisible()
  await expect(view.editor).toBeFocused()
  expect(searches).toEqual([
    { directory: view.directory, search: "", limit: 50 },
    { directory: view.directory, search: "release", limit: 50 },
  ])

  await selected.click()
  await expect(search).toBeFocused()
  await expect(search).toHaveValue("")
  await expect(page.getByRole("option")).toHaveCount(3)
  // Reopening revalidates the branch list.
  expect(searches).toHaveLength(3)
  await page.getByRole("option", { name: "release/base", exact: true }).click()
  await expect(view.editor).toBeFocused()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(async () => {
      const location = await newSessionLocation(page).boundingBox()
      const branch = await selected.boundingBox()

      return !!location && !!branch && branch.y >= location.y + location.height
    })
    .toBe(true)

  const select = async (name: RegExp) => {
    await newSessionLocation(page).click()
    await page.getByRole("combobox", { name: "Search projects", exact: true }).press("ArrowRight")
    await page.getByRole("option", { name }).click()
    await expect(view.editor).toBeFocused()
  }

  await select(/^stellar-orchid /)
  await expect(screen.getByText("model-picker-dialog", { exact: true })).toBeVisible()
  await expect(screen.getByRole("button", { name: /from / })).toHaveCount(0)
  await select(/^BranchContext /)
  await expect(screen.getByText("timeline-quotes", { exact: true })).toBeVisible()
  await expect(screen.getByRole("button", { name: /from / })).toHaveCount(0)
  await select(/^New worktree/)
  await expect(base).toBeVisible()
  await base.click()
  await expect(search).toBeFocused()
  await page.getByRole("option", { name: "origin/dev", exact: true }).click()
  await expect(screen.getByRole("button", { name: "from origin/dev", exact: true })).toBeVisible()
  await view.editor.fill("Use the selected base")
  await submit(page).click()
  await expect
    .poll(() => view.worktreeRequests.map((request) => request.body))
    .toEqual([expect.objectContaining({ from: view.directory, branch: "origin/dev" })])
  view.worktree.resolve({ status: 200, json: { directory: existing } })
  await expect
    .poll(() => view.prompts)
    .toEqual([expect.objectContaining({ body: expect.objectContaining({ text: "Use the selected base" }) })])
})

test("a pending branch picker can be dismissed before its results arrive", async ({ page }) => {
  const listed = Promise.withResolvers<string[]>()

  const view = await openWorktreeDraft(page, {
    name: "BranchDismiss",
    vcs: () => ({ current: "dev", default: "dev" }),
    branches: () => listed.promise,
  })

  const base = page.getByRole("button", { name: "from dev", exact: true })
  const search = page.getByRole("combobox", { name: "Search branches", exact: true })
  await base.click()
  await expect(base).toHaveAttribute("aria-expanded", "true")
  await expect(search).toHaveCount(0)
  await view.editor.click()
  await expect(base).toHaveAttribute("aria-expanded", "false")
  await base.click()
  await base.press("Escape")
  await expect(base).toHaveAttribute("aria-expanded", "false")
  await base.click()
  await base.click()
  await expect(base).toHaveAttribute("aria-expanded", "false")
  listed.resolve(["dev", "origin/dev"])
  await expect(base).toHaveAttribute("aria-busy", "false")
  await expect(search).toHaveCount(0)
  await base.click()
  await expect(search).toBeFocused()
  await expect(page.getByRole("option")).toHaveText(["dev", "origin/dev"])
})

test("reopening the branch picker shows branches created since it last opened", async ({ page }) => {
  let created = false

  await openWorktreeDraft(page, {
    name: "BranchRefresh",
    vcs: () => ({ current: "dev", default: "dev" }),
    branches: () => (created ? ["dev", "feature/new"] : ["dev"]),
  })

  const base = page.getByRole("button", { name: "from dev", exact: true })
  await base.click()
  await expect(page.getByRole("option")).toHaveText(["dev"])
  created = true
  await base.click()
  await expect(page.getByRole("combobox", { name: "Search branches", exact: true })).toHaveCount(0)
  await base.click()
  await expect(page.getByRole("option")).toHaveText(["dev", "feature/new"])
})

test("branch search keeps results on screen while a query is pending", async ({ page }) => {
  const held = Promise.withResolvers<string[]>()

  await openWorktreeDraft(page, {
    name: "BranchPending",
    vcs: () => ({ current: "dev", default: "dev" }),
    branches: (input) => (input.search ? held.promise : ["dev", "release/base", "release/next", "timeline-quotes"]),
  })

  await page.getByRole("button", { name: "from dev", exact: true }).click()
  const search = page.getByRole("combobox", { name: "Search branches", exact: true })
  const options = page.getByRole("option")
  await expect(options).toHaveCount(4)
  // Record any moment the list renders without rows, however brief.
  await page.getByRole("listbox").evaluate((list) => {
    const observer = new MutationObserver(() => {
      if (!list.querySelector('[role="option"]')) list.setAttribute("data-emptied", "")
    })

    observer.observe(list, { childList: true, subtree: true })
  })

  const next = page.getByRole("option", { name: "release/next", exact: true })
  await search.press("ArrowDown")
  await search.press("ArrowDown")
  await expect(next).toHaveAttribute("aria-selected", "true")
  await search.pressSequentially("release")
  await expect(search).toHaveAttribute("aria-busy", "true")
  await expect(options).toHaveText(["release/base", "release/next"])
  await expect(next).toHaveAttribute("aria-selected", "true")
  await search.press("ControlOrMeta+a")
  await search.press("Backspace")
  await expect(options).toHaveCount(4)
  await search.pressSequentially("quotes")
  await expect(options).toHaveText(["timeline-quotes"])
  await search.pressSequentially("-missing")
  await expect(options).toHaveText(["timeline-quotes"])
  await expect(page.getByRole("listbox")).not.toHaveAttribute("data-emptied")

  held.resolve([])
  await expect(page.getByText("No results found", { exact: true })).toBeVisible()
  await expect(search).toHaveAttribute("aria-busy", "false")
})

test("the empty branch search state is as tall as a single result", async ({ page }) => {
  await openWorktreeDraft(page, {
    name: "BranchEmptyHeight",
    vcs: () => ({ current: "dev", default: "dev" }),
    branches: () => ["dev"],
  })

  await page.getByRole("button", { name: "from dev", exact: true }).click()
  await expect(page.getByRole("option")).toHaveCount(1)
  const panel = page.getByRole("dialog")
  // Measured on open, before any search animates the panel.
  const single = await panel.evaluate((element) => element.getBoundingClientRect().height)

  await page.getByRole("combobox", { name: "Search branches", exact: true }).fill("missing")
  await expect(page.getByText("No results found", { exact: true })).toBeVisible()
  await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().height)).toBe(single)
})

test("backspacing keeps confirmed branch results until the broader search answers", async ({ page }) => {
  const broader = Promise.withResolvers<string[]>()
  const closed = ["closed-search-beta", "closed-session-search", "reopen-closed-tab", "recently-closed-projects"]

  await openWorktreeDraft(page, {
    name: "BranchBackspace",
    vcs: () => ({ current: "dev", default: "dev" }),
    branches: (input) => {
      if (input.search === "clo") return broader.promise

      if (input.search) return closed

      return [...closed, "origin/cloudflare-run-images", "origin/cloudflare-run-functions"]
    },
  })

  await page.getByRole("button", { name: "from dev", exact: true }).click()
  const search = page.getByRole("combobox", { name: "Search branches", exact: true })
  const options = page.getByRole("option")
  await expect(options).toHaveCount(6)
  await search.fill("closed")
  await expect(search).toHaveAttribute("aria-busy", "false")
  await expect(options).toHaveText(closed)
  await search.press("Backspace")
  await search.press("Backspace")
  await search.press("Backspace")
  await expect(search).toHaveValue("clo")
  await expect(search).toHaveAttribute("aria-busy", "true")
  await expect(options).toHaveText(closed)
  broader.resolve([...closed, "clover-fix"])
  await expect(search).toHaveAttribute("aria-busy", "false")
  await expect(options).toHaveText([...closed, "clover-fix"])
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

test("a pending worktree session keeps Session as its mobile title until the generated title arrives", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const mock = await openWorktreeDraft(page, { ...pendingDraft, createdSessionTitle: "" })
  const label = page.locator('[data-slot="mobile-tab-title"]')
  await expect(label).toHaveText("Session")
  const pending = await submitPending(page, mock)
  await expect(
    page.locator('[data-slot="mobile-tabs-trigger"] [data-component="session-progress-indicator-v2"]'),
  ).toBeVisible()
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
    await expect(newSessionLocation(page)).toContainText("New worktree")
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
  await expect(newSessionLocation(page)).toContainText("pending-workspace")
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
  await expect(newSessionLocation(page)).toContainText("New worktree")
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

test("the location dialog lists every ready server's projects in one list and tags the remote ones", async ({
  page,
}) => {
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
  const rows = options.filter({ has: page.locator(".new-session-location-name") })
  const names = options.locator(".new-session-location-name")
  const paths = options.locator(".command-palette-description")
  const chip = dialog.getByRole("button", { name: "Back to projects", exact: true })
  const heading = dialog.getByText("Projects", { exact: true })
  const addButton = dialog.getByRole("button", { name: "Add project", exact: true })
  // Used projects first, then the rest, each by recent activity across servers; only remote ones carry a tag.
  await expect(names).toHaveText(["opencodeapollo", "opencode", "console", "sstapollo"])
  await expect(paths).toHaveText(["/home/dax/opencode", "C:/work/opencode", "C:/work/console", "/home/dax/sst"])
  // "Add project" is the first row of the scrolling list, above the Projects heading, yet the first project is still
  // the opening row, not the draft's current project (the second row).
  await expect(dialog.locator("[data-scrollable]").getByRole("option").first()).toHaveText("Add project")
  await expect(rows).toHaveCount(4)
  await expect
    .poll(async () => {
      const row = await add.boundingBox()
      const title = await heading.boundingBox()

      return row && title ? row.y + row.height <= title.y : false
    })
    .toBe(true)
  await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true")
  // The search field also ends with an "Add project" button, next in the Tab order.
  await page.keyboard.press("Tab")
  await expect(addButton).toBeFocused()
  await search.focus()

  // The picker shares the palette's full-width search, compact rows, and single-line titles.
  await expect(rows.nth(0)).toHaveCSS("height", "36px")
  await expect(rows.nth(0)).toHaveCSS("display", "flex")
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

  // Searching narrows the projects and keeps "Add project" first; with no match it is the active row.
  await search.fill("apollo")
  await expect(names).toHaveText(["opencodeapollo", "sstapollo"])
  await expect(options.first()).toHaveText("Add project")
  await search.fill("nothing matches")
  await expect(options).toHaveText(["Add project"])
  await expect(add).toHaveAttribute("aria-selected", "true")
  await expect(heading).toHaveCount(0)

  // The worktree step keeps the server's tag beside the project.
  await search.fill("opencode")
  await expect(paths).toHaveText(["/home/dax/opencode", "C:/work/opencode"])
  await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowRight")
  // The worktree step has no "Add project".
  await expect(add).toHaveCount(0)
  await expect(addButton).toHaveCount(0)
  await expect(chip).toContainText("opencode")
  await expect(chip.locator('[data-component="tag"]')).toHaveText("apollo")
  await expect(options.locator(".command-palette-title")).toHaveText(["opencode", "New worktree", "opencode-beta"])
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true")
  // The chip's avatar sits on the same column as the row icons below it.
  await expect
    .poll(async () => {
      const avatar = await chip.locator('[data-component="project-avatar-v2"]').boundingBox()
      const icon = await options.nth(0).locator(".command-palette-row-icon").boundingBox()

      return avatar && icon ? Math.abs(avatar.x - icon.x) : Infinity
    })
    .toBeLessThanOrEqual(0.5)
  await page.keyboard.press("Backspace")
  await expect(search).toHaveValue("opencode")
  await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true")

  // ArrowUp from the first project reaches "Add project" above it; adding a project picks one of the ready servers
  // first, then browses that server.
  await search.fill("")
  await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowUp")
  await expect(add).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowDown")
  await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("ArrowRight")
  await expect(chip).toHaveText("Add project")
  await expect(addButton).toHaveCount(0)
  // The search field's button starts the same flow.
  await page.keyboard.press("Backspace")
  await expect(addButton).toBeVisible()
  await page.keyboard.press("Tab")
  await page.keyboard.press("Enter")
  await expect(chip).toHaveText("Add project")
  // The server the app runs beside shows its hostname and "This computer" instead of its address.
  await expect(options).toHaveText(["hailmaryThis computer", "apollo"])
  await options.filter({ hasText: "apollo" }).click()
  await expect(page.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await expect.poll(() => files.length).toBeGreaterThan(0)
})

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
    await expect(composer.locator('[data-action="composer-model"]')).toHaveText("OpenCode / Accent Model")
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
