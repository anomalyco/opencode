import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { run } from "@opencode/tui"
import { Config } from "../../config"
import { Context, Effect, FileSystem, Schedule, Semaphore } from "effect"
import { Updater } from "../../services/updater"
import { UpdatePreflight } from "../../services/update-preflight"
type PreflightHandle = ReturnType<typeof UpdatePreflight.make>
import { Npm } from "@opencode/util/npm"
import { OPENCODE_ARTIFACT, OPENCODE_CHANNEL, OPENCODE_HIGHLIGHTS, OPENCODE_VERSION } from "../../version"
import { Service } from "@opencode/client/effect/service"
import { OpenCode } from "@opencode/client/promise"
import { findSession } from "../../session-target"
import { errorMessage } from "../../util/error"
import type { Resolved } from "../../services/server-connection"

// The TUI launch shared by every entry into the interactive UI.
//
// The only difference between the default command and `singleton` is how the
// server is resolved (background service vs standalone vs in-process host);
// everything after resolution is identical, so it lives here exactly once.
export const launch = Effect.fn("cli.launch-tui.launch")(function* (input: {
  readonly server: Resolved
  readonly preflight: PreflightHandle
  readonly requestedDirectory?: string
  readonly session?: string
  readonly continue?: boolean
  readonly prompt?: string
  readonly auto?: boolean
  readonly environment?: Readonly<Record<string, string>>
}) {
  const requestedDirectory = input.requestedDirectory
  if (requestedDirectory !== undefined) process.chdir(requestedDirectory)
  const preflight = input.preflight

  const session = input.session
  // A missing --session ID becomes the ID of the session the first prompt creates.
  const sessionExists =
    session !== undefined &&
    (yield* Effect.tryPromise({
      try: () =>
        findSession(
          OpenCode.make({
            baseUrl: input.server.endpoint.url,
            headers: Service.headers(input.server.endpoint),
            fetch: input.server.fetch,
          }),
          session,
        ),
      catch: (cause) => new Error(errorMessage(cause)),
    })) !== undefined

  const updater = yield* Updater.Service
  let installing: string | undefined
  let latest: Updater.RunResult | undefined
  const installListeners = new Set<(version: string) => void>()
  const resultListeners = new Set<(result: Updater.RunResult) => void>()
  // Background checks, `/update` lookups, and manual installs take turns so two installs never overlap.
  const checking = yield* Semaphore.make(1)
  yield* updater
    .run((version) => {
      installing = version
      installListeners.forEach((notify) => notify(version))
    })
    .pipe(
      Effect.ensuring(Effect.sync(() => (installing = undefined))),
      Effect.tap((result) =>
        Effect.sync(() => {
          if (!result) return
          resultListeners.forEach((notify) => notify(result))
          if (result.type === latest?.type && result.version === latest?.version) return
          latest = result
          installListeners.forEach((notify) => notify(result.version))
        }),
      ),
      checking.withPermits(1),
      Effect.repeat(Schedule.spaced("10 minutes")),
      Effect.forkScoped({ startImmediately: true }),
    )
  preflight.loading()

  const config = yield* Config.Service
  const npm = yield* Npm.Service
  const fileSystem = yield* FileSystem.FileSystem
  const runServicePromise = Effect.runPromiseWith(Context.make(FileSystem.FileSystem, fileSystem))
  const context = yield* Effect.context<FileSystem.FileSystem>()
  const runFork = Effect.runForkWith(context)
  const runPromise = Effect.runPromiseWith(context)

  const service = input.server.service
  yield* run({
    app: {
      name: process.env.OPENCODE_CLIENT ?? OPENCODE_ARTIFACT,
      version: OPENCODE_VERSION,
      channel: process.env.OPENCODE_TUI_CHANNEL ?? OPENCODE_CHANNEL,
      highlights: OPENCODE_HIGHLIGHTS,
    },
    server: {
      endpoint: input.server.endpoint,
      // Managed and standalone servers run here; an explicit --server may be on another machine.
      local: true,
      fetch: input.server.fetch,
      service: service
        ? {
            reconnect: (signal) => runServicePromise(service.reconnect(), { signal }),
            restart: () => runServicePromise(service.restart()),
          }
        : undefined,
    },
    args: {
      continue: input.continue,
      sessionID: sessionExists ? session : undefined,
      newSessionID: sessionExists ? undefined : session,
      prompt: input.prompt,
      auto: input.auto,
    },
    config: {
      path: config.path,
      get: () => runPromise(config.get()),
      update: (update) => runPromise(config.update(update)),
    },
    updater: {
      remote: false,
      subscribe: (notify) => {
        if (latest) notify(latest)
        resultListeners.add(notify)
        return () => resultListeners.delete(notify)
      },
      check: (signal, notify) => {
        if (installing) notify(installing)
        installListeners.add(notify)
        return runPromise(checking.withPermits(1)(updater.check())).finally(() =>
          installListeners.delete(notify),
        )
      },
      apply: (version) => runPromise(checking.withPermits(1)(updater.apply(version))),
    },
    packages: {
      prepare: (spec, install = true) => runPromise(install ? npm.add(spec) : npm.resolve(spec)),
    },
    environment: input.environment,
    terminalHandoff: () => input.preflight.finish(),
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
})
