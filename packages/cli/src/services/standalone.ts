import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Clock, Deferred, Effect, Exit, Schema, Scope, Semaphore, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { randomBytes } from "node:crypto"
import { selfCommand } from "../util/process"

const Ready = Schema.Struct({ url: Schema.String })
const decodeReady = Schema.decodeUnknownPromise(Schema.fromJsonString(Ready))

type Options = {
  readonly command?: ReadonlyArray<string>
  readonly automaticTimeout?: number
  readonly retryBaseDelay?: number
}

const startupDirectory = process.cwd()
const stableAfter = 30_000
const maxRestartDelay = 30_000
// Give a replacement the same cold-start budget as the managed service's 120 second ensure deadline.
const replacementTimeout = 120_000

/** @internal */
export function restartDelay(failures: number, base = 1_000) {
  return failures === 0 ? 0 : Math.min(base * 2 ** (failures - 1), maxRestartDelay)
}

function command(password: string, options: Options) {
  const [executable, ...args] = options.command ?? [...selfCommand(), "serve"]
  if (!executable) throw new Error("Failed to resolve standalone server command")
  return ChildProcess.make(executable, [...args, "--stdio", "--port", "0"], {
    cwd: startupDirectory,
    // Explicit entry wins over anything inherited, so a user-exported
    // OPENCODE_PASSWORD cannot shadow the child's lease credential.
    env: { OPENCODE_PASSWORD: password },
    extendEnv: true,
    // The server treats EOF on this pipe as the end of its ownership lease.
    // The OS closes it even when the TUI is killed before Effect finalizers run.
    stdin: "pipe",
    stderr: process.env.OPENCODE_PRINT_LOGS === "1" ? "inherit" : "ignore",
    killSignal: "SIGTERM",
    forceKillAfter: "3 seconds",
  })
}

const makeEndpoint = Effect.fn("cli.standalone.endpoint")(
  function* (options: Options, timeout?: number) {
    const password = randomBytes(32).toString("base64url")
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const proc = yield* spawner.spawn(command(password, options))
    const readyLine = yield* Deferred.make<string, Error>()
    // Keep draining stdout after readiness so later server writes cannot hit EPIPE.
    yield* proc.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => Deferred.succeed(readyLine, line)),
      Effect.ensuring(Deferred.fail(readyLine, new Error("Standalone server exited before reporting readiness"))),
      Effect.forkScoped,
    )
    // Keep first-start behavior for ACP and private commands; bound replacements that hold reconnect.
    const output = yield* timeout === undefined
      ? Deferred.await(readyLine)
      : Deferred.await(readyLine).pipe(Effect.timeout(timeout))
    const ready = yield* Effect.tryPromise(() => decodeReady(output))
    return {
      url: ready.url,
      auth: { type: "basic" as const, username: "opencode", password },
      pid: proc.pid,
      exited: proc.exitCode,
    }
  },
  Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)),
)

export function start(options: Options = {}) {
  return makeEndpoint(options)
}

export const connect = Effect.fn("cli.standalone.connect")(function* (options: Options = {}) {
  const owner = yield* Effect.scope
  const gate = yield* Semaphore.make(1)
  let changed = yield* Deferred.make<void>()
  const spawn = Effect.fnUntraced(function* (reason?: "automatic" | "manual") {
    const scope = Scope.forkUnsafe(owner)
    return yield* Effect.gen(function* () {
      const endpoint = yield* makeEndpoint(
        options,
        reason === "automatic"
          ? (options.automaticTimeout ?? replacementTimeout)
          : reason === "manual"
            ? replacementTimeout
            : undefined,
      ).pipe(Effect.provideService(Scope.Scope, scope))
      const started = yield* Clock.currentTimeMillis
      // Signal death is an observed exit, not a failure of the watcher fiber.
      const exited = yield* endpoint.exited.pipe(
        Effect.exit,
        Effect.flatMap(() => Clock.currentTimeMillis),
        Effect.forkIn(scope, { startImmediately: true }),
      )
      return { scope, endpoint, exited, started }
    }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)))
  })
  let current = yield* spawn()
  let failures = 0
  let observed: typeof current | undefined
  let retryAt = 0

  const replace = Effect.fnUntraced(function* (reason: "automatic" | "manual") {
    yield* Effect.logInfo("standalone server restarting", { reason, pid: current.endpoint.pid })
    yield* Scope.close(current.scope, Exit.void)
    current = yield* spawn(reason).pipe(
      Effect.tapError((error) => Effect.logWarning("standalone server restart failed", { reason, error })),
    )
    const previous = changed
    changed = yield* Deferred.make<void>()
    yield* Deferred.succeed(previous, undefined)
    yield* Effect.logInfo("standalone server restarted", { reason, pid: current.endpoint.pid })
    return current.endpoint
  })

  return {
    endpoint: current.endpoint,
    reconnect: () =>
      Effect.gen(function* () {
        while (true) {
          const pending = yield* gate.withPermits(1)(
            Effect.gen(function* () {
              const exit = current.exited.pollUnsafe()
              if (!exit) return { kind: "ready" as const, endpoint: current.endpoint }
              if (observed !== current) {
                observed = current
                const exitedAt = Exit.isSuccess(exit) ? exit.value : yield* Clock.currentTimeMillis
                failures = exitedAt - current.started < stableAfter ? failures + 1 : 0
                retryAt = exitedAt + restartDelay(failures, options.retryBaseDelay)
                yield* Scope.close(current.scope, Exit.void)
              }
              return {
                kind: "pending" as const,
                target: current,
                delay: Math.max(0, retryAt - (yield* Clock.currentTimeMillis)),
                changed,
              }
            }),
          )
          if (pending.kind === "ready") return pending.endpoint
          if (pending.delay > 0) yield* Effect.race(Effect.sleep(pending.delay), Deferred.await(pending.changed))
          const result = yield* gate.withPermits(1)(
            Effect.gen(function* () {
              if (current !== pending.target) return { kind: "ready" as const, endpoint: current.endpoint }
              if ((yield* Clock.currentTimeMillis) < retryAt) return { kind: "retry" as const }
              return {
                kind: "ready" as const,
                endpoint: yield* replace("automatic").pipe(
                  Effect.tapError(() =>
                    Effect.gen(function* () {
                      failures++
                      retryAt = (yield* Clock.currentTimeMillis) + restartDelay(failures, options.retryBaseDelay)
                    }),
                  ),
                ),
              }
            }),
          )
          if (result.kind === "ready") return result.endpoint
        }
      }),
    restart: () => {
      const target = current
      return gate.withPermits(1)(
        Effect.gen(function* () {
          // A live intervening replacement already satisfies this request.
          if (current !== target && !current.exited.pollUnsafe()) return
          failures = 0
          observed = undefined
          retryAt = 0
          yield* replace("manual")
        }),
      )
    },
  }
})

export * as Standalone from "./standalone"
