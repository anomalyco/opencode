import { expect } from "bun:test"
import { join } from "node:path"
import { Context, Deferred, Effect, Schema, Stream } from "effect"
import { Browser } from "@opencode/plugin-browser/rpc"
import { Agent } from "@opencode/schema/agent"
import { SessionMessage } from "@opencode/schema/session-message"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Watcher } from "@opencode/core/filesystem/watcher"
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
    // The browser never reads the watcher; a live one subscribes to the OS for every Location these tests boot.
    Watcher.node.replace(Watcher.configured({ enabled: false })),
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

type Respond = (action: Browser.Action) => typeof Browser.Outcome.Encoded

const success = (value: typeof Schema.Json.Type): typeof Browser.Outcome.Encoded => ({
  type: "success",
  result: { value, files: [] },
})

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
      yield* browser.run(`return await tools.browser.tabs.list({ tabID: "${tabID}" }).catch((error) => error.message)`),
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

const failure = (message: string): typeof Browser.Outcome.Encoded => ({
  type: "failure",
  code: "operation_failed",
  message,
})
const waited = (code: string) => `return await tools.browser.wait({ tabID: "${tabID}", ${code} })`

it.live("wait infers its condition and reports an unmet one as met: false", () =>
  Effect.gen(function* () {
    const browser = yield* setup((action) =>
      action.type === "wait" && action.text === "Never"
        ? // The message the desktop sends when its wait times out.
          failure(
            `browser.wait failed. browser.wait failed for condition "text" (timeoutMs: ${action.timeoutMs}). Inspect browser.snapshot({tabID}) and check text/frameID before retrying; timeoutMs can be increased up to 30000 for a genuinely slow page. Details: Condition was not met within ${action.timeoutMs} ms.`,
          )
        : action.type === "wait" && action.text === "Broken"
          ? failure("browser.wait failed. Frame context is unavailable. Call browser.frames({tabID}).")
          : success(tab),
    )
    // The most common failing shape: text with timeout, no condition.
    expect(JSON.parse(yield* browser.run(waited(`text: "Done", timeout: 1000`)))).toMatchObject({
      ...tab,
      met: true,
      waited: "text",
    })
    expect(JSON.parse(yield* browser.run(waited(`text: "Never", timeout: 60000`)))).toMatchObject({
      ...tab,
      met: false,
      waited: "text",
      observed: 'Text "Never" did not appear within 30000 ms.',
    })
    expect(JSON.parse(yield* browser.run(waited(`text: "Spinner", state: "hidden"`)))).toMatchObject({
      met: true,
      waited: "textGone",
    })
    expect(JSON.parse(yield* browser.run(waited(`state: "load"`)))).toMatchObject({ met: true, waited: "load" })
    expect(browser.commands).toEqual([
      { type: "wait", tabID, condition: "text", text: "Done", timeoutMs: 1000 },
      { type: "wait", tabID, condition: "text", text: "Never", timeoutMs: 30000 },
      { type: "wait", tabID, condition: "textGone", text: "Spinner", timeoutMs: 10000 },
      { type: "wait", tabID, condition: "load", timeoutMs: 10000 },
    ])
    // Other failures still fail.
    expect(
      yield* browser.run(
        `return await tools.browser.wait({ tabID: "${tabID}", text: "Broken" }).then(() => "resolved", (error) => error.message)`,
      ),
    ).toContain("Frame context is unavailable")
    // Keys no condition maps to fail with the valid ones.
    expect(
      yield* browser.run(
        `return await tools.browser.wait({ tabID: "${tabID}", loading: true }).catch((error) => error.message)`,
      ),
    ).toContain(
      "loading: Not a parameter of browser.wait. Valid parameters: tabID, frameID, condition, text, textGone, selector, ref, state, url, delayMs, time, ms, timeoutMs, timeout.",
    )
  }),
)

it.live("wait pauses, and polls for an element or an address", () =>
  Effect.gen(function* () {
    const seen = { checks: 0 }
    const browser = yield* setup((action) => {
      if (action.type !== "evaluate") return success(tab)
      seen.checks++
      return evaluated(seen.checks < 2 ? { count: 0, visible: 0 } : { count: 1, visible: 1 })
    })
    expect(JSON.parse(yield* browser.run(waited(`delayMs: 20`)))).toMatchObject({ ...tab, met: true, waited: "delay" })
    expect(JSON.parse(yield* browser.run(waited(`time: 0.02`)))).toMatchObject({ met: true, waited: "delay" })
    // A lone timeout is a pause for that long, not a load wait that returns at once on a loaded page.
    expect(JSON.parse(yield* browser.run(waited(`timeout: 50`)))).toMatchObject({ met: true, waited: "delay" })
    expect(browser.commands).toEqual([])
    expect(JSON.parse(yield* browser.run(`return await tools.browser.wait({ tabID: "${tabID}" })`))).toMatchObject({
      met: true,
      waited: "load",
    })
    expect(browser.commands).toEqual([{ type: "wait", tabID, condition: "load", timeoutMs: 10000 }])
    browser.commands.length = 0

    expect(JSON.parse(yield* browser.run(waited(`selector: "#ready", timeout: 5000`)))).toMatchObject({
      met: true,
      waited: "element",
    })
    expect(browser.commands).toHaveLength(2)
    expect(browser.commands[0]).toMatchObject({ type: "evaluate", tabID })
    expect(JSON.parse(yield* browser.run(waited(`selector: "#ready", state: "hidden", timeout: 150`)))).toMatchObject({
      met: false,
      observed: '1 element(s) matched "#ready", 1 visible, after 150 ms.',
    })

    expect(JSON.parse(yield* browser.run(waited(`url: "example.test"`)))).toMatchObject({ met: true })
    expect(JSON.parse(yield* browser.run(waited(`url: "**/done", timeout: 150`)))).toMatchObject({
      met: false,
      observed: "The address was https://example.test/ after 150 ms.",
    })
  }),
)

it.live("preview fails for a missing file, and without a desktop names the file to tell the user", () =>
  Effect.gen(function* () {
    const browser = yield* setup((action) => success(action.type === "preview" ? { path: action.path } : tab))
    yield* Effect.promise(() => Bun.write(join(browser.directory, "chart.svg"), "<svg/>"))
    expect(JSON.parse(yield* browser.run(`return await tools.browser.preview({ path: "chart.svg" })`))).toEqual({
      path: "chart.svg",
    })
    expect(
      yield* browser.run(`return await tools.browser.preview({ path: "chart.png" }).catch((error) => error.message)`),
    ).toContain(`browser.preview found no file at ${join(browser.directory, "chart.png")}.`)
    expect(browser.commands).toEqual([{ type: "preview", path: "chart.svg" }])

    const detached = yield* setup(() => success(tab), { attach: false })
    yield* Effect.promise(() => Bun.write(join(detached.directory, "chart.svg"), "<svg/>"))
    expect(
      yield* detached.run(`return await tools.browser.preview({ path: "chart.svg" }).catch((error) => error.message)`),
    ).toContain(
      `[browser.disconnected] ${join(detached.directory, "chart.svg")} was not shown: no OpenCode desktop app is connected to this session`,
    )
  }),
)
