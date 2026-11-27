import { describe, expect, test } from "bun:test"
import { hostname, tmpdir } from "node:os"
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import type { Permission } from "@opencode/schema/permission"
import { Tool } from "@opencode/schema/tool"
import { Effect, Fiber, Schedule, Stream } from "effect"
import { BrowserConnection } from "../src/connection.js"
import { Browser } from "../src/rpc.js"
import { BrowserTools } from "../src/tools.js"
import { BrowserTunnelHost } from "../src/tunnel-host.js"

type Rule = Permission.Rule
type SessionRow = { id: string; agent: string; parentID?: string; permissions?: Rule[]; location: { directory: string } }
type Control = { type: string; connectionID: string; requestID?: string }
type AssertCall = { action: string; resources: readonly string[] }
type ToolDefinition = { name: string; options?: { namespace?: string }; execute: (input: object, tool: Tool.Context) => Effect.Effect<unknown, Tool.Error> }

const grant: Rule[] = [
  { action: "browser", resource: "*", effect: "allow" },
  { action: "skill", resource: "browser", effect: "allow" },
]
const rule = (resource: string, effect: Rule["effect"], action = "browser"): Rule => ({ action, resource, effect })
const tabID = Browser.TabID.make(`tab_${"1".repeat(8)}-1111-1111-1111-${"1".repeat(12)}`)
const tab = { id: tabID, url: "https://example.com/", title: "Example", loading: false, canGoBack: false, canGoForward: false, generation: 1 }

/**
 * The plugin context the browser plugin uses, with an in-memory session store, storage and stand-in desktop: it
 * answers every command it is sent with `answer` and counts them. Permission asserts are recorded and decided by
 * `deny`.
 */
