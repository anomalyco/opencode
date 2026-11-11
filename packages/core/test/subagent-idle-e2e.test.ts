import { describe, expect } from "bun:test"
import path from "path"
import { LanguageModel } from "@opencode/ai/effect"
import type { LLMClientService } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Job } from "@opencode/core/job"
import { JobTable } from "@opencode/core/job/sql"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { Shell } from "@opencode/core/shell"
import { ShellTool } from "@opencode/core/tool/plugin/shell"
import { SubagentTool } from "@opencode/core/tool/plugin/subagent"
import { Tool } from "@opencode/core/tool"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Flag } from "@opencode/core/flag"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { ShellSelect } from "@opencode/core/shell/select"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Context, Deferred, Effect, Exit, Layer, Logger, Ref, Schedule, Schema, Scope } from "effect"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const e2e = testEffect(Layer.empty)

const pluginSupervisor = makeLocationNode({
  name: "test/subagent-idle-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* registerToolPlugin(SubagentTool.Plugin, {}, (name, callback) => hooks.register("tool", name, callback))
      yield* registerToolPlugin(ShellTool.Plugin)
    }),
  ),
  deps: [
    Agent.node,
    Config.node,
    Environment.node,
    FileAccess.node,
    Flag.node,
    Job.node,
    Model.node,
    Permission.node,
    PluginHooks.node,
    Session.node,
    Shell.node,
    ShellSelect.node,
    SubagentJob.node,
    Tool.node,
  ],
})

const nodes = LayerNode.group([
  Database.node,
  Bus.node,
  Job.node,
  Session.node,
  SessionExecution.node,
  SessionRestart.node,
  LocationServiceMap.node,
  SessionStore.node,
  KV.node,
])

const modelLayer = Layer.succeed(
  SessionRunnerModel.Service,
  SessionRunnerModel.Service.of({
    resolve: (_session, _available, request) =>
      Effect.succeed(
        SessionRunnerModel.resolved(
          LanguageModel.make({ id: request.agent, provider: "test", route: OpenAIChat.route }),
          {
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            cost: [],
            limit: { context: 200_000, output: 32_000 },
          },
        ),
      ),
  }),
)

const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text("parent ack", "parent-ack") })

/** Dies on the first synthetic admission, as if the process died after the child's terminal commit. */
const crashInbox = (crashed: Deferred.Deferred<void>) =>
  makeGlobalNode({
    service: SessionInbox.Service,
    layer: Layer.effect(
      SessionInbox.Service,
      (SessionInbox.make() as unknown as Effect.Effect<SessionInbox.Interface>).pipe(
        Effect.map((inner) => {
          // Capture the original method before overriding the same object; calling `inner.admit`
          // from the wrapper would recurse into itself.
          const original = inner.admit
          const fired = Ref.makeUnsafe(false)
          const admit = (request: {
            readonly id: SessionMessage.ID
            readonly sessionID: Session.ID
            readonly item: SessionInbox.Item
          }) =>
            Effect.gen(function* () {
              if (request.item.type === "synthetic" && !(yield* Ref.get(fired))) {
                yield* Ref.set(fired, true)
                yield* Deferred.succeed(crashed, undefined)
                return yield* Effect.die(new Error("simulated crash before subagent report delivery"))
              }
              return yield* original(request)
            })
          return Object.assign(inner, { admit })
        }),
      ),
    ),
    deps: [Database.node, Bus.node],
  })

type InboxNode = ReturnType<typeof crashInbox>

type Response = ReturnType<typeof TestLLM.text>

const script = (responses: Record<string, ReadonlyArray<Response>>) => {
  const queues = new Map(Object.entries(responses).map(([agent, queue]) => [agent, [...queue]]))
  return (request: { readonly model: { readonly id: string } }) => {
    const next = queues.get(request.model.id)?.shift()
    if (next) return next
    return TestLLM.text("unexpected request", "unexpected")
  }
}

