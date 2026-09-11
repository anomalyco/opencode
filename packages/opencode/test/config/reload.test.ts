import { describe, expect } from "bun:test"
import { ConfigReload } from "@/config/reload"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { EventV2Bridge } from "@/event-v2-bridge"
import type { InstanceContext } from "@/project/instance-context"
import { InstanceStore } from "@/project/instance-store"
import { SessionPrompt } from "@/session/prompt"
import { EventV2 } from "@opencode-ai/core/event"
import { ProjectV2 } from "@opencode-ai/core/project"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Effect, Layer, Stream } from "effect"
import { testEffect } from "../lib/effect"

type PublishedEvent = {
  type: string
  data: unknown
}

type ReloadCall = {
  directory: string
  worktree?: string
}

type ResumeCall = {
  sessionID: string
}

function instance(directory: string): InstanceContext {
  return {
    directory,
    worktree: directory,
    project: {
      id: ProjectV2.ID.make(directory),
      worktree: directory,
      time: {
        created: 1,
        updated: 1,
      },
      sandboxes: [],
    },
  }
}

function withInstance<A, E, R>(ctx: InstanceContext, effect: Effect.Effect<A, E, R>) {
  return effect.pipe(Effect.provideService(InstanceRef, ctx))
}

function withWorkspace<A, E, R>(workspaceID: WorkspaceV2.ID, effect: Effect.Effect<A, E, R>) {
  return effect.pipe(Effect.provideService(WorkspaceRef, workspaceID))
}

function withReload<A, E, R>(ctx: InstanceContext, use: (reload: ConfigReload.Interface) => Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const reload = yield* ConfigReload.Service
    return yield* withInstance(ctx, use(reload))
  })
}

function withWorkspaceReload<A, E, R>(
  ctx: InstanceContext,
  workspaceID: WorkspaceV2.ID,
  use: (reload: ConfigReload.Interface) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const reload = yield* ConfigReload.Service
    return yield* withInstance(ctx, withWorkspace(workspaceID, use(reload)))
  })
}

function testLayer(events: PublishedEvent[], reloads: ReloadCall[], resumeCalls: ResumeCall[]) {
  return ConfigReload.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(EventV2Bridge.Service)({
          publish: (definition, data) =>
            Effect.sync(() => {
              events.push({ type: definition.type, data })
              return {
                id: EventV2.ID.create(),
                type: definition.type,
                data,
              } as EventV2.Payload<typeof definition>
            }),
          subscribe: () => Stream.empty,
          all: () => Stream.empty,
          listen: () => Effect.succeed(Effect.void),
        }),
        Layer.mock(InstanceStore.Service)({
          reload: (input) =>
            Effect.sync(() => {
              reloads.push({ directory: input.directory, worktree: input.worktree })
              return instance(input.directory)
            }),
        }),
        Layer.mock(SessionPrompt.Service)({
          loop: (input) =>
            Effect.sync(() => {
              resumeCalls.push({ sessionID: input.sessionID })
            }),
        }),
      ),
    ),
  )
}

