import { expect, test, type Locator, type Page, type Route } from "@playwright/test"

const directory = "C:/OpenCode/TimelineStateRegression"
const projectID = "proj_timeline_state_regression"
const sessionID = "ses_timeline_state_regression"
const userMessageID = "msg_user_regression"
const assistantMessageID = "msg_assistant_regression"
const editPartID = "prt_0001_edit"
const textPartID = "prt_9999_text"
const title = "Timeline collapse state regression"
const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

type EventPayload = {
  directory: string
  payload: Record<string, unknown>
}

declare global {
  interface Window {
    __timelineDiffProbe: {
      reset: () => void
      shadowRoots: () => number
    }
  }
}

const userMessage = {
  info: {
    id: userMessageID,
    sessionID,
    role: "user",
    time: { created: 1700000000000 },
    summary: { diffs: [] },
    agent: "build",
    model,
  },
  parts: [
    {
      id: "prt_user_text",
      sessionID,
      messageID: userMessageID,
      type: "text",
      text: "Please edit the file.",
    },
  ],
}

const editPart = {
  id: editPartID,
  sessionID,
  messageID: assistantMessageID,
  type: "tool",
  callID: "call_edit_regression",
  tool: "edit",
  state: {
    status: "completed",
    input: { filePath: "src/regression.ts" },
    output: "Edited src/regression.ts",
    title: "src/regression.ts",
    metadata: {
      filediff: {
        file: "src/regression.ts",
        additions: 1,
        deletions: 1,
        before: "export const value = 'before'\n",
        after: "export const value = 'after'\n",
      },
      diff: "diff --git a/src/regression.ts b/src/regression.ts\n-export const value = 'before'\n+export const value = 'after'\n",
    },
    time: { start: 1700000001000, end: 1700000002000 },
  },
}

const streamedTextPart = {
  id: textPartID,
  sessionID,
  messageID: assistantMessageID,
  type: "text",
  text: "Streaming added a later assistant text part.",
}

const assistantMessage = {
  info: {
    id: assistantMessageID,
    sessionID,
    role: "assistant",
    time: { created: 1700000001000 },
    parentID: userMessageID,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    cost: 0.01,
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
    variant: "max",
  },
  parts: [editPart],
}

test.describe("regression: session timeline local row state", () => {
  test("keeps a manually collapsed tool collapsed when later assistant content streams", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expect(page.getByRole("heading", { name: title })).toBeVisible()

    const wrapper = page.locator(`[data-timeline-part-id="${editPartID}"]`).first()
    await expect(wrapper).toBeVisible()
    await expectExpanded(wrapper, true)

    await wrapper.evaluate((element) => {
      ;(element as HTMLElement).dataset.regressionMarker = "before-stream"
    })
    await wrapper.locator('[data-slot="collapsible-trigger"]').first().click()
    await expectExpanded(wrapper, false)

    events.push({
      directory,
      payload: {
        type: "message.part.updated",
        properties: { part: streamedTextPart },
      },
    })

    await expect(page.locator(`[data-timeline-part-id="${textPartID}"]`).first()).toBeVisible({ timeout: 10_000 })

    expect(await readToolState(page)).toEqual({
      expanded: false,
      row: "AssistantPart",
      streamedTextVisible: true,
    })
  })

  test("does not remount an edit diff when sibling parts or diff counts update", async ({ page }) => {
    const events: EventPayload[] = []
    await installDiffProbe(page)
    await mockServer(page, events)
    await configurePage(page)

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expect(page.getByRole("heading", { name: title })).toBeVisible()

    const wrapper = page.locator(`[data-timeline-part-id="${editPartID}"]`).first()
    await expect(wrapper).toBeVisible()
    await expect(wrapper.locator('[data-component="file"][data-mode="diff"]').first()).toBeVisible()
    await markDiffProbe(page)

    events.push({
      directory,
      payload: {
        type: "message.part.updated",
        properties: { part: streamedTextPart },
      },
    })

    await expect(page.locator(`[data-timeline-part-id="${textPartID}"]`).first()).toBeVisible({ timeout: 10_000 })
    expect(await readDiffProbe(page)).toEqual({ fileMarker: "before", shadowRoots: 0, toolMarker: "before" })

    await markDiffProbe(page)
    events.push({
      directory,
      payload: {
        type: "message.part.updated",
        properties: { part: editPartWithAdditions(2) },
      },
    })

    await expect(wrapper.locator('[data-slot="diff-changes-additions"]').filter({ hasText: "+2" }).first()).toBeVisible(
      { timeout: 10_000 },
    )
    expect(await readDiffProbe(page)).toEqual({ fileMarker: "before", shadowRoots: 0, toolMarker: "before" })
  })
})

async function configurePage(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
          showReasoningSummaries: true,
          showSessionProgressBar: true,
        },
      }),
    )
  })
}

async function expectExpanded(locator: Locator, expected: boolean) {
  await expect.poll(() => locator.evaluate(readExpanded)).toBe(expected)
}

