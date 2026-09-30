import { describe, expect, test } from "bun:test"
import { OpenCode, type SessionInfo, type SessionMessageAssistant } from "@opencode/client"
import { loadTraySessions } from "./tray-sessions"

const tokens = { input: 900, output: 100, reasoning: 10, cache: { read: 50, write: 40 } }

function session(id: string, updated: number, extra: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    title: id,
    projectID: "project",
    location: { directory: "/code/project/src" },
    cost: 4.56,
    tokens: { ...tokens, input: 999_999 },
    time: { created: 1, updated },
    ...extra,
  }
}

// Exercise the generated client's real HTTP decoding as well as the tray's
// inventory logic, without running a provider or creating durable sessions.
function fixture(
  input: {
    many?: boolean
    detailsUnavailable?: boolean
    offline?: boolean
    worktree?: boolean
    placementUnavailable?: boolean
    finished?: number
    viewed?: number
    running?: boolean
  } = {},
) {
  const requests: string[] = []
  const inventory = input.many
    ? Array.from({ length: 12 }, (_, index) => session(`recent-${index}`, 100 - index))
    : [
        session("idle", 100, { outcome: "succeeded" }),
        session("failed", 90, { outcome: "failed" }),
        session("permission", 80),
        session("question", 70),
        session("archived", 60, { time: { created: 1, updated: 60, archived: 70 } }),
      ]
  const message: SessionMessageAssistant = {
    id: "message",
    type: "assistant",
    time: { created: 10, completed: 20 },
    agent: "build",
    model: { providerID: "provider", id: "model" },
    content: [],
    tokens,
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      requests.push(url.pathname)
      if (input.offline) return new Response("Unavailable", { status: 503 })
      if (url.pathname === "/api/project")
        return Response.json([
          {
            id: "project",
            canonical: "/code/another-clone",
            name: "Dashboard",
            icon: { url: "data:image/png;base64,fixture" },
          },
        ])
      if (url.pathname === "/api/location") {
        if (input.placementUnavailable) return new Response("Unavailable", { status: 503 })
        return Response.json({
          directory: "/code/project/src",
          project: {
            id: "project",
            directory: "/code/project",
            canonical: input.worktree ? "/code/main" : "/code/project",
          },
        })
      }
      if (url.pathname === "/api/session") return Response.json({ data: inventory, cursor: {} })
      if (url.pathname === "/api/session/active")
        return Response.json({
          data: {
            older: { type: "running" },
            permission: { type: "running" },
            ...(input.running ? { idle: { type: "running" } } : {}),
          },
        })
      if (url.pathname === "/api/session/older")
        return Response.json({ data: session("older", 2, { parentID: "parent" }) })
      if (url.pathname === "/api/session/permission") return Response.json({ data: session("permission", 3) })
      const found = inventory.find((item) => url.pathname === `/api/session/${item.id}`)
      if (found)
        return Response.json({
          data: { ...found, time: { ...found.time, idle: input.finished, viewed: input.viewed } },
        })
      if (url.pathname.endsWith("/form"))
        return Response.json({
          data: url.pathname.includes("/question/")
            ? [{ id: "form", sessionID: "question", title: "Which approach?", fields: [] }]
            : [],
        })
      if (url.pathname.endsWith("/permission"))
        return Response.json({
          data: url.pathname.includes("/permission/")
            ? [{ id: "permission", sessionID: "permission", action: "shell", resources: [] }]
            : [],
        })
      if (url.pathname.endsWith("/message")) {
        if (input.detailsUnavailable) return new Response("Unavailable", { status: 503 })
        expect(url.searchParams.get("order")).toBe("desc")
        expect(url.searchParams.get("limit")).toBe("10")
        return Response.json({
          data: [message, { ...message, id: "older-message", tokens: { ...tokens, input: 1 } }],
          cursor: {},
        })
      }
      if (url.pathname === "/api/model")
        return Response.json({
          location: {},
          data: [{ id: "model", providerID: "provider", name: "Example Model", limit: { context: 2000 } }],
        })
      return new Response("Not found", { status: 404 })
    },
  })
  return {
    client: OpenCode.make({ baseUrl: server.url.toString() }),
    requests,
    [Symbol.dispose]() {
      server.stop(true)
    },
  }
}

