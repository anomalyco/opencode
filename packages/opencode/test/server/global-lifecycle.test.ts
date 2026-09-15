import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Npm } from "@opencode-ai/core/npm"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { HttpClient } from "effect/unstable/http"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Account } from "@/account/account"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Env } from "@/env"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { reloadWhenSessionsIdle } from "@/server/global-lifecycle"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

let bootstrapRun: Effect.Effect<void> = Effect.void
const noopBootstrap = Layer.succeed(
  InstanceBootstrap.Service,
  InstanceBootstrap.Service.of({ run: Effect.suspend(() => bootstrapRun) }),
)

const setBootstrap = (run: Effect.Effect<void>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      bootstrapRun = run
    }),
    () =>
      Effect.sync(() => {
        bootstrapRun = Effect.void
      }),
  )
const unexpectedHttp = HttpClient.make((request) =>
  Effect.die(`unexpected http request: ${request.method} ${request.url}`),
)

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      InstanceStore.node,
      SessionStatus.node,
      Config.node,
      FSUtil.node,
      Env.node,
      CrossSpawnSpawner.node,
    ]),
    [
      [InstanceStore.bootstrapNode, noopBootstrap],
      [Auth.node, AuthTest.empty],
      [Account.node, AccountTest.empty],
      [Npm.node, NpmTest.noop],
      [httpClient, Layer.succeed(HttpClient.HttpClient, unexpectedHttp)],
    ],
  ),
)

const sessionID = SessionID.make("ses_global_lifecycle")

const collectGlobalDisposed = () =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const events: GlobalEvent[] = []
      const handler = (event: GlobalEvent) => {
        if (event.payload?.type === "global.disposed") events.push(event)
      }
      GlobalBus.on("event", handler)
      return { events, handler }
    }),
    ({ handler }) => Effect.sync(() => GlobalBus.off("event", handler)),
  ).pipe(Effect.map(({ events }) => events))

describe("reloadWhenSessionsIdle", () => {
  it.live("disposes instances and emits global.disposed when no session is busy", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const before = yield* store.load({ directory: dir })
      const disposed = yield* collectGlobalDisposed()

      yield* awaitWithTimeout(reloadWhenSessionsIdle(), "reload blocked while no session was busy")

      expect(disposed).toHaveLength(1)
      expect(yield* store.load({ directory: dir })).not.toBe(before)
    }),
  )

  it.live("defers disposal until the busy session goes idle", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const status = yield* SessionStatus.Service
      const ctx = yield* store.load({ directory: dir })
      const disposed = yield* collectGlobalDisposed()
      yield* status.set(sessionID, { type: "busy" }).pipe(Effect.provideService(InstanceRef, ctx))

      const reload = yield* reloadWhenSessionsIdle().pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Effect.sleep("600 millis")
      expect(disposed).toHaveLength(0)
      expect(yield* store.load({ directory: dir })).toBe(ctx)

      yield* status.set(sessionID, { type: "idle" }).pipe(Effect.provideService(InstanceRef, ctx))
      yield* awaitWithTimeout(Fiber.join(reload), "reload did not run after the session went idle")

      expect(disposed).toHaveLength(1)
      expect(yield* store.load({ directory: dir })).not.toBe(ctx)
    }),
  )

  it.live("waits for a session on an instance that loaded while another was still booting", () =>
    Effect.gen(function* () {
      const slow = yield* tmpdirScoped({ git: true })
      const fast = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const status = yield* SessionStatus.Service
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* setBootstrap(
        Effect.gen(function* () {
          if ((yield* InstanceRef)?.directory !== slow) return
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
        }),
      )
      const disposed = yield* collectGlobalDisposed()

      yield* store.load({ directory: slow }).pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Deferred.await(started)
      const reload = yield* reloadWhenSessionsIdle().pipe(Effect.forkScoped({ startImmediately: true }))
      const ctx = yield* store.load({ directory: fast })
      yield* status.set(sessionID, { type: "busy" }).pipe(Effect.provideService(InstanceRef, ctx))
      yield* Deferred.succeed(release, undefined)

      yield* Effect.sleep("600 millis")
      expect(disposed).toHaveLength(0)
      expect(yield* store.load({ directory: fast })).toBe(ctx)

      yield* status.set(sessionID, { type: "idle" }).pipe(Effect.provideService(InstanceRef, ctx))
      yield* awaitWithTimeout(Fiber.join(reload), "reload did not run after the session went idle")

      expect(disposed).toHaveLength(1)
      expect(yield* store.load({ directory: fast })).not.toBe(ctx)
    }),
  )
})
