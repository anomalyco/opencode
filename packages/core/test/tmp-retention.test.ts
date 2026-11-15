import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { TmpRetention } from "@opencode/core/tmp-retention"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const day = 24 * 60 * 60 * 1_000
// ctime cannot be set back, so tests move "now" forward instead: everything written here is then 8 days old.
const later = Date.now() + 8 * day

const write = (file: string) =>
  Effect.promise(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "x")
  })
const touchLater = (file: string) => Effect.promise(() => fs.utimes(file, new Date(later), new Date(later)))
const exists = (file: string) =>
  Effect.promise(() =>
    fs.access(file).then(
      () => true,
      () => false,
    ),
  )

describe("TmpRetention", () => {
  it.live("deletes whole units that nothing touched within the retention", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const stale = path.join(tmp.path, "job-a", "node_modules", "dep", "index.js")
        const scratch = path.join(tmp.path, "notes.txt")
        const oldUpload = path.join(tmp.path, "uploads", "u1", "photo.png")
        const newUpload = path.join(tmp.path, "uploads", "u2", "photo.png")
        for (const file of [stale, scratch, oldUpload, newUpload]) yield* write(file)
        yield* touchLater(newUpload)

        yield* TmpRetention.cleanup(tmp.path, later)

        expect(yield* exists(path.join(tmp.path, "job-a"))).toBe(false)
        expect(yield* exists(scratch)).toBe(false)
        expect(yield* exists(path.join(tmp.path, "uploads", "u1"))).toBe(false)
        expect(yield* exists(newUpload)).toBe(true)
        expect(yield* exists(tmp.path)).toBe(true)
      }),
    ),
  )

  it.live("keeps every file of a unit that is still in use, however old the rest is", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const dependency = path.join(tmp.path, "job-b", "node_modules", "dep", "index.js")
        const source = path.join(tmp.path, "job-b", "src", "main.ts")
        yield* write(dependency)
        yield* write(source)
        yield* touchLater(source)

        yield* TmpRetention.cleanup(tmp.path, later)

        expect(yield* exists(dependency)).toBe(true)
        expect(yield* exists(source)).toBe(true)
      }),
    ),
  )

  it.live("keeps files created just now even when their mtime is old", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const extracted = path.join(tmp.path, "pkg", "package.json")
        yield* write(extracted)
        // What tar and `cp -p` do: the content is new but keeps an old mtime.
        yield* Effect.promise(() => fs.utimes(extracted, new Date(0), new Date(500_000_000_000)))

        yield* TmpRetention.cleanup(tmp.path)

        expect(yield* exists(extracted)).toBe(true)
      }),
    ),
  )
})
