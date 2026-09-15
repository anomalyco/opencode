import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/SideChatRegression"
const projectID = "proj_side_chat_regression"
const parentID = "ses_side_chat_parent"
const childIDs = ["ses_side_chat_child_1", "ses_side_chat_child_2", "ses_side_chat_child_3"]

test("integrates multiple isolated Side Chats with panel tabs, Ctrl+P, and quotes", async ({ page }) => {
  const sessions: Array<Record<string, unknown> & { id: string }> = [
    {
      id: parentID,
      slug: "side-chat-parent",
      projectID,
      directory,
      title: "Side chat parent",
      version: "dev",
      time: { created: 1700000000000, updated: 1700000000000 },
    },
  ]
  const messages: Record<string, unknown[]> = {
    [parentID]: [
      {
        info: {
          id: "msg_parent_user",
          sessionID: parentID,
          role: "user",
          time: { created: 1700000000000 },
          agent: "build",
          model: { providerID: "opencode", modelID: "mock-model" },
        },
        parts: [
          {
            id: "prt_parent_user",
            sessionID: parentID,
            messageID: "msg_parent_user",
            type: "text",
            text: "inherited parent question",
          },
        ],
      },
      {
        info: {
          id: "msg_parent_assistant",
          sessionID: parentID,
          role: "assistant",
          parentID: "msg_parent_user",
          time: { created: 1700000000001, completed: 1700000000002 },
          modelID: "mock-model",
          providerID: "opencode",
          mode: "build",
          agent: "build",
          path: { cwd: directory, root: directory },
          cost: 0,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          finish: "stop",
        },
        parts: [
          {
            id: "prt_parent_assistant",
            sessionID: parentID,
            messageID: "msg_parent_assistant",
            type: "text",
            text: "inherited parent answer",
          },
        ],
      },
    ],
  }
  const forks: Array<{ sessionID: string; parentID?: string }> = []
  const prompts: Array<{ sessionID: string; body: unknown }> = []
  const removed: string[] = []

  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "side-chat-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { "mock-model": { id: "mock-model", name: "Mock model", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "mock-model" },
    },
    sessions,
    pageMessages: (sessionID) => ({ items: messages[sessionID] ?? [] }),
    forkSession: (input) => {
      forks.push(input)
      const childID = childIDs[forks.length - 1]!
      const child = {
        ...sessions[0]!,
        id: childID,
        slug: "side-chat-child",
        parentID,
        title: "Side chat child",
      }
      sessions.push(child)
      messages[childID] = [
        {
          ...(messages[parentID]![0] as Record<string, unknown>),
          info: {
            ...(messages[parentID]![0] as { info: Record<string, unknown> }).info,
            id: "msg_child_inherited_user",
            sessionID: childID,
          },
          parts: [
            {
              ...(messages[parentID]![0] as { parts: Record<string, unknown>[] }).parts[0]!,
              id: "prt_child_inherited_user",
              sessionID: childID,
              messageID: "msg_child_inherited_user",
            },
          ],
        },
        {
          ...(messages[parentID]![1] as Record<string, unknown>),
          info: {
            ...(messages[parentID]![1] as { info: Record<string, unknown> }).info,
            id: "msg_child_inherited_assistant",
            sessionID: childID,
            parentID: "msg_child_inherited_user",
          },
          parts: [
            {
              ...(messages[parentID]![1] as { parts: Record<string, unknown>[] }).parts[0]!,
              id: "prt_child_inherited_assistant",
              sessionID: childID,
              messageID: "msg_child_inherited_assistant",
            },
          ],
        },
      ]
      return child
    },
    onPrompt: (input) => prompts.push(input),
    onSessionRemove: (sessionID) => removed.push(sessionID),
  })
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
  })

  await page.goto(`/${base64Encode(directory)}/session/${parentID}`)
  await expectAppVisible(page.getByRole("textbox", { name: "Prompt" }))
  await expect(page.getByText("inherited parent question", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "New Side Chat" }).click()
  const firstTab = page.getByRole("tab", { name: /Side Chat 1/ })
  const firstPanel = page.getByRole("tabpanel", { name: "Side Chat 1" })
  await expect(firstTab).toBeVisible()
  await expect(firstPanel).toBeVisible()
  await expect(
    firstPanel.getByText("Ask a focused question. This conversation won't be added to the main chat."),
  ).toBeVisible()
  await expect(firstPanel.getByText("inherited parent question", { exact: true })).toHaveCount(0)
  expect(forks).toEqual([{ sessionID: parentID, parentID }])
  await expect(page).toHaveURL(new RegExp(`/session/${parentID}$`))

  const firstInput = firstPanel.getByRole("textbox")
  await firstInput.fill("draft one")

  await page.getByRole("button", { name: "Add panel tab" }).click()
  await expect(page.getByRole("menuitem", { name: "New Side Chat" })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Control+Shift+N")
  const secondTab = page.getByRole("tab", { name: /Side Chat 2/ })
  const secondPanel = page.getByRole("tabpanel", { name: "Side Chat 2" })
  await expect(secondTab).toBeVisible()
  await expect(secondPanel).toBeVisible()
  await expect(secondPanel.getByRole("textbox")).toHaveText("")
  await expect
    .poll(() => forks)
    .toEqual([
      { sessionID: parentID, parentID },
      { sessionID: parentID, parentID },
    ])

  await page.keyboard.press("Control+P")
  const palette = page.getByRole("dialog")
  await expect(palette.getByRole("option", { name: /New Side Chat.*Ctrl Shift N/ })).toBeVisible()
  await palette.getByRole("textbox").fill("Switch to Side Chat 1")
  await palette.getByRole("option", { name: /Switch to Side Chat 1/ }).click()
  await expect(firstPanel).toBeVisible()
  await expect(firstInput).toHaveText("draft one")

  await firstInput.fill("side-only question")
  await firstInput.press("Enter")
  await expect.poll(() => prompts.map((item) => item.sessionID)).toEqual([childIDs[0]!])
  await expect(firstPanel.getByText("side-only question", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/session/${parentID}$`))

  await secondTab.click()
  await page.keyboard.press("Control+W")
  await expect(secondTab).toHaveCount(0)
  await expect.poll(() => removed).toEqual([childIDs[1]!])

  const parentText = page.getByText("inherited parent answer", { exact: true })
  await parentText.selectText()
  await parentText.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Side Chat" }).click()
  const reusedSecondPanel = page.getByRole("tabpanel", { name: "Side Chat 2" })
  await expect(reusedSecondPanel).toBeVisible()
  await expect(reusedSecondPanel.getByRole("textbox")).toContainText("Main Chat:")
  await expect(reusedSecondPanel.getByRole("textbox")).toContainText("> inherited parent answer")

  await firstTab.click()
  const sideText = firstPanel.getByText("side-only question", { exact: true })
  await sideText.selectText()
  await sideText.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Quote in Main Chat" }).click()
  const mainInput = page.getByRole("textbox", { name: "Prompt" }).first()
  await expect(mainInput).toContainText("Side Chat:")
  await expect(mainInput).toContainText("> side-only question")

  await page.getByRole("button", { name: "Close tab" }).first().click()
  await expect(firstTab).toHaveCount(0)
  await expect.poll(() => removed).toEqual([childIDs[1]!, childIDs[0]!])
  await page.getByRole("button", { name: "Close tab" }).last().click()
  await expect(reusedSecondPanel).toHaveCount(0)
  await expect.poll(() => removed).toEqual([childIDs[1]!, childIDs[0]!, childIDs[2]!])
})
