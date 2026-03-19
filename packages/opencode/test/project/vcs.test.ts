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
    Layer.merge(FileWatcher.layer, Vcs.layer),
    async (rt) => {
      await rt.runPromise(FileWatcher.Service.use(() => Effect.void))
      await rt.runPromise(Vcs.Service.use(() => Effect.void))
      await Bun.sleep(500)
      await body(rt)
    },
    { provide: [watcherConfigLayer] },
  )
}

type BranchEvent = { directory?: string; payload: { type: string; properties: { branch?: string } } }

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

async function gitDir(dir: string) {
  return path.resolve(dir, (await $`git rev-parse --git-dir`.cwd(dir).quiet().text()).trim())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeVcs("Vcs", () => {
  afterEach(() => Instance.disposeAll())

  test("branch() returns current branch name", async () => {
    await using tmp = await tmpdir({ git: true })

    await withVcs(tmp.path, async (rt) => {
      const branch = await rt.runPromise(Vcs.Service.use((s) => s.branch()))
      expect(branch).toBeDefined()
      expect(typeof branch).toBe("string")
    })
  })

  test("branch() follows the current worktree branch", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktree = `${tmp.path}-worktree`
    const branch = `test-${Math.random().toString(36).slice(2)}`

    await $`git worktree add -b ${branch} ${worktree}`.cwd(tmp.path).quiet()

    try {
      await withVcs(worktree, async (rt) => {
        const current = await rt.runPromise(Vcs.Service.use((s) => s.branch()))
        expect(current).toBe(branch)
      })
    } finally {
      await $`git worktree remove --force ${worktree}`.cwd(tmp.path).quiet().nothrow()
      await $`rm -rf ${worktree}`.quiet().nothrow()
    }
  })

  test("publishes BranchUpdated when a linked worktree HEAD changes after startup", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktree = `${tmp.path}-worktree`
    const branch = `test-${Math.random().toString(36).slice(2)}`
    const next = `test-${Math.random().toString(36).slice(2)}`

    await $`git branch ${next}`.cwd(tmp.path).quiet()
    await $`git worktree add -b ${branch} ${worktree}`.cwd(tmp.path).quiet()

    try {
      await withVcs(worktree, async (rt) => {
        const current = await rt.runPromise(Vcs.Service.use((s) => s.branch()))
        expect(current).toBe(branch)

        const pending = nextBranchUpdate(worktree)
        await fs.writeFile(path.join(await gitDir(worktree), "HEAD"), `ref: refs/heads/${next}\n`)

        const updated = await pending
        expect(updated).toBe(next)

        const after = await rt.runPromise(Vcs.Service.use((s) => s.branch()))
        expect(after).toBe(next)
      })
    } finally {
      await $`git worktree remove --force ${worktree}`.cwd(tmp.path).quiet().nothrow()
      await $`rm -rf ${worktree}`.quiet().nothrow()
    }
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
