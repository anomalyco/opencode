import { expect, test } from "bun:test"
import { TextAttributes } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { waitForHighlightedFrame } from "./fixture/frame"
import { directory, json } from "./fixture/tui-client"

const text = "Make **bold** edits to `foo.ts` and wrap it in <div> please"

test.each([
  { setting: undefined, shown: text, bold: false },
  { setting: "plain" as const, shown: text, bold: false },
  { setting: "source" as const, shown: text, bold: true },
  { setting: "rendered" as const, shown: "Make bold edits to foo.ts and wrap it in <div> please", bold: true },
])("renders user messages with session.user_markdown $setting", async (item) => {
  const sessionID = "ses_user_markdown"
  await using app = await createAppFixture({
    width: 100,
    height: 30,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "off" }, session: { user_markdown: item.setting } },
    fetch: async (url) => {
      if (url.pathname === `/api/session/${sessionID}`)
        return json({
          data: {
            id: sessionID,
            projectID: "project",
            title: "User markdown fixture",
            location: { directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
          },
        })
      if (url.pathname === `/api/session/${sessionID}/message`)
        return json({ data: [{ id: "msg_user", type: "user", text, time: { created: 0 } }], cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/inbox`) return json({ data: [] })
      return undefined
    },
  })
  await app.ready
  await waitForHighlightedFrame(app, (frame) => frame.includes(item.shown))
  await app.waitForVisualIdle({ quietFrames: 3 })
  const span = app
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((span) => span.text.includes("bold") && !span.text.includes("Make"))
  expect(!!span && (span.attributes & TextAttributes.BOLD) !== 0).toBe(item.bold)
})
