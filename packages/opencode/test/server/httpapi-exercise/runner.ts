import { Flag } from "@opencode-ai/core/flag/flag"
import { Cause, Effect } from "effect"
import { TestLLMServer } from "../../lib/llm-server"
import type { Config } from "../../../src/config/config"
import { ModelID, ProviderID } from "../../../src/provider/schema"
import type { MessageV2 } from "../../../src/session/message-v2"
import { MessageID, PartID } from "../../../src/session/schema"
import { stable } from "./assertions"
import { call, callAuthProbe } from "./backend"
import { original } from "./environment"
import { runtime } from "./runtime"
import type {
  ActiveScenario,
  CallResult,
  Options,
  ProjectOptions,
  Result,
  Scenario,
  ScenarioContext,
  SeededContext,
} from "./types"

export function runScenario(options: Options) {
  return (scenario: Scenario) => {
    if (scenario.kind === "todo") return Effect.succeed({ status: "skip", scenario } as Result)
    return runActive(options, scenario).pipe(
      Effect.as({ status: "pass", scenario } as Result),
      Effect.catchCause((cause) => Effect.succeed({ status: "fail" as const, scenario, message: Cause.pretty(cause) })),
      Effect.scoped,
    )
  }
}

function runActive(options: Options, scenario: ActiveScenario) {
  if (options.mode === "auth") return runAuth(scenario)

  if (options.mode === "parity" && scenario.mutates && scenario.compare !== "none") {
    return Effect.gen(function* () {
      const effect = yield* runBackend("effect", scenario)
      const legacy = yield* runBackend("legacy", scenario)
      yield* compare(scenario, effect, legacy)
    })
  }

  return withContext(scenario, (ctx) =>
    Effect.gen(function* () {
      const effect = yield* call("effect", scenario, ctx)
      yield* scenario.expect(ctx, ctx.state, effect)
      if (options.mode === "parity" && scenario.compare !== "none") {
        const legacy = yield* call("legacy", scenario, ctx)
        yield* scenario.expect(ctx, ctx.state, legacy)
        yield* compare(scenario, effect, legacy)
      }
    }),
  )
}

function runAuth(scenario: ActiveScenario) {
  return Effect.gen(function* () {
    const effect = yield* callAuthProbe("effect", scenario)
    const legacy = yield* callAuthProbe("legacy", scenario)
    if (scenario.auth === "protected") {
      if (effect.status !== 401) throw new Error(`effect auth expected 401, got ${effect.status}`)
      if (legacy.status !== 401) throw new Error(`legacy auth expected 401, got ${legacy.status}`)
      return
    }

    if (effect.status === 401) throw new Error("effect auth expected public access, got 401")
    if (legacy.status === 401) throw new Error("legacy auth expected public access, got 401")
  })
}

function runBackend(backend: "effect" | "legacy", scenario: ActiveScenario) {
  return withContext(scenario, (ctx) =>
    Effect.gen(function* () {
      const result = yield* call(backend, scenario, ctx)
      yield* scenario.expect(ctx, ctx.state, result)
      return result
    }),
  )
}

