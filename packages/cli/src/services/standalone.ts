import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Deferred, Effect, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { randomBytes } from "node:crypto"
import { selfCommand } from "../util/process"

const Ready = Schema.Struct({ url: Schema.String })
const decodeReady = Schema.decodeUnknownPromise(Schema.fromJsonString(Ready))

type Options = {
  readonly command?: ReadonlyArray<string>
}

const startupDirectory = process.cwd()

// The readiness error embeds only the tail of what the child wrote.
const STDERR_TAIL = 8192

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
    // Always piped so the launcher can show the tail when the child dies before readiness.
    stderr: "pipe",
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
    // Drains finish on their own fibers, so the readiness failure waits on this to be sure the tail is complete.
    const stderrDone = yield* Deferred.make<void>()
    // Keep the bounded tail of stderr for the readiness failure below; a chatty child cannot grow it.
    let stderrTail = ""
    yield* proc.stderr.pipe(
      Stream.decodeText(),
      Stream.tap((chunk) =>
        Effect.sync(() => {
          stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL)
          if (process.env.OPENCODE_PRINT_LOGS === "1") process.stderr.write(chunk)
        }),
      ),
      Stream.runDrain,
      Effect.ignore,
      Effect.ensuring(Deferred.succeed(stderrDone, undefined)),
      Effect.forkScoped,
    )
    // Keep draining stdout after readiness so later server writes cannot hit EPIPE.
    yield* proc.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => Deferred.succeed(readyLine, line)),
      // stdout EOF means the child is gone; the stderr drain may still be pulling its last chunks, so
      // wait for it before deciding the tail is complete. The wait stays in the interruptible region:
      // an ensuring cannot await it on scope close, where finalizers run sequentially and the stderr
      // drain's own finalizer has not run yet.
      Effect.andThen(Deferred.await(stderrDone)),
      Effect.ensuring(
        Effect.gen(function* () {
          if (yield* Deferred.isDone(readyLine)) return
          yield* Deferred.fail(
            readyLine,
            stderrTail.trim() === ""
              ? new Error("Standalone server exited before reporting readiness")
              : new Error(
                  `Standalone server exited before reporting readiness. Last stderr output:\n${stderrTail.trimEnd()}`,
                ),
          )
        }),
      ),
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

export * as Standalone from "./standalone"
