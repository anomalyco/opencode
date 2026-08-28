import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type Project, type SessionInfo } from "../src/promise"

const session = (viewed: number): SessionInfo => ({
  id: "ses_refresh",
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  outcome: "succeeded",
  time: { created: 0, updated: 0, idle: 2, viewed },
  location: { directory: "/project" },
})

test("revalidates after an event overtakes an active session read", async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  let requests = 0
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (!request.url.endsWith("/api/session/ses_refresh")) throw new Error(`Unexpected request: ${request.url}`)
      requests++
      if (requests === 1) {
        await gate
        return Response.json({ data: session(1) })
      }
      return Response.json({ data: session(2) })
    },
  })
  const event: CreateDataInput["event"] = {
    on:
      <Type extends OpenCodeEvent["type"]>(
        _type: Type,
        _handler: (event: Extract<OpenCodeEvent, { type: Type }>) => void,
      ) =>
      () => {},
    listen(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
  const setup = createRoot((dispose) => ({
    data: createData({ api: () => api, directory: "/project", event, connection: { status: () => "connected" } }),
    dispose,
  }))

  try {
    setup.data.session.remember(session(1))
    setup.data.session.invalidate("ses_refresh")
    const initial = setup.data.session.sync("ses_refresh")
    await wait(() => requests === 1)

    const viewed: OpenCodeEvent = {
      id: "evt_viewed",
      created: 2,
      type: "session.viewed",
      durable: { aggregateID: "ses_refresh", seq: 1, version: 1 },
      data: { sessionID: "ses_refresh", idle: 2 },
    }
    listeners.forEach((listener) => listener({ name: viewed.type, details: viewed }))
    await Bun.sleep(20)
    release()
    await initial

    await wait(() => requests === 2 && setup.data.session.get("ses_refresh")?.time.viewed === 2)
  } finally {
    setup.dispose()
  }
})

test("updates authoritative cached project metadata from live events", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const original: Project = {
    id: "project_renamed",
    canonical: "/projects/original",
    name: "Original custom name",
    time: { created: 1, updated: 1 },
    sandboxes: [],
  }
  const unrelated: Project = {
    id: "project_unrelated",
    canonical: "/projects/unrelated",
    name: "Unrelated project",
    time: { created: 1, updated: 1 },
    sandboxes: [],
  }
  let requests = 0
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (!request.url.endsWith("/api/project")) throw new Error(`Unexpected request: ${request.url}`)
      requests++
      return Response.json([original, unrelated])
    },
  })
  const event: CreateDataInput["event"] = {
    on: () => () => {},
    listen(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
  const setup = createRoot((dispose) => ({
    data: createData({ api: () => api, directory: "/projects/original", event }),
    dispose,
  }))

  try {
    await setup.data.project.sync()
    expect(setup.data.project.get(original.id)).toEqual(original)

    const updated: OpenCodeEvent = {
      id: "evt_project_renamed",
      created: 2,
      type: "project.updated",
      data: {
        ...original,
        canonical: "/projects/renamed",
        name: "Updated custom name",
        time: { ...original.time, updated: 2 },
      },
    }
    listeners.forEach((listener) => listener({ name: updated.type, details: updated }))

    expect(setup.data.project.get(original.id)?.canonical).toBe("/projects/renamed")
    expect(setup.data.project.get(original.id)?.name).toBe("Updated custom name")
    expect(setup.data.project.get(unrelated.id)).toEqual(unrelated)
    expect(requests).toBe(1)

    const reset: OpenCodeEvent = {
      id: "evt_project_name_reset",
      created: 3,
      type: "project.updated",
      data: {
        id: original.id,
        canonical: "/projects/renamed-again",
        time: { ...original.time, updated: 3 },
        sandboxes: [],
      },
    }
    listeners.forEach((listener) => listener({ name: reset.type, details: reset }))

    expect(setup.data.project.get(original.id)?.canonical).toBe("/projects/renamed-again")
    expect(setup.data.project.get(original.id)?.name).toBeUndefined()
    expect(setup.data.project.get(unrelated.id)).toEqual(unrelated)
    expect(requests).toBe(1)
  } finally {
    setup.dispose()
  }
})

