import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "../../src/permission"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { testEffect } from "../lib/effect"
import { SessionID } from "../../src/session/schema"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const env = AppNodeBuilder.build(
  LayerNode.group([Permission.node, EventV2Bridge.node, CrossSpawnSpawner.node, InstanceStore.node]),
  [[InstanceStore.bootstrapNode, noopBootstrap]],
)
const it = testEffect(env)

// Mirrors the success schema GET /permission declares, so these assert the
// encoding that actually fails in production rather than a proxy for it.
const encode = Schema.encodeUnknownResult(Schema.toCodecJson(Schema.Array(PermissionV1.Request)))

const waitForPending = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === count) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: "1 second",
        orElse: () => Effect.fail(new Error(`timed out waiting for ${count} pending permission request(s)`)),
      }),
    )
  })

const askAndEncode = (id: string, permission: string, metadata: Record<string, unknown>) =>
  Effect.gen(function* () {
    const service = yield* Permission.Service
    yield* service
      .ask({
        id: PermissionV1.ID.make(id),
        sessionID: SessionID.make("session_" + id),
        permission,
        patterns: ["**/*.txt"],
        metadata,
        always: ["*"],
        ruleset: [],
      })
      .pipe(Effect.forkScoped)
    yield* waitForPending(1)
    const pending = yield* service.list()
    const result = encode(pending)
    for (const request of pending) yield* service.reply({ requestID: request.id, reply: "reject" })
    return result
  })

it.instance(
  "pending permission with undefined optional metadata encodes",
  () =>
    Effect.gen(function* () {
      const result = yield* askAndEncode("per_flat", "glob", {
        pattern: "**/*.txt",
        path: undefined,
        limit: undefined,
      })
      expect(result._tag).toBe("Success")
    }),
  { git: true },
)

it.instance(
  "pending permission with undefined nested in metadata encodes",
  () =>
    Effect.gen(function* () {
      const result = yield* askAndEncode("per_nested", "edit", {
        filepath: "a.ts",
        diff: "Index: a.ts",
        files: [{ filePath: "a.ts", type: "update", patch: "Index: a.ts", movePath: undefined }],
      })
      expect(result._tag).toBe("Success")
    }),
  { git: true },
)

it.instance(
  "metadata that cannot encode for other reasons still fails",
  () =>
    Effect.gen(function* () {
      const result = yield* askAndEncode("per_hole", "glob", { pattern: "**/*.txt", matches: [1, undefined, 2] })
      expect(result._tag).toBe("Failure")
    }),
  { git: true },
)
