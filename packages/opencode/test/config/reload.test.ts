import { describe, expect } from "bun:test"
import { ConfigReload } from "@/config/reload"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { EventV2Bridge } from "@/event-v2-bridge"
import type { InstanceContext } from "@/project/instance-context"
import { InstanceStore } from "@/project/instance-store"
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

function testLayer(events: PublishedEvent[], reloads: ReloadCall[]) {
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
      ),
    ),
  )
}

describe("ConfigReload", () => {
  const events: PublishedEvent[] = []
  const reloads: ReloadCall[] = []
  const it = testEffect(testLayer(events, reloads))

  it.effect("starts reload in the current workspace even when another workspace is busy", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      const alpha = instance("/tmp/reload-alpha")
      const beta = instance("/tmp/reload-beta")

      // User intent: a long-running chat in one project must not make `/reload`
      // appear queued or stuck in an unrelated TUI window.
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

      // User intent: a late bootstrap acknowledgement from one TUI must not
      // dismiss the reload overlay or unblock reload state in another TUI.
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

      // User intent: the TUI may reconnect after reload through a lifecycle event
      // that does not include workspace metadata. A valid bootstrap completion for
      // the same project and cycle must still release the visible reload overlay.
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

      // User intent: hammering `/reload` during the reload overlay should not
      // briefly say the app is ready and then immediately tear it down again.
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

      // User intent: one TUI can have several sessions running at once. `/reload`
      // should wait for every active session, remain queued when only one settles,
      // coalesce repeated reload requests, avoid an early "ready" signal during
      // bootstrap, and finish without creating a synthetic continuation prompt.
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

      // User intent: after `/reload` says it is queued, starting another chat in
      // the same TUI must extend the wait. The reload must not begin just because
      // the session that was active at queue time finished.
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

      // User intent: a non-TUI client that cannot rely on the event stream still
      // needs a way to learn when a queued reload starts and which cycle to ack.
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

      // User intent: reloading configuration must not create an artificial
      // user message like "continue where you left off" in session history.
      yield* withReload(ctx, (reload) => reload.request())
      yield* withReload(ctx, (reload) => reload.releaseBlocker("tui-bootstrap"))

      const done = events.find((event) => event.type === "config.reload.done")
      expect(done?.data).toEqual({})
    }),
  )
})
