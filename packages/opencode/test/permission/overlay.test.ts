import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "../../src/permission"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { TestInstance } from "../fixture/fixture"
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

const SESSION = SessionID.make("session_overlay")
const OTHER = SessionID.make("session_overlay_other")
const ALLOW_ALL: PermissionV1.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

const overlay = (sessionID: SessionID, enabled: boolean) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.overlay({ sessionID, enabled })
  })

const ask = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

const request = (
  overrides: Partial<PermissionV1.AskInput> & { permission: string },
): Parameters<Permission.Interface["ask"]>[0] => ({
  sessionID: SESSION,
  patterns: ["anything"],
  metadata: {},
  always: [],
  ruleset: ALLOW_ALL,
  ...overrides,
})

/** Asserts the request stays pending, then clears it so the fiber can finish. */
const expectPending = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const fiber = yield* ask(input).pipe(Effect.forkScoped)
    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length > 0) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: "1 second",
        orElse: () =>
          Effect.fail(new Error(`expected ${input.permission} to prompt under the overlay, but it resolved`)),
      }),
    )
    expect(pending).toHaveLength(1)
    expect(pending[0].permission).toBe(input.permission)
    yield* permission.reply({ requestID: pending[0].id, reply: "reject" })
    yield* Fiber.await(fiber)
  })

/** Asserts the request resolves without ever entering the pending map. */
const expectAllowed = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const result = yield* ask(input).pipe(
      Effect.timeoutOrElse({
        duration: "1 second",
        orElse: () => Effect.fail(new Error(`expected ${input.permission} to stay allowed, but it prompted`)),
      }),
    )
    expect(result).toBeUndefined()
    expect(yield* permission.list()).toHaveLength(0)
  })

/** Asserts the request is refused outright rather than turned into a prompt. */
const expectDenied = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const exit = yield* ask(input).pipe(
      Effect.timeoutOrElse({
        duration: "1 second",
        orElse: () => Effect.fail(new Error(`expected ${input.permission} to stay denied, but it prompted`)),
      }),
      Effect.exit,
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.DeniedError)
    expect(yield* permission.list()).toHaveLength(0)
  })

const OVERLAID = ["bash", "edit", "task", "webfetch", "websearch", "external_directory", "skill"] as const
const UNTOUCHED = ["read", "glob", "grep", "list", "lsp"] as const

it.instance(
  "overlay - upgrades allow to ask for every consequential permission",
  () =>
    Effect.gen(function* () {
      yield* overlay(SESSION, true)
      for (const permission of OVERLAID) {
        yield* expectPending(request({ permission }))
      }
    }),
  { git: true },
)

it.instance(
  "overlay - leaves read-only permissions allowed",
  () =>
    Effect.gen(function* () {
      yield* overlay(SESSION, true)
      for (const permission of UNTOUCHED) {
        yield* expectAllowed(request({ permission }))
      }
    }),
  { git: true },
)

it.instance(
  "overlay - preserves deny",
  () =>
    Effect.gen(function* () {
      const ruleset = Permission.fromConfig({ "*": "allow", bash: { "*": "allow", "rm -rf *": "deny" } })
      yield* overlay(SESSION, true)
      yield* expectDenied(request({ permission: "bash", patterns: ["rm -rf /"], ruleset }))
    }),
  { git: true },
)

it.instance(
  "overlay - preserves deny even when an allowed pattern comes first",
  () =>
    Effect.gen(function* () {
      const ruleset = Permission.fromConfig({ "*": "allow", bash: { "*": "allow", "rm -rf *": "deny" } })
      yield* overlay(SESSION, true)
      yield* expectDenied(request({ permission: "bash", patterns: ["git status", "rm -rf /"], ruleset }))
    }),
  { git: true },
)

it.instance(
  "overlay - leaves an existing ask as an ask",
  () =>
    Effect.gen(function* () {
      yield* overlay(SESSION, true)
      yield* expectPending(
        request({ permission: "bash", ruleset: [{ permission: "bash", pattern: "*", action: "ask" }] }),
      )
    }),
  { git: true },
)

it.instance(
  "overlay - respects an explicit always grant instead of re-classifying it",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      yield* overlay(SESSION, true)

      const fiber = yield* ask(
        request({ id: PermissionV1.ID.make("per_overlay_always"), permission: "bash", patterns: ["ls"], always: ["ls"] }),
      ).pipe(Effect.forkScoped)
      yield* Effect.gen(function* () {
        while (true) {
          if ((yield* permission.list()).length > 0) return
          yield* Effect.sleep("10 millis")
        }
      }).pipe(Effect.timeout("5 seconds"))
      yield* permission.reply({ requestID: PermissionV1.ID.make("per_overlay_always"), reply: "always" })
      yield* Fiber.join(fiber)

      // The grant is the user's own decision for this exact pattern, so the overlay leaves it alone.
      yield* expectAllowed(request({ permission: "bash", patterns: ["ls"] }))
      // Anything the user did not grant is still escalated.
      yield* expectPending(request({ permission: "bash", patterns: ["rm file"] }))
    }),
  { git: true },
)

it.instance(
  "overlay - disabling restores the prior behavior exactly",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      yield* expectAllowed(request({ permission: "bash" }))

      expect(yield* overlay(SESSION, true)).toBe(true)
      yield* expectPending(request({ permission: "bash" }))

      expect(yield* overlay(SESSION, false)).toBe(false)
      expect(yield* permission.overlays()).toEqual([])
      yield* expectAllowed(request({ permission: "bash" }))
    }),
  { git: true },
)

it.instance(
  "overlay - applies only to the session it was enabled for",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      yield* overlay(SESSION, true)
      expect(yield* permission.overlays()).toEqual([SESSION])

      yield* expectPending(request({ permission: "bash", sessionID: SESSION }))
      yield* expectAllowed(request({ permission: "bash", sessionID: OTHER }))
    }),
  { git: true },
)

it.instance(
  "overlay - enabling twice is idempotent and disabling an unknown session is a no-op",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      expect(yield* overlay(SESSION, true)).toBe(true)
      expect(yield* overlay(SESSION, true)).toBe(true)
      expect(yield* permission.overlays()).toEqual([SESSION])
      expect(yield* overlay(OTHER, false)).toBe(false)
      expect(yield* permission.overlays()).toEqual([SESSION])
    }),
  { git: true },
)

it.instance(
  "overlay - does not survive an instance reload",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const store = yield* InstanceStore.Service
      const permission = yield* Permission.Service
      yield* overlay(SESSION, true)
      expect(yield* permission.overlays()).toEqual([SESSION])

      yield* store.reload({ directory: test.directory })

      expect(yield* permission.overlays()).toEqual([])
      yield* expectAllowed(request({ permission: "bash" }))
    }),
  { git: true },
)