test("adopts cached directory-project sessions when their repository is resolved", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const refreshed: SessionInfo = {
    ...session(0),
    id: "ses_uncached",
    projectID: "repository",
    location: { directory: "/unknown-alias" },
    subpath: "app",
  }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (!request.url.endsWith("/api/session/ses_uncached")) throw new Error(`Unexpected request: ${request.url}`)
      return Response.json({ data: refreshed })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/repo",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))

  try {
    const sessions: SessionInfo[] = [
      { ...session(0), id: "ses_root", projectID: "directory-root", location: { directory: "/repo" } },
      { ...session(0), id: "ses_nested", projectID: "directory-nested", location: { directory: "/repo/app" } },
      {
        ...session(0),
        id: "ses_alias",
        projectID: "directory-nested",
        location: { directory: "/repo/alias/../app" },
      },
      { ...session(0), id: "ses_symlink", projectID: "directory-nested", location: { directory: "/shortcut" } },
      { ...refreshed, projectID: "directory-uncached" },
      { ...session(0), id: "ses_global", projectID: "global", location: { directory: "/repo/legacy" } },
      { ...session(0), id: "ses_escaped", projectID: "global", location: { directory: "/repo/../other" } },
      { ...session(0), id: "ses_other", projectID: "other-repository", location: { directory: "/repo/vendor" } },
      { ...session(0), id: "ses_sibling", projectID: "global", location: { directory: "/repo-other" } },
      {
        ...session(0),
        id: "ses_remote",
        projectID: "directory-root",
        location: { directory: "/repo", workspaceID: "workspace-remote" },
      },
    ]
    sessions.forEach((item) => setup.data.session.remember(item))
    for (const project of [
      { id: "directory-root", canonical: "/repo" },
      { id: "directory-nested", canonical: "/repo/app" },
    ]) {
      const updated: OpenCodeEvent = {
        id: `evt_${project.id}`,
        created: 0,
        type: "project.updated",
        data: { ...project, time: { created: 0, updated: 0 }, sandboxes: [] },
      }
      listeners.forEach((listener) => listener({ name: updated.type, details: updated }))
    }

    const resolved: OpenCodeEvent = {
      id: "evt_repository_resolved",
      created: 1,
      type: "worktree.resolved",
      durable: { aggregateID: "repository", seq: 0, version: 1 },
      data: {
        projectID: "repository",
        directory: "/repo",
        previous: "global",
        adopted: ["directory-root", "directory-nested", "directory-uncached"],
      },
    }
    listeners.forEach((listener) => listener({ name: resolved.type, details: resolved }))

    expect(setup.data.session.get("ses_root")?.projectID).toBe("repository")
    expect(setup.data.session.get("ses_root")?.subpath).toBeUndefined()
    expect(setup.data.session.get("ses_nested")).toMatchObject({ projectID: "repository", subpath: "app" })
    expect(setup.data.session.get("ses_alias")).toMatchObject({ projectID: "repository", subpath: "app" })
    expect(setup.data.session.get("ses_symlink")).toMatchObject({ projectID: "repository", subpath: "app" })
    expect(setup.data.session.get("ses_global")).toMatchObject({ projectID: "repository", subpath: "legacy" })
    expect(setup.data.session.get("ses_escaped")?.projectID).toBe("global")
    expect(setup.data.session.get("ses_other")?.projectID).toBe("other-repository")
    expect(setup.data.session.get("ses_sibling")?.projectID).toBe("global")
    expect(setup.data.session.get("ses_remote")?.projectID).toBe("directory-root")
    await wait(() => setup.data.session.get("ses_uncached")?.projectID === "repository")
    expect(setup.data.session.get("ses_uncached")?.subpath).toBe("app")
  } finally {
    setup.dispose()
  }
})