const boot = (
  scope: Scope.Scope,
  input: {
    readonly database: string
    readonly global: Context.Context<Global.Service>
    readonly llm: Context.Context<LLMClientService>
    readonly inbox?: InboxNode
  },
) =>
  Effect.gen(function* () {
    const context = yield* Layer.buildWithScope(
      AppNodeBuilder.build(nodes, [
        Database.node.replace(Database.configured({ path: input.database })),
        Global.node.replace(Layer.succeedContext(input.global)),
        offlineModels,
        PluginSupervisor.node.replace(pluginSupervisor),
        LayerNodePlatform.llmClient.replace(Layer.succeedContext(input.llm)),
        SessionRunnerModel.node.replace(modelLayer),
        ...(input.inbox ? [SessionInbox.node.replace(input.inbox)] : []),
      ]),
      scope,
    )
    return {
      context,
      sessions: Context.get(context, Session.Service),
      execution: Context.get(context, SessionExecution.Service),
      jobs: Context.get(context, Job.Service),
      restart: Context.get(context, SessionRestart.Service),
      database: Context.get(context, Database.Service),
      store: Context.get(context, SessionStore.Service),
      locations: Context.get(context, LocationServiceMap.Service),
    }
  })

type HarnessInput = {
  readonly config?: Record<string, unknown>
  readonly database?: string
  readonly inbox?: InboxNode
}

const setup = Effect.fnUntraced(function* (input?: HarnessInput) {
  const dir = yield* tmpdirScoped()
  if (input?.config)
    yield* Effect.promise(() => Bun.write(path.join(dir.path, "opencode.json"), JSON.stringify(input.config)))
  const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
  const global = yield* Layer.buildWithScope(tempGlobalLayer, yield* Effect.scope)
  const llmContext = yield* Layer.buildWithScope(llmLayer, yield* Effect.scope)
  return {
    dir,
    location,
    global,
    llmContext,
    llm: Context.get(llmContext, TestLLM.Test),
    database: input?.database ?? ":memory:",
  }
})

const prepareLocation = (
  app: { readonly locations: Context.Service.Shape<typeof LocationServiceMap.Service> },
  location: Location.Ref,
) =>
  Effect.gen(function* () {
    yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(app.locations.get(location)))
    yield* Agent.Service.use((agents) =>
      agents.transform((editor) => {
        for (const id of ["build", "reviewer", "fallback"]) {
          editor.update(Agent.ID.make(id), (agent) => {
            agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
          })
        }
        editor.update(toolIdentity.agent, (agent) => {
          agent.mode = "primary"
        })
        for (const id of ["reviewer", "fallback"]) {
          editor.update(Agent.ID.make(id), (agent) => {
            agent.mode = "subagent"
          })
        }
      }),
    ).pipe(Effect.provide(app.locations.get(location)))
  })

const harness = Effect.fnUntraced(function* (input?: HarnessInput) {
  const base = yield* setup(input)
  const app = yield* boot(yield* Effect.scope, {
    database: base.database,
    global: base.global,
    llm: base.llmContext,
    inbox: input?.inbox,
  })
  yield* prepareLocation(app, base.location)
  const registry = yield* Tool.Service.pipe(Effect.provide(app.locations.get(base.location)))
  const parent = yield* app.sessions.create({
    location: base.location,
    model: Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") }),
  })
  const call = (id: string, input: Record<string, unknown> = {}, sessionID = parent.id) =>
    executeTool(registry, {
      sessionID,
      ...toolIdentity,
      call: {
        type: "tool-call" as const,
        id,
        name: SubagentTool.name,
        input: { agent: "reviewer", description: "review", prompt: "review this", ...input },
      },
    })
  return { ...base, ...app, registry, parent, call }
})

const outputSessionID = (value: unknown) =>
  Schema.decodeUnknownSync(Schema.Struct({ sessionID: Session.ID }))(value).sessionID

const messageText = (message: SessionMessage.Info) =>
  message.type === "assistant"
    ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n")
    : message.type === "synthetic"
      ? message.text
      : ""

