import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Automation } from "@opencode/core/automation"
import { AutomationTable } from "@opencode/core/automation/sql"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Instance } from "@opencode/core/instance/service"
import { Permission } from "@opencode/core/permission"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionInboxTable } from "@opencode/core/session/sql"
import { AbsolutePath } from "@opencode/schema/schema"
import { Tool } from "@opencode/schema/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { Clock, Effect, Fiber, Layer, Schedule } from "effect"
import { rm } from "node:fs/promises"
import path from "node:path"
import { offlineModels } from "./fixture/models"
import { disabledPersistentPtyLayer } from "./fixture/persistent-pty"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Automation.node, Bus.node, Database.node, Instance.node, Session.node]), [
    offlineModels,
    PersistentPty.node.replace(disabledPersistentPtyLayer),
    SessionExecution.node.replace(
      Layer.mock(SessionExecution.Service, { wake: () => Effect.die("Shell actions must not wake a session") }),
    ),
  ]),
)

const command = "echo automation-output; exit 7"
const trigger = { type: "every", every: "1 hour" } as const

it.live("approves the fixed command once and records a failed exit without waking a session", () =>
  Effect.gen(function* () {
    const directory = AbsolutePath.make((yield* tmpdirScoped()).path)
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "opencode.json"),
        JSON.stringify({ experimental: { automations: true }, permission: { shell: "ask" } }),
      ),
    )
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ location: { directory } })
    const instances = yield* Instance.Service
    const automations = yield* Automation.Service
    const invocation = Permission.invocation({
      sessionID: session.id,
      agent: Agent.defaultID,
      messageID: SessionMessage.ID.make("msg_automation_shell"),
      id: Tool.CallID.make("automation_create"),
    })
    const create = yield* automations
      .create({ name: "shell test", sessionID: session.id, trigger, action: { type: "shell", command } }, invocation)
      .pipe(Effect.forkChild)

    yield* Effect.gen(function* () {
      const permission = yield* Permission.Service
      const asks = yield* permission
        .forSession(session.id)
        .pipe(
          Effect.repeat({ until: (asks) => asks.length > 0, schedule: Schedule.spaced("10 millis") }),
          Effect.timeout("10 seconds"),
        )
      expect(asks).toMatchObject([
        {
          action: "shell",
          resources: ["echo automation-output", "exit 7"],
          metadata: { automation: "shell test", trigger, unattended: true, command },
          source: invocation.source,
        },
      ])
      expect(asks[0]?.save).toBeUndefined()
      for (const ask of asks) yield* permission.reply({ requestID: ask.id, reply: "once" })
    }).pipe(instances.provide(session))

    const created = yield* Fiber.join(create)
    const database = yield* Database.Service
    yield* database.db
      .update(AutomationTable)
      .set({ next_due_at: yield* Clock.currentTimeMillis })
      .where(eq(AutomationTable.id, created.id))
      .run()
    yield* automations.tick
    const ran = yield* automations
      .get(created.id)
      .pipe(
        Effect.repeat({ until: (row) => row.lastOutput !== undefined, schedule: Schedule.spaced("10 millis") }),
        Effect.timeout("10 seconds"),
      )
    expect(ran).toMatchObject({
      status: "active",
      runCount: 1,
      lastOutcome: "failed",
      lastOutput: expect.stringMatching(/^Exit code: 7\s+automation-output/),
    })
    expect(yield* database.db.select().from(SessionInboxTable).all()).toEqual([])
  }),
)

