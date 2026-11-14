import type { OpenCodeEvent } from "@opencode/client/promise"
import { expect, test, type Page } from "@playwright/test"
import { SERVER, sessionHref } from "../utils/app"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"
import { mockWorkspace, type WorkspaceInput } from "../utils/workspace"

const directory = "C:/OpenCode/RequestDocks"

const sessionID = "ses_request_docks"

const title = "Request dock regression"

test("shows a pending question dock", async ({ page }) => {
  await mockServer(page, {
    forms: [
      {
        id: "frm_question_request",
        sessionID,
        title: "Questions",
        metadata: { kind: "question" },
        fields: [
          {
            key: "q0",
            type: "string",
            title: "Implementation",
            description: "Which implementation should be used?",
            options: [
              { value: "minimal", label: "Minimal", description: "Use the smallest correct change" },
              { value: "extended", label: "Extended", description: "Include additional behavior" },
            ],
            custom: true,
          },
        ],
      },
    ],
  })

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)

  const question = page.locator('[data-component="dock-prompt"][data-kind="question"]')
  await expect(question).toBeVisible()
  await expect(question.getByText("Which implementation should be used?")).toBeVisible()
  await expect(question.getByRole("radio", { name: /Minimal/ })).toBeVisible()
  await expect(question.getByRole("radio", { name: /Extended/ })).toBeVisible()
  await expect(page.locator('[data-component="composer"]')).toHaveCount(0)

  const rejectRequests: string[] = []
  page.on("request", (request) => {
    if (
      request.method() === "DELETE" &&
      new URL(request.url()).pathname === `/api/session/${sessionID}/form/frm_question_request`
    )
      rejectRequests.push(request.url())
  })

  await question.getByRole("button", { name: "Minimize question" }).click()
  await expect(question).toBeVisible()
  await expect(question.getByText("Which implementation should be used?")).toBeVisible()
  await expect(question.getByText("Select one answer")).toBeHidden()
  await expect(question.getByRole("radio", { name: /Minimal/ })).toBeHidden()
  await expect(question.getByRole("radio", { name: /Extended/ })).toBeHidden()
  await expect(question.getByRole("button", { name: "Dismiss" })).toBeVisible()
  await expect(question.getByRole("button", { name: "Submit" })).toBeVisible()
  await expect(page.locator('[data-component="question-minimized-dock"]')).toHaveCount(0)
  expect(rejectRequests).toEqual([])

  await question.getByRole("button", { name: "Restore question" }).click()
  await expect(question).toBeVisible()
  await expect(question.getByText("Which implementation should be used?")).toBeVisible()
  await expect(question.getByRole("radio", { name: /Minimal/ })).toBeVisible()
  expect(rejectRequests).toEqual([])

  await question.getByRole("radio", { name: /Minimal/ }).click()

  const reply = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/api/session/${sessionID}/form/frm_question_request/reply`,
  )

  await question.getByRole("button", { name: "Submit" }).click()
  expect((await reply).postDataJSON()).toEqual({ answer: { q0: "minimal" } })
})

test("replies with predefined choices and the edited custom multiselect answer", async ({ page }) => {
  await mockServer(page, {
    forms: [
      {
        id: "frm_question_multiselect",
        sessionID,
        title: "Questions",
        metadata: { kind: "question" },
        fields: [
          {
            key: "q0",
            type: "multiselect",
            title: "Include",
            description: "Which supporting surfaces should remain visible?",
            options: [
              { value: "files", label: "Changed files" },
              { value: "terminal", label: "Terminal" },
            ],
            custom: true,
          },
        ],
      },
    ],
  })

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)
  const question = page.locator('[data-component="dock-prompt"][data-kind="question"]')
  const files = question.getByRole("checkbox", { name: "Changed files", exact: true })
  const terminal = question.getByRole("checkbox", { name: "Terminal", exact: true })
  const custom = question.getByRole("checkbox", { name: "Type your own answer…", exact: true })
  const input = question.getByRole("textbox", { name: "Type your own answer…", exact: true })
  const cancellations: string[] = []
  page.on("request", (request) => {
    if (
      request.method() === "DELETE" &&
      new URL(request.url()).pathname === `/api/session/${sessionID}/form/frm_question_multiselect`
    )
      cancellations.push(request.url())
  })

  await expect(files).not.toBeChecked()
  await files.click()
  await input.fill("Original custom answer")
  await expect(custom).toBeChecked()
  await expect(files).toBeChecked()
  await terminal.click()
  await expect(terminal).toBeChecked()
  await expect(custom).toBeChecked()
  await expect(files).toBeChecked()

  await custom.click()
  await expect(custom).not.toBeChecked()
  await expect(input).toHaveValue("Original custom answer")
  await expect(files).toBeChecked()
  await expect(terminal).toBeChecked()
  await input.focus()
  await expect(custom).not.toBeChecked()
  await expect(files).toBeChecked()
  await expect(terminal).toBeChecked()
  await custom.click()
  await expect(custom).toBeChecked()
  await expect(input).toHaveValue("Original custom answer")
  await expect(files).toBeChecked()
  await expect(terminal).toBeChecked()

  await input.fill("Updated custom answer")
  await input.press("Escape")
  await expect(input).not.toBeFocused()
  await expect(question.getByRole("button", { name: "Submit", exact: true })).toBeEnabled()
  await expect(input).toHaveValue("Updated custom answer")
  await expect(custom).toBeChecked()
  await expect(files).toBeChecked()
  await expect(terminal).toBeChecked()
  expect(cancellations).toEqual([])

  const reply = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/api/session/${sessionID}/form/frm_question_multiselect/reply`,
  )

  await question.getByRole("button", { name: "Submit", exact: true }).press("Control+Enter")
  expect((await reply).postDataJSON()).toEqual({ answer: { q0: ["files", "terminal", "Updated custom answer"] } })
  expect(cancellations).toEqual([])
})

