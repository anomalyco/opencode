import { ServerAuth } from "@opencode-ai/server/auth"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Effect, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { randomBytes } from "node:crypto"
import path from "node:path"

const Ready = Schema.Struct({ url: Schema.String })
const decodeReady = Schema.decodeUnknownPromise(Schema.fromJsonString(Ready))

function command(password: string) {
  const compiled = path.basename(process.execPath).replace(/\.exe$/, "") !== "bun"
  const entrypoint = compiled ? [] : process.argv[1] ? [process.argv[1]] : []
  if (!compiled && entrypoint.length === 0) throw new Error("Failed to resolve CLI entrypoint")
  return ChildProcess.make(process.execPath, [...entrypoint, "serve", "--stdio", "--port", "0"], {
    cwd: process.cwd(),
    env: { OPENCODE_SERVER_PASSWORD: password },
    extendEnv: true,
    // The server treats EOF on this pipe as the end of its ownership lease.
    // The OS closes it even when the TUI is killed before Effect finalizers run.
    stdin: "pipe",
    stderr: "ignore",
    killSignal: "SIGTERM",
    forceKillAfter: "3 seconds",
  })
}

export const transport = Effect.fn("cli.standalone.transport")(
  function* () {
    const password = randomBytes(32).toString("base64url")
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const proc = yield* spawner.spawn(command(password))
    const output = yield* proc.stdout.pipe(Stream.decodeText(), Stream.splitLines, Stream.take(1), Stream.mkString)
    if (!output) return yield* Effect.fail(new Error("Standalone server exited before reporting readiness"))
    const ready = yield* Effect.tryPromise(() => decodeReady(output))
    return { url: ready.url, headers: ServerAuth.headers({ password }), pid: proc.pid }
  },
  Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node)),
)

export * as Standalone from "./standalone"
