import { expect } from "bun:test"
import { hostname } from "os"
import path from "path"
import { Context, Deferred, Effect, Exit, Fiber, Schedule, Schema, Stream } from "effect"
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
import { SessionContext } from "@opencode/core/session/context"
import { AutomationCode } from "@opencode/core/automation/code"
import { Tool } from "@opencode/core/tool"
import { Config } from "@opencode/core/config"
import { ConfigIntegration } from "@opencode/core/config/integration"
import { Info } from "@opencode/schema/config"
import { Integration } from "@opencode/schema/integration"
import { isRecord } from "@opencode/util/record"
import { BrowserConnection } from "../../plugin-browser/src/connection"
import { BrowserFiles } from "../../plugin-browser/src/files"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { codeModeListings } from "./lib/tool"

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

const grant = [{ action: "browser", resource: "*", effect: "allow" }] as const
// What versions before this one granted; a revoke or the startup sweep must still remove it.
const legacyGrant = [...grant, { action: "skill", resource: "browser", effect: "allow" }] as const

const tab = {
  id: Browser.TabID.make(`tab_${crypto.randomUUID()}`),
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 1,
}

// A location with `config` as its opencode.json, `files` beside it and one session, plus a stand-in desktop that attaches to that
// session and answers every browser command with an empty tab list.
const setup = (config: object, files: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    for (const [name, text] of Object.entries(files))
      yield* Effect.promise(() => Bun.write(path.join(dir.path, name), text))
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
      navigate: (url: string) => rpc.state({ sessionID: session.id, connectionID: attachments.keys().next().value!, state: { tabs: [{ ...tab, url, generation: tab.generation + 1 }], focusedTabID: tab.id } }),
      // The desktop closes the session's first attachment.
      detach: Fiber.interrupt(attachment),
      run,
      permissions: (sessionID = session.id) => Effect.map(sessions.get(sessionID), (info) => info.permissions ?? []),
      call: (agent = "build", sessionID = session.id) => run("tabs.list", {}, agent, sessionID),
      // What the session's next step offers its agent: the selection every step builds its tools and instructions from.
      listing: (sessionID = session.id) => listing(Context.get(context, SessionContext.Service), sessionID),
    }
  })

const listing = Effect.fnUntraced(function* (contexts: SessionContext.Interface, sessionID: Session.ID) {
  const selection = yield* contexts.select(sessionID)
  const browser = (name: string) => name === "browser" || name.startsWith("browser.") || name.startsWith("browser_")
  const skills = selection.instructions.find((source) => source.key === "core/skill-guidance")
  const guidance = skills ? yield* skills.read : undefined
  const catalog = selection.tools.codeModeCatalog
  return {
    selection,
    catalog: (catalog ? codeModeListings(catalog).map((item) => item.path) : []).filter(browser),
    direct: selection.tools.definitions.map((tool) => tool.name).filter(browser),
    skill: Array.isArray(guidance) && guidance.some((skill) => isRecord(skill) && skill.id === "browser"),
  }
})

// Runs `code` through the selection's Code Mode tool, as the model's `execute` call would.
const codeMode = (selection: SessionContext.Selection, code: string) =>
  selection.tools
    .execute({
      sessionID: selection.session.id,
      agent: selection.agent.id,
      messageID: SessionMessage.ID.create(),
      call: { type: "tool-call", id: `call_${crypto.randomUUID()}`, name: "execute", input: { code } },
    })
    .pipe(Effect.map((result) => result.output))

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
    expect((yield* browser.call("general", child.id)).output).toMatchObject({ connected: false })
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
    yield* sessions.create({ id: sessionID, location: ref, permissions: [...legacyGrant] })
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

