import { describe, expect } from "bun:test"
import path from "path"
import { FileSystem } from "@opencode/core/filesystem"
import { Clock, DateTime, Effect, Fiber, Latch, Layer, LayerMap, Queue, Schema, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { ExitCode, makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { TestClock } from "effect/testing"
import { eq } from "drizzle-orm"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Image } from "@opencode/core/image"
import { Instance } from "@opencode/core/instance/service"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "@opencode/core/bus"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Schedule } from "@opencode/core/schedule"
import { ScheduleTable } from "@opencode/core/schedule/sql"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionInboxTable, SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { ShellSelect } from "@opencode/core/shell/select"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Snapshot } from "@opencode/core/snapshot"
import { Skill } from "@opencode/core/skill"
import { Config } from "@opencode/core/config"
import { Global } from "@opencode/util/global"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"

const enabledDirectory = "/enabled"
const disabledDirectory = "/disabled"
const toggleDirectory = "/toggle"
const missingDirectory = "/missing"
const globalDirectory = "/global"

const wakes: Session.ID[] = []
/** Runs inside the next wake, which happens while a schedule is firing. */
let duringWake: Effect.Effect<void> = Effect.void
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set()),
    isActive: () => Effect.succeed(false),
    resume: () => Effect.void,
    interrupt: () => Effect.succeed(false),
    wake: (sessionID) =>
      Effect.suspend(() => {
        wakes.push(sessionID)
        const effect = duringWake
        duringWake = Effect.void
        return effect
      }),
    awaitIdle: () => Effect.void,
  }),
)
const enabledEntries = [
  new Document({
    type: "document",
    info: new Info({
      timezone: "America/New_York",
      experimental: new ConfigExperimental.Info({ schedules: true }),
    }),
  }),
]
const disabledEntries = [
  new Document({
    type: "document",
    info: new Info({
      experimental: new ConfigExperimental.Info({ schedules: false }),
    }),
  }),
]
const enabled = Config.testLayer(enabledEntries)
const disabled = Config.testLayer(disabledEntries)
/** The global location's flag for session-less schedules. */
const globalFlag = { on: false }
/** A location whose flag the test turns on, counting every config read. */
const toggle = { on: false, reads: 0 }
const readToggle = () => {
  toggle.reads++
  return toggle.on ? enabledEntries : disabledEntries
}
const toggled = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () => Effect.sync(() => readToggle()),
    snapshot: () => readToggle(),
    changes: () => Stream.empty,
  }),
)
/** Fake shell state and permission rules reset by `setup`. */
const shellState = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  hangMs: 0,
  runs: [] as string[],
  envs: [] as (Record<string, unknown> | undefined)[],
  cwds: [] as (string | undefined)[],
  stdins: [] as (string | undefined)[],
  missingNow: false,
  die: undefined as string | undefined,
  interrupts: 0,
}
const slack = { replies: 0, reads: 0, exports: 0, failing: false }
let agentRules: Permission.Ruleset = [{ action: "*", resource: "*", effect: "allow" }]
let activationGate: Effect.Effect<void> = Effect.void

const testEnvironment = Layer.effect(
  Environment.Service,
  Effect.gen(function* () {
    const memory = Environment.makeMemoryDriver()
    const files = Environment.makeFiles(memory)
    yield* files.mkdir(enabledDirectory).pipe(Effect.orDie)
    yield* files.mkdir(toggleDirectory).pipe(Effect.orDie)
    yield* files.mkdir(globalDirectory).pipe(Effect.orDie)
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        const script = command._tag === "StandardCommand" ? String(command.args.at(-1) ?? command.command) : "pipeline"
        shellState.runs.push(script)
        shellState.envs.push(command._tag === "StandardCommand" ? command.options.env : undefined)
        shellState.cwds.push(command._tag === "StandardCommand" ? command.options.cwd : undefined)
        const stdin = command._tag === "StandardCommand" ? command.options.stdin : undefined
        shellState.stdins.push(
          Stream.isStream(stdin)
            ? new TextDecoder().decode(Buffer.concat(Array.from(yield* Stream.runCollect(stdin))))
            : typeof stdin === "string"
              ? stdin
              : undefined,
        )
        if (shellState.die !== undefined) return yield* Effect.die(new Error(shellState.die))
        const outBytes = new TextEncoder().encode(shellState.stdout)
        const errBytes = new TextEncoder().encode(shellState.stderr)
        // The hang belongs to the exit code, not to spawn, so a command that writes before it keeps running still
        // produces output and a timeout keeps it.
        const hang = shellState.hangMs
        return makeHandle({
          pid: ProcessId(1),
          exitCode:
            hang > 0
              ? Effect.sleep(hang).pipe(
                  Effect.onInterrupt(() =>
                    Effect.sync(() => {
                      shellState.interrupts++
                    }),
                  ),
                  Effect.as(ExitCode(shellState.exitCode)),
                )
              : Effect.succeed(ExitCode(shellState.exitCode)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: outBytes.byteLength > 0 ? Stream.make(outBytes) : Stream.empty,
          stderr: errBytes.byteLength > 0 ? Stream.make(errBytes) : Stream.empty,
          all: outBytes.byteLength > 0 ? Stream.make(outBytes) : Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        })
      }),
    )
    return Environment.Service.of({ files, spawner })
  }),
)

const configureAgent = Layer.effectDiscard(
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const tools = yield* Tool.Service
    const permission = yield* Permission.Service
    yield* agents.transform((editor) =>
      editor.update(Agent.defaultID, (agent) => {
        agent.permissions = [...agentRules]
      }),
    )
    yield* tools.transform((editor) => {
      editor.add({
        name: "read_thread",
        description: "Read the thread",
        input: Schema.Struct({}),
        output: Schema.Struct({ replies: Schema.Number }),
        options: { namespace: "slack" },
        execute: (_input, context) =>
          permission
            .assert({
              action: "slack_read_thread",
              resources: ["*"],
              sessionID: context.sessionID,
              agent: context.agent,
            })
            .pipe(
              Effect.orDie,
              Effect.flatMap(() => {
                if (slack.failing) return Effect.fail(new Tool.Error({ message: "Slack is down" }))
                slack.reads++
                return Effect.succeed({ output: { replies: slack.replies } })
              }),
            ),
      })
      editor.add({
        name: "export_thread",
        description: "Export the thread to a file",
        input: Schema.Struct({}),
        options: { namespace: "slack" },
        execute: (_input, context) =>
          permission
            .assert({ action: "file_write", resources: ["*"], sessionID: context.sessionID, agent: context.agent })
            .pipe(
              Effect.orDie,
              Effect.map(() => {
                slack.exports++
                return { content: "exported" }
              }),
            ),
      })
      editor.add({
        name: "dangerous_edit",
        description: "Mutates files",
        input: Schema.Struct({}),
        options: { namespace: "slack", permission: "edit" },
        execute: () => Effect.succeed({ content: "edited" }),
      })
    })
  }),
)

const locations = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const saved = yield* PermissionSaved.Service
      return yield* LayerMap.make(
        (ref: Location.Ref): Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError> => {
          if (ref.directory === missingDirectory && shellState.missingNow) {
            return Layer.effectDiscard(
              Effect.fail(
                new FileSystem.DirectoryNotFoundError({ directory: ref.directory, cause: new Error("missing") }),
              ),
            ) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>
          }
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          return Layer.mergeAll(
            ref.directory === globalDirectory
              ? globalFlag.on
                ? enabled
                : disabled
              : ref.directory === enabledDirectory || ref.directory === missingDirectory
                ? enabled
                : ref.directory === toggleDirectory
                  ? toggled
                  : disabled,
            configureAgent.pipe(
              Layer.provideMerge(
                LayerNode.compile(
                  LayerNode.group([
                    Location.node,
                    Environment.node,
                    PluginHooks.node,
                    Skill.node,
                    Tool.node,
                    Agent.node,
                    Permission.node,
                    FileAccess.node,
                  ]),
                  {
                    replacements: [
                      Bus.node.replace(Layer.succeed(Bus.Service, bus)),
                      SessionStore.node.replace(Layer.succeed(SessionStore.Service, store)),
                      PermissionSaved.node.replace(Layer.succeed(PermissionSaved.Service, saved)),
                      Location.node.replace(Layer.succeed(Location.Service, location(ref))),
                      Environment.node.replace(testEnvironment),
                      Image.node.replace(imagePassthrough),
                    ],
                  },
                ),
              ),
            ),
            Layer.mock(McpTool.Service, { flush: Effect.void }),
            Layer.succeed(
              ShellSelect.Service,
              ShellSelect.Service.of({
                transform: () => Effect.die("unused"),
                reload: () => Effect.void,
                resolve: () => Effect.succeed("/bin/bash"),
              }),
            ),
            Layer.mock(Snapshot.Service, { capture: () => Effect.undefined, restore: () => Effect.void }),
            Layer.succeed(Plugin.Service, {
              awaitActivation: Effect.suspend(() => activationGate),
            } as unknown as Plugin.Interface),
          ).pipe(Layer.fresh) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>
        },
      )
    }),
  ),
  deps: [Bus.node, SessionStore.node, PermissionSaved.node],
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      Schedule.node,
      Instance.node,
      LocationServiceMap.node,
      Global.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      SessionExecution.node.replace(execution),
      LocationServiceMap.node.replace(locations),
      Global.node.replace(Layer.succeed(Global.Service, Global.make({ config: globalDirectory }))),
    ],
  ),
)

const sessionID = Session.ID.make("ses_schedule_test")

const setup = (directory = enabledDirectory) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({ id: sessionID, project_id: Project.ID.global, slug: "test", directory, title: "test", version: "test" })
      .run()
      .pipe(Effect.orDie)
    wakes.length = 0
    duringWake = Effect.void
    toggle.on = false
    toggle.reads = 0
    globalFlag.on = false
    shellState.exitCode = 0
    shellState.stdout = ""
    shellState.stderr = ""
    shellState.hangMs = 0
    shellState.runs = []
    shellState.envs = []
    shellState.cwds = []
    shellState.stdins = []
    shellState.missingNow = false
    shellState.die = undefined
    shellState.interrupts = 0
    slack.replies = 0
    slack.reads = 0
    slack.exports = 0
    slack.failing = false
    agentRules = [{ action: "*", resource: "*", effect: "allow" }]
    activationGate = Effect.void
    return yield* Schedule.Service
  })

