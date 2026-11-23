import { expect, test } from "bun:test"
import { TextAttributes } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test.each([
  ["up", "Session 08"],
  ["down", "Session 11"],
] as const)("the first %s after deleting a session keeps the selection in view", async (direction, title) => {
  const sessions = Array.from({ length: 12 }, (_, i) => ({
    id: `ses_scroll_${i + 1}`,
    title: `Session ${String(i + 1).padStart(2, "0")}`,
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 12 - i },
  }))
  const deleted = "ses_scroll_9"
  await using setup = await createAppFixture({
    width: 100,
    height: 24,
    fetch: (url, request) => {
      if (url.pathname === "/api/session") return json({ data: sessions, cursor: {} })
      if (request.method === "DELETE" && url.pathname === `/api/session/${deleted}`) {
        return new Response(null, { status: 204 })
      }
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  setup.mockInput.pressKey("x", { ctrl: true })
  setup.mockInput.pressKey("l")
  await setup.waitForFrame((frame) => frame.includes("Session 01"))
  for (let i = 0; i < 8; i++) {
    setup.mockInput.pressArrow("down")
    await setup.renderOnce()
  }
  setup.mockInput.pressKey("d", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("again to confirm"))
  setup.mockInput.pressKey("d", { ctrl: true })
  await setup.waitForFrame((frame) => !frame.includes("again to confirm") && frame.includes("Session 10"))

  setup.mockInput.pressArrow(direction)
  await setup.renderOnce()
  await setup.renderOnce()
  expect(setup.captureCharFrame()).not.toContain("Session 01")
  expect(
    setup
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .filter((span) => span.attributes & TextAttributes.BOLD)
      .map((span) => span.text.trim()),
  ).toContain(title)
})
