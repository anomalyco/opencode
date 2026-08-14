import { describe, expect } from "bun:test"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import type { InstanceContext } from "@/project/instance-context"
import { InstanceStore } from "@/project/instance-store"
import { InstanceEviction } from "@/server/instance-eviction"
import { SessionRunState } from "@/session/run-state"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { PtyActivity } from "@opencode-ai/core/pty/activity"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Effect, Exit, Layer, Logger, Scope } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { it as base, testEffect } from "../lib/effect"

const ctx: InstanceContext = {
  directory: "/tmp/instance-eviction-test",
  worktree: "/tmp/instance-eviction-test",
  project: {
    id: ProjectV2.ID.global,
    worktree: "/tmp/instance-eviction-test",
    time: { created: 0, updated: 0 },
    sandboxes: [],
  },
}
const ptyIdentity = PtyActivity.identify(ctx.directory)

const activity = (input?: {
  runner?: boolean
  status?: SessionStatus.Info
  job?: BackgroundJob.Status
}): InstanceEviction.ActivityServices => ({
  runners: {
    isActive: () => Effect.succeed(input?.runner ?? false),
    assertNotBusy: () => Effect.void,
    cancel: () => Effect.void,
    ensureRunning: (_sessionID, _onInterrupt, work) => work,
    startShell: (_sessionID, _onInterrupt, work) => work,
  },
  statuses: {
    get: () => Effect.succeed(input?.status ?? { type: "idle" }),
    list: () =>
      Effect.succeed(
        input?.status
          ? new Map([[SessionID.make("ses_test"), input.status]])
          : new Map<SessionID, SessionStatus.Info>(),
      ),
    set: () => Effect.void,
  },
  background: {
    list: () =>
      Effect.succeed(
        input?.job
          ? [
              {
                id: "job_test",
                type: "test",
                status: input.job,
                started_at: 0,
              },
            ]
          : [],
      ),
    get: () => Effect.die("unused"),
    start: () => Effect.die("unused"),
    extend: () => Effect.die("unused"),
    wait: () => Effect.die("unused"),
    waitForPromotion: () => Effect.die("unused"),
    promote: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
})

describe("InstanceEviction activity", () => {
  base.effect("allows an inactive instance", () =>
    Effect.gen(function* () {
      expect(yield* InstanceEviction.canDispose(ctx, activity())).toBe(true)
    }),
  )

  base.effect("blocks active runners", () =>
    Effect.gen(function* () {
      expect(yield* InstanceEviction.canDispose(ctx, activity({ runner: true }))).toBe(false)
    }),
  )

  base.effect("blocks non-idle session status", () =>
    Effect.gen(function* () {
      expect(yield* InstanceEviction.canDispose(ctx, activity({ status: { type: "busy" } }))).toBe(false)
    }),
  )

  base.effect("blocks running background jobs only", () =>
    Effect.gen(function* () {
      expect(yield* InstanceEviction.canDispose(ctx, activity({ job: "running" }))).toBe(false)
      expect(yield* InstanceEviction.canDispose(ctx, activity({ job: "completed" }))).toBe(true)
    }),
  )

  base.effect("blocks detached PTYs until every process exits", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        PtyActivity.started(ptyIdentity)
        PtyActivity.started(ptyIdentity)
      }),
      () =>
        Effect.gen(function* () {
          expect(yield* InstanceEviction.canDispose(ctx, activity())).toBe(false)
          PtyActivity.stopped(ptyIdentity)
          expect(yield* InstanceEviction.canDispose(ctx, activity())).toBe(false)
          PtyActivity.stopped(ptyIdentity)
          expect(yield* InstanceEviction.canDispose(ctx, activity())).toBe(true)
        }),
      () =>
        Effect.sync(() => {
          PtyActivity.stopped(ptyIdentity)
          PtyActivity.stopped(ptyIdentity)
        }),
    ),
  )
})

describe("InstanceEviction schedule", () => {
  let sweeps = 0
  const store: InstanceStore.Interface = {
    load: () => Effect.die("unused"),
    reload: () => Effect.die("unused"),
    dispose: () => Effect.die("unused"),
    disposeDirectory: () => Effect.die("unused"),
    disposeAll: () => Effect.die("unused"),
    sweepIdle: () =>
      Effect.sync(() => {
        sweeps++
        return 0
      }),
    provide: (_input, effect) => effect,
  }
  const services = activity()
  const it = testEffect(
    Layer.mergeAll(
      RuntimeFlags.layer({ instanceIdleTimeoutMs: 3_600_000 }),
      Layer.succeed(InstanceStore.Service, store),
      Layer.succeed(SessionRunState.Service, services.runners),
      Layer.succeed(SessionStatus.Service, services.statuses),
      Layer.succeed(BackgroundJob.Service, services.background),
    ),
  )

  const disabled = testEffect(
    Layer.mergeAll(
      RuntimeFlags.layer({ instanceIdleTimeoutMs: undefined }),
      Layer.succeed(InstanceStore.Service, store),
      Layer.succeed(SessionRunState.Service, services.runners),
      Layer.succeed(SessionStatus.Service, services.statuses),
      Layer.succeed(BackgroundJob.Service, services.background),
    ),
  )

  const warning = "ignoring OPENCODE_EXPERIMENTAL_INSTANCE_IDLE_TIMEOUT_MS: expected an integer of at least 3600000 ms"
  const invalid = testEffect(
    Layer.mergeAll(
      RuntimeFlags.layer({ instanceIdleTimeoutMs: undefined, instanceIdleTimeoutWarning: warning }),
      Layer.succeed(InstanceStore.Service, store),
      Layer.succeed(SessionRunState.Service, services.runners),
      Layer.succeed(SessionStatus.Service, services.statuses),
      Layer.succeed(BackgroundJob.Service, services.background),
    ),
  )

  invalid.effect("warns when an invalid timeout disables eviction", () => {
    const messages: Array<unknown> = []
    const logger = Logger.make((options) => messages.push(options.message))
    return Layer.build(InstanceEviction.layer).pipe(
      Effect.provide(Logger.layer([logger])),
      Effect.tap(() => Effect.sync(() => expect(JSON.stringify(messages)).toContain(warning))),
    )
  })

  disabled.effect("does not sweep when the timeout is unset", () =>
    Effect.gen(function* () {
      sweeps = 0
      yield* Layer.build(InstanceEviction.layer)
      yield* TestClock.adjust("5 minutes")
      yield* Effect.yieldNow
      expect(sweeps).toBe(0)
    }),
  )

  it.effect("stops sweeping when its scope closes", () =>
    Effect.gen(function* () {
      sweeps = 0
      const scope = yield* Scope.make()
      yield* Layer.buildWithScope(InstanceEviction.layer, scope)
      yield* Effect.yieldNow
      expect(sweeps).toBe(1)

      yield* TestClock.adjust(InstanceEviction.SWEEP_INTERVAL)
      yield* Effect.yieldNow
      expect(sweeps).toBe(2)

      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust("5 minutes")
      yield* Effect.yieldNow
      expect(sweeps).toBe(2)
    }),
  )
})
