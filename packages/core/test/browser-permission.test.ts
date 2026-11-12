import { expect, test } from "bun:test"
import { hostname } from "os"
import path from "path"
import { Context, Deferred, Effect, Fiber, Schedule, Stream } from "effect"
import { Browser } from "@opencode/plugin-browser/rpc"
import { SessionMessage } from "@opencode/schema/session-message"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { Wildcard } from "@opencode/core/util/wildcard"
import { BrowserConnection } from "../../plugin-browser/src/connection"
import { BrowserMachine } from "../../plugin-browser/src/machine"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, KV.node, Session.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)

const grant = [
  { action: "browser", resource: "*", effect: "allow" },
  { action: "skill", resource: "browser", effect: "allow" },
] as const

const tab = {
  id: Browser.TabID.make(`tab_${crypto.randomUUID()}`),
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 1,
}

// A location with `config` as its opencode.json and one session, plus a stand-in desktop that attaches to that
// session and answers every browser command with an empty tab list.
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
    const attachments = new Map<string, { sessionID: Session.ID; attached: Deferred.Deferred<void> }>()
    const commands = { count: 0 }
    yield* rpc.events.subscribe("control").pipe(
      Stream.runForEach((event) => {
        const attachment = attachments.get(event.data.connectionID)
        if (!attachment) return Effect.void
        if (event.data.type === "attached") return Deferred.succeed(attachment.attached, undefined)
        if (event.data.type !== "command") return Effect.void
        commands.count++
        return rpc.result({
          sessionID: attachment.sessionID,
          connectionID: event.data.connectionID,
          requestID: event.data.requestID,
          outcome: { type: "success", result: { value: { tabs: [], focusedTabID: null }, files: [] } },
        })
      }),
      Effect.forkScoped({ startImmediately: true }),
    )
    const attach = Effect.fnUntraced(function* (sessionID: Session.ID) {
      const connectionID = crypto.randomUUID()
      const attached = Deferred.makeUnsafe<void>()
      attachments.set(connectionID, { sessionID, attached })
      yield* rpc.attach({ sessionID, connectionID, version: 4 }).pipe(Effect.forkScoped)
      yield* Deferred.await(attached).pipe(Effect.timeout("10 seconds"))
      // One open tab, so operations that target a tab get past tab selection to the permission check.
      yield* rpc.state({ sessionID, connectionID, state: { tabs: [tab], focusedTabID: tab.id } })
    })
    yield* attach(session.id)
    const tools = yield* Context.get(context, Tool.Service).list()
    // Runs browser.<operation> as `agent` would, through the plugin's executor and the real permission service.
    const run = (operation: string, input: object, agent = "build", sessionID = session.id) => {
      const separator = operation.lastIndexOf(".")
      const namespace = separator < 0 ? "browser" : `browser.${operation.slice(0, separator)}`
      const tool = tools.find(
        (tool) => tool.name === operation.slice(separator + 1) && tool.options?.namespace === namespace,
      )
      if (!tool) return Effect.die(new Error(`browser.${operation} is not registered`))
      return tool.execute(input, {
        sessionID,
        agent: Agent.ID.make(agent),
        messageID: SessionMessage.ID.create(),
        id: Tool.CallID.make(`call_${crypto.randomUUID()}`),
        progress: () => Effect.void,
      })
    }
    return {
      context,
      ref,
      session,
      commands,
      attach,
      run,
      permissions: (sessionID = session.id) => Effect.map(sessions.get(sessionID), (info) => info.permissions ?? []),
      call: (agent = "build", sessionID = session.id) => run("tabs.list", {}, agent, sessionID),
    }
  })

it.live("without a deny, an attached session's browser calls run with no prompt", () =>
  Effect.gen(function* () {
    const browser = yield* setup({})
    expect(yield* browser.permissions()).toEqual([...grant])
    expect((yield* browser.call()).output).toEqual({ tabs: [], focusedTabID: null })
    expect(browser.commands.count).toBe(1)
  }),
)

it.live("a browser deny in config refuses browser calls after the desktop attaches", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [{ action: "browser", resource: "*", effect: "deny" }] })
    // The attachment still writes its grant; the configured deny must win over it.
    expect(yield* browser.permissions()).toEqual([...grant])
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

