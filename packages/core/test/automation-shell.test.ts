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
      Bun.write(
        path.join(directory, "opencode.json"),
        JSON.stringify({ experimental: { automations: true } }),
      ),
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
