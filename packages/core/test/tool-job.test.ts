import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer, Schema } from "effect"
import { Money } from "@opencode/schema/money"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { filesystem } from "@opencode/util/effect/app-node-platform"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Location } from "@opencode/core/location"
import { FileAccess } from "@opencode/core/file-access"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Agent } from "@opencode/core/agent"
import { Job } from "@opencode/core/job"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionStore } from "@opencode/core/session/store"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Shell } from "@opencode/core/shell"
import { ShellSelect } from "@opencode/core/shell/select"
import { JobTools } from "@opencode/core/tool/plugin/job"
import { OpenCodeTools } from "@opencode/core/tool/plugin/opencode"
import { ShellTool } from "@opencode/core/tool/plugin/shell"
import { SubagentTool } from "@opencode/core/tool/plugin/subagent"
import { Tool } from "@opencode/core/tool"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionModel = Model.Ref.make({ id: Model.ID.make("test"), providerID: Provider.ID.make("test") })
const interruptedSessions: Session.ID[] = []

const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const run = Effect.fn("JobToolsTest.run")(function* (id: Session.ID) {
        const session = yield* store.get(id)
        if (!session) return
        const assistantMessageID = SessionMessage.ID.create()
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID: id,
          assistantMessageID,
          agent: session.agent ?? Agent.ID.make("code"),
          model: sessionModel,
          started: 0,
        })
        yield* bus.publish(SessionEvent.Step.Ended, {
          sessionID: id,
          assistantMessageID,
          finish: "stop",
          cost: Money.USD.zero,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
      })
      return SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        isActive: () => Effect.succeed(false),
        resume: () => Effect.never,
        wake: () => Effect.void,
        interrupt: (id) =>
          Effect.sync(() => {
            interruptedSessions.push(id)
            return true
          }),
        awaitIdle: (id) => run(id).pipe(Effect.exit, Effect.asVoid),
      })
    }),
  ),
  deps: [Bus.node, SessionStore.node],
})

const jobPluginSupervisor = makeLocationNode({
  name: "test/job-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* registerToolPlugin(OpenCodeTools.Plugin)
      yield* registerToolPlugin(JobTools.Plugin)
      yield* registerToolPlugin(ShellTool.Plugin)
      yield* registerToolPlugin(SubagentTool.Plugin, {}, (name, callback) => hooks.register("tool", name, callback))
    }),
  ),
  deps: [
    Agent.node,
    Config.node,
    Environment.node,
    FileAccess.node,
    Job.node,
    Location.node,
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
  LocationServiceMap.node,
  filesystem,
  FSUtil.node,
  Global.node,
])

const it = testEffect(
  AppNodeBuilder.build(nodes, [
    SessionExecution.node.replace(executionNode),
    Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
    Global.node.replace(tempGlobalLayer),
    PluginSupervisor.node.replace(jobPluginSupervisor),
    offlineModels,
  ]),
)

