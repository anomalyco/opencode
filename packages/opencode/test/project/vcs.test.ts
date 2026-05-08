import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import { parsePatch } from "diff"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { AppRuntime } from "../../src/effect/app-runtime"
import { FileWatcher } from "../../src/file/watcher"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { GlobalBus } from "../../src/bus/global"
import { Vcs } from "@/project/vcs"

// Skip in CI — native @parcel/watcher binding needed
const describeVcs = FileWatcher.hasNativeBinding() && !process.env.CI ? describe : describe.skip

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withVcs(directory: string, body: () => Promise<void>) {
  return WithInstance.provide({
    directory,
    fn: async () => {
      await AppRuntime.runPromise(
        Effect.gen(function* () {
          const watcher = yield* FileWatcher.Service
          const vcs = yield* Vcs.Service
          yield* watcher.init()
          yield* vcs.init()
        }),
      )
      await Bun.sleep(500)
      await body()
    },
  })
}

function withVcsOnly(directory: string, body: () => Promise<void>) {
  return WithInstance.provide({
    directory,
    fn: async () => {
      await AppRuntime.runPromise(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          yield* vcs.init()
        }),
      )
      await body()
    },
  })
}

type BranchEvent = { directory?: string; payload: { type: string; properties: { branch?: string } } }
const weird = process.platform === "win32" ? "space file.txt" : "tab\tfile.txt"

/** Wait for a Vcs.Event.BranchUpdated event on GlobalBus, with retry polling as fallback */
function nextBranchUpdate(directory: string, timeout = 10_000) {
  return new Promise<string | undefined>((resolve, reject) => {
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      GlobalBus.off("event", on)
      reject(new Error("timed out waiting for BranchUpdated event"))
    }, timeout)

    function on(evt: BranchEvent) {
      if (evt.directory !== directory) return
      if (evt.payload.type !== Vcs.Event.BranchUpdated.type) return
      if (settled) return
      settled = true
      clearTimeout(timer)
      GlobalBus.off("event", on)
      resolve(evt.payload.properties.branch)
    }

    GlobalBus.on("event", on)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeVcs("Vcs", () => {
  afterEach(async () => {
    await disposeAllInstances()
  })

  test("branch() returns current branch name", async () => {
    await using tmp = await tmpdir({ git: true })

    await withVcs(tmp.path, async () => {
      const branch = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          return yield* vcs.branch()
        }),
      )
      expect(branch).toBeDefined()
      expect(typeof branch).toBe("string")
    })
  })

  test("branch() returns undefined for non-git directories", async () => {
    await using tmp = await tmpdir()

    await withVcs(tmp.path, async () => {
      const branch = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          return yield* vcs.branch()
        }),
      )
      expect(branch).toBeUndefined()
    })
  })

  test("publishes BranchUpdated when .git/HEAD changes", async () => {
    await using tmp = await tmpdir({ git: true })
    const branch = `test-${Math.random().toString(36).slice(2)}`
    await $`git branch ${branch}`.cwd(tmp.path).quiet()

    await withVcs(tmp.path, async () => {
      const pending = nextBranchUpdate(tmp.path)

      const head = path.join(tmp.path, ".git", "HEAD")
      await fs.writeFile(head, `ref: refs/heads/${branch}\n`)

      const updated = await pending
      expect(updated).toBe(branch)
    })
  })

  test("branch() reflects the new branch after HEAD change", async () => {
    await using tmp = await tmpdir({ git: true })
    const branch = `test-${Math.random().toString(36).slice(2)}`
    await $`git branch ${branch}`.cwd(tmp.path).quiet()

    await withVcs(tmp.path, async () => {
      const pending = nextBranchUpdate(tmp.path)

      const head = path.join(tmp.path, ".git", "HEAD")
      await fs.writeFile(head, `ref: refs/heads/${branch}\n`)

      await pending
      const current = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          return yield* vcs.branch()
        }),
      )
      expect(current).toBe(branch)
    })
  })
})

