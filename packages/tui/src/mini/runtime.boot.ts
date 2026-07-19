// Boot-time resolution for direct interactive mode.
//
// These functions run concurrently at startup to gather everything the runtime
// needs before the first frame: TUI keymap config, diff display style,
// model variant list with context limits, and session history for the prompt
// history ring. All are async because they read config or hit the SDK, but
// none block each other.
import { resolve } from "../config/v1"
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

function defaultRunTuiConfig(platform: NodeJS.Platform): RunTuiConfig {
  return {
    ...resolve({}, { terminalSuspend: platform !== "win32" }),
    diff_style: "auto",
  }
}

async function loadModelInfo(
  sdk: RunInput["sdk"],
  directory: string,
  model: RunInput["model"],
): Promise<ModelInfo> {
  const providers = await loadRunProviders(sdk, directory)
  const limits = Object.fromEntries(
    providers.flatMap((provider) =>
      Object.entries(provider.models ?? {}).flatMap(([modelID, info]) => {
        const limit = info?.limit?.context
        if (typeof limit !== "number" || limit <= 0) return []
        return [[`${provider.id}/${modelID}`, limit] as const]
      }),
    ),
  )
  if (!model) return { providers, variants: [], limits }
  const info = providers.find((item) => item.id === model.providerID)?.models?.[model.modelID]
  return {
    providers,
    variants: Object.keys(info?.variants ?? {}),
    limits,
  }
}

// Fetches available variants and context limits for every provider/model pair.
export async function resolveModelInfo(
  sdk: RunInput["sdk"],
  directory: string,
  model: RunInput["model"],
): Promise<ModelInfo> {
  return loadModelInfo(sdk, directory, model).catch(() => emptyModelInfo())
}

export function resolveModelInfoStrict(sdk: RunInput["sdk"], directory: string, model: RunInput["model"]) {
  return loadModelInfo(sdk, directory, model)
}

// Fetches session messages to determine if this is the first turn and build prompt history.
export async function resolveSessionInfo(
  sdk: RunInput["sdk"],
  sessionID: string,
  model: RunInput["model"],
): Promise<SessionInfo> {
  return resolveCurrentSession(sdk, sessionID)
    .then((session) => ({
      first: session.first,
      history: sessionHistory(session),
      model: session.model,
      variant: pickVariant(model ?? session.model, session),
    }))
    .catch(() => emptySessionInfo())
}

// Reads TUI config once for direct mode keymap setup and display preferences.
export async function resolveRunTuiConfig(
  config?: RunTuiConfig | Promise<RunTuiConfig>,
  platform: NodeJS.Platform = "linux",
): Promise<RunTuiConfig> {
  return Promise.resolve(config)
    .then((value) => value ?? defaultRunTuiConfig(platform))
    .catch(() => defaultRunTuiConfig(platform))
}

export async function resolveDiffStyle(
  config?: RunTuiConfig | Promise<RunTuiConfig>,
  platform: NodeJS.Platform = "linux",
): Promise<RunDiffStyle> {
  return resolveRunTuiConfig(config, platform).then((value) => value.diff_style ?? "auto")
}
