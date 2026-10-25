import { base64Encode } from "@bolt-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockBoltServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"
import { mockWorkspace, type WorkspaceInput } from "../utils/workspace"

const directory = "C:/Bolt/RequestDocks"
const projectID = "proj_request_docks"
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

async function mockServer(
  page: Page,
  requests: {
    permissions?: unknown[] | (() => unknown[])
    questions?: unknown[] | (() => unknown[])
  },
) {
  await mockBoltServer(page, {
    protocol: "v2",
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "request-docks",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "bolt",
          name: "Bolt",
          models: {
            "claude-opus-4-6": {
              id: "claude-opus-4-6",
              name: "Claude Opus 4.6",
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: ["bolt"],
      default: { providerID: "bolt", modelID: "claude-opus-4-6" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "request-docks",
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    permissions: requests.permissions,
    questions: requests.questions,
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
}