it.live("deleting an attached session forgets the record of who granted it the browser", () =>
  Effect.gen(function* () {
    const browser = yield* setup({})
    const storage = PluginHost.storage(yield* KV.Service, "opencode.browser")
    const sessions = yield* Session.Service
    expect(yield* storage.get(`grant:${browser.session.id}`)).toBeDefined()
    const file = { id: Browser.FileID.make(`file_${crypto.randomUUID()}`), name: "report.txt", mime: "text/plain", data: new TextEncoder().encode("report") }
    const [saved] = yield* BrowserFiles.save([file], BrowserFiles.exportPaths([file], BrowserFiles.exportRoot(browser.session.id)))
    expect(yield* Effect.promise(() => Bun.file(saved!.path).exists())).toBe(true)
    yield* sessions.remove(browser.session.id)
    yield* storage.get(`grant:${browser.session.id}`).pipe(
      Effect.flatMap((owner) => (owner === undefined ? Effect.void : Effect.fail("record still there"))),
      Effect.retry(Schedule.spaced("10 millis")),
      Effect.timeout("5 seconds"),
    )
    yield* Effect.promise(() => Bun.file(saved!.path).exists()).pipe(
      Effect.flatMap((exists) => exists ? Effect.fail("session export still there") : Effect.void),
      Effect.retry(Schedule.spaced("10 millis")), Effect.timeout("5 seconds"),
    )
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

it.live("browser file reads require the file's own permission before reading or sending it", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [rule("blocked.txt", "deny", "read"), rule("*", "deny", "external_directory")] })
    // A non-existent file distinguishes a permission refusal from an attempted open, without transferring any data.
    for (const operation of ["files.upload", "files.drop"]) {
      for (const [path, action] of [["blocked.txt", "read"], [pathForExternalTest(browser.ref.directory), "external_directory"]]) {
        const error = yield* refusal(browser, operation, { tabID: tab.id, ref: "e1", paths: [path] })
        expect(error).toContain(`Permission denied: ${action}`)
      }
    }
    const missing = yield* refusal(browser, "preview", { path: "./blocked.txt#L1" })
    expect(missing).toBe("Permission denied: read")
    yield* Effect.promise(() => Bun.write(path.join(browser.ref.directory, "blocked.txt"), "fixture"))
    expect(yield* refusal(browser, "preview", { path: "./blocked.txt#L1" })).toBe(missing)
    expect(browser.commands.count).toBe(0)
  }),
)

// Outside both the Location and its worktree, even when the runner's temp directory is itself in a checkout.
function pathForExternalTest(directory: string) {
  return path.join(path.parse(directory).root, "browser-permission-test", "absent.txt")
}

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
    const status = (yield* browser.call("build", detached.id)).output
    expect(status).toMatchObject({ connected: false, message: expect.stringContaining("retry only after it attaches") })
    for (const [op, input] of [["preview", { path: "page.html" }], ["preview", { path: "missing.html" }], ["wait", { tabID: tab.id, selector: "#done" }], ["snapshot", { tabID: missingTab }]] as const)
      expect((yield* browser.run(op, input, "build", detached.id).pipe(Effect.flip)).message).toStartWith("[browser.not_attached]")
    expect(browser.commands.count).toBe(0)
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

it.live("browser approvals retain legacy operation policy and bind always to the site and complete script", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ permissions: [rule("evaluate", "ask")] })
    const input = { tabID: tab.id, script: "document.title" }
    const first = yield* answer(browser, "evaluate", input, "always")
    expect(first.request.resources).toEqual(["evaluate"])
    expect(first.request.metadata?.input).toEqual({ site: "https://example.com", script: input.script })
    expect(first.request.save?.[0]).toMatch(/^evaluate https:\/\/example\.com [a-f0-9]{64}$/)
    // The stand-in desktop answers with a tab list rather than an evaluation result; reaching it is the assertion.
    yield* browser.run("evaluate", input).pipe(Effect.flip, Effect.timeout("5 seconds"))
    expect(browser.commands.count).toBe(2)
    const next = yield* answer(browser, "evaluate", { ...input, script: "location.href" }, "reject")
    expect(next.request.save).not.toEqual(first.request.save)
    expect(browser.commands.count).toBe(2)
    yield* browser.navigate("https://elsewhere.test/")
    const other = yield* answer(browser, "evaluate", input, "reject")
    expect(other.request.metadata?.input).toEqual({ site: "https://elsewhere.test", script: input.script })
    expect(other.request.save).not.toEqual(first.request.save)
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

