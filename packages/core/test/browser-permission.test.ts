import { expect } from "bun:test"
import path from "path"
import { Context, Deferred, Effect, Stream } from "effect"
import { Browser } from "@opencode/plugin-browser/rpc"
import { SessionMessage } from "@opencode/schema/session-message"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
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

const grant = [
  { action: "browser", resource: "*", effect: "allow" },
  { action: "skill", resource: "browser", effect: "allow" },
] as const

// A location with `config` as its opencode.json and one session, plus a stand-in desktop that attaches to a session
// and answers every browser command with an empty tab list.
const setup = (config: object) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    yield* Effect.promise(() => Bun.write(path.join(dir.path, "opencode.json"), JSON.stringify(config)))
    const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
    const locations = yield* LocationServiceMap.Service
    const context = yield* locations.contextEffect(ref).pipe(Effect.scoped)
    yield* Plugin.awaitActivation.pipe(Effect.provideContext(context))
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ location: ref })
    const rpc = Context.get(context, Rpc.Service).client(Browser.Definition)
    const connectionID = crypto.randomUUID()
    const attached = Deferred.makeUnsafe<void>()
    const commands = { count: 0 }
    yield* rpc.events.subscribe("control").pipe(
      Stream.runForEach((event) => {
        if (event.data.type === "attached" && event.data.connectionID === connectionID)
          return Deferred.succeed(attached, undefined)
        if (event.data.type !== "command" || event.data.connectionID !== connectionID) return Effect.void
        commands.count++
        return rpc.result({
          sessionID: session.id,
          connectionID,
          requestID: event.data.requestID,
          outcome: { type: "success", result: { value: { tabs: [], focusedTabID: null }, files: [] } },
        })
      }),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* rpc.attach({ sessionID: session.id, connectionID, version: 4 }).pipe(Effect.forkScoped)
    yield* Deferred.await(attached).pipe(Effect.timeout("10 seconds"))
    const list = (yield* Context.get(context, Tool.Service).list()).find(
      (tool) => tool.name === "list" && tool.options?.namespace === "browser.tabs",
    )
    if (!list) return yield* Effect.die(new Error("browser.tabs.list is not registered"))
    return {
      session,
      commands,
      permissions: Effect.map(sessions.get(session.id), (info) => info.permissions ?? []),
      // Runs browser.tabs.list as `agent` would, through the plugin's executor and the real permission service.
      call: (agent = "build") =>
        list.execute(
          {},
          {
            sessionID: session.id,
            agent: Agent.ID.make(agent),
            messageID: SessionMessage.ID.create(),
            id: Tool.CallID.make(`call_${crypto.randomUUID()}`),
            progress: () => Effect.void,
          },
        ),
    }
  })

it.live("without a deny, an attached session's browser calls run with no prompt", () =>
  Effect.gen(function* () {
    const browser = yield* setup({})
    expect(yield* browser.permissions).toEqual([...grant])
    expect((yield* browser.call()).output).toEqual({ tabs: [], focusedTabID: null })
    expect(browser.commands.count).toBe(1)
  }),
)

it.live("a browser deny in config refuses browser calls after the desktop attaches", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [{ action: "browser", resource: "*", effect: "deny" }] })
    // The attachment still writes its grant; the configured deny must win over it.
    expect(yield* browser.permissions).toEqual([...grant])
    expect((yield* browser.call().pipe(Effect.flip)).message).toStartWith("[browser.denied]")
    expect(browser.commands.count).toBe(0)
  }),
)

it.live("an agent that denies every tool stays denied after attach, while other agents keep the browser", () =>
  Effect.gen(function* () {
    const browser = yield* setup({
      agents: {
        reviewer: {
          mode: "subagent",
          permissions: [
            { action: "*", resource: "*", effect: "deny" },
            { action: "read", resource: "*", effect: "allow" },
          ],
        },
      },
    })
    expect((yield* browser.call("reviewer").pipe(Effect.flip)).message).toStartWith("[browser.denied]")
    expect((yield* browser.call("build")).output).toEqual({ tabs: [], focusedTabID: null })
    expect(browser.commands.count).toBe(1)
  }),
)

it.live("a tool.use policy refuses browser calls after the desktop attaches", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ policies: [{ action: "tool.use", resource: "browser:*", effect: "deny" }] })
    expect((yield* browser.call().pipe(Effect.flip)).message).toBe("Blocked by configuration policy")
    expect(browser.commands.count).toBe(0)
  }),
)
