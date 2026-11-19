import { expect, test } from "bun:test"
import type { PermissionRequest, SessionInfo } from "@opencode/client"
import { mkdir } from "node:fs/promises"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

test.each(["auto flag", "autoaccept config", "prompt"] as const)(
  "%s scopes background permission replies to open tab families",
  async (mode) => {
    await using state = await tmpdir()
    await using setup = await fixture(state.path, { mode })
    await setup.loaded()

    const requests = [setup.closed, setup.background, setup.child, setup.foreground].map((session) =>
      setup.ask(session.id),
    )
    if (mode === "prompt") {
      await wait(() => setup.captureCharFrame().includes("Permission required"), "visible permission prompt")
      expect(setup.replies).toEqual([])
      expect([...setup.pending.values()]).toEqual(requests)
      return
    }

    await wait(() => setup.replies.length >= 3, "background root, child and foreground replies")
    expect(setup.replies.toSorted((a, b) => a.requestID.localeCompare(b.requestID))).toEqual(
      requests
        .slice(1)
        .map((request) => ({ sessionID: request.sessionID, requestID: request.id, body: { decision: "once" } }))
        .toSorted((a, b) => a.requestID.localeCompare(b.requestID)),
    )
    expect([...setup.pending.values()]).toEqual([requests[0]])
    expect(setup.captureCharFrame()).toContain("Foreground transcript")
    expect(setup.captureCharFrame()).not.toContain("Background transcript")
  },
)

test("does not duplicate an in-flight autoaccept reply across repeated events and route remounts", async () => {
  await using state = await tmpdir()
  const release = Promise.withResolvers<void>()
  await using setup = await fixture(state.path, { mode: "auto flag", replyGate: release.promise })
  try {
    await setup.loaded()
    const request = setup.ask(setup.foreground.id)
    await wait(() => setup.replies.length > 0, "first permission reply")
    setup.emitPermission(request)
    setup.mockInput.pressKey("2", { ctrl: true })
    await wait(() => setup.captureCharFrame().includes("Background transcript"), "background tab navigation")
    setup.mockInput.pressKey("1", { ctrl: true })
    await wait(() => setup.captureCharFrame().includes("Foreground transcript"), "foreground tab remount")
    setup.emitPermission(request)
    const barrier = setup.ask(setup.foreground.id)
    await wait(() => setup.replies.some((reply) => reply.requestID === barrier.id), "reply after duplicate event")
    expect(setup.replies).toEqual([
      { sessionID: request.sessionID, requestID: request.id, body: { decision: "once" } },
      { sessionID: barrier.sessionID, requestID: barrier.id, body: { decision: "once" } },
    ])
  } finally {
    release.resolve()
  }
})

test.each(["startup", "reconnect"] as const)(
  "hydrates existing offscreen descendant permissions on %s without a permission event",
  async (when) => {
    await using state = await tmpdir()
    await using setup = await fixture(state.path, { mode: "autoaccept config", pendingChild: when === "startup" })
    await setup.loaded()
    if (when === "reconnect") {
      setup.pending.set(setup.childRequest.id, setup.childRequest)
      setup.events.disconnect()
      await wait(() => setup.connections() >= 2, "replacement event stream")
    }

    await wait(() => setup.replies.length > 0, "hydrated descendant permission reply")
    expect(setup.replies).toEqual([
      { sessionID: setup.child.id, requestID: setup.childRequest.id, body: { decision: "once" } },
    ])
    expect(setup.pending.size).toBe(0)
    expect(setup.captureCharFrame()).toContain("Foreground transcript")
    expect(setup.captureCharFrame()).not.toContain("Background transcript")
  },
)

test.each(["startup", "reconnect"] as const)(
  "discovers idle intermediate parents of an offscreen great-grandchild on %s",
  async (when) => {
    await using state = await tmpdir()
    await using setup = await fixture(state.path, { mode: "autoaccept config", deepFamily: when })
    await setup.loaded()
    if (when === "reconnect") {
      setup.revealDeepFamily()
      setup.events.disconnect()
      await wait(() => setup.connections() >= 2, "replacement stream with previously unknown descendants")
    }

    await wait(() => setup.replies.length > 0, "great-grandchild permission through idle ancestry")
    expect(setup.replies).toEqual([
      {
        sessionID: setup.greatgrandchild.id,
        requestID: setup.deepRequest.id,
        body: { decision: "once" },
      },
    ])
    expect(setup.pending.size).toBe(0)
    expect(setup.captureCharFrame()).toContain("Foreground transcript")
  },
)

