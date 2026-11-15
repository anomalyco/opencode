import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test("keeps a shown subagent permission when a main session permission arrives", async () => {
  const base = {
    agent: "build",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const root = { ...base, id: "ses_permission_root", title: "Main" }
  const child = { ...base, id: "ses_permission_child", parentID: root.id, title: "Subagent" }
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { mode: "off" } },
    args: { sessionID: root.id },
    fetch: (url) => {
      if (url.pathname === "/api/session")
        return json({ data: url.searchParams.get("parentID") === root.id ? [child] : [root], cursor: {} })
      if (url.pathname === `/api/session/${root.id}`) return json({ data: root })
      if (url.pathname === `/api/session/${child.id}`) return json({ data: child })
      if (url.pathname.endsWith("/message")) return json({ data: [], cursor: {} })
      if (url.pathname.endsWith("/inbox") || url.pathname.endsWith("/permission")) return json({ data: [] })
    },
  })
  const ask = (id: string, sessionID: string, command: string) =>
    setup.events.emit({
      id: `evt_${id}`,
      created: 1000,
      type: "permission.asked",
      data: { id, sessionID, action: "shell", resources: [command], metadata: { command } },
    })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  ask("per_child_first", child.id, "echo CHILD_FIRST")
  await setup.waitForFrame((frame) => frame.includes("CHILD_FIRST"))
  ask("per_root_second", root.id, "echo ROOT_SECOND")
  await setup.waitForVisualIdle({ quietFrames: 3 })
  const frame = setup.captureCharFrame()
  expect(frame).toContain("CHILD_FIRST")
  expect(frame).not.toContain("ROOT_SECOND")
  setup.events.emit({
    id: "evt_per_child_first_replied",
    created: 1001,
    type: "permission.replied",
    data: { sessionID: child.id, requestID: "per_child_first", reply: "once" },
  })
  expect(await setup.waitForFrame((frame) => frame.includes("ROOT_SECOND"))).not.toContain("CHILD_FIRST")
})
