import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { currentSession, mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/WorkspacePending"
const workspace = "C:/OpenCode/pending-workspace"
const projectID = "proj_workspace_pending"
const draftID = "draft_workspace_pending"
const otherID = "ses_workspace_pending_other"
const text = "Create the workspace, then explain the pending session."
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const sessionPath = `/server/${base64Encode(server)}/session/`
const draftPath = `/new-session?draftId=${draftID}`
const headers = { "access-control-allow-origin": "*" }

test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } })

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`shows a pending workspace session immediately on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const mock = await openDraft(page)
    const pending = await submitPending(page, mock)

    await expect(pending.message).toBeInViewport()
    await expect(pending.shimmer).toBeInViewport()
    await testInfo.attach("creating-worktree", {
      body: await page.screenshot({ path: testInfo.outputPath(`pending-${viewport.name}.png`) }),
      contentType: "image/png",
    })

    if (viewport.name === "mobile") {
      await page.locator("html").evaluate((element) => {
        element.dir = "rtl"
      })
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
      await expect(pending.message).toBeInViewport()
      await expect(pending.shimmer).toBeInViewport()
      await expect(page.locator('[data-component="session-preparing"]')).toHaveCSS("direction", "rtl")
      expect(
        await page
          .locator('[data-component="session-preparing"]')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true)
    }

    if (viewport.name === "desktop") {
      await page.locator(`[data-titlebar-tab-link][href="${sessionPath}${otherID}"]`).click()
      await expect(page).toHaveURL(`${sessionPath}${otherID}`)
      await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
      await expect(pending.shimmer).toBeHidden()

      await page.locator(`[data-titlebar-tab-link][href="${sessionPath}${pending.sessionID}"]`).click()
      await expect(page).toHaveURL(pending.url)
      await expect(pending.message).toHaveAttribute("data-timeline-part-id", `${pending.messageID}:text:0`)
      await expect(pending.shimmer).toHaveAttribute("data-active", "true")
      expect(mock.calls).toEqual(["worktree"])

      await page.locator(`[data-titlebar-tab-link][href="${sessionPath}${otherID}"]`).click()
      await expect(page).toHaveURL(`${sessionPath}${otherID}`)
      await page.locator('[data-component="composer-editor"]').fill("Keep focus in this other session")
      await expect(page.locator('[data-component="composer-editor"]')).toBeFocused()
    }

    expect(mock.calls).toEqual(["worktree"])
    mock.worktree.resolve({ status: 200, json: { directory: workspace } })
    await expect
      .poll(() => mock.prompts)
      .toEqual([{ sessionID: pending.sessionID, body: expect.objectContaining({ id: pending.messageID, text }) }])
    expect(mock.creates).toEqual([
      expect.objectContaining({ id: pending.sessionID, location: { directory: workspace } }),
    ])
    expect(mock.calls).toEqual(["worktree", "session", "prompt"])

    if (viewport.name === "desktop") {
      await expect(page.locator(`[data-titlebar-tab-link][href="${sessionPath}${pending.sessionID}"]`)).toContainText(
        "Created workspace session",
      )
      await expect(page).toHaveURL(`${sessionPath}${otherID}`)
      await expect(page.locator('[data-component="composer-editor"]')).toHaveText("Keep focus in this other session")
      await expect(page.locator('[data-component="composer-editor"]')).toBeFocused()
      await page.locator(`[data-titlebar-tab-link][href="${sessionPath}${pending.sessionID}"]`).click()
    }

    await expect(page).toHaveURL(pending.url)
    await expect(pending.shimmer).toHaveCount(0)
    await expect(pending.message).toHaveCount(1)
    await expect(pending.message.locator('[data-slot="user-message-text"]')).toHaveText(text)
    await expect(pending.message).toHaveAttribute("data-timeline-part-id", `${pending.messageID}:text:0`)
  })
}

test("restores the original draft when worktree creation fails", async ({ page }) => {
  const mock = await openDraft(page)
  const pending = await submitPending(page, mock)

  mock.worktree.resolve({ status: 500, json: { message: "Worktree creation failed in the fixture" } })

  await expect(page).toHaveURL(draftPath)
  await expect(page.getByText("Failed to create worktree", { exact: true })).toBeVisible()
  await expect(page.locator('[data-component="composer-editor"]')).toHaveText(text)
  await expect(page.locator('[data-action="composer-submit"]')).toBeEnabled()
  await expect(page.getByRole("button", { name: "New workspace", exact: true })).toBeVisible()
  await expect(pending.shimmer).toHaveCount(0)
  await expect(pending.message).toHaveCount(0)
  await expect(page.locator(`[data-titlebar-tab-link][href="${sessionPath}${pending.sessionID}"]`)).toHaveCount(0)
  expect(mock.calls).toEqual(["worktree"])
  expect(mock.creates).toEqual([])
  expect(mock.prompts).toEqual([])
})

test("retains the draft and reuses the created workspace after session creation fails", async ({ page }) => {
  const mock = await openDraft(page, { failSessionCreate: true })
  const pending = await submitPending(page, mock)

  mock.worktree.resolve({ status: 200, json: { directory: workspace } })

  await expect(page).toHaveURL(draftPath)
  await expect(page.getByText("Failed to create session", { exact: true })).toBeVisible()
  await expect(page.locator('[data-component="composer-editor"]')).toHaveText(text)
  await expect(page.locator('[data-action="composer-submit"]')).toBeEnabled()
  await expect(page.getByRole("button", { name: "pending-workspace", exact: true })).toBeVisible()
  await expect(pending.shimmer).toHaveCount(0)
  await expect(pending.message).toHaveCount(0)
  expect(mock.creates).toEqual([expect.objectContaining({ id: pending.sessionID, location: { directory: workspace } })])
  expect(mock.calls).toEqual(["worktree", "session"])
  expect(mock.prompts).toEqual([])

  await page.locator('[data-action="composer-submit"]').click()

  await expect.poll(() => mock.prompts.length).toBe(1)
  expect(mock.creates).toHaveLength(2)
  expect(mock.creates[1]).toMatchObject({ location: { directory: workspace } })
  expect(mock.prompts[0]).toMatchObject({ sessionID: mock.creates[1].id, body: { text } })
  expect(mock.calls).toEqual(["worktree", "session", "session", "prompt"])
  await expect(page).toHaveURL(`${sessionPath}${mock.creates[1].id}`)
  await expect(page.locator('[data-component="user-message"] [data-slot="user-message-text"]')).toHaveText(text)
})

test("restores the draft after closing and revisiting a pending session that fails", async ({ page }) => {
  const mock = await openDraft(page)
  const pending = await submitPending(page, mock)
  const tab = page.locator(`[data-titlebar-tab-link][href="${sessionPath}${pending.sessionID}"]`)

  await page.locator("[data-titlebar-tab-slot]").filter({ has: tab }).locator('[data-slot="tab-close"] button').click()

  await expect(page).toHaveURL(`${sessionPath}${otherID}`)
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await expect(tab).toHaveCount(0)
  await expect(pending.shimmer).toHaveCount(0)

  await page.goBack()

  await expect(page).toHaveURL(pending.url)
  await expect(tab).toHaveCount(1)
  await expect(tab).toBeVisible()
  await expect(pending.message).toHaveCount(1)
  await expect(pending.message.locator('[data-slot="user-message-text"]')).toHaveText(text)
  await expect(pending.message).toHaveAttribute("data-timeline-part-id", `${pending.messageID}:text:0`)
  await expect(pending.shimmer).toBeVisible()
  await expect(pending.shimmer).toContainText("Creating worktree")
  await expect(pending.shimmer).toHaveAttribute("data-active", "true")
  expect(mock.calls).toEqual(["worktree"])

  mock.worktree.resolve({ status: 500, json: { message: "Worktree creation failed after revisiting the session" } })

  await expect(page).toHaveURL(draftPath)
  await expect(page.getByText("Failed to create worktree", { exact: true })).toBeVisible()
  await expect(page.locator('[data-component="composer-editor"]')).toHaveText(text)
  await expect(page.locator('[data-action="composer-submit"]')).toBeEnabled()
  await expect(page.getByRole("button", { name: "New workspace", exact: true })).toBeVisible()
  await expect(page.locator(`[data-titlebar-tab-link][href="${draftPath}"]`)).toHaveCount(1)
  await expect(tab).toHaveCount(0)
  await expect(pending.shimmer).toHaveCount(0)
  await expect(pending.message).toHaveCount(0)
  expect(mock.calls).toEqual(["worktree"])
  expect(mock.creates).toEqual([])
  expect(mock.prompts).toEqual([])
})

async function openDraft(page: Page, options?: { failSessionCreate?: boolean }) {
  const worktree = Promise.withResolvers<{ status: number; json: { directory?: string; message?: string } }>()
  const calls: string[] = []
  const creates: Record<string, unknown>[] = []
  const prompts: { sessionID: string; body: Record<string, unknown> }[] = []
  const project = {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "workspace-pending",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [] as string[],
  }
  const sessions = [currentSession({ id: otherID, projectID, title: "Other session" }, directory)]
  await mockOpenCodeServer(page, {
    directory,
    project,
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { "pending-model": { id: "pending-model", name: "Pending Model", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "pending-model" },
    },
    sessions,
    pageMessages: () => ({ items: [] }),
    onPrompt: (input) => prompts.push(input),
  })
  page.on("request", (request) => {
    if (request.method() !== "POST") return
    const path = new URL(request.url()).pathname
    if (path === `/api/worktree/${projectID}`) calls.push("worktree")
    if (path === "/api/session") calls.push("session")
    if (/^\/api\/session\/[^/]+\/prompt$/.test(path)) calls.push("prompt")
  })
  await page.route(`**/api/worktree/${projectID}`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    // Keep the real HTTP response pending until the test has checked the preview.
    const response = await worktree.promise
    if (response.status === 200) project.sandboxes.push(workspace)
    await route.fulfill({ ...response, headers })
  })
  await page.route("**/api/session", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    const body: Record<string, unknown> = route.request().postDataJSON()
    creates.push(body)
    if (options?.failSessionCreate && creates.length === 1) {
      return route.fulfill({ status: 500, json: { message: "Session creation failed in the fixture" }, headers })
    }
    if (typeof body.id !== "string") throw new Error("Session creation must use the client-reserved ID")
    const session = currentSession({ ...body, id: body.id, projectID, title: "Created workspace session" }, workspace)
    sessions.push(session)
    return route.fulfill({ json: { data: session }, headers })
  })
  await page.route("**/api/location?**", (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      json: {
        directory: new URL(route.request().url()).searchParams.get("location[directory]") ?? directory,
        project: { id: projectID, directory, canonical: directory },
      },
      headers,
    })
  })
  await page.addInitScript(
    ({ directory, draftID, otherID, server }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([
          { type: "draft", draftID, server, directory },
          { type: "session", sessionId: otherID, server },
        ]),
      )
    },
    { directory, draftID, otherID, server },
  )
  await page.goto(draftPath)
  await expectAppVisible(page.locator('[data-component="composer-editor"]'))
  await page.getByRole("button", { name: "Local", exact: true }).click()
  await page.getByRole("menuitem", { name: "New workspace", exact: true }).click()
  await expect(page.getByRole("button", { name: "New workspace", exact: true })).toBeVisible()
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  return { worktree, calls, creates, prompts }
}

async function submitPending(page: Page, mock: Awaited<ReturnType<typeof openDraft>>) {
  await page.locator('[data-component="composer-editor"]').fill(text)
  await expect(page.locator('[data-action="composer-submit"]')).toBeEnabled()
  await page.locator('[data-action="composer-submit"]').click()
  await expect(page).toHaveURL((url) => url.pathname.startsWith(sessionPath) && /\/ses_[^/]+$/.test(url.pathname))
  const url = page.url()
  const sessionID = new URL(url).pathname.slice(sessionPath.length)
  const preparing = page.locator('[data-component="session-preparing"]')
  const message = page.locator('[data-component="user-message"]')
  const shimmer = preparing.getByRole("status").locator('[data-component="text-shimmer"]')
  await expect(preparing).toBeVisible()
  await expect(preparing.locator('[data-component="user-message"]')).toHaveCount(1)
  await expect(message).toHaveCount(1)
  await expect(message.locator('[data-slot="user-message-text"]')).toHaveText(text)
  await expect(message).toHaveAttribute("data-timeline-part-id", /^.+:text:0$/)
  const messageID = (await message.getAttribute("data-timeline-part-id"))!.replace(/:text:0$/, "")
  await expect(shimmer).toBeVisible()
  await expect(shimmer).toContainText("Creating worktree")
  await expect(shimmer).toHaveAttribute("data-active", "true")
  await expect.poll(() => mock.calls).toEqual(["worktree"])
  expect(mock.creates).toEqual([])
  expect(mock.prompts).toEqual([])
  return { url, sessionID, messageID, message, shimmer }
}
