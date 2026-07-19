// Boot-time resolution for direct interactive mode.
//
// These functions run concurrently at startup to gather everything the runtime
// needs before the first frame: TUI keymap config, diff display style,
// model variant list with context limits, and session history for the prompt
// history ring. All are async because they read config or hit the SDK, but
// none block each other.
import type { LocationRef } from "@opencode-ai/client/promise"
import { resolve } from "../config"
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
  return resolve({}, { terminalSuspend: platform !== "win32" })
}

async function loadModelInfo(
  sdk: RunInput["sdk"],
  location: LocationRef,
  model: RunInput["model"],
  signal?: AbortSignal,
): Promise<ModelInfo> {
  const providers = await loadRunProviders(sdk, location, signal)
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
  location: LocationRef,
  model: RunInput["model"],
  signal?: AbortSignal,
): Promise<ModelInfo> {
  return loadModelInfo(sdk, location, model, signal).catch(() => emptyModelInfo())
}

export function resolveModelInfoStrict(
  sdk: RunInput["sdk"],
  location: LocationRef,
  model: RunInput["model"],
  signal?: AbortSignal,
) {
  return loadModelInfo(sdk, location, model, signal)
}

// Fetches session messages to determine if this is the first turn and build prompt history.
export async function resolveSessionInfo(
  sdk: RunInput["sdk"],
  sessionID: string,
  model: RunInput["model"],
  signal?: AbortSignal,
): Promise<SessionInfo> {
  return resolveCurrentSession(sdk, sessionID, signal)
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
  return resolveRunTuiConfig(config, platform).then((value) => value.diffs?.view ?? "auto")
}
