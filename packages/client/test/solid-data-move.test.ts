import { expect, test } from "bun:test"
import { createComputed, createRoot, createSignal } from "solid-js"
import { isServer } from "solid-js/web"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInfo } from "../src/promise"

const session = (id = "ses_move", parentID?: string): SessionInfo => ({
  id,
  parentID,
  projectID: "project-original",
  location: { directory: "/repo", workspaceID: "workspace-original" },
  subpath: "original",
  title: "Original title",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
})

for (const children of [false, true]) {
  for (const cached of [false, true]) {
    test(`stale ${children ? "family" : "session"} read cannot undo a move (${cached ? "cached" : "uncached"})`, async () => {
      const original = session()
      const setup = fixture([{ ...original, title: "Refreshed title", cost: 42, time: { created: 1, updated: 99 } }])
      try {
        if (cached) setup.data.session.remember(original)
        setup.data.session.invalidate(original.id)
        const read = setup.data.session.sync(original.id, { children })
        await setup.requested.promise
        setup.move(original.id, 2, {
          projectID: "project-moved",
          location: { directory: "/worktree" },
        })
        if (cached) expect(setup.data.session.get(original.id)?.location).toEqual({ directory: "/worktree" })
        setup.release.resolve()
        await read
        expect(setup.data.session.get(original.id)).toMatchObject({
          projectID: "project-moved",
          location: { directory: "/worktree" },
          title: "Refreshed title",
          cost: 42,
          time: { created: 1, updated: 99 },
        })
        expect(setup.data.session.get(original.id)?.location.workspaceID).toBeUndefined()
        expect(setup.data.session.get(original.id)?.subpath).toBeUndefined()
      } finally {
        setup.release.resolve()
        setup.dispose()
      }
    })
  }
}

test.each([false, true])(
  "later repository resolution supersedes an earlier move overlay (cached: %s)",
  async (cached) => {
    const resolved = {
      ...session(),
      location: { directory: "/repo/app" },
      projectID: "git-project",
      subpath: "app",
    }
    // This GET is processed after resolution, not serialized before the move.
    const setup = fixture([session()], async (_response, index) =>
      Response.json(index === 0 ? { data: resolved } : { data: [], cursor: {} }),
    )
    try {
      if (cached) setup.data.session.remember({ ...session(), location: { directory: "/original" } })
      const read = setup.data.session.sync("ses_move", { children: true })
      await setup.requested.promise
      setup.move("ses_move", 2, { projectID: "directory-project", location: { directory: "/repo/app" } })
      setup.emit({
        id: "evt_resolved",
        type: "worktree.resolved",
        created: 3,
        durable: { aggregateID: "git-project", seq: 1, version: 1 },
        data: { projectID: "git-project", previous: "directory-project", directory: "/repo" },
      })
      if (cached) {
        expect(setup.data.session.get("ses_move")?.projectID).toBe("git-project")
        expect(setup.data.session.get("ses_move")?.subpath).toBe("app")
      }
      setup.release.resolve()
      await read
      expect(setup.data.session.get("ses_move")?.projectID).toBe("git-project")
      expect(setup.data.session.get("ses_move")?.subpath).toBe("app")
    } finally {
      setup.release.resolve()
      setup.dispose()
    }
  },
)

for (const cached of [false, true]) {
  for (const order of ["adoption", "move-adoption", "adoption-move", "move-adoption-move"]) {
    test(`family placement facts compose in order (${order}, cached: ${cached})`, async () => {
      const sessions = [
        { ...session(), projectID: "directory-project", location: { directory: "/repo/app" } },
        { ...session("ses_child", "ses_move"), projectID: "directory-project", location: { directory: "/repo/ui" } },
        session("ses_sibling", "ses_move"),
      ]
      const setup = fixture(sessions.map((info) => ({ ...info, title: "Fresh title", cost: 42 })))
      try {
        if (cached) sessions.forEach(setup.data.session.remember)
        const read = setup.data.session.sync("ses_move", { children: true })
        await setup.requested.promise
        if (order.startsWith("move")) {
          setup.move("ses_move", 2, { projectID: "directory-project", location: { directory: "/repo/app" } })
          setup.move("ses_child", 2, { projectID: "directory-project", location: { directory: "/repo/ui" } })
        }
        setup.emit({
          id: "evt_resolved",
          type: "worktree.resolved",
          created: 3,
          durable: { aggregateID: "git-project", seq: 1, version: 1 },
          data: { projectID: "git-project", previous: "directory-project", directory: "/repo" },
        })
        if (order.endsWith("move")) {
          setup.move("ses_move", 4, { projectID: "last-project", location: { directory: "/last" } })
          setup.move("ses_child", 4, { projectID: "last-project", location: { directory: "/last/ui" }, subpath: "ui" })
        }
        setup.release.resolve()
        await read
        expect(setup.data.session.get("ses_move")).toMatchObject({
          projectID: order.endsWith("move") ? "last-project" : "git-project",
          location: { directory: order.endsWith("move") ? "/last" : "/repo/app" },
          title: "Fresh title",
          cost: 42,
        })
        expect(setup.data.session.get("ses_move")?.subpath).toBe(order.endsWith("move") ? undefined : "app")
        expect(setup.data.session.get("ses_child")).toMatchObject({
          projectID: order.endsWith("move") ? "last-project" : "git-project",
          location: { directory: order.endsWith("move") ? "/last/ui" : "/repo/ui" },
          subpath: "ui",
          title: "Fresh title",
          cost: 42,
        })
        expect(setup.data.session.get("ses_sibling")?.projectID).toBe("project-original")
        expect(setup.data.session.family("ses_move").toSorted()).toEqual(["ses_child", "ses_move", "ses_sibling"])
        expect(setup.requests).toHaveLength(2)
      } finally {
        setup.release.resolve()
        setup.dispose()
      }
    })
  }
}