test("refreshes global credential events across every loaded location and workspace", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: URL[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      requests.push(url)
      const directory = url.searchParams.get("location[directory]") ?? "/project"
      return Response.json({
        location: {
          directory,
          workspaceID: url.searchParams.get("location[workspace]") ?? undefined,
          project: { id: "project", directory, canonical: directory },
        },
        data: [],
      })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
      connection: { status: () => "connected" },
    }),
    dispose,
  }))
  const locations = [{ directory: "/project" }, { directory: "/other", workspaceID: "workspace-other" }]

  try {
    await Promise.all(
      locations.flatMap((location) => [
        setup.data.location.integration.sync(location),
        setup.data.location.model.sync(location),
        setup.data.location.provider.sync(location),
      ]),
    )
    requests.length = 0

    const updated: OpenCodeEvent = {
      id: "evt_credential.updated",
      created: 1,
      type: "credential.updated",
      data: {},
    }
    listeners.forEach((listener) => listener({ name: updated.type, details: updated }))
    await wait(() => requests.length === 2)
    expect(
      requests.map((url) => [
        url.pathname,
        url.searchParams.get("location[directory]"),
        url.searchParams.get("location[workspace]"),
      ]),
    ).toEqual([
      ["/api/integration", "/project", null],
      ["/api/integration", "/other", "workspace-other"],
    ])
    requests.length = 0

    for (const credentialID of ["credential", null]) {
      const switched: OpenCodeEvent = {
        id: `evt_credential.switched.${credentialID}`,
        created: 2,
        type: "credential.switched",
        data: { credentialID, integrationID: "integration" },
      }
      listeners.forEach((listener) => listener({ name: switched.type, details: switched }))
      await wait(() => requests.length === 4)
      expect(
        requests.map((url) => [
          url.pathname,
          url.searchParams.get("location[directory]"),
          url.searchParams.get("location[workspace]"),
        ]),
      ).toEqual(
        expect.arrayContaining([
          ["/api/model", "/project", null],
          ["/api/provider", "/project", null],
          ["/api/model", "/other", "workspace-other"],
          ["/api/provider", "/other", "workspace-other"],
        ]),
      )
      requests.length = 0
    }
  } finally {
    setup.dispose()
  }
})

test("reports optimistic sessions as creating until the request settles", async () => {
  const release = Promise.withResolvers<void>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (!request.url.endsWith("/api/session")) throw new Error(`Unexpected request: ${request.url}`)
      await release.promise
      return Response.json({ data: session(0) })
    },
  })
  const event: CreateDataInput["event"] = {
    on: () => () => {},
    listen: () => () => {},
  }
  const setup = createRoot((dispose) => ({
    data: createData({ api: () => api, directory: "/project", event, connection: { status: () => "connected" } }),
    dispose,
  }))

  try {
    const created = setup.data.session.create({ id: "ses_refresh", location: { directory: "/project" } })
    expect(setup.data.session.creating(created.id)).toBe(true)
    release.resolve()
    await created.request
    expect(setup.data.session.creating(created.id)).toBe(false)
  } finally {
    setup.dispose()
  }
})

test("loads bounded message pages", async () => {
  const requests: URL[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      requests.push(url)
      return Response.json({ data: [], cursor: requests.length === 1 ? { next: "next" } : {} })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: { on: () => () => {}, listen: () => () => {} },
    }),
    dispose,
  }))

  try {
    await setup.data.session.message.sync("ses_refresh")
    await setup.data.session.message.loadMore("ses_refresh")

    expect(requests).toHaveLength(2)
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({ limit: "20", order: "desc" })
    expect(Object.fromEntries(requests[1].searchParams)).toEqual({ cursor: "next", limit: "20" })
  } finally {
    setup.dispose()
  }
})

