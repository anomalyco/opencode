import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"

const it = process.platform === "win32" ? (await import("../lib/effect")).testEffect((await import("../../src/file")).File.defaultLayer) : undefined

describe("file fsmonitor", () => {
  if (!it) {
    test.skip("status does not start fsmonitor for readonly git checks", () => {})
    test.skip("read does not start fsmonitor for git diffs", () => {})
    return
  }

  it.instance(
    "status does not start fsmonitor for readonly git checks",
    () =>
      Effect.gen(function* () {
        const { File } = yield* Effect.promise(() => import("../../src/file"))
        const { TestInstance } = yield* Effect.promise(() => import("../fixture/fixture"))
        const directory = (yield* TestInstance).directory
        const target = path.join(directory, "tracked.txt")

        yield* Effect.promise(() => fs.writeFile(target, "base\n"))
        yield* Effect.promise(() => $`git add tracked.txt`.cwd(directory).quiet())
        yield* Effect.promise(() => $`git commit -m init`.cwd(directory).quiet())
        yield* Effect.promise(() => $`git config core.fsmonitor true`.cwd(directory).quiet())
        yield* Effect.promise(() => $`git fsmonitor--daemon stop`.cwd(directory).quiet().nothrow())
        yield* Effect.promise(() => fs.writeFile(target, "next\n"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "new.txt"), "new\n"))

        const before = yield* Effect.promise(() => $`git fsmonitor--daemon status`.cwd(directory).quiet().nothrow())
        expect(before.exitCode).not.toBe(0)

        yield* File.Service.use((svc) => svc.status())

        const after = yield* Effect.promise(() => $`git fsmonitor--daemon status`.cwd(directory).quiet().nothrow())
        expect(after.exitCode).not.toBe(0)
      }),
    { git: true },
  )

  it.instance(
    "read does not start fsmonitor for git diffs",
    () =>
      Effect.gen(function* () {
        const { File } = yield* Effect.promise(() => import("../../src/file"))
        const { TestInstance } = yield* Effect.promise(() => import("../fixture/fixture"))
        const directory = (yield* TestInstance).directory
        const target = path.join(directory, "tracked.txt")

        yield* Effect.promise(() => fs.writeFile(target, "base\n"))
        yield* Effect.promise(() => $`git add tracked.txt`.cwd(directory).quiet())
        yield* Effect.promise(() => $`git commit -m init`.cwd(directory).quiet())
        yield* Effect.promise(() => $`git config core.fsmonitor true`.cwd(directory).quiet())
        yield* Effect.promise(() => $`git fsmonitor--daemon stop`.cwd(directory).quiet().nothrow())
        yield* Effect.promise(() => fs.writeFile(target, "next\n"))

        const before = yield* Effect.promise(() => $`git fsmonitor--daemon status`.cwd(directory).quiet().nothrow())
        expect(before.exitCode).not.toBe(0)

        yield* File.Service.use((svc) => svc.read("tracked.txt"))

        const after = yield* Effect.promise(() => $`git fsmonitor--daemon status`.cwd(directory).quiet().nothrow())
        expect(after.exitCode).not.toBe(0)
      }),
    { git: true },
  )
})
