import { expect, spyOn, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import * as Open from "@opencode/util/open"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

const session = {
  id: "ses_user_link",
  title: "User link",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const url = "https://example.com/some/really/long/path/segment/that/keeps/going/and/going/index.html?query=value&other=1"
const messages = [
  { type: "user", id: "msg_link_a", text: `Read ${url}. Then reply`, time: { created: 1 } },
] as SessionMessageInfo[]

test("a wrapped URL in a user message opens in full from any row without the message dialog", async () => {
  // The app opens links in the system browser, which a test must not launch.
  using openSpy = spyOn(Open, "openUrl").mockResolvedValue(undefined as never)
  await using setup = await createAppFixture({
    width: 64,
    height: 30,
    config: { animations: false, session: { verbosity: "medium" }, tabs: { enabled: false } },
    args: { sessionID: session.id },
    fetch: (request) => {
      if (request.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (request.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (request.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
      if (request.pathname !== `/api/session/${session.id}/message`) return
      return json({ data: messages, cursor: {} })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Then reply"))
  await setup.waitForVisualIdle({ quietFrames: 3 })
  const rows = setup.captureCharFrame().split("\n")
  const head = rows.findIndex((row) => row.includes("https://example"))
  const tail = rows.findIndex((row) => row.includes("other=1"))
  expect(tail).toBeGreaterThan(head)
  const headX = rows[head]!.indexOf("https://example")
  const tailX = rows[tail]!.indexOf("other=1")
  expect(setup.renderer.getLinkAt(headX, head)).toBe(url)
  expect(setup.renderer.getLinkAt(tailX, tail)).toBe(url)
  // Punctuation after the URL is plain text.
  expect(setup.renderer.getLinkAt(tailX + "other=1".length, tail)).toBeNull()

  await setup.mockMouse.click(tailX, tail)
  await setup.waitForVisualIdle({ quietFrames: 3 })
  expect(openSpy.mock.calls).toEqual([[url]])
  expect(setup.captureCharFrame()).not.toContain("Message Actions")

  setup.renderer.clearSelection()
  await setup.mockMouse.click(rows[tail]!.indexOf("Then reply") + 2, tail)
  await setup.waitForFrame((frame) => frame.includes("Message Actions"))
  expect(openSpy).toHaveBeenCalledTimes(1)
})