test("retries a transient background child permission snapshot failure without an event or reconnect", async () => {
  await using state = await tmpdir()
  await using setup = await fixture(state.path, {
    mode: "autoaccept config",
    pendingChild: true,
    permissionFailures: 1,
  })
  await setup.loaded()
  await wait(() => setup.replies.length > 0, "reply after transient snapshot failure")
  expect(setup.permissionReads.get(setup.child.id)).toBeGreaterThanOrEqual(2)
  expect(setup.failedPermissionReads()).toBe(1)
  expect(setup.connections()).toBe(1)
  expect(setup.replies).toEqual([
    { sessionID: setup.child.id, requestID: setup.childRequest.id, body: { decision: "once" } },
  ])
  expect(setup.pending.size).toBe(0)
  expect(setup.captureCharFrame()).toContain("Foreground transcript")
})

test("a child route with tabs disabled accepts only its root family, not other persisted tabs", async () => {
  await using state = await tmpdir()
  await using setup = await fixture(state.path, { mode: "auto flag", childRouteWithoutTabs: true })
  await setup.loaded()
  const excluded = [setup.closed, setup.foreground].map((session) => setup.ask(session.id))
  const included = [setup.background, setup.child].map((session) => setup.ask(session.id))
  await wait(() => setup.replies.length >= 2, "routed child's root family replies")
  expect(setup.replies.toSorted((a, b) => a.requestID.localeCompare(b.requestID))).toEqual(
    included
      .map((request) => ({ sessionID: request.sessionID, requestID: request.id, body: { decision: "once" } }))
      .toSorted((a, b) => a.requestID.localeCompare(b.requestID)),
  )
  expect([...setup.pending.values()]).toEqual(excluded)
  expect(setup.captureCharFrame()).toContain("Child transcript")
})

test("a historical child with a missing location does not retry or toast when switching healthy tabs", async () => {
  await using state = await tmpdir()
  await using setup = await fixture(state.path, { mode: "autoaccept config", missingChild: true })
  await setup.loaded()
  await wait(() => setup.permissionReads.has(setup.child.id), "missing child permission snapshot")
  const request = setup.ask(setup.foreground.id)
  await wait(() => setup.replies.some((reply) => reply.requestID === request.id), "healthy session autoaccept")
  // This effect has no injectable clock; observe its full 250/500/1000ms retry window once.
  const settled = performance.now() + 2_000
  await wait(() => performance.now() >= settled, "hydration retry window")
  expect(setup.permissionReads.get(setup.child.id)).toBe(1)
  expect(setup.captureCharFrame()).not.toContain("Location not found")

  setup.mockInput.pressKey("2", { ctrl: true })
  await wait(() => setup.captureCharFrame().includes("Background transcript"), "healthy background tab")
  setup.mockInput.pressKey("1", { ctrl: true })
  await wait(() => setup.captureCharFrame().includes("Foreground transcript"), "healthy foreground tab")
  expect(setup.captureCharFrame()).not.toContain("Location not found")
})