test("keeps a choice when a custom answer with its value is turned off, and replies once", async ({ page }) => {
  const form = {
    id: "frm_question_once",
    sessionID,
    title: "Questions",
    metadata: { kind: "question" },
    fields: [
      {
        key: "q0",
        type: "multiselect",
        title: "Include",
        description: "Which supporting surfaces should remain visible?",
        options: [
          { value: "files", label: "Changed files" },
          { value: "terminal", label: "Terminal" },
        ],
        custom: true,
      },
    ],
  }

  const replies: unknown[] = []
  const transport = await installSseTransport(page, { server: SERVER, retry: 20 })
  await mockServer(page, { forms: () => (replies.length > 0 ? [] : [form]) })
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/api/session/${sessionID}/form/frm_question_once/reply`
    )
      replies.push(request.postDataJSON())
  })
  await page.goto(sessionHref(sessionID))
  await transport.waitForConnection()
  await expectSessionTitle(page, title)

  const question = page.locator('[data-component="dock-prompt"][data-kind="question"]')
  const files = question.getByRole("checkbox", { name: "Changed files", exact: true })
  const custom = question.getByRole("checkbox", { name: "Type your own answer…", exact: true })
  const input = question.getByRole("textbox", { name: "Type your own answer…", exact: true })
  const submit = question.getByRole("button", { name: "Submit", exact: true })
  const dismiss = question.getByRole("button", { name: "Dismiss", exact: true })

  await files.click()
  await input.fill("files")
  await expect(custom).toBeChecked()
  await custom.click()
  await expect(custom).not.toBeChecked()
  await expect(files).toBeChecked()

  const reply = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/session/${sessionID}/form/frm_question_once/reply`,
  )

  await submit.click()
  expect((await reply).request().postDataJSON()).toEqual({ answer: { q0: ["files"] } })

  // The server has the answer but has not announced the form settled yet, so nothing can send it again.
  await expect(submit).toBeDisabled()
  await expect(dismiss).toBeDisabled()
  await expect(files).toHaveAttribute("aria-disabled", "true")

  await transport.send({
    id: "evt_form_replied_once",
    created: 1700000003000,
    type: "form.replied",
    location: { directory },
    data: { sessionID, id: "frm_question_once", answer: { q0: ["files"] } },
  })
  await expect(question).toHaveCount(0)
  expect(replies).toEqual([{ answer: { q0: ["files"] } }])
})

