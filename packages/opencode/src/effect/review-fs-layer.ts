import { Effect, FileSystem, Layer, Option } from "effect"
import * as PlatformError from "effect/PlatformError"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ReviewOverlay } from "@opencode-ai/core/review-overlay"

// FSUtil layer for ACP review mode. It wraps the real FSUtil: writes are sent to
// the ReviewOverlay (staged in memory) and reads return staged content, so the
// agent sees its own pending edits without touching disk. When review mode is
// off, every call passes straight through to the real FSUtil.

const overlayNotFound = (method: string, path: string) =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
    syscall: method,
  })

function overlayFileStat(content: string): FileSystem.File.Info {
  const now = Option.some(new Date())
  return {
    type: "File",
    mtime: now,
    atime: now,
    birthtime: now,
    dev: 0,
    rdev: Option.some(0),
    ino: Option.none(),
    mode: 0o644,
    nlink: Option.some(1),
    uid: Option.none(),
    gid: Option.none(),
    size: FileSystem.Size(new TextEncoder().encode(content).length),
    blksize: Option.none(),
    blocks: Option.none(),
  }
}

export const layer = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const readFileString = Effect.fn("ReviewFs.readFileString")(function* (path: string) {
      if (!ReviewOverlay.isEnabled()) return yield* fs.readFileString(path)
      const entry = ReviewOverlay.get(path)
      if (entry) {
        if ("deleted" in entry) return yield* Effect.fail(overlayNotFound("readFileString", path))
        return entry.content
      }
      return yield* fs.readFileString(path)
    })

    const readFile = Effect.fn("ReviewFs.readFile")(function* (path: string) {
      if (!ReviewOverlay.isEnabled()) return yield* fs.readFile(path)
      const entry = ReviewOverlay.get(path)
      if (entry) {
        if ("deleted" in entry) return yield* Effect.fail(overlayNotFound("readFile", path))
        return new TextEncoder().encode(entry.content)
      }
      return yield* fs.readFile(path)
    })

    const readFileStringSafe = Effect.fn("ReviewFs.readFileStringSafe")(function* (path: string) {
      if (!ReviewOverlay.isEnabled()) return yield* fs.readFileStringSafe(path)
      const entry = ReviewOverlay.get(path)
      if (entry) {
        if ("deleted" in entry) return undefined
        return entry.content
      }
      return yield* fs.readFileStringSafe(path)
    })

    const exists = Effect.fn("ReviewFs.exists")(function* (path: string) {
      if (!ReviewOverlay.isEnabled()) return yield* fs.exists(path)
      const entry = ReviewOverlay.get(path)
      if (entry) return !("deleted" in entry)
      return yield* fs.exists(path)
    })

    const stat = Effect.fn("ReviewFs.stat")(function* (path: string) {
      if (!ReviewOverlay.isEnabled()) return yield* fs.stat(path)
      const entry = ReviewOverlay.get(path)
      if (entry) {
        if ("deleted" in entry) return yield* Effect.fail(overlayNotFound("stat", path))
        const disk = yield* fs.stat(path).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (disk?.type === "File") {
          return { ...disk, size: FileSystem.Size(new TextEncoder().encode(entry.content).length) }
        }
        if (disk) return disk
        return overlayFileStat(entry.content)
      }
      return yield* fs.stat(path)
    })

    const isFile = Effect.fn("ReviewFs.isFile")(function* (path: string) {
      if (!ReviewOverlay.isEnabled()) return yield* fs.isFile(path)
      const entry = ReviewOverlay.get(path)
      if (entry) return !("deleted" in entry)
      return yield* fs.isFile(path)
    })

    const isDir = Effect.fn("ReviewFs.isDir")(function* (path: string) {
      if (!ReviewOverlay.isEnabled()) return yield* fs.isDir(path)
      const entry = ReviewOverlay.get(path)
      if (entry) return false
      return yield* fs.isDir(path)
    })

    const writeWithDirs = Effect.fn("ReviewFs.writeWithDirs")(function* (
      path: string,
      content: string | Uint8Array,
      mode?: number,
    ) {
      // Only text writes can be staged and shown in the review UI. Binary writes
      // (and any write while review mode is off) go straight to disk.
      if (!ReviewOverlay.isEnabled() || typeof content !== "string") {
        return yield* fs.writeWithDirs(path, content, mode)
      }
      ReviewOverlay.stage(path, content)
    })

    return FSUtil.Service.of({
      ...fs,
      readFileString,
      readFile,
      readFileStringSafe,
      exists,
      stat,
      isFile,
      isDir,
      writeWithDirs,
    })
  }),
).pipe(Layer.provide(FSUtil.defaultLayer))

export const defaultLayer = layer

export const node = LayerNode.make(layer, [FSUtil.node])

export * as ReviewFs from "./review-fs-layer"
