// Boot-time resolution for direct interactive mode.
//
// These functions run concurrently at startup to gather everything the runtime
// needs before the first frame: TUI keymap config, diff display style,
// model variant list with context limits, and session history for the prompt
// history ring. All are async because they read config or hit the SDK, but
// none block each other.
import { Context, Effect, Layer } from "effect"
import { resolve } from "@opencode-ai/tui/config/v1"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { loadRunProviders } from "./catalog.shared"
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
  model?: NonNullable<RunInput["model"]>
  variant: string | undefined
}

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
}

class Service extends Context.Service<Service, BootService>()("@opencode/RunBoot") {}

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

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
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
        model: session.model,
        variant: pickVariant(model ?? session.model, session),
      }
    })

    return Service.of({
      resolveModelInfo,
      resolveSessionInfo,
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

export function resolveModelInfoStrict(sdk: RunInput["sdk"], directory: string, model: RunInput["model"]) {
  return runtime.runPromise((svc) => svc.resolveModelInfo(sdk, directory, model))
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
export async function resolveRunTuiConfig(
  config?: RunTuiConfig | Promise<RunTuiConfig>,
): Promise<RunTuiConfig> {
  return Promise.resolve(config).then((value) => value ?? defaultRunTuiConfig()).catch(() => defaultRunTuiConfig())
}

export async function resolveDiffStyle(config?: RunTuiConfig | Promise<RunTuiConfig>): Promise<RunDiffStyle> {
  return resolveRunTuiConfig(config).then((value) => value.diff_style ?? "auto")
}
