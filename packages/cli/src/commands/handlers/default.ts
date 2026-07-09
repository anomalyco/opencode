import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { run } from "@opencode-ai/tui"
import { loadBuiltinPlugins } from "@opencode-ai/tui/builtins"
import { TuiConfig } from "@opencode-ai/tui/config"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Effect, Option } from "effect"
import { Server } from "../../services/server"
import { Updater } from "../../services/updater"

export default Runtime.handler(Commands, (input) =>
  Effect.gen(function* () {
    const requestedDirectory = Option.getOrUndefined(input.directory)
    if (requestedDirectory !== undefined) process.chdir(requestedDirectory)
    const updater = yield* Updater.Service
    yield* updater.check().pipe(Effect.forkScoped)
    const server = yield* Server.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const config = TuiConfig.resolve({}, { terminalSuspend: false })
    let disposeSlots: (() => void) | undefined
    const runFork = Effect.runForkWith(yield* Effect.context())
    yield* run({
      server,
      args: { continue: input.continue, sessionID: Option.getOrUndefined(input.session) },
      config,
      log: (level, message, tags) => {
        const effect =
          level === "debug"
            ? Effect.logDebug(message, tags)
            : level === "warn"
              ? Effect.logWarning(message, tags)
              : level === "error"
                ? Effect.logError(message, tags)
                : Effect.logInfo(message, tags)
        runFork(effect)
      },
      pluginHost: {
        async start(pluginInput) {
          disposeSlots = await loadBuiltinPlugins(pluginInput.api, pluginInput.runtime)
        },
        async dispose() {
          disposeSlots?.()
        },
      },
    }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
  }),
)
