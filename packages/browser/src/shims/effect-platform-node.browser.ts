import { Effect, FileSystem, Layer, Option, Path, Sink, Stream } from "effect"
import { systemError } from "effect/PlatformError"
import * as Process from "effect/unstable/process"

import * as BrowserFs from "./fs.browser"
import { runBrowserCommand } from "./child-process.browser"

function toPlatformError(method: string, pathOrDescriptor: string | number, cause?: unknown) {
  const code = typeof cause === "object" && cause && "code" in cause ? String((cause as { code?: unknown }).code) : ""

  return systemError({
    _tag: code === "ENOENT" ? "NotFound" : "Unknown",
    module: "FileSystem",
    method,
    pathOrDescriptor,
    description: cause instanceof Error ? cause.message : undefined,
    cause,
  })
}

function notSupported(method: string, pathOrDescriptor: string | number) {
  return systemError({
    _tag: "Unknown",
    module: "FileSystem",
    method,
    pathOrDescriptor,
    description: "not supported in browser mode",
  })
}

function toFileInfo(stats: Awaited<ReturnType<typeof BrowserFs.stat>>) {
  return {
    type: stats.isDirectory() ? ("Directory" as const) : ("File" as const),
    mtime: Option.some(stats.mtime),
    atime: Option.some(stats.mtime),
    birthtime: Option.some(stats.mtime),
    dev: 0,
    ino: Option.none<number>(),
    mode: stats.isDirectory() ? 0o755 : 0o644,
    nlink: Option.none<number>(),
    uid: Option.none<number>(),
    gid: Option.none<number>(),
    rdev: Option.none<number>(),
    size: FileSystem.Size(stats.size),
    blksize: Option.none<ReturnType<typeof FileSystem.Size>>(),
    blocks: Option.none<number>(),
  }
}

async function copyRecursive(fromPath: string, toPath: string): Promise<void> {
  const stats = await BrowserFs.stat(fromPath)

  if (stats.isDirectory()) {
    await BrowserFs.mkdir(toPath, { recursive: true })
    const entries = await BrowserFs.readdir(fromPath, { withFileTypes: true })
    for (const entry of entries) {
      const source = `${fromPath.replace(/\/$/, "")}/${entry.name}`
      const target = `${toPath.replace(/\/$/, "")}/${entry.name}`
      if (entry.isDirectory()) {
        await copyRecursive(source, target)
        continue
      }

      const content = await BrowserFs.readFile(source)
      await BrowserFs.writeFile(target, content)
    }
    return
  }

  const content = await BrowserFs.readFile(fromPath)
  await BrowserFs.writeFile(toPath, content)
}

async function readDirectoryRecursive(path: string, prefix = ""): Promise<string[]> {
  const entries = await BrowserFs.readdir(path, { withFileTypes: true })
  const output: string[] = []

  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    output.push(relative)

    if (entry.isDirectory()) {
      output.push(...(await readDirectoryRecursive(`${path.replace(/\/$/, "")}/${entry.name}`, relative)))
    }
  }

  return output
}

