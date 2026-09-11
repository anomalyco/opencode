import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { InstanceRef } from "../../src/effect/instance-ref"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { awaitSessionsIdle } from "../../src/server/global-lifecycle"
import { tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))

const it = testEffect(
  LayerNode.compile(LayerNode.group([InstanceStore.node, SessionStatus.node, CrossSpawnSpawner.node]), [
    [InstanceStore.bootstrapNode, noopBootstrap],
  ]),
)

const sessionID = SessionID.make("ses_global_lifecycle")

describe("awaitSessionsIdle", () => {
  it.live("resolves when no instance has a busy session", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      yield* store.load({ directory: dir })

      yield* awaitWithTimeout(awaitSessionsIdle(), "awaitSessionsIdle blocked while idle")
    }),
  )

  it.live("waits for a busy session to go idle", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const ctx = yield* store.load({ directory: dir })
      const status = yield* SessionStatus.Service

      yield* status.set(sessionID, { type: "busy" }).pipe(Effect.provideService(InstanceRef, ctx))

      const blocked = yield* awaitSessionsIdle().pipe(
        Effect.as(false),
        Effect.timeoutOrElse({ duration: "500 millis", orElse: () => Effect.succeed(true) }),
      )
      expect(blocked).toBe(true)

      yield* status.set(sessionID, { type: "idle" }).pipe(Effect.provideService(InstanceRef, ctx))
      yield* awaitWithTimeout(awaitSessionsIdle(), "awaitSessionsIdle did not resolve after the session went idle")
    }),
  )
})