it.live("uses the saved location after the creating session moves and pauses if that directory disappears", () =>
  Effect.gen(function* () {
    const directory = AbsolutePath.make((yield* tmpdirScoped()).path)
    const destination = AbsolutePath.make((yield* tmpdirScoped()).path)
    yield* Effect.promise(() =>
      Bun.write(path.join(directory, "opencode.json"), JSON.stringify({ experimental: { automations: true } })),
    )
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      location: { directory },
      permissions: [{ action: "shell", resource: "*", effect: "allow" }],
    })
    const automations = yield* Automation.Service
    const created = yield* automations.create({
      name: "saved location",
      sessionID: session.id,
      trigger,
      action: { type: "shell", command: "echo automation-output" },
    })
    const directories: string[] = []
    const instances = yield* Instance.Service
    yield* Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("shell", "create.before", (input) =>
        Effect.sync(() => {
          directories.push(input.cwd)
        }),
      )
    }).pipe(instances.provide(session))

    // This fixture does not run the session inbox. Project the move directly.
    const bus = yield* Bus.Service
    yield* bus.publish(SessionEvent.Moved, {
      sessionID: session.id,
      location: { directory: destination },
      projectID: session.projectID,
    })
    expect((yield* sessions.get(session.id)).location.directory).toBe(destination)

    const database = yield* Database.Service
    const tick = Effect.gen(function* () {
      yield* database.db
        .update(AutomationTable)
        .set({ next_due_at: yield* Clock.currentTimeMillis })
        .where(eq(AutomationTable.id, created.id))
        .run()
      yield* automations.tick
    })
    yield* tick
    const ran = yield* automations
      .get(created.id)
      .pipe(
        Effect.repeat({ until: (row) => row.lastOutput !== undefined, schedule: Schedule.spaced("10 millis") }),
        Effect.timeout("10 seconds"),
      )
    expect(ran).toMatchObject({ lastOutcome: "fired", lastOutput: expect.stringContaining("automation-output") })
    expect(directories).toEqual([directory])

    yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
    yield* tick
    expect(yield* automations.get(created.id)).toMatchObject({
      status: "paused",
      runCount: 1,
      lastOutput: `Directory no longer exists: ${directory}`,
    })
    expect(directories).toEqual([directory])
  }),
)

it.live("rejects a shell action that changes to a denied external directory", () =>
  Effect.gen(function* () {
    const directory = AbsolutePath.make((yield* tmpdirScoped()).path)
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "opencode.json"),
        JSON.stringify({
          experimental: { automations: true },
          permission: { shell: "allow", external_directory: "deny" },
        }),
      ),
    )
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ location: { directory } })
    const automations = yield* Automation.Service
    const error = yield* automations
      .create(
        {
          name: "outside",
          sessionID: session.id,
          trigger,
          action: { type: "shell", command: "cd ..; echo outside" },
        },
        Permission.invocation({
          sessionID: session.id,
          agent: Agent.defaultID,
          messageID: SessionMessage.ID.make("msg_external_directory"),
          id: Tool.CallID.make("automation_create"),
        }),
      )
      .pipe(Effect.flip)
    expect(error).toMatchObject({
      _tag: "Permission.BlockedError",
      permission: "external_directory",
    })
    expect(yield* automations.list()).toEqual([])
  }),
)

// Run the scheduled action without waiting for the one-hour interval.
const tickCode = (id: Automation.ID) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    yield* database.db
      .update(AutomationTable)
      .set({ next_due_at: yield* Clock.currentTimeMillis })
      .where(eq(AutomationTable.id, id))
      .run()
    const automations = yield* Automation.Service
    yield* automations.tick
    return yield* automations.get(id)
  })

const approveCodePermission = (action: string, tools: string[], session: Session.Info) =>
  Instance.Service.use((instances) =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const asks = yield* permission
        .forSession(session.id)
        .pipe(
          Effect.repeat({ until: (asks) => asks.length > 0, schedule: Schedule.spaced("10 millis") }),
          Effect.timeout("10 seconds"),
        )
      expect(asks).toMatchObject([
        { action, resources: expect.arrayContaining(["*"]), metadata: { unattended: true, tools } },
      ])
      expect(asks[0]?.save).toBeUndefined()
      for (const ask of asks) yield* permission.reply({ requestID: ask.id, reply: "once" })
    }).pipe(instances.provide(session)),
  )

