import { expect, test, type Page } from "@playwright/test"
import { sessionHref } from "../utils/app"
import { expectSessionTitle } from "../utils/waits"
import { mockWorkspace, type WorkspaceInput } from "../utils/workspace"

const directory = "C:/OpenCode/WebSearchDock"

const sessionID = "ses_websearch_dock"

const title = "Web search dock regression"

const providers = [
  { id: "exa", name: "Exa" },
  { id: "parallel", name: "Parallel" },
]

const consent = {
  id: "frm_websearch_consent",
  sessionID,
  title: "Web Search",
  metadata: { kind: "websearch.provider" },
  fields: [
    {
      key: "choice",
      type: "string",
      required: true,
      custom: false,
      options: [
        { value: "allow", label: "Allow search via Exa, Parallel" },
        { value: "choose", label: "Choose another provider" },
        { value: "disable", label: "Disable web search" },
      ],
    },
  ],
}

const provider = {
  id: "frm_websearch_provider",
  sessionID,
  title: "Choose a web search provider",
  metadata: { kind: "websearch.provider" },
  fields: [
    {
      key: "provider",
      type: "string",
      required: true,
      custom: false,
      options: providers.map((item) => ({ value: item.id, label: item.name })),
    },
  ],
}

type Reply = { sessionID: string; formID: string; body: unknown }

test("sends one consent reply for a double-click and keeps the answered form closed", async ({ page }) => {
  const replies: Reply[] = []
  // The mock keeps listing the consent form after the reply, so the form sync that follows it lists the answered form.
  await mockServer(page, { forms: [consent], onFormReply: (reply) => replies.push(reply) })
  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)

  const dock = page.locator('[data-component="session-websearch-dock"]')
  const enable = dock.getByRole("button", { name: "Enable", exact: true })
  await expect(enable).toBeEnabled()
  await expect(page.locator('[data-component="composer"]')).toHaveCount(0)

  const resynced = page.waitForResponse(
    (response) =>
      replies.length > 0 &&
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === `/api/session/${sessionID}/form`,
  )

  await enable.dblclick()
  await resynced

  await expect(dock).toHaveCount(0)
  await expect(page.locator('[data-component="composer"]')).toBeVisible()
  expect(replies).toEqual([{ sessionID, formID: consent.id, body: { answer: { choice: "allow" } } }])
})

test("answers the provider form a form sync delivers when its form.created event is missed", async ({ page }) => {
  const replies: Reply[] = []
  const state: { forms: unknown[] } = { forms: [consent] }
  await mockServer(page, {
    forms: () => state.forms,
    // No form.created event is pushed: the provider form reaches the app only through the form sync after the reply.
    onFormReply: (reply) => {
      replies.push(reply)
      state.forms = reply.formID === consent.id ? [provider] : []
    },
  })
  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)

  const dock = page.locator('[data-component="session-websearch-dock"]')
  await expect(dock.getByRole("button", { name: "Enable", exact: true })).toBeEnabled()
  await dock.locator('[data-component="select-v2"]').click()
  await page.getByRole("listbox").getByRole("option", { name: "Parallel", exact: true }).click()
  await expect(dock.locator('[data-component="select-v2"]')).toHaveText("Parallel")
  await dock.getByRole("button", { name: "Enable", exact: true }).click()

  await expect(dock).toHaveCount(0)
  await expect(page.locator('[data-component="composer"]')).toBeVisible()
  expect(replies).toEqual([
    { sessionID, formID: consent.id, body: { answer: { choice: "choose" } } },
    { sessionID, formID: provider.id, body: { answer: { provider: "parallel" } } },
  ])
})

function mockServer(page: Page, requests: Pick<WorkspaceInput, "forms" | "onFormReply">) {
  return mockWorkspace(page, {
    name: "WebSearchDock",
    directory,
    sessions: [{ id: sessionID, title }],
    websearchProviders: providers,
    ...requests,
  })
}
