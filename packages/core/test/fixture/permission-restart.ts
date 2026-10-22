import { LanguageModel } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { Tool } from "@opencode/core/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Deferred, Effect, Layer, Schema } from "effect"
import { tempGlobalLayer } from "./global"
import { offlineModels } from "./models"

const mode = process.argv[2]
const path = process.argv[3]
const kind = process.argv[4]
if ((mode !== "decline" && mode !== "recover") || !path || (kind !== "root" && kind !== "child"))
  throw new Error("Expected mode, fixture database path, and session kind")
const parentID = Session.ID.make("ses_decline_parent")
const sessionID = Session.ID.make("ses_declined")
const llm = TestLLM.testLayer({ fallback: TestLLM.text("Cancellation acknowledged", "review") })
const layer = Layer.merge(
  llm,
  AppNodeBuilder.build(
    LayerNode.group([
      SessionRestart.node,
      SessionExecution.node,
      SubagentJob.node,
      LocationServiceMap.node,
      Session.node,
      Job.node,
      Bus.node,
    ]),
    [
      Database.node.replace(Database.configured({ path })),
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llm),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: () =>
            Effect.succeed(
              SessionRunnerModel.resolved(
                LanguageModel.make({ id: "review", provider: "test", route: OpenAIChat.route }),
                {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  cost: [],
                  limit: { context: 200_000, output: 32_000 },
                },
              ),
            ),
        }),
      ),
    ],
  ),
)

const result = await Effect.runPromise(
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const model = yield* TestLLM.Test
    const restart = yield* SessionRestart.Service
    const execution = yield* SessionExecution.Service
    const terminal = yield* Deferred.make<string>()
    if (mode === "decline") {
      const directory = AbsolutePath.make(`${path}.project`)
      yield* Effect.promise(() =>
        Bun.write(
          `${directory}/opencode.json`,
          JSON.stringify({
            agents: { reviewer: { mode: "subagent" } },
            permissions: [{ action: "decline_fixture", resource: "*", effect: "ask" }],
          }),
        ),
      )
      const session =
        kind === "root"
          ? yield* sessions.create({
              id: sessionID,
              location: { directory },
              agent: Agent.ID.make("build"),
              title: "Permission decline",
            })
          : yield* Effect.gen(function* () {
              yield* sessions.create({ id: parentID, location: { directory }, agent: Agent.ID.make("build") })
              return yield* sessions.create({ id: sessionID, parentID, agent: Agent.ID.make("reviewer") })
            })
      const locations = yield* LocationServiceMap.Service
      const location = locations.get(session.location)
      yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(location))
      const tools = yield* Tool.Service.pipe(Effect.provide(location))
      const permissions = yield* Permission.Service.pipe(Effect.provide(location))
      const requestID = Permission.ID.make("per_decline_fixture")
      const asked = yield* Deferred.make<void>()
      const bus = yield* Bus.Service
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Permission.Event.Asked.type
          ? Deferred.succeed(asked, undefined).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* bus.project(SessionEvent.Execution.Interrupted, (event) =>
        event.data.sessionID === sessionID
          ? Deferred.succeed(terminal, event.data.reason).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* tools.transform((editor) =>
        editor.add({
          name: "decline_fixture",
          description: "Request permission",
          options: { codemode: false },
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: (_, context) =>
            permissions
              .assert({
                id: requestID,
                sessionID,
                agent: context.agent,
                action: "decline_fixture",
                resources: ["fixture"],
                metadata: {},
              })
              .pipe(Effect.orDie, Effect.as({ output: {}, content: "Unexpected approval" })),
        }),
      )
      yield* model.push(TestLLM.tool("call-declined", "decline_fixture", {}))
      yield* sessions.prompt({ sessionID, text: "Call decline_fixture", resume: false })
      if (kind === "root") yield* execution.wake(sessionID)
      if (kind === "child") {
        const subagents = yield* SubagentJob.Service
        const recovery = {
          kind: "subagent" as const,
          parentSessionID: parentID,
          childSessionID: sessionID,
          agent: "reviewer",
          description: "Declined permission",
        }
        yield* subagents.start(recovery)
        yield* subagents.background(recovery)
      }
      yield* Deferred.await(asked)
      yield* permissions.reply({ requestID, reply: "reject" })
      if (kind === "child") {
        const outcome = (yield* jobs.wait({ id: sessionID })).info
        if (outcome?.status !== "cancelled") return yield* Effect.die("Decline was not terminal cancellation")
        // The parent model request proves its completion observer admitted the notice.
        yield* model.wait(2)
        yield* execution.awaitIdle(parentID)
      }
      yield* execution.awaitIdle(sessionID)
    }
    if (mode === "recover") {
      yield* restart.resumeSuspendedSessions
      yield* execution.awaitIdle(sessionID)
      if (kind === "child") yield* execution.awaitIdle(parentID)
      yield* restart.resumeSuspendedSessions
    }
    const messages = yield* sessions.context(sessionID)
    const assistant = messages.findLast((message) => message.type === "assistant")
    return {
      reason: mode === "decline" ? yield* Deferred.await(terminal) : null,
      requests: (yield* model.requests()).length,
      messages,
      error: assistant?.error?.type ?? null,
      interruptionReason: assistant?.metadata?.interruptionReason ?? null,
      idle: messages.findLast((message) => message.type === "idle")?.outcome ?? null,
      restarts: messages.filter((message) => message.type === "synthetic" && message.metadata?.notice === "restart")
        .length,
      notices:
        kind === "child" ? (yield* sessions.context(parentID)).filter((message) => message.type === "synthetic") : [],
      pending: (yield* jobs.pendingBackground).length,
    }
  }).pipe(Effect.provide(layer), Effect.scoped, Effect.timeout("20 seconds")),
)
console.log(JSON.stringify(result))
