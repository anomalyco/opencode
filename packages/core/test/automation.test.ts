import { describe, expect } from "bun:test"
import { FileSystem } from "@opencode/core/filesystem"
import { Clock, DateTime, Effect, Fiber, Latch, Layer, LayerMap, Queue, Schema, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { TestClock } from "effect/testing"
import { eq } from "drizzle-orm"
import { Agent } from "@opencode/core/agent"
import { App } from "@opencode/core/app"
import { Automation } from "@opencode/core/automation"
import { AutomationTable } from "@opencode/core/automation/sql"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Flag } from "@opencode/core/flag"
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
/** Runs inside the next wake, which happens while an automation is running. */
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
      experimental: new ConfigExperimental.Info({ automations: true }),
    }),
  }),
]
const disabledEntries = [
  new Document({
    type: "document",
    info: new Info({
      experimental: new ConfigExperimental.Info({ automations: false }),
    }),
  }),
]
const enabled = Config.testLayer(enabledEntries)
const disabled = Config.testLayer(disabledEntries)
/** A location whose flag the test turns on, counting every config read. */
const toggle = { on: false, reads: 0 }
const toggled = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.sync(() => {
        toggle.reads++
        return toggle.on ? enabledEntries : disabledEntries
      }),
    changes: () => Stream.empty,
  }),
)
const folders = { missingNow: false }
const slack = { replies: 0, reads: 0, posts: [] as string[], failing: false }
let agentRules: Permission.Ruleset = [{ action: "*", resource: "*", effect: "allow" }]
let activationGate: Effect.Effect<void> = Effect.void

const testEnvironment = Layer.effect(
  Environment.Service,
  Effect.gen(function* () {
    const files = Environment.makeFiles(Environment.makeMemoryDriver())
    yield* files.mkdir(enabledDirectory).pipe(Effect.orDie)
    yield* files.mkdir(toggleDirectory).pipe(Effect.orDie)
    return Environment.Service.of({ files, spawner: ChildProcessSpawner.make(() => Effect.die("unused")) })
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
        name: "post",
        description: "Post a message",
        input: Schema.Struct({ text: Schema.String }),
        options: { namespace: "slack" },
        execute: (input, context) =>
          permission
            .assert({ action: "slack_post", resources: ["*"], sessionID: context.sessionID, agent: context.agent })
            .pipe(
              Effect.orDie,
              Effect.map(() => {
                slack.posts.push(input.text)
                return { content: "posted" }
              }),
            ),
      })
    })
  }),
)

