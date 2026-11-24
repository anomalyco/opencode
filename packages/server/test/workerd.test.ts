import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment, makeFiles, makeMemoryDriver } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { Identity } from "@opencode/core/machine/identity"
import { AbsolutePath } from "@opencode/core/schema"
import { Workspace } from "@opencode/core/workspace"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { Npm } from "@opencode/util/npm"
import { makeDurableObjectStorage } from "../../core/test/fixture/durable-object-storage"
import { location } from "../../core/test/fixture/location"
import { it } from "../../core/test/lib/effect"
import { ServerWorkerd } from "../src/workerd"

// Covers the profile's replacement graph composing and the database booting
// through the injected Durable Object storage.
it.live("boots the workerd profile over durable object storage", () =>
  Effect.gen(function* () {
    const handler = yield* ServerWorkerd.create({
      storage: makeDurableObjectStorage(),
      password: "secret",
      app: { version: "workerd-test" },
      config: { content: "{}" },
    })

    const unauthorized = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/info")))
    expect(unauthorized.status).toBe(401)

    const status = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/info", {
          headers: { authorization: `Basic ${btoa("opencode:secret")}` },
        }),
      ),
    )
    expect(status.status).toBe(200)

    const body: unknown = yield* Effect.promise(() => status.json())
    expect(body).toMatchObject({ version: "workerd-test" })

    // alarm() runs cleanly as a no-op when no workspaces are pending suspension.
    yield* Effect.promise(() => handler.alarm())
  }),
)

it.effect("fails Npm.add with a clear workerd error instead of running the installer", () =>
  Effect.gen(function* () {
    const npm = yield* Npm.Service
    const error = yield* npm.add("some-package").pipe(Effect.flip)
    expect(error).toBeInstanceOf(Npm.InstallFailedError)
    expect(String(error.cause)).toContain("Npm.add is unavailable in the workerd profile")
  }).pipe(
    Effect.provide(AppNodeBuilder.build(Npm.node, ServerWorkerd.replacements({ storage: makeDurableObjectStorage() }))),
  ),
)

it.effect("marks the workerd environment non-local and omits rg", () =>
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    expect(environment.id).toBe(Environment.localID)
    expect(environment.local).toBe(false)
    expect(environment.rg).toBeUndefined()
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(Environment.node, [
        ...ServerWorkerd.replacements({ storage: makeDurableObjectStorage() }),
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/") }))),
        ),
      ]),
    ),
  ),
)

it.effect("persists machine Identity in Durable Object KV storage without filesystem access", () =>
  Effect.gen(function* () {
    const storage = makeDurableObjectStorage()
    const layer = AppNodeBuilder.build(Identity.node, ServerWorkerd.replacements({ storage }))
    const first = yield* Effect.flatMap(Identity.Service, (id) => id.publicKey()).pipe(Effect.provide(layer))
    expect(first.length).toBe(32)

    const restarted = AppNodeBuilder.build(Identity.node, ServerWorkerd.replacements({ storage }))
    const second = yield* Effect.flatMap(Identity.Service, (id) => id.publicKey()).pipe(Effect.provide(restarted))
    expect(second).toEqual(first)
  }),
)

it.effect("closes workerd workspace connections immediately and suspends idle workspaces via DO storage alarm", () =>
  Effect.gen(function* () {
    const storage = makeDurableObjectStorage()
    const suspended: Workspace.ID[] = []
    const memory = makeMemoryDriver()
    const fakeDriver = WorkspaceDriver.make({
      create: (input) => Effect.succeed({ binding: { workspaceID: input.workspaceID } }),
      connect: () => Effect.succeed(memory),
      suspendForIdle: (input) => Effect.sync(() => void suspended.push(input.workspaceID)),
      destroy: () => Effect.void,
    })
    const layer = AppNodeBuilder.build(Workspace.node, [
      ...ServerWorkerd.replacements({ storage }),
      ServerWorkerd.alarmWorkspaceReplacement(storage),
      WorkspaceDriver.node.replace(WorkspaceDriver.registryNode({ fake: fakeDriver })),
    ])

    const workspaceID = yield* Workspace.Service.use((workspace) =>
      Effect.gen(function* () {
        const id = yield* workspace.attach({ provider: "fake", binding: { host: "sandbox" } })
        yield* makeFiles(yield* workspace.connect(id)).mkdir("/workerd-workspace")
        expect(yield* workspace.connected(id)).toBe(false)
        return id
      }),
    ).pipe(Effect.provide(layer))

    expect(yield* Effect.promise(() => storage.getAlarm())).toBe(20 * 60 * 1000)

    // After eviction, a fresh instance's suspendIdle (driven by DO alarm()) suspends the workspace.
    yield* TestClock.adjust("20 minutes")
    const result = yield* Workspace.Service.use((workspace) => workspace.suspendIdle()).pipe(Effect.provide(layer))
    expect(result).toEqual([workspaceID])
    expect(suspended).toEqual([workspaceID])
  }),
)
