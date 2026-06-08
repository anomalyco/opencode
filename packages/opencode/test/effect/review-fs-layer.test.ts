import { afterEach, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ReviewOverlay } from "@opencode-ai/core/review-overlay"
import { ReviewFs } from "@/effect/review-fs-layer"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(ReviewFs.defaultLayer)

afterEach(() => {
  ReviewOverlay.reset()
})

const readDisk = (filepath: string) => Effect.promise(() => fs.readFile(filepath, "utf-8").catch(() => ""))

describe("ReviewFs overlay", () => {
  it.instance("stages writes without mutating disk", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const afs = yield* FSUtil.Service
      ReviewOverlay.setEnabled(true)
      ReviewOverlay.setActiveSession("sess-1")

      const filepath = path.join(test.directory, "staged.txt")
      yield* afs.writeWithDirs(filepath, "staged content")

      expect(yield* readDisk(filepath)).toBe("")
      expect(yield* afs.readFileString(filepath)).toBe("staged content")
      expect(yield* afs.exists(filepath)).toBe(true)
      expect(yield* afs.isFile(filepath)).toBe(true)
      const info = yield* afs.stat(filepath)
      expect(info.type).toBe("File")
    }),
  )

  it.instance("read-after-write returns latest staged content", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const afs = yield* FSUtil.Service
      ReviewOverlay.setEnabled(true)

      const filepath = path.join(test.directory, "twice.txt")
      yield* afs.writeWithDirs(filepath, "first")
      yield* afs.writeWithDirs(filepath, "second")
      expect(yield* afs.readFileString(filepath)).toBe("second")
      expect(yield* readDisk(filepath)).toBe("")
    }),
  )

  it.instance("readFile returns staged bytes for Bom.readFile", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const afs = yield* FSUtil.Service
      ReviewOverlay.setEnabled(true)

      const filepath = path.join(test.directory, "bytes.txt")
      yield* afs.writeWithDirs(filepath, "utf8 body")
      const bytes = yield* afs.readFile(filepath)
      expect(new TextDecoder().decode(bytes)).toBe("utf8 body")
    }),
  )

  it.instance("markDeleted hides overlay paths", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const afs = yield* FSUtil.Service
      ReviewOverlay.setEnabled(true)

      const filepath = path.join(test.directory, "gone.txt")
      yield* Effect.promise(() => fs.writeFile(filepath, "on disk", "utf-8"))
      ReviewOverlay.markDeleted(filepath)

      expect(yield* afs.exists(filepath)).toBe(false)
      expect(yield* afs.isFile(filepath)).toBe(false)
      const stat = yield* afs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      expect(stat).toBeUndefined()
    }),
  )

  it.instance("updates see staged content from disk baseline", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const afs = yield* FSUtil.Service
      ReviewOverlay.setEnabled(true)

      const filepath = path.join(test.directory, "base.txt")
      yield* Effect.promise(() => fs.writeFile(filepath, "line1\nline2\n", "utf-8"))
      yield* afs.writeWithDirs(filepath, "line1\nchanged\n")

      expect(yield* afs.readFileString(filepath)).toBe("line1\nchanged\n")
      expect(yield* readDisk(filepath)).toBe("line1\nline2\n")
    }),
  )
})