test.each([false, true])(
  "pending adoption respects canonical project paths and workspaces (cached: %s)",
  async (cached) => {
    const sessions = [session(), session("ses_local", "ses_move"), session("ses_remote", "ses_move")]
    const setup = fixture(sessions)
    try {
      if (cached) sessions.forEach(setup.data.session.remember)
      setup.emit({
        id: "evt_project",
        type: "project.updated",
        created: 1,
        data: { id: "directory-project", canonical: "/repo/ui", time: { created: 1, updated: 1 }, sandboxes: [] },
      })
      const read = setup.data.session.sync("ses_move", { children: true })
      await setup.requested.promise
      setup.move("ses_local", 2, { projectID: "directory-project", location: { directory: "/shortcut" } })
      setup.move("ses_remote", 2, {
        projectID: "directory-project",
        location: { directory: "/shortcut", workspaceID: "remote-workspace" },
        subpath: "remote-path",
      })
      setup.emit({
        id: "evt_resolved",
        type: "worktree.resolved",
        created: 3,
        durable: { aggregateID: "git-project", seq: 1, version: 1 },
        data: {
          projectID: "git-project",
          previous: "unrelated-project",
          directory: "/repo",
          adopted: ["directory-project"],
        },
      })
      setup.release.resolve()
      await read
      expect(setup.data.session.get("ses_local")).toMatchObject({
        projectID: "git-project",
        location: { directory: "/shortcut" },
        subpath: "ui",
      })
      expect(setup.data.session.get("ses_remote")).toMatchObject({
        projectID: "directory-project",
        location: { directory: "/shortcut", workspaceID: "remote-workspace" },
        subpath: "remote-path",
      })
      expect(setup.data.session.get("ses_move")?.projectID).toBe("project-original")
    } finally {
      setup.release.resolve()
      setup.dispose()
    }
  },
)

test.each([false, true])(
  "revalidates missing canonical paths only for local adoption (workspace: %s)",
  async (workspace) => {
    const setup = fixture([session()], async () =>
      Response.json({
        data: { ...session(), projectID: "git-project", location: { directory: "/shortcut" }, subpath: "ui" },
      }),
    )
    try {
      const read = setup.data.session.sync("ses_move")
      await setup.requested.promise
      setup.move("ses_move", 2, {
        projectID: "directory-project",
        location: { directory: "/shortcut", workspaceID: workspace ? "remote-workspace" : undefined },
      })
      setup.emit({
        id: "evt_resolved",
        type: "worktree.resolved",
        created: 3,
        durable: { aggregateID: "git-project", seq: 1, version: 1 },
        data: {
          projectID: "git-project",
          previous: "unrelated-project",
          directory: "/repo",
          adopted: ["directory-project"],
        },
      })
      setup.release.resolve()
      await read
      expect(setup.data.session.get("ses_move")?.projectID).toBe(workspace ? "directory-project" : "git-project")
      expect(setup.data.session.get("ses_move")?.subpath).toBe(workspace ? undefined : "ui")
      expect(setup.requests).toHaveLength(workspace ? 1 : 2)
    } finally {
      setup.release.resolve()
      setup.dispose()
    }
  },
)

