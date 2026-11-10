// A foreground shell call across a graceful restart, through the whole app: server 1 runs the turn and is torn down
// mid-call, server 2 recovers the command from the same process daemon and resumes the session.
import { describe, expect } from "bun:test"
import path from "path"
import { Context, Effect, Exit, Layer, Scope } from "effect"
import { LanguageModel, LLMClient } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
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
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { fakeDaemon } from "./fixture/persistent-pty-daemon"
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
  // A server: the whole app on the shared pieces, torn down when its scope closes.
  const server = (scope: Scope.Scope) =>
    Layer.buildWithScope(
      AppNodeBuilder.build(LayerNode.group([Session.node, LocationServiceMap.node, SessionRestart.node]), [
        Global.node.replace(global),
        Database.node.replace(Layer.succeedContext(database)),
        LayerNodePlatform.llmClient.replace(Layer.succeedContext(Context.pick(LLMClient.Service)(llm))),
        PersistentPty.node.replace(
          makeGlobalNode({
            service: PersistentPty.Service,
            layer: PersistentPty.layerWith(daemon.options),
            deps: [Bus.node, Global.node],
          }),
        ),
        Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
        Watcher.node.replace(Watcher.configured({ enabled: false })),
        offlineModels,
        model,
      ]),
      scope,
    )
  return { daemon, llm: Context.get(llm, TestLLM.Test), project, server }
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

describe("shell commands across a graceful restart", () => {
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
          if (!finished) daemon.exit(command.id, 0)
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
})
