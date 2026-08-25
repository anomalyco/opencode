import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { base64Encode } from "@opencode-ai/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/SessionMessageRevert"
const projectID = "proj_session_message_revert"
const sessionID = "ses_session_message_revert"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const messages = [
  { id: "msg_first", type: "user", text: "First prompt", time: { created: 1 } },
  {
    id: "msg_first_reply",
    type: "assistant",
    agent: "build",
    model: { id: "test", providerID: "opencode" },
    content: [{ type: "text", text: "First reply" }],
    time: { created: 2, completed: 3 },
  },
  { id: "msg_second", type: "user", text: "Second prompt", time: { created: 4 } },
] satisfies SessionMessageInfo[]
const session = {
  id: sessionID,
  slug: "session-message-revert",
  projectID,
  directory,
  title: "Session message revert",
  agent: "build",
  model: { id: "test", providerID: "opencode" },
  version: "dev",
  time: { created: 1, updated: 4 },
}
const fixture = {
  directory,
  project: {
    id: projectID,
    worktree: directory,
    canonical: directory,
    vcs: "git",
    name: "session-message-revert",
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
  pageMessages: () => ({ items: messages }),
}

test("reverts directly to the selected user message", async ({ page }) => {
  const staged: { sessionID: string; messageID: string }[] = []
  await mockOpenCodeServer(page, {
    ...fixture,
    sessions: [session],
    onRevertStage: (input) => staged.push(input),
  })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, "Session message revert")

  const message = page.locator('[data-message-id="msg_second"]')
  await message.hover()
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/session/${sessionID}/revert/stage`,
  )
  await message.getByRole("button", { name: "Revert message" }).click()
  expect((await response).ok()).toBe(true)

  await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveText("Second prompt")
  expect(staged).toEqual([{ sessionID, messageID: "msg_second" }])
})

test("hides revert actions in a child session", async ({ page }) => {
  await mockOpenCodeServer(page, {
    ...fixture,
    sessions: [
      { ...session, id: "ses_parent", slug: "parent", title: "Parent session" },
      { ...session, parentID: "ses_parent" },
    ],
  })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, "Session message revert")

  const message = page.locator('[data-message-id="msg_second"]')
  await message.hover()
  await expect(message.getByRole("button", { name: "Revert message" })).toHaveCount(0)
})
