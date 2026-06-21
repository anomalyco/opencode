import { describe, expect } from "bun:test"
import { ConfigReload } from "@/config/reload"
import { InstanceRef } from "@/effect/instance-ref"
import { EventV2Bridge } from "@/event-v2-bridge"
import type { InstanceContext } from "@/project/instance-context"
import { InstanceStore } from "@/project/instance-store"
import { EventV2 } from "@opencode-ai/core/event"
import { ProjectV2 } from "@opencode-ai/core/project"
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

function testLayer(events: PublishedEvent[], reloads: ReloadCall[]) {
  return Layer.mergeAll(
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
      yield* withInstance(alpha, ConfigReload.start("session-alpha"))
      const result = yield* withInstance(beta, ConfigReload.request())

      expect(result.immediate).toBe(true)
      expect(result.input.directory).toBe(beta.directory)
      expect(events.map((event) => event.type)).toEqual(["config.reload.pending", "config.reload.executing"])
      expect(yield* withInstance(alpha, ConfigReload.getBootstrapCycle())).toBe(0)
      expect(yield* withInstance(beta, ConfigReload.getBootstrapCycle())).toBe(1)
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
      yield* withInstance(alpha, ConfigReload.request())
      yield* withInstance(beta, ConfigReload.request())

      expect(yield* withInstance(alpha, ConfigReload.getBootstrapCycle())).toBe(1)
      expect(yield* withInstance(beta, ConfigReload.getBootstrapCycle())).toBe(1)
      yield* withInstance(alpha, ConfigReload.releaseBlocker("tui-bootstrap"))
      expect(events.at(-1)?.type).toBe("config.reload.done")
      expect(yield* withInstance(beta, ConfigReload.getBootstrapCycle())).toBe(1)
    }),
  )

  it.effect("does not announce reload completion while a newer reload is queued", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      const ctx = instance("/tmp/reload-coalesce")

      // User intent: hammering `/reload` during the reload overlay should not
      // briefly say the app is ready and then immediately tear it down again.
      yield* withInstance(ctx, ConfigReload.request())
      yield* withInstance(ctx, ConfigReload.request())

      expect(events.map((event) => event.type)).toEqual([
        "config.reload.pending",
        "config.reload.executing",
        "config.reload.pending",
      ])
      yield* withInstance(ctx, ConfigReload.releaseBlocker("tui-bootstrap"))

      expect(reloads).toEqual([{ directory: ctx.directory, worktree: ctx.worktree }])
      expect(events.map((event) => event.type)).toEqual([
        "config.reload.pending",
        "config.reload.executing",
        "config.reload.pending",
        "config.reload.pending",
        "config.reload.executing",
      ])
      yield* withInstance(ctx, ConfigReload.releaseBlocker("tui-bootstrap"))
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
      yield* withInstance(ctx, ConfigReload.start("session-a"))
      yield* withInstance(ctx, ConfigReload.start("session-b"))

      const first = yield* withInstance(ctx, ConfigReload.request())
      const second = yield* withInstance(ctx, ConfigReload.request())

      expect(first.immediate).toBe(false)
      expect(second.immediate).toBe(false)
      expect(reloads).toEqual([])
      expect(events.filter((event) => event.type === "config.reload.executing")).toEqual([])

      yield* withInstance(ctx, ConfigReload.finish("session-a"))

      expect(reloads).toEqual([])
      expect(events.filter((event) => event.type === "config.reload.done")).toEqual([])
      expect(yield* withInstance(ctx, ConfigReload.getBootstrapCycle())).toBe(0)

      yield* withInstance(ctx, ConfigReload.finish("session-b"))

      expect(reloads).toEqual([{ directory: ctx.directory, worktree: ctx.worktree }])
      expect(events.at(-1)?.type).toBe("config.reload.executing")
      expect(yield* withInstance(ctx, ConfigReload.getBootstrapCycle())).toBe(1)

      const queuedDuringBootstrap = yield* withInstance(ctx, ConfigReload.request())
      expect(queuedDuringBootstrap.immediate).toBe(false)

      yield* withInstance(ctx, ConfigReload.releaseBlocker("tui-bootstrap"))

      expect(reloads).toEqual([
        { directory: ctx.directory, worktree: ctx.worktree },
        { directory: ctx.directory, worktree: ctx.worktree },
      ])
      expect(events.filter((event) => event.type === "config.reload.done")).toEqual([])
      expect(yield* withInstance(ctx, ConfigReload.getBootstrapCycle())).toBe(2)

      yield* withInstance(ctx, ConfigReload.releaseBlocker("tui-bootstrap"))

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
      yield* withInstance(ctx, ConfigReload.start("session-before-reload"))
      const queued = yield* withInstance(ctx, ConfigReload.request())
      yield* withInstance(ctx, ConfigReload.start("session-after-reload"))

      expect(queued.immediate).toBe(false)
      expect(reloads).toEqual([])

      yield* withInstance(ctx, ConfigReload.finish("session-before-reload"))

      expect(reloads).toEqual([])
      expect(events.filter((event) => event.type === "config.reload.done")).toEqual([])
      expect(yield* withInstance(ctx, ConfigReload.getBootstrapCycle())).toBe(0)

      yield* withInstance(ctx, ConfigReload.finish("session-after-reload"))

      expect(reloads).toEqual([{ directory: ctx.directory, worktree: ctx.worktree }])
      expect(events.at(-1)?.type).toBe("config.reload.executing")
      expect(yield* withInstance(ctx, ConfigReload.getBootstrapCycle())).toBe(1)
    }),
  )

  it.effect("finishes reload without sending a synthetic continuation prompt", () =>
    Effect.gen(function* () {
      events.length = 0
      reloads.length = 0
      const ctx = instance("/tmp/reload-no-context-pollution")

      // User intent: reloading configuration must not create an artificial
      // user message like "continue where you left off" in session history.
      yield* withInstance(ctx, ConfigReload.request())
      yield* withInstance(ctx, ConfigReload.releaseBlocker("tui-bootstrap"))

      const done = events.find((event) => event.type === "config.reload.done")
      expect(done?.data).toEqual({})
    }),
  )
})
