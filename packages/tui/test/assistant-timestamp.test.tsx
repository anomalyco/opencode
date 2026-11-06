import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { session } from "./fixture/local"
import { json } from "./fixture/tui-client"
import { waitForHighlightedFrame } from "./fixture/frame"
import { Locale } from "../src/util/locale"

test("assistant text retains the legacy visible creation date/time", async () => {
  await using state = await tmpdir()
  const info = session("ses_independent_timestamp")
  const created = new Date(2026, 8, 21, 12, 34).getTime()
  await using setup = await createAppFixture({
    width: 120, height: 45, state: state.path,
    config: { animations: false, tabs: { mode: "off" }, session: { sidebar: "hide" } },
    args: { sessionID: info.id },
    fetch: url => {
      if (url.pathname === `/api/session/${info.id}`) return json({ data: info })
      if (url.pathname === `/api/session/${info.id}/message`) return json({ data: [{
        id: "msg_independent_timestamp", type: "assistant", agent: "build", model: info.model,
        time: { created, completed: created + 1000 }, content: [{ type: "text", text: "INDEPENDENT_TIMESTAMP_CONTENT" }],
      }], cursor: {} })
      if (/\/(inbox|permission)$/.test(url.pathname)) return json({ data: [] })
    },
  })
  await setup.ready
  const frame = await waitForHighlightedFrame(setup, frame => frame.includes("INDEPENDENT_TIMESTAMP_CONTENT"))
  expect(frame).toContain(Locale.datetime(created))
})