it.live("scheduled code can fetch after webfetch approval with full Code Mode off", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ready") })),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const directory = AbsolutePath.make((yield* tmpdirScoped()).path)
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "opencode.json"),
        JSON.stringify({
          experimental: { automations: true, full_codemode: false },
          permission: { execute: "allow", webfetch: "ask" },
        }),
      ),
    )
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ location: { directory } })
    const automations = yield* Automation.Service
    const creating = yield* automations
      .create({
        sessionID: session.id,
        name: "fetch",
        trigger,
        action: {
          type: "code",
          code: `const res = await fetch(${JSON.stringify(server.url.href)}); return { state: await res.text(), done: true }`,
        },
      })
      .pipe(Effect.forkChild)
    yield* approveCodePermission("webfetch", [], session)
    const created = yield* Fiber.join(creating)
    expect(yield* tickCode(created.id)).toMatchObject({ status: "done", lastOutcome: "fired", state: "ready" })
  }),
)

it.live("scheduled code uses the session files and runs shell after one approval in full Code Mode", () =>
  Effect.gen(function* () {
    const directory = AbsolutePath.make((yield* tmpdirScoped()).path)
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "opencode.json"),
        JSON.stringify({
          experimental: { automations: true, full_codemode: true },
          permission: {
            execute: "allow",
            read: "ask",
            edit: "ask",
            glob: "ask",
            external_directory: "ask",
            shell: "ask",
          },
        }),
      ),
    )
    yield* Effect.promise(() => Bun.write(path.join(directory, "fixture.txt"), "fixture contents"))
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ location: { directory } })
    const automations = yield* Automation.Service
    const creating = yield* automations
      .create({
        name: "code shell",
        sessionID: session.id,
        trigger,
        action: {
          type: "code",
          code: `
          const file = Bun.file(path.resolve("fixture.txt"))
          const shell = await tools.shell({ command: "echo automation-output", description: "Print a test line" })
          return { state: { file: await file.text(), output: shell.output.trim(), exitCode: shell.exitCode }, done: true }
        `,
        },
      })
      .pipe(Effect.forkChild)

    yield* approveCodePermission("shell", ["shell"], session)
    yield* approveCodePermission("read", ["shell"], session)
    yield* approveCodePermission("external_directory", ["shell"], session)

    const created = yield* Fiber.join(creating).pipe(Effect.timeout("10 seconds"))
    expect(yield* tickCode(created.id)).toMatchObject({
      status: "done",
      lastOutcome: "fired",
      state: { file: "fixture contents", output: "automation-output", exitCode: 0 },
    })

    const creatingGlob = yield* automations
      .create({
        name: "scan for fixtures",
        sessionID: session.id,
        trigger,
        action: { type: "code", code: 'await new Bun.Glob("*.txt").scan(); return { done: true }' },
      })
      .pipe(Effect.forkChild)
    yield* approveCodePermission("read", [], session)
    yield* approveCodePermission("external_directory", [], session)

    const glob = yield* Fiber.join(creatingGlob).pipe(Effect.timeout("10 seconds"))
    expect(yield* tickCode(glob.id)).toMatchObject({
      status: "paused",
      lastOutcome: "failed",
      lastOutput: expect.stringContaining("Permission glob needs approval"),
    })
  }),
)

it.live("scheduled Bun.write asks for edit and external directory, not read or glob", () =>
  Effect.gen(function* () {
    const directory = AbsolutePath.make((yield* tmpdirScoped()).path)
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "opencode.json"),
        JSON.stringify({
          experimental: { automations: true, full_codemode: true },
          permission: { execute: "allow", edit: "ask", read: "ask", glob: "ask", external_directory: "ask" },
        }),
      ),
    )
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ location: { directory } })
    const automations = yield* Automation.Service
    const creating = yield* automations
      .create({
        name: "write a fixture",
        sessionID: session.id,
        trigger,
        action: { type: "code", code: 'await Bun.write("fixture.txt", "written"); return { done: true }' },
      })
      .pipe(Effect.forkChild)
    yield* approveCodePermission("edit", [], session)
    yield* approveCodePermission("external_directory", [], session)

    const created = yield* Fiber.join(creating).pipe(Effect.timeout("10 seconds"))
    expect(yield* tickCode(created.id)).toMatchObject({ status: "done", lastOutcome: "fired" })
    expect(yield* Effect.promise(() => Bun.file(path.join(directory, "fixture.txt")).text())).toBe("written")
  }),
)