async function readToolState(page: Page) {
  return page
    .locator(`[data-timeline-part-id="${editPartID}"]`)
    .first()
    .evaluate(
      (element, textPartID) => ({
        expanded: (() => {
          const trigger = element.querySelector('[data-slot="collapsible-trigger"]')
          const aria = trigger?.getAttribute("aria-expanded")
          if (aria === "true") return true
          if (aria === "false") return false

          const root = element.querySelector('[data-component="collapsible"]')
          if (root?.hasAttribute("data-expanded")) return true
          if (root?.hasAttribute("data-closed")) return false

          const content = element.querySelector<HTMLElement>('[data-slot="collapsible-content"]')
          return !!content && content.getBoundingClientRect().height > 0
        })(),
        row: element.closest("[data-timeline-row]")?.getAttribute("data-timeline-row"),
        streamedTextVisible: !!document.querySelector(`[data-timeline-part-id="${textPartID}"]`),
      }),
      textPartID,
    )
}

async function installDiffProbe(page: Page) {
  await page.addInitScript(() => {
    let shadowRootCount = 0
    const attachShadow = Element.prototype.attachShadow
    Element.prototype.attachShadow = function (init) {
      shadowRootCount += 1
      return attachShadow.call(this, init)
    }
    window.__timelineDiffProbe = {
      reset: () => {
        shadowRootCount = 0
      },
      shadowRoots: () => shadowRootCount,
    }
  })
}

async function markDiffProbe(page: Page) {
  await page
    .locator(`[data-timeline-part-id="${editPartID}"]`)
    .first()
    .evaluate((element) => {
      const tool = element as HTMLElement
      const file = tool.querySelector<HTMLElement>('[data-component="file"][data-mode="diff"]')
      if (!file) throw new Error("missing edit diff file")

      tool.dataset.timelineProbe = "before"
      file.dataset.timelineProbe = "before"
      window.__timelineDiffProbe.reset()
    })
}

async function readDiffProbe(page: Page) {
  return page
    .locator(`[data-timeline-part-id="${editPartID}"]`)
    .first()
    .evaluate((element) => {
      const tool = element as HTMLElement
      const file = tool.querySelector<HTMLElement>('[data-component="file"][data-mode="diff"]')
      return {
        fileMarker: file?.dataset.timelineProbe,
        shadowRoots: window.__timelineDiffProbe.shadowRoots(),
        toolMarker: tool.dataset.timelineProbe,
      }
    })
}

function editPartWithAdditions(additions: number) {
  return {
    ...editPart,
    state: {
      ...editPart.state,
      metadata: {
        ...editPart.state.metadata,
        filediff: {
          ...editPart.state.metadata.filediff,
          additions,
        },
      },
    },
  }
}

function readExpanded(element: Element) {
  const trigger = element.querySelector('[data-slot="collapsible-trigger"]')
  const aria = trigger?.getAttribute("aria-expanded")
  if (aria === "true") return true
  if (aria === "false") return false

  const root = element.querySelector('[data-component="collapsible"]')
  if (root?.hasAttribute("data-expanded")) return true
  if (root?.hasAttribute("data-closed")) return false

  const content = element.querySelector<HTMLElement>('[data-slot="collapsible-content"]')
  return !!content && content.getBoundingClientRect().height > 0
}

async function mockServer(page: Page, events: EventPayload[]) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    const targetPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
    if (url.port !== targetPort) return route.fallback()

    const path = url.pathname
    if (path === "/global/event") return sse(route, events.splice(0))
    if (
      path === "/global/config" ||
      path === "/config" ||
      path === "/provider/auth" ||
      path === "/mcp" ||
      path === "/session/status"
    )
      return json(route, {})
    if (
      ["/skill", "/command", "/lsp", "/formatter", "/permission", "/question", "/vcs/status", "/vcs/diff"].includes(
        path,
      )
    )
      return json(route, [])
    if (path === "/provider") return json(route, provider())
    if (path === "/path")
      return json(route, { state: directory, config: directory, worktree: directory, directory, home: "C:/OpenCode" })
    if (path === "/project") return json(route, [project()])
    if (path === "/project/current") return json(route, project())
    if (path === "/agent") return json(route, [{ name: "build", mode: "primary" }])
    if (path === "/vcs") return json(route, { branch: "main", default_branch: "main" })
    if (path === "/session") return json(route, [session()])
    if (path === `/session/${sessionID}`) return json(route, session())
    if (/^\/session\/[^/]+\/(children|todo|diff)$/.test(path)) return json(route, [])
    if (path === `/session/${sessionID}/message`) return json(route, [userMessage, assistantMessage])
    return json(route, {})
  })
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "timeline-state-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function session() {
  return {
    id: sessionID,
    slug: "timeline-state-regression",
    projectID,
    directory,
    title,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function provider() {
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
    ],
    connected: ["opencode"],
    default: { providerID: "opencode", modelID: "claude-opus-4-6" },
  }
}

function json(route: Route, body: unknown, headers?: Record<string, string>) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "x-next-cursor", ...headers },
    body: JSON.stringify(body ?? null),
  })
}

function sse(route: Route, events: EventPayload[]) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    headers: { "access-control-allow-origin": "*" },
    body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
  })
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}