function browserFileSystemLayer() {
  return FileSystem.layerNoop({
    access: (path) =>
      Effect.tryPromise({
        try: () => BrowserFs.access(path),
        catch: (cause) => toPlatformError("access", path, cause),
      }),
    chmod: () => Effect.void,
    chown: () => Effect.void,
    copy: (fromPath, toPath) =>
      Effect.tryPromise({
        try: () => copyRecursive(fromPath, toPath),
        catch: (cause) => toPlatformError("copy", fromPath, cause),
      }),
    copyFile: (fromPath, toPath) =>
      Effect.tryPromise({
        try: () => BrowserFs.copyFile(fromPath, toPath),
        catch: (cause) => toPlatformError("copyFile", fromPath, cause),
      }),
    exists: (path) =>
      Effect.sync(() => BrowserFs._vfs_exists(path)),
    link: (fromPath) => Effect.fail(notSupported("link", fromPath)),
    makeDirectory: (path, options) =>
      Effect.tryPromise({
        try: () => BrowserFs.mkdir(path, options),
        catch: (cause) => toPlatformError("makeDirectory", path, cause),
      }),
    makeTempDirectory: (options) =>
      Effect.tryPromise({
        try: async () => {
          const directory = options?.directory ?? "/tmp"
          const prefix = options?.prefix ?? "opencode-"
          await BrowserFs.mkdir(directory, { recursive: true })
          return BrowserFs.mkdtemp(`${directory.replace(/\/$/, "")}/${prefix}`)
        },
        catch: (cause) => toPlatformError("makeTempDirectory", options?.directory ?? "/tmp", cause),
      }),
    makeTempDirectoryScoped: (options) =>
      Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const directory = options?.directory ?? "/tmp"
            const prefix = options?.prefix ?? "opencode-"
            await BrowserFs.mkdir(directory, { recursive: true })
            return BrowserFs.mkdtemp(`${directory.replace(/\/$/, "")}/${prefix}`)
          },
          catch: (cause) => toPlatformError("makeTempDirectoryScoped", options?.directory ?? "/tmp", cause),
        }),
        (path) =>
          Effect.tryPromise({
            try: () => BrowserFs.rm(path, { recursive: true, force: true }),
            catch: () => undefined,
          }),
      ),
    makeTempFile: (options) =>
      Effect.tryPromise({
        try: async () => {
          const directory = options?.directory ?? "/tmp"
          const prefix = options?.prefix ?? "opencode-"
          const suffix = options?.suffix ?? ""
          await BrowserFs.mkdir(directory, { recursive: true })
          const path = `${directory.replace(/\/$/, "")}/${prefix}${Math.random().toString(36).slice(2, 10)}${suffix}`
          await BrowserFs.writeFile(path, "")
          return path
        },
        catch: (cause) => toPlatformError("makeTempFile", options?.directory ?? "/tmp", cause),
      }),
    makeTempFileScoped: (options) =>
      Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const directory = options?.directory ?? "/tmp"
            const prefix = options?.prefix ?? "opencode-"
            const suffix = options?.suffix ?? ""
            await BrowserFs.mkdir(directory, { recursive: true })
            const path = `${directory.replace(/\/$/, "")}/${prefix}${Math.random().toString(36).slice(2, 10)}${suffix}`
            await BrowserFs.writeFile(path, "")
            return path
          },
          catch: (cause) => toPlatformError("makeTempFileScoped", options?.directory ?? "/tmp", cause),
        }),
        (path) =>
          Effect.tryPromise({
            try: () => BrowserFs.rm(path, { force: true }),
            catch: () => undefined,
          }),
      ),
    open: (path) => Effect.fail(notSupported("open", path)),
    readDirectory: (path, options) =>
      Effect.tryPromise({
        try: () => (options?.recursive ? readDirectoryRecursive(path) : BrowserFs.readdir(path).then((entries) => entries as string[])),
        catch: (cause) => toPlatformError("readDirectory", path, cause),
      }),
    readFile: (path) =>
      Effect.tryPromise({
        try: async () => {
          const content = await BrowserFs.readFile(path)
          return typeof content === "string" ? new TextEncoder().encode(content) : content
        },
        catch: (cause) => toPlatformError("readFile", path, cause),
      }),
    readFileString: (path, encoding) =>
      Effect.tryPromise({
        try: async () => {
          const content = await BrowserFs.readFile(path, encoding)
          return typeof content === "string" ? content : new TextDecoder(encoding).decode(content)
        },
        catch: (cause) => toPlatformError("readFileString", path, cause),
      }),
    readLink: (path) =>
      Effect.tryPromise({
        try: () => BrowserFs.readlink(path),
        catch: (cause) => toPlatformError("readLink", path, cause),
      }),
    realPath: (path) =>
      Effect.tryPromise({
        try: () => BrowserFs.realpath(path),
        catch: (cause) => toPlatformError("realPath", path, cause),
      }),
    remove: (path, options) =>
      Effect.tryPromise({
        try: () => BrowserFs.rm(path, options),
        catch: (cause) => toPlatformError("remove", path, cause),
      }),
    rename: (oldPath, newPath) =>
      Effect.tryPromise({
        try: () => BrowserFs.rename(oldPath, newPath),
        catch: (cause) => toPlatformError("rename", oldPath, cause),
      }),
    stat: (path) =>
      Effect.tryPromise({
        try: async () => toFileInfo(await BrowserFs.stat(path)),
        catch: (cause) => toPlatformError("stat", path, cause),
      }),
    symlink: (fromPath) => Effect.fail(notSupported("symlink", fromPath)),
    truncate: (path, length) =>
      Effect.tryPromise({
        try: async () => {
          const current = await BrowserFs.readFile(path)
          const bytes = typeof current === "string" ? new TextEncoder().encode(current) : current
          const next = bytes.slice(0, length === undefined ? 0 : Number(length))
          await BrowserFs.writeFile(path, next)
        },
        catch: (cause) => toPlatformError("truncate", path, cause),
      }),
    utimes: () => Effect.void,
    watch: () => Stream.empty,
    writeFile: (path, data) =>
      Effect.tryPromise({
        try: () => BrowserFs.writeFile(path, data),
        catch: (cause) => toPlatformError("writeFile", path, cause),
      }),
    writeFileString: (path, data) =>
      Effect.tryPromise({
        try: () => BrowserFs.writeFile(path, data),
        catch: (cause) => toPlatformError("writeFileString", path, cause),
      }),
  })
}