const setTime = (iso: string) => TestClock.setTime(Date.parse(iso))
const pending = Database.Service.use(({ db }) =>
  db
    .select({ id: SessionInboxTable.id })
    .from(SessionInboxTable)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => rows.map((row) => row.id)),
    ),
)
const scheduleRow = (id: Schedule.ID) =>
  Database.Service.use(({ db }) =>
    db.select().from(ScheduleTable).where(eq(ScheduleTable.id, id)).get().pipe(Effect.orDie),
  )
/** Moves pending prompts into the transcript, as a running Session would. */
const deliver = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* SessionInbox.promote(db, yield* Bus.Service, sessionID, "steer")
})
const messageID = (schedule: Schedule.Info, run: number) => SessionMessage.ID.make(`msg_${schedule.id}_${run}`)
const iso = (time: DateTime.Utc | undefined) => time && DateTime.formatIso(time)

describe("Schedule", () => {
  it.effect("fires an in schedule once", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const schedule = yield* schedules.create({
        sessionID,
        when: { type: "in", in: "5 minutes" },
        action: { type: "prompt", prompt: "check the build" },
      })
      expect(schedule.tz).toBe("America/New_York")

      yield* TestClock.adjust("4 minutes")
      yield* schedules.tick
      expect(yield* pending).toEqual([])

      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(yield* pending).toEqual([messageID(schedule, 1)])
      expect(wakes).toEqual([sessionID])
      const { db } = yield* Database.Service
      expect(yield* SessionInbox.find(db, messageID(schedule, 1))).toMatchObject({
        type: "user",
        delivery: "steer",
        payload: { text: "check the build" },
      })
      expect(yield* schedules.get(schedule.id)).toMatchObject({
        status: "done",
        runCount: 1,
        lastOutcome: "fired",
        nextDueAt: undefined,
      })

      yield* TestClock.adjust("10 minutes")
      yield* schedules.tick
      expect(yield* pending).toEqual([messageID(schedule, 1)])
    }),
  )

  it.effect("fires an at schedule at the wall-clock time in its zone", () =>
    Effect.gen(function* () {
      yield* setTime("2026-11-01T12:00:00Z")
      const schedules = yield* setup()
      const schedule = yield* schedules.create({
        sessionID,
        when: { type: "at", at: "2026-11-02T09:30", tz: "Europe/Paris" },
        action: { type: "prompt", prompt: "standup" },
      })
      expect(iso(schedule.nextDueAt)).toBe("2026-11-02T08:30:00.000Z")
      expect(
        yield* Effect.flip(
          schedules.create({
            sessionID,
            when: { type: "at", at: "2026-11-01T11:00:00Z" },
            action: { type: "prompt", prompt: "too late" },
          }),
        ),
      ).toMatchObject({ _tag: "Schedule.InvalidError" })

      yield* setTime("2026-11-02T08:30:00Z")
      yield* schedules.tick
      expect(yield* pending).toEqual([messageID(schedule, 1)])
      expect((yield* schedules.get(schedule.id)).status).toBe("done")
    }),
  )

  it.effect("stops an every schedule after ends.times", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const schedule = yield* schedules.create({
        sessionID,
        when: { type: "every", every: "1 minute" },
        ends: { times: 2 },
        action: { type: "prompt", prompt: "poll" },
      })
      for (const _ of [1, 2, 3]) {
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        yield* deliver
      }
      expect(yield* schedules.get(schedule.id)).toMatchObject({ status: "done", runCount: 2, remainingRuns: 0 })
      expect(wakes).toEqual([sessionID, sessionID])
    }),
  )

  it.effect("stops an every schedule at ends.at", () =>
    Effect.gen(function* () {
      yield* setTime("2026-10-26T12:00:00Z")
      const schedules = yield* setup()
      const schedule = yield* schedules.create({
        sessionID,
        when: { type: "every", every: "10 minutes" },
        ends: { at: "2026-10-26T12:25:00Z" },
        action: { type: "prompt", prompt: "poll" },
      })
      for (const _ of [1, 2, 3]) {
        yield* TestClock.adjust("10 minutes")
        yield* schedules.tick
        yield* deliver
      }
      expect(yield* schedules.get(schedule.id)).toMatchObject({ status: "done", runCount: 2 })
    }),
  )

  it.effect("keeps cron at the same wall-clock time across a DST change", () =>
    Effect.gen(function* () {
      yield* setTime("2026-10-31T12:00:00Z")
      const schedules = yield* setup()
      const schedule = yield* schedules.create({
        sessionID,
        when: { type: "cron", cron: "30 9 * * *", tz: "America/New_York" },
        action: { type: "prompt", prompt: "morning" },
      })
      expect(iso(schedule.nextDueAt)).toBe("2026-10-31T13:30:00.000Z")

      yield* setTime("2026-10-31T13:30:00Z")
      yield* schedules.tick
      expect(iso((yield* schedules.get(schedule.id)).nextDueAt)).toBe("2026-11-01T14:30:00.000Z")
    }),
  )

  it.effect("catches up once after downtime, marked late, and keeps the phase", () =>
    Effect.gen(function* () {
      yield* setTime("2026-10-26T12:00:00Z")
      const schedules = yield* setup()
      const schedule = yield* schedules.create({
        sessionID,
        when: { type: "every", every: "10 minutes" },
        action: { type: "prompt", prompt: "poll" },
      })

      yield* setTime("2026-10-26T13:05:00Z")
      yield* schedules.tick
      yield* schedules.tick
      expect(yield* pending).toEqual([messageID(schedule, 1)])
      const { db } = yield* Database.Service
      expect(yield* SessionInbox.find(db, messageID(schedule, 1))).toMatchObject({
        payload: { metadata: { schedule: { id: schedule.id, run: 1, late: true } } },
      })
      expect(yield* schedules.get(schedule.id)).toMatchObject({ runCount: 1, lastOutcome: "late" })
      expect(iso((yield* schedules.get(schedule.id)).nextDueAt)).toBe("2026-10-26T13:10:00.000Z")
    }),
  )

  it.effect("skips a firing while the previous prompt is unconsumed", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const schedule = yield* schedules.create({
        sessionID,
        when: { type: "every", every: "1 minute" },
        action: { type: "prompt", prompt: "poll" },
      })
      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(yield* pending).toEqual([messageID(schedule, 1)])
      expect(yield* schedules.get(schedule.id)).toMatchObject({ runCount: 1, lastOutcome: "skipped" })
      // The skip wakes the Session again in case the wake after admission was lost.
      expect(wakes).toEqual([sessionID, sessionID])

      yield* deliver
      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(yield* pending).toEqual([messageID(schedule, 2)])
    }),
  )

  it.effect("does not duplicate a prompt admitted before a crash", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const sessions = yield* Session.Service
      const schedule = yield* schedules.create({
        sessionID,
        when: { type: "in", in: "1 minute" },
        action: { type: "prompt", prompt: "once" },
      })
      yield* TestClock.adjust("1 minute")
      // The previous process admitted run 1 and died before advancing the row.
      yield* sessions.prompt({ sessionID, id: messageID(schedule, 1), text: "once", resume: false })

      yield* schedules.tick
      expect(yield* pending).toEqual([messageID(schedule, 1)])
      expect(wakes).toEqual([sessionID])
      expect(yield* schedules.get(schedule.id)).toMatchObject({ status: "done", runCount: 1 })
    }),
  )

  it.effect("removes a Session's schedules with the Session", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      yield* schedules.create({
        sessionID,
        when: { type: "every", every: "1 hour" },
        action: { type: "prompt", prompt: "poll" },
      })
      const { db } = yield* Database.Service
      yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
      expect(yield* schedules.list()).toEqual([])
    }),
  )

  it.effect("does nothing when experimental.schedules is off", () =>
    Effect.gen(function* () {
      const schedules = yield* setup(disabledDirectory)
      expect(
        yield* Effect.flip(
          schedules.create({
            sessionID,
            when: { type: "in", in: "1 minute" },
            action: { type: "prompt", prompt: "poll" },
          }),
        ),
      ).toMatchObject({ _tag: "Schedule.DisabledError" })

      const { db } = yield* Database.Service
      yield* db
        .insert(ScheduleTable)
        .values({
          id: Schedule.ID.create(),
          session_id: sessionID,
          action: { type: "prompt", prompt: "poll" },
          when: { type: "in", in: "1 minute" },
          tz: "UTC",
          next_due_at: 0,
          time_created: 0,
          time_updated: 0,
        })
        .run()
        .pipe(Effect.orDie)
      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(yield* pending).toEqual([])
      expect((yield* schedules.list())[0]).toMatchObject({ runCount: 0 })
    }),
  )

  it.effect("fires a session-less shell action in the global location", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      globalFlag.on = true
      shellState.stdout = "hi"

      const schedule = yield* schedules.create({
        when: { type: "in", in: "5 minutes" },
        action: { type: "shell", run: "echo hi", timeout: "1 minute" },
      })
      expect(schedule.sessionID).toBeUndefined()

      const { db } = yield* Database.Service
      const row = yield* db
        .select()
        .from(ScheduleTable)
        .where(eq(ScheduleTable.id, schedule.id))
        .get()
        .pipe(Effect.orDie)
      expect(row?.session_id).toBeNull()

      yield* TestClock.adjust("5 minutes")
      yield* schedules.tick
      expect(shellState.runs).toEqual(["echo hi"])
      // The runtime resolves the Location directory with path.resolve, so Windows expands "/global" to "C:\\global".
      expect(shellState.cwds).toEqual([path.resolve(globalDirectory)])
      expect(shellState.envs[0]).toMatchObject({
        OPENCODE_SCHEDULE_ID: schedule.id,
        OPENCODE_SCHEDULE_RUN: "1",
      })
      expect(wakes).toEqual([])
      expect(yield* pending).toEqual([])
      const info = yield* schedules.get(schedule.id)
      expect(info).toMatchObject({ status: "done", runCount: 1, lastOutcome: "fired" })
      expect(info.lastRun).toMatchObject({ exitCode: 0, output: "hi" })
    }),
  )

  it.effect("skips a session-less schedule while the global flag is off", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      expect(yield* schedules.enabled()).toBe(false)
      expect(
        yield* Effect.flip(
          schedules.create({
            when: { type: "in", in: "5 minutes" },
            action: { type: "shell", run: "echo hi" },
          }),
        ),
      ).toMatchObject({ _tag: "Schedule.DisabledError" })

      // A row left over from when the flag was on stays put until the flag comes back.
      const { db } = yield* Database.Service
      const id = Schedule.ID.create()
      yield* db
        .insert(ScheduleTable)
        .values({
          id,
          session_id: null,
          action: { type: "shell", run: "echo hi" },
          when: { type: "in", in: "1 minute" },
          tz: "UTC",
          next_due_at: 0,
          time_created: 0,
          time_updated: 0,
        })
        .run()
        .pipe(Effect.orDie)
      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(shellState.runs).toEqual([])
      expect(yield* schedules.get(id)).toMatchObject({ status: "active", runCount: 0, lastOutcome: "disabled" })
    }),
  )

  it.effect("defaults run_failures to 0", () =>
    Effect.gen(function* () {
      yield* setup()
      const { db } = yield* Database.Service
      const id = Schedule.ID.create()
      yield* db
        .insert(ScheduleTable)
        .values({
          id,
          session_id: null,
          action: { type: "shell", run: "echo hi" },
          when: { type: "in", in: "1 minute" },
          tz: "UTC",
          next_due_at: 0,
          time_created: 0,
          time_updated: 0,
        })
        .run()
        .pipe(Effect.orDie)
      const row = yield* db.select().from(ScheduleTable).where(eq(ScheduleTable.id, id)).get().pipe(Effect.orDie)
      expect(row?.run_failures).toBe(0)
      expect(row?.failures).toBe(0)
    }),
  )

  it.effect("denies a session-less shell action its global config does not allow", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      globalFlag.on = true
      agentRules = [{ action: "*", resource: "*", effect: "deny" }]
      // Boots the global location with the deny rules, so the run is held to them.
      expect(yield* schedules.enabled()).toBe(true)

      const bus = yield* Bus.Service
      const asks: Permission.Request[] = []
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Permission.Event.Asked.type
          ? Effect.sync(() => {
              asks.push(event.data as Permission.Request)
            })
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      const schedule = yield* schedules.create({
        when: { type: "in", in: "1 minute" },
        action: { type: "shell", run: "echo hi" },
      })
      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(shellState.runs).toEqual([])
      expect((yield* schedules.get(schedule.id)).lastRun?.error).toContain(
        "Permission shell (echo hi) is not allowed by the global config",
      )
      // A session-less run has no sessionID to attach a request to, so a rule that would ask is a denial.
      expect(asks).toEqual([])
    }),
  )

  it.effect("runs a session-less shell action its global config allows", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      globalFlag.on = true
      shellState.stdout = "hi"
      agentRules = [
        { action: "external_directory", resource: "*", effect: "allow" },
        { action: "shell", resource: "*", effect: "allow" },
      ]
      expect(yield* schedules.enabled()).toBe(true)

      const schedule = yield* schedules.create({
        when: { type: "in", in: "1 minute" },
        action: { type: "shell", run: "echo hi" },
      })
      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(shellState.runs).toEqual(["echo hi"])
      expect((yield* schedules.get(schedule.id)).lastRun?.error).toBeUndefined()
    }),
  )

  it.effect("holds a session-less shell check to its global config", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      globalFlag.on = true
      agentRules = [{ action: "*", resource: "*", effect: "deny" }]
      expect(yield* schedules.enabled()).toBe(true)

      const schedule = yield* schedules.create({
        when: { type: "every", every: "1 minute" },
        if: { type: "shell", run: "probe" },
        action: { type: "shell", run: "echo hi" },
      })
      for (let index = 0; index < 3; index++) {
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
      }
      expect(shellState.runs).toEqual([])
      const info = yield* schedules.get(schedule.id)
      expect(info).toMatchObject({ status: "paused", lastOutcome: "failed" })
      expect(info.lastRun?.error).toContain("Permission shell (probe) is not allowed by the global config")
    }),
  )

  it.effect("gates a session-less shell action on a shell if check", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      globalFlag.on = true
      shellState.stdout = "new reply"
      const schedule = yield* schedules.create({
        when: { type: "in", in: "1 minute" },
        if: { type: "shell", run: "probe" },
        action: { type: "shell", run: "echo hi" },
      })

      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(shellState.runs).toEqual(["probe", "echo hi"])
      expect(shellState.envs[1]).toMatchObject({
        OPENCODE_SCHEDULE_ID: schedule.id,
        OPENCODE_SCHEDULE_MESSAGE: "new reply",
      })
      expect(yield* schedules.get(schedule.id)).toMatchObject({ status: "done", runCount: 1 })
    }),
  )

  it.effect("runs a session-less until check that already passes at creation", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      globalFlag.on = true
      const schedule = yield* schedules.create({
        until: { type: "shell", run: "true" },
        action: { type: "shell", run: "echo hi" },
      })
      yield* schedules.tick
      expect(shellState.runs).toEqual(["true", "echo hi"])
      const info = yield* schedules.get(schedule.id)
      expect(info).toMatchObject({ status: "done" })
      expect(info.lastRun).toMatchObject({ exitCode: 0 })
    }),
  )

  it.effect("pauses a session-less shell action after 3 failed checks without waking anything", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      globalFlag.on = true
      const schedule = yield* schedules.create({
        when: { type: "every", every: "1 minute" },
        if: { type: "shell", run: "check", is: "ok" },
        action: { type: "shell", run: "echo hi" },
      })
      shellState.exitCode = 1
      shellState.stderr = "nope"

      for (const _ of [1, 2, 3]) {
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
      }
      const info = yield* schedules.get(schedule.id)
      expect(info.status).toBe("paused")
      expect(info.lastRun?.error).toContain("Schedule paused after 3 failed checks")
      expect(shellState.runs).toEqual(["check", "check", "check"])
      expect(wakes).toEqual([])
    }),
  )

  it.effect("refuses a session-less prompt or code check", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      globalFlag.on = true
      const invalid = (input: Schedule.CreateInput) => Effect.flip(schedules.create(input))

      expect(
        yield* invalid({ when: { type: "in", in: "5 minutes" }, action: { type: "prompt", prompt: "poll" } }),
      ).toMatchObject({ _tag: "Schedule.InvalidError" })
      expect(
        yield* invalid({
          when: { type: "every", every: "1 minute" },
          if: { type: "code", code: "true" },
          action: { type: "shell", run: "echo hi" },
        }),
      ).toMatchObject({ _tag: "Schedule.InvalidError" })
      // A shell gate needs nothing but a Location, so it is accepted.
      const accepted = yield* schedules.create({
        when: { type: "every", every: "1 minute" },
        if: { type: "shell", run: "true" },
        action: { type: "shell", run: "echo hi" },
      })
      expect(accepted.status).toBe("active")
    }),
  )

  it.effect("ignores a legacy session-less prompt row", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      globalFlag.on = true
      const { db } = yield* Database.Service
      const id = Schedule.ID.create()
      yield* db
        .insert(ScheduleTable)
        .values({
          id,
          session_id: null,
          action: { type: "prompt", prompt: "poll" },
          when: { type: "in", in: "1 minute" },
          tz: "UTC",
          next_due_at: 0,
          time_created: 0,
          time_updated: 0,
        })
        .run()
        .pipe(Effect.orDie)
      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(wakes).toEqual([])
      expect(yield* pending).toEqual([])
      expect(yield* schedules.get(id)).toMatchObject({ status: "active", runCount: 0, lastOutcome: undefined })
    }),
  )

  it.effect("rechecks a schedule hourly while its location has the flag off, then catches up once it is on", () =>
    Effect.gen(function* () {
      const schedules = yield* setup(toggleDirectory)
      const { db } = yield* Database.Service
      const id = Schedule.ID.create()
      yield* db
        .insert(ScheduleTable)
        .values({
          id,
          session_id: sessionID,
          action: { type: "prompt", prompt: "poll" },
          when: { type: "every", every: "1 minute" },
          tz: "UTC",
          next_due_at: 60_000,
          time_created: 0,
          time_updated: 0,
        })
        .run()
        .pipe(Effect.orDie)
      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(yield* schedules.get(id)).toMatchObject({
        status: "active",
        runCount: 0,
        lastOutcome: "disabled",
        nextDueAt: DateTime.makeUnsafe(60_000),
      })
      const reads = toggle.reads
      expect(reads).toBeGreaterThan(0)

      // Within the hour the location is not booted to read the flag again.
      yield* TestClock.adjust("59 minutes")
      yield* schedules.tick
      expect(toggle.reads).toBe(reads)
      expect(yield* pending).toEqual([])

      // Once the flag is on and the hour has passed, the missed slot fires once, late, and keeps the phase.
      toggle.on = true
      yield* TestClock.adjust("2 minutes")
      yield* schedules.tick
      expect(yield* pending).toEqual([SessionMessage.ID.make(`msg_${id}_1`)])
      expect(yield* schedules.get(id)).toMatchObject({
        status: "active",
        runCount: 1,
        lastOutcome: "late",
        nextDueAt: DateTime.makeUnsafe(63 * 60_000),
      })
    }),
  )

  it.effect("pauses and resumes at the next slot", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const schedule = yield* schedules.create({
        sessionID,
        when: { type: "every", every: "1 minute" },
        action: { type: "prompt", prompt: "poll" },
      })
      expect((yield* schedules.pause(schedule.id)).status).toBe("paused")
      yield* TestClock.adjust("150 seconds")
      yield* schedules.tick
      expect(yield* pending).toEqual([])

      const resumed = yield* schedules.resume(schedule.id)
      expect(resumed.status).toBe("active")
      expect(iso(resumed.nextDueAt)).toBe(new Date(180_000).toISOString())
      yield* schedules.remove(schedule.id)
      expect(yield* Effect.flip(schedules.get(schedule.id))).toMatchObject({ _tag: "Schedule.NotFoundError" })
    }),
  )

  it.effect("keeps the run count when paused while a prompt is being admitted", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const schedule = yield* schedules.create({
        sessionID,
        when: { type: "every", every: "1 minute" },
        action: { type: "prompt", prompt: "poll" },
      })
      yield* TestClock.adjust("1 minute")
      duringWake = schedules.pause(schedule.id).pipe(Effect.orDie, Effect.asVoid)
      yield* schedules.tick
      expect(yield* schedules.get(schedule.id)).toMatchObject({ status: "paused", runCount: 1 })
      yield* deliver

      yield* schedules.resume(schedule.id)
      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(yield* pending).toEqual([messageID(schedule, 2)])
    }),
  )

  it.effect("run sleeps until the next schedule is due", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const fiber = yield* Effect.forkChild(schedules.run)
      const schedule = yield* schedules.create({
        sessionID,
        when: { type: "in", in: "10 seconds" },
        action: { type: "prompt", prompt: "soon" },
      })
      yield* TestClock.adjust("9 seconds")
      expect(yield* pending).toEqual([])
      yield* TestClock.adjust("1 second")
      yield* Effect.yieldNow
      expect(yield* pending).toEqual([messageID(schedule, 1)])
      yield* Fiber.interrupt(fiber)
    }),
  )

  it.effect("fires the last slot when the tick lands just after ends_at", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const schedule = yield* schedules.create({
        sessionID,
        when: { type: "every", every: "10 minutes" },
        ends: { after: "20 minutes" },
        action: { type: "prompt", prompt: "poll" },
      })
      yield* TestClock.adjust("10 minutes")
      yield* schedules.tick
      yield* deliver
      yield* TestClock.adjust(600_001)
      yield* schedules.tick
      expect(yield* pending).toEqual([messageID(schedule, 2)])
      expect(yield* schedules.get(schedule.id)).toMatchObject({ status: "done", runCount: 2, lastOutcome: "fired" })
    }),
  )

  // On 2026-11-01 New York falls back at 06:00Z, so 1:00-1:59 runs twice: 05:00Z EDT, then 06:00Z EST.
  const cron = (schedules: Schedule.Interface, expression: string) =>
    schedules.create({
      sessionID,
      when: { type: "cron", cron: expression, tz: "America/New_York" },
      action: { type: "prompt", prompt: expression },
    })

  it.effect("does not fire a step cron again in the repeated hour", () =>
    Effect.gen(function* () {
      yield* setTime("2026-11-01T05:50:00Z")
      const schedules = yield* setup()
      const schedule = yield* cron(schedules, "*/10 * * * *")
      // 1:50 EDT fired the last 1:xx slot; the next is 2:00 EST, an hour and ten minutes later.
      expect(iso(schedule.nextDueAt)).toBe("2026-11-01T07:00:00.000Z")

      // Created inside the repeated hour, the next slot is the first one after it, not three hours on.
      yield* setTime("2026-11-01T06:35:00Z")
      expect(iso((yield* cron(schedules, "*/10 * * * *")).nextDueAt)).toBe("2026-11-01T07:00:00.000Z")
      expect(iso((yield* cron(schedules, "0,30 * * * *")).nextDueAt)).toBe("2026-11-01T07:00:00.000Z")
      expect(iso((yield* cron(schedules, "0 * * * *")).nextDueAt)).toBe("2026-11-01T07:00:00.000Z")
    }),
  )

  it.effect("fires a fixed-time cron once in the repeated hour", () =>
    Effect.gen(function* () {
      yield* setTime("2026-11-01T05:00:00Z")
      const schedules = yield* setup()
      const schedule = yield* cron(schedules, "30 1 * * *")
      expect(iso(schedule.nextDueAt)).toBe("2026-11-01T05:30:00.000Z")

      yield* setTime("2026-11-01T05:30:00Z")
      yield* schedules.tick
      expect(iso((yield* schedules.get(schedule.id)).nextDueAt)).toBe("2026-11-02T06:30:00.000Z")

      yield* setTime("2026-11-01T06:05:00Z")
      expect(iso((yield* cron(schedules, "30 1 * * *")).nextDueAt)).toBe("2026-11-02T06:30:00.000Z")
    }),
  )

  it.effect("moves cron past the skipped hour when clocks spring forward", () =>
    Effect.gen(function* () {
      // On 2026-03-08 New York jumps from 2:00 EST to 3:00 EDT at 07:00Z.
      yield* setTime("2026-03-08T06:55:00Z")
      const schedules = yield* setup()
      expect(iso((yield* cron(schedules, "*/10 * * * *")).nextDueAt)).toBe("2026-03-08T07:00:00.000Z")
      expect(iso((yield* cron(schedules, "30 2 * * *")).nextDueAt)).toBe("2026-03-08T07:30:00.000Z")
    }),
  )

  it.effect("rejects a cron that never fires", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const error = yield* Effect.flip(
        schedules.create({
          sessionID,
          when: { type: "cron", cron: "0 0 31 2 *" },
          action: { type: "prompt", prompt: "never" },
        }),
      )
      expect(error).toMatchObject({ _tag: "Schedule.InvalidError" })
    }),
  )

  it.effect("wakes a Session on start when its scheduled prompt was never claimed", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      yield* schedules.create({
        sessionID,
        when: { type: "in", in: "1 minute" },
        action: { type: "prompt", prompt: "once" },
      })
      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      // The process died before the Session claimed the prompt, so that wake was lost.
      wakes.length = 0
      const fiber = yield* Effect.forkChild(schedules.run)
      yield* Effect.yieldNow
      expect(wakes).toEqual([sessionID])
      yield* Fiber.interrupt(fiber)
    }),
  )

  it.effect("parses at times with offsets or in the schedule's zone", () =>
    Effect.gen(function* () {
      yield* setTime("2026-11-01T12:00:00Z")
      const schedules = yield* setup()
      const at = (value: string) =>
        schedules
          .create({ sessionID, when: { type: "at", at: value }, action: { type: "prompt", prompt: "at" } })
          .pipe(Effect.map((schedule) => iso(schedule.nextDueAt)))
      expect(yield* at("2026-11-02T09:30:00-0500")).toBe("2026-11-02T14:30:00.000Z")
      expect(yield* at("2026-11-02T09:30:00-05:00")).toBe("2026-11-02T14:30:00.000Z")
      expect(yield* at("2026-11-02T09:30")).toBe("2026-11-02T14:30:00.000Z")
      expect(yield* at("2026-11-02 09:30:00-05:00")).toBe("2026-11-02T14:30:00.000Z")
      expect(yield* at("2026-11-02 14:30:00Z")).toBe("2026-11-02T14:30:00.000Z")
      expect(yield* at("2026-11-02 09:30")).toBe("2026-11-02T14:30:00.000Z")
    }),
  )

  it.effect("run ticks again at once when a schedule fell due while it was firing", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const first = yield* schedules.create({
        sessionID,
        when: { type: "in", in: "10 seconds" },
        action: { type: "prompt", prompt: "first" },
      })
      const second = yield* schedules.create({
        sessionID,
        when: { type: "in", in: "10500 millis" },
        action: { type: "prompt", prompt: "second" },
      })
      // Firing the first schedule takes a second.
      duringWake = TestClock.adjust("1 second")
      const fiber = yield* Effect.forkChild(schedules.run)
      yield* Effect.yieldNow
      yield* TestClock.adjust("10 seconds")
      // Without moving the clock again, the loop must tick a second time on its own.
      const ids = yield* Effect.yieldNow.pipe(
        Effect.andThen(pending),
        Effect.repeat({ until: (ids) => ids.length >= 2, times: 1000 }),
      )
      expect(ids).toEqual([messageID(first, 1), messageID(second, 1)])
      yield* Fiber.interrupt(fiber)
    }),
  )

  it.effect("backs off for five minutes when a prompt fails, then fires once", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const schedule = yield* schedules.create({
        sessionID,
        when: { type: "in", in: "1 minute" },
        action: { type: "prompt", prompt: "flaky" },
      })
      yield* TestClock.adjust("1 minute")
      duringWake = Effect.die("wake failed")
      yield* schedules.tick
      expect(yield* schedules.get(schedule.id)).toMatchObject({ status: "active", runCount: 0, lastOutcome: "failed" })

      // Not retried on every tick.
      wakes.length = 0
      yield* TestClock.adjust("4 minutes")
      yield* schedules.tick
      expect(wakes).toEqual([])

      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(wakes).toEqual([sessionID])
      expect(yield* pending).toEqual([messageID(schedule, 1)])
      expect(yield* schedules.get(schedule.id)).toMatchObject({ status: "done", runCount: 1, lastOutcome: "late" })
    }),
  )

  it.effect("rejects a zero duration or ends.times below 1", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const create = (input: Omit<Schedule.CreateInput, "sessionID" | "action">) =>
        Effect.flip(schedules.create({ sessionID, action: { type: "prompt", prompt: "x" }, ...input }))
      expect(yield* create({ when: { type: "in", in: "0 seconds" } })).toMatchObject({
        _tag: "Schedule.InvalidError",
        reason: "Duration must be positive: 0 seconds",
      })
      expect(yield* create({ when: { type: "every", every: "1 hour" }, ends: { times: 0 } })).toMatchObject({
        _tag: "Schedule.InvalidError",
        reason: "ends.times must be at least 1",
      })
      expect(yield* schedules.list({ sessionID })).toEqual([])
    }),
  )

  describe("shell checks", () => {
    it.effect("returns done immediately without queuing a prompt when an until check already passes at creation", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.exitCode = 0
        shellState.stdout = "all green\n"
        const schedule = yield* schedules.create({
          sessionID,
          until: { type: "shell", run: "gh pr checks 123" },
          action: { type: "prompt", prompt: "CI passed." },
        })
        expect(schedule).toMatchObject({
          status: "done",
          runCount: 1,
          lastOutcome: "fired",
          lastOutput: "all green",
          nextDueAt: undefined,
          when: { type: "every", every: "30 seconds" },
        })
        expect(yield* pending).toEqual([])
        expect(wakes).toEqual([])
      }),
    )

    it.effect("polls until exit 0 with default 30s interval and 24h deadline, then wakes once and stops", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.exitCode = 1
        const schedule = yield* schedules.create({
          sessionID,
          until: { type: "shell", run: "gh pr checks 123" },
          action: { type: "prompt", prompt: "CI passed." },
        })
        expect(schedule).toMatchObject({
          status: "active",
          when: { type: "every", every: "30 seconds" },
          remainingRuns: 1,
        })
        expect(iso(schedule.endsAt)).toBe(iso(DateTime.makeUnsafe(24 * 60 * 60_000)))

        yield* TestClock.adjust("30 seconds")
        yield* schedules.tick
        expect(yield* pending).toEqual([])
        expect(yield* schedules.get(schedule.id)).toMatchObject({
          status: "active",
          runCount: 0,
          remainingRuns: 1,
          lastOutcome: "checked",
        })

        shellState.exitCode = 0
        shellState.stdout = "20 pass\n"
        yield* TestClock.adjust("30 seconds")
        yield* schedules.tick
        expect(yield* pending).toEqual([messageID(schedule, 1)])
        const { db } = yield* Database.Service
        expect(yield* SessionInbox.find(db, messageID(schedule, 1))).toMatchObject({
          payload: {
            text: "CI passed.\n\n20 pass",
            metadata: { schedule: { id: schedule.id, run: 1, check: { message: "20 pass" } } },
          },
        })
        expect(yield* schedules.get(schedule.id)).toMatchObject({
          status: "done",
          runCount: 1,
          remainingRuns: 0,
          lastOutcome: "fired",
          nextDueAt: undefined,
        })
      }),
    )

    it.effect("wakes once with expired when an until check hits its deadline without matching", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.exitCode = 1
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "30 seconds" },
          until: { type: "shell", run: "curl -sf http://localhost:3000" },
          ends: { after: "1 minute" },
          action: { type: "prompt", prompt: "Server check finished." },
        })

        yield* TestClock.adjust("30 seconds")
        yield* schedules.tick
        expect(yield* pending).toEqual([])

        yield* TestClock.adjust("30 seconds")
        yield* schedules.tick
        expect(yield* pending).toEqual([messageID(schedule, 1)])
        const { db } = yield* Database.Service
        expect(yield* SessionInbox.find(db, messageID(schedule, 1))).toMatchObject({
          payload: {
            text: expect.stringContaining("[Schedule timed out without matching: curl -sf http://localhost:3000]"),
            metadata: { schedule: { id: schedule.id, run: 1, check: { expired: true } } },
          },
        })
        expect(yield* schedules.get(schedule.id)).toMatchObject({
          status: "done",
          runCount: 1,
          lastOutcome: "expired",
          nextDueAt: undefined,
        })
      }),
    )

    it.effect("seeds changes baseline at t=0 and counts ends.times by wakes rather than quiet checks", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.stdout = "sha-1\n"
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "15 seconds" },
          if: { type: "shell", run: "git rev-parse HEAD", changes: true },
          ends: { times: 2 },
          action: { type: "prompt", prompt: "HEAD moved." },
        })

        // Quiet check: same output as t=0 baseline -> remainingRuns stays 2.
        yield* TestClock.adjust("15 seconds")
        yield* schedules.tick
        expect(yield* pending).toEqual([])
        expect(yield* schedules.get(schedule.id)).toMatchObject({
          status: "active",
          runCount: 0,
          remainingRuns: 2,
          lastOutcome: "checked",
        })

        // Change before second tick: wakes once -> remainingRuns becomes 1.
        shellState.stdout = "sha-2\n"
        yield* TestClock.adjust("15 seconds")
        yield* schedules.tick
        expect(yield* pending).toEqual([messageID(schedule, 1)])
        expect(yield* schedules.get(schedule.id)).toMatchObject({
          status: "active",
          runCount: 1,
          remainingRuns: 1,
          lastOutcome: "fired",
        })
        yield* deliver

        // Another quiet check at sha-2 -> remainingRuns stays 1.
        yield* TestClock.adjust("15 seconds")
        yield* schedules.tick
        expect(yield* pending).toEqual([])
        expect(yield* schedules.get(schedule.id)).toMatchObject({ status: "active", remainingRuns: 1 })

        // Second change -> wakes a second time and finishes.
        shellState.stdout = "sha-3\n"
        yield* TestClock.adjust("15 seconds")
        yield* schedules.tick
        expect(yield* pending).toEqual([messageID(schedule, 2)])
        expect(yield* schedules.get(schedule.id)).toMatchObject({
          status: "done",
          runCount: 2,
          remainingRuns: 0,
          lastOutcome: "fired",
        })
      }),
    )

    it.effect("supports is and matches predicates, even when the command exits non-zero at creation", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        // Service is still booting at creation (curl exits 7); creating an `until` with `is` still succeeds.
        shellState.exitCode = 7
        shellState.stdout = ""
        const exact = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "20 seconds" },
          until: { type: "shell", run: "curl -sf http://localhost:3000/status", is: "MERGED" },
          action: { type: "prompt", prompt: "Merged." },
        })
        shellState.exitCode = 0
        shellState.stdout = "OPEN\n"
        const regex = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "20 seconds" },
          until: { type: "shell", run: "gh pr view 2", matches: "^MERGED" },
          action: { type: "prompt", prompt: "Regex merged." },
        })

        yield* TestClock.adjust("20 seconds")
        yield* schedules.tick
        expect(yield* pending).toEqual([])

        shellState.stdout = "MERGED\n"
        yield* TestClock.adjust("20 seconds")
        yield* schedules.tick
        expect(yield* pending).toEqual([messageID(exact, 1), messageID(regex, 1)])
      }),
    )

    it.effect("asks once without save at creation, runs unattended on ticks, and pauses after 3 failures", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        agentRules = [{ action: "shell", resource: "*", effect: "ask" }]
        shellState.exitCode = 1

        const bus = yield* Bus.Service
        const instances = yield* Instance.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.get(sessionID)
        const asks = yield* Queue.unbounded<Permission.Request>()
        const unsubscribe = yield* bus.listen((event) =>
          event.type === Permission.Event.Asked.type
            ? Queue.offer(asks, event.data as Permission.Request).pipe(Effect.asVoid)
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const asked: Permission.Request[] = []
        const answerLoop = yield* Queue.take(asks).pipe(
          Effect.tap((request) => Effect.sync(() => asked.push(request))),
          Effect.flatMap((request) =>
            Permission.Service.use((permission) => permission.reply({ requestID: request.id, reply: "once" })).pipe(
              instances.provide(session),
            ),
          ),
          Effect.forever,
          Effect.forkChild,
        )

        const schedule = yield* schedules.create({
          sessionID,
          name: "ci",
          when: { type: "every", every: "1 minute" },
          if: { type: "shell", run: "gh pr checks 99" },
          action: { type: "prompt", prompt: "CI green." },
        })
        yield* Fiber.interrupt(answerLoop)
        expect(asked).toHaveLength(1)
        expect(asked[0]?.save).toBeUndefined()
        expect(asked[0]?.resources).toEqual(["gh pr checks 99"])

        // Unattended tick runs without asking again.
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        expect(asked).toHaveLength(1)
        expect(yield* schedules.get(schedule.id)).toMatchObject({ lastOutcome: "checked" })

        // Revoking shell permission causes 3 consecutive check failures -> auto-pause + error wake.
        agentRules = [{ action: "shell", resource: "*", effect: "deny" }]
        const locationsMap = yield* LocationServiceMap.Service
        yield* locationsMap.invalidate(Location.Ref.make({ directory: AbsolutePath.make(enabledDirectory) }))

        for (const strike of [1, 2]) {
          yield* TestClock.adjust("1 minute")
          yield* schedules.tick
          expect(yield* schedules.get(schedule.id)).toMatchObject({
            status: "active",
            lastOutcome: "failed",
            runCount: 0,
          })
          expect(strike).toBeLessThan(3)
        }
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        expect(yield* schedules.get(schedule.id)).toMatchObject({
          status: "paused",
          lastOutcome: "failed",
          runCount: 1,
        })
        expect(yield* pending).toEqual([messageID(schedule, 1)])
        const { db } = yield* Database.Service
        expect(yield* SessionInbox.find(db, messageID(schedule, 1))).toMatchObject({
          payload: { text: expect.stringContaining("[Schedule paused after 3 failed checks:") },
        })
      }),
    )

    it.effect("waits for Plugin.awaitActivation and auto-pauses when the Session directory disappears", () =>
      Effect.gen(function* () {
        const schedules = yield* setup(missingDirectory)
        const gate = yield* Latch.make()
        activationGate = gate.await
        shellState.exitCode = 1
        const creating = yield* Effect.forkChild(
          schedules.create({
            sessionID,
            when: { type: "every", every: "1 minute" },
            until: { type: "shell", run: "gh pr checks 1" },
            action: { type: "prompt", prompt: "done" },
          }),
        )
        yield* Effect.repeat(Effect.yieldNow, { times: 5 })
        expect(shellState.runs).toEqual([])
        yield* gate.open
        const schedule = yield* Fiber.join(creating)
        expect(shellState.runs).toEqual(["gh pr checks 1"])

        // Simulate the worktree directory being deleted before the next tick.
        const session = yield* Session.Service.use((sessions) => sessions.get(sessionID))
        const locationsMap = yield* LocationServiceMap.Service
        shellState.missingNow = true
        yield* locationsMap.invalidate(session.location)

        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        expect(yield* schedules.get(schedule.id)).toMatchObject({
          status: "paused",
          lastOutcome: "failed",
        })
      }),
    )

    it.effect("validates check combinations, intervals, and regexes at creation", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        const bad = (input: Omit<Schedule.CreateInput, "sessionID" | "action">) =>
          Effect.flip(schedules.create({ sessionID, action: { type: "prompt", prompt: "x" }, ...input }))

        expect(yield* bad({})).toMatchObject({ reason: "when is required unless until is set" })
        expect(
          yield* bad({
            if: { type: "shell", run: "true" },
            until: { type: "shell", run: "true" },
          }),
        ).toMatchObject({ reason: "Choose either if or until, not both" })
        expect(
          yield* bad({
            when: { type: "every", every: "10 seconds" },
            until: { type: "shell", run: "true" },
          }),
        ).toMatchObject({ reason: "every must be at least 15 seconds" })
        expect(
          yield* bad({
            until: { type: "shell", run: "echo hi", is: "hi", matches: "hi" },
          }),
        ).toMatchObject({ reason: "Choose at most one of is, matches or changes" })
        expect(
          yield* bad({
            until: { type: "shell", run: "echo hi", matches: "[unclosed" },
          }),
        ).toMatchObject({ _tag: "Schedule.InvalidError" })
      }),
    )
  })

  describe("shell actions", () => {
    it.effect("runs a shell action without waking the Session", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.stdout = "hi"
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "in", in: "5 minutes" },
          action: { type: "shell", run: "echo hi" },
        })

        yield* TestClock.adjust("5 minutes")
        yield* schedules.tick
        expect(shellState.runs).toEqual(["echo hi"])
        expect(yield* pending).toEqual([])
        expect(wakes).toEqual([])
        expect(yield* schedules.get(schedule.id)).toMatchObject({
          status: "done",
          runCount: 1,
          lastOutcome: "fired",
          lastRun: { exitCode: 0, durationMs: 0, output: "hi" },
        })
      }),
    )

    it.effect("records a non-zero exit as a run failure", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.exitCode = 3
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "in", in: "1 minute" },
          action: { type: "shell", run: "false" },
        })
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        const info = yield* schedules.get(schedule.id)
        expect(info).toMatchObject({ status: "done", lastOutcome: "fired", lastRun: { exitCode: 3, output: "" } })
        expect(info.lastRun?.error).toBeUndefined()
        expect(yield* scheduleRow(schedule.id)).toMatchObject({ run_failures: 1 })
      }),
    )

    it.effect("pauses a shell action after three failed runs", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.exitCode = 2
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "1 minute" },
          action: { type: "shell", run: "false" },
        })

        for (const strikes of [1, 2]) {
          yield* TestClock.adjust("1 minute")
          yield* schedules.tick
          expect(yield* schedules.get(schedule.id)).toMatchObject({
            status: "active",
            runCount: strikes,
            lastOutcome: "fired",
            lastRun: { exitCode: 2, output: "" },
          })
          expect(yield* scheduleRow(schedule.id)).toMatchObject({ run_failures: strikes })
        }

        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        const info = yield* schedules.get(schedule.id)
        expect(info).toMatchObject({
          status: "paused",
          runCount: 3,
          lastOutcome: "failed",
          lastRun: { exitCode: 2, output: "" },
        })
        expect(info.lastRun?.error).toBe("Schedule paused after 3 failed runs: Command exited with code 2")
        expect(yield* scheduleRow(schedule.id)).toMatchObject({ run_failures: 3, retry_at: null })
        expect(shellState.runs).toEqual(["false", "false", "false"])
        expect(yield* pending).toEqual([])
        expect(wakes).toEqual([])

        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        expect(shellState.runs).toEqual(["false", "false", "false"])
      }),
    )

    it.effect("clears run failures after a successful run", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.exitCode = 1
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "1 minute" },
          action: { type: "shell", run: "false" },
        })
        for (const _ of [1, 2]) {
          yield* TestClock.adjust("1 minute")
          yield* schedules.tick
        }
        expect(yield* scheduleRow(schedule.id)).toMatchObject({ run_failures: 2 })

        shellState.exitCode = 0
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        expect(yield* scheduleRow(schedule.id)).toMatchObject({ status: "active", run_failures: 0 })

        shellState.exitCode = 1
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        expect(yield* schedules.get(schedule.id)).toMatchObject({ status: "active", lastOutcome: "fired" })
        expect(yield* scheduleRow(schedule.id)).toMatchObject({ run_failures: 1 })
      }),
    )

    it.effect("counts a command that could not start toward the pause", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.die = "spawn failed"
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "1 minute" },
          action: { type: "shell", run: "deploy" },
        })
        for (const _ of [1, 2, 3]) {
          yield* TestClock.adjust("1 minute")
          yield* schedules.tick
        }
        const info = yield* schedules.get(schedule.id)
        expect(info).toMatchObject({ status: "paused", lastOutcome: "failed" })
        expect(info.lastRun?.exitCode).toBeUndefined()
        expect(info.lastRun?.error).toBe("Schedule paused after 3 failed runs: spawn failed")
        expect(yield* scheduleRow(schedule.id)).toMatchObject({ run_failures: 3 })
      }),
    )

    it.effect("gives a resumed schedule fresh run failures", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.exitCode = 4
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "1 minute" },
          action: { type: "shell", run: "false" },
        })
        for (const _ of [1, 2, 3]) {
          yield* TestClock.adjust("1 minute")
          yield* schedules.tick
        }
        expect(yield* schedules.get(schedule.id)).toMatchObject({ status: "paused" })

        expect(yield* schedules.resume(schedule.id)).toMatchObject({ status: "active" })
        expect(yield* scheduleRow(schedule.id)).toMatchObject({ run_failures: 0 })

        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        expect(yield* schedules.get(schedule.id)).toMatchObject({ status: "active", lastOutcome: "fired" })
        expect(yield* scheduleRow(schedule.id)).toMatchObject({ run_failures: 1 })
      }),
    )

    it.effect("runs a repeating shell action on every slot", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "1 minute" },
          action: { type: "shell", run: "echo tick" },
        })
        for (const _ of [1, 2]) {
          yield* TestClock.adjust("1 minute")
          yield* schedules.tick
        }
        expect(shellState.runs).toEqual(["echo tick", "echo tick"])
        expect(shellState.envs.map((env) => env?.OPENCODE_SCHEDULE_RUN)).toEqual(["1", "2"])
        expect(shellState.envs.map((env) => env?.OPENCODE_SCHEDULE_ID)).toEqual([schedule.id, schedule.id])
        expect(yield* schedules.get(schedule.id)).toMatchObject({
          status: "active",
          runCount: 2,
          lastOutcome: "fired",
        })
      }),
    )

    it.effect("passes the check message to the command on stdin and in OPENCODE_SCHEDULE_MESSAGE", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.stdout = "new reply"
        yield* schedules.create({
          sessionID,
          when: { type: "every", every: "1 minute" },
          if: { type: "shell", run: "probe" },
          action: { type: "shell", run: "echo hi" },
        })
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        expect(shellState.runs).toEqual(["probe", "echo hi"])
        expect(shellState.stdins).toEqual(["ignore", "new reply\n"])
        expect(shellState.envs[1]).toMatchObject({ OPENCODE_SCHEDULE_MESSAGE: "new reply" })
        expect(shellState.envs[0]?.OPENCODE_SCHEDULE_MESSAGE).toBeUndefined()
      }),
    )

    it.effect("passes no stdin without a check message", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        yield* schedules.create({
          sessionID,
          when: { type: "in", in: "1 minute" },
          action: { type: "shell", run: "echo hi" },
        })
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        expect(shellState.runs).toEqual(["echo hi"])
        expect(shellState.stdins).toEqual(["ignore"])
        expect(shellState.envs[0]?.OPENCODE_SCHEDULE_MESSAGE).toBeUndefined()
      }),
    )

    it.effect("defaults cwd to the Session directory and resolves a relative cwd under it", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        yield* schedules.create({
          sessionID,
          when: { type: "in", in: "1 minute" },
          action: { type: "shell", run: "pwd" },
        })
        yield* schedules.create({
          sessionID,
          when: { type: "in", in: "1 minute" },
          action: { type: "shell", run: "pwd", cwd: "sub" },
        })
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        const directory = path.resolve(enabledDirectory)
        expect(shellState.cwds).toContain(directory)
        expect(shellState.cwds).toContain(path.join(directory, "sub"))
      }),
    )

    it.effect("validates the command, timeout and permissions at creation", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        const create = (action: Schedule.CreateInput["action"]) =>
          Effect.flip(schedules.create({ sessionID, when: { type: "in", in: "1 minute" }, action }))
        expect(yield* create({ type: "shell", run: "  " })).toMatchObject({
          _tag: "Schedule.InvalidError",
          reason: "A shell action needs a command",
        })
        expect(yield* create({ type: "shell", run: "echo hi", timeout: "soon" })).toMatchObject({
          _tag: "Schedule.InvalidError",
          reason: "Invalid duration: soon",
        })

        agentRules = [{ action: "shell", resource: "*", effect: "deny" }]
        const locationsMap = yield* LocationServiceMap.Service
        yield* locationsMap.invalidate(Location.Ref.make({ directory: AbsolutePath.make(enabledDirectory) }))
        expect(yield* create({ type: "shell", run: "echo hi" })).toMatchObject({
          _tag: "Permission.BlockedError",
        })
        expect(shellState.runs).toEqual([])
      }),
    )

    it.effect("keeps the output of a command that is still running when it times out", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.hangMs = 30_000
        shellState.stdout = "started\n"
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "1 minute" },
          action: { type: "shell", run: "echo started; sleep 30", timeout: "1 second" },
        })
        yield* TestClock.adjust("1 minute")
        const ticking = yield* Effect.forkChild(schedules.tick)
        yield* Effect.repeat(Effect.yieldNow, { times: 5 })
        // The start marker and the FiberMap entry are written before the command finishes its exit code sleep.
        expect(yield* schedules.get(schedule.id)).toMatchObject({
          status: "active",
          runCount: 1,
          lastRun: { durationMs: 0, output: "" },
        })
        // Give the run time to register its sleep and timeout before moving the clock past them.
        yield* Effect.forEach(
          [1, 2, 3],
          () => Effect.yieldNow.pipe(Effect.andThen(TestClock.adjust("1 second")), Effect.andThen(Effect.yieldNow)),
          { discard: true },
        )
        yield* Fiber.join(ticking)
        const info = yield* schedules.get(schedule.id)
        expect(info.lastRun).toMatchObject({
          output: "started\n",
          error: "Timed out after 1 second",
          durationMs: 1000,
        })
        expect(info.lastRun?.exitCode).toBeUndefined()
        expect(shellState.interrupts).toBe(1)
        expect(info).toMatchObject({ status: "active", lastOutcome: "fired", runCount: 1 })
        expect(yield* scheduleRow(schedule.id)).toMatchObject({ run_failures: 1 })
      }),
    )

    it.effect("skips a slot that falls due while the previous run is in flight", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.hangMs = 120_000
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "1 minute" },
          action: { type: "shell", run: "sleep 120", timeout: "5 minutes" },
        })
        yield* TestClock.adjust("1 minute")
        const first = yield* Effect.forkChild(schedules.tick)
        yield* Effect.repeat(Effect.yieldNow, { times: 5 })

        yield* TestClock.adjust("1 minute")
        const second = yield* Effect.forkChild(schedules.tick)
        yield* Effect.repeat(Effect.yieldNow, { times: 5 })
        expect(yield* schedules.get(schedule.id)).toMatchObject({ lastOutcome: "skipped", runCount: 1 })

        // Let the first run time out so both ticks finish.
        yield* TestClock.adjust("4 minutes")
        yield* Fiber.join(first)
        yield* Fiber.join(second)
        expect(shellState.runs).toEqual(["sleep 120"])
        expect(yield* schedules.get(schedule.id)).toMatchObject({ runCount: 1, lastOutcome: "skipped" })
      }),
    )

    it.effect("runs a shell action when an until check already matches at creation", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.stdout = "ready"
        const schedule = yield* schedules.create({
          sessionID,
          until: { type: "shell", run: "probe" },
          action: { type: "shell", run: "deploy" },
        })
        expect(schedule).toMatchObject({
          status: "done",
          runCount: 1,
          lastOutcome: "fired",
          lastRun: { durationMs: 0, output: "" },
        })
        // The run is in the background; tick waits for the actions it knows about.
        yield* schedules.tick
        expect(shellState.runs).toEqual(["probe", "deploy"])
        expect((yield* schedules.get(schedule.id)).lastRun).toMatchObject({ exitCode: 0, output: "ready" })
        expect(yield* pending).toEqual([])
      }),
    )

    it.effect("pauses a shell action after three failed checks without running it", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.exitCode = 1
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "1 minute" },
          if: { type: "shell", run: "probe", is: "ready" },
          action: { type: "shell", run: "deploy" },
        })
        for (const _ of [1, 2]) {
          yield* TestClock.adjust("1 minute")
          yield* schedules.tick
          expect(yield* schedules.get(schedule.id)).toMatchObject({
            status: "active",
            lastOutcome: "failed",
            runCount: 0,
          })
        }

        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        const info = yield* schedules.get(schedule.id)
        expect(info).toMatchObject({
          status: "paused",
          runCount: 0,
          lastOutcome: "failed",
          lastRun: { durationMs: 0, output: "" },
        })
        expect(info.lastRun?.error).toBe("Schedule paused after 3 failed checks: Command exited with code 1")
        expect(info.lastRun?.exitCode).toBeUndefined()
        expect(info.lastFiredAt).toBeUndefined()

        expect(shellState.runs).toEqual(["probe", "probe", "probe"])
        expect(yield* pending).toEqual([])
        expect(wakes).toEqual([])

        const { db } = yield* Database.Service
        const row = yield* db
          .select()
          .from(ScheduleTable)
          .where(eq(ScheduleTable.id, schedule.id))
          .get()
          .pipe(Effect.orDie)
        expect(row).toMatchObject({ failures: 3, retry_at: null })
      }),
    )

    it.effect("pauses a shell action on an invalid code check at the first strike", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "1 minute" },
          if: {
            type: "code",
            code: `if (state === null) return { wake: false, state: { ok: true } }; return "not-a-check-result"`,
          },
          action: { type: "shell", run: "deploy" },
        })
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick

        const info = yield* schedules.get(schedule.id)
        expect(info).toMatchObject({
          status: "paused",
          runCount: 0,
          lastOutcome: "failed",
          lastRun: { durationMs: 0, output: "" },
        })
        expect(info.lastRun?.error?.startsWith("Schedule paused after invalid check:")).toBe(true)
        expect(info.lastRun?.exitCode).toBeUndefined()
        expect(shellState.runs).toEqual([])
        expect(yield* pending).toEqual([])
        expect(wakes).toEqual([])
      }),
    )

    it.effect("expires a shell until check without running the command", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.stdout = "pending"
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "every", every: "30 seconds" },
          until: { type: "shell", run: "curl -sf http://localhost:3000", is: "ready" },
          ends: { after: "1 minute" },
          action: { type: "shell", run: "deploy" },
        })
        // The until check is seeded at creation, so the probe has already run once.
        expect(shellState.runs).toEqual(["curl -sf http://localhost:3000"])

        for (const _ of [1, 2]) {
          yield* TestClock.adjust("30 seconds")
          yield* schedules.tick
        }

        expect(yield* schedules.get(schedule.id)).toMatchObject({
          status: "done",
          runCount: 0,
          lastOutcome: "expired",
          nextDueAt: undefined,
          remainingRuns: 0,
          lastRun: {
            durationMs: 0,
            output: "",
            error: "Schedule timed out without matching: curl -sf http://localhost:3000",
          },
        })
        expect(shellState.runs).toEqual([
          "curl -sf http://localhost:3000",
          "curl -sf http://localhost:3000",
          "curl -sf http://localhost:3000",
        ])
        expect(yield* pending).toEqual([])
        expect(wakes).toEqual([])
      }),
    )

    it.effect("keeps the last 32 KB of verbose output after the marker and drops the earliest lines", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        const early = "an early line that must be dropped"
        const last = "line 4000, the last line"
        shellState.stdout = `${early}\n${"x".repeat(40 * 1024)}\n${last}`
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "in", in: "1 minute" },
          action: { type: "shell", run: "yes x" },
        })
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick

        const info = yield* schedules.get(schedule.id)
        expect(info.lastRun?.output.startsWith("[output truncated at 32 KB]\n")).toBe(true)
        expect(info.lastRun?.output.endsWith(last)).toBe(true)
        expect(info.lastRun?.output).not.toContain(early)
        expect(info.lastRun?.output).toHaveLength("[output truncated at 32 KB]\n".length + 32 * 1024)
        expect(info.lastRun?.output.slice(-32 * 1024)).toBe("x".repeat(32 * 1024 - last.length - 1) + "\n" + last)
        expect(info.lastRun?.exitCode).toBe(0)
        expect(info.lastRun?.error).toBeUndefined()
      }),
    )

    it.effect("stops a command at the default 10 minute timeout", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.hangMs = 11 * 60_000
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "in", in: "1 minute" },
          action: { type: "shell", run: "sleep 660" },
        })
        yield* TestClock.adjust("1 minute")
        const ticking = yield* Effect.forkChild(schedules.tick)
        // Give the run time to register its sleep and timeout before moving the clock past them.
        yield* Effect.forEach(
          Array.from({ length: 11 }, () => 1),
          () => Effect.yieldNow.pipe(Effect.andThen(TestClock.adjust("1 minute")), Effect.andThen(Effect.yieldNow)),
          { discard: true },
        )
        yield* Fiber.join(ticking)

        const info = yield* schedules.get(schedule.id)
        expect(info.lastRun?.exitCode).toBeUndefined()
        expect(info.lastRun?.error).toBe("Timed out after 10 minutes")
        expect(info.lastRun?.durationMs).toBe(600_000)
        expect(shellState.interrupts).toBe(1)
      }),
    )

    it.effect("records a spawn failure as an error without an exit code", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        shellState.die = "spawn boom"
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "in", in: "1 minute" },
          action: { type: "shell", run: "echo hi" },
        })
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick

        expect(yield* schedules.get(schedule.id)).toMatchObject({
          status: "done",
          runCount: 1,
          lastOutcome: "fired",
          lastRun: { durationMs: 0, output: "", error: "spawn boom" },
        })
        expect((yield* schedules.get(schedule.id)).lastRun?.exitCode).toBeUndefined()
        expect(yield* pending).toEqual([])
      }),
    )

    it.effect("records a revoked run permission as an error without starting the command", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        const schedule = yield* schedules.create({
          sessionID,
          when: { type: "in", in: "1 minute" },
          action: { type: "shell", run: "echo hi" },
        })
        agentRules = [{ action: "shell", resource: "*", effect: "deny" }]
        const locationsMap = yield* LocationServiceMap.Service
        yield* locationsMap.invalidate(Location.Ref.make({ directory: AbsolutePath.make(enabledDirectory) }))

        yield* TestClock.adjust("1 minute")
        yield* schedules.tick

        const info = yield* schedules.get(schedule.id)
        expect(info.lastRun?.exitCode).toBeUndefined()
        expect(info.lastRun?.error).toBeTruthy()
        expect(shellState.runs).toEqual([])
        expect(yield* pending).toEqual([])
      }),
    )
  })

  describe("code checks", () => {
    const watchThread = `
      const thread = await tools.slack.read_thread({})
      if (state === null || thread.replies <= state.replies) {
        return { wake: false, state: { replies: thread.replies, runs } }
      }
      return {
        wake: true,
        state: { replies: thread.replies, runs },
        message: thread.replies + " replies",
      }
    `

    it.effect(
      "seeds initial state at t=0 so replies before the first tick are caught, and counts ends.times by wakes",
      () =>
        Effect.gen(function* () {
          const schedules = yield* setup()
          slack.replies = 3
          const schedule = yield* schedules.create({
            sessionID,
            name: "thread",
            when: { type: "every", every: "2 minutes" },
            if: { type: "code", code: watchThread },
            ends: { times: 1 },
            action: { type: "prompt", prompt: "New thread activity." },
          })
          // Seeded at creation (t=0): 1 read, baseline state = { replies: 3, runs: 0 }.
          expect(slack.reads).toBe(1)

          // Quiet tick at +2m (still 3 replies): remainingRuns stays 1!
          yield* TestClock.adjust("2 minutes")
          yield* schedules.tick
          expect(yield* pending).toEqual([])
          expect(yield* schedules.get(schedule.id)).toMatchObject({
            status: "active",
            runCount: 0,
            remainingRuns: 1,
            lastOutcome: "checked",
          })

          // Reply arrives -> wakes once and stops because ends.times = 1.
          slack.replies = 4
          yield* TestClock.adjust("2 minutes")
          yield* schedules.tick
          expect(yield* pending).toEqual([messageID(schedule, 1)])
          const { db } = yield* Database.Service
          expect(yield* SessionInbox.find(db, messageID(schedule, 1))).toMatchObject({
            payload: {
              text: "New thread activity.\n\n4 replies",
              metadata: { schedule: { id: schedule.id, run: 1, check: { message: "4 replies" } } },
            },
          })
          expect(yield* schedules.get(schedule.id)).toMatchObject({
            status: "done",
            runCount: 1,
            remainingRuns: 0,
            lastOutcome: "fired",
          })
        }),
    )

    it.effect("supports boolean and state-free returns for until checks, including immediate t=0 match", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        slack.replies = 5
        const immediate = yield* schedules.create({
          sessionID,
          until: {
            type: "code",
            code: `const t = await tools.slack.read_thread({}); return { wake: t.replies >= 5, message: "already 5" }`,
          },
          action: { type: "prompt", prompt: "Done." },
        })
        expect(immediate).toMatchObject({
          status: "done",
          lastOutcome: "fired",
          lastOutput: "already 5",
        })
        expect(yield* pending).toEqual([])

        slack.replies = 1
        const waiting = yield* schedules.create({
          sessionID,
          until: {
            type: "code",
            code: `return (await tools.slack.read_thread({})).replies >= 2 && typeof fetch === "undefined"`,
          },
          action: { type: "prompt", prompt: "Reached 2." },
        })
        expect(waiting.status).toBe("active")

        slack.replies = 2
        yield* TestClock.adjust("30 seconds")
        yield* schedules.tick
        expect(yield* pending).toEqual([messageID(waiting, 1)])
        expect(yield* schedules.get(waiting.id)).toMatchObject({ status: "done", lastOutcome: "fired" })
      }),
    )

    it.effect("extracts tools statically, asks once without save, and denies unapproved side permissions", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        agentRules = [{ action: "*", resource: "*", effect: "ask" }]
        const bus = yield* Bus.Service
        const instances = yield* Instance.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.get(sessionID)
        const asks = yield* Queue.unbounded<Permission.Request>()
        const unsubscribe = yield* bus.listen((event) =>
          event.type === Permission.Event.Asked.type
            ? Queue.offer(asks, event.data as Permission.Request).pipe(Effect.asVoid)
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const asked: Permission.Request[] = []
        const answerLoop = yield* Queue.take(asks).pipe(
          Effect.tap((request) => Effect.sync(() => asked.push(request))),
          Effect.flatMap((request) =>
            Permission.Service.use((permission) => permission.reply({ requestID: request.id, reply: "once" })).pipe(
              instances.provide(session),
            ),
          ),
          Effect.forever,
          Effect.forkChild,
        )

        const schedule = yield* schedules.create({
          sessionID,
          name: "thread",
          when: { type: "every", every: "1 minute" },
          if: { type: "code", code: watchThread },
          action: { type: "prompt", prompt: "Changed." },
        })
        yield* Fiber.interrupt(answerLoop)
        expect(asked).toHaveLength(1)
        expect(asked[0]).toMatchObject({
          action: "slack_read_thread",
          metadata: {
            schedule: "thread",
            mode: "if",
            when: { type: "every", every: "1 minute" },
            unattended: true,
            tools: ["slack.read_thread"],
          },
        })
        expect(asked[0]?.save).toBeUndefined()

        // Subsequent unattended ticks run without asking.
        yield* TestClock.adjust("1 minute")
        yield* schedules.tick
        expect(asked).toHaveLength(1)
        expect(yield* schedules.get(schedule.id)).toMatchObject({ lastOutcome: "checked" })

        // A tool requesting a second permission (`file_write`) that was not authorized fails at create/seed.
        const answerExport = yield* Queue.take(asks).pipe(
          Effect.flatMap((request) =>
            Permission.Service.use((permission) => permission.reply({ requestID: request.id, reply: "once" })).pipe(
              instances.provide(session),
            ),
          ),
          Effect.forever,
          Effect.forkChild,
        )
        const exportFailure = yield* Effect.flip(
          schedules.create({
            sessionID,
            until: { type: "code", code: `await tools.slack.export_thread({}); return true` },
            action: { type: "prompt", prompt: "Exported." },
          }),
        )
        yield* Fiber.interrupt(answerExport)
        expect(slack.exports).toBe(0)
        expect(exportFailure).toMatchObject({ _tag: "Schedule.InvalidError" })
      }),
    )

    it.effect("rejects dynamic tool access, unknown tools, edit tools, and recursive schedule tools", () =>
      Effect.gen(function* () {
        const schedules = yield* setup()
        const bad = (code: string) =>
          Effect.flip(
            schedules.create({
              sessionID,
              until: { type: "code", code },
              action: { type: "prompt", prompt: "x" },
            }),
          )

        expect(yield* bad("const x = {")).toMatchObject({ _tag: "Schedule.InvalidError" })
        expect(yield* bad("return await tools.slack[name]({})")).toMatchObject({ _tag: "Schedule.InvalidError" })
        expect(yield* bad("return await tools.slack.missing({})")).toMatchObject({
          reason: "Unknown Code Mode tool: slack.missing",
        })
        expect(yield* bad("return await tools.slack.dangerous_edit({})")).toMatchObject({
          reason: "Tool slack.dangerous_edit cannot be used inside a schedule check",
        })
        expect(yield* bad("return await tools.opencode.schedule_create({})")).toMatchObject({
          reason: "Tool opencode.schedule_create cannot be used inside a schedule check",
        })

        agentRules = [{ action: "execute", resource: "*", effect: "deny" }]
        expect(yield* bad("return true")).toMatchObject({ _tag: "Permission.BlockedError" })
      }),
    )

    it.effect(
      "fails schedule_create when a t=0 code run throws, and pauses on strike 1 when a later tick returns an invalid shape",
      () =>
        Effect.gen(function* () {
          const schedules = yield* setup()
          const thrown = yield* Effect.flip(
            schedules.create({
              sessionID,
              when: { type: "cron", cron: "0 9 * * *" },
              if: {
                type: "code",
                code: `const t = await tools.slack.read_thread({}); return t.nonexistent.length > 0`,
              },
              action: { type: "prompt", prompt: "Morning check." },
            }),
          )
          expect(thrown).toMatchObject({ _tag: "Schedule.InvalidError" })

          // First run (state === null) returns valid { wake: false, state: { ok: true } };
          // first scheduled tick (state !== null) returns an invalid string, pausing immediately on strike 1.
          const schedule = yield* schedules.create({
            sessionID,
            when: { type: "every", every: "1 minute" },
            if: {
              type: "code",
              code: `if (state === null) return { wake: false, state: { ok: true } }; return "not-a-check-result"`,
            },
            action: { type: "prompt", prompt: "Watch." },
          })
          yield* TestClock.adjust("1 minute")
          yield* schedules.tick
          expect(yield* schedules.get(schedule.id)).toMatchObject({
            status: "paused",
            lastOutcome: "failed",
            runCount: 1,
          })
          const { db } = yield* Database.Service
          expect(yield* SessionInbox.find(db, messageID(schedule, 1))).toMatchObject({
            payload: { text: expect.stringContaining("[Schedule paused after invalid check:") },
          })
        }),
    )

    it.effect("picks up a schedule created by another process sharing the DB while idle", () =>
      Effect.gen(function* () {
        const primary = yield* setup()
        const { db } = yield* Database.Service
        const runner = yield* Effect.forkChild(primary.run)
        yield* Effect.repeat(Effect.yieldNow, { times: 5 })

        // Insert directly into SQLite (bypassing primary.create so primary's in-memory doorbell is never opened)
        // to simulate a short-lived `opencode serve` / `--standalone` writing a schedule and exiting.
        const now = yield* Clock.currentTimeMillis
        const externalID = Schedule.ID.create()
        yield* db
          .insert(ScheduleTable)
          .values({
            id: externalID,
            session_id: sessionID,
            name: "external",
            check: null,
            state: null,
            checks: 0,
            action: { type: "prompt", prompt: "Cross-process wake." },
            when: { type: "in", in: "10 seconds" },
            tz: "UTC",
            status: "active",
            next_due_at: now + 10_000,
            ends_at: null,
            remaining_runs: 1,
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)

        // Bounded MAX_SLEEP (30s) wakes the idle loop, claims leadership, and fires the row.
        yield* TestClock.adjust("30 seconds")
        yield* Effect.repeat(Effect.yieldNow, { times: 5 })
        yield* Fiber.interrupt(runner)

        expect(yield* primary.get(externalID)).toMatchObject({
          status: "done",
          runCount: 1,
          lastOutcome: "fired",
        })
      }),
    )
  })
})
