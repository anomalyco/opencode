import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Deferred, Effect, Fiber, Schema, Stream } from "effect"
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
    // Drain continuously, retain only a bounded tail, and surface it on failed boot.
    // Readiness failures used to discard the only copy of the server's error.
    let diagnostics = ""
    const stderr = yield* proc.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Effect.sync(() => {
          diagnostics = (diagnostics + chunk).slice(-16_384)
          if (process.env.OPENCODE_PRINT_LOGS === "1") process.stderr.write(chunk)
        }),
      ),
      Effect.forkScoped,
    )
    // Keep draining stdout after readiness so later server writes cannot hit EPIPE.
    const stdout = yield* proc.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => Deferred.succeed(readyLine, line)),
      Effect.forkScoped,
    )
    yield* Effect.gen(function* () {
      const code = yield* proc.exitCode.pipe(Effect.catch(() => Effect.succeed(undefined)))
      yield* Fiber.join(stdout).pipe(Effect.ignore)
      yield* Fiber.join(stderr).pipe(Effect.ignore)
      yield* Deferred.fail(
        readyLine,
        new Error(
          `Standalone server exited before reporting readiness${code === undefined ? "" : ` (exit ${code})`}${diagnostics.trim() ? `\n${diagnostics.trim()}` : ""}`,
        ),
      )
    }).pipe(Effect.forkScoped)
    const output = yield* Deferred.await(readyLine).pipe(
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () =>
          Effect.fail(
            new Error(
              `Standalone server did not report readiness within 30 seconds${diagnostics.trim() ? `\n${diagnostics.trim()}` : ""}`,
            ),
          ),
      }),
    )
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
