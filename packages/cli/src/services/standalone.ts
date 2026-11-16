import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Deferred, Effect, Exit, Schema, Scope, Semaphore, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { randomBytes } from "node:crypto"
import { selfCommand } from "../util/process"

const Ready = Schema.Struct({ url: Schema.String })
const decodeReady = Schema.decodeUnknownPromise(Schema.fromJsonString(Ready))

type Options = {
  readonly command?: ReadonlyArray<string>
}

const startupDirectory = process.cwd()

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
  function* (options: Options) {
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
    const output = yield* Deferred.await(readyLine)
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

export const recoverable = Effect.fn("cli.standalone.recoverable")(function* (options: Options = {}) {
  const owner = yield* Effect.scope
  const lock = yield* Semaphore.make(1)
  let scope = yield* Scope.fork(owner)
  const launch = (child: Scope.Closeable) =>
    start(options).pipe(
      Scope.provide(child),
      Effect.onError((cause) => Scope.close(child, Exit.failCause(cause))),
    )
  let endpoint = yield* launch(scope)
  let lastLaunch = Date.now()
  const replace = Effect.gen(function* () {
    // A crashing child must not cause an unbounded restart loop.
    const delay = 1_000 - (Date.now() - lastLaunch)
    if (delay > 0) yield* Effect.sleep(delay)
    // A replacement must not overlap the old server: both use the same local data.
    yield* Scope.close(scope, Exit.void)
    scope = yield* Scope.fork(owner)
    endpoint = yield* launch(scope)
    lastLaunch = Date.now()
    return endpoint
  })
  const reconnect = () =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        // Stream disconnects also occur while the server is healthy (idle timeout, resync).
        const exited = yield* endpoint.exited.pipe(Effect.exit, Effect.timeoutOption("20 millis"))
        if (exited._tag === "None") return endpoint
        return yield* replace
      }),
    )
  return { endpoint, reconnect, restart: () => lock.withPermits(1)(replace.pipe(Effect.asVoid)) }
})

export * as Standalone from "./standalone"
