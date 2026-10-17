import { expect, spyOn, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

const model = { providerID: "fixture", id: "fixture" }
const user = (id: string): SessionMessageInfo => ({ type: "user", id, text: "Current prompt", time: { created: 0 } })
const assistant = (id: string, texts: string[]): Extract<SessionMessageInfo, { type: "assistant" }> => ({
  type: "assistant",
  id,
  agent: "build",
  model,
  time: { created: 1, completed: 2 },
  finish: "stop",
  content: texts.length
    ? texts.map((text) => ({ type: "text", text }))
    : [{ type: "reasoning", text: "Nothing more to add.", time: { created: 1, completed: 2 } }],
})
test.each([
  {
    name: "reasoning-only tail",
    messages: [user("prompt"), assistant("answer", ["Final answer"]), assistant("tail", [])],
    text: "Final answer",
  },
  {
    name: "empty current turn",
    messages: [user("old"), assistant("old-answer", ["Previous turn"]), user("prompt"), assistant("tail", [])],
    text: undefined,
  },
])("/copy selects reply text ($name)", async (input) => {
  const session = {
    id: "ses_copy_reply",
    projectID: "proj_test",
    title: "Copy reply fixture",
    location: { directory },
    agent: "build",
    model,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  await using setup = await createAppFixture({
    args: { sessionID: session.id },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: (url) => {
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({
          data: input.messages
            .map((message, index) => ({
              ...message,
              time: { ...message.time, created: index * 10 },
            }))
            .toReversed(),
          cursor: {},
        })
      if (
        url.pathname === `/api/session/${session.id}/inbox` ||
        url.pathname === `/api/session/${session.id}/permission`
      )
        return json({ data: [] })
    },
  })
  Object.defineProperty(setup.renderer, "capabilities", { get: () => null })
  const copy = spyOn(setup.renderer, "copyToClipboardOSC52").mockReturnValue(true)
  try {
    await setup.ready
    await setup.waitForFrame((frame) => frame.includes("Current prompt"))
    await setup.mockInput.typeText("/copy")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) =>
      frame.includes(input.text ? "Message copied to clipboard!" : "No reply text found in the last turn"),
    )
    if (input.text) {
      expect(copy).toHaveBeenCalledTimes(1)
      expect(copy.mock.calls[0]?.[0]).toBe(input.text)
    } else {
      expect(copy).not.toHaveBeenCalled()
    }
  } finally {
    copy.mockRestore()
  }
})