it.live("a subagent's session loses the inherited grant before its first prompt is admitted", () =>
  Effect.gen(function* () {
    const browser = yield* setup({})
    const sessions = yield* Session.Service
    const child = yield* sessions.create({ parentID: browser.session.id, agent: Agent.ID.make("general") })
    expect(yield* browser.permissions(child.id)).toEqual([...grant])

    yield* sessions.prompt({ sessionID: child.id, text: "Take a screenshot", resume: false })
    expect(yield* browser.permissions(child.id)).toEqual([])
    expect(yield* browser.permissions()).toEqual([...grant])
    expect((yield* browser.call("general", child.id).pipe(Effect.flip)).message).toStartWith("[browser.disconnected]")
    expect((yield* browser.call()).output).toEqual({ tabs: [], focusedTabID: null })
  }),
)

it.live("a subagent whose agent denies the browser stays denied, even with a browser attached to it", () =>
  Effect.gen(function* () {
    const browser = yield* setup({
      agents: { reviewer: { mode: "subagent", permissions: [{ action: "browser", resource: "*", effect: "deny" }] } },
    })
    const sessions = yield* Session.Service
    const child = yield* sessions.create({ parentID: browser.session.id, agent: Agent.ID.make("reviewer") })
    yield* sessions.prompt({ sessionID: child.id, text: "Review the page", resume: false })
    // Viewing the child in the desktop attaches it, which grants it the browser again.
    yield* browser.attach(child.id)
    // The child's own attachment owns that grant, so a later prompt keeps it.
    yield* sessions.prompt({ sessionID: child.id, text: "Check again", resume: false })
    expect(yield* browser.permissions(child.id)).toEqual([...grant])
    expect((yield* browser.call("reviewer", child.id).pipe(Effect.flip)).message).toStartWith("[browser.denied]")
    expect(browser.commands.count).toBe(0)
  }),
)

// No process has this ID: it is odd, so not a Windows process ID, and above Linux's and macOS's limits.
const exited = 4_194_305
const owner = (directory: string, pid: number, host = hostname()) => ({ host, pid, location: { directory } })

it.live("startup revokes a grant whose server no longer runs", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
    const storage = PluginHost.storage(yield* KV.Service, "opencode.browser")
    const sessionID = Session.ID.create()
    // What a server killed while attached leaves behind: the grant and the record of the process that wrote it.
    yield* storage.set(`grant:${sessionID}`, owner(ref.directory, exited))
    const sessions = yield* Session.Service
    yield* sessions.create({ id: sessionID, location: ref, permissions: [...grant] })
    const locations = yield* LocationServiceMap.Service
    yield* Plugin.awaitActivation.pipe(Effect.provideContext(yield* locations.contextEffect(ref).pipe(Effect.scoped)))

    expect((yield* sessions.get(sessionID)).permissions).toEqual([])
    expect(yield* storage.get(`grant:${sessionID}`)).toBeUndefined()
  }),
)

it.live("another server's startup leaves a live attachment's grant in place", () =>
  Effect.gen(function* () {
    const browser = yield* setup({})
    const sessions = yield* Session.Service
    const storage = PluginHost.storage(yield* KV.Service, "opencode.browser")
    const stale = yield* sessions.create({ location: browser.ref, permissions: [...grant] })
    yield* storage.set(`grant:${stale.id}`, owner(browser.ref.directory, exited))
    const remote = yield* sessions.create({ location: browser.ref, permissions: [...grant] })
    yield* storage.set(`grant:${remote.id}`, owner(browser.ref.directory, exited, "other-host"))

    // A second server for this location, sharing the database, starts and sweeps.
    yield* BrowserConnection.reconcileStaleGrants({
      session: {
        get: (input) => sessions.get(input.sessionID),
        update: (input) =>
          sessions.setPermissions({ sessionID: input.sessionID, permissions: input.permissions ?? [] }),
      },
      storage,
      location: browser.ref,
    })

    // The live grant is recorded with this process, which still runs.
    expect(yield* storage.get(`grant:${browser.session.id}`)).toEqual(owner(browser.ref.directory, process.pid))
    expect(yield* browser.permissions()).toEqual([...grant])
    expect(yield* browser.permissions(stale.id)).toEqual([])
    expect(yield* browser.permissions(remote.id)).toEqual([...grant])
    expect((yield* browser.call()).output).toEqual({ tabs: [], focusedTabID: null })
  }),
)

