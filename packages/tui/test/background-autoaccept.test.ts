import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

async function fixture(options: {
  mode: "prompt" | "autoaccept"
  auto?: boolean
  tabs?: boolean
  selected?: "root" | "child"
  pendingChild?: boolean
}) {
  const state = await tmpdir()
  const file = path.join(state.path, "test", "tui", "tabs.json")
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(
    file,
    JSON.stringify({
      global: { tabs: [{ sessionID: "root", title: "Background session" }], unread: {} },
      cwd: {},
    }),
  )
  const replies: { sessionID: string; requestID: string; decision: string }[] = []
  const synced = Promise.withResolvers<void>()
  const approved = Promise.withResolvers<void>()
  const childApproved = Promise.withResolvers<void>()
  const childSynced = Promise.withResolvers<void>()
  const siblingSynced = Promise.withResolvers<void>()
  let pendingChild = options.pendingChild ?? false
  const info = (id: string) => ({
    id,
    parentID: id === "child" || id === "sibling" ? "root" : undefined,
    title: id === "root" ? "Background session" : "Child session",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  })
  const setup = await createAppFixture({
    width: 100,
    height: 30,
    state: state.path,
    args: { auto: options.auto, sessionID: options.selected },
    config: {
      animations: false,
      tabs: { mode: options.tabs === false ? "off" : "on", scope: "global" },
      session: { permissions: options.mode },
    },
    fetch: async (url, request) => {
      if (url.pathname === "/api/session" && url.searchParams.get("parentID") === "root")
        return json({ data: [info("child")], cursor: {} })
      const id = url.pathname.match(/^\/api\/session\/([^/]+)$/)?.[1]
      if (id) {
        if (id === "sibling") siblingSynced.resolve()
        return json({ data: info(id) })
      }
      const reply = url.pathname.match(/^\/api\/session\/([^/]+)\/permission\/([^/]+)\/reply$/)
      if (reply && request.method === "POST") {
        const body = await request.json()
        replies.push({ sessionID: reply[1], requestID: reply[2], decision: body.decision })
        approved.resolve()
        if (reply[1] === "child") {
          pendingChild = false
          childApproved.resolve()
        }
        return new Response(null, { status: 204 })
      }
      if (url.pathname === "/api/session/root/permission") {
        synced.resolve()
        return json({ data: [{ id: "per_initial", sessionID: "root", action: "shell", resources: ["git status"] }] })
      }
      if (url.pathname === "/api/session/child/permission") {
        const response = json({
          data: pendingChild
            ? [{ id: "per_pending_child", sessionID: "child", action: "shell", resources: ["git diff"] }]
            : [],
        })
        childSynced.resolve()
        return response
      }
      if (/^\/api\/session\/[^/]+\/message$/.test(url.pathname)) return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/inbox$/.test(url.pathname)) return json({ data: [] })
      return undefined
    },
  })
  return {
    ...setup,
    replies,
    synced: synced.promise,
    approved: approved.promise,
    childApproved: childApproved.promise,
    childSynced: childSynced.promise,
    siblingSynced: siblingSynced.promise,
    setChildPending: () => {
      pendingChild = true
    },
    async [Symbol.asyncDispose]() {
      await setup[Symbol.asyncDispose]()
      await state[Symbol.asyncDispose]()
    },
  }
}

