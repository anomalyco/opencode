import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
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