// Listing and calling, decided by the same rules. `listed` is whether the agent's next step offers the browser tools and
// skill; each operation either reaches the desktop, prompts, or is refused as denied or disconnected.
type Outcome = "allow" | "ask" | "deny" | "disconnected"
const truth: ReadonlyArray<{
  readonly name: string
  readonly global?: ReadonlyArray<ReturnType<typeof rule>>
  readonly agent?: ReadonlyArray<ReturnType<typeof rule>>
  readonly attached: boolean
  readonly listed: boolean
  readonly list: Outcome
  readonly open: Outcome
}> = [
  { name: "no rules", attached: true, listed: true, list: "allow", open: "allow" },
  { name: "no rules, no desktop", attached: false, listed: false, list: "disconnected", open: "disconnected" },
  { name: "global deny", global: [rule("*", "deny")], attached: true, listed: false, list: "deny", open: "deny" },
  { name: "global deny, no desktop", global: [rule("*", "deny")], attached: false, listed: false, list: "deny", open: "deny" },
  { name: "agent deny", agent: [rule("*", "deny")], attached: true, listed: false, list: "deny", open: "deny" },
  { name: "global allow, agent deny", global: [rule("*", "allow")], agent: [rule("*", "deny")], attached: true, listed: false, list: "deny", open: "deny" },
  { name: "global deny, agent allow", global: [rule("*", "deny")], agent: [rule("*", "allow")], attached: true, listed: true, list: "allow", open: "allow" },
  { name: "agent denies every tool", agent: [rule("*", "deny", "*"), rule("*", "allow", "read")], attached: true, listed: false, list: "deny", open: "deny" },
  { name: "global ask", global: [rule("*", "ask")], attached: true, listed: true, list: "ask", open: "ask" },
  { name: "global deny, agent ask", global: [rule("*", "deny")], agent: [rule("*", "ask")], attached: true, listed: true, list: "ask", open: "ask" },
  { name: "one operation denied", global: [rule("tabs.open", "deny")], attached: true, listed: true, list: "allow", open: "deny" },
  { name: "operation pattern denied", global: [rule("tabs.*", "deny")], attached: true, listed: true, list: "deny", open: "deny" },
  { name: "whole browser denied, one operation allowed after", global: [rule("*", "deny"), rule("tabs.list", "allow")], attached: true, listed: true, list: "allow", open: "deny" },
]

const unattached = Schema.is(Schema.Struct({ output: Schema.Struct({ connected: Schema.Literal(false) }) }))

// What `operation` comes to for `agent` in `sessionID`.
const outcome = (
  browser: Effect.Success<ReturnType<typeof setup>>,
  operation: string,
  agent: string,
  sessionID: Session.ID,
) => settle(browser, sessionID, browser.run(operation, {}, agent, sessionID))

// What `call` comes to: it reaches its end or the desktop, prompts, or is refused as denied or disconnected. A call
// that prompts is interrupted, which withdraws the prompt. Any other failure is returned as its message, so the
// comparison shows it.
const settle = Effect.fnUntraced(function* (
  browser: Effect.Success<ReturnType<typeof setup>>,
  sessionID: Session.ID,
  call: Effect.Effect<unknown, { readonly message: string; readonly error?: unknown }>,
) {
  const permissions = Context.get(browser.context, Permission.Service)
  const before = browser.commands.count
  const reached = () => browser.commands.count > before
  const settled = call.pipe(
    // Without a desktop, tabs.list answers that the browser is not attached instead of failing.
    Effect.map((result): Outcome | string => (unattached(result) ? "disconnected" : "allow")),
    Effect.catch((error) =>
      Effect.succeed(
        error.message.startsWith("[browser.denied]") || error.message.startsWith("Permission denied") || error.error instanceof Permission.BlockedError
          ? "deny"
          : error.message.startsWith("[browser.disconnected]") || error.message.startsWith("[browser.not_attached]")
            ? "disconnected"
            : reached()
              ? "allow"
              : error.message,
      ),
    ),
  )
  const prompted = permissions.forSession(sessionID).pipe(
    Effect.flatMap((requests) => (requests[0] ? Effect.succeed(requests[0]) : Effect.fail("not asked yet"))),
    Effect.retry(Schedule.spaced("10 millis")),
    Effect.as<Outcome | string>("ask"),
  )
  return yield* Effect.raceFirst(settled, prompted).pipe(Effect.timeout("5 seconds"))
})
for (const row of truth)
  it.live(`listing agrees with calling: ${row.name}`, () =>
    Effect.gen(function* () {
      const browser = yield* setup({
        ...(row.global && { permissions: row.global }),
        ...(row.agent && { agents: { build: { permissions: row.agent } } }),
      })
      const sessions = yield* Session.Service
      const sessionID = row.attached ? browser.session.id : (yield* sessions.create({ location: browser.ref })).id
      const listed = yield* browser.listing(sessionID)
      expect(listed.catalog.length > 0).toBe(row.listed)
      expect(listed.skill).toBe(row.listed)
      expect(listed.direct).toEqual([])
      expect(yield* outcome(browser, "tabs.list", "build", sessionID)).toBe(row.list)
      expect(yield* outcome(browser, "tabs.open", "build", sessionID)).toBe(row.open)
    }),
  )

