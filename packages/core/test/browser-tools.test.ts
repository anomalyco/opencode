import { expect } from "bun:test"
import { join } from "node:path"
import { mkdir, rm, stat, symlink } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Context, Deferred, Effect, Schedule, Schema, Stream } from "effect"
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

// Undefined leaves the command unanswered, as a page stuck in a long task does.
type Respond = (action: Browser.Action) => typeof Browser.Outcome.Encoded | undefined

const success = (value: typeof Schema.Json.Type): typeof Browser.Outcome.Encoded => ({
  type: "success",
  result: { value, files: [] },
})

/**
 * The browser plugin as the server runs it, driven through Code Mode with input repair and validation. `respond` plays
 * the desktop; `attach: false` leaves the session without one.
 */
const setup = (respond: Respond, options: { readonly attach?: boolean; readonly linked?: boolean } = {}) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const directory = options.linked ? yield* Effect.promise(async () => {
      await mkdir(join(dir.path, "physical", "Project"), {recursive:true})
      await symlink(join(dir.path, "physical"), join(dir.path, "alias"), process.platform === "win32" ? "junction" : "dir")
      const alternate = join(dir.path, "ALIAS", "pRoJeCt")
      return await stat(alternate).then(() => alternate, () => join(dir.path, "alias", "Project"))
    }) : dir.path
    const ref = Location.Ref.make({ directory: AbsolutePath.make(directory) })
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
    const cancelled: string[] = []
    yield* rpc.events.subscribe("control").pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.data.connectionID !== attachment.connectionID) return
          if (event.data.type === "attached") {
            yield* rpc.state({ ...attachment, state: { tabs: [tab], focusedTabID: tabID } })
            yield* Deferred.succeed(ready, undefined)
            return
          }
          if (event.data.type === "cancel") {
            cancelled.push(event.data.requestID)
            return
          }
          const request = { ...attachment, requestID: event.data.requestID }
          const command = yield* rpc.command(request)
          commands.push(command.action)
          const outcome = respond(command.action)
          if (outcome) yield* rpc.result({ ...request, outcome })
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
    return { directory, session, commands, cancelled, run }
  })

const evaluated = (value: typeof Schema.Json.Type) => success({ tab, value })

it.live("an unknown parameter fails with the valid ones; evaluate takes expression or code, return and await", () =>
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
    browser.commands.length = 0

    // The parameter shapes models wrote that failed with "script: Missing key".
    yield* browser.run(`return await tools.browser.evaluate({ tabID: "${tabID}", expression: "document.title" })`)
    yield* browser.run(`return await tools.browser.evaluate({ tabID: "${tabID}", code: "document.title" })`)
    yield* browser.run(`return await tools.browser.evaluate({ tabID: "${tabID}", script: "return document.title" })`)
    yield* browser.run(`return await tools.browser.evaluate({ tabID: "${tabID}", script: "await fetch('/x')" })`)
    expect(browser.commands).toEqual([
      { type: "evaluate", tabID, script: "document.title" },
      { type: "evaluate", tabID, script: "document.title" },
      { type: "evaluate", tabID, script: "(async () => {\nreturn document.title\n})()" },
      { type: "evaluate", tabID, script: "(async () => (\nawait fetch('/x')\n))()" },
    ])
  }),
)

const failure = (message: string, code = "operation_failed"): typeof Browser.Outcome.Encoded => ({
  type: "failure",
  code,
  message,
})
const waited = (code: string) => `return await tools.browser.wait({ tabID: "${tabID}", ${code} })`

