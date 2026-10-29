import { describe, expect } from "bun:test"
import { FileSystem } from "@opencode/core/filesystem"
import { DateTime, Effect, Fiber, Latch, Layer, LayerMap, Queue, Schema, Sink, Stream } from "effect"
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
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"

const enabledDirectory = "/enabled"
const disabledDirectory = "/disabled"
const toggleDirectory = "/toggle"
const missingDirectory = "/missing"

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
const enabled = Config.testLayer(enabledEntries)
/** A location whose flag the test turns on, counting every config read. */
const toggle = { on: false, reads: 0 }
const toggled = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.sync(() => {
        toggle.reads++
        return toggle.on ? enabledEntries : []
      }),
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
  missingNow: false,
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
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        const script = command._tag === "StandardCommand" ? (command.args.at(-1) ?? command.command) : "pipeline"
        shellState.runs.push(script)
        if (shellState.hangMs > 0) yield* Effect.sleep(shellState.hangMs)
        const outBytes = new TextEncoder().encode(shellState.stdout)
        const errBytes = new TextEncoder().encode(shellState.stderr)
        return makeHandle({
          pid: ProcessId(1),
          exitCode: Effect.succeed(ExitCode(shellState.exitCode)),
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
            ref.directory === enabledDirectory || ref.directory === missingDirectory
              ? enabled
              : ref.directory === toggleDirectory
                ? toggled
                : Layer.empty,
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
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      SessionExecution.node.replace(execution),
      LocationServiceMap.node.replace(locations),
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
    shellState.exitCode = 0
    shellState.stdout = ""
    shellState.stderr = ""
    shellState.hangMs = 0
    shellState.runs = []
    shellState.missingNow = false
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

    it.effect("seeds initial state at t=0 so replies before the first tick are caught, and counts ends.times by wakes", () =>
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
          metadata: { schedule: "thread", mode: "if", tools: ["slack.read_thread"] },
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
  })
})
