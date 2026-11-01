import { Clock, Effect, Layer, LayerMap, Sink, Stream, Schema } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { ExitCode, makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Command } from "@opencode/core/command"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import type { FileSystem } from "@opencode/core/filesystem"
import { Image } from "@opencode/core/image"
import { Instance } from "@opencode/core/instance/service"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Schedule } from "@opencode/core/schedule"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionInboxTable, SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { ShellSelect } from "@opencode/core/shell/select"
import { Skill } from "@opencode/core/skill"
import { Snapshot } from "@opencode/core/snapshot"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Provider } from "@opencode/schema/provider"
import { TokenUsage } from "@opencode/schema/token-usage"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { location } from "./location"
import { testEffect } from "../lib/effect"
import { imagePassthrough } from "../lib/image"

export const enabledDirectory = "/enabled"
export const ownerSessionID = Session.ID.make("ses_owner")

const testModel = Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("test-model") })
const zeroTokens = TokenUsage.Info.make({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

export const harness = {
  wakes: [] as Session.ID[],
  activeSessions: new Set<Session.ID>(),
  resumeReply: ((_sessionID: Session.ID) => Effect.succeed("Done.")) as (sessionID: Session.ID) => Effect.Effect<string>,
  agentRules: [{ action: "*", resource: "*", effect: "allow" }] as Permission.Ruleset,
  shellState: {
    exitCode: 0,
    stdout: "",
    stderr: "",
    runs: [] as string[],
  },
  codeLog: [] as Array<{ run: unknown; message: unknown }>,
}

const execution = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const bus = yield* Bus.Service
      const runTurn = Effect.fnUntraced(function* (sessionID: Session.ID) {
        harness.activeSessions.add(sessionID)
        return yield* Effect.gen(function* () {
          yield* SessionInbox.promote(db, bus, sessionID, "input")
          const text = yield* harness.resumeReply(sessionID)
          const assistantMessageID = SessionMessage.ID.create()
          const now = yield* Clock.currentTimeMillis
          yield* bus.publish(SessionEvent.Step.Started, {
            sessionID,
            assistantMessageID,
            agent: Agent.defaultID,
            model: testModel,
            started: now,
          })
          yield* bus.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID, ordinal: 0 })
          yield* bus.publish(SessionEvent.Text.Ended, { sessionID, assistantMessageID, ordinal: 0, text })
          yield* bus.publish(SessionEvent.Step.Ended, {
            sessionID,
            assistantMessageID,
            finish: "stop",
            cost: Money.USD.zero,
            tokens: zeroTokens,
          })
          yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
        }).pipe(Effect.ensuring(Effect.sync(() => harness.activeSessions.delete(sessionID))))
      })
      return SessionExecution.Service.of({
        active: Effect.sync(() => new Set(harness.activeSessions)),
        isActive: (id) => Effect.sync(() => harness.activeSessions.has(id)),
        // SAFETY: Test stub implements the turn fiber shape expected by Session.resume in unit tests.
        resume: (id) => runTurn(id) as unknown as ReturnType<SessionExecution.Interface["resume"]>,
        interrupt: () => Effect.succeed(false),
        wake: (id) => Effect.sync(() => void harness.wakes.push(id)),
        awaitIdle: () => Effect.void,
      })
    }),
  ),
  deps: [Database.node, Bus.node],
})

const enabled = Config.testLayer([
  new Document({
    type: "document",
    info: new Info({
      timezone: "America/New_York",
      experimental: new ConfigExperimental.Info({ schedules: true }),
    }),
  }),
])