it.live("an agent denied the browser finds no browser tools through Code Mode's catalog, search or tools", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ agents: { reviewer: { mode: "primary", permissions: [rule("*", "deny")] } } })
    const allowed = yield* browser.listing()
    expect(allowed.catalog).toContain("browser.tabs.list")
    expect(yield* codeMode(allowed.selection, 'return search({ namespace: "browser" }).items.length > 0')).toMatchObject({ output: "true" })
    expect(yield* codeMode(allowed.selection, "return (await tools.browser.tabs.list({})).tabs.length")).toMatchObject({ output: "0" })

    const sessions = yield* Session.Service
    yield* sessions.switchAgent({ sessionID: browser.session.id, agent: Agent.ID.make("reviewer") })
    const denied = yield* browser.listing()
    expect(denied.catalog).toEqual([])
    expect(denied.direct).toEqual([])
    expect(denied.skill).toBe(false)
    expect(yield* codeMode(denied.selection, 'return search({ namespace: "browser" }).items.length')).toMatchObject({ output: "0" })
    expect(yield* codeMode(denied.selection, 'return search({ query: "browser tabs screenshot" }).items.filter((item) => item.path.startsWith("tools.browser")).length')).toMatchObject({ output: "0" })
    expect(
      yield* codeMode(
        denied.selection,
        'try { await tools.browser.tabs.list({}); return "called" } catch (error) { return String(error?.message ?? error) }',
      ),
    ).toMatchObject({ output: "Unknown tool 'browser.tabs.list'.", toolCalls: [] })
    expect(browser.commands.count).toBe(1)
  }),
)

it.live("the next step's listing follows an agent switch, a session rule, a config reload and the attachment", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ agents: { reviewer: { mode: "primary", permissions: [rule("*", "deny")] } } })
    const sessions = yield* Session.Service
    const listed = Effect.map(browser.listing(), (listing) => listing.catalog.length > 0)
    expect(yield* listed).toBe(true)

    yield* sessions.switchAgent({ sessionID: browser.session.id, agent: Agent.ID.make("reviewer") })
    expect(yield* listed).toBe(false)
    yield* sessions.switchAgent({ sessionID: browser.session.id, agent: Agent.ID.make("build") })
    expect(yield* listed).toBe(true)

    yield* sessions.setPermissions({ sessionID: browser.session.id, permissions: [...grant, rule("*", "deny")] })
    expect(yield* listed).toBe(false)
    expect((yield* browser.call().pipe(Effect.flip)).message).toStartWith("[browser.denied]")
    yield* sessions.setPermissions({ sessionID: browser.session.id, permissions: [...grant] })
    expect(yield* listed).toBe(true)

    // A config source that changes while the server runs reloads the agents, and with them the rules the grant yields to.
    const config = Context.get(browser.context, Config.Service)
    const integrationID = Integration.ID.make("browser-permission-test")
    yield* config.integration!(
      integrationID,
      new ConfigIntegration.Document({
        type: "document",
        integrationID,
        connection: { type: "env", name: "BROWSER_PERMISSION_TEST_KEY" },
        info: Schema.decodeUnknownSync(Info)({ permissions: [rule("*", "deny")] }),
      }),
    )
    yield* Plugin.awaitActivation.pipe(Effect.provideContext(browser.context))
    expect(yield* listed).toBe(false)
    expect((yield* browser.call().pipe(Effect.flip)).message).toStartWith("[browser.denied]")
    yield* config.integration!(integrationID, undefined)
    yield* Plugin.awaitActivation.pipe(Effect.provideContext(browser.context))
    expect(yield* listed).toBe(true)

    yield* browser.detach
    yield* browser.permissions().pipe(
      Effect.flatMap((rules) => (rules.length ? Effect.fail("grant not revoked yet") : Effect.void)),
      Effect.retry(Schedule.spaced("10 millis")),
      Effect.timeout("5 seconds"),
    )
    expect(yield* listed).toBe(false)
    yield* browser.attach(browser.session.id)
    expect(yield* listed).toBe(true)
  }),
)