test.each([false, true])("a later complete move avoids re-reading unknown adoption (family: %s)", async (children) => {
  const setup = fixture(
    [{ ...session(), title: "Fresh title", cost: 40 }, session("ses_child", "ses_move")],
    async (response, index) =>
      index < (children ? 2 : 1) ? response : Response.json({ message: "network unavailable" }, { status: 503 }),
  )
  try {
    const read = setup.data.session.sync("ses_move", { children })
    await setup.requested.promise
    setup.move("ses_move", 2, { projectID: "directory-project", location: { directory: "/shortcut" } })
    setup.emit({
      id: "evt_resolved",
      type: "worktree.resolved",
      created: 3,
      durable: { aggregateID: "git-project", seq: 1, version: 1 },
      data: { previous: "other-project", projectID: "git-project", directory: "/repo", adopted: ["directory-project"] },
    })
    setup.move("ses_move", 4, { projectID: "final-project", location: { directory: "/final/src" }, subpath: "src" })
    setup.release.resolve()
    await read
    expect(setup.data.session.get("ses_move")).toMatchObject({
      location: { directory: "/final/src" },
      projectID: "final-project",
      subpath: "src",
      title: "Fresh title",
      cost: 40,
    })
    expect(setup.data.session.get("ses_move")?.location.workspaceID).toBeUndefined()
    expect(setup.requests).toHaveLength(children ? 2 : 1)
  } finally {
    setup.release.resolve()
    setup.dispose()
  }
})

test.each(["other-session", "known-adoption", "unknown-adoption"])(
  "unknown placement is superseded only by a complete same-session move (%s)",
  async (mode) => {
    const parent = {
      ...session(),
      projectID: "resolved-project",
      location: { directory: mode === "other-session" ? "/shortcut" : "/final/src" },
      subpath: "src",
    }
    const child = {
      ...session("ses_child", "ses_move"),
      projectID: "final-project",
      location: { directory: "/final/src" },
      subpath: "src",
    }
    const setup = fixture([session(), session("ses_child", "ses_move")], async (response, index) => {
      if (index < 2) return response
      if (mode === "known-adoption") return Response.json({ message: "unnecessary request" }, { status: 503 })
      return Response.json(index % 2 === 0 ? { data: parent } : { data: [child], cursor: {} })
    })
    try {
      const read = setup.data.session.sync("ses_move", { children: true })
      await setup.requested.promise
      setup.move("ses_move", 2, { projectID: "directory-project", location: { directory: "/shortcut" } })
      setup.emit({
        id: "evt_resolved",
        type: "worktree.resolved",
        created: 3,
        durable: { aggregateID: "resolved-project", seq: 1, version: 1 },
        data: {
          previous: "other-project",
          projectID: "resolved-project",
          directory: "/repo",
          adopted: ["directory-project"],
        },
      })
      setup.move(mode === "other-session" ? "ses_child" : "ses_move", 4, {
        projectID: "final-project",
        location: { directory: "/final/src" },
        subpath: "src",
      })
      if (mode !== "other-session")
        setup.emit({
          id: "evt_final_resolved",
          type: "worktree.resolved",
          created: 5,
          durable: { aggregateID: "resolved-project", seq: 2, version: 1 },
          data: {
            previous: "final-project",
            projectID: "resolved-project",
            directory: "/final",
            adopted: mode === "unknown-adoption" ? ["final-project"] : undefined,
          },
        })
      setup.release.resolve()
      await read
      expect(setup.data.session.get("ses_move")?.projectID).toBe("resolved-project")
      expect(setup.data.session.get("ses_move")?.subpath).toBe("src")
      expect(setup.data.session.get("ses_move")?.location).toEqual(parent.location)
      if (mode === "other-session") expect(setup.data.session.get("ses_child")?.projectID).toBe("final-project")
      expect(setup.requests).toHaveLength(mode === "known-adoption" ? 2 : 4)
    } finally {
      setup.release.resolve()
      setup.dispose()
    }
  },
)

