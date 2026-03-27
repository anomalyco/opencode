import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, ManagedRuntime } from "effect"
import { tmpdir } from "../fixture/fixture"
import { watcherConfigLayer, withServices } from "../fixture/instance"
import { FileWatcher } from "../../src/file/watcher"
import { Instance } from "../../src/project/instance"
import { GlobalBus } from "../../src/bus/global"
import { Vcs } from "../../src/project/vcs"

// Skip in CI — native @parcel/watcher binding needed
const describeVcs = FileWatcher.hasNativeBinding() && !process.env.CI ? describe : describe.skip

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withVcs(
  directory: string,
  body: (rt: ManagedRuntime.ManagedRuntime<FileWatcher.Service | Vcs.Service, never>) => Promise<void>,
) {
  return withServices(
    directory,
    Layer.merge(FileWatcher.layer, Vcs.defaultLayer),
    async (rt) => {
      await rt.runPromise(FileWatcher.Service.use((s) => s.init()))
      await rt.runPromise(Vcs.Service.use((s) => s.init()))
      await Bun.sleep(500)
      await body(rt)
    },
    { provide: [watcherConfigLayer] },
  )
}

function withVcsOnly(
  directory: string,
  body: (rt: ManagedRuntime.ManagedRuntime<Vcs.Service, never>) => Promise<void>,
) {
  return withServices(directory, Vcs.defaultLayer, body)
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
    await Instance.disposeAll()
  })

  test("branch() returns current branch name", async () => {
    await using tmp = await tmpdir({ git: true })

    await withVcs(tmp.path, async (rt) => {
      const branch = await rt.runPromise(Vcs.Service.use((s) => s.branch()))
      expect(branch).toBeDefined()
      expect(typeof branch).toBe("string")
    })
  })

  test("branch() returns undefined for non-git directories", async () => {
    await using tmp = await tmpdir()

    await withVcs(tmp.path, async (rt) => {
      const branch = await rt.runPromise(Vcs.Service.use((s) => s.branch()))
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

    await withVcs(tmp.path, async (rt) => {
      const pending = nextBranchUpdate(tmp.path)

      const head = path.join(tmp.path, ".git", "HEAD")
      await fs.writeFile(head, `ref: refs/heads/${branch}\n`)

      await pending
      const current = await rt.runPromise(Vcs.Service.use((s) => s.branch()))
      expect(current).toBe(branch)
    })
  })
})

describe("Vcs diff", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("defaultBranch() falls back to main", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git branch -M main`.cwd(tmp.path).quiet()

    await withVcsOnly(tmp.path, async (rt) => {
      const branch = await rt.runPromise(Vcs.Service.use((s) => s.defaultBranch()))
      expect(branch).toBe("main")
    })
  })

  test("defaultBranch() uses init.defaultBranch when available", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git branch -M trunk`.cwd(tmp.path).quiet()
    await $`git config init.defaultBranch trunk`.cwd(tmp.path).quiet()

    await withVcsOnly(tmp.path, async (rt) => {
      const branch = await rt.runPromise(Vcs.Service.use((s) => s.defaultBranch()))
      expect(branch).toBe("trunk")
    })
  })

  test("detects current branch from the active worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    await using wt = await tmpdir()
    await $`git branch -M main`.cwd(tmp.path).quiet()
    const dir = path.join(wt.path, "feature")
    await $`git worktree add -b feature/test ${dir} HEAD`.cwd(tmp.path).quiet()

    await withVcsOnly(dir, async (rt) => {
      const [branch, base] = await Promise.all([
        rt.runPromise(Vcs.Service.use((s) => s.branch())),
        rt.runPromise(Vcs.Service.use((s) => s.defaultBranch())),
      ])
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

    await withVcsOnly(tmp.path, async (rt) => {
      const diff = await rt.runPromise(Vcs.Service.use((s) => s.diff("git")))
      expect(diff).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "file.txt",
            status: "modified",
          }),
        ]),
      )
    })
  })

  test("diff('git') handles special filenames", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, weird), "hello\n", "utf-8")

    await withVcsOnly(tmp.path, async (rt) => {
      const diff = await rt.runPromise(Vcs.Service.use((s) => s.diff("git")))
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

  test("diff('branch') returns changes against default branch", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git branch -M main`.cwd(tmp.path).quiet()
    await $`git checkout -b feature/test`.cwd(tmp.path).quiet()
    await fs.writeFile(path.join(tmp.path, "branch.txt"), "hello\n", "utf-8")
    await $`git add .`.cwd(tmp.path).quiet()
    await $`git commit --no-gpg-sign -m "branch file"`.cwd(tmp.path).quiet()

    await withVcsOnly(tmp.path, async (rt) => {
      const diff = await rt.runPromise(Vcs.Service.use((s) => s.diff("branch")))
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