function plugin(input: {
  directory: string
  agents?: Record<string, Rule[]>
  sessions?: SessionRow[]
  storage?: Record<string, unknown>
  deny?: (call: AssertCall) => string | undefined
  answer?: unknown
}) {
  const sessions = new Map((input.sessions ?? []).map((row) => [row.id, { ...row }]))
  const storage = new Map(Object.entries(input.storage ?? {}))
  const hooks: ((event: PermissionEvaluation) => Effect.Effect<void>)[] = []
  const prompts: ((event: { sessionID: string }) => Effect.Effect<void>)[] = []
  const tools: ToolDefinition[] = []
  const asserts: AssertCall[] = []
  const controls: Control[] = []
  const agents = Object.entries(input.agents ?? { build: [] }).map(([id, permissions]) => ({ id, permissions: [...permissions] }))
  const rpc: { handlers?: Record<string, (input: object, call: object) => Effect.Effect<unknown, unknown>> } = {}
  const call = { error: (code: string, message: string) => new Error(`${code}: ${message}`) }

  const ctx = {
    agent: { transform: (fn: (editor: { list: () => typeof agents }) => void) => Effect.sync(() => fn({ list: () => agents })) },
    permission: {
      hook: (_name: "evaluate", hook: (event: PermissionEvaluation) => Effect.Effect<void>) => Effect.sync(() => void hooks.push(hook)),
      assert: (request: AssertCall) =>
        Effect.suspend(() => {
          asserts.push({ action: request.action, resources: request.resources })
          const denied = input.deny?.(request)

          return denied ? Effect.fail(new Tool.Error({ message: denied })) : Effect.void
        }),
    },
    session: {
      get: (request: { sessionID: string }) => {
        const row = sessions.get(request.sessionID)

        return row ? Effect.succeed(row) : Effect.fail(new Error(`Session not found: ${request.sessionID}`))
      },
      update: (request: { sessionID: string; permissions?: Rule[] }) =>
        Effect.sync(() => {
          const row = sessions.get(request.sessionID)

          if (row) row.permissions = request.permissions
        }),
      hook: (_name: "prompt", hook: (event: { sessionID: string }) => Effect.Effect<void>) => Effect.sync(() => void prompts.push(hook)),
    },
    storage: {
      scan: (request: { prefix: string }) =>
        Effect.sync(() => ({ entries: [...storage].filter(([key]) => key.startsWith(request.prefix)).map(([key, value]) => ({ key, value })) })),
      set: (key: string, value: unknown) => Effect.sync(() => void storage.set(key, value)),
      remove: (key: string) => Effect.sync(() => void storage.delete(key)),
    },
    location: { directory: input.directory, project: { directory: input.directory } },
    rpc: {
      register: (_definition: unknown, handlers: NonNullable<typeof rpc.handlers>) =>
        Effect.sync(() => {
          rpc.handlers = handlers

          return {
            events: {
              emit: (_name: "control", control: Control) =>
                Effect.sync(() => {
                  controls.push(control)

                  // The desktop asks for the command and answers it, after the plugin's step releases its lock.
                  if (control.type === "command")
                    void Effect.runPromise(
                      handlers.result(
                        { sessionID: [...sessions.keys()][0], connectionID: control.connectionID, requestID: control.requestID, outcome: { type: "success", result: { value: input.answer ?? { tabs: [], focusedTabID: null }, files: [] } } },
                        call,
                      ),
                    ).catch(() => undefined)
                }),
            },
          }
        }),
    },
    event: { subscribe: () => Stream.empty },
    skill: { transform: () => Effect.void },
    tool: {
      transform: (fn: (editor: { namespace: () => void; add: (tool: ToolDefinition) => void }) => void) =>
        Effect.sync(() => fn({ namespace: () => undefined, add: (tool) => void tools.push(tool) })),
    },
  }

  // SAFETY: the plugin calls only the members above while it is made, attached and run.
  const context = ctx as unknown as Parameters<typeof BrowserConnection.make>[0] & Parameters<typeof BrowserTools.register>[0]

  return {
    context,
    sessions,
    storage,
    asserts,
    invoke: (name: string, input: object) => rpc.handlers![name](input, call),
    commands: () => controls.filter((control) => control.type === "command").length,
    evaluate: (event: PermissionEvaluation) => Effect.forEach(hooks, (hook) => hook(event), { discard: true }).pipe(Effect.as(event)),
    prompt: (sessionID: string) => Effect.forEach(prompts, (hook) => hook({ sessionID }), { discard: true }),
    /** Attaches a desktop to `sessionID` and reports one open tab; interrupting the fiber detaches it. */
    attach: (sessionID: string, connectionID: string = crypto.randomUUID()) =>
      Effect.gen(function* () {
        const attached = yield* Effect.forkChild(rpc.handlers!.attach({ sessionID, connectionID, version: 4 }, call), { startImmediately: true })
        yield* Effect.suspend(() => (controls.some((control) => control.type === "attached" && control.connectionID === connectionID) ? Effect.void : Effect.fail("not attached"))).pipe(
          Effect.retry(Schedule.spaced("5 millis")),
          Effect.timeout("5 seconds"),
        )
        yield* rpc.handlers!.state({ sessionID, connectionID, state: { tabs: [tab], focusedTabID: tabID } }, call)

        return attached
      }),
    /** Runs browser.<operation> as `agent` would, through the plugin's own executor. */
    run: (operation: string, args: object, sessionID: string, agent = "build") => {
      const separator = operation.lastIndexOf(".")
      const namespace = separator < 0 ? "browser" : `browser.${operation.slice(0, separator)}`
      const found = tools.find((tool) => tool.name === operation.slice(separator + 1) && tool.options?.namespace === namespace)

      if (!found) return Effect.die(new Error(`browser.${operation} is not registered`))
      // SAFETY: the executor reads only these fields of the call's context.
      const tool = { sessionID, agent, messageID: "msg_test", id: `call_${crypto.randomUUID()}`, progress: () => Effect.void } as unknown as Tool.Context

      return found.execute(args, tool)
    },
  }
}