test.each([false, true])(
  "a missing-canonical family refresh observes later moves and releases failed reads (failed: %s)",
  async (failed) => {
    const requested = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const parent = { ...session(), projectID: "git-project", location: { directory: "/shortcut" }, subpath: "ui" }
    const child = {
      ...session("ses_child", "ses_move"),
      projectID: "git-project",
      location: { directory: "/child" },
      subpath: "child",
    }
    const setup = fixture([session(), session("ses_child", "ses_move")], async (response, index) => {
      if (index < 2) return response
      const refreshed = Response.json(index % 2 === 0 ? { data: parent } : { data: [child], cursor: {} })
      if (index === 2) {
        requested.resolve()
        await release.promise
        if (failed) return Response.json({ message: "offline" }, { status: 503 })
      }
      return refreshed
    })
    try {
      const read = setup.data.session.sync("ses_move", { children: true })
      await setup.requested.promise
      setup.move("ses_move", 2, { projectID: "directory-project", location: { directory: "/shortcut" } })
      setup.emit({
        id: "evt_resolved",
        type: "worktree.resolved",
        created: 3,
        durable: { aggregateID: "git-project", seq: 1, version: 1 },
        data: {
          projectID: "git-project",
          previous: "unrelated-project",
          directory: "/repo",
          adopted: ["directory-project"],
        },
      })
      setup.release.resolve()
      await requested.promise
      expect(setup.data.session.get("ses_move")).toBeUndefined()
      setup.move("ses_child", 4, { projectID: "last-project", location: { directory: "/last" } })
      release.resolve()
      await (failed ? expect(read).rejects.toThrow() : read)
      if (failed) await setup.data.session.sync("ses_move", { children: true })
      expect(setup.data.session.get("ses_move")?.projectID).toBe("git-project")
      expect(setup.data.session.get("ses_move")?.subpath).toBe("ui")
      expect(setup.data.session.get("ses_child")?.location.directory).toBe(failed ? "/child" : "/last")
      expect(setup.data.session.get("ses_child")?.projectID).toBe(failed ? "git-project" : "last-project")
      expect(setup.requests).toHaveLength(failed ? 6 : 4)
    } finally {
      release.resolve()
      setup.release.resolve()
      setup.dispose()
    }
  },
)

test.each([false, true])("preserves each family member's latest move (cached: %s)", async (cached) => {
  const sessions = [session(), session("ses_child", "ses_move"), session("ses_sibling", "ses_move")]
  const setup = fixture(sessions)
  try {
    if (cached) sessions.forEach(setup.data.session.remember)
    const read = setup.data.session.sync("ses_move", { children: true })
    await setup.requested.promise
    setup.move("ses_move", 2, { projectID: "project-parent", location: { directory: "/parent" }, subpath: "app" })
    setup.move("ses_child", 2, {
      projectID: "project-child",
      location: { directory: "/child", workspaceID: "workspace-child" },
      subpath: "src",
    })
    setup.move("ses_child", 3, { projectID: "project-final", location: { directory: "/final" } })
    setup.release.resolve()
    await read
    expect(setup.data.session.get("ses_move")).toMatchObject({
      projectID: "project-parent",
      location: { directory: "/parent" },
      subpath: "app",
    })
    expect(setup.data.session.get("ses_child")).toMatchObject({ projectID: "project-final" })
    expect(setup.data.session.get("ses_child")?.location).toEqual({ directory: "/final" })
    expect(setup.data.session.get("ses_child")?.subpath).toBeUndefined()
    expect(setup.data.session.get("ses_sibling")).toEqual(sessions[2])
    expect(setup.data.session.family("ses_move").toSorted()).toEqual(["ses_child", "ses_move", "ses_sibling"])
    // Reconciliation updates metadata, not the transcript. Only observed moves on loaded sessions add rows.
    expect(setup.data.session.message.list("ses_move")).toHaveLength(cached ? 1 : 0)
    expect(setup.data.session.message.list("ses_child")).toHaveLength(cached ? 2 : 0)
  } finally {
    setup.release.resolve()
    setup.dispose()
  }
})

test.each([false, true])(
  "overlapping session and family reads preserve moves (family finishes first: %s)",
  async (familyFirst) => {
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const started = gates.map(() => Promise.withResolvers<void>())
    const setup = fixture([session()], async (response, index) => {
      started[index]?.resolve()
      await gates[index]?.promise
      return response
    })
    try {
      setup.data.session.remember(session())
      setup.data.session.invalidate("ses_move")
      const single = setup.data.session.sync("ses_move")
      const family = setup.data.session.sync("ses_move", { children: true })
      setup.release.resolve()
      await Promise.all(started.map((gate) => gate.promise))
      setup.move("ses_move", 2, { projectID: "project-first", location: { directory: "/first" } })
      gates[familyFirst ? 1 : 0]?.resolve()
      gates[2]?.resolve()
      await (familyFirst ? family : single)
      expect(setup.data.session.get("ses_move")?.location.directory).toBe("/first")
      setup.move("ses_move", 3, {
        projectID: "project-final",
        location: { directory: "/final", workspaceID: "workspace-final" },
        subpath: "final",
      })
      gates[familyFirst ? 0 : 1]?.resolve()
      await Promise.all([single, family])
      expect(setup.data.session.get("ses_move")).toMatchObject({
        projectID: "project-final",
        location: { directory: "/final", workspaceID: "workspace-final" },
        subpath: "final",
      })
      expect(setup.data.session.message.list("ses_move")).toHaveLength(2)
      setup.move("ses_move", 4, { projectID: "project-next", location: { directory: "/next" } })
      expect(
        setup.data.session.message
          .list("ses_move")
          .flatMap((item) => (item.type === "location-switched" ? [item.location.directory] : [])),
      ).toEqual(["/first", "/final", "/next"])
    } finally {
      gates.forEach((gate) => gate.resolve())
      setup.release.resolve()
      setup.dispose()
    }
  },
)

