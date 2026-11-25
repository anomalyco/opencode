import { describe, expect } from "bun:test"
import { CodeModeJob } from "@opencode/core/codemode/job"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Job } from "@opencode/core/job"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { ToolOutput } from "@opencode/core/tool-output"
import { StopTool } from "@opencode/core/tool/plugin/stop"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { DateTime, Effect, Layer, Queue, Scope, Stream } from "effect"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity, toolNodeReplacements } from "./lib/tool"

const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(LayerNode.group([Tool.node, Job.node, Database.node, Global.node]), toolNodeReplacements()),
    Flag.testLayer([], { overrides: "full_codemode" }),
    Layer.mock(ToolOutput.Service, { truncate: (result) => Effect.succeed(result) }),
  ),
)

const sessionID = Session.ID.make("ses_stop")

const register = (fullCodeMode: boolean) =>
  registerToolPlugin(StopTool.Plugin, { event: { subscribe: () => Stream.never } }).pipe(
    Effect.provide(
      Flag.testLayer([
        new Document({
          type: "document",
          info: new Info({ experimental: new ConfigExperimental.Info({ full_codemode: fullCodeMode }) }),
        }),
      ]),
    ),
    Effect.provide(permissionLayer({ assert: () => Effect.void })),
  )

const context = (): Tool.Context => ({
  sessionID,
  ...toolIdentity,
  id: Tool.CallID.make("call_script"),
  progress: () => Effect.void,
})

describe("StopTool", () => {
  it.effect("is only registered, and pinned, with full_codemode", () =>
    Effect.gen(function* () {
      yield* register(false)
      const registry = yield* Tool.Service
      expect((yield* registry.list()).some((tool) => tool.name === StopTool.name)).toBe(false)
      yield* register(true)
      const tool = (yield* registry.list()).find((tool) => tool.name === StopTool.name)
      expect(tool?.options?.codemode).toEqual({ pinned: true })
    }),
  )

  it.live("stops a background script without notifying, and reports what it did not stop", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      yield* register(true)
      const registry = yield* Tool.Service
      const notices = yield* Queue.unbounded<unknown>()
      const run = yield* CodeModeJob.make(
        jobs,
        (input) =>
          Queue.offer(notices, input).pipe(
            Effect.as({
              type: "synthetic" as const,
              payload: { text: input.text, description: input.description, metadata: input.metadata },
              delivery: "queue" as const,
              id: input.id ?? SessionMessage.ID.create(),
              sessionID: input.sessionID,
              time: { created: DateTime.makeUnsafe(0) },
            }),
          ),
        yield* Scope.make(),
      )
      if (!run) throw new Error("no job runner")
      const started = yield* run(context(), () => Effect.never, { background: true })
      const id = String(started.metadata?.jobID)
      const stop = (ids: string[]) =>
        executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: `call_stop_${Math.random()}`, name: StopTool.name, input: { ids } },
        })
      const stopped = yield* stop([id, "cm_missing"])
      expect(stopped.output).toEqual({ stopped: [id], notRunning: ["cm_missing"] })
      expect((yield* jobs.get(id))?.status ?? "cancelled").toBe("cancelled")
      expect(yield* jobs.pendingBackground).toEqual([])
      expect((yield* stop([id])).output).toEqual({ stopped: [], notRunning: [id] })
      expect(yield* Queue.size(notices)).toBe(0)
    }),
  )
})
