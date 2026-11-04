import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/schema/schema"
import type { Session } from "@opencode/schema/session"
import { Browser } from "@opencode/plugin-browser/rpc"
import { Effect, Fiber, Stream } from "effect"
import { BrowserConnection } from "../../../plugin-browser/src/connection"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const access = [
  { action: "browser", resource: "*", effect: "allow" },
  { action: "skill", resource: "browser", effect: "allow" },
] as const
const setup = Effect.fn(function* () {
  const plugins = yield* Plugin.Service
  const host = yield* PluginHost.make(plugins, "test")
  const service = yield* Rpc.Service
  return { host, rpc: service.client(Browser.Definition) }
})
const attach = Effect.fn(function* (rpc: Effect.Success<ReturnType<typeof setup>>["rpc"], sessionID: Session.ID) {
  const connectionID = crypto.randomUUID()
  const attached = yield* rpc.events.subscribe("control").pipe(
    Stream.filter((event) => event.data.type === "attached" && event.data.connectionID === connectionID),
    Stream.take(1),
    Stream.runDrain,
    Effect.forkScoped({ startImmediately: true }),
  )
  const pending = yield* rpc.attach({ sessionID, connectionID, version: 4 }).pipe(Effect.forkScoped)
  yield* Fiber.join(attached)
  return pending
})

it.live("starting another location leaves a live browser attachment's grants intact", () =>
  Effect.gen(function* () {
    const { host, rpc } = yield* setup()
    const connection = yield* BrowserConnection.make(host)
    const session = yield* host.session.create({})
    const pending = yield* attach(rpc, session.id)
    const directory = AbsolutePath.make(`${host.location.directory}/other`)
    const stale = yield* host.session.create({ location: { directory }, permissions: access })
    yield* BrowserConnection.make({ ...host, location: { ...host.location, directory } })
    expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual(access)
    expect((yield* host.session.get({ sessionID: stale.id })).permissions).toEqual([])
    yield* connection.target(session.id, { type: "tabs.list" })
    yield* Fiber.interrupt(pending)
  }),
)

it.live("a replaced attachment preserves its replacement's grants and ordered user permissions", () =>
  Effect.gen(function* () {
    const { host, rpc } = yield* setup()
    yield* BrowserConnection.make(host)
    const baseline = [
      ...access,
      { action: "browser", resource: "*", effect: "deny" },
      { action: "skill", resource: "browser", effect: "deny" },
      { action: "edit", resource: "*", effect: "ask" },
    ] as const
    const session = yield* host.session.create({ permissions: baseline })
    const first = yield* attach(rpc, session.id)
    const replacement = yield* attach(rpc, session.id)
    expect(yield* Fiber.join(first)).toBe("replaced")
    expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual([...baseline, ...access])
    yield* Fiber.interrupt(replacement)
    expect((yield* host.session.get({ sessionID: session.id })).permissions).toEqual(baseline)
  }),
)