it.live("a subagent lists no browser tools, whether it lost the inherited grant or its agent denies an attached browser", () =>
  Effect.gen(function* () {
    const browser = yield* setup({
      agents: { reviewer: { mode: "subagent", permissions: [rule("*", "deny")] } },
    })
    const sessions = yield* Session.Service
    const general = yield* sessions.create({ parentID: browser.session.id, agent: Agent.ID.make("general") })
    yield* sessions.prompt({ sessionID: general.id, text: "Take a screenshot", resume: false })
    expect((yield* browser.listing(general.id)).catalog).toEqual([])
    expect((yield* browser.listing()).catalog).toContain("browser.tabs.list")

    const reviewer = yield* sessions.create({ parentID: browser.session.id, agent: Agent.ID.make("reviewer") })
    yield* sessions.prompt({ sessionID: reviewer.id, text: "Review the page", resume: false })
    yield* browser.attach(reviewer.id)
    expect(yield* browser.permissions(reviewer.id)).toEqual([...grant])
    const denied = yield* browser.listing(reviewer.id)
    expect(denied.catalog).toEqual([])
    expect(denied.skill).toBe(false)

    // Explore denies every tool, Code Mode included, so a browser it were offered would be listed as direct tools.
    const explore = yield* sessions.create({ parentID: browser.session.id, agent: Agent.ID.make("explore") })
    yield* sessions.prompt({ sessionID: explore.id, text: "Find the page", resume: false })
    yield* browser.attach(explore.id)
    const listing = yield* browser.listing(explore.id)
    expect(listing.direct).toEqual([])
    expect(listing.skill).toBe(false)
    expect(browser.commands.count).toBe(0)
  }),
)
it.live("a tool.use policy on the browser refuses its calls but still lists its tools, as today", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ policies: [{ action: "tool.use", resource: "browser:*", effect: "deny" }] })
    // Listing does not ask policies yet; closing that changes this test on purpose.
    expect((yield* browser.listing()).catalog).toContain("browser.tabs.list")
    expect((yield* browser.call().pipe(Effect.flip)).message).toBe("Blocked by configuration policy")
  }),
)

it.live("with the browser plugin removed, a grant left in a session lists and registers nothing", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    yield* Effect.promise(() => Bun.write(path.join(dir.path, "opencode.json"), JSON.stringify({ plugins: ["-opencode.browser"] })))
    const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
    const locations = yield* LocationServiceMap.Service
    const context = yield* locations.contextEffect(ref).pipe(Effect.scoped)
    yield* Plugin.awaitActivation.pipe(Effect.provideContext(context))
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ location: ref, permissions: [...grant] })
    const tools = yield* Context.get(context, Tool.Service).list()
    expect(tools.filter((tool) => tool.options?.namespace?.startsWith("browser"))).toEqual([])
    const listed = yield* listing(Context.get(context, SessionContext.Service), session.id)
    expect(listed.catalog).toEqual([])
    expect(listed.skill).toBe(false)
  }),
)

