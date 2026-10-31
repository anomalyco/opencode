import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { LanguageModel, type LLMRequest } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { AgentPlugin } from "@opencode/core/plugin/agent"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { Shell } from "@opencode/core/shell"
import { ShellSelect } from "@opencode/core/shell/select"
import { Snapshot } from "@opencode/core/snapshot"
import { Tool } from "@opencode/core/tool"
import { ShellTool } from "@opencode/core/tool/plugin/shell"
import { SubagentTool } from "@opencode/core/tool/plugin/subagent"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Context, Deferred, Effect, Fiber, Layer, Queue, Schedule, Schema, Stream } from "effect"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { Expected } from "./lib/session-message"
import { registerToolPlugin } from "./lib/tool"
import { agentHost, host } from "./plugin/host"

type LookupGate = {
  started: Deferred.Deferred<void>
  release: Deferred.Deferred<string>
}

class Requests extends Context.Service<Requests, LLMRequest[]>()("test/SteerBackgroundRequests") {}
class Lookup extends Context.Service<Lookup, { gate?: LookupGate; forceQueue?: boolean }>()(
  "test/SteerBackgroundLookup",
) {}

const isWindows = process.platform === "win32"
const gatedShellCommand = (started: string, release: string, text: string) =>
  isWindows
    ? `[IO.File]::WriteAllText('${started}', 'ready'); while (!(Test-Path -LiteralPath '${release}')) { Start-Sleep -Milliseconds 25 }; [Console]::Out.Write('${text}')`
    : `printf ready > '${started}'; while [ ! -e '${release}' ]; do sleep 0.02; done; printf '${text}'`

const waitForFile = (file: string) =>
  Effect.promise(() => Bun.file(file).exists()).pipe(
    Effect.repeat({ schedule: Schedule.spaced("10 millis"), until: Boolean }),
    Effect.timeout("10 seconds"),
  )

const waitForNoRunningBackground = (jobs: Job.Interface) =>
  jobs.runningBackground.pipe(
    Effect.repeat({ schedule: Schedule.spaced("10 millis"), until: (items) => items.length === 0 }),
    Effect.timeout("10 seconds"),
  )

const makePluginSupervisor = (lookup: { gate?: LookupGate; forceQueue?: boolean }) =>
  makeLocationNode({
    name: "test/steer-background-plugins",
    layer: Layer.effectDiscard(
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const hooks = yield* PluginHooks.Service
        const tools = yield* Tool.Service
        yield* hooks.register("session", "prompt", (event) =>
          Effect.sync(() => {
            if (lookup.forceQueue) event.delivery = "queue"
          }),
        )
        yield* AgentPlugin.Plugin.effect(host({ agent: agentHost(agents) }))
        yield* agents.transform((editor) => {
          for (const id of ["build", "explore"]) {
            editor.update(Agent.ID.make(id), (agent) => {
              agent.permissions = [{ action: "*", resource: "*", effect: "allow" }]
            })
          }
        })
        yield* registerToolPlugin(ShellTool.Plugin)
        yield* registerToolPlugin(SubagentTool.Plugin, {}, (name, callback) => hooks.register("tool", name, callback))
        yield* tools.transform((editor) =>
          editor.add({
            name: "lookup",
            description: "Foreground-only lookup",
            options: { codemode: false },
            input: Schema.Struct({ key: Schema.String }),
            output: Schema.String,
            execute: ({ key }) =>
              Effect.gen(function* () {
                const gate = lookup.gate
                if (!gate) return { output: `value:${key}` }
                yield* Deferred.succeed(gate.started, undefined)
                return { output: yield* Deferred.await(gate.release) }
              }),
          }),
        )
      }),
    ),
    deps: [
      Agent.node,
      Config.node,
      Environment.node,
      FileAccess.node,
      Model.node,
      Permission.node,
      PluginHooks.node,
      Session.node,
      SubagentJob.node,
      Job.node,
      Shell.node,
      ShellSelect.node,
      Tool.node,
    ],
  })

