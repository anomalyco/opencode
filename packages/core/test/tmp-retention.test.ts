import { describe, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { FSUtil } from "@opencode/util/fs-util"
import { TmpRetention } from "@opencode/core/tmp-retention"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const fsLayer = AppNodeBuilder.build(FSUtil.node, [])
const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000)

describe("TmpRetention", () => {
  it.live("deletes stale files at any depth and the directories they leave empty", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const upload = path.join(tmp.path, "uploads", "a", "photo.png")
        const image = path.join(tmp.path, "images", "ses_1", "image_1.png")
        const fresh = path.join(tmp.path, "images", "ses_1", "image_2.png")
        const scratch = path.join(tmp.path, "notes.txt")
        for (const file of [upload, image, fresh, scratch]) yield* fs.writeWithDirs(file, "x")
        for (const file of [upload, image, scratch]) yield* fs.utimes(file, old, old)
        for (const directory of ["uploads", "uploads/a", "images", "images/ses_1"])
          yield* fs.utimes(path.join(tmp.path, directory), old, old)

        yield* TmpRetention.cleanup(fs, tmp.path)

        expect(yield* fs.exists(upload)).toBe(false)
        expect(yield* fs.exists(image)).toBe(false)
        expect(yield* fs.exists(scratch)).toBe(false)
        expect(yield* fs.exists(fresh)).toBe(true)
        expect(yield* fs.exists(path.join(tmp.path, "uploads"))).toBe(false)
        expect(yield* fs.exists(path.join(tmp.path, "images", "ses_1"))).toBe(true)
        expect(yield* fs.exists(tmp.path)).toBe(true)
      }),
    ).pipe(Effect.provide(fsLayer)),
  )

  it.live("keeps a recently created empty directory and files without a real timestamp", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const directory = path.join(tmp.path, "uploads", "b")
        const epoch = path.join(tmp.path, "epoch.txt")
        yield* fs.ensureDir(directory)
        yield* fs.writeFileString(epoch, "x")
        yield* fs.utimes(epoch, new Date(0), new Date(0))

        yield* TmpRetention.cleanup(fs, tmp.path)

        expect(yield* fs.exists(directory)).toBe(true)
        expect(yield* fs.exists(epoch)).toBe(true)
      }),
    ).pipe(Effect.provide(fsLayer)),
  )
})
