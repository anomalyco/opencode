import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { waitForHighlightedFrame } from "./fixture/frame"
import { directory, json } from "./fixture/tui-client"

const session = {
  id: "ses_generic_tool_summary",
  title: "Generic tool summary",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

const content = [
  "Hallazgos del 2026-09-13: architectural review notes.",
  ...Array.from({ length: 120 }, (_, i) => `Section ${i + 1}: detailed ingestion payload line with extra context.`),
  "DOCUMENT_TAIL_MARKER",
].join("\n")

const messages: SessionMessageInfo[] = [
  { type: "user", id: "msg_user", text: "Ingest the document", time: { created: 1 } },
  {
    type: "assistant",
    id: "msg_assistant",
    agent: "build",
    model: { providerID: "fixture", id: "fixture" },
    finish: "stop",
    time: { created: 2, completed: 4 },
    content: [
      {
        type: "tool",
        id: "call_ingest",
        name: "ingest_document",
        time: { created: 2, ran: 2, completed: 3 },
        state: {
          status: "completed",
          input: { content, format: "markdown" },
          content: [{ type: "text", text: "Ingested 1 document" }],
          metadata: {},
        },
      },
      { type: "text", text: "Ingestion finished." },
    ],
  },
]

test("generic tool collapses multi-kilobyte input to one line and reveals full input when expanded", async () => {
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { enabled: false } },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages.toReversed(), cursor: {} })
      if (
        url.pathname === `/api/session/${session.id}/inbox` ||
        url.pathname === `/api/session/${session.id}/permission`
      )
        return json({ data: [] })
    },
  })

  await setup.ready
  await waitForHighlightedFrame(setup, (frame) => frame.includes("Ingestion finished."))

  const wideFrame = setup.captureCharFrame()
  expect(wideFrame).not.toContain("DOCUMENT_TAIL_MARKER")
  expect(wideFrame).not.toContain("Section 2:")
  const wideLines = wideFrame.split("\n")
  const wideToolRow = wideLines.findIndex((line) => line.includes("✓ ingest_document"))
  const wideTextRow = wideLines.findIndex((line) => line.includes("Ingestion finished."))
  expect(wideToolRow).toBeGreaterThanOrEqual(0)
  expect(wideLines[wideToolRow]).toContain("…")
  expect(wideLines[wideToolRow]).toContain("format=markdown]")
  // The collapsed summary occupies a single row above the assistant text (with one blank gap row).
  expect(wideTextRow - wideToolRow).toBeLessThanOrEqual(2)

  setup.resize(44, 30)
  await setup.waitForFrame((frame) => {
    const lines = frame.split("\n")
    const row = lines.find((line) => line.includes("✓ ingest_document"))
    return Boolean(row && row.includes("…") && row.trimEnd().length <= 43)
  })
  const narrowLines = setup.captureCharFrame().split("\n")
  const narrowToolRow = narrowLines.findIndex((line) => line.includes("✓ ingest_document"))
  const narrowTextRow = narrowLines.findIndex((line) => line.includes("Ingestion finished."))
  expect(narrowToolRow).toBeGreaterThanOrEqual(0)
  expect(narrowLines[narrowToolRow]?.trimEnd()).toEndWith("…]")
  expect(narrowTextRow - narrowToolRow).toBeLessThanOrEqual(2)

  setup.resize(100, 30)
  await setup.waitForFrame((frame) => frame.includes("format=markdown]"))
  const clickLines = setup.captureCharFrame().split("\n")
  const clickRow = clickLines.findIndex((line) => line.includes("✓ ingest_document"))
  await setup.mockMouse.click(6, clickRow)
  await setup.waitForFrame(
    (frame) => frame.includes("DOCUMENT_TAIL_MARKER") && frame.includes("output: Ingested 1 document"),
  )
})