const testEnvironment = Layer.effect(
  Environment.Service,
  Effect.gen(function* () {
    const memory = Environment.makeMemoryDriver()
    const files = Environment.makeFiles(memory)
    yield* files.mkdir(enabledDirectory).pipe(Effect.orDie)
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        const script = command._tag === "StandardCommand" ? String(command.args.at(-1) ?? command.command) : "pipeline"
        harness.shellState.runs.push(script)
        const outBytes = new TextEncoder().encode(harness.shellState.stdout)
        const errBytes = new TextEncoder().encode(harness.shellState.stderr)
        return makeHandle({
          pid: ProcessId(1),
          exitCode: Effect.succeed(ExitCode(harness.shellState.exitCode)),
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

const configureLocation = Layer.effectDiscard(
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const commands = yield* Command.Service
    const tools = yield* Tool.Service
    const permission = yield* Permission.Service
    const inbox = yield* SessionInbox.Service

    yield* agents.transform((editor) => {
      editor.update(Agent.defaultID, (agent) => {
        agent.mode = "primary"
        agent.permissions = [...harness.agentRules]
      })
      editor.update(Agent.ID.make("general"), (agent) => {
        agent.mode = "subagent"
        agent.permissions = [...harness.agentRules]
      })
      editor.update(Agent.ID.make("reviewer"), (agent) => {
        agent.mode = "subagent"
        agent.permissions = [...harness.agentRules]
      })
    })

    yield* commands.transform((editor) => {
      editor.add({
        name: "morning-brief",
        description: "Render morning brief",
        execute: (invocation) =>
          inbox
            .admit({
              id: SessionMessage.ID.create(),
              sessionID: invocation.sessionID,
              item: {
                type: "user",
                delivery: invocation.delivery,
                payload: SessionInbox.UserPayload.make({
                  text: [
                    `Brief for: ${invocation.prompt.text}`,
                    ...(invocation.note?.trim() ? [invocation.note.trim()] : []),
                  ].join("\n\n"),
                }),
              },
            })
            .pipe(Effect.asVoid),
      })
      editor.add({
        name: "recent-log",
        description: "Inspect recent commits",
        template: "Recent:\n!`git log -n $1`",
        subagent: true,
        agent: Agent.ID.make("reviewer"),
        execute: () => Effect.void,
      })
    })
    yield* commands.reload()

    yield* tools.transform((editor) => {
      editor.add({
        name: "post_digest",
        description: "Post digest",
        input: Schema.Struct({ run: Schema.Unknown, message: Schema.optionalKey(Schema.Unknown) }),
        output: Schema.Struct({ ok: Schema.Boolean }),
        options: { namespace: "slack" },
        execute: (input, context) =>
          permission
            .assert({
              action: "slack_post_digest",
              resources: ["*"],
              sessionID: context.sessionID,
              agent: context.agent,
            })
            .pipe(
              Effect.orDie,
              Effect.map(() => {
                harness.codeLog.push({ run: input.run, message: input.message })
                return { output: { ok: true } }
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
      const inbox = yield* SessionInbox.Service
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const saved = yield* PermissionSaved.Service
      return yield* LayerMap.make(
        (ref: Location.Ref): Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError> =>
          // SAFETY: Test LayerMap composes mocked location services matching LocationServices.
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          Layer.mergeAll(
            enabled,
            configureLocation.pipe(
              Layer.provideMerge(Layer.succeed(SessionInbox.Service, inbox)),
              Layer.provideMerge(
                LayerNode.compile(
                  LayerNode.group([
                    Location.node,
                    Environment.node,
                    PluginHooks.node,
                    Skill.node,
                    Command.node,
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
            // SAFETY: Plugin activation is a no-op in isolated unit tests.
            Layer.succeed(Plugin.Service, { awaitActivation: Effect.void } as unknown as Plugin.Interface),
          ).pipe(Layer.fresh) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
      )
    }),
  ),
  deps: [SessionInbox.node, Bus.node, SessionStore.node, PermissionSaved.node],
})

export const scheduleIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Job.node,
      SessionExecution.node,
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

export const setupScheduleHarness = () =>
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
      .values({
        id: ownerSessionID,
        project_id: Project.ID.global,
        slug: "owner",
        directory: enabledDirectory,
        title: "owner",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
    harness.wakes.length = 0
    harness.activeSessions.clear()
    harness.resumeReply = () => Effect.succeed("Done.")
    harness.agentRules = [{ action: "*", resource: "*", effect: "allow" }]
    harness.shellState.exitCode = 0
    harness.shellState.stdout = ""
    harness.shellState.stderr = ""
    harness.shellState.runs = []
    harness.codeLog.length = 0
    return yield* Schedule.Service
  })

export const ownerPending = Database.Service.use(({ db }) =>
  db
    .select()
    .from(SessionInboxTable)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => rows.filter((row) => row.session_id === ownerSessionID)),
    ),
)

export const promoteOwner = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* SessionInbox.promote(db, yield* Bus.Service, ownerSessionID, "input")
})
