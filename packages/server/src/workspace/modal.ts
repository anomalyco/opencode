export * as ModalDriver from "./modal"

import { Effect, Schema, Sink, Stream } from "effect"
import { systemError } from "effect/PlatformError"
import type { Command } from "effect/unstable/process/ChildProcess"
import { ExitCode, ProcessId, make as makeSpawner, makeHandle } from "effect/unstable/process/ChildProcessSpawner"
import { ModalClient, type Sandbox, SandboxFilesystemNotFoundError, NotFoundError } from "modal"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { WorkspaceEnvironment } from "@opencode-ai/core/workspace/environment"

const PROVIDER = "modal"
const APP = "opencode-workspaces"
const ROOT = "/workspace"
/** Maximum sandbox lifetime; stop/resume/TTL lifecycle is a deferred design. */
const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000
/**
 * Backstop for commands: Modal exposes no per-process termination, so kill is
 * best-effort and this deadline is what actually reaps orphaned commands.
 */
const EXEC_TIMEOUT_MS = 30 * 60 * 1000

const Binding = Schema.Struct({ sandboxId: Schema.String })

const fail = (message: string) => (cause: unknown) => new WorkspaceDriver.Error({ provider: PROVIDER, message, cause })

// git, bash, and rg are provisioned in the image, never discovered.
const IMAGE_COMMANDS = ["RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates"]

export const make = Effect.sync(() => {
  // Credentials come from MODAL_TOKEN_ID/MODAL_TOKEN_SECRET or ~/.modal.toml.
  const client = new ModalClient()
  const decode = (binding: WorkspaceDriver.Binding) =>
    Schema.decodeUnknownEffect(Binding)(binding).pipe(Effect.mapError(fail("invalid modal binding")))

  return WorkspaceDriver.make({
    create: ({ workspaceID }) =>
      Effect.tryPromise({
        try: async () => {
          const app = await client.apps.fromName(APP, { createIfMissing: true })
          const image = client.images.fromRegistry("ubuntu:24.04").dockerfileCommands(IMAGE_COMMANDS)
          const sandbox = await client.sandboxes.create(app, image, {
            name: workspaceID,
            timeoutMs: SANDBOX_TIMEOUT_MS,
          })
          await sandbox.filesystem.makeDirectory(ROOT)
          return { binding: { sandboxId: sandbox.sandboxId }, root: ROOT }
        },
        catch: fail("create"),
      }),

    connect: (binding) =>
      Effect.gen(function* () {
        const decoded = yield* decode(binding)
        const sandbox = yield* Effect.tryPromise({
          try: () => client.sandboxes.fromId(decoded.sandboxId),
          catch: fail("connect"),
        })
        const exit = yield* Effect.tryPromise({ try: () => sandbox.poll(), catch: fail("connect") })
        if (exit !== null)
          return yield* new WorkspaceDriver.Error({
            provider: PROVIDER,
            message: `sandbox ${decoded.sandboxId} has terminated (exit ${exit})`,
          })
        return environment(sandbox)
      }),

    destroy: (binding) =>
      Effect.gen(function* () {
        const decoded = yield* decode(binding)
        yield* Effect.tryPromise({
          try: async () => {
            const sandbox = await client.sandboxes.fromId(decoded.sandboxId)
            await sandbox.terminate({ wait: true })
          },
          catch: fail("destroy"),
        }).pipe(
          // Already gone is destroyed.
          Effect.catchIf(
            (error) => error.cause instanceof NotFoundError,
            () => Effect.void,
          ),
        )
      }),
  })
})

const environment = (sandbox: Sandbox): WorkspaceEnvironment.Interface => ({
  directory: ROOT,
  files: files(sandbox),
  process: makeSpawner(spawn(sandbox)),
  shell: WorkspaceEnvironment.linuxShell,
})

const FILE_TYPE = { file: "File", directory: "Directory", symlink: "SymbolicLink" } as const