describe("Vcs diff", () => {
  afterEach(async () => {
    await disposeAllInstances()
  })

  test("defaultBranch() falls back to main", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git branch -M main`.cwd(tmp.path).quiet()

    await withVcsOnly(tmp.path, async () => {
      const branch = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          return yield* vcs.defaultBranch()
        }),
      )
      expect(branch).toBe("main")
    })
  })

  test("defaultBranch() uses init.defaultBranch when available", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git branch -M trunk`.cwd(tmp.path).quiet()
    await $`git config init.defaultBranch trunk`.cwd(tmp.path).quiet()

    await withVcsOnly(tmp.path, async () => {
      const branch = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          return yield* vcs.defaultBranch()
        }),
      )
      expect(branch).toBe("trunk")
    })
  })

  test("detects current branch from the active worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    await using wt = await tmpdir()
    await $`git branch -M main`.cwd(tmp.path).quiet()
    const dir = path.join(wt.path, "feature")
    await $`git worktree add -b feature/test ${dir} HEAD`.cwd(tmp.path).quiet()

    await withVcsOnly(dir, async () => {
      const [branch, base] = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          return yield* Effect.all([vcs.branch(), vcs.defaultBranch()], { concurrency: 2 })
        }),
      )
      expect(branch).toBe("feature/test")
      expect(base).toBe("main")
    })
  })

  test("diff('git') returns uncommitted changes", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "file.txt"), "original\n", "utf-8")
    await $`git add .`.cwd(tmp.path).quiet()
    await $`git commit --no-gpg-sign -m "add file"`.cwd(tmp.path).quiet()
    await fs.writeFile(path.join(tmp.path, "file.txt"), "changed\n", "utf-8")

    await withVcsOnly(tmp.path, async () => {
      const diff = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          return yield* vcs.diff("git")
        }),
      )
      expect(diff).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "file.txt",
            status: "modified",
          }),
        ]),
      )
      expect(diff.find((item) => item.file === "file.txt")?.patch).toContain("diff --git")
    })
  })

  test("diff('git') handles special filenames", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, weird), "hello\n", "utf-8")

    await withVcsOnly(tmp.path, async () => {
      const diff = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          return yield* vcs.diff("git")
        }),
      )
      expect(diff).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: weird,
            status: "added",
          }),
        ]),
      )
    })
  })

  test("diff('git') keeps batched patches aligned for type changes", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "a.txt"), "old\n", "utf-8")
    await fs.writeFile(path.join(tmp.path, "b.txt"), "old\n", "utf-8")
    await $`git add .`.cwd(tmp.path).quiet()
    await $`git commit --no-gpg-sign -m "add files"`.cwd(tmp.path).quiet()
    await fs.unlink(path.join(tmp.path, "a.txt"))
    await fs.symlink("target", path.join(tmp.path, "a.txt"))
    await fs.writeFile(path.join(tmp.path, "b.txt"), "new\n", "utf-8")

    await withVcsOnly(tmp.path, async () => {
      const diff = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          return yield* vcs.diff("git")
        }),
      )
      const a = diff.find((item) => item.file === "a.txt")
      const b = diff.find((item) => item.file === "b.txt")

      expect(a?.patch).toContain("deleted file mode")
      expect(a?.patch).toContain("new file mode")
      expect(b?.patch).toContain("+new")
    })
  })

  test("diff('git') keeps carriage returns inside patch hunks", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "file.txt"), "keep\nsame\rdiff --git inside\ndelete\n", "utf-8")
    await $`git add .`.cwd(tmp.path).quiet()
    await $`git commit --no-gpg-sign -m "add file"`.cwd(tmp.path).quiet()
    await fs.writeFile(path.join(tmp.path, "file.txt"), "keep\nadd\nsame\rdiff --git inside\n", "utf-8")

    await withVcsOnly(tmp.path, async () => {
      const diff = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          return yield* vcs.diff("git")
        }),
      )
      const file = diff.find((item) => item.file === "file.txt")

      expect(file?.patch).toContain(" same\rdiff --git inside")
      expect(file?.patch).toContain("-delete")
      expect(() => parsePatch(file?.patch ?? "")).not.toThrow()
    })
  }, 20_000)

  test("diff('branch') returns changes against default branch", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git branch -M main`.cwd(tmp.path).quiet()
    await $`git checkout -b feature/test`.cwd(tmp.path).quiet()
    await fs.writeFile(path.join(tmp.path, "branch.txt"), "hello\n", "utf-8")
    await $`git add .`.cwd(tmp.path).quiet()
    await $`git commit --no-gpg-sign -m "branch file"`.cwd(tmp.path).quiet()

    await withVcsOnly(tmp.path, async () => {
      const diff = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          return yield* vcs.diff("branch")
        }),
      )
      expect(diff).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "branch.txt",
            status: "added",
          }),
        ]),
      )
    })
  })
})
