import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { run } from "@opencode-ai/tui"
import { loadBuiltinPlugins } from "@opencode-ai/tui/builtins"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { TuiConfig } from "../../tui-config"
import { Effect, Option } from "effect"
import { Server } from "../../services/server"
import { Updater } from "../../services/updater"
import { UpdatePreflight } from "../../services/update-preflight"

export default Runtime.handler(Commands, (input) =>
  Effect.gen(function* () {
    const requestedDirectory = Option.getOrUndefined(input.directory)
    if (requestedDirectory !== undefined) process.chdir(requestedDirectory)
    const updater = yield* Updater.Service
    yield* updater.check().pipe(Effect.forkScoped)
    const preflight = UpdatePreflight.make()
    yield* Effect.addFinalizer(() => Effect.promise(() => preflight.close()))
    const server = yield* Server.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
      onStart: (reason, existing) => {
        if (reason === "version-mismatch" && preflight.begin(existing?.version)) return
        process.stderr.write(
          reason === "version-mismatch"
            ? "Restarting background server (version mismatch)...\n"
            : "Starting background server...\n",
        )
      },
    }).pipe(
      Effect.tapError(() =>
        Effect.promise(() => preflight.fail("OpenCode update could not start the new background service")),
      ),
    )
    preflight.loading()
    const config = yield* TuiConfig.load()
    let disposeSlots: (() => void) | undefined
    const runFork = Effect.runForkWith(yield* Effect.context())
    yield* run({
      server,
      args: { continue: input.continue, sessionID: Option.getOrUndefined(input.session) },
      config,
      terminalHandoff: () => preflight.finish(),
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