function withContext<A, E>(scenario: ActiveScenario, use: (ctx: SeededContext<unknown>) => Effect.Effect<A, E>) {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const llm = scenario.project?.llm ? yield* TestLLMServer : undefined
      const project = scenario.project
      const dir = project
        ? yield* Effect.promise(async () => (await runtime()).tmpdir(projectOptions(project, llm?.url)))
        : undefined
      return { dir, llm }
    }),
    (ctx) =>
      Effect.promise(async () => {
        await ctx.dir?.[Symbol.asyncDispose]()
      }).pipe(Effect.ignore),
  ).pipe(
    Effect.flatMap((context) =>
      Effect.gen(function* () {
        const modules = yield* Effect.promise(() => runtime())
        const path = context.dir?.path
        const instance = path
          ? yield* modules.InstanceStore.Service.use((store) => store.load({ directory: path })).pipe(
              Effect.provide(modules.AppLayer),
              Effect.catchCause((cause) =>
                Effect.sleep("100 millis").pipe(
                  Effect.andThen(
                    modules.InstanceStore.Service.use((store) => store.load({ directory: path })).pipe(
                      Effect.provide(modules.AppLayer),
                    ),
                  ),
                  Effect.catchCause(() => Effect.failCause(cause)),
                ),
              ),
            )
          : undefined
        const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(Effect.provideService(modules.InstanceRef, instance), Effect.provide(modules.AppLayer))
        const directory = () => {
          if (!context.dir?.path) throw new Error("scenario needs a project directory")
          return context.dir.path
        }
        const llm = () => {
          if (!context.llm) throw new Error("scenario needs fake LLM")
          return context.llm
        }
        const base: ScenarioContext = {
          directory: context.dir?.path,
          headers: (extra) => ({
            ...(context.dir?.path ? { "x-opencode-directory": context.dir.path } : {}),
            ...extra,
          }),
          file: (name, content) =>
            Effect.promise(() => {
              return Bun.write(`${directory()}/${name}`, content)
            }).pipe(Effect.asVoid),
          session: (input) =>
            run(modules.Session.Service.use((svc) => svc.create({ title: input?.title, parentID: input?.parentID }))),
          sessionGet: (sessionID) =>
            run(modules.Session.Service.use((svc) => svc.get(sessionID))).pipe(
              Effect.catchCause(() => Effect.succeed(undefined)),
            ),
          project: () =>
            Effect.sync(() => {
              if (!instance) throw new Error("scenario needs a project directory")
              return instance.project
            }),
          message: (sessionID, input) =>
            Effect.gen(function* () {
              const info: MessageV2.User = {
                id: MessageID.ascending(),
                sessionID,
                role: "user",
                time: { created: Date.now() },
                agent: "build",
                model: {
                  providerID: ProviderID.opencode,
                  modelID: ModelID.make("test"),
                },
              }
              const part: MessageV2.TextPart = {
                id: PartID.ascending(),
                sessionID,
                messageID: info.id,
                type: "text",
                text: input?.text ?? "hello",
              }
              yield* run(
                modules.Session.Service.use((svc) =>
                  Effect.gen(function* () {
                    yield* svc.updateMessage(info)
                    yield* svc.updatePart(part)
                  }),
                ),
              )
              return { info, part }
            }),
          messages: (sessionID) => run(modules.Session.Service.use((svc) => svc.messages({ sessionID }))),
          todos: (sessionID, todos) => run(modules.Todo.Service.use((svc) => svc.update({ sessionID, todos }))),
          worktree: (input) => run(modules.Worktree.Service.use((svc) => svc.create(input))),
          worktreeRemove: (directory) =>
            run(modules.Worktree.Service.use((svc) => svc.remove({ directory })).pipe(Effect.ignore)),
          llmText: (value) => Effect.suspend(() => llm().text(value)),
          llmWait: (count) => Effect.suspend(() => llm().wait(count)),
          tuiRequest: (request) => Effect.sync(() => modules.Tui.submitTuiRequest(request)),
        }
        const state = yield* scenario.seed(base)
        return yield* use({ ...base, state })
      }).pipe(Effect.ensuring(context.llm ? context.llm.reset : Effect.void)),
    ),
    Effect.ensuring(scenario.reset ? resetState : Effect.void),
  )
}

function projectOptions(
  project: ProjectOptions,
  llmUrl: string | undefined,
): { git?: boolean; config?: Partial<Config.Info> } {
  if (!project.llm || !llmUrl) return { git: project.git, config: project.config }
  const fake = fakeLlmConfig(llmUrl)
  return {
    git: project.git,
    config: {
      ...fake,
      ...project.config,
      provider: {
        ...fake.provider,
        ...project.config?.provider,
      },
    },
  }
}

function fakeLlmConfig(url: string): Partial<Config.Info> {
  return {
    model: "test/test-model",
    small_model: "test/test-model",
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: url,
        },
      },
    },
  }
}

function compare(scenario: ActiveScenario, effect: CallResult, legacy: CallResult) {
  return Effect.sync(() => {
    if (effect.status !== legacy.status)
      throw new Error(`legacy returned ${legacy.status}, effect returned ${effect.status}`)
    if (scenario.compare === "status") return
    if (stable(effect.body) !== stable(legacy.body))
      throw new Error(`JSON parity mismatch\nlegacy: ${stable(legacy.body)}\neffect: ${stable(effect.body)}`)
  })
}

const resetState = Effect.promise(async () => {
  const modules = await runtime()
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original.OPENCODE_EXPERIMENTAL_HTTPAPI
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  await modules.disposeAllInstances()
  await modules.resetDatabase()
  await Bun.sleep(25)
})