test("shows a pending permission dock", async ({ page }) => {
  const replies: { sessionID: string; permissionID: string; body: unknown }[] = []
  await mockServer(page, {
    onPermissionReply: (reply) => replies.push(reply),
    sessionPermissions: {
      [sessionID]: [
        {
          id: "permission-request",
          sessionID,
          permission: "shell",
          patterns: ["git status", "git diff"],
          metadata: {},
          always: [],
        },
      ],
    },
  })

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)

  const permission = page.locator('[data-component="dock-prompt"][data-kind="permission"]')
  await expect(permission).toBeVisible()
  await expect(permission.getByText("git status")).toBeVisible()
  await expect(permission.getByText("git diff")).toBeVisible()
  await expect(permission.locator('[data-slot="permission-footer-actions"] button')).toHaveCount(3)
  await expect(page.locator('[data-component="composer"]')).toHaveCount(0)

  const reply = page.waitForResponse((response) => response.request().method() === "POST")
  await permission.getByRole("button", { name: "Allow once" }).click()
  const response = await reply
  expect(new URL(response.url()).pathname).toBe(`/api/session/${sessionID}/permission/permission-request/reply`)
  expect(response.request().postDataJSON()).toEqual({ decision: "once" })
  expect(response.status()).toBe(204)
  expect(replies).toEqual([{ sessionID, permissionID: "permission-request", body: { decision: "once" } }])
  await expect(permission).toHaveCount(0)
  await expect(page.locator('[data-component="composer"]')).toBeVisible()
})

test("sends one permission reply and closes the dock when it lands, before permission.replied", async ({ page }) => {
  await mockServer(page, {
    sessionPermissions: {
      [sessionID]: [
        {
          id: "permission-request",
          sessionID,
          permission: "shell",
          patterns: ["git status"],
          metadata: {},
          always: [],
        },
      ],
    },
  })
  const replies: unknown[] = []
  const released = Promise.withResolvers<void>()
  // Answers without the `permission.replied` event the server also publishes, so only the reply can close the dock.
  await page.route(/\/api\/session\/ses_request_docks\/permission\/permission-request\/reply/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    replies.push(route.request().postDataJSON())
    await released.promise
    await route.fulfill({ status: 204 })
  })

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)

  const permission = page.locator('[data-component="dock-prompt"][data-kind="permission"]')
  const actions = permission.locator('[data-slot="permission-footer-actions"]')
  await permission.getByRole("button", { name: "Allow once" }).dblclick()
  await expect.poll(() => replies.length).toBe(1)

  for (const name of ["Deny", "Allow always", "Allow once"])
    await expect(actions.getByRole("button", { name, exact: true })).toBeDisabled()

  released.resolve()
  await expect(permission).toHaveCount(0)
  await expect(page.locator('[data-component="composer"]')).toBeVisible()
  await expect(page.getByText("Request failed", { exact: true })).toHaveCount(0)
  expect(replies).toEqual([{ decision: "once" }])
})

test("shows an auto-accepted permission in the dock once its replies stop answering", async ({ page }) => {
  const permissionID = "permission-hung"
  const attempts = { count: 0 }
  await page.clock.install()
  await mockWorkspace(page, {
    name: "RequestDocks",
    directory,
    sessions: [{ id: sessionID, title }],
    sessionPermissions: {
      [sessionID]: [
        { id: permissionID, sessionID, action: "shell", resources: ["git status"], metadata: {}, save: [] },
      ],
    },
    seed: { settings: { permissions: { autoApprove: true } } },
  })
  // Every reply reaches the server and never answers.
  await page.route(new RegExp(`/api/session/${sessionID}/permission/${permissionID}/reply(\\?|$)`), (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    attempts.count++
  })

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)
  const permission = page.locator('[data-component="dock-prompt"][data-kind="permission"]')

  // Each reply times out, then the next one starts after its retry delay.
  await expect.poll(() => attempts.count).toBe(1)
  await page.clock.fastForward(15_000)
  await page.clock.fastForward(1_000)
  await expect.poll(() => attempts.count).toBe(2)
  await page.clock.fastForward(15_000)
  await page.clock.fastForward(2_000)
  await expect.poll(() => attempts.count).toBe(3)
  await expect(permission).toHaveCount(0)

  await page.clock.fastForward(15_000)
  await expect(permission.getByText("git status")).toBeVisible()
  expect(attempts.count).toBe(3)
})