const layer = Layer.unwrap(
  Effect.sync(() => {
    const requests: LLMRequest[] = []
    const lookup: { gate?: LookupGate; forceQueue?: boolean } = {}
    const llmLayer = TestLLM.testLayer({
      fallback: [],
      transformRequest: (request) => {
        requests.push(request)
        return request
      },
    })
    return Layer.mergeAll(
      llmLayer,
      Layer.succeed(Requests, requests),
      Layer.succeed(Lookup, lookup),
      AppNodeBuilder.build(LayerNode.group([Bus.node, Session.node, Job.node, LocationServiceMap.node]), [
        Global.node.replace(tempGlobalLayer),
        offlineModels,
        Snapshot.node.replace(Snapshot.noopLayer),
        Watcher.node.replace(Watcher.configured({ enabled: false })),
        LayerNodePlatform.llmClient.replace(llmLayer),
        Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
        PluginSupervisor.node.replace(makePluginSupervisor(lookup)),
        SessionRunnerModel.node.replace(
          Layer.succeed(SessionRunnerModel.Service, {
            resolve: () =>
              Effect.succeed(
                SessionRunnerModel.resolved(
                  LanguageModel.make({ id: "test-model", provider: "test", route: OpenAIChat.route }),
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
    )
  }),
)

const it = testEffect(layer)
const model = Model.Ref.make({ id: Model.ID.make("test-model"), providerID: Provider.ID.make("test") })

const messageTexts = (request: LLMRequest | undefined) =>
  (request?.messages ?? []).flatMap((message) =>
    message.content.flatMap((part) => {
      if (part.type === "text") return [`${message.role}:${part.text}`]
      if (part.type !== "tool-result") return []
      if (part.result.type === "content")
        return part.result.value.flatMap((item) => (item.type === "text" ? [`tool:${item.text}`] : []))
      return [`tool:${typeof part.result.value === "string" ? part.result.value : JSON.stringify(part.result.value)}`]
    }),
  )

const visibleContext = (sessions: Session.Interface, sessionID: Session.ID) =>
  sessions.context(sessionID).pipe(Effect.map((messages) => messages.filter((message) => message.type !== "idle")))

describe("Session background on steer", () => {
  it.live("steering while a shell tool runs moves it to the background and delivers its result later", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const started = path.join(dir.path, "shell.started")
      const release = path.join(dir.path, "shell.release")
      const sessions = yield* Session.Service
      const jobs = yield* Job.Service
      const bus = yield* Bus.Service
      const llm = yield* TestLLM.Test
      const requests = yield* Requests
      requests.length = 0

      const session = yield* sessions.create({
        title: "test",
        location: { directory: AbsolutePath.make(dir.path) },
        agent: Agent.ID.make("build"),
        model,
      })

      const stepEnds = yield* Queue.unbounded<void>()
      yield* bus.subscribe(SessionEvent.Step.Ended).pipe(
        Stream.filter((event) => event.data.sessionID === session.id),
        Stream.runForEach(() => Queue.offer(stepEnds, undefined)),
        Effect.forkScoped({ startImmediately: true }),
      )

      const command = gatedShellCommand(started, release, "background-shell-output")
      yield* llm.push(
        TestLLM.toolCall("call-shell", "shell", { command }),
        TestLLM.text("Handling steer while shell runs", "text-steered"),
        TestLLM.text("Shell finished in background", "text-finished"),
      )

      yield* sessions.prompt({ sessionID: session.id, text: "Run the slow command" })
      yield* waitForFile(started)
      expect(requests).toHaveLength(1)

      yield* sessions.prompt({ sessionID: session.id, text: "Check something else first" })
      yield* sessions.wait(session.id)
      // Step 1 (tool backgrounded) and Step 2 (steer answered) both settled while the shell command still runs.
      yield* Queue.take(stepEnds)
      yield* Queue.take(stepEnds)

      expect(requests).toHaveLength(2)
      const steeredTurn = messageTexts(requests[1])
      expect(steeredTurn.some((line) => line.startsWith("tool:Command moved to the background"))).toBe(true)
      expect(steeredTurn.some((line) => line.includes("DO NOT poll for completion"))).toBe(true)
      expect(steeredTurn).toContain("user:Check something else first")
      expect(yield* Effect.promise(() => Bun.file(release).exists())).toBe(false)

      // Release the background shell command and wait for its completion notice to resume the session.
      yield* Effect.promise(() => fs.writeFile(release, "done"))
      yield* Queue.take(stepEnds)
      yield* waitForNoRunningBackground(jobs)
      yield* sessions.wait(session.id)

      expect(requests).toHaveLength(3)
      expect(messageTexts(requests[2]).some((line) => line.includes("background-shell-output"))).toBe(true)
      expect(yield* visibleContext(sessions, session.id)).toMatchObject([
        Expected.user("Run the slow command"),
        Expected.assistant({}, [{ type: "tool", name: "shell", state: { status: "completed" } }]),
        Expected.user("Check something else first"),
        Expected.assistant({}, [Expected.text("Handling steer while shell runs")]),
        { type: "synthetic", metadata: { source: "shell", state: "completed" } },
        Expected.assistant({}, [Expected.text("Shell finished in background")]),
      ])
    }),
  )

  it.live(
    "backgrounds a shell tool that starts after a steer was admitted in the same step, and promotes a steered queue item",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const firstStarted = path.join(dir.path, "first.started")
        const firstRelease = path.join(dir.path, "first.release")
        const secondStarted = path.join(dir.path, "second.started")
        const secondRelease = path.join(dir.path, "second.release")
        const sessions = yield* Session.Service
        const jobs = yield* Job.Service
        const bus = yield* Bus.Service
        const llm = yield* TestLLM.Test
        const requests = yield* Requests
        requests.length = 0

        const session = yield* sessions.create({
          title: "test",
          location: { directory: AbsolutePath.make(dir.path) },
          agent: Agent.ID.make("build"),
          model,
        })

        const stepEnds = yield* Queue.unbounded<void>()
        yield* bus.subscribe(SessionEvent.Step.Ended).pipe(
          Stream.filter((event) => event.data.sessionID === session.id),
          Stream.runForEach(() => Queue.offer(stepEnds, undefined)),
          Effect.forkScoped({ startImmediately: true }),
        )

        yield* llm.push(
          TestLLM.toolCall("call-first", "shell", {
            command: gatedShellCommand(firstStarted, firstRelease, "first-done"),
          }),
          TestLLM.toolCall("call-second", "shell", {
            command: gatedShellCommand(secondStarted, secondRelease, "second-done"),
          }),
          TestLLM.text("Promoted queued steer", "text-promoted"),
          TestLLM.text("Notices handled", "text-notices"),
          TestLLM.text("Second notice handled", "text-notices-2"),
        )

        const gate = yield* llm.gate()
        yield* sessions.prompt({ sessionID: session.id, text: "Start first" })
        yield* gate.started
        // Steer lands while the model is still streaming the step, before the shell job blocks.
        yield* sessions.prompt({ sessionID: session.id, text: "Steered mid-stream" })
        yield* gate.release
        yield* waitForFile(secondStarted)
        expect(requests).toHaveLength(2)
        expect(messageTexts(requests[1]).some((line) => line.startsWith("tool:Command moved to the background"))).toBe(
          true,
        )
        expect(messageTexts(requests[1])).toContain("user:Steered mid-stream")

        // Queuing for next turn leaves the second shell blocking until steerInbox promotes it.
        const queued = yield* sessions.prompt({
          sessionID: session.id,
          text: "Queued then steered",
          delivery: "queue",
        })
        yield* Effect.yieldNow
        expect(yield* sessions.inbox(session.id)).toMatchObject([{ id: queued.id, delivery: "queue" }])
        expect(requests).toHaveLength(2)

        yield* sessions.steerInbox({ sessionID: session.id, inboxID: queued.id })
        yield* sessions.wait(session.id)
        // Steps 1, 2 and 3 have all ended.
        yield* Queue.take(stepEnds)
        yield* Queue.take(stepEnds)
        yield* Queue.take(stepEnds)
        expect(requests).toHaveLength(3)
        expect(messageTexts(requests[2])).toContain("user:Queued then steered")

        yield* Effect.promise(() => Promise.all([fs.writeFile(firstRelease, "ok"), fs.writeFile(secondRelease, "ok")]))
        yield* Queue.take(stepEnds)
        yield* waitForNoRunningBackground(jobs)
        yield* sessions.wait(session.id)
      }),
  )

  it.live("leaves steering unchanged when no tool is running", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const llm = yield* TestLLM.Test
      const requests = yield* Requests
      requests.length = 0

      const session = yield* sessions.create({
        title: "test",
        location: { directory: AbsolutePath.make(dir.path) },
        agent: Agent.ID.make("build"),
        model,
      })

      yield* llm.push(TestLLM.text("Initial reply", "text-1"), TestLLM.text("Steered reply", "text-2"))
      const gate = yield* llm.gate()

      yield* sessions.prompt({ sessionID: session.id, text: "First question" })
      yield* gate.started
      yield* sessions.prompt({ sessionID: session.id, text: "Follow-up steer" })
      yield* gate.release
      yield* sessions.wait(session.id)

      expect(requests).toHaveLength(2)
      expect(messageTexts(requests[0])).toEqual(["user:First question"])
      expect(messageTexts(requests[1])).toContain("user:Follow-up steer")
      expect(yield* visibleContext(sessions, session.id)).toMatchObject([
        Expected.user("First question"),
        Expected.assistant({}, [Expected.text("Initial reply")]),
        Expected.user("Follow-up steer"),
        Expected.assistant({}, [Expected.text("Steered reply")]),
      ])
    }),
  )

  it.live("leaves a tool that cannot go to the background unchanged when steering", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const llm = yield* TestLLM.Test
      const requests = yield* Requests
      const lookup = yield* Lookup
      requests.length = 0

      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<string>()
      lookup.gate = { started, release }
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          lookup.gate = undefined
        }),
      )

      const session = yield* sessions.create({
        title: "test",
        location: { directory: AbsolutePath.make(dir.path) },
        agent: Agent.ID.make("build"),
        model,
      })

      yield* llm.push(
        TestLLM.toolCall("call-lookup", "lookup", { key: "alpha" }),
        TestLLM.text("Used lookup result and steer", "text-after-lookup"),
      )

      const waiting = yield* sessions
        .prompt({ sessionID: session.id, text: "Look up alpha" })
        .pipe(Effect.andThen(sessions.wait(session.id)), Effect.forkScoped)
      yield* Deferred.await(started)

      // Steer while the non-backgroundable tool is running: the tool keeps running to completion.
      yield* sessions.prompt({ sessionID: session.id, text: "Also summarize it" })
      yield* Effect.yieldNow
      expect(requests).toHaveLength(1)
      expect(waiting.pollUnsafe()).toBeUndefined()

      yield* Deferred.succeed(release, "resolved-alpha")
      yield* Fiber.join(waiting)

      expect(requests).toHaveLength(2)
      const secondTurn = messageTexts(requests[1])
      expect(secondTurn).toContain("tool:resolved-alpha")
      expect(secondTurn).toContain("user:Also summarize it")
      expect(yield* visibleContext(sessions, session.id)).toMatchObject([
        Expected.user("Look up alpha"),
        Expected.assistant({}, [{ type: "tool", name: "lookup", state: { status: "completed" } }]),
        Expected.user("Also summarize it"),
        Expected.assistant({}, [Expected.text("Used lookup result and steer")]),
      ])
    }),
  )

  it.live("honors hook-rewritten delivery and omits duplicate synthetic notices on Session.background", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const started = path.join(dir.path, "hook.started")
      const release = path.join(dir.path, "hook.release")
      const sessions = yield* Session.Service
      const jobs = yield* Job.Service
      const bus = yield* Bus.Service
      const llm = yield* TestLLM.Test
      const requests = yield* Requests
      const lookup = yield* Lookup
      requests.length = 0

      lookup.forceQueue = true
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          lookup.forceQueue = false
        }),
      )

      const session = yield* sessions.create({
        title: "test",
        location: { directory: AbsolutePath.make(dir.path) },
        agent: Agent.ID.make("build"),
        model,
      })

      const stepEnds = yield* Queue.unbounded<void>()
      yield* bus.subscribe(SessionEvent.Step.Ended).pipe(
        Stream.filter((event) => event.data.sessionID === session.id),
        Stream.runForEach(() => Queue.offer(stepEnds, undefined)),
        Effect.forkScoped({ startImmediately: true }),
      )

      yield* llm.push(
        TestLLM.toolCall("call-shell-hook", "shell", {
          command: gatedShellCommand(started, release, "hook-shell-done"),
        }),
        TestLLM.text("Continued after manual background", "text-after-bg"),
        TestLLM.text("Handled queued prompt", "text-queued"),
        TestLLM.text("Handled shell completion", "text-shell-done"),
      )

      lookup.forceQueue = false
      yield* sessions.prompt({ sessionID: session.id, text: "Start shell" })
      yield* waitForFile(started)

      // A prompt whose hook rewrites delivery to "queue" stays queued without backgrounding the shell.
      lookup.forceQueue = true
      const admitted = yield* sessions.prompt({ sessionID: session.id, text: "Rewritten to queue" })
      expect(admitted.delivery).toBe("queue")
      expect(requests).toHaveLength(1)

      // Manual Session.background moves the shell without injecting a duplicate synthetic notice.
      yield* sessions.background(session.id)
      yield* sessions.wait(session.id)
      yield* Queue.take(stepEnds)
      yield* Queue.take(stepEnds)
      yield* Queue.take(stepEnds)

      expect(requests).toHaveLength(3)
      const afterBackground = yield* visibleContext(sessions, session.id)
      expect(afterBackground.filter((message) => message.type === "synthetic")).toEqual([])

      yield* Effect.promise(() => fs.writeFile(release, "done"))
      yield* Queue.take(stepEnds)
      yield* waitForNoRunningBackground(jobs)
      yield* sessions.wait(session.id)
    }),
  )

  it.live("delivers and acknowledges a steered background subagent once after the parent is interrupted", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const jobs = yield* Job.Service
      const bus = yield* Bus.Service
      const llm = yield* TestLLM.Test
      const requests = yield* Requests
      const lookup = yield* Lookup
      requests.length = 0

      const childStarted = yield* Deferred.make<void>()
      const childRelease = yield* Deferred.make<string>()
      lookup.gate = { started: childStarted, release: childRelease }
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          lookup.gate = undefined
        }),
      )

      const parent = yield* sessions.create({
        title: "test",
        location: { directory: AbsolutePath.make(dir.path) },
        agent: Agent.ID.make("build"),
        model,
      })

      const childIDs = yield* Queue.unbounded<Session.ID>()
      yield* bus.subscribe(SessionEvent.Tool.Progress).pipe(
        Stream.filter((event) => event.data.sessionID === parent.id),
        Stream.runForEach((event) => {
          const id = event.data.metadata.sessionID
          return typeof id === "string" ? Queue.offer(childIDs, Session.ID.make(id)) : Effect.void
        }),
        Effect.forkScoped({ startImmediately: true }),
      )
      const parentStepEnds = yield* Queue.unbounded<void>()
      yield* bus.subscribe(SessionEvent.Step.Ended).pipe(
        Stream.filter((event) => event.data.sessionID === parent.id),
        Stream.runForEach(() => Queue.offer(parentStepEnds, undefined)),
        Effect.forkScoped({ startImmediately: true }),
      )

      yield* llm.push(
        TestLLM.toolCall("call-subagent", "subagent", {
          agent: "explore",
          description: "Inspect child",
          prompt: "Check alpha",
        }),
        TestLLM.toolCall("call-child-lookup", "lookup", { key: "alpha" }),
      )

      yield* sessions.prompt({ sessionID: parent.id, text: "Delegate to explore" })
      const childID = yield* Queue.take(childIDs)
      yield* Deferred.await(childStarted)
      yield* jobs
        .get(childID)
        .pipe(
          Effect.repeat({ schedule: Schedule.spaced("10 millis"), until: (info) => info?.status === "running" }),
          Effect.timeout("10 seconds"),
        )

      const steerGate = yield* llm.gate()
      yield* llm.push(TestLLM.text("Parent answering steer", "text-parent-steer"))
      yield* sessions.prompt({ sessionID: parent.id, text: "Redirect parent now" })
      yield* Queue.take(parentStepEnds)
      yield* steerGate.started
      expect((yield* jobs.pendingBackground).some((item) => item.id === childID && item.status === "running")).toBe(
        true,
      )

      // Interrupt the parent's steered step; the backgrounded subagent keeps running.
      expect(yield* sessions.interrupt(parent.id)).toBe(true)
      yield* sessions.wait(parent.id)
      yield* steerGate.release
      expect((yield* jobs.get(childID))?.status).toBe("running")

      yield* llm.push(
        TestLLM.text("Child completed alpha", "text-child-complete"),
        TestLLM.text("Parent got child notice", "text-parent-notice"),
      )
      yield* Deferred.succeed(childRelease, "alpha-value")
      yield* jobs.wait({ id: childID })
      yield* Queue.take(parentStepEnds)
      yield* jobs.pendingBackground.pipe(
        Effect.repeat({
          schedule: Schedule.spaced("10 millis"),
          until: (items) => !items.some((item) => item.id === childID),
        }),
        Effect.timeout("10 seconds"),
      )
      yield* sessions.wait(parent.id)

      const notices = (yield* visibleContext(sessions, parent.id)).filter((message) => message.type === "synthetic")
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({
        type: "synthetic",
        metadata: { source: "subagent", childID, state: "completed" },
      })
      if (notices[0]?.type === "synthetic") expect(notices[0].text).toContain("Child completed alpha")
      expect((yield* jobs.pendingBackground).find((item) => item.id === childID)).toBeUndefined()
    }),
  )
})
