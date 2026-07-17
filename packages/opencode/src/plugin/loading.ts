import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Effect } from "effect"
import type { ConfigPlugin } from "@/config/plugin"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import { errorMessage } from "@/util/error"
import { applyPlugin, internalPlugins } from "./discovery"
import { PluginLoader } from "./loader"
import { parsePluginSpecifier } from "./shared"

export const loadInternalPlugins = Effect.fnUntraced(function* (
  flags: RuntimeFlags.Info,
  input: PluginInput,
  hooks: Hooks[],
) {
  for (const plugin of flags.disableDefaultPlugins ? [] : internalPlugins(flags)) {
    const init = yield* Effect.tryPromise({
      try: () => plugin(input),
      catch: errorMessage,
    }).pipe(
      Effect.tapError((error) => Effect.logError("failed to load internal plugin", { name: plugin.name, error })),
      Effect.option,
    )
    if (init._tag === "Some") hooks.push(init.value)
  }
})

type ExternalLoadInput = {
  readonly origins: ConfigPlugin.Origin[]
  readonly pluginInput: PluginInput
  readonly hooks: Hooks[]
  readonly publishPluginError: (message: string) => void
}

export const loadExternalPlugins = Effect.fnUntraced(function* (input: ExternalLoadInput) {
  const loaded = yield* Effect.promise(() =>
    PluginLoader.loadExternal({
      items: input.origins,
      kind: "server",
      report: {
        start(candidate) {},
        missing(candidate, _retry, message) {},
        error(candidate, _retry, stage, error, resolved) {
          const spec = candidate.plan.spec
          const cause = error instanceof Error ? (error.cause ?? error) : error
          const message = stage === "load" ? errorMessage(error) : errorMessage(cause)

          if (stage === "install") {
            const parsed = parsePluginSpecifier(spec)
            input.publishPluginError(`Failed to install plugin ${parsed.pkg}@${parsed.version}: ${message}`)
            return
          }

          if (stage === "compatibility") {
            input.publishPluginError(`Plugin ${spec} skipped: ${message}`)
            return
          }

          if (stage === "entry") {
            input.publishPluginError(`Failed to load plugin ${spec}: ${message}`)
            return
          }

          input.publishPluginError(`Failed to load plugin ${spec}: ${message}`)
        },
      },
    }),
  )

  for (const load of loaded) {
    if (!load) continue

    yield* Effect.tryPromise({
      try: () => applyPlugin(load, input.pluginInput, input.hooks),
      catch: errorMessage,
    }).pipe(
      Effect.tapError((error) => Effect.logError("failed to load plugin", { path: load.spec, error })),
      Effect.catch(() => Effect.void),
    )
  }
})
