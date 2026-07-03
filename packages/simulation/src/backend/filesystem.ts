import { Effect, FileSystem, Layer, Option, Stream } from "effect"
import { systemError, type PlatformError, type SystemErrorTag } from "effect/PlatformError"
import nodeFs from "fs"
import path from "path"

/**
 * In-memory simulated `FileSystem.FileSystem`.
 *
 * Replaces the `NodeFileSystem` platform node when the server runs in
 * simulation mode. Backed by a flat map of absolute paths to entries and
 * rooted at a single directory (the simulation anchor): paths that resolve
 * outside the root fail with `PermissionDenied` so host filesystem escapes
 * are loud. Only the operations the app actually uses are implemented;
 * everything else dies with a clear defect.
 *
 * Inspired by the V1 prototype on `jlongster/simulation-rebase`, rewritten
 * for the V2 platform node shape without the `just-bash` dependency.
 */

export interface Options {
  readonly root: string
  readonly files?: Record<string, string | Uint8Array>
}

interface FileEntry {
  readonly type: "File"
  content: Uint8Array
  mode: number
  mtime: Date
}

interface DirectoryEntry {
  readonly type: "Directory"
  mode: number
  mtime: Date
}

type Entry = FileEntry | DirectoryEntry

export function make(options: Options): FileSystem.FileSystem {
  const root = path.resolve(options.root)
  const store = new Map<string, Entry>()
  const temp = { value: 0 }
  const encoder = new TextEncoder()
  store.set(root, makeDirectoryEntry())

  const within = (resolved: string) => resolved === root || resolved.startsWith(withSep(root))

  const childrenOf = (resolved: string) => [...store.keys()].filter((key) => key.startsWith(withSep(resolved)))

  const fail = (
    tag: SystemErrorTag,
    method: string,
    file: string,
    description?: string,
  ): Effect.Effect<never, PlatformError> =>
    Effect.fail(
      systemError({ _tag: tag, module: "SimulationFileSystem", method, description, pathOrDescriptor: file }),
    )

  const locate = (method: string, file: string): Effect.Effect<string, PlatformError> => {
    const resolved = path.resolve(root, file)
    if (within(resolved)) return Effect.succeed(resolved)
    return fail("PermissionDenied", method, file, "path escapes the simulated filesystem root")
  }

  const requireEntry = (method: string, file: string): Effect.Effect<readonly [string, Entry], PlatformError> =>
    locate(method, file).pipe(
      Effect.flatMap((resolved) => {
        const entry = store.get(resolved)
        if (!entry) return fail("NotFound", method, file)
        return Effect.succeed([resolved, entry] as const)
      }),
    )

  const requireParentDirectory = (
    method: string,
    resolved: string,
    file: string,
  ): Effect.Effect<void, PlatformError> => {
    const parent = store.get(path.dirname(resolved))
    if (parent?.type === "Directory") return Effect.void
    return fail("NotFound", method, file, "parent directory does not exist")
  }

  // Creates every missing directory between root and resolved (inclusive).
  const ensureDirectories = (method: string, file: string, resolved: string): Effect.Effect<void, PlatformError> =>
    Effect.suspend(() => {
      const segments = path.relative(root, resolved).split(path.sep).filter(Boolean)
      const conflict = segments.reduce<string | Effect.Effect<never, PlatformError>>((current, segment) => {
        if (typeof current !== "string") return current
        const next = path.join(current, segment)
        const entry = store.get(next)
        if (entry && entry.type !== "Directory")
          return fail("AlreadyExists", method, file, "path component is not a directory")
        if (!entry) store.set(next, makeDirectoryEntry())
        return next
      }, root)
      return typeof conflict === "string" ? Effect.void : conflict
    })

  // Seed initial files, creating parents as needed. Entries outside the root are ignored.
  for (const [file, content] of Object.entries(options.files ?? {})) {
    const resolved = path.resolve(root, file)
    if (!within(resolved)) continue
    Effect.runSync(ensureDirectories("seed", file, path.dirname(resolved)))
    store.set(resolved, {
      type: "File",
      content: typeof content === "string" ? encoder.encode(content) : content.slice(),
      mode: 0o644,
      mtime: new Date(),
    })
  }

  // Probe operations report NotFound outside the root instead of
  // PermissionDenied: walk-up loops (project discovery, findUp, globUp)
  // legitimately probe ancestor directories of the anchor and must observe
  // "nothing there". Content access and mutation outside the root stay loud.
  const probe = (method: string, file: string): Effect.Effect<Entry, PlatformError> =>
    Effect.suspend(() => {
      const resolved = path.resolve(root, file)
      const entry = within(resolved) ? store.get(resolved) : undefined
      if (!entry) return fail("NotFound", method, file)
      return Effect.succeed(entry)
    })

  const stat: FileSystem.FileSystem["stat"] = (file) => probe("stat", file).pipe(Effect.map(toInfo))

  const access: FileSystem.FileSystem["access"] = (file) => probe("access", file).pipe(Effect.asVoid)

  const chmod: FileSystem.FileSystem["chmod"] = (file, mode) =>
    requireEntry("chmod", file).pipe(
      Effect.map(([, entry]) => {
        entry.mode = mode
      }),
    )

  const realPath: FileSystem.FileSystem["realPath"] = (file) =>
    requireEntry("realPath", file).pipe(Effect.map(([resolved]) => resolved))

  const readFile: FileSystem.FileSystem["readFile"] = (file) =>
    requireEntry("readFile", file).pipe(
      Effect.flatMap(([, entry]) => {
        if (entry.type !== "File") return fail("BadResource", "readFile", file, "path is a directory")
        return Effect.succeed(entry.content.slice())
      }),
    )

  const writeFile: FileSystem.FileSystem["writeFile"] = (file, data, writeOptions) =>
    locate("writeFile", file).pipe(
      Effect.flatMap((resolved) => {
        const existing = store.get(resolved)
        if (existing?.type === "Directory") return fail("BadResource", "writeFile", file, "path is a directory")
        return requireParentDirectory("writeFile", resolved, file).pipe(
          Effect.map(() => {
            store.set(resolved, {
              type: "File",
              content: data.slice(),
              mode: writeOptions?.mode ?? existing?.mode ?? 0o644,
              mtime: new Date(),
            })
          }),
        )
      }),
    )

  const makeDirectory: FileSystem.FileSystem["makeDirectory"] = (file, dirOptions) =>
    locate("makeDirectory", file).pipe(
      Effect.flatMap((resolved) => {
        if (dirOptions?.recursive) return ensureDirectories("makeDirectory", file, resolved)
        if (store.has(resolved)) return fail("AlreadyExists", "makeDirectory", file)
        return requireParentDirectory("makeDirectory", resolved, file).pipe(
          Effect.map(() => {
            store.set(resolved, { type: "Directory", mode: dirOptions?.mode ?? 0o755, mtime: new Date() })
          }),
        )
      }),
    )

  const readDirectory: FileSystem.FileSystem["readDirectory"] = (file, readOptions) =>
    requireEntry("readDirectory", file).pipe(
      Effect.flatMap(([resolved, entry]) => {
        if (entry.type !== "Directory") return fail("BadResource", "readDirectory", file, "path is not a directory")
        const children = childrenOf(resolved)
        const names = readOptions?.recursive
          ? children.map((key) => path.relative(resolved, key))
          : children.filter((key) => path.dirname(key) === resolved).map((key) => path.basename(key))
        return Effect.succeed(names.sort((a, b) => a.localeCompare(b)))
      }),
    )

  const remove: FileSystem.FileSystem["remove"] = (file, removeOptions) =>
    locate("remove", file).pipe(
      Effect.flatMap((resolved) => {
        const entry = store.get(resolved)
        if (!entry) return removeOptions?.force ? Effect.void : fail("NotFound", "remove", file)
        const children = childrenOf(resolved)
        if (entry.type === "Directory" && children.length > 0 && !removeOptions?.recursive)
          return fail("Unknown", "remove", file, "directory is not empty")
        for (const key of children) store.delete(key)
        store.delete(resolved)
        // The root itself must always exist.
        if (resolved === root) store.set(root, makeDirectoryEntry())
        return Effect.void
      }),
    )

  const rename: FileSystem.FileSystem["rename"] = (oldPath, newPath) =>
    Effect.all([locate("rename", oldPath), locate("rename", newPath)]).pipe(
      Effect.flatMap(([from, to]) => {
        const entry = store.get(from)
        if (!entry) return fail("NotFound", "rename", oldPath)
        return requireParentDirectory("rename", to, newPath).pipe(
          Effect.map(() => {
            const moved = [from, ...childrenOf(from)].map((key) => [key, store.get(key)!] as const)
            for (const [key] of moved) store.delete(key)
            for (const key of [to, ...childrenOf(to)]) store.delete(key)
            for (const [key, value] of moved) store.set(key === from ? to : to + key.slice(from.length), value)
          }),
        )
      }),
    )

  const copy: FileSystem.FileSystem["copy"] = (fromPath, toPath) =>
    Effect.all([locate("copy", fromPath), locate("copy", toPath)]).pipe(
      Effect.flatMap(([from, to]) => {
        const entry = store.get(from)
        if (!entry) return fail("NotFound", "copy", fromPath)
        return requireParentDirectory("copy", to, toPath).pipe(
          Effect.map(() => {
            for (const key of [from, ...childrenOf(from)]) {
              const source = store.get(key)!
              const target = key === from ? to : to + key.slice(from.length)
              store.set(
                target,
                source.type === "File"
                  ? { ...source, content: source.content.slice(), mtime: new Date() }
                  : { ...source, mtime: new Date() },
              )
            }
          }),
        )
      }),
    )

  const copyFile: FileSystem.FileSystem["copyFile"] = (fromPath, toPath) =>
    readFile(fromPath).pipe(Effect.flatMap((content) => writeFile(toPath, content)))

  const makeTempDirectory: FileSystem.FileSystem["makeTempDirectory"] = (tempOptions) =>
    Effect.suspend(() => {
      const directory = tempOptions?.directory ?? path.join(root, ".simulation-tmp")
      const file = path.join(directory, `${tempOptions?.prefix ?? "tmp-"}${++temp.value}`)
      return makeDirectory(file, { recursive: true }).pipe(Effect.map(() => file))
    })

  const makeTempDirectoryScoped: FileSystem.FileSystem["makeTempDirectoryScoped"] = (tempOptions) =>
    Effect.acquireRelease(makeTempDirectory(tempOptions), (directory) =>
      remove(directory, { recursive: true, force: true }).pipe(Effect.ignore),
    )

  // Read-only file handle: enough for the read tool's stat/seek/readAlloc use.
  const open: FileSystem.FileSystem["open"] = (file) =>
    requireEntry("open", file).pipe(
      Effect.map(([resolved]) => {
        const position = { value: 0 }
        const contentOf = () => {
          const current = store.get(resolved)
          return current?.type === "File" ? current.content : new Uint8Array()
        }
        return {
          [FileSystem.FileTypeId]: FileSystem.FileTypeId,
          fd: FileSystem.FileDescriptor(0),
          stat: Effect.suspend(() => stat(resolved)),
          seek: (offset, from) =>
            Effect.sync(() => {
              position.value = from === "start" ? Number(offset) : position.value + Number(offset)
            }),
          sync: Effect.void,
          read: (buffer) =>
            Effect.sync(() => {
              const chunk = contentOf().subarray(position.value, position.value + buffer.length)
              buffer.set(chunk)
              position.value += chunk.length
              return FileSystem.Size(chunk.length)
            }),
          readAlloc: (size) =>
            Effect.sync(() => {
              const chunk = contentOf().slice(position.value, position.value + Number(size))
              position.value += chunk.length
              return chunk.length === 0 ? Option.none() : Option.some(chunk)
            }),
          truncate: () => unimplemented("File.truncate"),
          write: () => unimplemented("File.write"),
          writeAll: () => unimplemented("File.writeAll"),
        } satisfies FileSystem.File
      }),
    )

  return FileSystem.make({
    access,
    chmod,
    chown: () => unimplemented("chown"),
    copy,
    copyFile,
    link: () => unimplemented("link"),
    makeDirectory,
    makeTempDirectory,
    makeTempDirectoryScoped,
    makeTempFile: () => unimplemented("makeTempFile"),
    makeTempFileScoped: () => unimplemented("makeTempFileScoped"),
    open,
    readDirectory,
    readFile,
    readLink: () => unimplemented("readLink"),
    realPath,
    remove,
    rename,
    stat,
    symlink: () => unimplemented("symlink"),
    truncate: () => unimplemented("truncate"),
    utimes: () => unimplemented("utimes"),
    watch: () => Stream.die(new Error("SimulationFileSystem.watch is not implemented in simulation")),
    writeFile,
  })
}