function browserChildProcessSpawnerLayer() {
  return Layer.succeed(Process.ChildProcessSpawner.ChildProcessSpawner)(
    Process.ChildProcessSpawner.make((command: any) =>
      Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            if (command?._tag !== "StandardCommand") {
              throw new Error(`Unsupported browser child process command: ${String(command?._tag ?? "unknown")}`)
            }

            const result = await runBrowserCommand({
              command: command.command,
              args: [...(command.args ?? [])],
              cwd: command.options?.cwd,
              env: command.options?.env,
            })

            const stdout = result.stdout ? Stream.make(new TextEncoder().encode(result.stdout)) : Stream.empty
            const stderr = result.stderr ? Stream.make(new TextEncoder().encode(result.stderr)) : Stream.empty
            const combinedChunks = [
              ...(result.stdout ? [new TextEncoder().encode(result.stdout)] : []),
              ...(result.stderr ? [new TextEncoder().encode(result.stderr)] : []),
            ]

            return Process.ChildProcessSpawner.makeHandle({
              pid: Process.ChildProcessSpawner.ProcessId(1),
              exitCode: Effect.succeed(Process.ChildProcessSpawner.ExitCode(result.code)),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              stdin: Sink.forEach(() => Effect.void),
              stdout,
              stderr,
              all: combinedChunks.length > 0 ? Stream.make(...combinedChunks) : Stream.empty,
              getInputFd: () => Sink.forEach(() => Effect.void),
              getOutputFd: () => Stream.empty,
            })
          },
          catch: (cause) =>
            systemError({
              _tag: "Unknown",
              module: "ChildProcess",
              method: "spawn",
              description: cause instanceof Error ? cause.message : undefined,
              cause,
            }),
        }),
        () => Effect.void,
      ),
    ),
  )
}

export const NodeFileSystem = {
  layer: browserFileSystemLayer(),
}

export const NodePath = {
  layer: Path.layer,
}

export const NodeChildProcessSpawner = {
  layer: browserChildProcessSpawnerLayer(),
}

export const NodeRuntime = {
  runMain: (_effect: unknown) => {
    console.warn("NodeRuntime.runMain called in browser - this is a stub")
  },
}

export const NodeHttpServer = {
  layer: Layer.empty,
}

export default {
  NodeFileSystem,
  NodePath,
  NodeChildProcessSpawner,
  NodeRuntime,
  NodeHttpServer,
}
