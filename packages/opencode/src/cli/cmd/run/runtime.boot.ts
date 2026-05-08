// Boot-time resolution for direct interactive mode.
//
// These functions run concurrently at startup to gather everything the runtime
// needs before the first frame: keybinds from TUI config, diff display style,
// model variant list with context limits, and session history for the prompt
// history ring. All are async because they read config or hit the SDK, but
// none block each other.
import { Context, Effect, Layer } from "effect"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { makeRuntime } from "@/effect/run-service"
import { reusePendingTask } from "./runtime.shared"
import { resolveSession, sessionHistory } from "./session.shared"
import type { FooterKeybinds, RunDiffStyle, RunInput, RunPrompt, RunProvider } from "./types"
import { pickVariant } from "./variant.shared"

const DEFAULT_KEYBINDS: FooterKeybinds = {
  leader: "ctrl+x",
  leaderTimeout: 2000,
  commandList: [{ key: "ctrl+p" }],
  variantCycle: [{ key: "ctrl+t" }],
  interrupt: [{ key: "escape" }],
  historyPrevious: [{ key: "up" }],
  historyNext: [{ key: "down" }],
  inputClear: [{ key: "ctrl+c" }],
  inputSubmit: [{ key: "return" }],
  inputNewline: [{ key: "shift+return,ctrl+return,alt+return,ctrl+j" }],
}

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
  readonly resolveFooterKeybinds: () => Effect.Effect<FooterKeybinds>
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

function footerKeybinds(config: Config | undefined): FooterKeybinds {
  if (!config) {
    return DEFAULT_KEYBINDS
  }

  return {
    leader: config.keymap.leader,
    leaderTimeout: config.keymap.leader_timeout,
    commandList: config.keymap.get("global", "command.palette.show") ?? [],
    variantCycle: config.keymap.get("global", "variant.cycle") ?? [],
    interrupt: config.keymap.get("prompt", "session.interrupt") ?? [],
    historyPrevious: config.keymap.get("prompt", "prompt.history.previous") ?? [],
    historyNext: config.keymap.get("prompt", "prompt.history.next") ?? [],
    inputClear: config.keymap.get("prompt", "prompt.clear") ?? [],
    inputSubmit: config.keymap.get("input", "input.submit") ?? [],
    inputNewline: config.keymap.get("input", "input.newline") ?? [],
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
      const connected = yield* Effect.promise(() =>
        sdk.config
          .providers({ directory })
          .then((item) => item.data?.providers)
          .catch(() => undefined),
      )
      const providers = yield* Effect.promise(() =>
        connected
          ? Promise.resolve(connected)
          : sdk.provider
              .list()
              .then((item) => item.data?.all ?? [])
              .catch(() => []),
      )
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
      const session = yield* Effect.promise(() => resolveSession(sdk, sessionID).catch(() => undefined))
      if (!session) {
        return emptySessionInfo()
      }

      return {
        first: session.first,
        history: sessionHistory(session),
        variant: pickVariant(model, session),
      }
    })

    const resolveFooterKeybinds = Effect.fn("RunBoot.resolveFooterKeybinds")(function* () {
      return footerKeybinds(yield* config())
    })

    const resolveDiffStyle = Effect.fn("RunBoot.resolveDiffStyle")(function* () {
      return (yield* config())?.diff_style ?? "auto"
    })

    return Service.of({
      resolveModelInfo,
      resolveSessionInfo,
      resolveFooterKeybinds,
      resolveDiffStyle,
    })
  }),
)

const runtime = makeRuntime(Service, layer)

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

// Reads keybind overrides from TUI config and merges them with defaults.
export async function resolveFooterKeybinds(): Promise<FooterKeybinds> {
  return runtime.runPromise((svc) => svc.resolveFooterKeybinds()).catch(() => DEFAULT_KEYBINDS)
}

export async function resolveDiffStyle(): Promise<RunDiffStyle> {
  return runtime.runPromise((svc) => svc.resolveDiffStyle()).catch(() => "auto")
}