/**
 * Lazily constructed layer so the root defaults to `process.cwd()` at
 * layer-build time (the simulation anchor directory), not at import time.
 *
 * When `OPENCODE_SIMULATION_STATE` points at a snapshot directory, its
 * `project/` contents are read from the host once at build time and seeded
 * into the in-memory tree, joined onto the anchor root.
 */
export const layer = (options?: Partial<Options>) =>
  Layer.sync(FileSystem.FileSystem)(() =>
    make({
      root: options?.root ?? process.cwd(),
      files: { ...loadSnapshotFiles(process.env.OPENCODE_SIMULATION_STATE), ...options?.files },
    }),
  )

function loadSnapshotFiles(stateDirectory: string | undefined) {
  if (!stateDirectory) return {}
  const project = path.join(stateDirectory, "project")
  if (!nodeFs.existsSync(project)) return {}
  const files: Record<string, Uint8Array> = {}
  const walk = (dir: string) => {
    for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      if (entry.isFile()) files[path.relative(project, file)] = new Uint8Array(nodeFs.readFileSync(file))
    }
  }
  walk(project)
  return files
}

function makeDirectoryEntry(): Entry {
  return { type: "Directory", mode: 0o755, mtime: new Date() }
}

function withSep(dir: string) {
  return dir.endsWith(path.sep) ? dir : dir + path.sep
}

function toInfo(entry: Entry): FileSystem.File.Info {
  return {
    type: entry.type,
    mtime: Option.some(entry.mtime),
    atime: Option.some(entry.mtime),
    birthtime: Option.some(entry.mtime),
    dev: 0,
    ino: Option.none(),
    mode: entry.mode,
    nlink: Option.none(),
    uid: Option.none(),
    gid: Option.none(),
    rdev: Option.none(),
    size: FileSystem.Size(entry.type === "File" ? entry.content.length : 0),
    blksize: Option.none(),
    blocks: Option.none(),
  }
}

function unimplemented(method: string) {
  return Effect.die(new Error(`SimulationFileSystem.${method} is not implemented in simulation`))
}

export * as SimulationFileSystem from "./filesystem"