const session = (id: string, directory: string, extra: Partial<SessionRow> = {}): SessionRow => ({ id, agent: "build", location: { directory }, ...extra })

const until = (check: () => boolean) =>
  Effect.suspend(() => (check() ? Effect.void : Effect.fail("not yet"))).pipe(Effect.retry(Schedule.spaced("5 millis")), Effect.timeout("5 seconds"))

test("changing the experiment only changes new attachments, including legacy RPC traffic", () =>
  Effect.runPromise(Effect.gen(function* () {
    const fake = plugin({ directory: "/work", sessions: [session("ses_fixture", "/work")] })
    const listener = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })),
      (server) => Effect.sync(() => server.stop(true)),
    )
    let enabled = true
    yield* BrowserConnection.make(fake.context).pipe(Effect.provideService(BrowserTunnelHost.Reference, {
      enabled: Effect.sync(() => enabled),
      reservedLocalPorts: () => new Set([listener.port]),
      issueTicket: () => Effect.die("Disabled attachment must not mint a ticket"),
      revokeAttachment: () => Effect.void,
    }))

    const on = { sessionID: "ses_fixture", connectionID: "on" }
    const off = { ...on, connectionID: "off" }
    const target = { host: "127.0.0.1", port: listener.port }
    const first = yield* fake.attach(on.sessionID, on.connectionID)
    enabled = false
    expect(yield* fake.invoke("tunnel.open", { ...on, target }).pipe(Effect.flip)).toMatchObject({ message: expect.stringContaining("blocked") })
    const second = yield* fake.attach(off.sessionID, off.connectionID)
    expect(yield* Fiber.join(first)).toBe("replaced")
    expect(yield* fake.invoke("tunnel.ticket", { ...off, protocol: 1 }).pipe(Effect.flip)).toMatchObject({ message: expect.stringContaining("disabled") })
    expect(yield* fake.invoke("tunnel.grant", { ...off, target }).pipe(Effect.flip)).toMatchObject({ message: expect.stringContaining("disabled") })
    const tunnelID = yield* fake.invoke("tunnel.open", { ...off, target })
    yield* fake.invoke("tunnel.close", { ...off, tunnelID })
    yield* Fiber.interrupt(second)
  }).pipe(Effect.scoped)),
)

// An attached session's grant makes core resolve every browser call to allow, so the plugin's `evaluate` hook is what
// applies the agent's own rules. When it cannot read them, the grant must not decide alone.
test("a browser call is refused when the session's rules cannot be read", async () => {
  const fake = plugin({ directory: "/workspace" })
  const evaluated = await Effect.runPromise(
    Effect.gen(function* () {
      yield* BrowserConnection.make(fake.context)

      // SAFETY: the hook passes the ID to `session.get` and reads nothing of it.
      return yield* fake.evaluate({ sessionID: "ses_unreadable" as PermissionEvaluation["sessionID"], action: "browser", resources: ["tabs.list"], effect: "allow" })
    }).pipe(Effect.scoped),
  )

  expect(evaluated.effect).toBe("deny")
  expect(evaluated.message).toBe("Browser permissions could not be read; no action ran.")
})