describe("JobTools", () => {
  it.live("keeps job_* tools in Code Mode by default, lists/reads/waits/stops session jobs, and rejects other sessions' jobs", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          interruptedSessions.length = 0
          const sessions = yield* Session.Service
          const locations = yield* LocationServiceMap.Service
          const location = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
          const owner = yield* sessions.create({ location, model: sessionModel })
          const other = yield* sessions.create({ location, model: sessionModel })
          const gate = yield* Deferred.make<void>()

          yield* Effect.gen(function* () {
            yield* Plugin.Service.use((plugins) => plugins.awaitActivation)
            const registry = yield* Tool.Service

            // Not cluttering top-level direct tool definitions while Code Mode is enabled.
            const directNames = (yield* toolDefinitions(registry)).map((t) => t.name)
            expect(directNames).toContain("execute")
            expect(directNames).not.toContain("opencode_job_list")
            // Exposed directly when Code Mode is disabled.
            const fallbackNames = (
              yield* toolDefinitions(registry, [{ action: "execute", resource: "*", effect: "deny" }])
            ).map((t) => t.name)
            expect(fallbackNames).toContain("opencode_job_list")
            expect(fallbackNames).toContain("opencode_job_wait")
            expect(fallbackNames).toContain("opencode_job_stop")

            yield* registry.transform((editor) => {
              editor.namespace({ name: "demo", description: "Demo" })
              editor.add({
                name: "hang",
                description: "Hang",
                options: { namespace: "demo", codemode: true },
                input: Schema.Struct({}),
                output: Schema.String,
                execute: () => Deferred.await(gate).pipe(Effect.as({ output: "done" })),
              })
            })

            const bgExec = yield* executeTool(registry, {
              sessionID: owner.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-start",
                name: "execute",
                input: { code: 'console.log("step 1"); return await tools.demo.hang({})', yield_after: 20 },
              },
            })
            const jobID = String(bgExec.output?.jobID)
            expect(jobID).toStartWith("job_")

            // Other sessions cannot inspect or stop `owner`'s job.
            const unauthorized = yield* executeTool(registry, {
              sessionID: other.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-unauth",
                name: "execute",
                input: { code: `return await tools.opencode.job_output({ id: ${JSON.stringify(jobID)} })` },
              },
            })
            expect(unauthorized.output?.error).toBe(true)
            expect(unauthorized.output?.output).toContain(`Job not found: ${jobID}`)

            // Owner lists, reads partial output, times out on short wait, then stops the job cleanly.
            const inspected = yield* executeTool(registry, {
              sessionID: owner.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-inspect",
                name: "execute",
                input: {
                  code: `return {
                    running: await tools.opencode.job_list({ status: "running" }),
                    output: await tools.opencode.job_output({ id: ${JSON.stringify(jobID)} }),
                    waited: await tools.opencode.job_wait({ id: ${JSON.stringify(jobID)}, yield_after: 15 }),
                  }`,
                },
              },
            })
            const parsed = JSON.parse(inspected.output.output)
            expect(parsed.running.jobs).toMatchObject([{ id: jobID, status: "running" }])
            expect(parsed.output).toMatchObject({
              id: jobID,
              status: "running",
              output: expect.stringContaining("step 1"),
            })
            expect(parsed.waited).toMatchObject({ timedOut: true, job: { id: jobID, status: "running" } })

            const stopped = yield* executeTool(registry, {
              sessionID: owner.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-stop",
                name: "execute",
                input: { code: `return await tools.opencode.job_stop({ id: ${JSON.stringify(jobID)} })` },
              },
            })
            expect(JSON.parse(stopped.output.output)).toMatchObject({
              id: jobID,
              status: "cancelled",
              output: expect.stringContaining("step 1"),
            })
          }).pipe(Effect.provide(locations.get(location)))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live("stops a running subagent and its descendant background jobs via job_stop", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          interruptedSessions.length = 0
          const sessions = yield* Session.Service
          const jobs = yield* Job.Service
          const locations = yield* LocationServiceMap.Service
          const location = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
          const parent = yield* sessions.create({ location, model: sessionModel })

          yield* Effect.gen(function* () {
            yield* Plugin.Service.use((plugins) => plugins.awaitActivation)
            yield* Provider.Service.use((providers) =>
              providers.transform((editor) => {
                editor.models.update(sessionModel.providerID, sessionModel.id, () => {})
              }),
            )
            yield* Agent.Service.use((agents) =>
              agents.transform((editor) => {
                editor.update(toolIdentity.agent, (agent) => {
                  agent.mode = "primary"
                  agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
                })
                editor.update(Agent.ID.make("reviewer"), (agent) => {
                  agent.mode = "subagent"
                  agent.model = sessionModel
                })
              }),
            )
            const registry = yield* Tool.Service
            const shell = yield* Shell.Service

            const launched = yield* executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-subagent",
                name: "subagent",
                input: {
                  agent: "reviewer",
                  description: "long review",
                  prompt: "review",
                  background: true,
                },
              },
            })
            const childID = Session.ID.make(String(launched.metadata?.sessionID))

            const childShell = yield* executeTool(registry, {
              sessionID: childID,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-child-shell",
                name: "shell",
                input: { command: "sleep 60", background: true },
              },
            })
            const childShellID = String(childShell.metadata?.shellID)
            expect((yield* jobs.get(childShellID))?.status).toBe("running")

            const stopped = yield* executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-stop-child",
                name: "execute",
                input: { code: `return await tools.opencode.job_stop({ id: ${JSON.stringify(childID)} })` },
              },
            })
            expect(JSON.parse(stopped.output.output)).toMatchObject({ id: childID, status: "cancelled" })
            expect(interruptedSessions).toContain(childID)
            expect(yield* jobs.get(childShellID)).toBeUndefined()
            expect((yield* shell.list()).map((item) => String(item.id))).not.toContain(childShellID)
          }).pipe(Effect.provide(locations.get(location)))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )
})