it.live("wait infers its condition and reports an unmet one as met: false", () =>
  Effect.gen(function* () {
    const browser = yield* setup((action) =>
      action.type === "wait" && action.text === "Never"
        ? // What the desktop sends when its wait times out: the server reads the code, not the words.
          failure("browser.wait failed. The text never appeared.", Browser.FailureCode.unmet)
        : action.type === "wait" && action.text === "Broken"
          ? // Before, the server read "Condition was not met within N ms" in any message as a timeout.
            failure(
              "browser.wait failed. Frame context is unavailable. Details: Condition was not met within 10000 ms.",
            )
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
      if (action.type === "wait" && action.condition === "url" && action.url === "**/done")
        return failure("Unmet URL wait", Browser.FailureCode.unmet)
      if (action.type !== "evaluate") return success(tab)
      seen.checks++
      return evaluated(seen.checks < 2 ? { count: 0, visible: 0 } : { count: 1, visible: 1 })
    })
    expect(JSON.parse(yield* browser.run(waited(`delayMs: 20`)))).toMatchObject({ ...tab, met: true, waited: "delay" })
    expect(JSON.parse(yield* browser.run(waited(`time: 0.02`)))).toMatchObject({ met: true, waited: "delay" })
    // A lone timeout is a pause for that long, not a load wait that returns at once on a loaded page.
    expect(JSON.parse(yield* browser.run(waited(`timeout: 50`)))).toMatchObject({ met: true, waited: "delay" })
    expect(browser.commands).toEqual([20,20,50].map(timeoutMs => ({type:"wait",tabID,condition:"delay",timeoutMs})))
    browser.commands.length = 0
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

it.live("an element wait reads the desktop's codes, and ends on time when the page does not answer", () =>
  Effect.gen(function* () {
    const seen = { checks: 0 }
    const browser = yield* setup((action) => {
      if (action.type !== "evaluate") return success(tab)
      if (action.ref) return failure("Element ref is stale.", Browser.FailureCode.staleRef)
      if (action.script.includes("#busy")) return undefined
      seen.checks++
      return seen.checks === 1
        ? failure("The document changed before this operation ran.", Browser.FailureCode.documentChanged)
        : evaluated({ count: 1, visible: 1 })
    })
    // A navigation between checks is not an answer: the wait checks again.
    expect(JSON.parse(yield* browser.run(waited(`selector: "#ready", timeout: 5000`)))).toMatchObject({ met: true })
    expect(seen.checks).toBe(2)
    // A ref whose element left the page is gone.
    expect(JSON.parse(yield* browser.run(waited(`ref: "e1", state: "hidden"`)))).toMatchObject({
      met: true,
      waited: "elementGone",
    })
    // A page stuck in a long task answers no probe; the wait ends at its timeout instead of the request's 60 s.
    expect(JSON.parse(yield* browser.run(waited(`selector: "#busy", timeout: 300`)))).toMatchObject({
      met: false,
      observed: "The page was still navigating, or too busy to answer, after 300 ms.",
    })
    // The unanswered probe is cancelled on the desktop.
    yield* Effect.suspend(() => (browser.cancelled.length ? Effect.void : Effect.fail("not cancelled yet"))).pipe(
      Effect.retry(Schedule.spaced("10 millis")),
      Effect.timeout("5 seconds"),
    )
  }),
)

it.live("a workspace file opens through tabs.open and navigate, by path or by the address tabs.list shows", () =>
  Effect.gen(function* () {
    const url = "workspace://ses_fixture/page.html"
    const shown = { ...tab, url }
    const browser = yield* setup((action) => {
      if (action.type === "preview" && action.path === "page.html") return success({ path: action.path, tabID, url, tab: shown })
      // A desktop from before the path forms returns the tab's ID and address only, or no tab at all.
      if (action.type === "preview" && action.path === "state.html") return success({ path: action.path, tabID, url })
      if (action.type === "preview" && action.path === "gone.html") return failure("browser.preview failed. The workspace file could not be loaded.", "preview_unavailable")
      if (action.type === "preview") return success({ path: action.path })
      if (action.type === "navigate.path" && action.path === "second.html") return success({ path: action.path, tabID: action.tabID, url, tab: shown })
      // What a desktop answers to an action it cannot decode.
      if (action.type === "navigate.path") return failure("This desktop cannot decode the requested browser operation. Check the desktop and server versions.", "unsupported")
      return success(tab)
    }, { linked: true })
    yield* Effect.promise(() => Promise.all(["page.html", "state.html", "gone.html", "older.html", "second.html", "old.html"].map(path => Bun.write(join(browser.directory, path), "<!doctype html>"))))
    yield* Effect.promise(() => Bun.write(join(browser.directory, "chart.svg"), "<svg/>"))
    const open = (input: object) => browser.run(`return await tools.browser.tabs.open(${JSON.stringify(input)}).catch(error => error.message)`)
    const move = (input: object) => browser.run(`return await tools.browser.navigate(${JSON.stringify({ tabID, ...input })}).catch(error => error.message)`)

    // The result is the tab, as for a web address, with the file it shows. The path is the entry that was checked.
    expect(JSON.parse(yield* open({ path: "page.html#L2" }))).toEqual({ ...shown, path: "page.html" })
    for (const address of [pathToFileURL(join(browser.directory, "page.html")).href, `workspace://${browser.session.id.toLowerCase()}/page.html`]) {
      expect(JSON.parse(yield* open({ url: address }))).toEqual({ ...shown, path: "page.html" })
      expect(JSON.parse(yield* open({ path: address }))).toEqual({ ...shown, path: "page.html" })
    }
    expect(JSON.parse(yield* open({ path: "state.html" }))).toEqual({ ...tab, path: "state.html" })
    expect(yield* open({ path: "older.html" })).toContain("did not return its tab")
    // The desktop names the action it received; the agent reads the name of the tool it called.
    expect(yield* open({ path: "gone.html" })).toContain("[browser.preview_unavailable] browser.tabs.open failed. The workspace file could not be loaded.")
    expect(browser.commands.map((command) => ("path" in command ? `${command.type} ${command.path}` : command.type))).toEqual([...Array.from({ length: 5 }, () => "preview page.html"), "preview state.html", "preview older.html", "preview gone.html"])
    browser.commands.length = 0

    expect(JSON.parse(yield* move({ path: "second.html" }))).toEqual({ ...shown, path: "second.html" })
    expect(JSON.parse(yield* move({ url: pathToFileURL(join(browser.directory, "second.html")).href }))).toEqual({ ...shown, path: "second.html" })
    expect(yield* move({ path: "old.html" })).toBe("[browser.unsupported] This desktop is older than the server and cannot move a tab to a workspace file. Update the desktop app, or call browser.tabs.open({ path }) to open the file in its own tab.")
    expect(browser.commands).toEqual([{ type: "navigate.path", tabID, path: "second.html" }, { type: "navigate.path", tabID, path: "second.html" }, { type: "navigate.path", tabID, path: "old.html" }])
    browser.commands.length = 0

    // A file that is not HTML has no tab: tabs.open sends it to the file panel, and navigate has no tab to move to it.
    expect(JSON.parse(yield* open({ path: "chart.svg" }))).toEqual({ path: "chart.svg", shown: "file" })
    expect(yield* move({ path: "chart.svg" })).toBe("browser.navigate moves a tab to an HTML file, and chart.svg is not one. Call browser.tabs.open({ path }) to show it in the file panel.")
    expect(browser.commands).toEqual([{ type: "preview", path: "chart.svg" }])
    browser.commands.length = 0

    // A file named only `.html` has a name and no extension: the desktop shows it in the file panel, so it has no tab.
    yield* Effect.promise(() => Bun.write(join(browser.directory, ".html"), "plain"))
    expect(JSON.parse(yield* open({ path: ".html" }))).toEqual({ path: ".html", shown: "file" })
    expect(yield* move({ path: ".html" })).toBe("browser.navigate moves a tab to an HTML file, and .html is not one. Call browser.tabs.open({ path }) to show it in the file panel.")
    expect(browser.commands).toEqual([{ type: "preview", path: ".html" }])

    // No tool has the old name. The call fails with what to call instead, not with a guessed tool.
    expect(yield* browser.run(`return await tools.browser.preview({ path: "page.html" }).catch(error => error.message)`)).toBe(
      "browser.preview was removed: call browser.tabs.open({ path }) to show a workspace file, or browser.navigate({ tabID, path }) to move a tab to one.",
    )
    expect(yield* browser.run(`return search({ query: "preview", namespace: "browser" }).items.map(item => item.path)`)).not.toContain("tools.browser.preview")
  }),
)

it.live("both path forms refuse what is not a file inside the workspace, before the desktop hears of it", () =>
  Effect.gen(function* () {
    const browser = yield* setup(() => success(tab))
    const outside = join(browser.directory, "..", `outside-${crypto.randomUUID()}`)
    yield* Effect.promise(async () => {
      await mkdir(join(browser.directory, "site"), { recursive: true })
      await mkdir(outside, { recursive: true })
      await Bun.write(join(outside, "secret.html"), "<!doctype html>")
      await symlink(outside, join(browser.directory, "escape"), process.platform === "win32" ? "junction" : "dir")
    })
    yield* Effect.addFinalizer(() => Effect.promise(() => rm(outside, { recursive: true, force: true })))
    const beyond = "cannot show a file outside this session's workspace. Choose a file inside the workspace."
    const refusals: ReadonlyArray<readonly [name: string, input: object, refusal: (call: string) => string]> = [
      ["a missing file", { path: "missing.html" }, (call) => `${call} found no file at ${join(browser.directory, "missing.html")}.`],
      ["a folder", { path: "site" }, (call) => `${join(browser.directory, "site")} is a folder. ${call} shows one file`],
      ["a parent folder", { path: "../secret.html" }, (call) => `${call} ${beyond}`],
      ["an absolute path elsewhere", { path: join(outside, "secret.html") }, (call) => `${call} ${beyond}`],
      ["a link that leaves the workspace", { path: "escape/secret.html" }, (call) => `${call} ${beyond}`],
      ["a file: address elsewhere, as path", { path: pathToFileURL(join(outside, "secret.html")).href }, (call) => `${call} ${beyond}`],
      ["a file: address elsewhere, as url", { url: pathToFileURL(join(outside, "secret.html")).href }, (call) => `${call} ${beyond}`],
      ["a file: address on another host", { url: "file://fileserver/share/page.html" }, (call) => `${call} ${beyond}`],
      ["another session's workspace address", { url: "workspace://ses_another/page.html" }, (call) => `${call} ${beyond}`],
      ["a workspace address with an encoded separator", { path: `workspace://${browser.session.id.toLowerCase()}/site%2f..%2f..%2fsecret.html` }, (call) => `${call} ${beyond}`],
      ["a name the server cannot hold", { path: "site/\u0001.html" }, () => "This path is not a valid workspace filename on the server."],
      ["the internal address of a file's tab", { url: "oc-preview://grant/page.html" }, () => "This is an internal address of a workspace file, which no call can open."],
      ["a web address as path", { path: "https://example.com/page.html" }, (call) => `${call} needs path to name a workspace file`],
      ["both parameters", { url: "https://example.com", path: "page.html" }, (call) => `${call} takes url or path, not both.`],
    ]
    for (const [name, input, refusal] of refusals) {
      const opened = yield* browser.run(`return await tools.browser.tabs.open(${JSON.stringify(input)}).then(() => "opened", error => error.message)`)
      const moved = yield* browser.run(`return await tools.browser.navigate(${JSON.stringify({ tabID, ...input })}).then(() => "moved", error => error.message)`)
      expect(`${name}: ${opened}`).toContain(`${name}: ${refusal("browser.tabs.open")}`)
      expect(`${name}: ${moved}`).toContain(`${name}: ${refusal("browser.navigate")}`)
    }
    expect(browser.commands).toEqual([])
  }),
)

it.live("an unattached inventory stays iterable and actions do not report success", () =>
  Effect.gen(function* () {
    const detached = yield* setup(() => success(tab), { attach: false })
    yield* Effect.promise(() => Bun.write(join(detached.directory, "chart.svg"), "<svg/>"))
    expect(JSON.parse(yield* detached.run(`const s = await tools.browser.tabs.list({}); return { ...s, tabs: s.tabs.map(t => t.id) }`))).toMatchObject({ connected: false, tabs: [], focusedTabID: null })
    expect(yield* detached.run(`try { await tools.browser.click({ tabID: "${tabID}", ref: "e1" }); return "Done" } catch (error) { return error.message }`)).toStartWith("[browser.not_attached]")
  }),
)
