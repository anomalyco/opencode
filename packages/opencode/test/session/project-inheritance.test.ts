import { afterEach, describe, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Session } from "@/session/session"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  BackgroundJob.defaultLayer,
  EventV2Bridge.defaultLayer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Session.defaultLayer,
  SessionRunState.defaultLayer,
  SessionStatus.defaultLayer,
  Truncate.defaultLayer,
  ToolRegistry.defaultLayer,
  Database.defaultLayer,
  RuntimeFlags.layer({}),
).pipe(Layer.provide(Ripgrep.defaultLayer))

const it = testEffect(layer)

describe("session project inheritance", () => {
  it.instance("subagent inherits parent projectID and directory", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({ title: "Parent" })
      const child = yield* sessions.create({ parentID: parent.id, title: "Child" })

      expect(child.projectID).toBe(parent.projectID)
      expect(child.directory).toBe(parent.directory)
    }),
  )

  it.instance("fork inherits original projectID and directory", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const original = yield* sessions.create({ title: "Original" })
      const forked = yield* sessions.fork({ sessionID: original.id })

      expect(forked.projectID).toBe(original.projectID)
      expect(forked.directory).toBe(original.directory)
    }),
  )

  it.instance("session without parentID falls back to the instance project", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "Standalone" })
      const ctx = yield* InstanceState.context

      expect(session.projectID).toBe(ctx.project.id)
      expect(session.directory).toBe(ctx.directory)
    }),
  )
})