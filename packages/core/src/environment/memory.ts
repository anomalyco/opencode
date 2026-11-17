import path from "node:path"
import { Effect, PlatformError } from "effect"
import { make } from "effect/process/ChildProcessSpawner"
import type { Driver } from "./driver.js"
import { Failed, NotFound, WrongKind, type FileInfo, type FilesImpl, type FileType } from "./files.js"

/** What chmod, chown and utimes change, and what identifies a node. */
type Meta = {
  readonly ino?: number
  readonly mode?: number
  readonly uid?: number
  readonly gid?: number
  readonly atimeMs?: number
  readonly ctimeMs?: number
  readonly birthtimeMs?: number
}

type Node =
  | ({ readonly type: "file"; readonly bytes: Uint8Array; readonly mtimeMs: number } & Meta)
  | ({ readonly type: "directory"; readonly mtimeMs: number } & Meta)
  | ({ readonly type: "symlink"; readonly target: string; readonly mtimeMs: number } & Meta)

const typeBits = { file: 0o100000, directory: 0o040000, symlink: 0o120000 }
const defaultPermissions = { file: 0o644, directory: 0o755, symlink: 0o777 }

export interface MemoryDriver extends Driver {
  readonly symlink: (target: string, path: string) => Effect.Effect<void, Failed>
}

