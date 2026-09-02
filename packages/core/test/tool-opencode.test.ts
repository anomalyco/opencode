import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Schema } from "effect"
import { CodeModeCatalog } from "@opencode-ai/core/codemode/catalog"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Image } from "@opencode-ai/core/image"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { Tool } from "@opencode-ai/core/tool"
import { OpenCodeTools } from "@opencode-ai/core/tool/plugin/opencode"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { globalProjectNode } from "./lib/project"
import { executeTool, toolIdentity } from "./lib/tool"
import { host } from "./plugin/host"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Session.node, Tool.node]), [
    Project.node.replace(globalProjectNode),
    SessionExecution.node.replace(SessionExecution.noopLayer),
    Image.node.replace(imagePassthrough),
  ]),
)

const register = Effect.gen(function* () {
  const tools = yield* Tool.Service
  const sessions = yield* Session.Service
  yield* OpenCodeTools.Plugin.effect(
    host({
      tool: {
        transform: tools.transform,
        reload: tools.reload,
        hook: () => Effect.die("unused tool.hook"),
      },
      session: { move: (input) => sessions.move(input) },
    }),
  )
})

describe("OpenCodeTools session_move", () => {
  it.effect("pins the existing Code Mode path even when the inline budget is zero", () =>
    Effect.gen(function* () {
      yield* register
      const registry = yield* Tool.Service
      const snapshot = yield* registry.snapshot()
      expect(snapshot.definitions.map((tool) => tool.name)).toEqual(["execute"])
      expect(snapshot.codeModeCatalog?.tools).toMatchObject([
        { type: "namespace", name: "opencode", description: "OpenCode session and runtime tools." },
      ])
      expect(
        CodeModeCatalog.summarize(snapshot.codeModeCatalog!, { budget: 0 }).namespaces.flatMap((namespace) =>
          namespace.entries.map((entry) => entry.path),
        ),
      ).toEqual(["opencode.session_move"])
      const denied = yield* registry.snapshot([{ action: "opencode_session_move", resource: "*", effect: "deny" }])
      expect(denied.codeModeCatalog?.tools).toMatchObject([{ name: "opencode", tools: [] }])
    }),
  )

  it.effect("moves the calling session or an explicit session with steer and queue delivery", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const destination = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const registry = yield* Tool.Service
      yield* register
      const location = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
      const current = yield* sessions.create({ location })
      const other = yield* sessions.create({ location })

      const result = yield* executeTool(registry, {
        sessionID: current.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-move",
          name: "execute",
          input: {
            code: `return [
              await tools.opencode.session_move({ directory: ${JSON.stringify(destination.path)} }),
              await tools.opencode.session_move({ sessionID: ${JSON.stringify(other.id)}, directory: ${JSON.stringify(destination.path)}, queue: true })
            ]`,
          },
        },
      })

      expect(result).toMatchObject({
        status: "completed",
        output: {
          output: JSON.stringify(
            [
              { sessionID: current.id, directory: destination.path },
              { sessionID: other.id, directory: destination.path },
            ],
            null,
            2,
          ),
        },
      })
      expect(yield* sessions.inbox(current.id)).toMatchObject([
        { type: "move", delivery: "steer", payload: { location: { directory: destination.path } } },
      ])
      expect(yield* sessions.inbox(other.id)).toMatchObject([
        { type: "move", delivery: "queue", payload: { location: { directory: destination.path } } },
      ])
      expect((yield* sessions.get(current.id)).location.directory).toBe(AbsolutePath.make(tmp.path))
    }),
  )

  it.effect("rejects invalid destinations without admitting a move", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const registry = yield* Tool.Service
      yield* register
      const session = yield* sessions.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }),
      })
      const directory = path.join(tmp.path, "missing")
      const result = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-missing",
          name: "execute",
          input: { code: `return await tools.opencode.session_move({ directory: ${JSON.stringify(directory)} })` },
        },
      })
      expect(JSON.stringify(result)).toContain(`Unable to move session to ${directory}`)
      expect(result.output).toMatchObject({
        error: true,
        toolCalls: [{ tool: "opencode.session_move", status: "error" }],
      })
      expect(yield* sessions.inbox(session.id)).toEqual([])
      expect((yield* sessions.get(session.id)).location.directory).toBe(AbsolutePath.make(tmp.path))
    }),
  )

  it.effect("leaves relative destination resolution to the session API", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const registry = yield* Tool.Service
      yield* register
      const current = yield* sessions.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }),
      })
      const result = yield* executeTool(registry, {
        sessionID: current.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-relative",
          name: "execute",
          input: {
            code: 'return await tools.opencode.session_move({ directory: "." })',
          },
        },
      })
      expect(result.output).toMatchObject({
        output: JSON.stringify({ sessionID: current.id, directory: "." }, null, 2),
        toolCalls: [{ tool: "opencode.session_move", status: "completed" }],
      })
      expect(yield* sessions.inbox(current.id)).toMatchObject([
        { type: "move", delivery: "steer", payload: { location: { directory: tmp.path } } },
      ])
    }),
  )

  it.effect("validates move arguments", () =>
    Effect.sync(() => {
      const valid = Schema.is(OpenCodeTools.MoveInput)
      expect(valid({ directory: "/project" })).toBe(true)
      expect(valid({ directory: "/project", sessionID: "ses_other", queue: false })).toBe(true)
      expect(valid({ directory: "" })).toBe(false)
      expect(valid({ directory: "/project", queue: "yes" })).toBe(false)
      expect(valid({})).toBe(false)
    }),
  )
})
