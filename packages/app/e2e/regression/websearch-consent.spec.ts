import type { FormAnswer, FormInfo } from "@opencode-ai/client/promise"
import { base64Encode } from "@opencode-ai/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const directory = "/tmp/opencode/websearch-consent"
const sessionID = "ses_websearch_consent"
const projectID = "proj_websearch_consent"
const title = "Web search consent"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const consent = {
  id: "frm_websearch_consent",
  sessionID,
  title: "Web Search",
  metadata: { kind: "websearch.provider" },
  fields: [
    {
      key: "choice",
      type: "string",
      description: "Allow OpenCode to search the web for up-to-date information?",
      required: true,
      custom: false,
      options: [
        { value: "allow", label: "Allow search via Exa, Parallel" },
        { value: "choose", label: "Choose another provider" },
        { value: "disable", label: "Disable web search" },
      ],
    },
  ],
} satisfies FormInfo
const provider = {
  id: "frm_websearch_provider",
  sessionID,
  title: "Choose a web search provider",
  metadata: { kind: "websearch.provider" },
  fields: [
    {
      key: "provider",
      type: "string",
      description: "Choose a provider for web search.",
      required: true,
      custom: false,
      options: [
        { value: "exa", label: "Exa" },
        { value: "parallel", label: "Parallel" },
      ],
    },
  ],
} satisfies FormInfo

for (const width of [1280, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 800 }, colorScheme: "light", contextOptions: { reducedMotion: "reduce" } })

    test("allows web search with a required, fixed-choice consent", async ({ page }, info) => {
      await setup(page)
      const allow = page.getByRole("radio", { name: "Allow search via Exa, Parallel", exact: true })
      await expect(allow).toBeVisible()
      await expect(allow).toBeFocused()
      await expect(page.getByRole("radio")).toHaveCount(3)
      await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeDisabled()
      await expect(page.getByText("Type your own answer", { exact: true })).toHaveCount(0)
      await page.screenshot({ path: info.outputPath("consent.png"), fullPage: true })
      const replies: string[] = []
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().endsWith("/reply")) replies.push(request.url())
      })
      await page.keyboard.press("Control+Enter")
      await expect(allow).toBeFocused()
      await page.keyboard.press("End")
      await expect(page.getByRole("radio", { name: "Disable web search", exact: true })).toBeFocused()
      await page.keyboard.press("Home")
      await expect(allow).toBeFocused()
      await page.keyboard.press("Space")
      await expect(allow).toBeChecked()
      await page.screenshot({ path: info.outputPath("consent-selected.png"), fullPage: true })
      await submit(page, consent.id, { choice: "allow" })
      expect(replies).toHaveLength(1)
      await expect(page.locator('[data-component="composer-editor"][contenteditable="true"]')).toBeVisible()
      await expect(allow).toHaveCount(0)
    })

    test("chooses an explicit provider in the second consent form", async ({ page }, info) => {
      await setup(page)
      await page.getByRole("radio", { name: "Choose another provider", exact: true }).click()
      await submit(page, consent.id, { choice: "choose" })
      const option = page.getByRole("radio", { name: "Parallel", exact: true })
      await expect(option).toBeVisible()
      await expect(page.getByRole("radio")).toHaveCount(2)
      await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeDisabled()
      await option.click()
      await expect(option).toBeChecked()
      await page.screenshot({ path: info.outputPath("provider.png"), fullPage: true })
      await submit(page, provider.id, { provider: "parallel" })
      await expect(option).toHaveCount(0)
      await expect(page.locator('[data-component="composer-editor"][contenteditable="true"]')).toBeVisible()
    })

    test("disables web search only after explicitly selecting disable", async ({ page }) => {
      await setup(page)
      await page.getByRole("radio", { name: "Disable web search", exact: true }).click()
      await submit(page, consent.id, { choice: "disable" })
      await expect(page.locator('[data-component="composer-editor"][contenteditable="true"]')).toBeVisible()
    })

    test("cancels the provider picker with Escape", async ({ page }) => {
      await setup(page)
      await page.getByRole("radio", { name: "Choose another provider", exact: true }).click()
      await submit(page, consent.id, { choice: "choose" })
      await expect(page.getByRole("radio", { name: "Exa", exact: true })).toBeFocused()
      const cancelled = page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().endsWith(`/form/${provider.id}/cancel`),
      )
      await page.keyboard.press("Escape")
      expect((await cancelled).status()).toBe(204)
      await expect(page.getByRole("radio")).toHaveCount(0)
      await expect(page.locator('[data-component="composer-editor"][contenteditable="true"]')).toBeVisible()
    })

    test("dismisses consent without sending an answer", async ({ page }) => {
      await setup(page)
      const replies: string[] = []
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().endsWith("/reply")) replies.push(request.url())
      })
      const cancelled = page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().endsWith(`/form/${consent.id}/cancel`),
      )
      await page.getByRole("button", { name: "Dismiss", exact: true }).click()
      expect((await cancelled).status()).toBe(204)
      await expect(page.locator('[data-component="composer-editor"][contenteditable="true"]')).toBeVisible()
      expect(replies).toEqual([])
    })
  })
}

