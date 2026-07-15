import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { run } from "@opencode-ai/tui"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Config } from "../../config"
import { Context, Effect, FileSystem, Option } from "effect"
import { ServerConnection } from "../../services/server-connection"
import { Updater } from "../../services/updater"
import { UpdatePreflight } from "../../services/update-preflight"
import { Npm } from "@opencode-ai/core/npm"

export default Runtime.handler(Commands, (input) =>
  Effect.gen(function* () {
    const requestedDirectory = Option.getOrUndefined(input.directory)
    if (requestedDirectory !== undefined) process.chdir(requestedDirectory)
    const updater = yield* Updater.Service
    yield* updater.check().pipe(Effect.forkScoped)
    const preflight = UpdatePreflight.make()
    yield* Effect.addFinalizer(() => Effect.promise(() => preflight.close()))
    const server = yield* ServerConnection.resolve({
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
    const config = yield* Config.Service
    const npm = yield* Npm.Service
    const fileSystem = yield* FileSystem.FileSystem
    const runServicePromise = Effect.runPromiseWith(Context.make(FileSystem.FileSystem, fileSystem))
    const context = yield* Effect.context<FileSystem.FileSystem>()
    const runFork = Effect.runForkWith(context)
    const runPromise = Effect.runPromiseWith(context)
    const service = server.service
    yield* run({
      server: {
        endpoint: server.endpoint,
        service: service
          ? {
              reconnect: (onStatus, signal) => runServicePromise(service.reconnect(onStatus), { signal }),
              restart: () => runServicePromise(service.restart()),
            }
          : undefined,
      },
      args: { continue: input.continue, sessionID: Option.getOrUndefined(input.session) },
      config: {
        path: config.path,
        get: () => runPromise(config.get()),
        update: (update) => runPromise(config.update(update)),
      },
      packages: {
        resolve: (spec) =>
          runPromise(npm.add(spec, { subpaths: ["tui"] }).pipe(Effect.map((result) => result.entrypoint))),
      },
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
    }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
  }),
)