test("keeps a typed MCP elicitation answer across a session switch and submits it once", async ({ page }) => {
  const other = { id: "ses_request_docks_other", title: "Other request session" }

  const form = {
    id: "frm_mcp_draft",
    sessionID,
    title: "Deploy",
    metadata: { kind: "mcp-elicitation", server: "release" },
    fields: [{ key: "env", type: "string", title: "Environment" }],
  }

  const replies: unknown[] = []
  await mockWorkspace(page, {
    name: "RequestDocks",
    directory,
    sessions: [{ id: sessionID, title }, other],
    forms: () => (replies.length > 0 ? [] : [form]),
    onFormReply: (reply) => replies.push(reply.body),
    seed: { tabs: [sessionID, other.id] },
  })

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)
  const dock = page.locator('[data-component="session-elicitation-dock"]')
  const input = dock.getByRole("textbox", { name: "Environment", exact: true })
  await input.fill("staging")

  await page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(other.id)}"])`).click()
  await expectSessionTitle(page, other.title)
  await expect(dock).toHaveCount(0)
  await page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sessionID)}"])`).click()
  await expectSessionTitle(page, title)
  await expect(input).toHaveValue("staging")

  await dock.getByRole("button", { name: "Submit", exact: true }).dblclick()
  await expect(dock).toHaveCount(0)
  await expect(page.locator('[data-component="composer"]')).toBeVisible()
  expect(replies).toEqual([{ answer: { env: "staging" } }])
})

test("gives a Location elicitation's hung reply back after 30 s and closes it on form.replied", async ({ page }) => {
  const form = {
    id: "frm_mcp_global",
    sessionID: "global",
    title: "Deploy",
    metadata: { kind: "mcp-elicitation", server: "release" },
    fields: [{ key: "env", type: "string", title: "Environment" }],
  }

  const replies: { body: unknown; directory: string | undefined }[] = []
  const transport = await installSseTransport(page, { server: SERVER, retry: 20 })
  await page.clock.install()
  await mockServer(page, { forms: [form] })
  // The server takes the reply and never answers it.
  await page.route(/\/api\/session\/global\/form\/frm_mcp_global\/reply(\?|$)/, (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    replies.push({ body: route.request().postDataJSON(), directory: route.request().headers()["x-opencode-directory"] })
  })

  await page.goto(sessionHref(sessionID))
  await transport.waitForConnection()
  await expectSessionTitle(page, title)
  const dock = page.locator('[data-component="session-elicitation-dock"]')
  const input = dock.getByRole("textbox", { name: "Environment", exact: true })
  const submit = dock.getByRole("button", { name: "Submit", exact: true })
  await input.fill("prod")

  await submit.dblclick()
  await expect.poll(() => replies.length).toBe(1)
  await expect(submit).toBeDisabled()
  expect(replies).toEqual([{ body: { answer: { env: "prod" } }, directory: encodeURIComponent(directory) }])

  await page.clock.fastForward(30_000)
  await expect(submit).toBeEnabled()
  await expect(input).toHaveValue("prod")
  await expect(page.getByText("Request failed", { exact: true })).toBeVisible()

  await transport.send({
    id: "evt_form_replied_global",
    created: 1700000004000,
    type: "form.replied",
    location: { directory },
    data: { sessionID: "global", id: "frm_mcp_global", answer: { env: "prod" } },
  })
  await expect(dock).toHaveCount(0)
  await expect(page.locator('[data-component="composer"]')).toBeVisible()
  expect(replies).toHaveLength(1)
})

test("names the MCP tool, the hook's message and the full input in the permission dock", async ({ page }) => {
  const body = "x".repeat(3000)
  await mockServer(page, {
    sessionPermissions: {
      [sessionID]: [
        {
          id: "permission-request",
          sessionID,
          action: "linear_save_comment",
          resources: ["*"],
          save: ["*"],
          metadata: { input: { issueId: "ENG-1", labels: ["bug"], body } },
          message: "Posts a comment on a Linear issue",
        },
      ],
    },
  })

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)

  const permission = page.locator('[data-component="dock-prompt"][data-kind="permission"]')
  const input = permission.locator('[data-slot="permission-input"]')
  await expect(permission.getByText("linear_save_comment")).toBeVisible()
  await expect(permission.getByText("Posts a comment on a Linear issue")).toBeVisible()
  await expect(input.getByText("issueId: ENG-1")).toBeVisible()
  await expect(input.getByText('labels: ["bug"]')).toBeVisible()
  // The user approves these arguments, so a long one stays whole and scrolls inside the dock instead of being cut
  await expect(input.getByText(`body: ${body}`, { exact: true })).toBeVisible()
  await expect.poll(() => input.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  // "Allow always" saves the wildcard, so its scope stays visible next to this call's input
  await expect(permission.locator('[data-slot="permission-patterns"]').getByText("*", { exact: true })).toBeVisible()
})

