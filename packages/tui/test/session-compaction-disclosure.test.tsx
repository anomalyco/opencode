import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import type { Config } from "../src/config"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { waitForHighlightedFrame } from "./fixture/frame"
import { directory, json } from "./fixture/tui-client"

const session = {
  id: "ses_compaction_disclosure",
  title: "Compaction disclosure",
  projectID: "project",
  location: { directory },
  agent: "build",
  model: { providerID: "fixture", id: "model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 5 },
}

const messages: SessionMessageInfo[] = [
  { type: "user", id: "msg_question", text: "First question", time: { created: 1 } },
  {
    type: "compaction",
    id: "msg_failed",
    time: { created: 2 },
    status: "failed",
    reason: "auto",
    error: { type: "compaction.failed", message: "Summary request failed" },
  },
  {
    type: "compaction",
    id: "msg_compaction",
    time: { created: 3 },
    status: "completed",
    reason: "auto",
    summary: "## Objective\n- FOLDED_SUMMARY",
    tokens: { input: 2, output: 491, reasoning: 0, cache: { read: 95_003, write: 842 } },
  },
  {
    type: "assistant",
    id: "msg_answer",
    agent: session.agent,
    model: session.model,
    finish: "stop",
    time: { created: 4, completed: 5 },
    content: [{ type: "text", text: "Answer after compaction" }],
  },
]

const open = async (compaction?: "show" | "hide") => {
  const state = await tmpdir()
  const config: Config.Info = {
    animations: false,
    tabs: { mode: "off" },
    session: { sidebar: "hide", ...(compaction ? { compaction } : {}) },
  }
  const setup = await createAppFixture({
    width: 100,
    height: 40,
    state: state.path,
    config,
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages.toReversed(), cursor: {} })
      if (
        url.pathname === `/api/session/${session.id}/inbox` ||
        url.pathname === `/api/session/${session.id}/permission`
      )
        return json({ data: [] })
      return undefined
    },
  })
  await setup.ready
  return {
    setup,
    async [Symbol.asyncDispose]() {
      await setup[Symbol.asyncDispose]()
      await state[Symbol.asyncDispose]()
    },
  }
}

test("a compaction summary stays folded under its divider until clicked, while an error always shows", async () => {
  await using app = await open()
  const setup = app.setup
  const clickDivider = (frame: string) => {
    const lines = frame.split("\n")
    const row = lines.findIndex((line) => line.includes("+ Compaction") || line.includes("- Compaction"))
    expect(row).toBeGreaterThan(0)
    setup.renderer.clearSelection()
    return setup.mockMouse.click(lines[row].indexOf("Compaction"), row)
  }

  const folded = await waitForHighlightedFrame(
    setup,
    (frame) => frame.includes("Answer after compaction") && frame.includes("+ Compaction ·"),
  )
  expect(folded).not.toContain("FOLDED_SUMMARY")
  expect(folded).toContain("Summary request failed")

  await clickDivider(folded)
  const opened = await waitForHighlightedFrame(setup, (frame) => frame.includes("FOLDED_SUMMARY"))
  expect(opened).toContain("- Compaction ·")

  await clickDivider(opened)
  const closed = await waitForHighlightedFrame(setup, (frame) => frame.includes("+ Compaction ·"))
  expect(closed).not.toContain("FOLDED_SUMMARY")
})

test("the compaction setting shows summaries by default", async () => {
  await using app = await open("show")
  const frame = await waitForHighlightedFrame(
    app.setup,
    (frame) => frame.includes("Answer after compaction") && frame.includes("FOLDED_SUMMARY"),
  )
  expect(frame).toContain("- Compaction ·")
})