export const makeMemoryDriver = (): MemoryDriver => {
  const nodes = new Map<string, Node>([["/", { type: "directory", mtimeMs: Date.now() }]])
  const key = (value: string) => path.posix.resolve("/", value)
  const size = (node: Node) =>
    node.type === "file"
      ? node.bytes.length
      : node.type === "symlink"
        ? new TextEncoder().encode(node.target).length
        : 0
  const info = (node: Node): FileInfo => ({
    type: node.type,
    size: size(node),
    mtimeMs: node.mtimeMs,
    dev: 1,
    ino: node.ino ?? 0,
    mode: typeBits[node.type] | (node.mode ?? defaultPermissions[node.type]),
    nlink: node.type === "directory" ? 2 : 1,
    uid: node.uid ?? 0,
    gid: node.gid ?? 0,
    rdev: 0,
    blksize: 4096,
    blocks: Math.ceil(size(node) / 512),
    atimeMs: node.atimeMs ?? node.mtimeMs,
    ctimeMs: node.ctimeMs ?? node.mtimeMs,
    birthtimeMs: node.birthtimeMs ?? node.mtimeMs,
  })
  let inodes = 1
  // A new node gets the next inode and its birth time; a changed one keeps both.
  const put = (target: string, node: Node) => {
    const existing = nodes.get(target)
    nodes.set(target, {
      ...node,
      ino: node.ino ?? existing?.ino ?? ++inodes,
      birthtimeMs: node.birthtimeMs ?? existing?.birthtimeMs ?? node.mtimeMs,
      ctimeMs: Date.now(),
    })
  }
  const resolveKey = (value: string, followFinal: boolean, seen = new Set<string>()): string | undefined => {
    const normalized = key(value)
    const parts = normalized.split("/").filter(Boolean)
    const base = "/"
    const walk = (current: string, index: number): string | undefined => {
      if (index === parts.length) return current
      const part = parts[index]
      const candidate = path.posix.join(current, part)
      const node = nodes.get(candidate)
      if (node?.type !== "symlink" || (!followFinal && index === parts.length - 1)) return walk(candidate, index + 1)
      if (seen.has(candidate)) return undefined
      seen.add(candidate)
      const target = path.posix.resolve(path.posix.dirname(candidate), node.target)
      return resolveKey(path.posix.join(target, ...parts.slice(index + 1)), followFinal, seen)
    }
    return walk(base, 0)
  }
  const lookup = (value: string) => nodes.get(resolveKey(value, false) ?? key(value))
  const requireParent = (value: string) => {
    const parentPath = path.posix.dirname(key(value))
    const parent = nodes.get(resolveKey(parentPath, true) ?? parentPath)
    if (!parent) throw new Error(`Parent directory does not exist: ${path.posix.dirname(value)}`)
    if (parent.type !== "directory") throw new Error(`Parent is not a directory: ${path.posix.dirname(value)}`)
  }
  const mkdirSync = (value: string) => {
    const target = resolveKey(value, false) ?? key(value)
    const existing = nodes.get(target)
    if (existing?.type === "directory") return
    if (existing) throw new Error(`Path is not a directory: ${value}`)
    const parent = path.posix.dirname(target)
    if (parent !== target) mkdirSync(parent)
    put(target, { type: "directory", mtimeMs: Date.now() })
  }
  const failed = (value: string, cause: unknown) => new Failed({ path: value, cause })
  // The existing node a path names after every symlink, or undefined.
  const followed = (value: string) => {
    const target = resolveKey(value, true)
    return target !== undefined && nodes.has(target) ? target : undefined
  }
  const concat = (left: Uint8Array, right: Uint8Array) => {
    const next = new Uint8Array(left.length + right.length)
    next.set(left)
    next.set(right, left.length)
    return next
  }
  // Rewrites a file's bytes through symlinks, creating the file when missing.
  const change = (value: string, update: (current: Uint8Array) => Uint8Array) =>
    Effect.try({
      try: () => {
        const target = resolveKey(value, true) ?? key(value)
        const current = nodes.get(target)
        if (current && current.type !== "file") throw new Error(`Path is not a file: ${value}`)
        if (!current) requireParent(target)
        put(target, {
          ...current,
          type: "file",
          bytes: update(current?.bytes ?? new Uint8Array()),
          mtimeMs: Date.now(),
        })
      },
      catch: (cause) => failed(value, cause),
    })
  const meta = (value: string, follow: boolean, update: () => Meta & { readonly mtimeMs?: number }) =>
    Effect.gen(function* () {
      const target = follow ? followed(value) : (resolveKey(value, false) ?? key(value))
      const node = target === undefined ? undefined : nodes.get(target)
      if (!target || !node) return yield* new NotFound({ path: value })
      put(target, { ...node, ...update() })
    })
  const overrides: FilesImpl = {
    stat: (value) =>
      Effect.suspend(() => {
        const node = lookup(value)
        return node ? Effect.succeed(info(node)) : Effect.fail(new NotFound({ path: value }))
      }),
    read: (value, range) =>
      Effect.gen(function* () {
        const original = lookup(value)
        if (!original) return yield* new NotFound({ path: value })
        if (original.type === "directory") return yield* new WrongKind({ path: value, actual: "directory" })
        const resolved = resolveKey(value, true)
        const node = resolved === undefined ? undefined : nodes.get(resolved)
        if (!node) return yield* new NotFound({ path: value })
        if (node.type !== "file") return yield* new WrongKind({ path: value, actual: node.type })
        const bytes = range === undefined ? node.bytes : node.bytes.subarray(range.offset, range.offset + range.length)
        return { info: info(node), bytes: bytes.slice() }
      }),
    write: (value, bytes) =>
      Effect.try({
        try: () => {
          mkdirSync(path.posix.dirname(key(value)))
          const existing = lookup(value)
          if (existing?.type === "directory") throw new Error(`Path is a directory: ${value}`)
          const target = existing?.type === "symlink" ? resolveKey(value, true) : resolveKey(value, false)
          if (!target) throw new Error(`Cannot resolve symlink: ${value}`)
          requireParent(target)
          const previous = nodes.get(target)
          put(target, {
            ...(previous?.type === "file" ? previous : {}),
            type: "file",
            bytes: bytes.slice(),
            mtimeMs: Date.now(),
          })
        },
        catch: (cause) => failed(value, cause),
      }),
    list: (value) =>
      Effect.gen(function* () {
        const target = resolveKey(value, true) ?? key(value)
        const node = nodes.get(target)
        if (!node) return yield* new NotFound({ path: value })
        if (node.type !== "directory") return yield* new WrongKind({ path: value, actual: node.type })
        return [...nodes.entries()]
          .filter(([entry]) => entry !== target && path.posix.dirname(entry) === target)
          .map(([entry, child]) => ({ name: path.posix.basename(entry), type: child.type satisfies FileType }))
          .sort((a, b) => a.name.localeCompare(b.name))
      }),
    remove: (value) =>
      Effect.sync(() => {
        const target = resolveKey(value, false) ?? key(value)
        for (const entry of nodes.keys()) {
          if (entry === target || entry.startsWith(`${target}/`)) nodes.delete(entry)
        }
      }),
    move: (from, to) =>
      Effect.gen(function* () {
        const source = resolveKey(from, false) ?? key(from)
        const node = nodes.get(source)
        if (!node) return yield* new NotFound({ path: from })
        yield* Effect.try({
          try: () => {
            const requested = resolveKey(to, false) ?? key(to)
            const destination =
              nodes.get(requested)?.type === "directory"
                ? path.posix.join(requested, path.posix.basename(source))
                : requested
            if (node.type === "directory" && destination.startsWith(`${source}/`)) {
              throw new Error(`Cannot move a directory into itself: ${from}`)
            }
            const existing = nodes.get(destination)
            if (node.type === "directory" && existing && existing.type !== "directory") {
              throw new Error(`Cannot overwrite a non-directory with a directory: ${to}`)
            }
            requireParent(destination)
            const moved = [...nodes.entries()].filter(([entry]) => entry === source || entry.startsWith(`${source}/`))
            for (const [entry] of moved) nodes.delete(entry)
            for (const [entry, child] of moved) nodes.set(`${destination}${entry.slice(source.length)}`, child)
          },
          catch: (cause) => failed(from, cause),
        })
      }),
    mkdir: (value) => Effect.try({ try: () => mkdirSync(value), catch: (cause) => failed(value, cause) }),
    append: (value, bytes) => change(value, (current) => concat(current, bytes)),
    writeAt: (value, bytes, offset) =>
      change(value, (current) => {
        const next = new Uint8Array(Math.max(current.length, offset + bytes.length))
        next.set(current)
        next.set(bytes, offset)
        return next
      }),
    truncate: (value, length) =>
      Effect.gen(function* () {
        const target = followed(value)
        if (!target) return yield* new NotFound({ path: value })
        yield* change(value, (current) => {
          const next = new Uint8Array(length)
          next.set(current.subarray(0, length))
          return next
        })
      }),
    chmod: (value, mode) => meta(value, true, () => ({ mode: mode & 0o7777 })),
    chown: (value, uid, gid, follow) => meta(value, follow, () => ({ uid, gid })),
    utimes: (value, atimeMs, mtimeMs, follow) => meta(value, follow, () => ({ atimeMs, mtimeMs })),
    symlink: (target, value) =>
      Effect.try({
        try: () => {
          requireParent(value)
          put(resolveKey(value, false) ?? key(value), { type: "symlink", target, mtimeMs: Date.now() })
        },
        catch: (cause) => failed(value, cause),
      }),
    readlink: (value) =>
      Effect.gen(function* () {
        const node = lookup(value)
        if (!node) return yield* new NotFound({ path: value })
        if (node.type !== "symlink") return yield* new WrongKind({ path: value, actual: node.type })
        return node.target
      }),
    realpath: (value) =>
      Effect.gen(function* () {
        const target = followed(value)
        if (!target) return yield* new NotFound({ path: value })
        return target
      }),
    link: (existing, value) =>
      Effect.gen(function* () {
        const source = followed(existing)
        const node = source === undefined ? undefined : nodes.get(source)
        if (!node) return yield* new NotFound({ path: existing })
        yield* Effect.try({
          try: () => {
            requireParent(value)
            // A copy rather than a shared inode: the memory driver keeps no link counts.
            nodes.set(key(value), { ...node })
          },
          catch: (cause) => failed(value, cause),
        })
      }),
    statfs: (value) =>
      Effect.gen(function* () {
        if (!followed(value)) return yield* new NotFound({ path: value })
        return {
          type: 0x01021994,
          bsize: 4096,
          blocks: 1 << 20,
          bfree: 1 << 19,
          bavail: 1 << 19,
          files: 1 << 16,
          ffree: 1 << 15,
        }
      }),
  }

  const spawner = make((command) =>
    Effect.suspend(() => {
      const description = command._tag === "StandardCommand" ? command.command : "pipeline"
      return Effect.fail(
        PlatformError.systemError({
          _tag: "Unknown",
          module: "EnvironmentMemory",
          method: "spawn",
          pathOrDescriptor: description,
          cause: failed(description, new Error("The memory driver cannot spawn processes")),
        }),
      )
    }),
  )

  return {
    spawner,
    overrides,
    symlink: overrides.symlink,
  }
}

export * as EnvironmentMemory from "./memory.js"
