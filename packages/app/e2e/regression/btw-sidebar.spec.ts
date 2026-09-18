import { base64Encode } from "@opencode/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/BtwSidebar"
const projectID = "proj_btw_sidebar"
const sessionID = "ses_btw_sidebar"
const otherSessionID = "ses_btw_sidebar_other"
const title = "Side question session"
const otherTitle = "Other side question session"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const sessionHref = (id: string) => `/server/${base64Encode(server)}/session/${id}`

test.use({ viewport: { width: 1440, height: 900 } })

test("answers /btw in the side panel without admitting a prompt", async ({ page }) => {
  const generations: { sessionID: string; prompt: string }[] = []
  const prompts: unknown[] = []
  const generated = Promise.withResolvers<void>()
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "btw-sidebar",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
      {
        id: otherSessionID,
        slug: otherSessionID,
        projectID,
        directory,
        title: otherTitle,
        version: "dev",
        time: { created: 1700000001000, updated: 1700000001000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    vcsDiff: [],
    onPrompt: (input) => prompts.push(input),
    generate: async (input) => {
      generations.push(input)
      if (input.sessionID === otherSessionID) return { text: "This answer belongs to the **other session**." }
      await generated.promise
      return {
        text: "The retry loop uses **exponential backoff** and stops after three attempts.\n\n```ts\nconst delay = 2 ** attempt\n```",
      }
    },
  })
  await page.addInitScript(
    ({ directory, server, sessionID, otherSessionID }) => {
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
          { type: "session", server, sessionId: sessionID },
          { type: "session", server, sessionId: otherSessionID },
        ]),
      )
    },
    { directory, server, sessionID, otherSessionID },
  )

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toBeEditable()

  await editor.fill("/btw")
  const suggestion = page.locator('[data-suggestion-id="session.btw"]')
  await expect(suggestion).toBeVisible()
  await suggestion.click()
  await expect(editor).toHaveText("/btw ")
  await editor.press("Enter")

  const panel = page.locator('[data-slot="session-btw-panel"]')
  await expect(panel).toBeHidden()
  await expect(page.getByText("Add a question after /btw", { exact: true })).toBeVisible()
  expect(generations).toEqual([])
  expect(prompts).toEqual([])

  await editor.fill("/btw how does the retry loop work?")
  await editor.press("Enter")

  const tab = page.getByRole("tab", { name: "/btw" })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole("textbox")).toHaveCount(0)
  await expect(panel.getByRole("status")).toContainText("Working")
  await expect(tab).toHaveAttribute("data-selected", "")
  generated.resolve()
  await expect(panel.getByText("how does the retry loop work?", { exact: true })).toBeVisible()
  await expect(panel.getByText("exponential backoff", { exact: false })).toBeVisible()
  await expect(panel.getByText("const delay = 2 ** attempt", { exact: true })).toBeVisible()
  expect(generations).toHaveLength(1)
  expect(generations[0]?.sessionID).toBe(sessionID)
  expect(generations[0]?.prompt).toContain("how does the retry loop work?")
  expect(prompts).toEqual([])
  await expect(editor).toHaveText("")

  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(otherSessionID)}"]`).click()
  await expectSessionTitle(page, otherTitle)
  await editor.fill("/btw what belongs here?")
  await editor.press("Enter")
  await expect(panel.getByText("other session", { exact: false })).toBeVisible()

  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(sessionID)}"]`).click()
  await expectSessionTitle(page, title)
  await expect(panel.getByText("exponential backoff", { exact: false })).toBeVisible()
  await expect(panel.getByText("other session", { exact: false })).toHaveCount(0)

  await page.reload()
  await expectSessionTitle(page, title)
  await expect(page.getByRole("tab", { name: "/btw" })).toHaveCount(0)
  await expect(page.locator('[data-slot="session-btw-panel"]')).toHaveCount(0)
})