test("preserves optional questions, multiselect, and custom answers", async ({ page }) => {
  await setup(page, {
    ...consent,
    metadata: { kind: "question" },
    fields: [
      {
        key: "q0",
        type: "string",
        description: "Optional question",
        custom: true,
        options: [{ value: "skip", label: "Optional answer" }],
      },
      {
        key: "q1",
        type: "multiselect",
        description: "Pick answers",
        custom: true,
        options: [
          { value: "alpha", label: "Alpha" },
          { value: "beta", label: "Beta" },
        ],
      },
    ],
  })
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await page.getByRole("checkbox", { name: "Alpha", exact: true }).click()
  await page.getByRole("checkbox", { name: /Type your own answer/ }).click()
  await page.getByRole("textbox").fill("Gamma")
  await submit(page, consent.id, { q1: ["alpha", "Gamma"] })
  await expect(page.locator('[data-component="composer-editor"][contenteditable="true"]')).toBeVisible()
})

test("cannot submit after jumping past an unanswered required question", async ({ page }) => {
  await setup(page, {
    ...consent,
    metadata: { kind: "question" },
    fields: [
      {
        key: "q0",
        type: "string",
        description: "First question",
        required: true,
        custom: false,
        options: [{ value: "first", label: "First answer" }],
      },
      {
        key: "q1",
        type: "string",
        description: "Second question",
        required: true,
        custom: false,
        options: [{ value: "second", label: "Second answer" }],
      },
    ],
  })
  await page.getByRole("button", { name: "Questions 2", exact: true }).click()
  await page.getByRole("radio", { name: "Second answer", exact: true }).click()
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await page.getByRole("radio", { name: "First answer", exact: true }).click()
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await submit(page, consent.id, { q0: "first", q1: "second" })
})

async function submit(page: Page, id: string, answer: FormAnswer) {
  const response = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith(`/form/${id}/reply`),
  )
  await page.getByRole("button", { name: "Submit", exact: true }).click()
  const result = await response
  expect(result.request().postDataJSON()).toEqual({ answer })
  expect(result.status()).toBe(204)
}

async function setup(page: Page, form: FormInfo = consent) {
  const transport = await installSseTransport(page, { server })
  const pending: FormInfo[] = [form]
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "websearch-consent",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200000 } },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "claude-opus-4-6" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "websearch-consent",
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    forms: () => pending,
  })
  await page.route("**/api/session/*/form/*/reply", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!
    const { answer } = route.request().postDataJSON()
    pending.splice(0)
    await route.fulfill({ status: 204 })
    await transport.send({
      id: `evt_${id}_replied`,
      type: "form.replied",
      created: 1700000001000,
      location: { directory },
      data: { sessionID, id, answer },
    })
    if (answer.choice !== "choose") return
    pending.push(provider)
    await transport.send({
      id: "evt_provider_created",
      type: "form.created",
      created: 1700000002000,
      location: { directory },
      data: { form: provider },
    })
  })
  await page.route("**/api/session/*/form/*/cancel", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!
    pending.splice(0)
    await route.fulfill({ status: 204 })
    await transport.send({
      id: "evt_consent_cancelled",
      type: "form.cancelled",
      created: 1700000001000,
      location: { directory },
      data: { sessionID, id },
    })
  })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await transport.waitForConnection()
  await expectSessionTitle(page, title)
}
