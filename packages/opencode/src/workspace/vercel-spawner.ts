// Vercel-backed ChildProcessSpawner. Satisfies the Effect
// ChildProcessSpawner contract by routing spawn() calls through
// Workspace.Primitives.execStream, which in turn hits VercelBackend's
// in-sandbox exec gateway. Consumers (bash tool, Git.Service,
// Format.Service, Snapshot.Service, Ripgrep.Service) keep yielding
// ChildProcessSpawner unchanged; when OPENCODE_WORKSPACE_BACKEND is
// "vercel", cross-spawn-spawner's defaultLayer wires this impl instead
// of the local cross-spawn one.

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import * as PlatformError from "effect/PlatformError"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import {
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId,
  type ChildProcessHandle,
} from "effect/unstable/process/ChildProcessSpawner"
import { Workspace } from "./index"

const toPlatformError =
  (method: string, command: ChildProcess.Command) =>
  (cause: unknown): PlatformError.PlatformError => {
    const label = flattenForLabel(command)
    return PlatformError.systemError({
      _tag: "Unknown",
      module: "ChildProcess",
      method,
      pathOrDescriptor: label,
      cause: cause instanceof Error ? cause : new Error(String(cause)),
    })
  }

// Flatten Command tree to a label + a single StandardCommand. Pipelines
// aren't expressible through ws.execStream (it takes one cmd/args), so
// we reject PipedCommand with a descriptive error.
const flatten = (command: ChildProcess.Command): ChildProcess.StandardCommand => {
  if (command._tag === "StandardCommand") return command
  throw new Error(
    "VercelChildProcessSpawner: piped commands are not supported over the sandbox exec gateway",
  )
}

const flattenForLabel = (command: ChildProcess.Command): string => {
  const walk = (cmd: ChildProcess.Command): string => {
    if (cmd._tag === "StandardCommand") return `${cmd.command} ${cmd.args.join(" ")}`
    return `${walk(cmd.left)} | ${walk(cmd.right)}`
  }
  return walk(command)
}

const resolveEnv = (opts: ChildProcess.CommandOptions): Record<string, string> | undefined => {
  if (opts.env === undefined && !opts.extendEnv) return undefined
  const base: Record<string, string> = {}
  if (opts.extendEnv) {
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) base[k] = v
  }
  if (opts.env) for (const [k, v] of Object.entries(opts.env)) if (v !== undefined) base[k] = v
  return base
}

const SANDBOX_SHELL_ALLOWLIST: ReadonlySet<string> = new Set(["/bin/bash", "/bin/sh"])
const remapShellForSandbox = (shell: string): string =>
  SANDBOX_SHELL_ALLOWLIST.has(shell) ? shell : "/bin/bash"

const resolveStdin = (
  opts: ChildProcess.CommandOptions,
): Uint8Array | string | undefined => {
  const s = opts.stdin
  if (s === undefined || s === "pipe" || s === "ignore" || s === "inherit") return undefined
  if (typeof s === "string") return undefined
  // Stream / StdinConfig stdin is driven via the returned Sink; we
  // only pass eager initial bytes when callers literally handed a
  // buffer. Not common for opencode's call sites.
  return undefined
}

export namespace VercelChildProcessSpawner {
  export const layer: Layer.Layer<
    ChildProcessSpawner,
    never,
    Workspace.Primitives.Service
  > = Layer.effect(
    ChildProcessSpawner,
    Effect.gen(function* () {
      const ws = yield* Workspace.Primitives.Service

      return makeSpawner((command) =>
        Effect.gen(function* () {
          const std = flatten(command)
          const envObj = resolveEnv(std.options)
          const cwd = typeof std.options.cwd === "string" ? std.options.cwd : undefined
          const stdinData = resolveStdin(std.options)

          // When the caller sets `shell`, Node's ChildProcess invokes
          // `{shell} -c "{command}"`. The sandbox image is Linux with
          // /bin/bash + /bin/sh only; if the host's shell (/bin/zsh on
          // darwin) doesn't exist in-sandbox the spawn would fail with
          // "no such file". Remap host-specific shells to /bin/bash,
          // which the sandbox image always has.
          const shellOpt = std.options.shell
          const shellPath =
            shellOpt === true
              ? "/bin/bash"
              : typeof shellOpt === "string"
                ? remapShellForSandbox(shellOpt)
                : undefined
          const spawnCmd = shellPath ?? std.command
          const spawnArgs = shellPath
            ? ["-c", [std.command, ...std.args].join(" ")]
            : [...std.args]

          const handle = yield* ws
            .execStream(spawnCmd, spawnArgs, {
              cwd,
              env: envObj,
              stdin: stdinData,
            })
            .pipe(Effect.mapError(toPlatformError("spawn", command)))

          const mapStreamErr = <A>(s: Stream.Stream<A, any>): Stream.Stream<A, PlatformError.PlatformError> =>
            s.pipe(Stream.mapError(toPlatformError("stdio", command))) as Stream.Stream<A, PlatformError.PlatformError>
          const mapSinkErr = (
            sk: Sink.Sink<void, Uint8Array, never, any>,
          ): Sink.Sink<void, Uint8Array, never, PlatformError.PlatformError> =>
            sk.pipe(Sink.mapError(toPlatformError("stdin", command)))

          const exit: ChildProcessHandle["exitCode"] = handle.exitCode.pipe(
            Effect.map((code) => ExitCode(code ?? -1)),
            Effect.mapError(toPlatformError("exitCode", command)),
          )

          const kill: ChildProcessHandle["kill"] = (_opts) =>
            handle.kill.pipe(Effect.mapError(toPlatformError("kill", command)))

          const result = makeHandle({
            pid: ProcessId(0),
            exitCode: exit,
            isRunning: Effect.succeed(false).pipe(
              Effect.mapError(toPlatformError("isRunning", command)),
            ) as ChildProcessHandle["isRunning"],
            kill,
            stdin: mapSinkErr(handle.stdin),
            stdout: mapStreamErr(handle.stdout),
            stderr: mapStreamErr(handle.stderr),
            all: mapStreamErr(handle.all),
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void).pipe(
              Effect.mapError(toPlatformError("unref", command)),
            ) as ChildProcessHandle["unref"],
          })
          return result
        }),
      )
    }),
  )

  export const defaultLayer: Layer.Layer<ChildProcessSpawner, never, never> = layer.pipe(
    Layer.provide(Workspace.Primitives.defaultLayer),
  )
}
