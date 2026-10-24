import fs from "fs/promises"
import { describe, expect } from "bun:test"
import path from "path"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Schedule, Scope } from "effect"
import { LanguageModel } from "@opencode/ai"
import { LLMClient } from "@opencode/ai/route"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Database } from "@opencode/core/database/database"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Job } from "@opencode/core/job"
import { KV } from "@opencode/core/kv"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Skill } from "@opencode/core/skill"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import PROMPT_REVIEW from "../../src/plugin/command/review.txt"

const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text("Review complete", "review") })
function appLayer(global = tempGlobalLayer, client = llmLayer, database = Database.layer()) {
  return AppNodeBuilder.build(
    LayerNode.group([
      Session.node,
      LocationServiceMap.node,
      SessionRestart.node,
      SessionExecution.node,
      Job.node,
      Bus.node,
      KV.node,
    ]),
    [
      Global.node.replace(global),
      Database.node.replace(database.pipe(Layer.provide(global))),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(client),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: (session) =>
            Effect.succeed(
              SessionRunnerModel.resolved(
                LanguageModel.make({ id: session.model?.id ?? "parent", provider: "test", route: OpenAIChat.route }),
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
  )
}

const it = testEffect(Layer.merge(llmLayer, appLayer()))
const restartIt = testEffect(Layer.merge(llmLayer, tempGlobalLayer))

const parentModel = Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") })

describe("command subagents", () => {
  for (const subagent of [false, true]) {
    it.live(`waits for gated shell output before ${subagent ? "creating a child" : "parent admission"}`, () =>
      Effect.gen(function* () {
        const parent = yield* project(
          {
            subagent,
            agent: "reviewer",
            template:
              "Review !`printf started > shell-started; while [ ! -f shell-release ]; do sleep 0.01; done; cat shell-result`",
          },
          "json",
        )
        const sessions = yield* Session.Service
        const llm = yield* TestLLM.Test
        const command = yield* sessions
          .command({ sessionID: parent.id, command: "review", text: "" })
          .pipe(Effect.forkScoped)
        yield* Effect.promise(() => Bun.file(path.join(parent.location.directory, "shell-started")).exists()).pipe(
          Effect.repeat({ until: (exists) => exists, schedule: Schedule.spaced("10 millis") }),
        )
        expect(command.pollUnsafe()).toBeUndefined()
        expect(yield* sessions.context(parent.id)).toEqual([])
        expect(yield* sessions.inbox(parent.id)).toEqual([])
        expect((yield* sessions.list({ parentID: parent.id })).data).toEqual([])
        expect(yield* sessions.get(parent.id)).toMatchObject({ agent: "build", model: parentModel })
        expect(yield* llm.requests()).toEqual([])
        yield* Effect.promise(async () => {
          await Bun.write(path.join(parent.location.directory, "shell-result"), "SHELL_FINISHED")
          await Bun.write(path.join(parent.location.directory, "shell-release"), "release")
        })
        yield* Fiber.join(command)
        yield* llm.wait(subagent ? 2 : 1)
        yield* sessions.wait(parent.id)
        expect(JSON.stringify((yield* llm.requests())[0])).toContain("SHELL_FINISHED")
        expect((yield* sessions.list({ parentID: parent.id })).data).toHaveLength(subagent ? 1 : 0)
      }),
    )
  }

  it.live("cancels a command child and durably delivers one cancellation even across restart replay", () =>
    Effect.gen(function* () {
      const parent = yield* project({ subagent: true, agent: "reviewer" }, "json")
      const sessions = yield* Session.Service
      const llm = yield* TestLLM.Test
      const jobs = yield* Job.Service
      const bus = yield* Bus.Service
      const admitted = yield* Deferred.make<Job.Background>()
      yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
        Effect.gen(function* () {
          if (event.data.sessionID !== parent.id || event.data.item.type !== "synthetic") return
          const marker = (yield* jobs.pendingBackground).find((item) => item.notificationID === event.data.inboxID)
          if (marker) yield* Deferred.succeed(admitted, marker)
        }),
      )
      const gate = yield* llm.gate()
      yield* sessions.command({ sessionID: parent.id, command: "review", text: "cancel this" })
      yield* gate.started
      const child = (yield* sessions.list({ parentID: parent.id })).data[0]
      if (!child) return yield* Effect.die("Expected command child")
      expect((yield* jobs.pendingBackground)[0]).toMatchObject({
        id: child.id,
        status: "running",
        recovery: { childSessionID: child.id, parentSessionID: parent.id },
      })
      yield* sessions.interrupt(child.id)
      yield* sessions.wait(child.id)
      const execution = yield* SessionExecution.Service
      expect(yield* execution.isActive(child.id)).toBe(false)
      expect(
        (yield* sessions.context(child.id)).filter(
          (message) =>
            message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
        ),
      ).toEqual([])
      const marker = yield* Deferred.await(admitted)
      expect(marker.status).toBe("cancelled")
      yield* llm.wait(2)
      yield* gate.release
      yield* sessions.wait(child.id)
      yield* sessions.wait(parent.id)
      yield* jobs.pendingBackground.pipe(Effect.repeat({ until: (pending) => pending.length === 0 }))
      const notices = (yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")
      expect(notices).toMatchObject([
        { id: marker.notificationID, metadata: { childID: child.id, state: "cancelled" } },
      ])
      expect(notices[0]?.text).toContain("Subagent cancelled")
      expect(yield* sessions.get(parent.id)).toMatchObject({ agent: "build", model: parentModel })
      const kv = yield* KV.Service
      yield* kv.set(`job.background/${marker.notificationID}`, marker)
      const restart = yield* SessionRestart.Service
      yield* restart.resumeSuspendedSessions
      yield* sessions.wait(parent.id)
      expect((yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")).toEqual(notices)
      expect(yield* jobs.pendingBackground).toEqual([])
    }),
  )

  restartIt.live("resumes a command-created child after the production app scope closes and reopens", () =>
    Effect.gen(function* () {
      const global = yield* Global.Service
      const llm = yield* TestLLM.Test
      const layer = appLayer(
        Layer.succeed(Global.Service, global),
        Layer.merge(Layer.succeed(LLMClient.Service, llm), Layer.succeed(TestLLM.Test, llm)),
        Database.layer({ path: path.join(global.data, "command-recovery.db") }),
      )
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
      const context = yield* Layer.buildWithScope(layer, scope)
      const sessions = Context.get(context, Session.Service)
      const jobs = Context.get(context, Job.Service)
      const parent = yield* project({ subagent: true, agent: "reviewer" }, "json").pipe(Effect.provide(context))
      const gate = yield* llm.gate()
      yield* sessions.command({ sessionID: parent.id, command: "review", text: "survive restart" })
      yield* gate.started
      const child = (yield* sessions.list({ parentID: parent.id })).data[0]
      if (!child) return yield* Effect.die("Expected command child")
      const marker = (yield* jobs.pendingBackground)[0]
      expect(marker).toMatchObject({ id: child.id, status: "running" })
      yield* Scope.close(scope, Exit.void)
      yield* gate.release

      const restartedScope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
      const restarted = yield* Layer.buildWithScope(layer, restartedScope)
      const current = Context.get(restarted, Session.Service)
      const currentJobs = Context.get(restarted, Job.Service)
      expect(yield* currentJobs.pendingBackground).toEqual([marker])
      yield* Context.get(restarted, SessionRestart.Service).resumeSuspendedSessions
      yield* llm.wait(3)
      yield* current.wait(child.id)
      yield* current.wait(parent.id)
      yield* currentJobs.pendingBackground.pipe(Effect.repeat({ until: (pending) => pending.length === 0 }))
      const notices = (yield* current.context(parent.id)).filter((message) => message.type === "synthetic")
      expect(notices).toMatchObject([
        { id: marker?.notificationID, metadata: { childID: child.id, state: "completed" } },
      ])
      expect(notices[0]?.text).toContain("Review complete")
      expect(yield* current.get(parent.id)).toMatchObject({ agent: "build", model: parentModel })
      expect((yield* current.context(child.id)).filter((message) => message.type === "user")).toHaveLength(1)
      expect(
        (yield* current.context(child.id)).some(
          (message) => message.type === "synthetic" && message.metadata?.notice === "restart",
        ),
      ).toBe(true)
      const requests = yield* llm.requests()
      expect(requests.map((request) => String(request.model.id))).toEqual(["child", "child", "parent"])
      yield* Context.get(restarted, SessionRestart.Service).resumeSuspendedSessions
      yield* current.wait(parent.id)
      expect((yield* current.context(parent.id)).filter((message) => message.type === "synthetic")).toEqual(notices)
    }),
  )

  for (const fixture of [
    { command: { agent: "reviewer", subagent: false }, agent: "reviewer", model: "child" },
    { command: { agent: "build", subagent: false }, agent: "build", model: "parent" },
    { command: { model: "test/override" }, agent: "build", model: "override" },
  ]) {
    it.live(`retains ordinary command selection for later prompts: ${JSON.stringify(fixture.command)}`, () =>
      Effect.gen(function* () {
        const parent = yield* project(fixture.command, "json")
        const sessions = yield* Session.Service
        const llm = yield* TestLLM.Test
        yield* sessions.command({ sessionID: parent.id, command: "review", text: "initial" })
        yield* sessions.wait(parent.id)
        expect((yield* sessions.list({ parentID: parent.id })).data).toEqual([])
        expect(yield* sessions.get(parent.id)).toMatchObject({ agent: fixture.agent, model: { id: fixture.model } })
        yield* sessions.prompt({ sessionID: parent.id, text: "Follow up" })
        yield* sessions.wait(parent.id)
        expect((yield* llm.requests()).map((request) => String(request.model.id))).toEqual([
          fixture.model,
          fixture.model,
        ])
        expect(yield* sessions.get(parent.id)).toMatchObject({ agent: fixture.agent, model: { id: fixture.model } })
      }),
    )
  }

  it.live("built-in review admits a normal parent prompt with explicit attachments", () =>
    Effect.gen(function* () {
      const parent = yield* project({}, "json", "custom-review")
      const sessions = yield* Session.Service
      const llm = yield* TestLLM.Test
      const gate = yield* llm.gate()

      yield* sessions.command({
        sessionID: parent.id,
        command: "review",
        text: "branch @known.txt @reviewer",
        files: [{ uri: "data:text/plain;base64,U1VQUExJRURfQVRUQUNITUVOVA==", name: "explicit.txt" }],
        agents: [{ name: "lead" }],
        skills: [{ id: Skill.ID.make("security") }],
      })
      yield* gate.started
      expect((yield* sessions.list({ parentID: parent.id })).data).toEqual([])
      expect(yield* sessions.get(parent.id)).toMatchObject({ agent: "build", model: parentModel })
      const users = (yield* sessions.context(parent.id)).filter((message) => message.type === "user")
      expect(users).toHaveLength(1)
      expect(users[0]).toMatchObject({
        text: PROMPT_REVIEW.replace("${path}", parent.location.directory).replaceAll(
          "$ARGUMENTS",
          "branch @known.txt @reviewer",
        ),
        agents: [{ name: "lead" }],
        skills: [{ id: "security", name: "Security" }],
      })
      expect(users[0]?.files).toHaveLength(1)
      const request = JSON.stringify((yield* llm.requests())[0])
      expect(request).toContain("SUPPLIED_ATTACHMENT")
      expect(request).toContain("# Security guide")
      yield* gate.release
      yield* sessions.wait(parent.id)
    }),
  )

  for (const fixture of [
    {
      name: "native JSON",
      format: "json",
      command: { subagent: true, agent: "build", model: "test/override" },
      agent: "build",
      model: "override",
    },
    {
      name: "native JSON alias",
      format: "json",
      command: { subtask: true, agent: "build", model: "test/override" },
      agent: "build",
      model: "override",
    },
    {
      name: "legacy JSON",
      format: "legacy-json",
      command: { subtask: true, agent: "build", model: "test/override" },
      agent: "build",
      model: "override",
    },
    {
      name: "native Markdown",
      format: "markdown",
      command: { subagent: true, agent: "build" },
      agent: "build",
      model: "parent",
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
  ] as const) {
    it.live(`runs ${fixture.name} in the background without switching the parent`, () =>
      Effect.gen(function* () {
        const parent = yield* project(fixture.command, fixture.format)
        const sessions = yield* Session.Service
        const llm = yield* TestLLM.Test
        const gate = yield* llm.gate()

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
        yield* gate.release
        yield* llm.wait(2)
        yield* sessions.wait(parent.id)
        const notices = (yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")
        expect(notices).toMatchObject([{ metadata: { source: "subagent", childID: child.id, state: "completed" } }])
        expect(notices[0]?.text).toContain("Review complete")
      }),
    )
  }

  it.live(
    "subagent: false overrides subagent mode and switches parent agent and model while forwarding attachments",
    () =>
      Effect.gen(function* () {
        const parent = yield* project(
          {
            subagent: false,
            subtask: true,
            agent: "reviewer",
            model: "test/override",
            template: "Review @src/button.tsx with @reviewer: $ARGUMENTS: !`printf ready`",
          },
          "json",
        )
        const sessions = yield* Session.Service
        yield* sessions.command({
          sessionID: parent.id,
          command: "review",
          text: "changes",
          files: [{ uri: "data:text/plain;base64,ZXhwb3J0IGNvbnN0IGJ1dHRvbiA9IHRydWU=", name: "button.tsx" }],
          agents: [{ name: "lead" }],
          skills: [{ id: Skill.ID.make("security") }],
        })
        yield* sessions.wait(parent.id)
        expect((yield* sessions.list({ parentID: parent.id })).data).toEqual([])
        expect(yield* sessions.get(parent.id)).toMatchObject({
          agent: "reviewer",
          model: { id: "override" },
        })
        const userMessages = (yield* sessions.context(parent.id)).filter((message) => message.type === "user")
        expect(userMessages).toHaveLength(1)
        expect(userMessages[0]).toMatchObject({
          text: "Review @src/button.tsx with @reviewer: changes: ready",
          agents: [{ name: "lead" }],
          skills: [{ id: "security", name: "Security" }],
        })
        expect(userMessages[0]?.files).toHaveLength(1)
        expect(userMessages[0]?.files?.[0]).toMatchObject({
          name: "button.tsx",
        })
      }),
  )

  it.live("legacy subtask: false overrides subagent mode and switches parent agent and model", () =>
    Effect.gen(function* () {
      const parent = yield* project(
        {
          subtask: false,
          agent: "reviewer",
          model: "test/override",
          template: "Review $ARGUMENTS: !`printf ready`",
        },
        "legacy-json",
      )
      const sessions = yield* Session.Service
      yield* sessions.command({
        sessionID: parent.id,
        command: "review",
        text: "changes",
      })
      yield* sessions.wait(parent.id)
      expect((yield* sessions.list({ parentID: parent.id })).data).toEqual([])
      expect(yield* sessions.get(parent.id)).toMatchObject({
        agent: "reviewer",
        model: { id: "override" },
      })
      const userMessages = (yield* sessions.context(parent.id)).filter((message) => message.type === "user")
      expect(userMessages).toHaveLength(1)
      expect(userMessages[0]?.text).toBe("Review changes: ready")
    }),
  )

  for (const subagent of [false, true]) {
    it.live(
      `native subagent=${subagent}: existing mentions do not synthesize attachments; supplied files and skills reach the model`,
      () =>
        Effect.gen(function* () {
          const parent = yield* project(
            {
              subagent,
              agent: subagent ? "reviewer" : "build",
              template: "Read @known.txt with @reviewer and @missing.txt: $ARGUMENTS",
            },
            "json",
          )
          const sessions = yield* Session.Service
          yield* Effect.promise(() => Bun.write(path.join(parent.location.directory, "known.txt"), "UNATTACHED_SECRET"))
          const llm = yield* TestLLM.Test
          const gate = yield* llm.gate()

          yield* sessions.command({
            sessionID: parent.id,
            command: "review",
            text: "inspect",
            files: [{ uri: "data:text/plain;base64,U1VQUExJRURfQVRUQUNITUVOVA==", name: "explicit.txt" }],
            agents: [{ name: "lead" }],
            skills: [{ id: Skill.ID.make("security") }],
          })
          yield* gate.started
          const children = (yield* sessions.list({ parentID: parent.id })).data
          const targetID = subagent ? children[0]?.id : parent.id
          if (!targetID) return yield* Effect.die("Expected target session")

          const user = (yield* sessions.context(targetID)).find((message) => message.type === "user")
          expect(user?.files).toHaveLength(1)
          expect(user?.files?.[0]).toMatchObject({ name: "explicit.txt" })
          expect(user?.agents).toEqual([{ name: "lead" }])
          expect(user?.skills).toMatchObject([{ id: "security", name: "Security" }])
          expect(user?.text).toContain("@known.txt with @reviewer and @missing.txt")

          const requests = yield* llm.requests()
          const requestJson = JSON.stringify(requests[0])
          expect(requestJson).toContain("SUPPLIED_ATTACHMENT")
          expect(requestJson).toContain("# Security guide")
          expect(requestJson).not.toContain("UNATTACHED_SECRET")

          yield* gate.release
          if (subagent) yield* llm.wait(2)
          yield* sessions.wait(parent.id)
        }),
    )
  }
})

function project(
  command: { agent?: string; model?: string; subagent?: boolean; subtask?: boolean; template?: string },
  format: "json" | "legacy-json" | "markdown",
  name = "review",
) {
  return Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const definition = {
      description: "Review code",
      template: command.template ?? "Review $ARGUMENTS: !`printf ready`",
      ...command,
    }
    yield* Effect.promise(async () => {
      await fs.mkdir(path.join(tmp.path, ".opencode", "skills", "security"), { recursive: true })
      await fs.writeFile(
        path.join(tmp.path, ".opencode", "skills", "security", "SKILL.md"),
        "---\nname: Security\ndescription: Security inspection\n---\n# Security guide",
      )
      await Bun.write(
        path.join(tmp.path, "opencode.json"),
        JSON.stringify({
          agents: { reviewer: { mode: "subagent", model: "test/child" } },
          ...(format === "markdown"
            ? {}
            : { [format === "legacy-json" ? "command" : "commands"]: { [name]: definition } }),
        }),
      )
    })
    if (format === "markdown")
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/commands", `${name}.md`),
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