const rule = (resource: string, effect: "allow" | "deny" | "ask", action = "browser") => ({ action, resource, effect })

it.live("a deny on one browser operation refuses that operation and still allows the others", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [rule("tabs.open", "deny")] })
    expect((yield* browser.run("tabs.open", {}).pipe(Effect.flip)).message).toStartWith(
      "[browser.denied] browser.tabs.open",
    )
    expect(browser.commands.count).toBe(0)
    expect((yield* browser.call()).output).toEqual({ tabs: [], focusedTabID: null })
  }),
)

it.live("a deny on wait refuses it before it probes the page", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [rule("wait", "deny")] })
    expect(
      (yield* browser.run("wait", { tabID: tab.id, selector: "#done", timeoutMs: 200 }).pipe(Effect.flip)).message,
    ).toStartWith("[browser.denied] browser.wait")
    expect(browser.commands.count).toBe(0)
  }),
)

// A browser denied by config, a session beside the attached one with no desktop, a file in the workspace and a tab that
// does not exist: whichever of them a call meets, it must hear only the denial.
const denied = Effect.fnUntraced(function* () {
  const browser = yield* setup({ permissions: [rule("*", "deny")] })
  const sessions = yield* Session.Service
  const detached = yield* sessions.create({ location: browser.ref })
  yield* Effect.promise(() => Bun.write(path.join(browser.ref.directory, "page.html"), "<p>page</p>"))
  const refusal = (operation: string, input: object, sessionID = browser.session.id) =>
    browser.run(operation, input, "build", sessionID).pipe(
      Effect.flip,
      Effect.map((error) => error.message),
    )
  return { browser, detached, refusal, missingTab: Browser.TabID.make(`tab_${crypto.randomUUID()}`) }
})

it.live("a denied preview reveals neither the file nor the connection", () =>
  Effect.gen(function* () {
    const { browser, detached, refusal } = yield* denied()
    expect(yield* refusal("preview", { path: "page.html" }, detached.id)).toStartWith("[browser.denied]")
    expect(yield* refusal("preview", { path: "missing.html" })).toStartWith("[browser.denied]")
    expect(yield* refusal("preview", { path: "missing.html" }, detached.id)).toStartWith("[browser.denied]")
    expect(yield* refusal("preview", { path: "." })).toStartWith("[browser.denied]")
    expect(browser.commands.count).toBe(0)
  }),
)

it.live("a denied upload or drop reveals neither its files, its tab nor the connection", () =>
  Effect.gen(function* () {
    const { browser, detached, refusal, missingTab } = yield* denied()
    for (const operation of ["files.upload", "files.drop"]) {
      for (const paths of [["page.html"], ["missing.html"]])
        expect(yield* refusal(operation, { tabID: tab.id, ref: "e1", paths }, detached.id)).toStartWith(
          "[browser.denied]",
        )
      expect(yield* refusal(operation, { tabID: missingTab, ref: "e1", paths: ["page.html"] })).toStartWith(
        "[browser.denied]",
      )
    }
    expect(browser.commands.count).toBe(0)
  }),
)

it.live("a denied files.get reveals neither its tab nor the connection", () =>
  Effect.gen(function* () {
    const { browser, detached, refusal, missingTab } = yield* denied()
    const fileID = `file_${crypto.randomUUID()}`
    expect(yield* refusal("files.get", { tabID: missingTab, fileID })).toStartWith("[browser.denied]")
    expect(yield* refusal("files.get", { tabID: tab.id, fileID }, detached.id)).toStartWith("[browser.denied]")
    expect(browser.commands.count).toBe(0)
  }),
)

it.live("a denied tab operation reveals neither the tab nor the connection", () =>
  Effect.gen(function* () {
    const { browser, detached, refusal, missingTab } = yield* denied()
    expect(yield* refusal("tabs.list", {}, detached.id)).toStartWith("[browser.denied]")
    expect(yield* refusal("snapshot", { tabID: missingTab })).toStartWith("[browser.denied]")
    expect(yield* refusal("snapshot", { tabID: tab.id }, detached.id)).toStartWith("[browser.denied]")
    expect(yield* refusal("wait", { tabID: missingTab, selector: "#done" })).toStartWith("[browser.denied]")
    expect(yield* refusal("wait", { tabID: tab.id, selector: "#done" }, detached.id)).toStartWith("[browser.denied]")
    expect(browser.commands.count).toBe(0)
  }),
)

