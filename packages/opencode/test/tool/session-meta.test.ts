import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "@/session/schema"
import { disposeAllInstances, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    Session.defaultLayer,
    ToolRegistry.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    testInstanceStoreLayer,
  ),
)

afterEach(async () => {
  await disposeAllInstances()
})

function mockContext(): Tool.Context {
  return {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

function findTool(tools: Tool.Def[], id: string): Tool.Def {
  const tool = tools.find((t) => t.id === id)
  if (!tool) throw new Error(`Tool "${id}" not found in registry`)
  return tool
}

describe("session_find", () => {
  it.instance("finds session by title", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.all()
      const tool = findTool(tools, "session_find")

      yield* session.create({ title: "Debugging Retry Logic" })

      const result = yield* tool.execute({ title: "Retry" }, mockContext())
      const parsed = JSON.parse(result.output)

      expect(parsed.results).toBeArrayOfSize(1)
      expect(parsed.results[0].title).toBe("Debugging Retry Logic")
      expect(parsed.ambiguous).toBe(false)
      expect(result.metadata.count).toBe(1)
    }),
  )

  it.instance("title match is case-insensitive", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.all()
      const tool = findTool(tools, "session_find")

      yield* session.create({ title: "RETRY CONFIG" })

      const result = yield* tool.execute({ title: "retry" }, mockContext())
      const parsed = JSON.parse(result.output)

      expect(parsed.results).toBeArrayOfSize(1)
      expect(parsed.results[0].title).toBe("RETRY CONFIG")
    }),
  )

  it.instance("no match returns empty", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.all()
      const tool = findTool(tools, "session_find")

      const result = yield* tool.execute({ title: "nonexistent_xyz_123" }, mockContext())
      const parsed = JSON.parse(result.output)

      expect(parsed.results).toBeArrayOfSize(0)
      expect(parsed.ambiguous).toBe(false)
      expect(result.metadata.count).toBe(0)
    }),
  )

  it.instance("ambiguous: true for multiple matches", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.all()
      const tool = findTool(tools, "session_find")

      yield* session.create({ title: "Fix retry logic" })
      yield* session.create({ title: "Retry rate limiter" })

      const result = yield* tool.execute({ title: "retry" }, mockContext())
      const parsed = JSON.parse(result.output)

      expect(parsed.results).toBeArrayOfSize(2)
      expect(parsed.ambiguous).toBe(true)
      expect(result.metadata.ambiguous).toBe(true)
    }),
  )
})

describe("session_get", () => {
  it.instance("returns session metadata", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.all()
      const tool = findTool(tools, "session_get")

      const created = yield* session.create({ title: "Test Session" })

      const result = yield* tool.execute({ sessionId: created.id }, mockContext())
      const parsed = JSON.parse(result.output)

      expect(parsed.id).toBe(created.id)
      expect(parsed.title).toBe("Test Session")
      expect(parsed.directory).toBeString()
      expect(parsed.time_created).toBeNumber()
      expect(parsed.time_updated).toBeNumber()
      expect(result.title).toBe("Test Session")
    }),
  )

  it.instance("session not found returns error", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.all()
      const tool = findTool(tools, "session_get")

      const exit = yield* tool.execute({ sessionId: "ses_nonexistent" }, mockContext()).pipe(
        Effect.exit,
      )

      const message = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""

      expect(message).toContain("Session not found")
      expect(message).toContain("session_find")
      expect(message).toContain("session_list")
    }),
  )
})

describe("session_list", () => {
  it.instance("lists sessions", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.all()
      const tool = findTool(tools, "session_list")

      yield* session.create({ title: "Session A" })
      yield* session.create({ title: "Session B" })
      yield* session.create({ title: "Session C" })

      const result = yield* tool.execute({}, mockContext())
      const parsed = JSON.parse(result.output)

      expect(parsed).toBeArrayOfSize(3)
      const titles = parsed.map((s: { title: string }) => s.title)
      expect(titles).toContain("Session A")
      expect(titles).toContain("Session B")
      expect(titles).toContain("Session C")
    }),
  )

  it.instance("limit clamping", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.all()
      const tool = findTool(tools, "session_list")

      yield* session.create({ title: "S1" })
      yield* session.create({ title: "S2" })
      yield* session.create({ title: "S3" })
      yield* session.create({ title: "S4" })
      yield* session.create({ title: "S5" })

      const result = yield* tool.execute({ limit: 2 }, mockContext())
      const parsed = JSON.parse(result.output)

      expect(parsed).toBeArrayOfSize(2)
    }),
  )

  it.instance("returns parents and children", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.all()
      const tool = findTool(tools, "session_list")

      const parent = yield* session.create({ title: "Parent Session" })
      yield* session.create({ title: "Child Session", parentID: parent.id })

      const result = yield* tool.execute({}, mockContext())
      const parsed = JSON.parse(result.output)

      expect(parsed.length).toBeGreaterThanOrEqual(2)
      const titles = parsed.map((s: { title: string }) => s.title)
      expect(titles).toContain("Parent Session")
      expect(titles).toContain("Child Session")
    }),
  )

  it.instance("search filter", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.all()
      const tool = findTool(tools, "session_list")

      yield* session.create({ title: "Specific search target" })
      yield* session.create({ title: "Other unrelated" })
      yield* session.create({ title: "Another one" })

      const result = yield* tool.execute({ search: "Specific" }, mockContext())
      const parsed = JSON.parse(result.output)

      expect(parsed).toBeArrayOfSize(1)
      expect(parsed[0].title).toBe("Specific search target")
    }),
  )
})
