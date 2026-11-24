import { describe, expect } from "bun:test"
import { FileSystem } from "@opencode/core/filesystem"
import { Clock, DateTime, Effect, Fiber, Latch, Layer, LayerMap, Queue, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { eq } from "drizzle-orm"
import { Agent } from "@opencode/core/agent"
import { App } from "@opencode/core/app"
import { Automation } from "@opencode/core/automation"
import { AutomationTable } from "@opencode/core/automation/sql"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Image } from "@opencode/core/image"
import { Instance } from "@opencode/core/instance/service"
import { KVTable } from "@opencode/core/kv/sql"
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
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Skill } from "@opencode/core/skill"
import { Config } from "@opencode/core/config"
import { Document, Info } from "@opencode/schema/config"
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
    }),
  }),
]
const disabledEntries = [
  new Document({
    type: "document",
    info: new Info({
      automations: false,
    }),
  }),
]
const enabled = Config.testLayer(enabledEntries)
const disabled = Config.testLayer(disabledEntries)
/** A location whose config the test changes, counting every config read. */
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
const slack = { replies: 0, reads: 0, posts: [] as string[], failing: false, messageIDs: [] as SessionMessage.ID[] }
let agentRules: Permission.Ruleset = [{ action: "*", resource: "*", effect: "allow" }]
let activationGate: Effect.Effect<void> = Effect.void
let helperGone = false

const configureAgent = Layer.effectDiscard(
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const tools = yield* Tool.Service
    const permission = yield* Permission.Service
    yield* agents.transform((editor) => {
      editor.update(Agent.defaultID, (agent) => {
        agent.permissions = [...agentRules]
      })
      editor.update(Agent.ID.make("helper"), (agent) => {
        agent.mode = "subagent"
      })
      editor.update(Agent.ID.make("internal"), (agent) => {
        agent.mode = "subagent"
        agent.hidden = true
      })
      if (helperGone) editor.remove(Agent.ID.make("helper"))
    })
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
                slack.messageIDs.push(context.messageID)
                return Effect.succeed({ output: { replies: slack.replies } })
              }),
            ),
      })
      editor.add({
        name: "automation",
        description: "The automation making the call, if any",
        input: Schema.Struct({}),
        output: Schema.NullOr(Schema.String),
        options: { namespace: "probe" },
        execute: (_input, context) => Effect.succeed({ output: context.automation?.id ?? null }),
      })
      editor.add({
        name: "post",
        description: "Post a message",
        input: Schema.Struct({ text: Schema.String, channel: Schema.optional(Schema.String) }),
        options: { namespace: "slack" },
        execute: (input, context) =>
          permission
            .assert({
              action: "slack_post",
              resources: [input.channel ?? "general"],
              sessionID: context.sessionID,
              agent: context.agent,
            })
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
      const projects = yield* Project.Service
      // Resolve our virtual directories before the scheduler starts: real filesystem I/O during a TestClock step
      // can outlive the step while a tick is still acquiring the Location.
      const places = new Map(
        yield* Effect.forEach([enabledDirectory, disabledDirectory, toggleDirectory, missingDirectory], (dir) =>
          projects
            .resolve(AbsolutePath.make(dir), { persist: false })
            .pipe(Effect.map((project) => [dir, project] as const)),
        ),
      )
      return yield* LayerMap.make(
        (ref: Location.Ref): Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError> => {
          const project = places.get(ref.directory)
          if (!project) throw new Error(`Unknown test location: ${ref.directory}`)
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
                    PluginHooks.node,
                    Skill.node,
                    Tool.node,
                    Agent.node,
                    Permission.node,
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
                      Location.node.replace(Layer.succeed(Location.Service, { ...ref, project })),
                      Image.node.replace(imagePassthrough),
                    ],
                  },
                ),
              ),
            ),
            Layer.mock(McpTool.Service, { flush: Effect.void }),
            Layer.mock(Plugin.Service, {
              awaitActivation: Effect.suspend(() => activationGate),
            }),
          ).pipe(Layer.fresh) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>
        },
      )
    }),
  ),
  deps: [App.node, Bus.node, SessionStore.node, PermissionSaved.node, Project.node],
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
const invocation = Permission.invocation({
  sessionID,
  agent: Agent.defaultID,
  messageID: SessionMessage.ID.make("msg_author"),
  id: Tool.CallID.make("create_automation"),
})

const insertSession = (id: Session.ID, directory: string) =>
  Session.Service.use((sessions) => sessions.create({ id, location: { directory: AbsolutePath.make(directory) } }))

const creator = Session.Service.use((sessions) => sessions.get(sessionID))