it.live("without a deny, a session with no desktop hears that it is disconnected", () =>
  Effect.gen(function* () {
    const browser = yield* setup({})
    const sessions = yield* Session.Service
    const detached = yield* sessions.create({ location: browser.ref })
    yield* Effect.promise(() => Bun.write(path.join(browser.ref.directory, "page.html"), "<p>page</p>"))
    const refusal = (operation: string, input: object) =>
      browser.run(operation, input, "build", detached.id).pipe(
        Effect.flip,
        Effect.map((error) => error.message),
      )
    expect(yield* refusal("preview", { path: "page.html" })).toStartWith("[browser.disconnected]")
    expect(yield* refusal("preview", { path: "missing.html" })).toStartWith("browser.preview found no file")
    expect(yield* refusal("wait", { tabID: tab.id, selector: "#done" })).toStartWith("[browser.disconnected]")
  }),
)

it.live("a wildcard resource pattern in a browser deny is honoured", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [rule("files.*", "deny")] })
    expect((yield* browser.run("files.list", { tabID: tab.id }).pipe(Effect.flip)).message).toStartWith(
      "[browser.denied] browser.files.list",
    )
    expect(browser.commands.count).toBe(0)
    expect((yield* browser.call()).output).toEqual({ tabs: [], focusedTabID: null })
  }),
)

it.live("an allow for one operation after a whole-browser deny wins, as the last matching rule", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [rule("*", "deny"), rule("tabs.list", "allow")] })
    expect((yield* browser.call()).output).toEqual({ tabs: [], focusedTabID: null })
    expect((yield* browser.run("tabs.open", {}).pipe(Effect.flip)).message).toStartWith("[browser.denied]")
    expect(browser.commands.count).toBe(1)
  }),
)

it.live("a configured browser ask prompts for the call instead of being answered by the grant", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [rule("tabs.list", "ask")] })
    const permissions = Context.get(browser.context, Permission.Service)
    const call = yield* browser.call().pipe(Effect.forkScoped)
    const request = yield* permissions.list().pipe(
      Effect.flatMap((requests) => (requests[0] ? Effect.succeed(requests[0]) : Effect.fail("not asked yet"))),
      Effect.retry(Schedule.spaced("10 millis")),
      Effect.timeout("5 seconds"),
    )
    expect(request).toMatchObject({ sessionID: browser.session.id, action: "browser", resources: ["tabs.list"] })
    expect(browser.commands.count).toBe(0)

    yield* permissions.reply({ requestID: request.id, reply: "once" })
    expect((yield* Fiber.join(call)).output).toEqual({ tabs: [], focusedTabID: null })
    expect(browser.commands.count).toBe(1)
  }),
)

test("the plugin picks the same browser rule as core's permission evaluation", () => {
  const patterns = [
    "*",
    "browser",
    "brow*",
    "b?owser",
    "browser.*",
    "Browser",
    "files.*",
    "tabs.list",
    "b.owser",
    "browser *",
    "*.list",
    "a\\b",
  ]
  const inputs = ["browser", "tabs.list", "files.upload", "evaluate", "browser.x", "a/b"]
  for (const input of inputs)
    for (const pattern of patterns) expect(BrowserMachine.match(input, pattern)).toBe(Wildcard.match(input, pattern))
  // Each pattern once as an action (any resource) and once as a resource of `browser`, with varying effects.
  const rules = patterns.flatMap((pattern, index) => [
    rule("*", index % 3 === 0 ? "deny" : index % 3 === 1 ? "allow" : "ask", pattern),
    rule(pattern, index % 2 === 0 ? "ask" : "deny"),
  ])
  for (const operation of inputs)
    for (const end of rules.keys()) {
      const slice = rules.slice(0, end + 1)
      // Core returns the rule it picked, or a fresh default `ask` rule when none matches.
      const picked = Permission.evaluate("browser", operation, slice)
      expect(BrowserMachine.selectBrowserRule(slice, operation)).toBe(slice.includes(picked) ? picked : undefined)
    }
})
