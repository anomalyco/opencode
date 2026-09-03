import { describe, expect, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client/promise"
import { createData, type CreateDataInput } from "@opencode-ai/client/solid"
import type { OpenCodeEvent, SessionInfo } from "@opencode-ai/client/promise"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { ServerConnection } from "@/runtime/server/registry"
import type { Tab } from "@/shell/tabs/tabs"
import { createLocationResidency } from "@/runtime/server/residency"

const server = "local" as ServerConnection.Key
const other = "http://remote:4096" as ServerConnection.Key

function session(id: string, directory: string): SessionInfo {
  return {
    id,
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory },
  }
}

function fixture() {
  const requests: string[] = []
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        const directory = url.searchParams.get("location[directory]") ?? "/default"
        const workspaceID = url.searchParams.get("location[workspace]") ?? undefined
        requests.push(`${url.pathname} ${directory}${workspaceID ? ` (${workspaceID})` : ""}`)
        return Response.json({
          location: { directory, workspaceID, project: { id: "project", directory, canonical: directory } },
          data: [{ id: `model-${directory}`, providerID: "opencode" }],
        })
      },
      { preconnect() {} },
    ),
  })
  return createRoot((dispose) => {
    const [tabs, setTabs] = createStore<Tab[]>([])
    const data = createData({
      api: () => api,
      directory: "/default",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    })
    createLocationResidency({ key: server, tabs: () => tabs, data })
    // Releases drop catalogs after the current task.
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
    return {
      data,
      tabs,
      setTabs,
      requests,
      settle,
      dispose,
      emit: (details: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: details.type, details })),
    }
  })
}

describe("location residency", () => {
  test.each(["event", "remember"] as const)("moving a tab via %s releases the original identity only", async (mode) => {
    const setup = fixture()
    const a = { directory: "/repo/a", workspaceID: "workspace-a" }
    const b = { directory: "/repo/b", workspaceID: "workspace-b" }
    try {
      setup.data.session.remember({ ...session("ses_move", a.directory), location: { ...a } })
      setup.setTabs([{ type: "session", server, sessionId: "ses_move" }])
      const original = setup.data.session.get("ses_move")!.location
      await Promise.all(
        [a, b].flatMap((ref) => [setup.data.location.model.sync(ref), setup.data.location.provider.sync(ref)]),
      )
      if (mode === "event") {
        setup.emit({
          id: "evt_move",
          created: 1,
          type: "session.moved",
          durable: { aggregateID: "ses_move", seq: 1, version: 1 },
          data: { sessionID: "ses_move", location: b, projectID: "project" },
        })
      } else {
        setup.data.session.remember({ ...session("ses_move", b.directory), location: { ...b } })
      }
      await setup.settle()
      const afterMove = {
        model: setup.data.location.model.list(a) ?? null,
        provider: setup.data.location.provider.list(a) ?? null,
      }
      setup.requests.length = 0
      await Promise.all([setup.data.location.model.sync(b), setup.data.location.provider.sync(b)])
      const bRequests = [...setup.requests]
      setup.requests.length = 0
      await Promise.all([setup.data.location.model.sync(a), setup.data.location.provider.sync(a)])
      const evidence = {
        mode,
        sameProxy: original === setup.data.session.get("ses_move")!.location,
        originalNow: { directory: original.directory, workspaceID: original.workspaceID },
        afterMove,
        bRequests,
        aRequests: [...setup.requests],
        aModel: setup.data.location.model.list(a) ?? null,
        aProvider: setup.data.location.provider.list(a) ?? null,
        bModel: setup.data.location.model.list(b) ?? null,
        bProvider: setup.data.location.provider.list(b) ?? null,
      }
      if (process.env.OPENCODE_LOCATION_EVIDENCE) console.log("LOCATION_MOVE", JSON.stringify(evidence))
      expect(evidence.afterMove).toEqual({ model: null, provider: null })
      expect(evidence.bRequests).toEqual([])
      expect(evidence.aRequests).toEqual(["/api/model /repo/a (workspace-a)", "/api/provider /repo/a (workspace-a)"])
      expect(evidence.aModel?.map((model) => model.id)).toEqual(["model-/repo/a"])
      expect(evidence.aProvider?.map((provider) => provider.id)).toEqual(["model-/repo/a"])
      expect(evidence.bModel?.map((model) => model.id)).toEqual(["model-/repo/b"])
      expect(evidence.bProvider?.map((provider) => provider.id)).toEqual(["model-/repo/b"])
      setup.requests.length = 0
      await Promise.all([setup.data.location.model.sync(a), setup.data.location.provider.sync(a)])
      expect(setup.requests).toEqual([])
    } finally {
      setup.dispose()
    }
  })

  test("keeps catalogs for open tabs and releases them when the last tab closes", async () => {
    const setup = fixture()
    try {
      setup.data.session.remember(session("ses_a", "/repo/a"))
      setup.data.session.remember(session("ses_b", "/repo/a"))
      setup.setTabs([
        { type: "session", server, sessionId: "ses_a" },
        { type: "session", server, sessionId: "ses_b" },
        { type: "draft", server, draftID: "draft", directory: "/repo/draft" },
        { type: "session", server: other, sessionId: "ses_a" },
      ])
      await setup.data.location.model.sync({ directory: "/repo/a" })
      await setup.data.location.model.sync({ directory: "/repo/draft" })
      expect(setup.requests).toEqual(["/api/model /repo/a", "/api/model /repo/draft"])

      setup.setTabs((tabs) => tabs.filter((tab) => tab.type !== "session" || tab.sessionId !== "ses_a"))
      await setup.settle()
      expect(setup.data.location.model.list({ directory: "/repo/a" })).toHaveLength(1)

      setup.setTabs((tabs) => tabs.filter((tab) => tab.type !== "session" || tab.server !== server))
      await setup.settle()
      expect(setup.data.location.model.list({ directory: "/repo/a" })).toBeUndefined()
      expect(setup.data.location.model.list({ directory: "/repo/draft" })).toHaveLength(1)

      setup.setTabs([])
      await setup.settle()
      expect(setup.data.location.model.list({ directory: "/repo/draft" })).toBeUndefined()

      await setup.data.location.model.sync({ directory: "/repo/a" })
      expect(setup.requests).toHaveLength(3)
      expect(setup.data.location.model.list({ directory: "/repo/a" })).toHaveLength(1)
    } finally {
      setup.dispose()
    }
  })

  test("holds a session tab's directory once its session info arrives", async () => {
    const setup = fixture()
    try {
      setup.setTabs([{ type: "session", server, sessionId: "ses_late" }])
      await setup.data.location.model.sync({ directory: "/repo/late" })
      setup.data.session.remember(session("ses_late", "/repo/late"))
      setup.setTabs([])
      await setup.settle()
      expect(setup.data.location.model.list({ directory: "/repo/late" })).toBeUndefined()
    } finally {
      setup.dispose()
    }
  })

  test("promoting a draft to a session tab keeps the directory resident", async () => {
    const setup = fixture()
    try {
      setup.data.session.remember(session("ses_new", "/repo/a"))
      setup.setTabs([{ type: "draft", server, draftID: "draft", directory: "/repo/a" }])
      await setup.data.location.model.sync({ directory: "/repo/a" })
      setup.requests.length = 0
      setup.setTabs([{ type: "session", server, sessionId: "ses_new" }])
      await setup.settle()
      expect(setup.data.location.model.list({ directory: "/repo/a" })).toHaveLength(1)
      await setup.data.location.model.sync({ directory: "/repo/a" })
      expect(setup.requests).toEqual([])
    } finally {
      setup.dispose()
    }
  })
})