test("preserves assistant content replacement events across an active message read", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const release = Promise.withResolvers<void>()
  let requests = 0
  const content = [
    { type: "text" as const, text: "replacement" },
    { type: "reasoning" as const, text: "reasoning", time: { created: 3 } },
  ]
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async () => {
      const current = ++requests
      if (current === 2) await release.promise
      return Response.json({
        data: [
          {
            id: "msg_assistant",
            type: "assistant",
            agent: "build",
            model: { id: "model", providerID: "provider" },
            content: current === 3 ? content : [{ type: "text", text: "original" }],
            time: { created: 1, completed: 2 },
          },
        ],
        cursor: {},
      })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))

  try {
    await setup.data.session.message.sync("ses_refresh")
    setup.data.session.message.invalidate("ses_refresh")
    const stale = setup.data.session.message.sync("ses_refresh")
    await wait(() => requests === 2)
    const updated: OpenCodeEvent = {
      id: "evt_message_updated",
      created: 3,
      type: "session.message.content.updated",
      durable: { aggregateID: "ses_refresh", seq: 3, version: 1 },
      data: {
        sessionID: "ses_refresh",
        messageID: "msg_assistant",
        content,
      },
    }
    listeners.forEach((listener) => listener({ name: updated.type, details: updated }))

    expect(setup.data.session.message.list("ses_refresh")[0]).toMatchObject({ content })
    release.resolve()
    await stale
    await wait(() => requests === 3)
    expect(setup.data.session.message.list("ses_refresh")[0]).toMatchObject({ content })
  } finally {
    setup.dispose()
  }
})

test.each([
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.execution.started",
  "session.deleted",
] as const)("preserves %s activity when an older snapshot arrives", async (type) => {
  const release = Promise.withResolvers<void>()
  const requested = Promise.withResolvers<void>()
  const setup = activityFixture(async () => {
    requested.resolve()
    await release.promise
    return Response.json({
      data: {
        ...(type === "session.execution.started" ? {} : { ses_refresh: { type: "running" } }),
        ses_hydrated: { type: "running" },
      },
    })
  })

  try {
    if (type !== "session.execution.started") setup.data.session.setStatus("ses_refresh", "running")
    setup.emit({ type: "server.connected", data: {} })
    await requested.promise
    setup.emit({
      id: "evt_activity",
      created: 2,
      type,
      durable: { aggregateID: "ses_refresh", seq: 2, version: 1 },
      data: { sessionID: "ses_refresh", reason: "user" },
    })
    expect(setup.data.session.status("ses_refresh")).toBe(type === "session.execution.started" ? "running" : "idle")
    release.resolve()
    await wait(() => setup.data.session.status("ses_hydrated") === "running")
    expect(setup.data.session.status("ses_refresh")).toBe(type === "session.execution.started" ? "running" : "idle")
  } finally {
    release.resolve()
    setup.dispose()
  }
})

test("ignores activity snapshots from an older connection", async () => {
  const reads: ReturnType<typeof Promise.withResolvers<Response>>[] = []
  const setup = activityFixture(() => {
    const read = Promise.withResolvers<Response>()
    reads.push(read)
    return read.promise
  })

  try {
    setup.emit({ type: "server.connected", data: {} })
    await wait(() => reads.length === 1)
    setup.emit({ type: "server.connected", data: {} })
    await wait(() => reads.length === 2)
    reads[1]?.resolve(Response.json({ data: { ses_new: { type: "running" } } }))
    await wait(() => setup.data.session.status("ses_new") === "running")
    reads[0]?.resolve(Response.json({ data: { ses_old: { type: "running" } } }))
    await Bun.sleep(20)
    expect(setup.data.session.status("ses_new")).toBe("running")
    expect(setup.data.session.status("ses_old")).toBe("idle")
  } finally {
    reads.forEach((read) => read.resolve(Response.json({ data: {} })))
    setup.dispose()
  }
})

function activityFixture(read: () => Response | Promise<Response>) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const path = new URL(request.url).pathname
      if (path === "/api/session/active") return read()
      if (path === "/api/project") return Response.json([])
      if (path === "/api/location") return Response.json({ directory: "/project" })
      return Response.json({ location: { directory: "/project" }, data: { branch: "main" } })
    },
  })
  return createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    emit: (details: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: details.type, details })),
    dispose,
  }))
}

async function wait(check: () => boolean) {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > 2_000) throw new Error("Timed out waiting for condition")
    await Bun.sleep(10)
  }
}