test("autoaccept approves a background tab from home without selecting it", async () => {
  await using setup = await fixture({ mode: "autoaccept" })
  await setup.ready
  await setup.approved
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("commands")
  expect(setup.replies).toEqual([{ sessionID: "root", requestID: "per_initial", decision: "once" }])

  setup.events.emit({
    id: "evt_duplicate",
    created: 2,
    type: "permission.asked",
    data: { id: "per_initial", sessionID: "root", action: "shell", resources: ["git status"] },
  })
  setup.events.emit({
    id: "evt_child",
    created: 3,
    type: "permission.asked",
    data: { id: "per_child", sessionID: "child", action: "shell", resources: ["git diff"] },
  })
  await setup.waitFor(() => setup.replies.length === 2)
  expect(setup.replies[1]).toEqual({ sessionID: "child", requestID: "per_child", decision: "once" })

  setup.events.emit({
    id: "evt_closed",
    created: 4,
    type: "permission.asked",
    data: { id: "per_closed", sessionID: "closed", action: "shell", resources: ["git status"] },
  })
  setup.events.emit({
    id: "evt_next",
    created: 5,
    type: "permission.asked",
    data: { id: "per_next", sessionID: "root", action: "shell", resources: ["git log"] },
  })
  await setup.waitFor(() => setup.replies.length === 3)
  expect(setup.replies[2]).toEqual({ sessionID: "root", requestID: "per_next", decision: "once" })
})

test("prompt mode leaves background permission requests pending", async () => {
  await using setup = await fixture({ mode: "prompt" })
  await setup.ready
  await setup.synced
  await setup.waitForFrame((frame) => frame.includes("! Background"))
  expect(setup.replies).toEqual([])
})

test("the auto CLI option also approves background tabs", async () => {
  await using setup = await fixture({ mode: "prompt", auto: true })
  await setup.ready
  await setup.approved
  expect(setup.replies).toEqual([{ sessionID: "root", requestID: "per_initial", decision: "once" }])
})

test("autoaccept does not approve persisted tabs when tabs are disabled", async () => {
  await using setup = await fixture({ mode: "autoaccept", tabs: false })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  setup.events.emit({
    id: "evt_disabled",
    created: 2,
    type: "permission.asked",
    data: { id: "per_disabled", sessionID: "root", action: "shell", resources: ["git status"] },
  })
  await setup.renderOnce()
  expect(setup.replies).toEqual([])
})

test("autoaccept still approves the selected session with tabs disabled", async () => {
  await using setup = await fixture({ mode: "autoaccept", tabs: false, selected: "root" })
  await setup.ready
  await setup.approved
  expect(setup.replies).toEqual([{ sessionID: "root", requestID: "per_initial", decision: "once" }])
})

test("autoaccept loads already-pending background child requests", async () => {
  await using setup = await fixture({ mode: "autoaccept", pendingChild: true })
  await setup.ready
  await setup.childApproved
  expect(setup.replies).toContainEqual({ sessionID: "child", requestID: "per_pending_child", decision: "once" })
})

test("autoaccept loads background child requests missed while disconnected", async () => {
  await using setup = await fixture({ mode: "autoaccept" })
  await setup.ready
  await setup.approved
  await setup.childSynced
  setup.setChildPending()
  setup.events.disconnect()
  await setup.childApproved
  expect(setup.replies).toContainEqual({ sessionID: "child", requestID: "per_pending_child", decision: "once" })
})

test("a selected child does not autoapprove its parent or siblings", async () => {
  await using setup = await fixture({ mode: "autoaccept", tabs: false, selected: "child", pendingChild: true })
  await setup.ready
  await setup.childApproved
  for (const id of ["root", "sibling"]) {
    setup.events.emit({
      id: `evt_created_${id}`,
      created: 2,
      type: "session.created",
      durable: { aggregateID: id, seq: 1, version: 1 },
      data: {
        sessionID: id,
        projectID: "project",
        location: { directory },
        slug: id,
        parentID: id === "sibling" ? "root" : undefined,
        version: "test",
      },
    })
    setup.events.emit({
      id: `evt_permission_${id}`,
      created: 3,
      type: "permission.asked",
      data: { id: `per_${id}`, sessionID: id, action: "shell", resources: ["git status"] },
    })
  }
  await setup.siblingSynced
  await setup.renderOnce()
  expect(setup.replies).toEqual([{ sessionID: "child", requestID: "per_pending_child", decision: "once" }])
})