// The agent's rules from config and its definition, then the session's own rules without the grant, decide; the
// grant alone allows. The hook only ever refuses: an ask rule leaves the call allowed.
describe("the evaluate hook", () => {
  const cases: ReadonlyArray<{
    name: string
    agents?: Record<string, Rule[]>
    session?: Rule[]
    agent?: string
    action?: string
    resources?: string[]
    effect: "allow" | "deny"
  }> = [
    { name: "no rules", effect: "allow" },
    { name: "the whole browser denied", agents: { build: [rule("*", "deny")] }, effect: "deny" },
    { name: "one operation denied, that operation", agents: { build: [rule("tabs.open", "deny")] }, resources: ["tabs.open"], effect: "deny" },
    { name: "one operation denied, another operation", agents: { build: [rule("tabs.open", "deny")] }, resources: ["tabs.list"], effect: "allow" },
    { name: "an operation pattern denied", agents: { build: [rule("tabs.*", "deny")] }, resources: ["tabs.list"], effect: "deny" },
    { name: "every tool denied", agents: { build: [rule("*", "deny", "*")] }, effect: "deny" },
    { name: "every tool denied, the browser allowed after", agents: { build: [rule("*", "deny", "*"), rule("*", "allow")] }, effect: "allow" },
    { name: "an ask rule", agents: { build: [rule("*", "ask")] }, effect: "allow" },
    { name: "a session rule denying the operation", session: [rule("tabs.list", "deny")], effect: "deny" },
    { name: "a session rule denying it before the grant", session: [rule("*", "deny"), ...grant], effect: "deny" },
    { name: "a subagent whose agent denies the browser", agents: { build: [], reviewer: [rule("*", "deny")] }, agent: "reviewer", effect: "deny" },
    { name: "the parent agent beside that subagent", agents: { build: [], reviewer: [rule("*", "deny")] }, agent: "build", effect: "allow" },
    { name: "an agent no config defines", agent: "ghost", effect: "deny" },
    { name: "the file route, preview denied", agents: { build: [rule("preview", "deny")] }, resources: ["tabs.open", "preview"], effect: "deny" },
    { name: "another action, the browser denied", agents: { build: [rule("*", "deny")] }, action: "read", effect: "allow" },
  ]

  test.each(cases)("$name: $effect", async (row) => {
    const fake = plugin({ directory: "/workspace", agents: row.agents, sessions: [session("ses_a", "/workspace", { permissions: [...(row.session ?? []), ...grant] })] })
    const evaluated = await Effect.runPromise(
      Effect.gen(function* () {
        yield* BrowserConnection.make(fake.context)

        // SAFETY: test IDs; the hook reads the session through the fake store.
        return yield* fake.evaluate({ sessionID: "ses_a" as PermissionEvaluation["sessionID"], agent: (row.agent ?? "build") as PermissionEvaluation["agent"], action: row.action ?? "browser", resources: row.resources ?? ["tabs.list"], effect: "allow" })
      }).pipe(Effect.scoped),
    )

    expect(evaluated.effect).toBe(row.effect)

    if (row.effect === "deny") expect(evaluated.message).toStartWith("[browser.denied]")
  })

  test("a deny another hook or core already made stays as it is", async () => {
    const fake = plugin({ directory: "/workspace", sessions: [session("ses_a", "/workspace", { permissions: grant })] })
    const evaluated = await Effect.runPromise(
      Effect.gen(function* () {
        yield* BrowserConnection.make(fake.context)

        // SAFETY: test ID.
        return yield* fake.evaluate({ sessionID: "ses_a" as PermissionEvaluation["sessionID"], action: "browser", resources: ["tabs.list"], effect: "deny", message: "Blocked by policy" })
      }).pipe(Effect.scoped),
    )

    expect([evaluated.effect, evaluated.message]).toEqual(["deny", "Blocked by policy"])
  })
})

// A workspace with a page, a text file, a folder, a hidden file, a link out of it and a file beside it.
async function workspace() {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "browser-route-")))
  const root = join(temp, "workspace")
  const outside = join(temp, "outside")
  await mkdir(join(root, "site"), { recursive: true })
  await mkdir(outside)
  await writeFile(join(root, "page.html"), "<p>page</p>")
  await writeFile(join(root, "chart.svg"), "<svg/>")
  await writeFile(join(outside, "secret.html"), "<p>secret</p>")
  await writeFile(join(temp, "beside.html"), "<p>beside</p>")
  await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir")

  return { root, outside, temp, [Symbol.asyncDispose]: () => rm(temp, { recursive: true, force: true }) }
}

