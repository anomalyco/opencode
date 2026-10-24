import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

const session = {
  id: "ses_output_limit",
  title: "Output limit",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

async function render(messages: SessionMessageInfo[], expected: string) {
  await using setup = await createAppFixture({
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages.toReversed(), cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox` || url.pathname === `/api/session/${session.id}/permission`)
        return json({ data: [] })
    },
  })
  await setup.waitForFrame((frame) => frame.includes(expected))
  await setup.waitForVisualIdle({ quietFrames: 3 })
  return setup.captureCharFrame()
}

test("suggests recovery after output-limit continuations are exhausted", async () => {
  const frame = await render(
    [
      { type: "user", id: "user", text: "Answer", time: { created: 0 } },
      {
        type: "assistant",
        id: "limited",
        agent: "build",
        model: { providerID: "test", id: "test" },
        content: [],
        finish: "length",
        time: { created: 1, completed: 2 },
      },
      {
        type: "idle",
        id: "idle",
        outcome: "failed",
        error: {
          type: "output-limit",
          message: "Response still truncated after two output token limit continuations",
        },
        time: { created: 3 },
      },
    ],
    "Tip: Reduce reasoning effort",
  )

  expect(frame).toContain("Model repeatedly reached its output token limit")
  expect(frame).toContain("/compact")
  expect(frame).not.toContain("Response still truncated after two")
}, 20000)
