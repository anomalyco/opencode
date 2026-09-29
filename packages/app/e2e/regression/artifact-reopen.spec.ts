import type { SessionMessageInfo } from "@opencode/client/promise"
import { base64Encode } from "@opencode/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ArtifactReopen"
const projectID = "proj_artifact_reopen"
const sessionID = "ses_artifact_reopen"
const title = "Artifact reopen"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const messages = [
  { id: "msg_prompt", type: "user", text: "Write the shopping list", time: { created: 1 } },
  {
    id: "msg_reply",
    type: "assistant",
    agent: "build",
    model: { id: "test", providerID: "opencode" },
    content: [{ type: "text", text: "Updated [shopping.txt](shopping.txt)." }],
    time: { created: 2, completed: 3 },
  },
] satisfies SessionMessageInfo[]

test.use({ viewport: { width: 1440, height: 900 } })

test("rereads a file each time an artifact link opens it", async ({ page }) => {
  const file = { content: "first draft" }
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      canonical: directory,
      vcs: "git",
      name: "artifact-reopen",
      time: { created: 1, updated: 1 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", variants: {}, limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "artifact-reopen",
        projectID,
        directory,
        title,
        agent: "build",
        model: { id: "test", providerID: "opencode" },
        version: "dev",
        time: { created: 1, updated: 3 },
      },
    ],
    fileList: () => [],
    fileContent: (path) => (path === "shopping.txt" ? file : ""),
    pageMessages: () => ({ items: messages }),
  })

  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)

  const link = page.getByRole("link", { name: "shopping.txt", exact: true })
  const panel = page.locator("#review-panel")
  const tab = panel.getByRole("tab", { name: "shopping.txt" })

  await link.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("first draft", { exact: true })).toBeVisible()

  file.content = "second draft"
  await tab.locator("..").getByRole("button", { name: "Close tab" }).click()
  await expect(tab).toHaveCount(0)

  await link.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("second draft", { exact: true })).toBeVisible()
  await expect(panel.getByText("first draft", { exact: true })).toHaveCount(0)
})
