import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin/index"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { SessionID } from "../../src/session/schema"

import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))

// Plugin and Permission have to come out of a single graph. Building them from
// two `AppNodeBuilder.build` calls yields two Permission services, and the
// reviewer the plugin layer registers lands on the one the test never drives.
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Plugin.node, Permission.node, EventV2Bridge.node, CrossSpawnSpawner.node, InstanceStore.node]),
    [
      [Auth.node, AuthTest.empty],
      [Account.node, AccountTest.empty],
      [Npm.node, NpmTest.noop],
      [InstanceStore.bootstrapNode, noopBootstrap],
      [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
    ],
  ),
)

function withProject<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    const file = path.join(test.directory, "plugin.ts")
    yield* Effect.all(
      [
        Effect.promise(() => Bun.write(file, source)),
        Effect.promise(() =>
          Bun.write(
            path.join(test.directory, "opencode.json"),
            JSON.stringify(
              {
                $schema: "https://opencode.ai/config.json",
                plugin: [pathToFileURL(file).href],
              },
              null,
              2,
            ),
          ),
        ),
      ],
      { discard: true, concurrency: 2 },
    )
    return yield* self
  })
}

const hookPlugin = (body: string) =>
  [
    "export default async () => ({",
    '  "permission.ask": async (_input, output) => {',
    `    ${body}`,
    "  },",
    "})",
    "",
  ].join("\n")

const rejectAll = (message?: string) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (const req of yield* permission.list()) {
      yield* permission.reply({
        requestID: req.id,
        reply: "reject",
        message,
      })
    }
  })

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
        duration: "5 seconds",
        orElse: () => Effect.fail(new Error(`timed out waiting for ${count} pending permission request(s)`)),
      }),
    )
  })

const fail = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* self.pipe(Effect.exit)
    if (Exit.isFailure(exit)) return Cause.squash(exit.cause)
    throw new Error("expected permission effect to fail")
  })

const ask = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

const request = (ruleset: PermissionV1.Ruleset): Parameters<Permission.Interface["ask"]>[0] => ({
  sessionID: SessionID.make("session_test"),
  permission: "bash",
  patterns: ["ls"],
  metadata: {},
  always: [],
  ruleset,
})

describe("plugin permission.ask", () => {
  it.instance(
    "hook allows a request the rules would ask about",
    () =>
      withProject(
        hookPlugin('output.status = "allow"'),
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          expect(yield* ask(request([{ permission: "bash", pattern: "*", action: "ask" }]))).toBeUndefined()
          expect(yield* permission.list()).toHaveLength(0)
        }),
      ),
    { git: true },
  )

  it.instance(
    "hook asks about a request the rules would allow",
    () =>
      withProject(
        hookPlugin('output.status = "ask"'),
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const fiber = yield* ask(request([{ permission: "bash", pattern: "*", action: "allow" }])).pipe(
            Effect.forkScoped,
          )

          const items = yield* waitForPending(1)
          expect(items[0]).toMatchObject({ permission: "bash", patterns: ["ls"] })

          yield* permission.reply({ requestID: items[0].id, reply: "once" })
          yield* Fiber.join(fiber)
          expect(yield* permission.list()).toHaveLength(0)
        }),
      ),
    { git: true },
  )

  it.instance(
    "hook denies a request the rules would allow",
    () =>
      withProject(
        hookPlugin('output.status = "deny"\n    output.message = "blocked by plugin"'),
        Effect.gen(function* () {
          const err = yield* fail(ask(request([{ permission: "bash", pattern: "*", action: "allow" }])))
          expect(err).toBeInstanceOf(PermissionV1.DeniedError)
          expect((err as PermissionV1.DeniedError).message).toBe("blocked by plugin")
        }),
      ),
    { git: true },
  )

  it.instance(
    "unrecognised status keeps the rule decision",
    () =>
      withProject(
        hookPlugin('output.status = "denied"'),
        Effect.gen(function* () {
          const fiber = yield* ask(request([{ permission: "bash", pattern: "*", action: "ask" }])).pipe(
            Effect.forkScoped,
          )

          expect(yield* waitForPending(1)).toHaveLength(1)
          yield* rejectAll()
          yield* Fiber.await(fiber)
        }),
      ),
    { git: true },
  )

  it.instance(
    "hook that throws leaves an allowed request allowed",
    () =>
      withProject(
        hookPlugin('throw new Error("hook exploded")'),
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          expect(yield* ask(request([{ permission: "bash", pattern: "*", action: "allow" }]))).toBeUndefined()
          expect(yield* permission.list()).toHaveLength(0)
        }),
      ),
    { git: true },
  )

  it.instance(
    "hook that throws still asks when the rules ask",
    () =>
      withProject(
        hookPlugin('throw new Error("hook exploded")'),
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const fiber = yield* ask(request([{ permission: "bash", pattern: "*", action: "ask" }])).pipe(
            Effect.forkScoped,
          )

          const items = yield* waitForPending(1)
          expect(items[0]).toMatchObject({ permission: "bash", patterns: ["ls"] })

          yield* permission.reply({ requestID: items[0].id, reply: "once" })
          yield* Fiber.join(fiber)
          expect(yield* permission.list()).toHaveLength(0)
        }),
      ),
    { git: true },
  )

  it.instance(
    "hook that allows and then throws keeps the rule decision",
    () =>
      withProject(
        hookPlugin('output.status = "allow"\n    throw new Error("hook exploded")'),
        Effect.gen(function* () {
          const fiber = yield* ask(request([{ permission: "bash", pattern: "*", action: "ask" }])).pipe(
            Effect.forkScoped,
          )

          const items = yield* waitForPending(1)
          expect(items[0]).toMatchObject({ permission: "bash", patterns: ["ls"] })

          yield* rejectAll()
          const exit = yield* Fiber.await(fiber)
          expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.RejectedError)
        }),
      ),
    { git: true },
  )
})