test("loads a running subagent's question without polling idle subagents on every update", async ({ page }) => {
  const runningID = "ses_request_running_subagent"
  const idleIDs = Array.from({ length: 20 }, (_, index) => `ses_request_idle_${index}`)

  const workspace = await mockWorkspace(page, {
    name: "RequestDocks",
    directory,
    sessions: [
      { id: sessionID, title },
      { id: runningID, title: "Running subagent", parentID: sessionID },
      ...idleIDs.map((id) => ({ id, title: id, parentID: sessionID })),
    ],
    seed: { tabs: [sessionID] },
    // The mock reports a Session with a pending form as running.
    forms: [
      {
        id: "frm_subagent_question",
        sessionID: runningID,
        title: "Questions",
        metadata: { kind: "question" },
        fields: [{ key: "q0", type: "string", title: "Direction", description: "Which way should the subagent go?" }],
      },
    ],
  })

  // Idle subagents whose worktrees were deleted; a failed read is retried on its next sync.
  await page.route(/\/api\/session\/ses_request_idle_\d+\/form$/, (route) =>
    route.fulfill({ status: 404, json: { message: "Location not found" } }),
  )

  const forms: string[] = []
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname

    if (request.method() === "GET" && path.startsWith("/api/session/") && path.endsWith("/form")) forms.push(path)
  })

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)
  await expect(
    page.locator('[data-component="dock-prompt"][data-kind="question"]').getByText("Which way should the subagent go?"),
  ).toBeVisible()

  // Every session update used to re-request the forms of the whole subagent tree.
  await workspace.push(
    [...idleIDs, sessionID].map(
      (id, index) =>
        // SAFETY: the fixture event matches the generated OpenCodeEvent shape for its type.
        ({
          id: `evt_request_rename_${index}`,
          created: index + 2,
          type: "session.renamed",
          durable: { aggregateID: id, seq: 1, version: 1 },
          data: { sessionID: id, title: id === sessionID ? "Renamed request docks" : `${id} renamed` },
        }) as OpenCodeEvent,
    ),
  )
  await expect(page.getByRole("heading", { name: "Renamed request docks", exact: true })).toBeVisible()
  expect(forms.toSorted()).toEqual([`/api/session/${runningID}/form`, `/api/session/${sessionID}/form`].toSorted())
})

test("restores the draft caret before typing after a request dock closes", async ({ page }) => {
  const transport = await installSseTransport(page, { server: SERVER, retry: 20 })
  await mockServer(page, { forms: [] })
  await page.goto(sessionHref(sessionID))
  await transport.waitForConnection()
  await expectSessionTitle(page, title)

  const editor = page.locator('[data-component="composer-editor"][contenteditable="true"]')
  const draft = "keep the caret at the end"

  const caret = () =>
    editor.evaluate((element) => {
      const selection = window.getSelection()

      if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return -1
      const range = selection.getRangeAt(0).cloneRange()
      range.selectNodeContents(element)
      range.setEnd(selection.anchorNode!, selection.anchorOffset)

      return range.toString().length
    })

  await editor.fill(draft)
  // The editor places the caret after the filled text; move it only from that known position.
  await expect.poll(caret).toBe(draft.length)

  for (let index = 0; index < 4; index++) await page.keyboard.press("ArrowLeft")
  const cursor = draft.length - 4
  await expect.poll(caret).toBe(cursor)
  await transport.send({
    id: "evt_form_created",
    created: 1700000001000,
    type: "form.created",
    location: { directory },
    data: {
      form: {
        id: "frm_question_caret",
        sessionID,
        title: "Questions",
        metadata: { kind: "question", tool: { messageID: "message-caret", id: "call-caret" } },
        fields: [
          {
            key: "q0",
            type: "string",
            title: "Continue",
            description: "Continue?",
            options: [{ value: "yes", label: "Yes", description: "Continue the session" }],
            custom: true,
          },
        ],
      },
    },
  })
  const question = page.locator('[data-component="dock-prompt"][data-kind="question"]')
  await expect(question).toBeVisible()
  await expect(editor).toHaveCount(0)

  await transport.send({
    id: "evt_form_cancelled",
    created: 1700000002000,
    type: "form.cancelled",
    location: { directory },
    data: { sessionID, id: "frm_question_caret" },
  })
  await expect(question).toHaveCount(0)
  await expect(editor).toBeVisible()
  await page.keyboard.press("x")

  await expect(editor).toHaveText(`${draft.slice(0, cursor)}x${draft.slice(cursor)}`)
})

function mockServer(page: Page, requests: Pick<WorkspaceInput, "sessionPermissions" | "onPermissionReply" | "forms">) {
  return mockWorkspace(page, { name: "RequestDocks", directory, sessions: [{ id: sessionID, title }], ...requests })
}