// The path forms of tabs.open and navigate, and uploads: each checked against its own operation and `preview`, and a
// path that is not a file inside the workspace refused before the desktop hears of it.
describe("the file route", () => {
  const forms = (path: string): [string, object][] => [["tabs.open", { path }], ["navigate", { tabID, path }]]

  test("names its own operation and preview to the permission check, and shows a file inside the workspace", async () => {
    await using dir = await workspace()
    const fake = plugin({ directory: dir.root, sessions: [session("ses_a", dir.root)], answer: { path: "chart.svg" } })

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* BrowserConnection.make(fake.context).pipe(Effect.flatMap((connection) => BrowserTools.register(fake.context, connection)))
        yield* fake.attach("ses_a")
        const shown = yield* fake.run("tabs.open", { path: "chart.svg" }, "ses_a")
        expect(shown).toMatchObject({ output: { path: "chart.svg", shown: "file" } })
        yield* fake.run("navigate", { tabID, path: "chart.svg" }, "ses_a").pipe(Effect.exit)
      }).pipe(Effect.scoped),
    )

    expect(fake.asserts.filter((call) => call.action === "browser").map((call) => call.resources)).toEqual([["tabs.open", "preview"], ["navigate", "preview"]])
    expect(fake.commands()).toBe(1)
  })

  test.each([
    ["preview", "[browser.denied] Showing a workspace file in the browser (permission browser.preview) is denied"],
    ["tabs.open", "[browser.denied] browser.tabs.open is denied"],
  ])("a deny of %s refuses tabs.open({ path }) and sends nothing", async (operation, message) => {
    await using dir = await workspace()
    const fake = plugin({ directory: dir.root, agents: { build: [rule(operation, "deny")] }, sessions: [session("ses_a", dir.root)] })
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        yield* BrowserConnection.make(fake.context).pipe(Effect.flatMap((connection) => BrowserTools.register(fake.context, connection)))
        yield* fake.attach("ses_a")

        return yield* fake.run("tabs.open", { path: "page.html" }, "ses_a").pipe(Effect.flip)
      }).pipe(Effect.scoped),
    )

    expect(error.message).toStartWith(message)
    expect(fake.commands()).toBe(0)
  })

  test("refuses what is not a file inside the workspace, with its code, and sends nothing", async () => {
    await using dir = await workspace()
    const fake = plugin({ directory: dir.root, sessions: [session("ses_a", dir.root)] })
    const rows: [string, string][] = [
      ["missing.html", "file_not_found"],
      ["site", "is_directory"],
      ["../beside.html", "outside_workspace"],
      [join(dir.temp, "beside.html"), "outside_workspace"],
      ["escape/secret.html", "outside_workspace"],
      ["workspace://ses_other/page.html", "outside_workspace"],
      ["site/\u0001.html", "invalid_path"],
    ]
    const codes = await Effect.runPromise(
      Effect.gen(function* () {
        yield* BrowserConnection.make(fake.context).pipe(Effect.flatMap((connection) => BrowserTools.register(fake.context, connection)))
        yield* fake.attach("ses_a")

        return yield* Effect.forEach(rows.flatMap(([path]) => forms(path)), ([operation, args]) =>
          fake.run(operation, args, "ses_a").pipe(Effect.flip, Effect.map((error) => error.metadata?.code)),
        )
      }).pipe(Effect.scoped),
    )

    expect(codes).toEqual(rows.flatMap(([, code]) => [code, code]))
    expect(fake.commands()).toBe(0)
  })

  test("an upload needs read permission for the file, and external_directory outside the workspace, before anything is sent", async () => {
    await using dir = await workspace()
    await writeFile(join(dir.root, "blocked.txt"), "blocked")
    const fake = plugin({
      directory: dir.root,
      sessions: [session("ses_a", dir.root)],
      deny: (call) =>
        (call.action === "read" && call.resources.includes("blocked.txt")) || call.action === "external_directory" ? `Permission denied: ${call.action}` : undefined,
    })
    const messages = await Effect.runPromise(
      Effect.gen(function* () {
        yield* BrowserConnection.make(fake.context).pipe(Effect.flatMap((connection) => BrowserTools.register(fake.context, connection)))
        yield* fake.attach("ses_a")

        return yield* Effect.forEach(["blocked.txt", join(dir.temp, "beside.html")], (path) =>
          fake.run("files.upload", { tabID, ref: "e1", paths: [path] }, "ses_a").pipe(Effect.flip, Effect.map((error) => error.message)),
        )
      }).pipe(Effect.scoped),
    )

    expect(messages).toEqual(["Permission denied: read", "Permission denied: external_directory"])
    expect(fake.commands()).toBe(0)
  })
})

