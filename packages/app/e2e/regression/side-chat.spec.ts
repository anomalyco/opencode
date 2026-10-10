import type { SessionMessageInfo } from "@opencode/client/promise"
import { expect, test } from "@playwright/test"
import { openSession } from "../utils/workspace"

test.use({ viewport: { width: 1440, height: 900 } })

const T0 = 1_700_000_000_000

const history: SessionMessageInfo[] = [
  { id: "msg_main_one", type: "user", text: "Main question one", time: { created: T0 } },
  { id: "msg_main_two", type: "user", text: "Main question two", time: { created: T0 + 1 } },
]

test("forks isolated side chats into numbered tabs and deletes them when closed", async ({ page }, testInfo) => {
  const forks: { sessionID: string; forkID: string; body: unknown }[] = []
  const prompts: { sessionID: string; text: unknown }[] = []
  const removed: string[] = []

  const { editor, sessions } = await openSession(page, {
    name: "SideChat",
    // A fork serves the history it copied under new message IDs.
    pageMessages: (sessionID) => ({
      items: sessionID.startsWith("ses_mock_fork")
        ? history.map((message) => ({ ...message, id: `${message.id}_${sessionID}` }))
        : history,
    }),
    onFork: (input) => forks.push(input),
    onPrompt: (input) => prompts.push({ sessionID: input.sessionID, text: input.body.text }),
    onSessionRemove: (sessionID) => removed.push(sessionID),
  })

  const panel = page.locator('[data-slot="session-side-chat-panel"]')
  const first = page.getByRole("tab", { name: "Side chat 1", exact: true })
  const second = page.getByRole("tab", { name: "Side chat 2", exact: true })
  const mainID = sessions[0]!.id

  await editor.press("Control+Shift+N")
  await expect(first).toHaveAttribute("data-selected", "")
  expect(forks).toEqual([{ sessionID: mainID, forkID: "ses_mock_fork_1", body: { child: true } }])
  // The inherited history stays out of the chat, and the main chat keeps its own.
  await expect(panel.getByText("Main question one")).toHaveCount(0)
  await expect(panel.getByText("Main question two")).toHaveCount(0)

  const input = panel.getByRole("textbox", { name: "Ask a side question…" })
  await input.fill("Side question")
  await input.press("Enter")
  await expect(panel.getByText("Side question", { exact: true })).toBeVisible()
  expect(prompts).toEqual([{ sessionID: "ses_mock_fork_1", text: "Side question" }])
  await page.screenshot({ path: testInfo.outputPath("side-chat.png") })

  await editor.press("Control+Shift+N")
  await expect(second).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("Side question", { exact: true })).toHaveCount(0)

  // Closing a tab deletes its session, and the next chat takes the number it freed.
  await first.click({ button: "middle" })
  await expect(first).toHaveCount(0)
  expect(removed).toEqual(["ses_mock_fork_1"])
  await editor.press("Control+Shift+N")
  await expect(first).toHaveAttribute("data-selected", "")
  expect(forks.map((fork) => fork.forkID)).toEqual(["ses_mock_fork_1", "ses_mock_fork_2", "ses_mock_fork_3"])
})

test("starts no side chat before the main chat has a message", async ({ page }) => {
  const forks: string[] = []

  const { editor } = await openSession(page, {
    name: "SideChatEmpty",
    pageMessages: () => ({ items: [] }),
    onFork: (input) => forks.push(input.forkID),
  })

  await editor.press("Control+Shift+N")
  await expect(page.getByText("Send a message in the main chat before starting a side chat")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Side chat 1", exact: true })).toHaveCount(0)
  expect(forks).toEqual([])
})