const locations = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const app = yield* App.Service
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const saved = yield* PermissionSaved.Service
      return yield* LayerMap.make(
        (ref: Location.Ref): Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError> => {
          if (ref.directory === missingDirectory && folders.missingNow) {
            return Layer.effectDiscard(
              Effect.fail(
                new FileSystem.DirectoryNotFoundError({ directory: ref.directory, cause: new Error("missing") }),
              ),
            ) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>
          }
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          return Layer.mergeAll(
            configureAgent.pipe(
              Layer.provideMerge(
                LayerNode.compile(
                  LayerNode.group([
                    App.node,
                    Config.node,
                    Flag.node,
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
                      App.node.replace(Layer.succeed(App.Service, app)),
                      Bus.node.replace(Layer.succeed(Bus.Service, bus)),
                      Config.node.replace(
                        ref.directory === enabledDirectory || ref.directory === missingDirectory
                          ? enabled
                          : ref.directory === toggleDirectory
                            ? toggled
                            : disabled,
                      ),
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
  deps: [App.node, Bus.node, SessionStore.node, PermissionSaved.node],
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      Automation.node,
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

const sessionID = Session.ID.make("ses_automation_test")
const otherID = Session.ID.make("ses_automation_other")

const insertSession = (id: Session.ID, directory: string) =>
  Database.Service.use(({ db }) =>
    db
      .insert(SessionTable)
      .values({ id, project_id: Project.ID.global, slug: id, directory, title: "test", version: "test" })
      .run()
      .pipe(Effect.orDie),
  )

const setup = (directory = enabledDirectory) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* insertSession(sessionID, directory)
    wakes.length = 0
    duringWake = Effect.void
    toggle.on = false
    toggle.reads = 0
    folders.missingNow = false
    slack.replies = 0
    slack.reads = 0
    slack.posts = []
    slack.failing = false
    agentRules = [{ action: "*", resource: "*", effect: "allow" }]
    activationGate = Effect.void
    return yield* Automation.Service
  })

const setTime = (iso: string) => TestClock.setTime(Date.parse(iso))
const pending = Database.Service.use(({ db }) =>
  db
    .select({ id: SessionInboxTable.id, sessionID: SessionInboxTable.session_id })
    .from(SessionInboxTable)
    .all()
    .pipe(Effect.orDie),
)
const pendingIDs = pending.pipe(Effect.map((rows) => rows.map((row) => row.id)))
/** Moves pending prompts into the transcript, as a running Session would. */
const deliver = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* SessionInbox.promote(db, yield* Bus.Service, sessionID, "steer")
})
const messageID = (automation: Automation.Info, run: number) => SessionMessage.ID.make(`msg_${automation.id}_${run}`)
const iso = (time: DateTime.Utc | undefined) => time && DateTime.formatIso(time)
const prompt = (text: string) => ({ type: "prompt" as const, prompt: text })
const code = (text: string, args?: Schema.Json) => ({ type: "code" as const, code: text, args })
const every = (value: string) => ({ type: "every" as const, every: value })

describe("Automation", () => {
  it.effect("runs an at automation once, into the creating Session by default", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const automation = yield* automations.create({
        sessionID,
        name: "build",
        trigger: { type: "at", at: "in 5 minutes" },
        action: prompt("check the build"),
      })
      expect(automation).toMatchObject({
        tz: "America/New_York",
        directory: enabledDirectory,
        projectID: Project.ID.global,
        sessionID,
        trigger: { type: "at", at: new Date(5 * 60_000).toISOString() },
        action: { type: "prompt", prompt: "check the build", to: { session: sessionID } },
      })

      yield* TestClock.adjust("4 minutes")
      yield* automations.tick
      expect(yield* pendingIDs).toEqual([])

      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect(yield* pendingIDs).toEqual([messageID(automation, 1)])
      expect(wakes).toEqual([sessionID])
      const { db } = yield* Database.Service
      expect(yield* SessionInbox.find(db, messageID(automation, 1))).toMatchObject({
        type: "user",
        delivery: "steer",
        payload: { text: "check the build", metadata: { automation: { id: automation.id, name: "build", run: 1 } } },
      })
      expect(yield* automations.get(automation.id)).toMatchObject({
        status: "done",
        runCount: 1,
        lastOutcome: "fired",
        lastOutput: `Prompted ${sessionID}`,
        nextDueAt: undefined,
      })

      yield* TestClock.adjust("10 minutes")
      yield* automations.tick
      expect(yield* pendingIDs).toEqual([messageID(automation, 1)])
    }),
  )

  it.effect("parses at times with offsets or in the automation's zone", () =>
    Effect.gen(function* () {
      yield* setTime("2026-11-01T12:00:00Z")
      const automations = yield* setup()
      const at = (value: string, tz?: string) =>
        automations
          .create({ sessionID, name: "at", trigger: { type: "at", at: value, tz }, action: prompt("at") })
          .pipe(Effect.map((automation) => iso(automation.nextDueAt)))
      expect(yield* at("2026-11-02T09:30:00-05:00")).toBe("2026-11-02T14:30:00.000Z")
      expect(yield* at("2026-11-02T09:30")).toBe("2026-11-02T14:30:00.000Z")
      expect(yield* at("2026-11-02 14:30:00Z")).toBe("2026-11-02T14:30:00.000Z")
      expect(yield* at("2026-11-02T09:30", "Europe/Paris")).toBe("2026-11-02T08:30:00.000Z")
      expect(yield* Effect.flip(at("2026-11-01T11:00:00Z"))).toMatchObject({
        _tag: "Automation.InvalidError",
        reason: "Time is in the past: 2026-11-01T11:00:00Z",
      })
      expect(yield* Effect.flip(at("in 0 seconds"))).toMatchObject({ _tag: "Automation.InvalidError" })
    }),
  )

  it.effect("creates, lists, pauses, resumes and deletes", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const automation = yield* automations.create({
        sessionID,
        name: "poll",
        trigger: every("1 minute"),
        action: prompt("poll"),
      })
      expect((yield* automations.list({ projectID: Project.ID.global })).map((item) => item.id)).toEqual([
        automation.id,
      ])
      expect((yield* automations.list({ sessionID: otherID })).map((item) => item.id)).toEqual([])

      expect((yield* automations.pause(automation.id)).status).toBe("paused")
      yield* TestClock.adjust("150 seconds")
      yield* automations.tick
      expect(yield* pendingIDs).toEqual([])

      const resumed = yield* automations.resume(automation.id)
      expect(resumed.status).toBe("active")
      expect(iso(resumed.nextDueAt)).toBe(new Date(180_000).toISOString())
      yield* automations.remove(automation.id)
      expect(yield* Effect.flip(automations.get(automation.id))).toMatchObject({ _tag: "Automation.NotFoundError" })
    }),
  )

  it.effect("sends a prompt to another existing Session", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      yield* insertSession(otherID, enabledDirectory)
      const automation = yield* automations.create({
        sessionID,
        name: "nudge",
        trigger: { type: "at", at: "in 1 minute" },
        action: { type: "prompt", prompt: "nudge", to: { session: otherID } },
      })
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect(yield* pending).toEqual([{ id: messageID(automation, 1), sessionID: otherID }])
      expect(wakes).toEqual([otherID])

      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.make("prj_elsewhere"), worktree: AbsolutePath.make("/elsewhere"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .update(SessionTable)
        .set({ project_id: Project.ID.make("prj_elsewhere") })
        .where(eq(SessionTable.id, otherID))
        .run()
        .pipe(Effect.orDie)
      expect(
        yield* Effect.flip(
          automations.create({
            sessionID,
            name: "reach",
            trigger: every("1 hour"),
            action: { type: "prompt", prompt: "x", to: { session: otherID } },
          }),
        ),
      ).toMatchObject({ reason: `Session ${otherID} is in another project` })
    }),
  )

  it.effect("starts a new Session with the agent on each run", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const automation = yield* automations.create({
        sessionID,
        name: "triage",
        trigger: every("1 minute"),
        action: { type: "prompt", prompt: "triage the inbox", to: { new: Agent.defaultID } },
      })
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      yield* TestClock.adjust("1 minute")
      yield* automations.tick

      const rows = yield* pending
      expect(rows.map((row) => row.id)).toEqual([messageID(automation, 1), messageID(automation, 2)])
      const started = rows.map((row) => row.sessionID)
      expect(new Set([sessionID, ...started]).size).toBe(3)
      const sessions = yield* Session.Service
      const first = yield* sessions.get(started[0]!)
      expect(first).toMatchObject({
        agent: Agent.defaultID,
        title: "triage",
        location: { directory: enabledDirectory },
      })
      expect(yield* automations.get(automation.id)).toMatchObject({
        runCount: 2,
        lastOutput: `Started ${started[1]}`,
      })
    }),
  )

  it.effect("runs without a Session in the given directory, and needs a target for a prompt", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const automation = yield* automations.create({
        name: "standalone",
        directory: enabledDirectory,
        trigger: { type: "at", at: "in 1 minute" },
        action: { type: "prompt", prompt: "hello", to: { new: Agent.defaultID } },
      })
      expect(automation).toMatchObject({ sessionID: undefined, directory: enabledDirectory })
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect((yield* pending).map((row) => row.id)).toEqual([messageID(automation, 1)])

      expect(
        yield* Effect.flip(
          automations.create({ name: "x", directory: enabledDirectory, trigger: every("1 hour"), action: prompt("x") }),
        ),
      ).toMatchObject({ reason: "A prompt action needs `to` when there is no session" })
      expect(
        yield* Effect.flip(
          automations.create({ name: "x", directory: enabledDirectory, trigger: every("1 hour"), action: code("") }),
        ),
      ).toMatchObject({ reason: "A code action needs a session" })
      expect(
        yield* Effect.flip(
          automations.create({
            name: "x",
            directory: "relative",
            trigger: every("1 hour"),
            action: { type: "prompt", prompt: "x", to: { new: Agent.defaultID } },
          }),
        ),
      ).toMatchObject({ reason: "Directory must be an absolute path: relative" })
      expect(
        yield* Effect.flip(
          automations.create({
            name: "x",
            directory: enabledDirectory,
            trigger: every("1 hour"),
            action: { type: "prompt", prompt: "x", to: { new: Agent.ID.make("nobody") } },
          }),
        ),
      ).toMatchObject({ reason: "Unknown agent: nobody" })
    }),
  )

  it.effect("stops at expires", () =>
    Effect.gen(function* () {
      yield* setTime("2026-10-26T12:00:00Z")
      const automations = yield* setup()
      const automation = yield* automations.create({
        sessionID,
        name: "poll",
        trigger: every("10 minutes"),
        expires: "2026-10-26T12:25:00Z",
        action: prompt("poll"),
      })
      expect(iso(automation.expires)).toBe("2026-10-26T12:25:00.000Z")
      for (const _ of [1, 2, 3]) {
        yield* TestClock.adjust("10 minutes")
        yield* automations.tick
        yield* deliver
      }
      expect(yield* automations.get(automation.id)).toMatchObject({ status: "done", runCount: 2 })
      expect(
        yield* Effect.flip(
          automations.create({
            sessionID,
            name: "late",
            trigger: { type: "at", at: "in 2 hours" },
            expires: "in 1 hour",
            action: prompt("x"),
          }),
        ),
      ).toMatchObject({ reason: "The automation expires before it first runs" })
    }),
  )

  it.effect("runs once after downtime, marked late, and keeps the phase", () =>
    Effect.gen(function* () {
      yield* setTime("2026-10-26T12:00:00Z")
      const automations = yield* setup()
      const automation = yield* automations.create({
        sessionID,
        name: "poll",
        trigger: every("10 minutes"),
        action: prompt("poll"),
      })

      yield* setTime("2026-10-26T13:05:00Z")
      yield* automations.tick
      yield* automations.tick
      expect(yield* pendingIDs).toEqual([messageID(automation, 1)])
      expect(yield* automations.get(automation.id)).toMatchObject({ runCount: 1, lastOutcome: "late" })
      expect(iso((yield* automations.get(automation.id)).nextDueAt)).toBe("2026-10-26T13:10:00.000Z")
    }),
  )

  it.effect("skips a run while the previous prompt is unconsumed", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const automation = yield* automations.create({
        sessionID,
        name: "poll",
        trigger: every("1 minute"),
        action: prompt("poll"),
      })
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect(yield* pendingIDs).toEqual([messageID(automation, 1)])
      expect(yield* automations.get(automation.id)).toMatchObject({ runCount: 1, lastOutcome: "skipped" })
      // The skip wakes the Session again in case the wake after admission was lost.
      expect(wakes).toEqual([sessionID, sessionID])

      yield* deliver
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect(yield* pendingIDs).toEqual([messageID(automation, 2)])
    }),
  )

  it.effect("does not duplicate a prompt admitted before a crash", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const sessions = yield* Session.Service
      const automation = yield* automations.create({
        sessionID,
        name: "once",
        trigger: { type: "at", at: "in 1 minute" },
        action: prompt("once"),
      })
      yield* TestClock.adjust("1 minute")
      // The previous process admitted run 1 and died before advancing the row.
      yield* sessions.prompt({ sessionID, id: messageID(automation, 1), text: "once", resume: false })

      yield* automations.tick
      expect(yield* pendingIDs).toEqual([messageID(automation, 1)])
      expect(wakes).toEqual([sessionID])
      expect(yield* automations.get(automation.id)).toMatchObject({ status: "done", runCount: 1 })
    }),
  )

  it.effect("keeps automations when their creating Session is deleted, and pauses when a target is gone", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      yield* insertSession(otherID, enabledDirectory)
      const fresh = yield* automations.create({
        sessionID,
        name: "fresh",
        trigger: every("1 minute"),
        action: { type: "prompt", prompt: "go", to: { new: Agent.defaultID } },
      })
      const targeted = yield* automations.create({
        sessionID: otherID,
        name: "targeted",
        trigger: every("1 minute"),
        action: { type: "prompt", prompt: "go", to: { session: sessionID } },
      })
      const coded = yield* automations.create({
        sessionID,
        name: "coded",
        trigger: every("1 minute"),
        action: code("return"),
      })
      const { db } = yield* Database.Service
      yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
      expect((yield* automations.list()).map((item) => item.id)).toEqual([fresh.id, targeted.id, coded.id])

      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect(yield* automations.get(fresh.id)).toMatchObject({ status: "active", runCount: 1 })
      expect(yield* automations.get(targeted.id)).toMatchObject({
        status: "paused",
        runCount: 0,
        lastOutput: `Target session ${sessionID} no longer exists`,
      })
      expect(yield* automations.get(coded.id)).toMatchObject({
        status: "paused",
        runCount: 0,
        lastOutput: "The session that authorized this automation's tools no longer exists",
      })
    }),
  )

  it.effect("rejects creation when experimental.automations is off, and leaves rows alone", () =>
    Effect.gen(function* () {
      const automations = yield* setup(disabledDirectory)
      expect(
        yield* Effect.flip(
          automations.create({ sessionID, name: "x", trigger: { type: "at", at: "in 1 minute" }, action: prompt("x") }),
        ),
      ).toMatchObject({ _tag: "Automation.DisabledError" })

      const { db } = yield* Database.Service
      yield* db
        .insert(AutomationTable)
        .values({
          id: Automation.ID.create(),
          project_id: Project.ID.global,
          session_id: sessionID,
          directory: disabledDirectory,
          name: "x",
          action: { type: "prompt", prompt: "poll", to: { session: sessionID } },
          trigger: { type: "at", at: "1970-01-01T00:01:00Z" },
          tz: "UTC",
          next_due_at: 0,
          time_created: 0,
          time_updated: 0,
        })
        .run()
        .pipe(Effect.orDie)
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect(yield* pendingIDs).toEqual([])
      expect((yield* automations.list())[0]).toMatchObject({ runCount: 0, lastOutcome: "disabled" })
    }),
  )

  it.effect("rechecks hourly while its location has the flag off, then catches up once it is on", () =>
    Effect.gen(function* () {
      const automations = yield* setup(toggleDirectory)
      const { db } = yield* Database.Service
      const id = Automation.ID.create()
      yield* db
        .insert(AutomationTable)
        .values({
          id,
          project_id: Project.ID.global,
          session_id: sessionID,
          directory: toggleDirectory,
          name: "poll",
          action: { type: "prompt", prompt: "poll", to: { session: sessionID } },
          trigger: every("1 minute"),
          tz: "UTC",
          next_due_at: 60_000,
          time_created: 0,
          time_updated: 0,
        })
        .run()
        .pipe(Effect.orDie)
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect(yield* automations.get(id)).toMatchObject({ status: "active", runCount: 0, lastOutcome: "disabled" })
      const reads = toggle.reads
      expect(reads).toBeGreaterThan(0)

      // Within the hour the location is not booted to read the flag again.
      yield* TestClock.adjust("59 minutes")
      yield* automations.tick
      expect(toggle.reads).toBe(reads)

      // Once the flag is on and the hour has passed, the missed slot runs once, late, and keeps the phase.
      toggle.on = true
      yield* TestClock.adjust("2 minutes")
      yield* automations.tick
      expect(yield* pendingIDs).toEqual([SessionMessage.ID.make(`msg_${id}_1`)])
      expect(yield* automations.get(id)).toMatchObject({
        status: "active",
        runCount: 1,
        lastOutcome: "late",
        nextDueAt: DateTime.makeUnsafe(63 * 60_000),
      })
    }),
  )

  it.effect("keeps the run count when paused while a prompt is being admitted", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const automation = yield* automations.create({
        sessionID,
        name: "poll",
        trigger: every("1 minute"),
        action: prompt("poll"),
      })
      yield* TestClock.adjust("1 minute")
      duringWake = automations.pause(automation.id).pipe(Effect.orDie, Effect.asVoid)
      yield* automations.tick
      expect(yield* automations.get(automation.id)).toMatchObject({ status: "paused", runCount: 1 })
      yield* deliver

      yield* automations.resume(automation.id)
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect(yield* pendingIDs).toEqual([messageID(automation, 2)])
    }),
  )

  it.effect("pauses with a reason when its directory disappears", () =>
    Effect.gen(function* () {
      const automations = yield* setup(missingDirectory)
      const automation = yield* automations.create({
        sessionID,
        name: "poll",
        trigger: every("1 minute"),
        action: prompt("poll"),
      })
      folders.missingNow = true
      const map = yield* LocationServiceMap.Service
      yield* map.invalidate(Location.Ref.make({ directory: AbsolutePath.make(missingDirectory) }))

      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect(yield* automations.get(automation.id)).toMatchObject({
        status: "paused",
        lastOutcome: "failed",
        lastOutput: `Directory no longer exists: ${missingDirectory}`,
      })
      expect(
        yield* Effect.flip(automations.create({ sessionID, name: "x", trigger: every("1 hour"), action: prompt("x") })),
      ).toMatchObject({ reason: `Directory does not exist: ${missingDirectory}` })
    }),
  )

  it.effect("run sleeps until the next automation is due", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const fiber = yield* Effect.forkChild(automations.run)
      const automation = yield* automations.create({
        sessionID,
        name: "soon",
        trigger: { type: "at", at: "in 10 seconds" },
        action: prompt("soon"),
      })
      yield* TestClock.adjust("9 seconds")
      expect(yield* pendingIDs).toEqual([])
      yield* TestClock.adjust("1 second")
      yield* Effect.yieldNow
      expect(yield* pendingIDs).toEqual([messageID(automation, 1)])
      yield* Fiber.interrupt(fiber)
    }),
  )

  it.effect("wakes a Session on start when its automation prompt was never claimed", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      yield* automations.create({
        sessionID,
        name: "once",
        trigger: { type: "at", at: "in 1 minute" },
        action: prompt("once"),
      })
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      // The process died before the Session claimed the prompt, so that wake was lost.
      wakes.length = 0
      const fiber = yield* Effect.forkChild(automations.run)
      yield* Effect.yieldNow
      expect(wakes).toEqual([sessionID])
      yield* Fiber.interrupt(fiber)
    }),
  )

  it.effect("backs off for five minutes when a prompt fails, then runs once", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const automation = yield* automations.create({
        sessionID,
        name: "flaky",
        trigger: { type: "at", at: "in 1 minute" },
        action: prompt("flaky"),
      })
      yield* TestClock.adjust("1 minute")
      duringWake = Effect.die("wake failed")
      yield* automations.tick
      expect(yield* automations.get(automation.id)).toMatchObject({
        status: "active",
        runCount: 0,
        lastOutcome: "failed",
      })

      // Not retried on every tick.
      wakes.length = 0
      yield* TestClock.adjust("4 minutes")
      yield* automations.tick
      expect(wakes).toEqual([])

      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect(wakes).toEqual([sessionID])
      expect(yield* automations.get(automation.id)).toMatchObject({ status: "done", runCount: 1, lastOutcome: "late" })
    }),
  )

  // On 2026-11-01 New York falls back at 06:00Z, so 1:00-1:59 runs twice: 05:00Z EDT, then 06:00Z EST.
  const cron = (automations: Automation.Interface, expression: string) =>
    automations.create({
      sessionID,
      name: expression,
      trigger: { type: "cron", cron: expression, tz: "America/New_York" },
      action: prompt(expression),
    })

  it.effect("keeps cron at the same wall-clock time across DST changes", () =>
    Effect.gen(function* () {
      yield* setTime("2026-11-01T05:50:00Z")
      const automations = yield* setup()
      // 1:50 EDT ran the last 1:xx slot; the next is 2:00 EST, an hour and ten minutes later.
      expect(iso((yield* cron(automations, "*/10 * * * *")).nextDueAt)).toBe("2026-11-01T07:00:00.000Z")
      yield* setTime("2026-11-01T05:00:00Z")
      const fixed = yield* cron(automations, "30 1 * * *")
      yield* setTime("2026-11-01T05:30:00Z")
      yield* automations.tick
      expect(iso((yield* automations.get(fixed.id)).nextDueAt)).toBe("2026-11-02T06:30:00.000Z")
      expect(yield* Effect.flip(cron(automations, "0 0 31 2 *"))).toMatchObject({ _tag: "Automation.InvalidError" })
    }),
  )

  it.effect("picks up an automation created by another process sharing the DB while idle", () =>
    Effect.gen(function* () {
      const primary = yield* setup()
      const { db } = yield* Database.Service
      const runner = yield* Effect.forkChild(primary.run)
      yield* Effect.repeat(Effect.yieldNow, { times: 5 })

      // Insert directly into SQLite, so primary's in-memory doorbell is never opened.
      const now = yield* Clock.currentTimeMillis
      const externalID = Automation.ID.create()
      yield* db
        .insert(AutomationTable)
        .values({
          id: externalID,
          project_id: Project.ID.global,
          session_id: sessionID,
          directory: enabledDirectory,
          name: "external",
          action: { type: "prompt", prompt: "Cross-process wake.", to: { session: sessionID } },
          trigger: { type: "at", at: new Date(now + 10_000).toISOString() },
          tz: "UTC",
          next_due_at: now + 10_000,
          time_created: now,
          time_updated: now,
        })
        .run()
        .pipe(Effect.orDie)

      // Bounded MAX_SLEEP (30s) wakes the idle loop, claims leadership, and runs the row.
      yield* TestClock.adjust("30 seconds")
      yield* Effect.repeat(Effect.yieldNow, { times: 5 })
      yield* Fiber.interrupt(runner)
      expect(yield* primary.get(externalID)).toMatchObject({ status: "done", runCount: 1, lastOutcome: "fired" })
    }),
  )

  describe("code actions", () => {
    const watchThread = `
      const thread = await tools.slack.read_thread({})
      console.log("replies: " + thread.replies)
      if (state !== null && thread.replies > state.replies) await tools.slack.post({ text: args.channel + ": " + thread.replies })
      if (thread.replies >= 10) return { done: true }
      return { state: { replies: thread.replies, runs } }
    `

    it.effect("keeps state across runs, stays quiet without a return, and stops when done", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        slack.replies = 3
        const automation = yield* automations.create({
          sessionID,
          name: "thread",
          trigger: every("1 minute"),
          action: code(watchThread, { channel: "#ops" }),
        })
        // Nothing runs at creation.
        expect(slack.reads).toBe(0)

        yield* TestClock.adjust("1 minute")
        yield* automations.tick
        expect(yield* automations.get(automation.id)).toMatchObject({
          status: "active",
          runCount: 1,
          lastOutcome: "fired",
          lastOutput: "replies: 3",
          state: { replies: 3, runs: 0 },
        })
        expect(slack.posts).toEqual([])

        slack.replies = 4
        yield* TestClock.adjust("1 minute")
        yield* automations.tick
        expect(slack.posts).toEqual(["#ops: 4"])
        expect(yield* automations.get(automation.id)).toMatchObject({ runCount: 2, state: { replies: 4, runs: 1 } })
        // A code action never prompts a Session.
        expect(yield* pendingIDs).toEqual([])

        slack.replies = 10
        yield* TestClock.adjust("1 minute")
        yield* automations.tick
        // `done` without `state` keeps the previous state.
        expect(yield* automations.get(automation.id)).toMatchObject({
          status: "done",
          runCount: 3,
          nextDueAt: undefined,
          state: { replies: 4, runs: 1 },
        })
      }),
    )

    it.effect("a program that returns nothing leaves state unchanged", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const automation = yield* automations.create({
          sessionID,
          name: "quiet",
          trigger: every("1 minute"),
          action: code(`if (state === null) return { state: { seen: input.runs } }`),
        })
        for (const _ of [1, 2, 3]) {
          yield* TestClock.adjust("1 minute")
          yield* automations.tick
        }
        expect(yield* automations.get(automation.id)).toMatchObject({
          status: "active",
          runCount: 3,
          state: { seen: 0 },
          lastOutput: undefined,
        })
      }),
    )

    it.effect("keeps state on failure, retries a minute later, and pauses after 3 failed runs", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const automation = yield* automations.create({
          sessionID,
          name: "thread",
          trigger: every("1 minute"),
          action: code(`const t = await tools.slack.read_thread({}); return { state: { replies: t.replies } }`),
        })
        slack.replies = 2
        yield* TestClock.adjust("1 minute")
        yield* automations.tick
        expect((yield* automations.get(automation.id)).state).toEqual({ replies: 2 })

        slack.failing = true
        slack.replies = 5
        for (const strike of [1, 2]) {
          yield* TestClock.adjust("1 minute")
          yield* automations.tick
          expect(yield* automations.get(automation.id)).toMatchObject({
            status: "active",
            runCount: 1,
            lastOutcome: "failed",
            lastOutput: expect.stringContaining("Slack is down"),
            state: { replies: 2 },
          })
          expect(strike).toBeLessThan(3)
        }
        yield* TestClock.adjust("1 minute")
        yield* automations.tick
        expect(yield* automations.get(automation.id)).toMatchObject({
          status: "paused",
          runCount: 1,
          lastOutcome: "failed",
          lastOutput: expect.stringContaining("Paused after 3 failed runs"),
          state: { replies: 2 },
        })
      }),
    )

    it.effect("pauses at once when a run returns an invalid shape", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const automation = yield* automations.create({
          sessionID,
          name: "bad",
          trigger: every("1 minute"),
          action: code(`return "not-a-result"`),
        })
        yield* TestClock.adjust("1 minute")
        yield* automations.tick
        expect(yield* automations.get(automation.id)).toMatchObject({
          status: "paused",
          runCount: 0,
          lastOutcome: "failed",
          lastOutput: expect.stringContaining("must return nothing or { state?, done? }"),
        })
      }),
    )

    it.effect("extracts tools at creation, asks once without save, and runs unattended after", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        agentRules = [{ action: "*", resource: "*", effect: "ask" }]
        const bus = yield* Bus.Service
        const instances = yield* Instance.Service
        const session = yield* Session.Service.use((sessions) => sessions.get(sessionID))
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

        const automation = yield* automations.create({
          sessionID,
          name: "thread",
          trigger: every("1 minute"),
          action: code(watchThread, { channel: "#ops" }),
        })
        yield* Fiber.interrupt(answerLoop)
        expect(asked.map((request) => request.action)).toEqual(["slack_read_thread", "slack_post"])
        expect(asked[0]).toMatchObject({
          metadata: {
            automation: "thread",
            trigger: { type: "every", every: "1 minute" },
            unattended: true,
            tools: ["slack.read_thread", "slack.post"],
          },
        })
        expect(asked.every((request) => request.save === undefined)).toBe(true)

        // Runs proceed without asking again.
        slack.replies = 1
        yield* TestClock.adjust("1 minute")
        yield* automations.tick
        slack.replies = 2
        yield* TestClock.adjust("1 minute")
        yield* automations.tick
        expect(asked).toHaveLength(2)
        expect(slack.posts).toEqual(["#ops: 2"])
        expect(yield* automations.get(automation.id)).toMatchObject({ runCount: 2, lastOutcome: "fired" })
      }),
    )

    it.effect("rejects dynamic tool access, unknown tools, recursive automation tools and denied permissions", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const bad = (text: string) =>
          Effect.flip(automations.create({ sessionID, name: "bad", trigger: every("1 minute"), action: code(text) }))

        expect(yield* bad("const x = {")).toMatchObject({ _tag: "Automation.InvalidError" })
        expect(yield* bad("return await tools.slack[name]({})")).toMatchObject({ _tag: "Automation.InvalidError" })
        expect(yield* bad("return await tools.slack.missing({})")).toMatchObject({
          reason: "Unknown Code Mode tool: slack.missing",
        })
        expect(yield* bad("return await tools.opencode.automation_create({})")).toMatchObject({
          reason: "Tool opencode.automation_create cannot be used inside an automation",
        })
        expect(
          yield* Effect.flip(
            automations.create({ sessionID, name: "fast", trigger: every("10 seconds"), action: code("return") }),
          ),
        ).toMatchObject({ reason: "every must be at least 15 seconds" })

        agentRules = [{ action: "slack_post", resource: "*", effect: "deny" }]
        const map = yield* LocationServiceMap.Service
        yield* map.invalidate(Location.Ref.make({ directory: AbsolutePath.make(enabledDirectory) }))
        expect(yield* bad("await tools.slack.post({ text: 'x' })")).toMatchObject({ _tag: "Permission.BlockedError" })
        expect(yield* automations.list()).toEqual([])
      }),
    )

    it.effect("waits for plugins to activate before authorizing", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const gate = yield* Latch.make()
        activationGate = gate.await
        const creating = yield* Effect.forkChild(
          automations.create({
            sessionID,
            name: "thread",
            trigger: every("1 minute"),
            action: code(`await tools.slack.read_thread({})`),
          }),
        )
        yield* Effect.repeat(Effect.yieldNow, { times: 5 })
        expect(yield* automations.list()).toEqual([])
        yield* gate.open
        expect((yield* Fiber.join(creating)).status).toBe("active")
      }),
    )
  })
})