test.each([false, true])("later metadata reads stay authoritative after a move (failed: %s)", async (failed) => {
  const sessions = [session()]
  const setup = fixture(sessions, async (response, index) =>
    failed && index === 0 ? Response.json({ message: "offline" }, { status: 503 }) : response,
  )
  try {
    const read = setup.data.session.sync("ses_move")
    await setup.requested.promise
    setup.move("ses_move", 2, { projectID: "project-live", location: { directory: "/live" } })
    setup.release.resolve()
    await (failed ? expect(read).rejects.toThrow() : read)
    sessions[0] = { ...session(), projectID: "project-later", location: { directory: "/later" } }
    if (!failed) {
      await setup.data.session.sync("ses_move")
      expect(setup.requests).toHaveLength(1)
      setup.data.session.invalidate("ses_move")
    }
    await setup.data.session.sync("ses_move")
    expect(setup.data.session.get("ses_move")?.location).toEqual({ directory: "/later" })
    expect(setup.data.session.get("ses_move")?.projectID).toBe("project-later")
    expect(setup.requests).toHaveLength(2)
  } finally {
    setup.release.resolve()
    setup.dispose()
  }
})

// The package's default Bun condition uses Solid's server build. Exercise effects with --conditions=browser.
test.skipIf(isServer)("reconnect revalidates without publishing a stale move location", async () => {
  const sessions = [session()]
  const setup = fixture(sessions)
  try {
    setup.data.session.remember(session())
    const read = setup.data.session.sync("ses_move", { children: true })
    await setup.requested.promise
    setup.move("ses_move", 2, { projectID: "project-live", location: { directory: "/live" } })
    setup.locations.length = 0
    setup.setStatus("reconnecting")
    setup.setStatus("connected")
    sessions[0] = { ...session(), projectID: "project-later", location: { directory: "/later" } }
    const refreshed = setup.data.session.sync("ses_move", { children: true })
    expect(setup.requests).toHaveLength(2)
    setup.release.resolve()
    await Promise.all([read, refreshed])
    expect(setup.data.session.get("ses_move")?.location).toEqual({ directory: "/later" })
    expect(setup.locations).not.toContain("/repo")
    expect(setup.locations).toContain("/later")
    expect(setup.requests).toHaveLength(4)
    await setup.data.session.sync("ses_move", { children: true })
    expect(setup.requests).toHaveLength(4)
  } finally {
    setup.release.resolve()
    setup.dispose()
  }
})

function fixture(sessions: SessionInfo[], respond?: (response: Response, index: number) => Promise<Response>) {
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: URL[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      const index = requests.length
      requests.push(url)
      const response =
        url.pathname === "/api/session"
          ? Response.json({
              data: sessions.filter((item) => item.parentID === url.searchParams.get("parentID")),
              cursor: {},
            })
          : Response.json({ data: sessions.find((item) => url.pathname === `/api/session/${item.id}`) })
      // Serialize before yielding: Solid may mutate the remembered fixture after the move.
      requested.resolve()
      await release.promise
      return respond ? respond(response, index) : response
    },
  })
  return createRoot((dispose) => {
    const [status, setStatus] = createSignal<"connected" | "reconnecting">("connected")
    const emit = (details: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: details.type, details }))
    const data = createData({
      api: () => api,
      directory: "/repo",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
      connection: { status },
    })
    const locations: (string | undefined)[] = []
    createComputed(() => locations.push(data.session.get("ses_move")?.location.directory))
    return {
      data,
      emit,
      locations,
      move(
        sessionID: string,
        seq: number,
        data: Omit<Extract<OpenCodeEvent, { type: "session.moved" }>["data"], "sessionID">,
      ) {
        emit({
          id: `evt_move_${sessionID}_${seq}`,
          type: "session.moved",
          created: seq,
          durable: { aggregateID: sessionID, seq, version: 1 },
          data: { sessionID, ...data },
        })
      },
      setStatus,
      requested,
      release,
      requests,
      dispose,
    }
  })
}