// No process has this ID: it is odd, so not a Windows process ID, and above Linux's and macOS's limits.
const exited = 4_194_305

describe("grants", () => {
  test("startup revokes only the grants this location's servers left behind", async () => {
    const owner = (pid: number, host = hostname(), directory = "/workspace") => ({ host, pid, location: { directory } })
    const fake = plugin({
      directory: "/workspace",
      sessions: ["ses_dead", "ses_live", "ses_remote", "ses_elsewhere"].map((id) => session(id, "/workspace", { permissions: [rule("*", "deny", "bash"), ...grant] })),
      storage: {
        "grant:ses_dead": owner(exited),
        "grant:ses_live": owner(process.pid),
        "grant:ses_remote": owner(exited, "other-host"),
        "grant:ses_elsewhere": owner(exited, hostname(), "/other"),
      },
    })

    await Effect.runPromise(BrowserConnection.reconcileStaleGrants(fake.context))

    expect([...fake.sessions.values()].map((row) => [row.id, row.permissions?.length])).toEqual([["ses_dead", 1], ["ses_live", 3], ["ses_remote", 3], ["ses_elsewhere", 3]])
    expect(fake.sessions.get("ses_dead")?.permissions).toEqual([rule("*", "deny", "bash")])
    expect([...fake.storage.keys()]).toEqual(["grant:ses_live", "grant:ses_remote", "grant:ses_elsewhere"])
  })

  test("attaching grants the session, and detaching revokes it and forgets its owner", async () => {
    const fake = plugin({ directory: "/workspace", sessions: [session("ses_a", "/workspace", { permissions: [rule("*", "deny", "bash")] })] })

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* BrowserConnection.make(fake.context)
        const attached = yield* fake.attach("ses_a")
        expect(fake.sessions.get("ses_a")?.permissions).toEqual([rule("*", "deny", "bash"), ...grant])
        expect(fake.storage.get("grant:ses_a")).toMatchObject({ pid: process.pid })

        yield* Fiber.interrupt(attached)
        yield* until(() => !fake.storage.has("grant:ses_a"))
        expect(fake.sessions.get("ses_a")?.permissions).toEqual([rule("*", "deny", "bash")])
      }).pipe(Effect.scoped),
    )
  })

  test("a subagent's session loses the grant it inherited when its first prompt is admitted; one with its own attachment keeps it", async () => {
    const fake = plugin({
      directory: "/workspace",
      sessions: [
        session("ses_parent", "/workspace"),
        session("ses_child", "/workspace", { agent: "general", parentID: "ses_parent", permissions: grant }),
        session("ses_viewed", "/workspace", { agent: "general", parentID: "ses_parent" }),
      ],
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* BrowserConnection.make(fake.context)
        yield* fake.attach("ses_viewed")
        yield* fake.prompt("ses_child")
        yield* fake.prompt("ses_viewed")
        // Read before the plugin's disposal, which revokes every attachment's grant.
        expect(fake.sessions.get("ses_child")?.permissions).toEqual([])
        expect(fake.sessions.get("ses_viewed")?.permissions).toEqual(grant)
      }).pipe(Effect.scoped),
    )
  })
})