async function fixture(
  state: string,
  input: {
    mode: "auto flag" | "autoaccept config" | "prompt"
    pendingChild?: boolean
    replyGate?: Promise<void>
    deepFamily?: "startup" | "reconnect"
    permissionFailures?: number
    childRouteWithoutTabs?: boolean
    missingChild?: boolean
  },
) {
  const suffix = crypto.randomUUID()
  const foreground = session(`ses_foreground_${suffix}`, "Foreground")
  const background = session(`ses_background_${suffix}`, "Background")
  const child = { ...session(`ses_child_${suffix}`, "Child"), parentID: background.id }
  const grandchild = { ...session(`ses_grandchild_${suffix}`, "Grandchild"), parentID: child.id }
  const greatgrandchild = { ...session(`ses_greatgrandchild_${suffix}`, "Great-grandchild"), parentID: grandchild.id }
  const closed = session(`ses_closed_${suffix}`, "Closed")
  const sessions = [foreground, background, child, closed]
  let deepFamily = input.deepFamily === "startup"
  const childRequest = permission(child.id)
  const deepRequest = permission(greatgrandchild.id)
  const pending = new Map<string, PermissionRequest>(input.pendingChild ? [[childRequest.id, childRequest]] : [])
  if (deepFamily) pending.set(deepRequest.id, deepRequest)
  const replies: { sessionID: string; requestID: string; body: unknown }[] = []
  const permissionReads = new Map<string, number>()
  let failedPermissionReads = 0
  let connections = 0
  await mkdir(`${state}/test/tui`, { recursive: true })
  await Bun.write(
    `${state}/test/tui/tabs.json`,
    JSON.stringify({
      global: { tabs: [{ sessionID: foreground.id }, { sessionID: background.id }], unread: {} },
      cwd: {},
    }),
  )
  const setup = await createAppFixture({
    width: 100,
    height: 30,
    state,
    args: { sessionID: input.childRouteWithoutTabs ? child.id : foreground.id, auto: input.mode === "auto flag" },
    config: {
      animations: false,
      tabs: { enabled: !input.childRouteWithoutTabs, scope: "global" },
      session: { sidebar: "hide", permissions: input.mode === "autoaccept config" ? "autoaccept" : "prompt" },
    },
    fetch: async (url, request) => {
      if (url.pathname === "/api/event") {
        connections += 1
        return undefined
      }
      // Active descendants do not imply that their idle ancestors are present in the client cache.
      if (url.pathname === "/api/session/active")
        return json({ data: deepFamily ? { [greatgrandchild.id]: { type: "running" } } : {} })
      const available = deepFamily ? [...sessions, grandchild, greatgrandchild] : sessions
      if (url.pathname === "/api/session")
        return json({
          data: url.searchParams.has("parentID")
            ? available.filter((item) => item.parentID === url.searchParams.get("parentID"))
            : available.filter((item) => !item.parentID),
          cursor: {},
        })
      const match = url.pathname.match(/^\/api\/session\/([^/]+)(?:\/(.*))?$/)
      const info = available.find((item) => item.id === match?.[1])
      if (!info) return undefined
      if (!match?.[2]) return json({ data: info })
      if (match[2] === "message")
        return json({
          data: [{ type: "user", id: `msg_${info.id}`, text: `${info.title} transcript`, time: { created: 1 } }],
          cursor: {},
        })
      if (match[2] === "inbox") return json({ data: [] })
      if (match[2] === "permission") {
        permissionReads.set(info.id, (permissionReads.get(info.id) ?? 0) + 1)
        if (info.id === child.id && input.missingChild)
          return json(
            {
              _tag: "LocationNotFoundError",
              location: { directory: "/missing-historical-worktree" },
              message: "Location not found: /missing-historical-worktree",
            },
            { status: 404 },
          )
        if (info.id === child.id && failedPermissionReads < (input.permissionFailures ?? 0)) {
          failedPermissionReads += 1
          return json({ message: "Temporary permission snapshot failure" }, { status: 503 })
        }
        return json({ data: [...pending.values()].filter((item) => item.sessionID === info.id) })
      }
      const requestID = match[2].match(/^permission\/([^/]+)\/reply$/)?.[1]
      if (requestID && request.method === "POST") {
        replies.push({ sessionID: info.id, requestID, body: await request.json() })
        await input.replyGate
        pending.delete(requestID)
        return new Response(null, { status: 204 })
      }
      return undefined
    },
  })
  function emitPermission(request: PermissionRequest) {
    setup.events.emit({
      id: `evt_${crypto.randomUUID()}`,
      created: Date.now(),
      type: "permission.asked",
      data: request,
    })
  }
  return {
    ...setup,
    foreground,
    background,
    child,
    greatgrandchild,
    closed,
    childRequest,
    deepRequest,
    pending,
    replies,
    permissionReads,
    failedPermissionReads: () => failedPermissionReads,
    connections: () => connections,
    revealDeepFamily() {
      deepFamily = true
      pending.set(deepRequest.id, deepRequest)
    },
    emitPermission,
    ask(sessionID: string) {
      const request = permission(sessionID)
      pending.set(request.id, request)
      emitPermission(request)
      return request
    },
    async loaded() {
      await setup.ready
      await wait(
        () =>
          setup
            .captureCharFrame()
            .includes(input.childRouteWithoutTabs ? "Child transcript" : "Foreground transcript") &&
          permissionReads.has(input.childRouteWithoutTabs ? child.id : background.id),
        "routed transcript and initial permission snapshot",
      )
    },
  }
}

function session(id: string, title: string): SessionInfo {
  return {
    id,
    title,
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  }
}

function permission(sessionID: string): PermissionRequest {
  return { id: `per_${crypto.randomUUID()}`, sessionID, action: "shell", resources: ["echo autoaccept-fixture"] }
}

async function wait(matches: () => boolean, label: string) {
  const deadline = Date.now() + 5_000
  while (!matches()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`)
    await Bun.sleep(10)
  }
}
