import { Effect, Sink, Stream } from "effect"
import { systemError } from "effect/PlatformError"
import type { Command, CommandInput, KillOptions } from "effect/unstable/process/ChildProcess"
import { ExitCode, make, makeHandle, ProcessId } from "effect/unstable/process/ChildProcessSpawner"
import type { Driver } from "@opencode-ai/core/environment"
import type { ModalClientParams, Sandbox, SandboxCreateParams } from "modal"

const WRAPPER = `
pidfile=$1
inner=$2
shift 2
exec setsid --wait sh -c "$inner" sh "$pidfile" "$@"
`

const INNER_WRAPPER = `
pidfile=$1
shift
printf "%s" "$$" > "$pidfile"
trap 'rm -f -- "$pidfile"' EXIT
"$@"
`

const KILL = `
i=0
while [ ! -s "$1" ] && [ "$i" -lt 250 ]; do sleep 0.02; i=$((i + 1)); done
if [ -s "$1" ]; then
  pid=$(cat "$1")
  /bin/kill "-$2" "-$pid" 2>/dev/null || true
else
  exit 47
fi
rm -f -- "$1"
`

export interface ModalImageSpec {
  readonly registry: string
  readonly dockerfileCommands: ReadonlyArray<string>
}

export interface ModalSandboxOptions {
  readonly app: string
  readonly client?: ModalClientParams
  readonly image?: ModalImageSpec
  readonly sandbox?: SandboxCreateParams
}

/**
 * Ubuntu supplies the GNU coreutils and findutils required by the derived Files
 * scripts. Busybox images do not satisfy the Environment contract.
 */
export const ubuntuImage: ModalImageSpec = {
  registry: "ubuntu:24.04",
  dockerfileCommands: [
    "RUN apt-get update && apt-get install -y --no-install-recommends git bash ripgrep ca-certificates coreutils findutils util-linux",
  ],
}

/** Creates a Modal sandbox lazily, keeping the SDK off the server startup path when Modal is unused. */
export const createModalSandbox = async (options: ModalSandboxOptions) => {
  const { ModalClient } = await import("modal")
  const client = new ModalClient(options.client)
  const app = await client.apps.fromName(options.app, { createIfMissing: true })
  const imageSpec = options.image ?? ubuntuImage
  const image = client.images.fromRegistry(imageSpec.registry).dockerfileCommands([...imageSpec.dockerfileCommands])
  const sandbox = await client.sandboxes.create(app, image, options.sandbox)
  return {
    driver: makeModalDriver(sandbox),
    sandbox,
    terminate: () => sandbox.terminate(),
  }
}

/**
 * Adapts Modal exec to the Environment driver. Files intentionally has no native
 * overrides: Modal exec and filesystem tools share the same roughly 175ms floor,
 * so the derived exec defaults are the simplest implementation with no measured loss.
 *
 * Modal cannot signal a ContainerProcess. Each command therefore starts a new
 * process group and records its leader in a unique pid file; kill runs a second
 * sandbox command that signals that group. Pid files are removed best-effort.
 */
export const makeModalDriver = (sandbox: Sandbox): Driver => {
  const spawn = Effect.fnUntraced(function* (command: Command) {
    if (command._tag === "PipedCommand") {
      return yield* Effect.fail(spawnError("spawn", "piped commands unsupported"))
    }
    if (command.options.additionalFds) {
      return yield* Effect.fail(spawnError("spawn", "additional file descriptors unsupported"))
    }

    const pidFile = `/tmp/opencode-process-${crypto.randomUUID()}.pid`
    const env = compact(command.options.env)
    const isolatedEnv =
      command.options.extendEnv === false || (!command.options.extendEnv && command.options.env !== undefined)
    const argv = isolatedEnv ? ["env", "-i", ...environment(env)] : []
    const process = yield* Effect.tryPromise({
      try: () =>
        sandbox.exec(["sh", "-c", WRAPPER, "sh", pidFile, INNER_WRAPPER, ...argv, command.command, ...command.args], {
          mode: "binary",
          stdout: "pipe",
          stderr: "pipe",
          workdir: command.options.cwd,
          env: isolatedEnv ? undefined : env,
        }),
      catch: (cause) => spawnError("spawn", undefined, cause),
    })

    const onError = (cause: unknown) => spawnError("process", undefined, cause)
    let exited = false
    let stdinClosed = false
    const writer = process.stdin.getWriter()
    const waited = process.wait().then((code) => {
      exited = true
      if (!stdinClosed) writer.releaseLock()
      return code
    })
    const kill = (options?: KillOptions) =>
      Effect.tryPromise({
        try: async () => {
          const killer = await sandbox.exec(["sh", "-c", KILL, "sh", pidFile, options?.killSignal ?? "SIGTERM"], {
            stdout: "pipe",
            stderr: "pipe",
          })
          const code = await killer.wait()
          if (code !== 0) throw new Error(`modal kill exited ${code}`)
        },
        catch: onError,
      })

    yield* Effect.addFinalizer(() => (exited ? Effect.void : kill().pipe(Effect.ignore)))

    const closeStdin = Effect.tryPromise({
      try: async () => {
        await writer.close()
        stdinClosed = true
        writer.releaseLock()
      },
      catch: onError,
    })
    const stdin = Sink.forEach((chunk: Uint8Array) =>
      Effect.tryPromise({ try: () => writer.write(chunk), catch: onError }),
    ).pipe(Sink.ensuring(closeStdin))
    const input = commandInput(command.options.stdin)
    if (input === "ignore") {
      yield* closeStdin
    }
    if (Stream.isStream(input)) {
      yield* Effect.forkScoped(Stream.run(input, stdin))
    }

    const stdout = Stream.fromReadableStream({ evaluate: () => process.stdout, onError })
    const stderr = Stream.fromReadableStream({ evaluate: () => process.stderr, onError })
    return makeHandle({
      pid: ProcessId(crypto.getRandomValues(new Uint32Array(1))[0]),
      exitCode: Effect.tryPromise({ try: () => waited, catch: onError }).pipe(Effect.map(ExitCode)),
      isRunning: Effect.sync(() => !exited),
      kill,
      stdin,
      stdout,
      stderr,
      all: Stream.merge(stdout, stderr),
      getInputFd: () => Sink.fail(spawnError("getInputFd", "unsupported")),
      getOutputFd: () => Stream.fail(spawnError("getOutputFd", "unsupported")),
      unref: Effect.succeed(Effect.void),
    })
  })

  return { spawner: make(spawn) }
}

const commandInput = (input: CommandInput | { readonly stream: CommandInput } | undefined) =>
  input !== undefined && typeof input === "object" && !Stream.isStream(input) ? input.stream : input

const compact = (env: Record<string, string | undefined> | undefined) => {
  if (!env) return undefined
  return Object.fromEntries(Object.entries(env).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])))
}

const environment = (env: Record<string, string> | undefined) =>
  Object.entries(env ?? {}).map(([key, value]) => `${key}=${value}`)

const spawnError = (method: string, description?: string, cause?: unknown) =>
  systemError({ _tag: "Unknown", module: "ModalDriver", method, description, cause })

export * as ModalDriver from "./modal"
