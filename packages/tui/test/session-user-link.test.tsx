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
const url = "https://example.com/docs/page"
const messages = [
  { type: "user", id: "msg_link_a", text: `Read ${url} before replying`, time: { created: 1 } },
] as SessionMessageInfo[]

test("clicking a link in a user message opens it without the message actions dialog", async () => {
  // The app opens links with the system browser, which a test must not launch.
  using openSpy = spyOn(Open, "openUrl").mockResolvedValue(undefined as never)
  await using setup = await createAppFixture({
    width: 112,
    height: 34,
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
  await setup.waitForFrame((frame) => frame.includes("before replying"))
  await setup.waitForVisualIdle({ quietFrames: 3 })
  const lines = setup.captureCharFrame().split("\n")
  const row = lines.findIndex((line) => line.includes(url))

  await setup.mockMouse.click(lines[row]!.indexOf(url) + 4, row)
  await setup.waitForVisualIdle({ quietFrames: 3 })
  expect(openSpy).toHaveBeenCalledTimes(1)
  expect(openSpy).toHaveBeenCalledWith(url)
  expect(setup.captureCharFrame()).not.toContain("Message Actions")

  // The rest of the row still opens the dialog.
  await setup.mockMouse.click(lines[row]!.indexOf("before replying") + 2, row)
  await setup.waitForFrame((frame) => frame.includes("Message Actions"))
  expect(openSpy).toHaveBeenCalledTimes(1)
}, 20000)
