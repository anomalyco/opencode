import { Effect, Sink, Stream } from "effect"
import { systemError } from "effect/PlatformError"
import type { Command, KillOptions } from "effect/unstable/process/ChildProcess"
import { ExitCode, make, makeHandle, ProcessId } from "effect/unstable/process/ChildProcessSpawner"
import type { Driver } from "@opencode-ai/core/environment"
import type { App, Image, ModalClient, ModalClientParams, Sandbox, SandboxCreateParams } from "modal"

const INNER_WRAPPER = `
pidfile=$1
shift
printf "%s" "$$" > "$pidfile"
trap 'rm -f -- "$pidfile"' EXIT
"$@"
`

// Modal's VM runtime accepts process-group signals without delivering them
// (kill(-pgid) returns 0 and nothing dies; direct-pid signals work), so the
// group is enumerated from /proc and each member is signalled directly. The
// second pass catches children forked between scan and signal.
const KILL = `
pidfile=$1
sig=$2
i=0
while [ ! -s "$pidfile" ] && [ "$i" -lt 250 ]; do sleep 0.02; i=$((i + 1)); done
[ -s "$pidfile" ] || exit 47
target=$(cat "$pidfile")
pass=0
while [ "$pass" -lt 2 ]; do
  for stat in /proc/[0-9]*/stat; do
    [ -e "$stat" ] || continue
    pid=\${stat#/proc/}
    pid=\${pid%/stat}
    set -- $(sed "s/.*) //" "$stat" 2>/dev/null)
    if [ "\${3:-}" = "$target" ]; then
      /bin/kill "-$sig" "$pid" 2>/dev/null || true
    fi
  done
  pass=$((pass + 1))
done
`

export interface ModalImageSpec {
  readonly registry: string
  readonly dockerfileCommands: ReadonlyArray<string>
}

export interface ModalSandboxCreateOptions {
  readonly image?: ModalImageSpec
  readonly sandbox?: SandboxCreateParams
}

export interface ModalSandboxOptions extends ModalSandboxCreateOptions {
  readonly app: string
  readonly client?: ModalClientParams
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
  const client = await openModalClient(options.client)
  const app = await client.apps.fromName(options.app, { createIfMissing: true })
  const sandbox = await createModalSandboxWithClient(client, app, {
    image: options.image,
    sandbox: options.sandbox,
  })
  return {
    driver: makeModalDriver(sandbox),
    sandbox,
    terminate: () => sandbox.terminate(),
  }
}

export const openModalClient = async (params?: ModalClientParams) => {
  const { ModalClient } = await import("modal")
  return new ModalClient(params)
}

export const createModalSandboxWithClient = async (
  client: ModalClient,
  app: App,
  options: ModalSandboxCreateOptions,
  existingImage?: Image,
) => {
  const imageSpec = options.image ?? ubuntuImage
  const image =
    existingImage ??
    client.images.fromRegistry(imageSpec.registry).dockerfileCommands([...imageSpec.dockerfileCommands])
  // Always Modal's Full-VM runtime (beta, enabled per account): a real kernel
  // with real device nodes, so workspaces can run Docker and other
  // kernel-dependent workloads. Costs versus gVisor, measured Aug 2026:
  // per-exec floor ~285-535ms versus ~90-165ms, and filesystem snapshots only
  // (no memory snapshots — acceptable; fs-snapshot is the persistence design).
  return client.sandboxes.create(app, image, {
    ...options.sandbox,
    experimentalOptions: { ...options.sandbox?.experimentalOptions, vm_runtime: true },
  })
}

/**
 * Adapts Modal exec to the Environment driver. Files intentionally has no native
 * overrides: exec latency dominates payload work (VM runtime floor measured
 * ~285-535ms per exec, Aug 2026), so the derived exec defaults are the simplest
 * implementation with no measured loss.
 *
 * Modal cannot signal a ContainerProcess. Each command therefore starts a new
 * process group and records its leader in a unique pid file; kill runs a second
 * sandbox command that enumerates that group from /proc and signals each member
 * directly (see KILL). Pid files are removed best-effort.
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
    const argv = isolatedEnv ? ["env", "-i", ...Object.entries(env ?? {}).map(([key, value]) => `${key}=${value}`)] : []
    const process = yield* Effect.tryPromise({
      try: () =>
        sandbox.exec(
          ["setsid", "--wait", "sh", "-c", INNER_WRAPPER, "sh", pidFile, ...argv, command.command, ...command.args],
          {
            mode: "binary",
            stdout: "pipe",
            stderr: "pipe",
            workdir: command.options.cwd,
            env: isolatedEnv ? undefined : env,
          },
        ),
      catch: (cause) => spawnError("spawn", undefined, cause),
    })

    const onError = (cause: unknown) => spawnError("process", undefined, cause)
    let exited = false
    const writer = process.stdin.getWriter()
    let closingStdin: Promise<void> | undefined
    const waited = process.wait().then((code) => {
      exited = true
      if (!closingStdin) writer.releaseLock()
      return code
    })
    const exitCode = Effect.tryPromise({ try: () => waited, catch: onError }).pipe(Effect.map(ExitCode))
    const kill = (options?: KillOptions) => {
      if (exited) return Effect.void
      return Effect.tryPromise({
        try: async () => {
          const killer = await sandbox.exec(["sh", "-c", KILL, "sh", pidFile, options?.killSignal ?? "SIGTERM"], {
            stdout: "pipe",
            stderr: "pipe",
          })
          const code = await killer.wait()
          if (code !== 0) throw new Error(`modal kill exited ${code}`)
        },
        catch: onError,
      }).pipe(Effect.andThen(exitCode), Effect.asVoid)
    }

    yield* Effect.addFinalizer(() => kill(command.options).pipe(Effect.ignore))

    const closeStdin = Effect.tryPromise({
      try: () => (closingStdin ??= writer.close().finally(() => writer.releaseLock())),
      catch: onError,
    })
    const writeStdin = Sink.forEach((chunk: Uint8Array) =>
      Effect.tryPromise({ try: () => writer.write(chunk), catch: onError }),
    )
    const inputConfig = command.options.stdin
    const inputOptions =
      inputConfig !== undefined && typeof inputConfig === "object" && !Stream.isStream(inputConfig)
        ? inputConfig
        : undefined
    const input = inputOptions?.stream ?? inputConfig
    const stdin = inputOptions?.endOnDone === false ? writeStdin : writeStdin.pipe(Sink.ensuring(closeStdin))
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
      exitCode,
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

const compact = (env: Record<string, string | undefined> | undefined) => {
  if (!env) return undefined
  return Object.fromEntries(Object.entries(env).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])))
}

const spawnError = (method: string, description?: string, cause?: unknown) =>
  systemError({ _tag: "Unknown", module: "ModalDriver", method, description, cause })

export * as ModalDriver from "./modal"
