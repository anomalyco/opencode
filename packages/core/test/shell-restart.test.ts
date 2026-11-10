// A foreground shell call across a graceful restart, through the whole app: server 1 runs the turn, prepares a
// handoff and is torn down mid-call, server 2 recovers the command from the same process daemon and resumes the session.
import { describe, expect } from "bun:test"
import path from "path"
import { Context, Effect, Exit, Fiber, Layer, Scope } from "effect"
import type { ChildProcess } from "effect/process"
import { LanguageModel, LLMClient } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Shell } from "@opencode/core/shell"
import { Environment } from "@opencode/core/environment/index"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { fakeDaemon } from "./fixture/persistent-pty-daemon"
import { recordingEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"

const it = testEffect(tempGlobalLayer)

const model = SessionRunnerModel.node.replace(
  Layer.succeed(SessionRunnerModel.Service, {
    resolve: () =>
      Effect.succeed(
        SessionRunnerModel.resolved(LanguageModel.make({ id: "restart", provider: "test", route: OpenAIChat.route }), {
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          cost: [],
          limit: { context: 200_000, output: 32_000 },
        }),
      ),
  }),
)

// Everything both servers share: the process daemon, the data directory, the database and the model.
const world = Effect.gen(function* () {
  const daemon = yield* fakeDaemon()
  const root = (yield* tmpdirScoped()).path
  const data = path.join(root, "data")
  const global = Global.layerWith({
    data,
    cache: path.join(root, "cache"),
    config: path.join(root, "config"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(data, "log"),
    repos: path.join(data, "repos"),
  })
  const database = yield* Layer.build(Database.layer())
  const llm = yield* Layer.build(TestLLM.testLayer({ fallback: TestLLM.text("Done", "done") }))
  const project = (yield* tmpdirScoped()).path
  // Every command the servers spawn instead of handing to the daemon.
  const spawns: ChildProcess.Command[] = []
  // A server: the whole app on the shared pieces, torn down when its scope closes. The daemon comes first, as in the
  // server's routes, so it is released after the sessions and jobs.
  const server = (scope: Scope.Scope) =>
    Layer.buildWithScope(
      AppNodeBuilder.build(
        LayerNode.group([
          PersistentPty.node,
          Shell.daemonNode,
          Session.node,
          LocationServiceMap.node,
          SessionRestart.node,
        ]),
        [
          Global.node.replace(global),
          Database.node.replace(Layer.succeedContext(database)),
          LayerNodePlatform.llmClient.replace(Layer.succeedContext(Context.pick(LLMClient.Service)(llm))),
          PersistentPty.node.replace(PersistentPty.configured(daemon.options)),
          Environment.node.replace(recordingEnvironmentLayer(spawns)),
          Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
          Watcher.node.replace(Watcher.configured({ enabled: false })),
          offlineModels,
          model,
        ],
      ),
      scope,
    )
  const shellSpawns = () => spawns.filter((command) => JSON.stringify(command).includes("sleep 60"))
  return { daemon, llm: Context.get(llm, TestLLM.Test), project, server, shellSpawns }
})

const shellCall = (sessions: Session.Interface, sessionID: Session.ID) =>
  sessions
    .context(sessionID)
    .pipe(
      Effect.map((messages) =>
        messages.flatMap((message) =>
          message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
        ),
      ),
    )

const until = (check: () => boolean) =>
  Effect.gen(function* () {
    while (!check()) yield* Effect.sleep(5)
  })

// Shell commands only run in the process daemon off Windows (pipe mode is Unix-only).
describe.skipIf(process.platform === "win32")("shell commands across a graceful restart", () => {
  for (const finished of [false, true])
    it.live(
      `settles a foreground call ${finished ? "whose command finished during the restart" : "whose command still runs"} and resumes its session`,
      () =>
        Effect.gen(function* () {
          const { daemon, llm, project, server } = yield* world
          // The turn's first request runs the command; anything else (a title, the resumed turn) just answers.
          let turns = 0
          yield* llm.serve((request) =>
            request.tools.some((tool) => tool.name === "shell") && turns++ === 0
              ? TestLLM.toolCall("call-restart", "shell", { command: "sleep 60" })
              : TestLLM.text("Done", "done"),
          )

          // Server 1 starts the turn, which waits on the command, then shuts down.
          const first = yield* Scope.make()
          const one = yield* server(first)
          const sessions = Context.get(one, Session.Service)
          const session = yield* sessions.create({
            location: { directory: AbsolutePath.make(project) },
            agent: Agent.ID.make("build"),
            model: Model.Ref.make({ id: Model.ID.make("restart"), providerID: Provider.ID.make("test") }),
          })
          yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
            Effect.provide(Context.get(one, LocationServiceMap.Service).get(session.location)),
          )
          yield* sessions.prompt({ sessionID: session.id, text: "run it" })
          yield* until(() => daemon.processes.length === 1 && daemon.waiters(daemon.processes[0]!.id) > 0)
          const command = daemon.processes[0]!
          // A graceful restart: the server hands its daemon over to the next one, then shuts down.
          expect(yield* Context.get(one, PersistentPty.Service).handoff()).not.toBeNull()
          yield* Scope.close(first, Exit.void)

          // The shutdown stopped nothing and settled nothing.
          expect(command.lifecycle.status).toBe("running")
          expect(daemon.ops).not.toContain("signal")
          expect(turns).toBe(1)
          if (finished) {
            daemon.output(command.id, "finished output\n")
            daemon.exit(command.id, 0)
          }

          // Server 2 takes the command back, settles the call and resumes the turn.
          const second = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(second, Exit.void))
          const two = yield* server(second)
          const resumed = Context.get(two, Session.Service)
          yield* Context.get(two, SessionRestart.Service).resumeSuspendedSessions
          yield* until(() => turns >= 2)
          const shellID = String(command.pipe?.metadata.id)
          expect(yield* shellCall(resumed, session.id)).toMatchObject([
            {
              id: "call-restart",
              state: {
                status: "completed",
                content: [
                  {
                    type: "text",
                    text: expect.stringContaining(`Command moved to the background (shell ID: ${shellID})`),
                  },
                  { type: "text", text: expect.stringContaining("You will be notified automatically") },
                ],
              },
            },
          ])
          if (!finished) {
            // The resumed turn ends while the command still runs; its completion wakes the session again.
            yield* resumed.wait(session.id)
            expect(turns).toBe(2)
            daemon.exit(command.id, 0)
            yield* until(() => turns >= 3)
          }
          // Either way the session hears how it ended.
          const notices = Effect.map(resumed.context(session.id), (messages) =>
            messages.filter((message) => message.type === "synthetic" && message.metadata?.source === "shell"),
          )
          while ((yield* notices).length === 0) yield* Effect.sleep(5)
          expect((yield* notices)[0]).toMatchObject({ metadata: { shellID, state: "completed" } })
          if (finished) expect((yield* notices)[0]).toMatchObject({ text: expect.stringContaining("finished output") })
          yield* resumed.wait(session.id)
        }),
    )

  // Without a handoff nothing takes the commands over: the shutdown stops them, while the daemon is still reachable.
  for (const starting of [false, true])
    it.live(
      `stops a command ${starting ? "still being created" : "a foreground call waits on"} when the server shuts down without a handoff`,
      () =>
        Effect.gen(function* () {
          const { daemon, llm, project, server, shellSpawns } = yield* world
          let turns = 0
          yield* llm.serve((request) =>
            request.tools.some((tool) => tool.name === "shell") && turns++ === 0
              ? TestLLM.toolCall("call-shutdown", "shell", { command: "sleep 60" })
              : TestLLM.text("Done", "done"),
          )
          let release = () => {}
          if (starting) daemon.holdCreate.until = new Promise<void>((resolve) => (release = resolve))

          const first = yield* Scope.make()
          const one = yield* server(first)
          const sessions = Context.get(one, Session.Service)
          const session = yield* sessions.create({
            location: { directory: AbsolutePath.make(project) },
            agent: Agent.ID.make("build"),
            model: Model.Ref.make({ id: Model.ID.make("restart"), providerID: Provider.ID.make("test") }),
          })
          yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
            Effect.provide(Context.get(one, LocationServiceMap.Service).get(session.location)),
          )
          yield* sessions.prompt({ sessionID: session.id, text: "run it" })
          if (starting) yield* until(() => daemon.ops.includes("create_pipe"))
          else yield* until(() => daemon.processes.length === 1 && daemon.waiters(daemon.processes[0]!.id) > 0)

          const closing = yield* Scope.close(first, Exit.void).pipe(Effect.forkChild({ startImmediately: true }))
          if (starting) {
            yield* Effect.sleep(20)
            daemon.holdCreate.until = undefined
            release()
          }
          yield* Fiber.join(closing)

          // The command reached the daemon, and the shutdown stopped it there; nothing was spawned instead.
          const command = daemon.processes[0]
          expect(command).toBeDefined()
          expect(daemon.requests).toContainEqual(
            expect.objectContaining({ op: "signal", id: command?.id, signal: "SIGTERM" }),
          )
          expect(command?.lifecycle.status).toBe("exited")
          expect(shellSpawns()).toEqual([])

          // The call was settled on the way down, and the next server resumes the session.
          const second = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(second, Exit.void))
          const two = yield* server(second)
          const resumed = Context.get(two, Session.Service)
          expect(yield* shellCall(resumed, session.id)).toMatchObject([
            {
              id: "call-shutdown",
              state: { status: "error", error: { type: "aborted", message: "Tool execution interrupted" } },
            },
          ])
          yield* Context.get(two, SessionRestart.Service).resumeSuspendedSessions
          yield* until(() => turns >= 2)
          yield* resumed.wait(session.id)
        }),
    )
})
