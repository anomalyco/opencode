import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Fiber, Layer, Schedule, Stream } from "effect"
import { LanguageModel } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols/openai-chat"
import { TestLLM } from "@opencode-ai/ai/testing"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Job } from "@opencode-ai/core/job"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text("Review complete", "review") })
const it = testEffect(
  Layer.merge(
    llmLayer,
    AppNodeBuilder.build(LayerNode.group([Session.node, Job.node, Bus.node, LocationServiceMap.node]), [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llmLayer),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: (session) =>
            session.model?.id === "missing"
              ? Effect.fail(new SessionRunnerModel.ModelNotSelectedError({ sessionID: session.id }))
              : Effect.succeed(
                  SessionRunnerModel.resolved(
                    LanguageModel.make({
                      id: session.model?.id ?? "parent",
                      provider: "test",
                      route: OpenAIChat.route,
                    }),
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

const parentModel = Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") })

describe("command subagents", () => {
  for (const fixture of [
    {
      name: "native JSON",
      format: "json",
      command: { subagent: true, agent: "reviewer", model: "test/override" },
      agent: "reviewer",
      model: "override",
    },
    {
      name: "legacy JSON",
      format: "v1",
      command: { subtask: true, agent: "build" },
      agent: "build",
      model: "parent",
    },
    {
      name: "native Markdown",
      format: "markdown",
      command: { subagent: true, agent: "reviewer" },
      agent: "reviewer",
      model: "child",
    },
    {
      name: "legacy Markdown",
      format: "markdown",
      command: { subtask: true, agent: "build" },
      agent: "build",
      model: "parent",
    },
    {
      name: "subagent mode by default",
      format: "json",
      command: { agent: "reviewer" },
      agent: "reviewer",
      model: "child",
    },
    {
      name: "forced primary agent",
      format: "json",
      command: { subagent: true, agent: "build" },
      agent: "build",
      model: "parent",
    },
    { name: "inherited active agent", format: "json", command: { subagent: true }, agent: "build", model: "parent" },
  ] as const) {
    it.live(`runs ${fixture.name} in the background without switching the parent`, () =>
      Effect.gen(function* () {
        const parent = yield* project(fixture.command, fixture.format)
        const sessions = yield* Session.Service
        const jobs = yield* Job.Service
        const bus = yield* Bus.Service
        const llm = yield* TestLLM.Test
        const gate = yield* llm.gate()
        const completed = yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
          Stream.filter((event) => event.data.sessionID === parent.id && event.data.item.type === "synthetic"),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkScoped({ startImmediately: true }),
        )

        // This must return while the child's model is still blocked.
        yield* sessions.command({ sessionID: parent.id, command: "review", text: "changes" })
        yield* gate.started
        const children = (yield* sessions.list({ parentID: parent.id })).data
        expect(children).toHaveLength(1)
        const child = children[0]
        if (!child) return yield* Effect.die("Expected a child session")
        expect(child).toMatchObject({ agent: fixture.agent, model: { id: fixture.model }, title: "Review code" })
        expect(yield* sessions.get(parent.id)).toMatchObject({ agent: "build", model: parentModel })
        expect(yield* sessions.context(parent.id)).toEqual([])
        expect(yield* llm.requests()).toHaveLength(1)
        expect((yield* sessions.context(child.id)).filter((message) => message.type === "user")).toMatchObject([
          { text: "You are a subagent spawned by another session.\nReview changes: ready" },
        ])
        expect(yield* jobs.pendingBackground).toMatchObject([
          {
            id: child.id,
            status: "running",
            recovery: { kind: "subagent", parentSessionID: parent.id, childSessionID: child.id },
          },
        ])

        yield* gate.release
        const notification = (yield* Fiber.join(completed))[0]
        expect(notification?.data.item).toMatchObject({
          type: "synthetic",
          payload: {
            metadata: { source: "subagent", childID: child.id, state: "completed" },
          },
        })
        if (notification?.data.item.type !== "synthetic") return yield* Effect.die("Expected a completion notification")
        expect(notification.data.item.payload.text).toContain("Review complete")
        yield* jobs.pendingBackground.pipe(
          Effect.repeat({ until: (pending) => pending.length === 0, schedule: Schedule.spaced("10 millis") }),
        )
        yield* sessions.wait(parent.id)
        expect(yield* jobs.pendingBackground).toEqual([])
      }),
    )
  }

  for (const command of [
    { subagent: false, agent: "reviewer" },
    { subtask: false, agent: "reviewer" },
    { subagent: false, subtask: true, agent: "reviewer" },
    { agent: "build" },
  ]) {
    it.live(`keeps ${JSON.stringify(command)} in the current session`, () =>
      Effect.gen(function* () {
        const parent = yield* project(command, "json")
        const sessions = yield* Session.Service
        yield* sessions.command({ sessionID: parent.id, command: "review", text: "changes" })
        yield* sessions.wait(parent.id)
        expect((yield* sessions.list({ parentID: parent.id })).data).toEqual([])
        expect(yield* sessions.get(parent.id)).toMatchObject({
          agent: command.agent,
          model: { id: command.agent === "reviewer" ? "child" : "parent" },
        })
        expect((yield* sessions.context(parent.id)).filter((message) => message.type === "user")).toMatchObject([
          { text: "Review changes: ready" },
        ])
      }),
    )
  }

  it.live("delivers background failures to the parent", () =>
    Effect.gen(function* () {
      const parent = yield* project({ subagent: true, model: "test/missing" }, "json")
      const sessions = yield* Session.Service
      const bus = yield* Bus.Service
      const completed = yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
        Stream.filter((event) => event.data.sessionID === parent.id && event.data.item.type === "synthetic"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* sessions.command({ sessionID: parent.id, command: "review", text: "changes" })
      expect((yield* Fiber.join(completed))[0]?.data.item).toMatchObject({
        type: "synthetic",
        payload: { metadata: { source: "subagent", state: "error" } },
      })
      yield* sessions.wait(parent.id)
    }),
  )
})

function project(
  command: { agent?: string; model?: string; subagent?: boolean; subtask?: boolean },
  format: "json" | "v1" | "markdown",
) {
  return Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const definition = { description: "Review code", template: "Review $ARGUMENTS: !`printf ready`", ...command }
    yield* Effect.promise(() =>
      Bun.write(
        path.join(tmp.path, "opencode.json"),
        JSON.stringify({
          agents: { reviewer: { mode: "subagent", model: "test/child" } },
          ...(format === "markdown" ? {} : { [format === "v1" ? "command" : "commands"]: { review: definition } }),
        }),
      ),
    )
    if (format === "markdown")
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/commands/review.md"),
          [
            "---",
            "description: Review code",
            ...Object.entries(command).map(([key, value]) => `${key}: ${value}`),
            "---",
            definition.template,
          ].join("\n"),
        ),
      )
    const sessions = yield* Session.Service
    return yield* sessions.create({
      location: { directory: AbsolutePath.make(tmp.path) },
      title: "Parent session",
      agent: Agent.ID.make("build"),
      model: parentModel,
    })
  })
}
