import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LanguageModel } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Tool } from "@opencode/core/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"

const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text("Review complete", "review") })
const it = testEffect(
  Layer.merge(
    llmLayer,
    AppNodeBuilder.build(LayerNode.group([Session.node, Job.node, LocationServiceMap.node]), [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llmLayer),
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
    ]),
  ),
)

describe("subagent observer lifetime", () => {
  for (const [evict, outcome] of [
    [false, "completed"],
    [true, "completed"],
    [true, "cancelled"],
  ] as const) {
    it.live(
      `notifies an idle parent exactly once after its moved child ${outcome} (evict=${evict})`,
      () =>
        Effect.gen(function* () {
          const parentDir = yield* tmpdirScoped()
          const childDir = yield* tmpdirScoped()
          yield* Effect.promise(() =>
            Bun.write(
              `${parentDir.path}/opencode.json`,
              JSON.stringify({
                agents: { reviewer: { mode: "subagent" } },
                permissions: [{ action: "*", resource: "*", effect: "allow" }],
              }),
            ),
          )
          yield* Effect.promise(() =>
            Bun.write(`${childDir.path}/opencode.json`, JSON.stringify({ agents: { reviewer: { mode: "subagent" } } })),
          )
          const sessions = yield* Session.Service
          const locations = yield* LocationServiceMap.Service
          const jobs = yield* Job.Service
          const llm = yield* TestLLM.Test
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(parentDir.path) },
            agent: Agent.ID.make("build"),
            model: Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") }),
          })
          const child = yield* sessions.create({ parentID: parent.id, agent: Agent.ID.make("reviewer") })
          yield* sessions.move({ sessionID: child.id, directory: AbsolutePath.make(childDir.path) })
          yield* sessions.wait(child.id)
          expect((yield* sessions.get(child.id)).location.directory).toBe(AbsolutePath.make(childDir.path))
          yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
            Effect.provide(locations.get(parent.location)),
          )
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const gate = yield* llm.gate()
          const result = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-review",
              name: "subagent",
              input: {
                agent: "reviewer",
                sessionID: child.id,
                description: "Review fixture",
                prompt: "Review the fixture",
                background: true,
              },
            },
          })
          expect(result.status).toBe("completed")
          yield* gate.started
          expect(yield* sessions.context(parent.id)).toEqual([])
          if (evict) {
            yield* locations.invalidate(parent.location)
            // Rebuilding a location must not lose or duplicate its former observer.
            yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
              Effect.provide(locations.get(parent.location)),
            )
            yield* locations.invalidate(parent.location)
          }
          if (outcome === "cancelled") yield* jobs.cancel(child.id)
          yield* gate.release
          yield* jobs.wait({ id: child.id })
          yield* llm.wait(2).pipe(Effect.timeout("2 seconds"))
          yield* sessions.wait(parent.id)
          const notices = (yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")
          expect(notices).toHaveLength(1)
          expect(notices[0]).toMatchObject({ metadata: { source: "subagent", childID: child.id, state: outcome } })
          expect(yield* jobs.pendingBackground).toEqual([])
          yield* locations.invalidate(parent.location)
          yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
            Effect.provide(locations.get(parent.location)),
          )
          expect((yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")).toEqual(
            notices,
          )
          expect(yield* llm.requests()).toHaveLength(2)
        }),
      20_000,
    )
  }
})
