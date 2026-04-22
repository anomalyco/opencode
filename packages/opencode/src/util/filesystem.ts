import { chmod, mkdir, readFile, stat as statFile, writeFile } from "fs/promises"
import { createWriteStream, existsSync, statSync } from "fs"
import { realpathSync } from "fs"
import { dirname, join, relative, resolve as pathResolve, win32 } from "path"
import { Readable } from "stream"
import { pipeline } from "stream/promises"
import { Glob } from "@opencode-ai/shared/util/glob"

// Fast sync version for metadata checks
export async function exists(p: string): Promise<boolean> {
  return existsSync(p)
}

export async function isDir(p: string): Promise<boolean> {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function stat(p: string): ReturnType<typeof statSync> | undefined {
  return statSync(p, { throwIfNoEntry: false }) ?? undefined
}

export async function statAsync(p: string): Promise<ReturnType<typeof statSync> | undefined> {
  return statFile(p).catch((e) => {
    if (isEnoent(e)) return undefined
    throw e
  })
}

export async function size(p: string): Promise<number> {
  const s = stat(p)?.size ?? 0
  return typeof s === "bigint" ? Number(s) : s
}

export async function readText(p: string): Promise<string> {
  return readFile(p, "utf-8")
}

export async function readJson<T = unknown>(p: string): Promise<T> {
  return JSON.parse(await readFile(p, "utf-8"))
}

export async function readBytes(p: string): Promise<Buffer> {
  return readFile(p)
}

export async function readArrayBuffer(p: string): Promise<ArrayBuffer> {
  const buf = await readFile(p)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

function isEnoent(e: unknown): e is { code: "ENOENT" } {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "ENOENT"
}

export async function write(p: string, content: string | Buffer | Uint8Array, mode?: number): Promise<void> {
  try {
    if (mode) {
      await writeFile(p, content, { mode })
    } else {
      await writeFile(p, content)
    }
  } catch (e) {
    if (isEnoent(e)) {
      await mkdir(dirname(p), { recursive: true })
      if (mode) {
        await writeFile(p, content, { mode })
      } else {
        await writeFile(p, content)
      }
      return
    }
    throw e
  }
}

export async function writeJson(p: string, data: unknown, mode?: number): Promise<void> {
  return write(p, JSON.stringify(data, null, 2), mode)
}

export async function writeStream(
  p: string,
  stream: ReadableStream<Uint8Array> | Readable,
  mode?: number,
): Promise<void> {
  const dir = dirname(p)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }

  const nodeStream = stream instanceof ReadableStream ? Readable.fromWeb(stream as any) : stream
  const writeStream = createWriteStream(p)
  await pipeline(nodeStream, writeStream)

  if (mode) {
    await chmod(p, mode)
  }
}

export async function mimeType(p: string): Promise<string> {
  const { lookup } = await import("mime-types")
  return lookup(p) || "application/octet-stream"
}

/**
 * On Windows, normalize a path to its canonical casing using the filesystem.
 * This is needed because Windows paths are case-insensitive but LSP servers
 * may return paths with different casing than what we send them.
 */
export function normalizePath(p: string): string {
  if (process.platform !== "win32") return p
  const resolved = win32.normalize(win32.resolve(windowsPath(p)))
  try {
    return realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

export function normalizePathPattern(p: string): string {
  if (process.platform !== "win32") return p
  if (p === "*") return p
  const match = p.match(/^(.*)[\\/]\*$/)
  if (!match) return normalizePath(p)
  const dir = /^[A-Za-z]:$/.test(match[1]) ? match[1] + "\\" : match[1]
  return join(normalizePath(dir), "*")
}

// We cannot rely on path.resolve() here because git.exe may come from Git Bash, Cygwin, or MSYS2, so we need to translate these paths at the boundary.
// Also resolves symlinks so that callers using the result as a cache key
// always get the same canonical path for a given physical directory.
export function resolve(p: string): string {
  const resolved = pathResolve(windowsPath(p))
  try {
    return normalizePath(realpathSync(resolved))
  } catch (e) {
    if (isEnoent(e)) return normalizePath(resolved)
    throw e
  }
}

export function windowsPath(p: string): string {
  if (process.platform !== "win32") return p
  return (
    p
      .replace(/^\/([a-zA-Z]):(?:[\\/]|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
      // Git Bash for Windows paths are typically /<drive>/...
      .replace(/^\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
      // Cygwin git paths are typically /cygdrive/<drive>/...
      .replace(/^\/cygdrive\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
      // WSL paths are typically /mnt/<drive>/...
      .replace(/^\/mnt\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
  )
}
export function overlaps(a: string, b: string) {
  const relA = relative(a, b)
  const relB = relative(b, a)
  return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..")
}

export function contains(parent: string, child: string) {
  return !relative(parent, child).startsWith("..")
}

export async function findUp(
  target: string,
  start: string,
  stop?: string,
  options?: { rootFirst?: boolean },
): Promise<string[]>
export async function findUp(
  target: string[],
  start: string,
  stop?: string,
  options?: { rootFirst?: boolean },
): Promise<string[]>
export async function findUp(
  target: string | string[],
  start: string,
  stop?: string,
  options?: { rootFirst?: boolean },
) {
  const dirs = [start]
  let current = start
  while (true) {
    if (stop === current) break
    const parent = dirname(current)
    if (parent === current) break
    dirs.push(parent)
    current = parent
  }

  const targets = Array.isArray(target) ? target : [target]
  const result = []
  for (const dir of options?.rootFirst ? dirs.toReversed() : dirs) {
    for (const item of targets) {
      const search = join(dir, item)
      if (await exists(search)) result.push(search)
    }
  }
  return result
}

export async function* up(options: { targets: string[]; start: string; stop?: string }) {
  const { targets, start, stop } = options
  let current = start
  while (true) {
    for (const target of targets) {
      const search = join(current, target)
      if (await exists(search)) yield search
    }
    if (stop === current) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

export async function globUp(pattern: string, start: string, stop?: string) {
  let current = start
  const result = []
  while (true) {
    try {
      const matches = await Glob.scan(pattern, {
        cwd: current,
        absolute: true,
        include: "file",
        dot: true,
      })
      result.push(...matches)
    } catch {
      // Skip invalid glob patterns
    }
    if (stop === current) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return result
}

const filesystemRefs = {
  exists,
  isDir,
  stat,
  statAsync,
  size,
  readText,
  readJson,
  readBytes,
  readArrayBuffer,
  write,
  writeJson,
  writeStream,
  mimeType,
  normalizePath,
  normalizePathPattern,
  resolve,
  windowsPath,
  overlaps,
  contains,
  findUp,
  up,
  globUp,
}

export namespace Filesystem {
  export const exists = (...args: Parameters<typeof import("./filesystem").exists>) => filesystemRefs.exists(...args)
  export const isDir = (...args: Parameters<typeof import("./filesystem").isDir>) => filesystemRefs.isDir(...args)
  export const stat = (...args: Parameters<typeof import("./filesystem").stat>) => filesystemRefs.stat(...args)
  export const statAsync = (...args: Parameters<typeof import("./filesystem").statAsync>) => filesystemRefs.statAsync(...args)
  export const size = (...args: Parameters<typeof import("./filesystem").size>) => filesystemRefs.size(...args)
  export const readText = (...args: Parameters<typeof import("./filesystem").readText>) => filesystemRefs.readText(...args)
  export const readJson = <T = unknown>(...args: Parameters<typeof import("./filesystem").readJson<T>>) =>
    filesystemRefs.readJson<T>(...args)
  export const readBytes = (...args: Parameters<typeof import("./filesystem").readBytes>) => filesystemRefs.readBytes(...args)
  export const readArrayBuffer = (...args: Parameters<typeof import("./filesystem").readArrayBuffer>) =>
    filesystemRefs.readArrayBuffer(...args)
  export const write = (...args: Parameters<typeof import("./filesystem").write>) => filesystemRefs.write(...args)
  export const writeJson = (...args: Parameters<typeof import("./filesystem").writeJson>) => filesystemRefs.writeJson(...args)
  export const writeStream = (...args: Parameters<typeof import("./filesystem").writeStream>) => filesystemRefs.writeStream(...args)
  export const mimeType = (...args: Parameters<typeof import("./filesystem").mimeType>) => filesystemRefs.mimeType(...args)
  export const normalizePath = (...args: Parameters<typeof import("./filesystem").normalizePath>) =>
    filesystemRefs.normalizePath(...args)
  export const normalizePathPattern = (...args: Parameters<typeof import("./filesystem").normalizePathPattern>) =>
    filesystemRefs.normalizePathPattern(...args)
  export const resolve = (...args: Parameters<typeof import("./filesystem").resolve>) => filesystemRefs.resolve(...args)
  export const windowsPath = (...args: Parameters<typeof import("./filesystem").windowsPath>) => filesystemRefs.windowsPath(...args)
  export const overlaps = (...args: Parameters<typeof import("./filesystem").overlaps>) => filesystemRefs.overlaps(...args)
  export const contains = (...args: Parameters<typeof import("./filesystem").contains>) => filesystemRefs.contains(...args)
  export const findUp = (...args: Parameters<typeof import("./filesystem").findUp>) => filesystemRefs.findUp(...args)
  export const up = (...args: Parameters<typeof import("./filesystem").up>) => filesystemRefs.up(...args)
  export const globUp = (...args: Parameters<typeof import("./filesystem").globUp>) => filesystemRefs.globUp(...args)
}
