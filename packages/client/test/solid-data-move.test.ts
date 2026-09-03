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
