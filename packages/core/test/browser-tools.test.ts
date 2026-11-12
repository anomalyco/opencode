import { expect } from "bun:test"
import { Context, Deferred, Effect, Schema, Stream } from "effect"
import { Browser } from "@opencode/plugin-browser/rpc"
import { Agent } from "@opencode/schema/agent"
import { SessionMessage } from "@opencode/schema/session-message"
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

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
const tab = {
  id: tabID,
  url: "https://example.test/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 1,
}

type Respond = (action: Browser.Action) => Browser.Outcome

const success = (value: typeof Schema.Json.Type): Browser.Outcome => ({ type: "success", result: { value, files: [] } })

/**
 * The browser plugin as the server runs it, driven through Code Mode with input repair and validation. `respond` plays
 * the desktop; `attach: false` leaves the session without one.
 */
const setup = (respond: Respond, options: { readonly attach?: boolean } = {}) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
    const locations = yield* LocationServiceMap.Service
    const context = yield* locations.contextEffect(ref).pipe(Effect.scoped)
    yield* Plugin.awaitActivation.pipe(Effect.provideContext(context))
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ location: ref })
    const rpc = Context.get(context, Rpc.Service).client(Browser.Definition)
    const tools = Context.get(context, Tool.Service)
    const attachment = { sessionID: session.id, connectionID: `conn_${crypto.randomUUID()}` }
    const ready = yield* Deferred.make<void>()
    const commands: Browser.Action[] = []
    yield* rpc.events.subscribe("control").pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.data.connectionID !== attachment.connectionID) return
          if (event.data.type === "attached") {
            yield* rpc.state({ ...attachment, state: { tabs: [tab], focusedTabID: tabID } })
            yield* Deferred.succeed(ready, undefined)
            return
          }
          if (event.data.type !== "command") return
          const request = { ...attachment, requestID: event.data.requestID }
          const command = yield* rpc.command(request)
          commands.push(command.action)
          yield* rpc.result({ ...request, outcome: respond(command.action) })
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    if (options.attach !== false) {
      yield* rpc.attach({ ...attachment, version: 4 }).pipe(Effect.forkScoped)
      yield* Deferred.await(ready).pipe(Effect.timeout("10 seconds"))
    }
    const run = Effect.fn("browser-tools.run")(function* (code: string) {
      const snapshot = yield* tools.snapshot()
      const result = yield* snapshot.execute({
        sessionID: session.id,
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_browser_tools"),
        call: { type: "tool-call", id: "call_browser_tools", name: "execute", input: { code } },
      })
      return (result.output as { readonly output: string }).output
    })
    return { directory: dir.path, commands, run }
  })

const evaluated = (value: typeof Schema.Json.Type) => success({ tab, value })

it.live("an unknown browser parameter fails with the valid parameters and sends nothing", () =>
  Effect.gen(function* () {
    const browser = yield* setup(() => evaluated("ran"))
    const output = yield* browser.run(
      `return await tools.browser.evaluate({ tabID: "${tabID}", script: "1", query: "x" }).catch((error) => error.message)`,
    )
    expect(output).toContain(
      "query: Not a parameter of browser.evaluate. Valid parameters: tabID, frameID, ref, script, expression, code.",
    )
    expect(
      yield* browser.run(
        `return await tools.browser.tabs.list({ tabID: "${tabID}" }).catch((error) => error.message)`,
      ),
    ).toContain("tabID: Not a parameter of browser.tabs.list. Valid parameters: none.")
    expect(browser.commands).toEqual([])
    expect(yield* browser.run(`return (await tools.browser.evaluate({ tabID: "${tabID}", script: "1" })).value`)).toBe(
      "ran",
    )
  }),
)

it.live("evaluate takes expression or code and runs a top-level return or await", () =>
  Effect.gen(function* () {
    const browser = yield* setup(() => evaluated("Example"))
    // The parameter shapes models wrote that failed with "script: Missing key".
    yield* browser.run(`return await tools.browser.evaluate({ tabID: "${tabID}", expression: "document.title" })`)
    yield* browser.run(`return await tools.browser.evaluate({ tabID: "${tabID}", code: "document.title" })`)
    yield* browser.run(`return await tools.browser.evaluate({ tabID: "${tabID}", script: "return document.title" })`)
    expect(browser.commands).toEqual([
      { type: "evaluate", tabID, script: "document.title" },
      { type: "evaluate", tabID, script: "document.title" },
      { type: "evaluate", tabID, script: "(async () => {\nreturn document.title\n})()" },
    ])
  }),
)