const setup = (directory = enabledDirectory) =>
  Effect.gen(function* () {
    yield* insertSession(sessionID, directory)
    wakes.length = 0
    duringWake = Effect.void
    toggle.on = false
    toggle.reads = 0
    folders.missingNow = false
    slack.replies = 0
    slack.reads = 0
    slack.messageIDs = []
    slack.posts = []
    slack.failing = false
    agentRules = [{ action: "*", resource: "*", effect: "allow" }]
    activationGate = Effect.void
    helperGone = false
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
const messageID = (automation: Automation.Info, run: number) =>
  SessionMessage.ID.make(`msg_${automation.id}_${run}${automation.action.type === "code" ? "_send" : ""}`)
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
        projectID: (yield* creator).projectID,
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
      expect((yield* automations.list({ projectID: (yield* creator).projectID })).map((item) => item.id)).toEqual([
        automation.id,
      ])
      expect(yield* Effect.flip(automations.list({ sessionID: otherID }))).toMatchObject({
        _tag: "Session.NotFoundError",
      })

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

  it.effect("rejects tool-created code and child actions if the session switched agents during the model request", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const sessions = yield* Session.Service
      const helper = Agent.ID.make("helper")
      yield* sessions.setPermissions({ sessionID, permissions: [{ action: "*", resource: "*", effect: "allow" }] })
      yield* sessions.switchAgent({ sessionID, agent: helper })
      for (const action of [code("return"), { ...prompt("triage"), to: { subagent: helper } }]) {
        const stale = automations.create({ sessionID, name: "stale", trigger: every("1 minute"), action }, invocation)
        expect(yield* Effect.flip(stale)).toMatchObject({
          _tag: "Automation.InvalidError",
          reason: expect.stringContaining("current agent"),
        })
      }
      expect(yield* automations.list()).toEqual([])
    }),
  )

  it.effect("sends a prompt to another existing Session", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      yield* insertSession(otherID, enabledDirectory)
      const automation = yield* automations.create({
        sessionID,
        name: "nudge",
        trigger: every("1 minute"),
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

      // A target that moves away after creation pauses the automation rather than prompting outside the project.
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect(yield* automations.get(automation.id)).toMatchObject({
        status: "paused",
        runCount: 1,
        lastOutput: `Target session ${otherID} moved to another project`,
      })
    }),
  )

  it.effect("starts a child of the creating Session with the agent on each run, without waking the parent", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const helper = Agent.ID.make("helper")
      const automation = yield* automations.create({
        sessionID,
        name: "triage",
        trigger: every("1 minute"),
        action: { type: "prompt", prompt: "triage the inbox", to: { subagent: helper } },
      })
      expect(automation.action).toEqual({ type: "prompt", prompt: "triage the inbox", to: { subagent: helper } })
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      yield* TestClock.adjust("1 minute")
      yield* automations.tick

      const rows = yield* pending
      expect(rows.map((row) => row.id)).toEqual([messageID(automation, 1), messageID(automation, 2)])
      const children = rows.map((row) => row.sessionID)
      // One child per run, with an id derived from the run so a retry adopts it rather than starting another.
      expect(children).toEqual([Session.ID.make(`ses_${automation.id}_1`), Session.ID.make(`ses_${automation.id}_2`)])
      // Only the children are woken; the parent hears nothing.
      expect(wakes).toEqual(children)
      const sessions = yield* Session.Service
      expect(yield* sessions.get(children[0]!)).toMatchObject({
        parentID: sessionID,
        agent: helper,
        title: "triage",
        location: { directory: enabledDirectory },
      })
      expect(yield* automations.get(automation.id)).toMatchObject({
        runCount: 2,
        lastOutput: `Started subagent ${children[1]}`,
      })
    }),
  )

  it.effect("adopts the child a crashed run already started", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const sessions = yield* Session.Service
      const automation = yield* automations.create({
        sessionID,
        name: "triage",
        trigger: { type: "at", at: "in 1 minute" },
        action: { type: "prompt", prompt: "once", to: { subagent: Agent.ID.make("helper") } },
      })
      yield* TestClock.adjust("1 minute")
      // The previous process started run 1's child, admitted its prompt, and died before advancing the row.
      const child = Session.ID.make(`ses_${automation.id}_1`)
      yield* sessions.create({ id: child, parentID: sessionID, agent: Agent.ID.make("helper"), title: "triage" })
      yield* sessions.prompt({ sessionID: child, id: messageID(automation, 1), text: "once", resume: false })

      yield* automations.tick
      expect(yield* pending).toEqual([{ id: messageID(automation, 1), sessionID: child }])
      expect((yield* sessions.list({ parentID: sessionID })).data.map((session) => session.id)).toEqual([child])
      expect(yield* automations.get(automation.id)).toMatchObject({ status: "done", runCount: 1 })
    }),
  )

  it.effect("allows any agent that can run as a subagent, and rejects hidden and primary-only agents", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const create = (agent: string) =>
        automations.create(
          {
            sessionID,
            name: "x",
            trigger: every("1 hour"),
            action: { ...prompt("x"), to: { subagent: Agent.ID.make(agent) } },
          },
          invocation,
        )
      const automation = yield* create("helper")
      expect(automation.status).toBe("active")
      expect(yield* Effect.flip(create("nobody"))).toMatchObject({ reason: "Unknown subagent: nobody" })
      expect(yield* Effect.flip(create("internal"))).toMatchObject({ reason: "Subagent internal is hidden" })
      expect(yield* Effect.flip(create(Agent.defaultID))).toMatchObject({
        reason: `Agent ${Agent.defaultID} is primary-only`,
      })

      // An agent the creating Session's `subagent` permission denies is out too.
      agentRules = [
        { action: "*", resource: "*", effect: "allow" },
        { action: "subagent", resource: "helper", effect: "deny" },
      ]
      const map = yield* LocationServiceMap.Service
      const ref = Location.Ref.make({ directory: AbsolutePath.make(enabledDirectory) })
      yield* map.invalidate(ref)
      expect(yield* Effect.flip(create("helper"))).toMatchObject({
        reason: "Cannot start subagent helper: Permission denied: subagent",
      })

      agentRules = [{ action: "subagent", resource: "helper", effect: "ask" }]
      yield* map.invalidate(ref)
      expect(yield* Effect.flip(create("helper"))).toMatchObject({
        reason: expect.stringContaining("subagent helper: Permission subagent needs approval"),
      })

      // An agent that is gone by the time a run comes up pauses the automation.
      agentRules = [{ action: "*", resource: "*", effect: "allow" }]
      helperGone = true
      yield* map.invalidate(ref)
      yield* TestClock.adjust("1 hour")
      yield* automations.tick
      expect(yield* automations.get(automation.id)).toMatchObject({
        status: "paused",
        runCount: 0,
        lastOutput: "Unknown subagent: helper",
      })
      expect(yield* pending).toEqual([])
    }),
  )

  it.effect("runs without a Session in the given directory, and needs a target for a prompt", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const sessions = yield* Session.Service
      // Created in the directory's own project, which a sessionless automation there resolves to.
      const target = (yield* sessions.create({ location: { directory: AbsolutePath.make(enabledDirectory) } })).id
      const automation = yield* automations.create({
        name: "standalone",
        directory: enabledDirectory,
        trigger: { type: "at", at: "in 1 minute" },
        action: { type: "prompt", prompt: "hello", to: { session: target } },
      })
      expect(automation).toMatchObject({ sessionID: undefined, directory: enabledDirectory })
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect(yield* pending).toEqual([{ id: messageID(automation, 1), sessionID: target }])

      expect(
        yield* Effect.flip(
          automations.create({ name: "x", directory: enabledDirectory, trigger: every("1 hour"), action: prompt("x") }),
        ),
      ).toMatchObject({ reason: "A prompt action needs `to` when there is no session" })
      expect(
        yield* Effect.flip(
          automations.create({
            name: "x",
            directory: enabledDirectory,
            trigger: every("1 hour"),
            action: { type: "prompt", prompt: "x", to: { subagent: Agent.ID.make("helper") } },
          }),
        ),
      ).toMatchObject({ reason: "A prompt to a subagent needs a session to be its parent" })
      expect(
        yield* Effect.flip(
          automations.create({ name: "x", directory: enabledDirectory, trigger: every("1 hour"), action: code("") }),
        ),
      ).toMatchObject({ reason: "A code action needs a session" })
      expect(
        yield* Effect.flip(
          automations.create({
            name: "x",
            directory: enabledDirectory,
            trigger: every("1 hour"),
            action: { type: "shell", command: "echo x" },
          }),
        ),
      ).toMatchObject({ reason: "A shell action needs a session" })
      expect(
        yield* Effect.flip(
          automations.create({
            name: "x",
            directory: "relative",
            trigger: every("1 hour"),
            action: { type: "prompt", prompt: "x", to: { session: target } },
          }),
        ),
      ).toMatchObject({ reason: "Directory must be an absolute path: relative" })
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

  it.effect("never runs a slot that only comes up after expires, after downtime or on resume", () =>
    Effect.gen(function* () {
      yield* setTime("2026-10-26T12:00:00Z")
      const automations = yield* setup()
      const poll = yield* automations.create({
        sessionID,
        name: "poll",
        trigger: every("10 minutes"),
        expires: "2026-10-26T12:25:00Z",
        action: prompt("poll"),
      })
      const once = yield* automations.create({
        sessionID,
        name: "once",
        trigger: { type: "at", at: "in 10 minutes" },
        expires: "in 20 minutes",
        action: prompt("once"),
      })
      yield* automations.pause(once.id)
      yield* TestClock.adjust("30 minutes")
      yield* automations.tick
      expect(yield* automations.get(poll.id)).toMatchObject({ status: "done", runCount: 0, lastOutcome: "expired" })
      expect(yield* automations.resume(once.id)).toMatchObject({ status: "done", runCount: 0 })
      yield* automations.tick
      expect(yield* pendingIDs).toEqual([])
    }),
  )

  it.effect("drops a run's result when another process recorded a run meanwhile", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const automation = yield* automations.create({
        sessionID,
        name: "poll",
        trigger: every("1 minute"),
        action: prompt("poll"),
      })
      yield* TestClock.adjust("1 minute")
      // Another leader records this run while ours is still admitting it.
      const { db } = yield* Database.Service
      duringWake = db
        .update(AutomationTable)
        .set({ run_count: 1, last_output: "other" })
        .where(eq(AutomationTable.id, automation.id))
        .run()
        .pipe(Effect.orDie, Effect.asVoid)
      yield* automations.tick
      expect(yield* automations.get(automation.id)).toMatchObject({ runCount: 1, lastOutput: "other" })
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
      const elsewhere = yield* automations.create({
        sessionID: otherID,
        name: "elsewhere",
        trigger: every("1 minute"),
        action: { type: "prompt", prompt: "go", to: { session: otherID } },
      })
      const child = yield* automations.create({
        sessionID,
        name: "child",
        trigger: every("1 minute"),
        action: { type: "prompt", prompt: "go", to: { subagent: Agent.ID.make("helper") } },
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
      expect((yield* automations.list()).map((item) => item.id)).toEqual([
        elsewhere.id,
        child.id,
        targeted.id,
        coded.id,
      ])

      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      expect(yield* automations.get(elsewhere.id)).toMatchObject({ status: "active", runCount: 1 })
      expect(yield* automations.get(child.id)).toMatchObject({
        status: "paused",
        runCount: 0,
        lastOutput: "The session that created this automation no longer exists",
      })
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

  it.effect("rejects creation when automations is false", () =>
    Effect.gen(function* () {
      const automations = yield* setup(disabledDirectory)
      expect(
        yield* Effect.flip(
          automations.create({ sessionID, name: "x", trigger: { type: "at", at: "in 1 minute" }, action: prompt("x") }),
        ),
      ).toMatchObject({ _tag: "Automation.DisabledError" })

      expect(yield* automations.list()).toEqual([])
    }),
  )

  it.effect("hides and refuses automations while their location has automations off", () =>
    Effect.gen(function* () {
      const automations = yield* setup(toggleDirectory)
      toggle.on = true
      const { id } = yield* automations.create({
        sessionID,
        name: "poll",
        trigger: every("1 minute"),
        action: prompt("poll"),
      })
      expect((yield* automations.list({ directory: toggleDirectory })).map((item) => item.id)).toEqual([id])
      expect(yield* Effect.flip(automations.list({ directory: "relative" }))).toMatchObject({
        _tag: "Automation.InvalidError",
      })

      toggle.on = false
      expect(yield* automations.list()).toEqual([])
      expect(yield* Effect.flip(automations.list({ directory: toggleDirectory }))).toMatchObject({
        _tag: "Automation.DisabledError",
      })
      expect(yield* Effect.flip(automations.list({ sessionID }))).toMatchObject({ _tag: "Automation.DisabledError" })
      expect(yield* Effect.flip(automations.pause(id))).toMatchObject({ _tag: "Automation.DisabledError" })
      expect(yield* Effect.flip(automations.remove(id))).toMatchObject({ _tag: "Automation.DisabledError" })

      toggle.on = true
      yield* automations.remove(id)
      expect(yield* automations.list()).toEqual([])
    }),
  )

  it.effect("rechecks hourly while automations are disabled in its location, then catches up when enabled", () =>
    Effect.gen(function* () {
      const automations = yield* setup(toggleDirectory)
      toggle.on = true
      const { id } = yield* automations.create({
        sessionID,
        name: "poll",
        trigger: every("1 minute"),
        action: prompt("poll"),
      })
      toggle.on = false
      const before = toggle.reads
      yield* TestClock.adjust("1 minute")
      yield* automations.tick
      // Callers can't read an automation while its location has automations off, so read the row.
      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(AutomationTable).where(eq(AutomationTable.id, id)).get().pipe(Effect.orDie),
      ).toMatchObject({ status: "active", run_count: 0, last_outcome: "disabled" })
      expect(yield* Effect.flip(automations.get(id))).toMatchObject({ _tag: "Automation.DisabledError" })
      expect(yield* automations.list()).toEqual([])
      expect(yield* pendingIDs).toEqual([])
      const reads = toggle.reads
      expect(reads).toBeGreaterThan(before)

      // Within the hour the location is not booted to read config again.
      yield* TestClock.adjust("59 minutes")
      yield* automations.tick
      expect(toggle.reads).toBe(reads)

      // Once automations are enabled and the hour has passed, the missed slot runs once, late, and keeps the phase.
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

  it.effect("does not start queued timers that were paused, deleted or rescheduled", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      // Four earlier actions occupy the workers after the tick has selected every due timer.
      const first = yield* Effect.forEach([1, 2, 3, 4], (n) =>
        automations.create({
          sessionID,
          name: `first ${n}`,
          trigger: { type: "at", at: "in 1 second" },
          action: code("return"),
        }),
      )
      const [paused, deleted, rescheduled] = yield* Effect.forEach(["paused", "deleted", "rescheduled"], (name) =>
        automations.create({
          sessionID,
          name,
          trigger: every("1 minute"),
          action: code(`await tools.slack.post({ text: "${name}" })`),
        }),
      )
      const entered = yield* Latch.make()
      const release = yield* Latch.make()
      activationGate = entered.open.pipe(Effect.andThen(release.await))
      yield* TestClock.adjust("1 minute")
      const ticking = yield* Effect.forkChild(automations.tick, { startImmediately: true })
      yield* entered.await.pipe(Effect.timeout("5 seconds"), TestClock.withLive)
      yield* automations.pause(paused.id)
      yield* automations.remove(deleted.id)
      yield* automations.pause(rescheduled.id)
      yield* automations.resume(rescheduled.id)
      yield* release.open
      yield* Fiber.join(ticking)

      expect(slack.posts).toEqual([])
      expect((yield* automations.get(paused.id)).runCount).toBe(0)
      expect((yield* automations.get(rescheduled.id)).runCount).toBe(0)
      for (const timer of first) expect((yield* automations.get(timer.id)).runCount).toBe(1)
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

  it.effect("does not call a tool while another server holds the lease, then takes over when it expires", () =>
    Effect.gen(function* () {
      const automations = yield* setup()
      const { db } = yield* Database.Service
      const now = yield* Clock.currentTimeMillis
      yield* db
        .insert(KVTable)
        .values({ key: "automation:leader", value: { owner: "other-server", until: now + 60_000 } })
        .run()
      yield* automations.create({
        sessionID,
        name: "one post",
        trigger: { type: "at", at: "in 30 seconds" },
        action: code('await tools.slack.post({ text: "ready" })'),
      })

      yield* TestClock.adjust("30 seconds")
      yield* automations.tick
      expect(slack.posts).toEqual([])
      yield* TestClock.adjust("30 seconds")
      yield* automations.tick
      expect(slack.posts).toEqual(["ready"])
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
          project_id: (yield* creator).projectID,
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
    /** Approves every permission ask "once", as a person at the creating Session would, and records them. */
    const answerAsks = Effect.gen(function* () {
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
      return { asked, answerLoop }
    })
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
        // No send was returned.
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

    // Tools rely on this to know no model is waiting, e.g. the shell tool stops a timed-out command instead of
    // moving it to the background.
    it.effect("names the automation on each of its program's tool calls", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const automation = yield* automations.create({
          sessionID,
          name: "probe",
          trigger: every("1 minute"),
          action: code(`return { state: await tools.probe.automation({}) }`),
        })
        yield* TestClock.adjust("1 minute")
        yield* automations.tick
        expect(yield* automations.get(automation.id)).toMatchObject({ lastOutcome: "fired", state: automation.id })
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
        for (const _ of [1, 2]) {
          yield* TestClock.adjust("1 minute")
          yield* automations.tick
          expect(yield* automations.get(automation.id)).toMatchObject({
            status: "active",
            runCount: 1,
            lastOutcome: "failed",
            lastOutput: expect.stringContaining("Slack is down"),
            state: { replies: 2 },
          })
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
          lastOutput: expect.stringContaining("must return nothing or { state?, done?, send? }"),
        })
      }),
    )

    const tick = (automations: Automation.Interface) =>
      TestClock.adjust("1 minute").pipe(Effect.andThen(automations.tick))

    it.effect("stays quiet while pending, then admits both a progress and a terminal send to the creator", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const automation = yield* automations.create({
          sessionID,
          name: "checks",
          trigger: every("1 minute"),
          action: code(`
          const t = await tools.slack.read_thread({})
          if (!t.replies) return
          if (t.replies === 1) return { state: "in progress", send: { prompt: "First reply" } }
          console.log("checks complete")
          return { done: true, send: { prompt: "All checks passed" } }
        `),
        })
        yield* tick(automations)
        expect(wakes).toEqual([])
        expect(yield* pending).toEqual([])
        expect((yield* automations.get(automation.id)).lastOutput).toBeUndefined()
        slack.replies = 1
        yield* tick(automations)
        expect(yield* automations.get(automation.id)).toMatchObject({
          status: "active",
          runCount: 2,
          state: "in progress",
          lastOutput: `Prompted ${sessionID}`,
        })
        slack.replies = 2
        yield* tick(automations)
        expect(yield* pending).toEqual([2, 3].map((run) => ({ id: messageID(automation, run), sessionID })))
        expect(wakes).toEqual([sessionID, sessionID])
        const { db } = yield* Database.Service
        expect(yield* SessionInbox.find(db, messageID(automation, 3))).toMatchObject({
          type: "user",
          delivery: "steer",
          payload: { text: "All checks passed", metadata: { automation: { id: automation.id, run: 3 } } },
        })
        expect(yield* automations.get(automation.id)).toMatchObject({
          status: "done",
          runCount: 3,
          state: "in progress",
          lastOutput: `Prompted ${sessionID}\nchecks complete`,
        })
      }),
    )

    it.effect("hands a failed check to one quiet child with the creator's permissions", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const sessions = yield* Session.Service
        const permissions: Permission.Ruleset = [{ action: "edit", resource: "*", effect: "deny" }]
        yield* sessions.setPermissions({ sessionID, permissions })
        const automation = yield* automations.create({
          sessionID,
          name: "triage",
          trigger: every("1 minute"),
          action: code(`
          const t = await tools.slack.read_thread({})
          if (t.replies < 0) return { send: { to: { subagent: "helper" }, prompt: "Investigate the failed check" } }
        `),
        })
        slack.replies = -1
        yield* tick(automations)
        const child = Session.ID.make(`ses_${automation.id}_1`)
        expect(wakes).toEqual([child])
        expect(yield* pending).toEqual([{ id: messageID(automation, 1), sessionID: child }])
        expect(slack.messageIDs).toEqual([SessionMessage.ID.make(`msg_${automation.id}_1`)])
        expect(slack.messageIDs).not.toContain(messageID(automation, 1))
        expect(yield* sessions.get(child)).toMatchObject({ agent: "helper", parentID: sessionID, permissions })
        expect(yield* automations.list({ sessionID })).toMatchObject([
          { id: automation.id, status: "active", runCount: 1, lastOutput: `Started subagent ${child}` },
        ])
      }),
    )

    it.effect("keeps the handoff visible and logs within the UTF-8 output budget", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const owner = yield* insertSession(Session.ID.make(`ses_${"x".repeat(128)}`), enabledDirectory)
        const automation = yield* automations.create({
          sessionID: owner.id,
          name: "verbose",
          trigger: every("1 minute"),
          action: code(`console.log("界".repeat(10900)); return { send: { prompt: "ready" } }`),
        })
        yield* tick(automations)
        const output = (yield* automations.get(automation.id)).lastOutput ?? ""
        expect(output.startsWith(`Prompted ${owner.id}\n界`)).toBe(true)
        expect(output.endsWith("界…")).toBe(true)
        expect(Buffer.byteLength(output)).toBeLessThanOrEqual(32 * 1024)
      }),
    )

    it.effect("bounds failed code output including the pause reason in UTF-8 bytes", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const automation = yield* automations.create({
          sessionID,
          name: "verbose failure",
          trigger: every("1 minute"),
          action: code(`console.log("starting check"); throw new Error("check failed: " + "🧪".repeat(20000))`),
        })
        for (const strike of [1, 2, 3]) {
          yield* tick(automations)
          const row = yield* automations.get(automation.id)
          const output = row.lastOutput ?? ""
          expect(Buffer.byteLength(output)).toBeLessThanOrEqual(32 * 1024)
          expect(row.status).toBe(strike === 3 ? "paused" : "active")
          expect(output).toContain("check failed: ")
          expect(output.endsWith("🧪…")).toBe(true)
          if (strike === 3) expect(output.startsWith("Paused after 3 failed runs: ")).toBe(true)
        }
      }),
    )

    it.effect("bad targets and session or agent policy never deliver or commit the rest of the result", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const sessions = yield* Session.Service
        agentRules = [...agentRules, { action: "subagent", resource: "helper", effect: "ask" }]
        const nested = yield* sessions.create({ parentID: sessionID })
        const targets: Schema.Json[] = [
          { session: otherID },
          { subagent: "internal" },
          { subagent: Agent.defaultID },
          { subagent: "missing" },
          { subagent: "helper" },
        ]
        const create = (id: Session.ID, to: Schema.Json) =>
          automations.create({
            sessionID: id,
            name: "invalid",
            trigger: every("1 minute"),
            action: code(
              `if (runs === 0) return { state: "before" }; return { state: "after", done: true, send: { prompt: "act", to: args } }`,
              to,
            ),
          })
        const rows = yield* Effect.forEach(targets, (to) => create(sessionID, to))
        // Explicitly allow this child on the nested session: depth alone must still block it.
        yield* sessions.setPermissions({
          sessionID: nested.id,
          permissions: [{ action: "subagent", resource: "helper", effect: "allow" }],
        })
        const deep = yield* create(nested.id, { subagent: "helper" })
        const denied = yield* sessions.create({
          location: { directory: AbsolutePath.make(enabledDirectory) },
          permissions: [{ action: "subagent", resource: "helper", effect: "deny" }],
        })
        const blocked = yield* create(denied.id, { subagent: "helper" })
        yield* tick(automations)
        yield* tick(automations)
        for (const row of [...rows, deep, blocked])
          expect(yield* automations.get(row.id)).toMatchObject({
            status: "paused",
            lastOutcome: "failed",
            lastOutput: expect.stringContaining("Paused:"),
            runCount: 1,
            state: "before",
          })
        expect((yield* automations.get(deep.id)).lastOutput).toBe("Paused: Subagent depth limit reached (1)")
        expect((yield* automations.get(blocked.id)).lastOutput).toBe(
          "Paused: Cannot start subagent helper: Permission denied: subagent",
        )
        expect((yield* Effect.forEach(rows, (row) => automations.get(row.id))).map((row) => row.lastOutput)).toEqual([
          expect.stringContaining("must return nothing or"),
          "Paused: Subagent internal is hidden",
          `Paused: Agent ${Agent.defaultID} is primary-only`,
          "Paused: Unknown subagent: missing",
          expect.stringContaining("subagent helper: Permission subagent needs approval"),
        ])
        expect(yield* pending).toEqual([])
        expect(wakes).toEqual([])
        expect((yield* sessions.list({ parentID: sessionID })).data.map((session) => session.id)).toEqual([nested.id])
        expect((yield* sessions.list({ parentID: nested.id })).data).toEqual([])
        expect((yield* sessions.list({ parentID: denied.id })).data).toEqual([])
      }),
    )

    it.effect("retries failed admission without committing state or done, then settles the handoff once", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const sessions = yield* Session.Service
        yield* insertSession(otherID, enabledDirectory)
        const automation = yield* automations.create({
          sessionID,
          name: "retry",
          trigger: every("1 minute"),
          action: code(`return { state: 42, done: true, send: { prompt: "ready" } }`),
        })
        const id = messageID(automation, 1)
        // A cross-session conflict rejects the admission, before any wake. Remove the conflicting item to retry.
        yield* sessions.prompt({ sessionID: otherID, id, text: "other", resume: false })
        yield* tick(automations)
        expect(yield* pending).toEqual([{ id, sessionID: otherID }])
        expect(wakes).toEqual([])
        expect(yield* automations.get(automation.id)).toMatchObject({
          status: "active",
          runCount: 0,
          state: undefined,
          lastOutcome: "failed",
        })
        yield* sessions.cancelInbox({ sessionID: otherID, inboxID: id })
        yield* TestClock.adjust("59 seconds")
        yield* automations.tick
        expect(yield* pending).toEqual([])
        yield* TestClock.adjust("1 second")
        yield* automations.tick
        expect(yield* pending).toEqual([{ id, sessionID }])
        expect(wakes).toEqual([sessionID])
        expect(yield* automations.get(automation.id)).toMatchObject({ status: "done", runCount: 1, state: 42 })
      }),
    )

    it.effect("pauses on a missing handoff directory without rerunning the check", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const { db } = yield* Database.Service
        const automation = yield* automations.create({
          sessionID,
          name: "gone",
          trigger: every("1 minute"),
          action: code(
            `await tools.slack.post({ text: "checked" }); return { state: 1, done: true, send: { prompt: "ready" } }`,
          ),
        })
        // The code's authorized location remains, but its creating session now points at a missing worktree.
        yield* db
          .update(SessionTable)
          .set({ directory: missingDirectory })
          .where(eq(SessionTable.id, sessionID))
          .run()
          .pipe(Effect.orDie)
        folders.missingNow = true
        yield* tick(automations)
        expect(yield* automations.get(automation.id)).toMatchObject({
          status: "paused",
          runCount: 0,
          state: undefined,
          lastOutput: expect.stringContaining(missingDirectory),
        })
        yield* tick(automations)
        expect(slack.posts).toEqual(["checked"])
        expect(yield* pending).toEqual([])
        expect(wakes).toEqual([])
      }),
    )

    it.effect("keeps distinct child handoffs pending and rewakes the recorded child on restart", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const automation = yield* automations.create({
          sessionID,
          name: "checks",
          trigger: every("1 minute"),
          action: code(`return { done: runs === 1, send: { prompt: "Check " + runs, to: { subagent: "helper" } } }`),
        })
        yield* tick(automations)
        yield* tick(automations)
        const children = [1, 2].map((run) => Session.ID.make(`ses_${automation.id}_${run}`))
        expect(wakes).toEqual(children)
        wakes.length = 0
        const fiber = yield* Effect.forkChild(automations.run)
        yield* Effect.yieldNow
        expect(wakes).toContain(children[1])
        expect(yield* pendingIDs).toEqual([1, 2].map((run) => messageID(automation, run)))
        yield* Fiber.interrupt(fiber)
      }),
    )

    it.effect("does not use an inbox ID to override changed authority when retrying an admitted child prompt", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const sessions = yield* Session.Service
        const automation = yield* automations.create({
          sessionID,
          name: "triage",
          trigger: every("1 minute"),
          action: code(`return { state: 1, done: true, send: { to: { subagent: "helper" }, prompt: "triage" } }`),
        })
        // The real admission succeeded, but the wake failed before the automation could record it.
        duringWake = Effect.die("lost wake")
        yield* tick(automations)
        const child = Session.ID.make(`ses_${automation.id}_1`)
        const item = [{ id: messageID(automation, 1), sessionID: child }]
        expect(yield* pending).toEqual(item)
        expect(yield* automations.get(automation.id)).toMatchObject({ status: "active", runCount: 0 })
        yield* sessions.setPermissions({ sessionID, permissions: [{ action: "edit", resource: "*", effect: "deny" }] })
        wakes.length = 0
        yield* TestClock.adjust("5 minutes")
        yield* automations.tick
        expect(wakes).toEqual([])
        expect(yield* pending).toEqual(item)
        expect(yield* automations.get(automation.id)).toMatchObject({
          status: "paused",
          runCount: 0,
          state: undefined,
          lastOutput: expect.stringContaining("no longer matches the creator's permissions"),
        })
      }),
    )

    it.effect("reconciles a child handoff already delivered before settlement", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        const sessions = yield* Session.Service
        const { db } = yield* Database.Service
        const bus = yield* Bus.Service
        const automation = yield* automations.create({
          sessionID,
          name: "triage",
          trigger: every("1 minute"),
          action: code(`return { done: true, send: { to: { subagent: "helper" }, prompt: "Triage the failure" } }`),
        })
        const child = Session.ID.make(`ses_${automation.id}_1`)
        // The first admission was consumed but the scheduler never recorded the run.
        yield* sessions.create({ id: child, parentID: sessionID, agent: Agent.ID.make("helper") })
        yield* sessions.prompt({
          sessionID: child,
          id: messageID(automation, 1),
          text: "Triage the failure",
          resume: false,
        })
        yield* SessionInbox.promote(db, bus, child, "steer")
        yield* tick(automations)
        expect(yield* pending).toEqual([])
        expect(wakes).toEqual([child])
        expect((yield* sessions.list({ parentID: sessionID })).data.map((item) => item.id)).toEqual([child])
        expect(yield* automations.get(automation.id)).toMatchObject({ runCount: 1, status: "done" })
      }),
    )

    it.effect("extracts tools at creation, asks once without save, and runs unattended after", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        agentRules = [{ action: "*", resource: "*", effect: "ask" }]
        const { asked, answerLoop } = yield* answerAsks
        const automation = yield* automations.create(
          { sessionID, name: "thread", trigger: every("1 minute"), action: code(watchThread, { channel: "#ops" }) },
          invocation,
        )
        yield* Fiber.interrupt(answerLoop)
        expect(asked.map((request) => request.action)).toEqual(["slack_read_thread", "slack_post"])
        for (const request of asked) expect(request).toMatchObject({ sessionID, source: invocation.source })
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

    it.effect("asks for resource-scoped ask rules at creation, and still needs a person for them at run time", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        agentRules = [
          { action: "*", resource: "*", effect: "allow" },
          { action: "slack_post", resource: "vault:*", effect: "ask" },
          { action: "slack_post", resource: "vault:public", effect: "allow" },
        ]
        const { asked, answerLoop } = yield* answerAsks
        const automation = yield* automations.create({
          sessionID,
          name: "post",
          trigger: every("1 minute"),
          action: code(`for (const channel of args) await tools.slack.post({ text: "hi", channel })`, [
            "general",
            "vault:public",
          ]),
        })
        yield* Fiber.interrupt(answerLoop)
        expect(asked.map((request) => [request.action, request.resources])).toEqual([["slack_post", ["*", "vault:*"]]])

        // The approval covers everything the catch-all allows, and narrower allows still apply.
        yield* TestClock.adjust("1 minute")
        yield* automations.tick
        expect(slack.posts).toEqual(["hi", "hi"])

        // A scoped ask is not settled by the unattended grant, so that call fails and the run is recorded as failed.
        const secret = yield* automations
          .create({
            sessionID,
            name: "secret",
            trigger: every("1 minute"),
            action: code(`await tools.slack.post({ text: "leak", channel: "vault:keys" })`),
          })
          .pipe(Effect.provideService(Permission.Unattended, [{ action: "*", resource: "*", effect: "allow" }]))
        yield* TestClock.adjust("1 minute")
        yield* automations.tick
        expect(slack.posts).not.toContain("leak")
        expect(yield* automations.get(secret.id)).toMatchObject({ runCount: 0, lastOutcome: "failed" })
        expect((yield* automations.get(automation.id)).runCount).toBe(2)
      }),
    )

    it.effect("asks for execute when its tools are already allowed", () =>
      Effect.gen(function* () {
        const automations = yield* setup()
        agentRules = [
          { action: "*", resource: "*", effect: "allow" },
          { action: "execute", resource: "*", effect: "ask" },
        ]
        const { asked, answerLoop } = yield* answerAsks
        yield* automations.create(
          { sessionID, name: "read", trigger: every("1 minute"), action: code(`await tools.slack.read_thread({})`) },
          invocation,
        )
        yield* Fiber.interrupt(answerLoop)
        expect(asked).toMatchObject([{ action: "execute", sessionID, source: invocation.source }])

        // Nobody present to approve: refused rather than created.
        expect(
          yield* Effect.flip(
            automations
              .create({
                sessionID,
                name: "read",
                trigger: every("1 minute"),
                action: code(`await tools.slack.read_thread({})`),
              })
              .pipe(Effect.provideService(Permission.Unattended, [])),
          ),
        ).toMatchObject({ _tag: "Permission.BlockedError" })
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
        expect(yield* bad("return await tools.automation.create({})")).toMatchObject({
          reason: "Tool automation.create cannot be used inside an automation",
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

    it.effect("waits for plugins when authorizing, but counts activation against the run timeout", () =>
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
        const automation = yield* Fiber.join(creating)
        expect(automation.status).toBe("active")

        yield* gate.close
        yield* TestClock.adjust("1 minute")
        const running = yield* Effect.forkChild(automations.tick, { startImmediately: true })
        yield* TestClock.adjust("30 seconds")
        yield* Fiber.join(running)
        expect(yield* automations.get(automation.id)).toMatchObject({
          runCount: 0,
          lastOutput: "Timed out after 30000ms",
        })
      }),
    )
  })
})
