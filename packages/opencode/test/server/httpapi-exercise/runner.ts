import { Flag } from "@opencode-ai/core/flag/flag"
import { Cause, Duration, Effect } from "effect"
import { TestLLMServer } from "../../lib/llm-server"
import type { Config } from "../../../src/config/config"
import { ModelID, ProviderID } from "../../../src/provider/schema"
import type { MessageV2 } from "../../../src/session/message-v2"
import { MessageID, PartID } from "../../../src/session/schema"
import { call, callAuthProbe } from "./backend"
import { original } from "./environment"
import { runtime } from "./runtime"
import type { ActiveScenario, Options, ProjectOptions, Result, Scenario, ScenarioContext, SeededContext } from "./types"

export function runScenario(options: Options) {
  return (scenario: Scenario) => {
    if (scenario.kind === "todo") return Effect.succeed({ status: "skip", scenario } as Result)
    return runActive(options, scenario).pipe(
      Effect.timeoutOrElse({
        duration: options.scenarioTimeout,
        orElse: () => Effect.die(new Error(`scenario timed out after ${Duration.format(options.scenarioTimeout)}`)),
      }),
      Effect.as({ status: "pass", scenario } as Result),
      Effect.catchCause((cause) => Effect.succeed({ status: "fail" as const, scenario, message: Cause.pretty(cause) })),
      Effect.scoped,
    )
  }
}

function runActive(options: Options, scenario: ActiveScenario) {
  if (options.mode === "auth") return runAuth(scenario)

  return withContext(options, scenario, "shared", (ctx) =>
    Effect.gen(function* () {
      yield* trace(options, scenario, "request start")
      const result = yield* call(scenario, ctx)
      yield* trace(options, scenario, `response ${result.status}`)
      yield* trace(options, scenario, "expect start")
      yield* scenario.expect(ctx, ctx.state, result)
      yield* trace(options, scenario, "expect done")
    }),
  )
}

function runAuth(scenario: ActiveScenario) {
  return Effect.gen(function* () {
    const result = yield* callAuthProbe(scenario, "missing")
    if (scenario.auth === "protected") {
      if (result.status !== 401) throw new Error(`auth expected 401, got ${result.status}`)
      const authed = yield* callAuthProbe(scenario, "valid")
      if (authed.status === 401) throw new Error("auth rejected valid credentials")
      return
    }

    if (result.status === 401) throw new Error("auth expected public access, got 401")
    if (result.timedOut) throw new Error("auth expected public access, probe timed out")
  })
}

function withContext<A, E>(
  options: Options,
  scenario: ActiveScenario,
  label: string,
  use: (ctx: SeededContext<unknown>) => Effect.Effect<A, E>,
) {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      yield* trace(options, scenario, `${label} context acquire start`)
      const llm = scenario.project?.llm ? yield* TestLLMServer : undefined
      const project = scenario.project
      const dir = project
        ? yield* Effect.promise(async () => (await runtime()).tmpdir(projectOptions(project, llm?.url)))
        : undefined
      yield* trace(options, scenario, `${label} context acquire done`)
      return { dir, llm }
    }),
    (ctx) =>
      Effect.gen(function* () {
        yield* trace(options, scenario, `${label} tmpdir cleanup start`)
        yield* Effect.promise(async () => {
          await ctx.dir?.[Symbol.asyncDispose]()
        }).pipe(Effect.ignore)
        yield* trace(options, scenario, `${label} tmpdir cleanup done`)
      }),
  ).pipe(
    Effect.flatMap((context) =>
      Effect.gen(function* () {
        yield* trace(options, scenario, `${label} runtime start`)
        const modules = yield* Effect.promise(() => runtime())
        yield* trace(options, scenario, `${label} runtime done`)
        const path = context.dir?.path
        const instance = path
          ? yield* trace(options, scenario, `${label} instance load start`).pipe(
              Effect.andThen(
                modules.InstanceStore.Service.use((store) => store.load({ directory: path })).pipe(
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
                ),
              ),
              Effect.tap(() => trace(options, scenario, `${label} instance load done`)),
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
          messages: (sessionID) =>
            run(modules.Session.Service.use((svc) => svc.messages({ sessionID }).pipe(Effect.orDie))),
          todos: (sessionID, todos) => run(modules.Todo.Service.use((svc) => svc.update({ sessionID, todos }))),
          worktree: (input) => run(modules.Worktree.Service.use((svc) => svc.create(input))),
          worktreeRemove: (directory) =>
            run(modules.Worktree.Service.use((svc) => svc.remove({ directory })).pipe(Effect.ignore)),
          llmText: (value) => Effect.suspend(() => llm().text(value)),
          llmWait: (count) => Effect.suspend(() => llm().wait(count)),
          tuiRequest: (request) => Effect.sync(() => modules.Tui.submitTuiRequest(request)),
        }
        yield* trace(options, scenario, `${label} seed start`)
        const state = yield* scenario.seed(base)
        yield* trace(options, scenario, `${label} seed done`)
        yield* trace(options, scenario, `${label} use start`)
        const result = yield* use({ ...base, state })
        yield* trace(options, scenario, `${label} use done`)
        return result
      }).pipe(Effect.ensuring(context.llm ? context.llm.reset : Effect.void)),
    ),
    Effect.ensuring(scenario.reset ? resetState : Effect.void),
  )
}

function trace(options: Options, scenario: ActiveScenario, phase: string) {
  return Effect.sync(() => {
    if (!options.trace) return
    console.log(`[trace] ${scenario.name}: ${phase}`)
  })
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

const resetState = Effect.promise(async () => {
  const modules = await runtime()
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  await modules.disposeAllInstances()
  await modules.resetDatabase()
  await Bun.sleep(25)
})