const deliveredReports = (app: { readonly sessions: Session.Interface }, sessionID: Session.ID) =>
  app.sessions
    .context(sessionID)
    .pipe(
      Effect.map((messages) =>
        messages.flatMap((message) =>
          message.type === "synthetic" && message.metadata?.source === "subagent"
            ? [{ id: message.id, text: message.text, metadata: message.metadata }]
            : [],
        ),
      ),
    )

const claims = (app: { readonly database: Database.Interface }) =>
  app.database.db
    .select({ id: SessionTable.id, claimed: SessionTable.time_suspended })
    .from(SessionTable)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => Object.fromEntries(rows.map((row) => [row.id, row.claimed !== null]))),
    )

const waitForReports = Effect.fnUntraced(function* (
  app: { readonly sessions: Session.Interface },
  sessionID: Session.ID,
  count: number,
) {
  const reports = yield* deliveredReports(app, sessionID).pipe(
    Effect.repeat({ until: (reports) => reports.length >= count, times: 500, schedule: Schedule.spaced(20) }),
  )
  expect(
    reports.length,
    `Session ${sessionID}: expected at least ${count} reports, got ${reports.length}`,
  ).toBeGreaterThanOrEqual(count)
  yield* app.sessions.wait(sessionID)
})

describe("subagent idle reports end to end", () => {
  e2e.live(
    "reports immediately with running background work and again after the shell exits",
    () =>
      Effect.gen(function* () {
        const h = yield* harness()
        const release = path.join(h.dir.path, "release")
        const command =
          process.platform === "win32"
            ? `while (!(Test-Path -LiteralPath '${release}')) { Start-Sleep -Milliseconds 25 }; Write-Output done`
            : `while [ ! -e '${release}' ]; do sleep 0.025; done; printf done`
        yield* h.llm.serve(
          script({
            reviewer: [
              TestLLM.toolCall("call-shell", "shell", { command, background: true }),
              TestLLM.text("Started tests", "turn-1"),
              TestLLM.text("Tests green", "turn-2"),
            ],
            build: [TestLLM.text("parent ack", "parent-1"), TestLLM.text("parent ack", "parent-2")],
          }),
        )

        const launched = yield* h.call("call-launch")
        expect(launched).toMatchObject({ status: "completed", metadata: { status: "running" } })

        yield* waitForReports(h, h.parent.id, 1)
        const first = yield* deliveredReports(h, h.parent.id)
        expect(first).toHaveLength(1)
        expect(first[0]!.text).toContain("Started tests")
        expect(first[0]!.text).toContain("Background work still running:\n- shell (")
        expect(first[0]!.text).toContain(command)

        yield* Effect.promise(() => Bun.write(release, "go"))
        yield* waitForReports(h, h.parent.id, 2)
        const second = yield* deliveredReports(h, h.parent.id)
        expect(second).toHaveLength(2)
        expect(second[1]!.id).not.toBe(first[0]!.id)
        expect(second[1]!.text).toContain("Tests green")
        expect(second[1]!.text).not.toContain("Started tests")
        expect(second[1]!.text).not.toContain("Background work still running:")
        expect(yield* h.jobs.pendingBackground).toEqual([])
      }),
    30_000,
  )

  e2e.live(
    "reports every directly prompted busy period on a finished background child",
    () =>
      Effect.gen(function* () {
        const h = yield* harness()
        yield* h.llm.serve(
          script({
            reviewer: [
              TestLLM.text("first answer", "turn-1"),
              TestLLM.text("second answer", "turn-2"),
              TestLLM.text("third answer", "turn-3"),
            ],
            build: [TestLLM.text("parent ack", "parent-1"), TestLLM.text("parent ack", "parent-2")],
          }),
        )
        const launched = yield* h.call("call-launch")
        const childID = outputSessionID(launched.metadata)
        yield* waitForReports(h, h.parent.id, 1)
        expect((yield* deliveredReports(h, h.parent.id))[0]!.text).toContain("first answer")
        yield* h.sessions.wait(childID)
        yield* h.jobs.wait({ id: childID })

        yield* h.sessions.prompt({ sessionID: childID, text: "Follow up" })
        yield* waitForReports(h, h.parent.id, 2)
        const second = (yield* deliveredReports(h, h.parent.id))[1]!
        expect(second.text).toContain("second answer")
        expect(second.text).not.toContain("first answer")

        yield* h.sessions.prompt({ sessionID: childID, text: "Follow up again" })
        yield* waitForReports(h, h.parent.id, 3)
        const third = (yield* deliveredReports(h, h.parent.id))[2]!
        expect(third.text).toContain("third answer")
        expect(third.text).not.toContain("second answer")
        const ids = (yield* deliveredReports(h, h.parent.id)).map((report) => report.id)
        expect(new Set(ids).size).toBe(3)
        expect(yield* h.jobs.pendingBackground).toEqual([])
      }),
    30_000,
  )

  e2e.live(
    "reports once for each background follow-up to an idle child",
    () =>
      Effect.gen(function* () {
        const h = yield* harness()
        yield* h.llm.serve(
          script({
            reviewer: [
              TestLLM.text("first answer", "turn-1"),
              TestLLM.text("second answer", "turn-2"),
              TestLLM.text("third answer", "turn-3"),
            ],
            build: [TestLLM.text("parent ack", "parent-1"), TestLLM.text("parent ack", "parent-2")],
          }),
        )
        const launched = yield* h.call("call-launch")
        const childID = outputSessionID(launched.metadata)
        yield* waitForReports(h, h.parent.id, 1)
        yield* h.sessions.wait(childID)
        yield* h.jobs.wait({ id: childID })

        const second = yield* h.call("call-follow-up", { sessionID: childID })
        expect(second).toMatchObject({ metadata: { sessionID: childID, status: "running" } })
        yield* waitForReports(h, h.parent.id, 2)
        expect((yield* deliveredReports(h, h.parent.id))[1]!.text).toContain("second answer")

        const third = yield* h.call("call-follow-up-again", { sessionID: childID })
        expect(third).toMatchObject({ metadata: { sessionID: childID, status: "running" } })
        yield* waitForReports(h, h.parent.id, 3)
        expect((yield* deliveredReports(h, h.parent.id))[2]!.text).toContain("third answer")
        expect(yield* h.jobs.pendingBackground).toEqual([])
      }),
    30_000,
  )

  e2e.live(
    "nested subagents report one level at a time",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          config: {
            experimental: { subagent_depth: 2 },
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
          },
        })
        const release = path.join(h.dir.path, "release")
        const command =
          process.platform === "win32"
            ? `while (!(Test-Path -LiteralPath '${release}')) { Start-Sleep -Milliseconds 25 }; Write-Output done`
            : `while [ ! -e '${release}' ]; do sleep 0.025; done; printf done`
        yield* h.llm.serve(
          script({
            reviewer: [
              TestLLM.toolCall("call-grandchild", SubagentTool.name, {
                agent: "fallback",
                description: "grandchild review",
                prompt: "review the grandchild fixture",
              }),
              TestLLM.text("child launched grandchild", "child-turn-1"),
              TestLLM.text("child saw first grandchild report", "child-turn-2"),
              TestLLM.text("child saw grandchild finish", "child-turn-3"),
            ],
            fallback: [
              TestLLM.toolCall("call-grandchild-shell", ShellTool.name, { command, background: true }),
              TestLLM.text("grandchild started tests", "grandchild-turn-1"),
              TestLLM.text("grandchild finished", "grandchild-turn-2"),
            ],
            build: [
              TestLLM.text("parent ack", "parent-1"),
              TestLLM.text("parent ack", "parent-2"),
              TestLLM.text("parent ack", "parent-3"),
              TestLLM.text("parent ack", "parent-4"),
            ],
          }),
        )

        const launched = yield* h.call("call-child", { description: "child review" })
        const childID = outputSessionID(launched.metadata)

        yield* waitForReports(h, h.parent.id, 1)
        const firstRoot = (yield* deliveredReports(h, h.parent.id))[0]!
        expect(firstRoot.text).toContain("child launched grandchild")
        expect(firstRoot.text).toContain("Background work still running:")
        expect(firstRoot.text).toMatch(/- (subagent \(fallback, sessionID: ses_|shell \()/)

        yield* waitForReports(h, childID, 1)
        const firstChild = (yield* deliveredReports(h, childID))[0]!
        const grandchildID = Schema.decodeUnknownSync(Session.ID)(firstChild.metadata?.childID)
        expect(firstChild.text).toContain("grandchild started tests")
        expect(firstChild.text).toContain("Background work still running:\n- shell (")

        // The child reports the grandchild's still-running shell to the root, attributed to
        // the grandchild's session rather than skipping a level.
        yield* waitForReports(h, h.parent.id, 2)
        const secondRoot = (yield* deliveredReports(h, h.parent.id))[1]!
        expect(secondRoot.text).toContain("child saw first grandchild report")
        expect(secondRoot.text).toContain("Background work still running:\n- shell (")
        expect(secondRoot.text).toContain(`in ${grandchildID})`)

        yield* Effect.promise(() => Bun.write(release, "go"))
        yield* waitForReports(h, childID, 2)
        yield* waitForReports(h, h.parent.id, 3)
        const childReports = yield* deliveredReports(h, childID)
        const rootReports = yield* deliveredReports(h, h.parent.id)
        expect(childReports[1]!.text).toContain("grandchild finished")
        expect(childReports[1]!.text).not.toContain("Background work still running:")
        expect(childReports.every((report) => report.metadata?.childID === grandchildID)).toBe(true)
        expect(rootReports.some((report) => report.text.includes("child saw grandchild finish"))).toBe(true)
        expect(rootReports.every((report) => report.metadata?.childID === childID)).toBe(true)
        // A grandchild's shell is named in the child's background list, but the grandchild
        // never sends its own `<subagent>` report to the root.
        expect(rootReports.some((report) => report.text.includes(`<subagent sessionID="${grandchildID}"`))).toBe(false)
        expect(yield* h.jobs.pendingBackground).toEqual([])
      }),
    30_000,
  )

  e2e.live(
    "a silent middle keeps its loud grandchild from skipping a level",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          config: {
            experimental: { subagent_depth: 2 },
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
          },
        })
        yield* h.llm.serve(
          script({
            reviewer: [
              TestLLM.toolCall("call-grandchild", SubagentTool.name, {
                agent: "fallback",
                description: "grandchild review",
                prompt: "review the grandchild fixture",
              }),
              TestLLM.text("silent child launched grandchild", "child-turn-1"),
              TestLLM.text("silent child saw grandchild", "child-turn-2"),
            ],
            fallback: [TestLLM.text("grandchild answer", "grandchild-turn-1")],
            build: [TestLLM.text("parent ack", "parent-1")],
          }),
        )

        const launched = yield* h.call("call-silent-child", {
          notify: false,
          description: "silent child review",
        })
        const childID = outputSessionID(launched.metadata)
        expect((yield* h.sessions.get(childID)).metadata).toEqual({ "subagent.notify": false })

        yield* waitForReports(h, childID, 1)
        const report = (yield* deliveredReports(h, childID))[0]!
        const grandchildID = Schema.decodeUnknownSync(Session.ID)(report.metadata?.childID)
        expect((yield* h.sessions.get(grandchildID)).metadata).toBeUndefined()
        expect((yield* h.sessions.context(childID)).map(messageText)).toContain("silent child saw grandchild")

        // The grandchild reported to the silent child, and the silent child never reported up.
        expect(yield* deliveredReports(h, h.parent.id)).toEqual([])
        expect((yield* h.sessions.inbox(h.parent.id)).filter((item) => item.type === "synthetic")).toEqual([])
        expect((yield* h.sessions.get(childID)).metadata).toEqual({ "subagent.notify": false })
        expect(yield* h.jobs.pendingBackground).toEqual([])
      }),
    30_000,
  )

  e2e.live(
    "replays the report committed before a crash without running the child again",
    () =>
      Effect.gen(function* () {
        const crashed = yield* Deferred.make<void>()
        const h = yield* harness({ inbox: crashInbox(crashed) })
        yield* h.llm.serve(
          script({
            reviewer: [TestLLM.text("crash-safe answer", "turn-1")],
            build: [TestLLM.text("parent ack", "parent-1")],
          }),
        )

        const launched = yield* h.call("call-launch")
        const childID = outputSessionID(launched.metadata)
        yield* Deferred.await(crashed)
        yield* h.sessions.wait(childID)
        yield* h.jobs.wait({ id: childID })

        // The terminal transaction released the claim and persisted the formatted report,
        // but delivery never happened.
        expect((yield* h.sessions.context(h.parent.id)).filter((message) => message.type === "synthetic")).toEqual([])
        expect(yield* h.jobs.pendingBackground).toMatchObject([
          { id: childID, status: "completed", output: "crash-safe answer" },
        ])
        expect(yield* claims(h)).toEqual({ [h.parent.id]: false, [childID]: false })
        const requests = yield* h.llm.requests()
        const childRequests = requests.filter((request) => request.model.id === "reviewer").length
        expect(childRequests).toBe(1)

        yield* h.restart.resumeSuspendedSessions
        yield* waitForReports(h, h.parent.id, 1)
        const reports = yield* deliveredReports(h, h.parent.id)
        expect(reports[0]!.text).toContain("crash-safe answer")
        expect(yield* h.jobs.pendingBackground).toEqual([])
        expect((yield* h.llm.requests()).filter((request) => request.model.id === "reviewer")).toHaveLength(
          childRequests,
        )
        expect((yield* h.sessions.context(h.parent.id)).filter((message) => message.type === "synthetic")).toHaveLength(
          1,
        )

        // A second sweep is idempotent.
        yield* h.restart.resumeSuspendedSessions
        expect(yield* deliveredReports(h, h.parent.id)).toHaveLength(1)
      }),
    30_000,
  )

  e2e.live(
    "resumes a background child killed mid-turn and reports exactly once",
    () =>
      Effect.gen(function* () {
        const base = yield* setup()
        const database = path.join(base.dir.path, "restart.sqlite")
        const firstScope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(firstScope, Exit.void))
        const first = yield* boot(firstScope, {
          database,
          global: base.global,
          llm: base.llmContext,
        })
        yield* prepareLocation(first, base.location)
        const registry = yield* Tool.Service.pipe(Effect.provide(first.locations.get(base.location)))
        const parent = yield* first.sessions.create({
          location: base.location,
          model: Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") }),
        })
        yield* base.llm.serve(
          script({
            reviewer: [TestLLM.text("interrupted answer", "turn-1"), TestLLM.text("recovered answer", "turn-2")],
            build: [TestLLM.text("parent ack", "parent-1")],
          }),
        )
        const gate = yield* base.llm.gate()
        const launched = yield* executeTool(registry, {
          sessionID: parent.id,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call-launch",
            name: SubagentTool.name,
            input: { agent: "reviewer", description: "restart review", prompt: "review this" },
          },
        })
        const childID = outputSessionID(launched.metadata)
        yield* gate.started
        expect(yield* first.jobs.pendingBackground).toMatchObject([{ id: childID, status: "running" }])
        expect((yield* claims(first))[childID]).toBe(true)

        // Crash the first process mid-turn: the claim and running outbox row survive.
        yield* Scope.close(firstScope, Exit.void)
        yield* gate.release

        const secondScope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(secondScope, Exit.void))
        const second = yield* boot(secondScope, {
          database,
          global: base.global,
          llm: base.llmContext,
        })
        yield* prepareLocation(second, base.location)
        expect((yield* claims(second))[childID]).toBe(true)
        expect(yield* second.jobs.pendingBackground).toMatchObject([{ id: childID, status: "running" }])
        expect((yield* second.sessions.get(childID)).parentID).toBe(parent.id)
        yield* second.restart.resumeSuspendedSessions

        yield* waitForReports(second, parent.id, 1)
        const reports = yield* deliveredReports(second, parent.id)
        expect(reports).toHaveLength(1)
        expect(reports[0]!.text).toContain("recovered answer")
        expect(reports[0]!.text).not.toContain("interrupted answer")
        expect(yield* second.jobs.pendingBackground).toEqual([])
        expect((yield* claims(second))[childID]).toBe(false)
        const reviewerRequests = (yield* base.llm.requests()).filter((request) => request.model.id === "reviewer")
        expect(reviewerRequests).toHaveLength(2)

        yield* second.restart.resumeSuspendedSessions
        expect(yield* deliveredReports(second, parent.id)).toHaveLength(1)
      }),
    30_000,
  )

  e2e.live(
    "deleting a parent mid-run settles cleanly without leftover job rows",
    () => {
      const errors: string[] = []
      const logger = Logger.make(({ logLevel, message }) => {
        if (logLevel === "Error") errors.push(String(message))
      })
      return Effect.gen(function* () {
        const h = yield* harness()
        yield* h.llm.serve(
          script({
            reviewer: [TestLLM.text("never delivered", "turn-1")],
            build: [TestLLM.text("parent ack", "parent-1")],
          }),
        )
        const gate = yield* h.llm.gate()
        const launched = yield* h.call("call-launch")
        const childID = outputSessionID(launched.metadata)
        yield* gate.started
        expect((yield* claims(h))[childID]).toBe(true)

        expect(Exit.isSuccess(yield* h.sessions.remove(h.parent.id).pipe(Effect.exit))).toBe(true)
        yield* h.execution.awaitIdle(h.parent.id)
        yield* gate.release
        expect(yield* h.sessions.get(h.parent.id).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
        expect(yield* h.sessions.get(childID).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
        expect(yield* h.jobs.pendingBackground).toEqual([])
        expect(yield* h.jobs.get(childID)).toBeUndefined()
        expect(yield* h.database.db.select().from(JobTable).all().pipe(Effect.orDie)).toEqual([])
        expect(errors).toEqual([])
      }).pipe(Effect.provide(Logger.layer([logger])))
    },
    30_000,
  )

  e2e.live(
    "deleting a child mid-run settles cleanly and clears its job",
    () => {
      const errors: string[] = []
      const logger = Logger.make(({ logLevel, message }) => {
        if (logLevel === "Error") errors.push(String(message))
      })
      return Effect.gen(function* () {
        const h = yield* harness()
        yield* h.llm.serve(
          script({
            reviewer: [TestLLM.text("never delivered", "turn-1")],
            build: [TestLLM.text("parent ack", "parent-1")],
          }),
        )
        const gate = yield* h.llm.gate()
        const launched = yield* h.call("call-launch")
        const childID = outputSessionID(launched.metadata)
        yield* gate.started

        expect(Exit.isSuccess(yield* h.sessions.remove(childID).pipe(Effect.exit))).toBe(true)
        yield* gate.release
        yield* h.sessions.wait(h.parent.id)
        expect(yield* h.sessions.get(childID).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
        expect(yield* h.sessions.get(h.parent.id)).toMatchObject({ id: h.parent.id })
        expect(yield* h.jobs.pendingBackground).toEqual([])
        expect(yield* h.jobs.get(childID)).toBeUndefined()
        expect(yield* h.database.db.select().from(JobTable).all().pipe(Effect.orDie)).toEqual([])
        const reports = yield* deliveredReports(h, h.parent.id)
        expect(reports).toHaveLength(1)
        expect(reports[0]!.metadata).toMatchObject({ source: "subagent", childID, state: "cancelled" })
        expect(errors).toEqual([])
      }).pipe(Effect.provide(Logger.layer([logger])))
    },
    30_000,
  )
})
