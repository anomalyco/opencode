import { expect } from "bun:test"
import { hostname } from "os"
import path from "path"
import { Context, Deferred, Effect, Exit, Fiber, Schedule, Stream } from "effect"
import { Browser } from "@opencode/plugin-browser/rpc"
import { SessionMessage } from "@opencode/schema/session-message"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { BrowserConnection } from "../../plugin-browser/src/connection"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, KV.node, PermissionSaved.node, Session.node, LocationServiceMap.node]),
    [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      // The browser never reads the watcher; a live one subscribes to the OS for every Location these tests boot.
      Watcher.node.replace(Watcher.configured({ enabled: false })),
    ],
  ),
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
      const call = yield* rpc.attach({ sessionID, connectionID, version: 4 }).pipe(Effect.forkScoped)
      yield* Deferred.await(attached).pipe(Effect.timeout("10 seconds"))
      // One open tab, so operations that target a tab get past tab selection to the permission check.
      yield* rpc.state({ sessionID, connectionID, state: { tabs: [tab], focusedTabID: tab.id } })
      return call
    })
    const attachment = yield* attach(session.id)
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
      // The desktop closes the session's first attachment.
      detach: Fiber.interrupt(attachment),
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

const missingTab = Browser.TabID.make(`tab_${crypto.randomUUID()}`)

// What `operation` fails with in `sessionID`.
const refusal = (
  browser: Effect.Success<ReturnType<typeof setup>>,
  operation: string,
  input: object,
  sessionID = browser.session.id,
  agent = "build",
) =>
  browser.run(operation, input, agent, sessionID).pipe(
    Effect.flip,
    Effect.map((error) => error.message),
  )

// A browser denied by config, a session beside the attached one with no desktop, a file in the workspace and a tab that
// does not exist: whichever of them a call meets, it must hear only the denial.
it.live("a denied call reveals neither its files, its tab nor the connection", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [rule("*", "deny")] })
    const sessions = yield* Session.Service
    const detached = yield* sessions.create({ location: browser.ref })
    yield* Effect.promise(() => Bun.write(path.join(browser.ref.directory, "page.html"), "<p>page</p>"))
    const fileID = `file_${crypto.randomUUID()}`
    const calls: [string, object, Session.ID][] = [
      ["preview", { path: "page.html" }, detached.id],
      ["preview", { path: "missing.html" }, browser.session.id],
      ["preview", { path: "missing.html" }, detached.id],
      ["preview", { path: "." }, browser.session.id],
      ...["files.upload", "files.drop"].flatMap((operation): [string, object, Session.ID][] => [
        [operation, { tabID: tab.id, ref: "e1", paths: ["page.html"] }, detached.id],
        [operation, { tabID: tab.id, ref: "e1", paths: ["missing.html"] }, detached.id],
        [operation, { tabID: missingTab, ref: "e1", paths: ["page.html"] }, browser.session.id],
      ]),
      ["files.get", { tabID: missingTab, fileID }, browser.session.id],
      ["files.get", { tabID: tab.id, fileID }, detached.id],
      ["tabs.list", {}, detached.id],
      ["snapshot", { tabID: missingTab }, browser.session.id],
      ["snapshot", { tabID: tab.id }, detached.id],
      ["wait", { tabID: missingTab, selector: "#done" }, browser.session.id],
      ["wait", { tabID: tab.id, selector: "#done" }, detached.id],
    ]
    for (const [operation, input, sessionID] of calls)
      expect(yield* refusal(browser, operation, input, sessionID)).toStartWith("[browser.denied]")
    expect(browser.commands.count).toBe(0)
  }),
)

it.live("a call a tool.use policy blocks hears the same answer whatever tab or file it names", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ policies: [{ action: "tool.use", resource: "browser:*", effect: "deny" }] })
    yield* Effect.promise(() => Bun.write(path.join(browser.ref.directory, "page.html"), "<p>page</p>"))
    for (const [operation, input] of [
      ["preview", { path: "page.html" }],
      ["preview", { path: "missing.html" }],
      ["preview", { path: "." }],
      ["snapshot", { tabID: missingTab }],
      ["wait", { tabID: missingTab, selector: "#done" }],
    ] as const)
      expect(yield* refusal(browser, operation, input)).toBe("Blocked by configuration policy")
    expect(browser.commands.count).toBe(0)
  }),
)

it.live("a call that must ask names no tab before the prompt is answered", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [rule("*", "ask")] })
    const permissions = Context.get(browser.context, Permission.Service)
    const call = yield* browser.run("snapshot", { tabID: missingTab }).pipe(Effect.forkScoped)
    // Before, the call failed at once listing the open tabs and URLs; now it waits on the user before reading them.
    const request = yield* asked(permissions, "snapshot")
    expect(request.resources).toEqual(["snapshot"])
    yield* permissions.reply({ requestID: request.id, reply: "reject" })
    expect(Exit.isFailure(yield* Fiber.await(call))).toBe(true)
    expect(browser.commands.count).toBe(0)
  }),
)

