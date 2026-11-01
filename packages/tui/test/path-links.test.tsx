import { expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { waitForHighlightedFrame } from "./fixture/frame"
import { json } from "./fixture/tui-client"

test("marks paths only in the last completed assistant response", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "notes.md"), "# notes")
  const session = {
    id: "ses_path_links",
    title: "Path links",
    projectID: "proj_test",
    location: { directory: tmp.path },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const text = "Open notes.md when you are ready."
  const message = (id: string) => ({
    type: "assistant",
    id,
    agent: "build",
    model: { providerID: "fixture", id: "fixture" },
    finish: "stop",
    time: { created: 2, completed: 3 },
    content: [{ type: "text", text }],
  })
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { enabled: false } },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (/^\/api\/session\/ses_path_links\/(message|inbox|permission)$/.test(url.pathname))
        return json({
          data: url.pathname.endsWith("/message") ? [message("msg_old"), message("msg_last")] : [],
          cursor: {},
        })
      return undefined
    },
  })

  await waitForHighlightedFrame(setup, (frame) => frame.includes("when you are ready"))
  await setup.mockInput.typeText("/paths")
  await setup.waitForFrame((frame) => frame.includes("Open a path from the last response"))
  setup.mockInput.pressEnter()
  await waitForHighlightedFrame(setup, (frame) => frame.includes("notes.md [1]"))

  const frame = setup.captureCharFrame()
  expect(frame.split("notes.md [1]").length - 1).toBe(1)
  expect(frame.split("notes.md when").length - 1).toBe(1)
}, 20000)
