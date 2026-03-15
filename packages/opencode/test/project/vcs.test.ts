import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Layer, ManagedRuntime } from "effect"
import { tmpdir } from "../fixture/fixture"
import { watcherConfigLayer, withServices } from "../fixture/instance"
import { FileWatcher, FileWatcherService } from "../../src/file/watcher"
import { Instance } from "../../src/project/instance"
import { GlobalBus } from "../../src/bus/global"
import { Vcs, VcsService } from "../../src/project/vcs"

// Skip in CI — native @parcel/watcher binding needed
const describeVcs = FileWatcher.hasNativeBinding() && !process.env.CI ? describe : describe.skip

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withVcs(
  directory: string,
  body: (rt: ManagedRuntime.ManagedRuntime<FileWatcherService | VcsService, never>) => Promise<void>,
) {
  return withServices(
    directory,
    Layer.merge(FileWatcherService.layer, VcsService.layer),
    async (rt) => {
      await rt.runPromise(FileWatcherService.use((s) => s.init()))
      await rt.runPromise(VcsService.use((s) => s.init()))
      await Bun.sleep(200)
      await body(rt)
    },
    { provide: [watcherConfigLayer] },
  )
}

type BranchEvent = { directory?: string; payload: { type: string; properties: { branch?: string } } }

/** Wait for a Vcs.Event.BranchUpdated event on GlobalBus */
function nextBranchUpdate(directory: string, timeout = 5000) {
  return new Promise<string | undefined>((resolve, reject) => {
    const timer = setTimeout(() => {
      GlobalBus.off("event", on)
      reject(new Error("timed out waiting for BranchUpdated event"))
    }, timeout)

    function on(evt: BranchEvent) {
      if (evt.directory !== directory) return
      if (evt.payload.type !== Vcs.Event.BranchUpdated.type) return
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
  afterEach(() => Instance.disposeAll())

  test("branch() returns current branch name", async () => {
    await using tmp = await tmpdir({ git: true })

    await withVcs(tmp.path, async (rt) => {
      const branch = await rt.runPromise(VcsService.use((s) => s.branch()))
      expect(branch).toBeDefined()
      expect(typeof branch).toBe("string")
    })
  })

  test("branch() returns undefined for non-git directories", async () => {
    await using tmp = await tmpdir()

    await withVcs(tmp.path, async (rt) => {
      const branch = await rt.runPromise(VcsService.use((s) => s.branch()))
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
      const current = await rt.runPromise(VcsService.use((s) => s.branch()))
      expect(current).toBe(branch)
    })
  })
})
