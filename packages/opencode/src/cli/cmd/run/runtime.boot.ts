// Boot-time resolution for direct interactive mode.
//
// These functions run concurrently at startup to gather everything the runtime
// needs before the first frame: TUI keymap config, diff display style,
// model variant list with context limits, and session history for the prompt
// history ring. All are async because they read config or hit the SDK, but
// none block each other.
import { Context, Effect, Layer } from "effect"
import { resolve } from "@opencode-ai/tui/config"
import { TuiConfig } from "@/config/tui"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { makeRuntime } from "@/effect/run-service"
import { loadRunProviders } from "./catalog.shared"
import { reusePendingTask } from "./runtime.shared"
import { resolveCurrentSession, sessionHistory } from "./session.shared"
import type { RunDiffStyle, RunInput, RunPrompt, RunProvider, RunTuiConfig } from "./types"
import { pickVariant } from "./variant.shared"

export type ModelInfo = {
  providers: RunProvider[]
  variants: string[]
  limits: Record<string, number>
}

export type SessionInfo = {
  first: boolean
  history: RunPrompt[]
  variant: string | undefined
}

type Config = Awaited<ReturnType<typeof TuiConfig.get>>
type BootService = {
  readonly resolveModelInfo: (
    sdk: RunInput["sdk"],
    directory: string,
    model: RunInput["model"],
  ) => Effect.Effect<ModelInfo>
  readonly resolveSessionInfo: (
    sdk: RunInput["sdk"],
    sessionID: string,
    model: RunInput["model"],
  ) => Effect.Effect<SessionInfo>
  readonly resolveRunTuiConfig: () => Effect.Effect<RunTuiConfig>
  readonly resolveDiffStyle: () => Effect.Effect<RunDiffStyle>
}

const configTask: { current?: Promise<Config> } = {}

class Service extends Context.Service<Service, BootService>()("@opencode/RunBoot") {}

function loadConfig() {
  return reusePendingTask(configTask, () => TuiConfig.get())
}

function emptyModelInfo(): ModelInfo {
  return {
    providers: [],
    variants: [],
    limits: {},
  }
}

function emptySessionInfo(): SessionInfo {
  return {
    first: true,
    history: [],
    variant: undefined,
  }
}

function defaultRunTuiConfig(): RunTuiConfig {
  return {
    ...resolve({}, { terminalSuspend: process.platform !== "win32" }),
    diff_style: "auto",
  }
}

function runTuiConfig(config: Config | undefined): RunTuiConfig {
  if (!config) {
    return defaultRunTuiConfig()
  }

  return {
    keybinds: config.keybinds,
    leader_timeout: config.leader_timeout,
    diff_style: config.diff_style ?? "auto",
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = Effect.fn("RunBoot.config")(() => Effect.promise(() => loadConfig().catch(() => undefined)))

    const resolveModelInfo = Effect.fn("RunBoot.resolveModelInfo")(function* (
      sdk: RunInput["sdk"],
      directory: string,
      model: RunInput["model"],
    ) {
      const providers = yield* Effect.promise(() => loadRunProviders(sdk, directory))
      const limits = Object.fromEntries(
        providers.flatMap((provider) =>
          Object.entries(provider.models ?? {}).flatMap(([modelID, info]) => {
            const limit = info?.limit?.context
            if (typeof limit !== "number" || limit <= 0) {
              return []
            }

            return [[`${provider.id}/${modelID}`, limit] as const]
          }),
        ),
      )

      if (!model) {
        return {
          providers,
          variants: [],
          limits,
        }
      }

      const info = providers.find((item) => item.id === model.providerID)?.models?.[model.modelID]
      return {
        providers,
        variants: Object.keys(info?.variants ?? {}),
        limits,
      }
    })

    const resolveSessionInfo = Effect.fn("RunBoot.resolveSessionInfo")(function* (
      sdk: RunInput["sdk"],
      sessionID: string,
      model: RunInput["model"],
    ) {
      const session = yield* Effect.promise(() => resolveCurrentSession(sdk, sessionID).catch(() => undefined))
      if (!session) {
        return emptySessionInfo()
      }

      return {
        first: session.first,
        history: sessionHistory(session),
        variant: pickVariant(model, session),
      }
    })

    const resolveRunTuiConfig = Effect.fn("RunBoot.resolveRunTuiConfig")(function* () {
      return runTuiConfig(yield* config())
    })

    const resolveDiffStyle = Effect.fn("RunBoot.resolveDiffStyle")(function* () {
      return runTuiConfig(yield* config()).diff_style ?? "auto"
    })

    return Service.of({
      resolveModelInfo,
      resolveSessionInfo,
      resolveRunTuiConfig,
      resolveDiffStyle,
    })
  }),
)

const node = makeGlobalNode({ service: Service, layer, deps: [] })
const runtime = makeRuntime(Service, AppNodeBuilder.build(node))

// Fetches available variants and context limits for every provider/model pair.
export async function resolveModelInfo(
  sdk: RunInput["sdk"],
  directory: string,
  model: RunInput["model"],
): Promise<ModelInfo> {
  return runtime.runPromise((svc) => svc.resolveModelInfo(sdk, directory, model)).catch(() => emptyModelInfo())
}

// Fetches session messages to determine if this is the first turn and build prompt history.
export async function resolveSessionInfo(
  sdk: RunInput["sdk"],
  sessionID: string,
  model: RunInput["model"],
): Promise<SessionInfo> {
  return runtime.runPromise((svc) => svc.resolveSessionInfo(sdk, sessionID, model)).catch(() => emptySessionInfo())
}

// Reads TUI config once for direct mode keymap setup and display preferences.
export async function resolveRunTuiConfig(): Promise<RunTuiConfig> {
  return runtime.runPromise((svc) => svc.resolveRunTuiConfig()).catch(() => defaultRunTuiConfig())
}

export async function resolveDiffStyle(): Promise<RunDiffStyle> {
  return runtime.runPromise((svc) => svc.resolveDiffStyle()).catch(() => "auto")
}