describe("ConfigReload", () => {
  const events: PublishedEvent[] = []
  const reloads: ReloadCall[] = []
  const resumeCalls: ResumeCall[] = []
  const it = testEffect(testLayer(events, reloads, resumeCalls))

  it.effect("starts reload in the current workspace even when another workspace is busy", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      const alpha = instance("/tmp/reload-alpha")
      const beta = instance("/tmp/reload-beta")

      yield* withReload(alpha, (reload) => reload.start("session-alpha"))
      const result = yield* withReload(beta, (reload) => reload.request())

      expect(result.immediate).toBe(true)
      expect(result.input.directory).toBe(beta.directory)
      expect(result.bootstrapCycle).toBe(1)
      expect(events.map((event) => event.type)).toEqual(["config.reload.pending", "config.reload.executing"])
      expect(yield* withReload(alpha, (reload) => reload.getBootstrapCycle())).toBe(0)
      expect(yield* withReload(beta, (reload) => reload.getBootstrapCycle())).toBe(1)
    }),
  )

  it.effect("keeps reload completion acknowledgements scoped to the current workspace", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      const alpha = instance("/tmp/reload-cycle-alpha")
      const beta = instance("/tmp/reload-cycle-beta")

      yield* withReload(alpha, (reload) => reload.request())
      yield* withReload(beta, (reload) => reload.request())

      expect(yield* withReload(alpha, (reload) => reload.getBootstrapCycle())).toBe(1)
      expect(yield* withReload(beta, (reload) => reload.getBootstrapCycle())).toBe(1)
      yield* withReload(alpha, (reload) => reload.releaseBlocker("tui-bootstrap"))
      expect(events.at(-1)?.type).toBe("config.reload.done")
      expect(yield* withReload(beta, (reload) => reload.getBootstrapCycle())).toBe(1)
    }),
  )

  it.effect("accepts bootstrap completion when the reconnect event omits workspace metadata", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      const ctx = instance("/tmp/reload-missing-workspace-metadata")
      const workspaceID = WorkspaceV2.ID.ascending("wrk_reload_missing_metadata")

      const result = yield* withWorkspaceReload(ctx, workspaceID, (reload) => reload.request())
      expect(result.bootstrapCycle).toBe(1)

      const accepted = yield* withReload(ctx, (reload) => reload.completeBootstrap(1))

      expect(accepted).toBe(true)
      expect(events.at(-1)).toEqual({ type: "config.reload.done", data: {} })
    }),
  )

  it.effect("does not announce reload completion while a newer reload is queued", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      const ctx = instance("/tmp/reload-coalesce")

      yield* withReload(ctx, (reload) => reload.request())
      yield* withReload(ctx, (reload) => reload.request())

      expect(events.map((event) => event.type)).toEqual([
        "config.reload.pending",
        "config.reload.executing",
        "config.reload.pending",
      ])
      yield* withReload(ctx, (reload) => reload.releaseBlocker("tui-bootstrap"))

      expect(reloads).toEqual([{ directory: ctx.directory, worktree: ctx.worktree }])
      expect(events.map((event) => event.type)).toEqual([
        "config.reload.pending",
        "config.reload.executing",
        "config.reload.pending",
        "config.reload.pending",
        "config.reload.executing",
      ])
      yield* withReload(ctx, (reload) => reload.releaseBlocker("tui-bootstrap"))
      expect(events.at(-1)?.type).toBe("config.reload.done")
      expect(events.filter((event) => event.type === "config.reload.done")).toHaveLength(1)
    }),
  )

  it.effect("queues reload safely while multiple sessions run in the same client", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      const ctx = instance("/tmp/reload-multiple-sessions")

      yield* withReload(ctx, (reload) => reload.start("session-a"))
      yield* withReload(ctx, (reload) => reload.start("session-b"))

      const first = yield* withReload(ctx, (reload) => reload.request())
      const second = yield* withReload(ctx, (reload) => reload.request())

      expect(first.immediate).toBe(false)
      expect(second.immediate).toBe(false)
      expect(reloads).toEqual([])
      expect(events.filter((event) => event.type === "config.reload.executing")).toEqual([])

      yield* withReload(ctx, (reload) => reload.finish("session-a"))

      expect(reloads).toEqual([])
      expect(events.filter((event) => event.type === "config.reload.done")).toEqual([])
      expect(yield* withReload(ctx, (reload) => reload.getBootstrapCycle())).toBe(0)

      yield* withReload(ctx, (reload) => reload.finish("session-b"))

      expect(reloads).toEqual([{ directory: ctx.directory, worktree: ctx.worktree }])
      expect(events.at(-1)?.type).toBe("config.reload.executing")
      expect(yield* withReload(ctx, (reload) => reload.getBootstrapCycle())).toBe(1)

      const queuedDuringBootstrap = yield* withReload(ctx, (reload) => reload.request())
      expect(queuedDuringBootstrap.immediate).toBe(false)

      yield* withReload(ctx, (reload) => reload.releaseBlocker("tui-bootstrap"))

      expect(reloads).toEqual([
        { directory: ctx.directory, worktree: ctx.worktree },
        { directory: ctx.directory, worktree: ctx.worktree },
      ])
      expect(events.filter((event) => event.type === "config.reload.done")).toEqual([])
      expect(yield* withReload(ctx, (reload) => reload.getBootstrapCycle())).toBe(2)

      yield* withReload(ctx, (reload) => reload.releaseBlocker("tui-bootstrap"))

      expect(events.filter((event) => event.type === "config.reload.done")).toEqual([
        { type: "config.reload.done", data: {} },
      ])
    }),
  )

  it.effect("tracks a new session that starts after reload is already queued", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      const ctx = instance("/tmp/reload-session-starts-after-queue")

      yield* withReload(ctx, (reload) => reload.start("session-before-reload"))
      const queued = yield* withReload(ctx, (reload) => reload.request())
      yield* withReload(ctx, (reload) => reload.start("session-after-reload"))

      expect(queued.immediate).toBe(false)
      expect(reloads).toEqual([])

      yield* withReload(ctx, (reload) => reload.finish("session-before-reload"))

      expect(reloads).toEqual([])
      expect(events.filter((event) => event.type === "config.reload.done")).toEqual([])
      expect(yield* withReload(ctx, (reload) => reload.getBootstrapCycle())).toBe(0)

      yield* withReload(ctx, (reload) => reload.finish("session-after-reload"))

      expect(reloads).toEqual([{ directory: ctx.directory, worktree: ctx.worktree }])
      expect(events.at(-1)?.type).toBe("config.reload.executing")
      expect(yield* withReload(ctx, (reload) => reload.getBootstrapCycle())).toBe(1)
    }),
  )

  it.effect("exposes reload status for clients that poll instead of listening to events", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      const ctx = instance("/tmp/reload-status")

      yield* withReload(ctx, (reload) => reload.start("session-before-reload"))
      const queued = yield* withReload(ctx, (reload) => reload.request())

      expect(queued.immediate).toBe(false)
      expect(queued.bootstrapCycle).toBeUndefined()
      expect(yield* withReload(ctx, (reload) => reload.status())).toEqual({
        pending: true,
        executing: false,
        bootstrapCycle: undefined,
      })

      yield* withReload(ctx, (reload) => reload.finish("session-before-reload"))

      expect(yield* withReload(ctx, (reload) => reload.status())).toEqual({
        pending: false,
        executing: true,
        bootstrapCycle: 1,
      })
    }),
  )

  it.effect("finishes reload without sending a synthetic continuation prompt", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      const ctx = instance("/tmp/reload-no-context-pollution")

      yield* withReload(ctx, (reload) => reload.request())
      yield* withReload(ctx, (reload) => reload.releaseBlocker("tui-bootstrap"))

      const done = events.find((event) => event.type === "config.reload.done")
      expect(done?.data).toEqual({})
    }),
  )

  it.effect("auto-resumes the session exactly once after immediate reload", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      resumeCalls.length = 0
      const ctx = instance("/tmp/reload-auto-resume-immediate")

      yield* withReload(ctx, (reload) => reload.request("session-resume-1"))
      yield* withReload(ctx, (reload) => reload.releaseBlocker("tui-bootstrap"))

      expect(reloads).toEqual([{ directory: ctx.directory, worktree: ctx.worktree }])
      expect(resumeCalls).toEqual([{ sessionID: "session-resume-1" }])
      expect(events.filter((event) => event.type === "config.reload.done")).toHaveLength(1)
    }),
  )

  it.effect("auto-resumes the session exactly once after deferred reload", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      resumeCalls.length = 0
      const ctx = instance("/tmp/reload-auto-resume-deferred")

      yield* withReload(ctx, (reload) => reload.start("session-active"))
      const result = yield* withReload(ctx, (reload) => reload.request("session-resume-2"))
      expect(result.immediate).toBe(false)
      expect(resumeCalls).toEqual([])

      yield* withReload(ctx, (reload) => reload.finish("session-active"))
      expect(reloads).toEqual([{ directory: ctx.directory, worktree: ctx.worktree }])
      expect(resumeCalls).toEqual([])

      yield* withReload(ctx, (reload) => reload.releaseBlocker("tui-bootstrap"))
      expect(resumeCalls).toEqual([{ sessionID: "session-resume-2" }])
      expect(events.filter((event) => event.type === "config.reload.done")).toHaveLength(1)
    }),
  )

  it.effect("does not auto-resume when no sessionID was provided", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      resumeCalls.length = 0
      const ctx = instance("/tmp/reload-no-resume")

      yield* withReload(ctx, (reload) => reload.request())
      yield* withReload(ctx, (reload) => reload.releaseBlocker("tui-bootstrap"))

      expect(reloads).toHaveLength(1)
      expect(resumeCalls).toEqual([])
    }),
  )
})
