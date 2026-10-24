import os from "node:os"
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import path from "path"
import { afterAll, describe, expect, test } from "bun:test"
import { Effect, FileSystem, Layer, PlatformError } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const failure = (tag: "PermissionDenied" | "Unknown", code: string, method: string, path: string) =>
  PlatformError.systemError({
    _tag: tag,
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
    cause: Object.assign(new Error(code), { code }),
  })

const denied = (tag: "PermissionDenied" | "Unknown", code: string) =>
  FSUtil.layer.pipe(
    Layer.provide(
      FileSystem.layerNoop({
        realPath: (path) => Effect.fail(failure(tag, code, "realPath", path)),
        readFileString: (path) => Effect.fail(failure(tag, code, "readFile", path)),
      }),
    ),
  )

describe("FSUtil", () => {
  for (const input of [
    { tag: "PermissionDenied", code: "EACCES" },
    // macOS sandbox and privacy denials arrive as Unknown with an EPERM cause.
    { tag: "Unknown", code: "EPERM" },
  ] as const) {
    it.effect(`treats ${input.code} as an unresolvable, unreadable path`, () =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        expect(yield* fs.resolve("/denied/.agents")).toBe(path.resolve("/denied/.agents"))
        expect(yield* fs.readFileStringSafe("/denied/AGENTS.md")).toBeUndefined()
      }).pipe(Effect.provide(denied(input.tag, input.code))),
    )
  }

  it.effect("keeps other realPath failures fatal", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const exit = yield* fs.resolve("/broken").pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }).pipe(Effect.provide(denied("Unknown", "EIO"))),
  )
})

const root = mkdtempSync(path.join(os.tmpdir(), "opencode-realpath-"))
const target = path.join(root, "target")
const link = path.join(root, "alias")
mkdirSync(target)
writeFileSync(path.join(target, "inside.txt"), "synthetic")
symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir")
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("FSUtil.resolve (sync)", () => {
  test("canonicalizes an existing file through a directory alias", () => {
    expect(FSUtil.resolve(path.join(link, "inside.txt"))).toBe(realpathSync.native(path.join(target, "inside.txt")))
  })

  test("resolves its own canonical result again", () => {
    const physical = FSUtil.resolve(link)
    expect(FSUtil.resolve(physical)).toBe(physical)
    expect(physical).toBe(realpathSync.native(target))
  })

  test("preserves the missing-path fallback", () => {
    const missing = path.join(root, "missing", "child")
    expect(FSUtil.resolve(missing)).toBe(path.resolve(missing))
  })

  test("keeps a junction target outside the selected directory recognizable", () => {
    const selected = path.join(root, "selected")
    mkdirSync(selected)
    const alias = path.join(selected, "outside")
    symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir")
    expect(FSUtil.resolve(alias)).toBe(realpathSync.native(target))
    expect(FSUtil.contains(FSUtil.resolve(selected), FSUtil.resolve(alias))).toBe(false)
  })

  test("rejects a directory-alias cycle", () => {
    const a = path.join(root, "cycle-a")
    const b = path.join(root, "cycle-b")
    const type = process.platform === "win32" ? "junction" : "dir"
    symlinkSync(b, a, type)
    symlinkSync(a, b, type)
    try {
      expect(() => FSUtil.resolve(a)).toThrow()
    } finally {
      unlinkSync(a)
      unlinkSync(b)
    }
  })

  // Ordinary host tests cannot create an AppContainer denial by chmod on Windows.
  // This same file can also run inside an AppContainer with only its temp granted.
  const denied = (() => {
    if (process.platform !== "win32") return
    const drive = path.parse(realpathSync.native(target)).root
    try {
      lstatSync(drive)
    } catch (error) {
      if (error instanceof Error && "code" in error && (error.code === "EPERM" || error.code === "EACCES")) return drive
      throw error
    }
  })()
  test.skipIf(!denied)("propagates an actual Windows access denial", () => {
    if (!denied) throw new Error("A restricted drive root is required")
    expect(() => FSUtil.resolve(denied)).toThrow()
  })
})