const files = (sandbox: Sandbox): WorkspaceEnvironment.Files => {
  const wrap = <A>(operation: string, path: string, run: () => Promise<A>) =>
    WorkspaceEnvironment.tryOperation({
      operation,
      path,
      run,
      isNotFound: (cause) => cause instanceof SandboxFilesystemNotFoundError,
    })
  return {
    stat: (path) =>
      wrap("stat", path, async () => {
        const info = await sandbox.filesystem.stat(path)
        return { type: FILE_TYPE[info.type] }
      }),
    realPath: (path) =>
      // No canonicalization API; realpath(1) from coreutils. A non-zero exit
      // is reported as NotFound, which matches the dominant failure mode.
      wrap("realPath", path, async () => {
        // Both streams piped: the SDK's "ignore" path needs ReadableStream.from,
        // which Bun does not implement.
        // -e: every component must exist, matching node fs.realpath semantics.
        const process = await sandbox.exec(["realpath", "-e", "--", path], { stdout: "pipe", stderr: "pipe" })
        const [output, code] = await Promise.all([process.stdout.readText(), process.wait()])
        if (code !== 0) throw new SandboxFilesystemNotFoundError(`realpath exited ${code}`)
        return output.trim()
      }),
    read: (path) => wrap("read", path, () => sandbox.filesystem.readBytes(path)),
    list: (path) =>
      wrap("list", path, async () => {
        const entries = await sandbox.filesystem.listFiles(path)
        return entries.map((entry) => ({
          name: entry.name,
          type:
            entry.type === "file"
              ? ("file" as const)
              : entry.type === "directory"
                ? ("directory" as const)
                : ("symlink" as const),
        }))
      }),
    // Parent directories are created by the SDK, matching the Files contract.
    write: (path, content) =>
      Effect.tryPromise({
        try: () => sandbox.filesystem.writeBytes(content, path),
        catch: (cause) => new WorkspaceEnvironment.Error({ operation: "write", path, cause }),
      }),
    remove: (path) => wrap("remove", path, () => sandbox.filesystem.remove(path)),
  }
}

const spawnError = (method: string, options?: { description?: string; cause?: unknown }) =>
  systemError({ _tag: "Unknown", module: "ModalDriver", method, ...options })

const spawn = (sandbox: Sandbox) => {
  let pids = 0
  return Effect.fnUntraced(function* (command: Command) {
    if (command._tag === "PipedCommand")
      return yield* Effect.fail(spawnError("spawn", { description: "piped commands unsupported" }))

    const process = yield* Effect.tryPromise({
      try: () =>
        sandbox.exec([command.command, ...command.args], {
          mode: "binary",
          stdout: "pipe",
          stderr: "pipe",
          workdir: command.options.cwd,
          env: compact(command.options.env),
          timeoutMs: EXEC_TIMEOUT_MS,
        }),
      catch: (cause) => spawnError("spawn", { cause }),
    })

    let exited = false
    let waited: Promise<number> | undefined
    const wait = () =>
      (waited ??= process.wait().then((code) => {
        exited = true
        return code
      }))
    const onError = (cause: unknown) => spawnError("process", { cause })
    return makeHandle({
      pid: ProcessId(++pids),
      exitCode: Effect.tryPromise({ try: wait, catch: onError }).pipe(Effect.map(ExitCode)),
      isRunning: Effect.sync(() => !exited),
      // Modal has no per-process termination; EXEC_TIMEOUT_MS reaps orphans.
      kill: () => Effect.logWarning("modal cannot kill sandbox commands; relying on exec timeout"),
      stdin: Sink.forEach((chunk: Uint8Array) =>
        Effect.tryPromise({ try: () => process.stdin.writeBytes(chunk), catch: onError }),
      ),
      stdout: Stream.fromReadableStream({ evaluate: () => process.stdout, onError }),
      stderr: Stream.fromReadableStream({ evaluate: () => process.stderr, onError }),
      all: Stream.merge(
        Stream.fromReadableStream({ evaluate: () => process.stdout, onError }),
        Stream.fromReadableStream({ evaluate: () => process.stderr, onError }),
      ),
      getInputFd: () => Sink.fail(spawnError("getInputFd", { description: "unsupported" })),
      getOutputFd: () => Stream.fail(spawnError("getOutputFd", { description: "unsupported" })),
      unref: Effect.succeed(Effect.void),
    })
  })
}

const compact = (env: Record<string, string | undefined> | undefined) => {
  if (!env) return undefined
  return Object.fromEntries(Object.entries(env).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])))
}