it.live("with the browser plugin removed, a person's deny on their own browser skill outranks a grant left behind", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      Bun.write(
        path.join(dir.path, ".opencode/skills/browser/SKILL.md"),
        "---\nname: browser\ndescription: Drive Playwright against the staging site.\n---\n# Playwright\n",
      ),
    )
    yield* Effect.promise(() =>
      Bun.write(
        path.join(dir.path, "opencode.json"),
        JSON.stringify({ plugins: ["-opencode.browser"], permissions: [rule("browser", "deny", "skill")] }),
      ),
    )
    const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
    const locations = yield* LocationServiceMap.Service
    const context = yield* locations.contextEffect(ref).pipe(Effect.scoped)
    yield* Plugin.awaitActivation.pipe(Effect.provideContext(context))
    const sessions = yield* Session.Service
    const contexts = Context.get(context, SessionContext.Service)
    // A grant allows no skill, so the person's deny decides.
    const current = yield* sessions.create({ location: ref, permissions: [...grant] })
    expect((yield* listing(contexts, current.id)).skill).toBe(false)
    // An earlier version's grant also allowed the skill. Nothing sweeps it once the plugin is removed, so it still
    // outranks the deny; with the plugin loaded, a revoke or the startup sweep removes it.
    const legacy = yield* sessions.create({ location: ref, permissions: [...legacyGrant] })
    expect((yield* listing(contexts, legacy.id)).skill).toBe(true)
  }),
)
// Loads the browser skill as the model would, through the read tool.
const readSkill = (browser: Effect.Success<ReturnType<typeof setup>>, agent: string, sessionID = browser.session.id) =>
  Effect.gen(function* () {
    const read = (yield* Context.get(browser.context, Tool.Service).list()).find((tool) => tool.name === "read")
    if (!read) return yield* Effect.die(new Error("read is not registered"))
    return yield* settle(
      browser,
      sessionID,
      read.execute(
        { path: "skill://browser/SKILL.md" },
        {
          sessionID,
          agent: Agent.ID.make(agent),
          messageID: SessionMessage.ID.create(),
          id: Tool.CallID.make(`call_${crypto.randomUUID()}`),
          progress: () => Effect.void,
        },
      ),
    )
  })

const reads = rule("*", "allow", "read")

it.live("the attachment's grant does not override a configured skill deny or ask for the browser skill", () =>
  Effect.gen(function* () {
    const denied = yield* setup({ permissions: [reads, rule("*", "deny", "skill")] })
    const listed = yield* denied.listing()
    expect(listed.catalog).toContain("browser.tabs.list")
    expect(listed.skill).toBe(false)
    expect(yield* readSkill(denied, "build")).toBe("deny")

    const asked = yield* setup({ permissions: [reads, rule("browser", "ask", "skill")] })
    expect((yield* asked.listing()).skill).toBe(true)
    expect(yield* readSkill(asked, "build")).toBe("ask")

    const allowed = yield* setup({
      permissions: [reads],
      agents: { reviewer: { mode: "primary", permissions: [rule("*", "deny")] } },
    })
    expect(yield* readSkill(allowed, "build")).toBe("allow")
    // The skill tool refuses an agent denied the browser, as its listing does.
    expect(yield* readSkill(allowed, "reviewer")).toBe("deny")
  }),
)

it.live("a person's own skill named browser follows their rules, not the built-in's", () =>
  Effect.gen(function* () {
    const browser = yield* setup(
      { permissions: [reads, rule("*", "deny"), rule("browser", "allow", "skill")] },
      {
        ".opencode/skills/browser/SKILL.md":
          "---\nname: browser\ndescription: Drive Playwright against the staging site.\n---\n# Playwright\n",
      },
    )
    const sessions = yield* Session.Service
    const detached = yield* sessions.create({ location: browser.ref })
    for (const sessionID of [browser.session.id, detached.id]) {
      const listed = yield* browser.listing(sessionID)
      expect(listed.catalog).toEqual([])
      expect(listed.skill).toBe(true)
    }
  }),
)

it.live("an automation's code runs the browser for an allowed agent and refuses one denied the browser", () =>
  Effect.gen(function* () {
    const browser = yield* setup({ agents: { reviewer: { mode: "primary", permissions: [rule("*", "deny")] } } })
    const sessions = yield* Session.Service
    const action = { type: "code" as const, code: "return { state: (await tools.browser.tabs.list({})).tabs.length }" }
    const run = () =>
      sessions.get(browser.session.id).pipe(
        Effect.flatMap((session) =>
          AutomationCode.run(session, action, { messageID: SessionMessage.ID.create(), state: null, now: 0, runs: 0 }),
        ),
        Effect.provideContext(browser.context),
      )
    expect(yield* run()).toMatchObject({ ok: true, state: 0 })
    expect(browser.commands.count).toBe(1)
    yield* sessions.switchAgent({ sessionID: browser.session.id, agent: Agent.ID.make("reviewer") })
    expect(yield* run()).toMatchObject({ ok: false, error: "Permission denied: browser" })
    expect(browser.commands.count).toBe(1)
  }),
)