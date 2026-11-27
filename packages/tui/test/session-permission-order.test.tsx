import { expect, test } from "bun:test"
import type { PermissionRequest, SessionInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test("a newer root permission does not replace the shown subagent permission", async () => {
  const session = (id: string, parentID?: string) =>
    ({
      id,
      parentID,
      title: id,
      agent: "build",
      projectID: "proj_test",
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
    }) satisfies SessionInfo
  const root = session("ses_permission_root")
  const child = session("ses_permission_child", root.id)
  const childRequest = {
    id: "per_child",
    sessionID: child.id,
    action: "shell",
    resources: ["echo CHILD_FIRST"],
  } satisfies PermissionRequest
  const rootRequest = {
    id: "per_root",
    sessionID: root.id,
    action: "shell",
    resources: ["echo ROOT_SECOND"],
  } satisfies PermissionRequest
  const replies: string[] = []
  const childSynced = Promise.withResolvers<void>()
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { mode: "off" } },
    args: { sessionID: root.id },
    fetch: (url) => {
      if (url.pathname === "/api/session")
        return json({ data: url.searchParams.get("parentID") === root.id ? [child] : [], cursor: {} })
      if (url.pathname === `/api/session/${root.id}`) return json({ data: root })
      if (url.pathname === `/api/session/${child.id}`) return json({ data: child })
      if (url.pathname.endsWith("/message")) return json({ data: [], cursor: {} })
      if (url.pathname.endsWith("/inbox")) return json({ data: [] })
      if (url.pathname === `/api/session/${child.id}/permission`) {
        childSynced.resolve()
        return json({ data: [] })
      }
      const reply = url.pathname.match(/^\/api\/session\/[^/]+\/permission\/([^/]+)\/reply$/)
      if (reply) {
        replies.push(reply[1]!)
        return new Response(null, { status: 204 })
      }
    },
  })
  await setup.ready
  await childSynced.promise

  setup.events.emit({ id: "evt_child", created: 1, type: "permission.asked", data: childRequest })
  await setup.waitForFrame((frame) => frame.includes("echo CHILD_FIRST"))
  setup.events.emit({ id: "evt_root", created: 2, type: "permission.asked", data: rootRequest })
  await setup.flush()
  expect(setup.captureCharFrame()).toContain("echo CHILD_FIRST")
  expect(setup.captureCharFrame()).not.toContain("echo ROOT_SECOND")

  setup.mockInput.pressEnter()
  await setup.waitFor(() => replies.length === 1)
  expect(replies).toEqual([childRequest.id])
  setup.events.emit({
    id: "evt_child_replied",
    created: 3,
    type: "permission.replied",
    data: { sessionID: child.id, requestID: childRequest.id, reply: "once" },
  })
  await setup.waitForFrame((frame) => frame.includes("echo ROOT_SECOND"))
})
