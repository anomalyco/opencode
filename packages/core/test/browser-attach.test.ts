import { expect } from "bun:test"
import { Context, Effect, Fiber, Schedule, Stream } from "effect"
import { Browser } from "@opencode/plugin-browser/rpc"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, Session.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)

const user = { action: "bash", resource: "*", effect: "ask" } as const
const allows = [
  { action: "browser", resource: "*", effect: "allow" },
  { action: "skill", resource: "browser", effect: "allow" },
] as const

const until = <A, E>(effect: Effect.Effect<A, E>, check: (value: A) => boolean) =>
  effect.pipe(
    Effect.flatMap((value) => (check(value) ? Effect.succeed(value) : Effect.fail("pending" as const))),
    Effect.retry(Schedule.spaced("10 millis")),
    Effect.timeout("10 seconds"),
  )

const setup = Effect.gen(function* () {
  const dir = yield* tmpdirScoped()
  const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
  const locations = yield* LocationServiceMap.Service
  const context = yield* locations.contextEffect(ref).pipe(Effect.scoped)
  yield* Plugin.awaitActivation.pipe(Effect.provideContext(context))
  const sessions = yield* Session.Service
  const session = yield* sessions.create({ location: ref, permissions: [user] })
  const rpc = Context.get(context, Rpc.Service).client(Browser.Definition)
  const controls: Browser.Control[] = []
  yield* rpc.events.subscribe("control").pipe(
    Stream.runForEach((event) => Effect.sync(() => controls.push(event.data))),
    Effect.forkScoped({ startImmediately: true }),
  )
  return {
    ref,
    locations,
    rpc,
    attach: (connectionID: string) =>
      rpc.attach({ sessionID: session.id, connectionID, version: 4 }).pipe(Effect.forkScoped),
    attached: (connectionID: string) =>
      until(
        Effect.sync(() => controls),
        (all) => all.some((control) => control.type === "attached" && control.connectionID === connectionID),
      ),
    permissions: Effect.map(sessions.get(session.id), (info) => info.permissions ?? []),
  }
})

it.live("a replaced attachment keeps the browser allowed, and its detach revokes only the browser rules", () =>
  Effect.gen(function* () {
    const browser = yield* setup
    const first = yield* browser.attach("conn_1")
    yield* browser.attached("conn_1")
    expect(yield* browser.permissions).toEqual([user, ...allows])

    const second = yield* browser.attach("conn_2")
    expect(yield* Fiber.join(first)).toBe("replaced")
    yield* browser.attached("conn_2")
    expect(yield* browser.permissions).toEqual([user, ...allows])

    yield* Fiber.interrupt(second)
    yield* until(browser.permissions, (permissions) => permissions.length === 1)
    expect(yield* browser.permissions).toEqual([user])
  }),
)

it.live("disposing the plugin revokes the browser rules before the location finishes closing", () =>
  Effect.gen(function* () {
    const browser = yield* setup
    yield* browser.attach("conn_1")
    yield* browser.attached("conn_1")
    expect(yield* browser.permissions).toEqual([user, ...allows])

    yield* browser.locations.invalidate(browser.ref)
    expect(yield* browser.permissions).toEqual([user])
  }),
)
