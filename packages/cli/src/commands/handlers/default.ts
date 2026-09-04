import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/util/cross-spawn-spawner"
import { Global } from "@opencode-ai/util/global"
import { run } from "@opencode-ai/tui"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Config } from "../../config"
import { Context, Effect, Fiber, FileSystem, Option, Queue } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { ServerConnection } from "../../services/server-connection"
import { Updater } from "../../services/updater"
import { UpdatePreflight } from "../../services/update-preflight"
import { Npm } from "@opencode-ai/util/npm"
import { OPENCODE_ARTIFACT, OPENCODE_CHANNEL, OPENCODE_LOCAL, OPENCODE_VERSION } from "../../version"
import { Env } from "../../env"
import { selfCommand } from "../../util/process"

export default Runtime.handler(Commands, (input) =>
  Effect.gen(function* () {
    const requestedDirectory = Option.getOrUndefined(input.directory)
    const requestedServer = Option.getOrUndefined(input.server)
    if (requestedDirectory !== undefined) process.chdir(requestedDirectory)
    const preflight = UpdatePreflight.make()
    yield* Effect.addFinalizer(() => Effect.promise(() => preflight.close()))
    const serviceStarts = yield* Queue.unbounded<{
      readonly reason: "missing" | "version-mismatch"
      readonly previousVersion?: string
    }>()
    yield* Queue.take(serviceStarts).pipe(
      Effect.flatMap((event) => Effect.logInfo("background service starting", event)),
      Effect.forever,
      Effect.forkScoped,
    )
    const server = yield* ServerConnection.resolve({
      server: requestedServer,
      standalone: input.standalone,
      mismatch: "replace",
      onStart: (reason, previousVersion) => {
        Queue.offerUnsafe(serviceStarts, { reason, previousVersion })
        if (reason === "version-mismatch" && preflight.begin(previousVersion)) return
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
    const updater = yield* Updater.Service
    const update = yield* updater.check().pipe(Effect.forkScoped)
    preflight.loading()
    const config = yield* Config.Service
    const npm = yield* Npm.Service
    const fileSystem = yield* FileSystem.FileSystem
    const runServicePromise = Effect.runPromiseWith(Context.make(FileSystem.FileSystem, fileSystem))
    const context = yield* Effect.context<FileSystem.FileSystem>()
    const runFork = Effect.runForkWith(context)
    const runPromise = Effect.runPromiseWith(context)
    const service = server.service
    return yield* run({
      app: {
        name: process.env.OPENCODE_CLIENT ?? OPENCODE_ARTIFACT,
        version: OPENCODE_VERSION,
        channel: process.env.OPENCODE_TUI_CHANNEL ?? OPENCODE_CHANNEL,
      },
      server: {
        endpoint: server.endpoint,
        service: service
          ? {
              reconnect: (signal) => runServicePromise(service.reconnect(), { signal }),
              restart: () => runServicePromise(service.restart()),
            }
          : undefined,
      },
      args: {
        continue: input.continue,
        sessionID: Option.getOrUndefined(input.session),
        prompt: Option.getOrUndefined(input.prompt),
        auto: input.auto || input.yolo || input.dangerouslySkipPermissions,
      },
      config: {
        path: config.path,
        get: () => runPromise(config.get()),
        update: (update) => runPromise(config.update(update)),
      },
      updater: {
        remote: requestedServer !== undefined,
        subscribe: (notify, signal) =>
          runPromise(
            Fiber.join(update).pipe(
              Effect.flatMap((result) => (result === undefined ? Effect.void : Effect.sync(() => notify(result)))),
            ),
            { signal },
          ),
        check: (signal) => runPromise(Fiber.join(update).pipe(Effect.flatMap(() => updater.checkManual())), { signal }),
        apply: (version) => runPromise(updater.apply(version)),
      },
      packages: {
        prepare: (spec, install = true) => runPromise(install ? npm.add(spec) : npm.resolve(spec)),
      },
      environment: requestedServer === undefined ? Env.session() : undefined,
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
    }).pipe(Effect.provide(LayerNode.compile(Global.node)))
  }).pipe(
    Effect.scoped,
    Effect.flatMap((restart) => {
      if (!restart) return Effect.void
      return Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        // Resolve the updated launcher, not the old binary in a package manager's cache.
        const command = OPENCODE_LOCAL ? selfCommand() : [Commands.name]
        const server = Option.getOrUndefined(input.server)
        // Relaunch only after the old TUI and standalone server have shut down.
        // Resume the current session without replaying the initial prompt.
        const child = yield* spawner.spawn(
          ChildProcess.make(
            command[0],
            [
              ...command.slice(1),
              ...(server !== undefined ? ["--server", server] : []),
              ...(input.standalone ? ["--standalone"] : []),
              ...(restart.sessionID ? ["--session", restart.sessionID] : []),
              ...(input.auto || input.yolo || input.dangerouslySkipPermissions ? ["--auto"] : []),
            ],
            { stdin: "inherit", stdout: "inherit", stderr: "inherit", detached: false },
          ),
        )
        process.exitCode = yield* child.exitCode
      }).pipe(Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)), Effect.scoped)
    }),
  ),
)