it.live("an agent core cannot resolve, such as a disabled one, is denied the browser despite the grant", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ agents: { reviewer: { disabled: true } } })
    expect(yield* refusal(browser, "tabs.list", {}, browser.session.id, "reviewer")).toStartWith("[browser.denied]")
    expect(yield* refusal(browser, "tabs.list", {}, browser.session.id, "ghost")).toStartWith("[browser.denied]")
    expect(browser.commands.count).toBe(0)
    expect((yield* browser.call()).output).toEqual({ tabs: [], focusedTabID: null })
  }),
)

it.live("without a deny, a session with no desktop hears that it is disconnected", () =>
  Effect.gen(function* () {
    const browser = yield* setup({})
    const sessions = yield* Session.Service
    const detached = yield* sessions.create({ location: browser.ref })
    yield* Effect.promise(() => Bun.write(path.join(browser.ref.directory, "page.html"), "<p>page</p>"))
    // Whether the file exists is not said: without a desktop no permission check, policies included, can run.
    for (const file of ["page.html", "missing.html"])
      expect(yield* refusal(browser, "preview", { path: file }, detached.id)).toStartWith(
        `[browser.disconnected] ${path.join(browser.ref.directory, file)} was not shown`,
      )
    expect(yield* refusal(browser, "wait", { tabID: tab.id, selector: "#done" }, detached.id)).toStartWith(
      "[browser.disconnected]",
    )
    expect(yield* refusal(browser, "snapshot", { tabID: missingTab }, detached.id)).toStartWith(
      "[browser.disconnected]",
    )
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

// The pending permission request for `operation`, once the call has asked.
const asked = (permissions: Permission.Interface, operation: string) =>
  permissions.list().pipe(
    Effect.flatMap((requests) => {
      const request = requests.find((item) => item.resources.includes(operation))
      return request ? Effect.succeed(request) : Effect.fail("not asked yet")
    }),
    Effect.retry(Schedule.spaced("10 millis")),
    Effect.timeout("5 seconds"),
  )

// Answers the prompt the call of `operation` raises with `reply` and returns the call's result.
const answer = Effect.fnUntraced(function* (
  browser: Effect.Success<ReturnType<typeof setup>>,
  operation: string,
  input: object,
  reply: Permission.Reply,
) {
  const permissions = Context.get(browser.context, Permission.Service)
  const call = yield* browser.run(operation, input).pipe(Effect.forkScoped)
  const request = yield* asked(permissions, operation)
  yield* permissions.reply({ requestID: request.id, reply })
  // A plain rejection ends the step, so it surfaces as a defect.
  return { request, exit: yield* Fiber.await(call) }
})

it.live("always for one browser operation stops its prompts, while other operations still prompt", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [rule("*", "ask")] })
    const permissions = Context.get(browser.context, Permission.Service)
    const approved = yield* answer(browser, "tabs.list", {}, "always")
    expect(approved.request.save).toEqual(["tabs.list"])
    expect(browser.commands.count).toBe(1)

    expect((yield* browser.call().pipe(Effect.timeout("5 seconds"))).output).toEqual({ tabs: [], focusedTabID: null })
    expect(yield* permissions.list()).toEqual([])
    expect(browser.commands.count).toBe(2)
    const other = yield* answer(browser, "tabs.open", {}, "reject")
    expect(other.request.resources).toEqual(["tabs.open"])
    expect(browser.commands.count).toBe(2)
  }),
)

it.live("a saved browser approval outlives detach and re-attach, and only covers its operation", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [rule("*", "ask")] })
    const permissions = Context.get(browser.context, Permission.Service)
    yield* answer(browser, "tabs.list", {}, "always")

    yield* browser.detach
    yield* browser.permissions().pipe(
      Effect.flatMap((rules) => (rules.length ? Effect.fail("grant not revoked yet") : Effect.void)),
      Effect.retry(Schedule.spaced("10 millis")),
      Effect.timeout("5 seconds"),
    )
    yield* browser.attach(browser.session.id)
    expect(yield* browser.permissions()).toEqual([...grant])

    expect((yield* browser.call().pipe(Effect.timeout("5 seconds"))).output).toEqual({ tabs: [], focusedTabID: null })
    expect(yield* permissions.list()).toEqual([])
    const other = yield* answer(browser, "tabs.open", {}, "reject")
    expect(other.request.resources).toEqual(["tabs.open"])
  }),
)

it.live("a configured deny that matches last refuses the call despite a saved approval", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [rule("*", "ask"), rule("tabs.open", "deny")] })
    yield* answer(browser, "tabs.list", {}, "always")
    const saved = yield* PermissionSaved.Service
    const projectID = Context.get(browser.context, Location.Service).project.id
    expect((yield* saved.list({ projectID })).map((item) => [item.action, item.resource])).toEqual([
      ["browser", "tabs.list"],
    ])
    yield* saved.add({ projectID, action: "browser", resources: ["tabs.open"] })

    expect((yield* browser.run("tabs.open", {}).pipe(Effect.flip)).message).toStartWith(
      "[browser.denied] browser.tabs.open",
    )
    expect(browser.commands.count).toBe(1)
  }),
)