describe("tray session inventory", () => {
  test.each([
    { finished: undefined, viewed: undefined, unread: false },
    { finished: 20, viewed: undefined, unread: true },
    { finished: 20, viewed: 10, unread: true },
    { finished: 20, viewed: 20, unread: false },
    { finished: 20, viewed: 30, unread: false },
    { finished: 20, viewed: 10, running: true, unread: false },
  ])("uses the completion/viewed watermarks for unread state: %j", async (input) => {
    using server = fixture(input)
    const result = await loadTraySessions(server.client, ["idle"], AbortSignal.timeout(5000))
    expect(result.sessions[0].unread).toBe(input.unread)
  })

  test("clears the completion badge on viewing and badges a later completion again", async () => {
    const state: { finished: number; viewed?: number } = { finished: 20 }
    using server = fixture(state)
    const load = () => loadTraySessions(server.client, ["idle"], AbortSignal.timeout(5000))
    expect((await load()).sessions[0].unread).toBe(true)
    state.viewed = 20
    expect((await load()).sessions[0].unread).toBe(false)
    state.finished = 30
    expect((await load()).sessions[0].unread).toBe(true)
  })
  test("identifies worktrees by their resolved checkout root, including nested session directories", async () => {
    using server = fixture({ worktree: true })
    const result = await loadTraySessions(server.client, ["idle"], AbortSignal.timeout(5000))
    expect(result.sessions[0].directory).toBe("/code/project/src")
    expect(result.sessions[0].placement).toEqual({ type: "worktree", directory: "/code/project" })
  })

  test("does not guess Local when placement cannot be resolved", async () => {
    using server = fixture({ placementUnavailable: true })
    const result = await loadTraySessions(server.client, ["idle"], AbortSignal.timeout(5000))
    expect(result.state).toBe("ready")
    expect(result.sessions[0].placement).toBeUndefined()
  })
  test("loads open tabs only and prioritizes pending input over activity", async () => {
    using server = fixture()
    const result = await loadTraySessions(
      server.client,
      ["idle", "failed", "permission", "question", "older", "archived"],
      AbortSignal.timeout(5000),
    )
    expect(result.state).toBe("ready")
    expect(result.sessions.map((item) => [item.id, item.status])).toEqual([
      ["permission", "permission"],
      ["question", "question"],
      ["idle", "idle"],
      ["failed", "failed"],
      ["older", "working"],
    ])
    expect(result.attention).toBe(2)
    expect(result.working).toBe(1)
    expect(result.sessions[0].detail).toBe("shell")
    expect(result.sessions[1].detail).toBe("Which approach?")
    expect(result.sessions[0].tokens).toBe(1100)
    expect(result.sessions[0].cost).toBe(4.56)
    expect(result.sessions[0].placement).toEqual({ type: "local", directory: "/code/project" })
    expect(result.sessions[0].context).toBe(55)
    expect(result.sessions[0].model).toBe("Example Model")
    expect(result.sessions[0].project).toMatchObject({
      id: "project",
      name: "Dashboard",
      icon: { url: "data:image/png;base64,fixture" },
    })
    expect(server.requests.filter((path) => path === "/api/model")).toHaveLength(1)
    expect(server.requests.filter((path) => path === "/api/location")).toHaveLength(1)
    expect(server.requests.some((path) => path.includes("/archived/"))).toBe(false)
    expect(server.requests).not.toContain("/api/session")
  })

  test("shows all open tabs, preserving their order within the active group", async () => {
    using server = fixture({ many: true })
    const ids = Array.from({ length: 12 }, (_, index) => `recent-${11 - index}`)
    const result = await loadTraySessions(server.client, ids, AbortSignal.timeout(5000))
    expect(result.sessions.map((item) => item.id)).toEqual(ids)
    expect(result.more).toBe(false)
    expect(result.working).toBe(0)
    expect(server.requests).not.toContain("/api/session/older")
    expect(server.requests).not.toContain("/api/session/permission")
  })

  test("does not fetch history or running sessions when there are no open tabs", async () => {
    using server = fixture()
    const result = await loadTraySessions(server.client, [], AbortSignal.timeout(5000))
    expect(result.sessions).toEqual([])
    expect(result.state).toBe("ready")
    expect(server.requests).toEqual([])
  })

  test("deduplicates sessions open in multiple windows", async () => {
    using server = fixture()
    const result = await loadTraySessions(server.client, ["idle", "idle"], AbortSignal.timeout(5000))
    expect(result.sessions.map((item) => item.id)).toEqual(["idle"])
    expect(server.requests.filter((path) => path === "/api/session/idle")).toHaveLength(1)
  })

  test("keeps status when optional usage is unavailable and does not invent a percentage", async () => {
    using server = fixture({ detailsUnavailable: true })
    const result = await loadTraySessions(server.client, ["permission"], AbortSignal.timeout(5000))
    expect(result.sessions[0].status).toBe("permission")
    expect(result.sessions[0].tokens).toBeUndefined()
    expect(result.sessions[0].cost).toBe(4.56)
    expect(result.sessions[0].context).toBeUndefined()
  })

  test("fails the refresh instead of turning a disconnected server into an empty list", async () => {
    using server = fixture({ offline: true })
    await expect(loadTraySessions(server.client, ["idle"], AbortSignal.timeout(5000))).rejects.toThrow()
  })
})
