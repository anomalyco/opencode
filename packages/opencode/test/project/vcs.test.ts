import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ConfigProvider, Deferred, Effect, Fiber, Layer, ManagedRuntime, Option } from "effect"
import { tmpdir } from "../fixture/fixture"
import { FileWatcher, FileWatcherService } from "../../src/file/watcher"
import { InstanceContext } from "../../src/effect/instances"
import { Instance } from "../../src/project/instance"
import { GlobalBus } from "../../src/bus/global"
import { Vcs } from "../../src/project/vcs"

// Skip in CI — native @parcel/watcher binding needed
const describeVcs = FileWatcher.hasNativeBinding() && !process.env.CI ? describe : describe.skip

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const configLayer = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "false",
  }),
)

/** Boot watcher + vcs inside an Instance, return a disposable runtime */
function withInstance(directory: string, body: () => Promise<void>) {
  return Instance.provide({
    directory,
    fn: async () => {
      const ctx = Layer.sync(InstanceContext, () =>
        InstanceContext.of({ directory: Instance.directory, project: Instance.project }),
      )
      const layer = Layer.fresh(FileWatcherService.layer).pipe(Layer.provide(ctx), Layer.provide(configLayer))
      const rt = ManagedRuntime.make(layer)
      try {
        await rt.runPromise(FileWatcherService.use((s) => s.init()))
        Vcs.init()
        await Bun.sleep(200)
        await body()
      } finally {
        await rt.dispose()
      }
    },
  })
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

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Vcs.init()
        const branch = await Vcs.branch()
        // tmpdir creates a git repo — branch should be "main" or "master"
        expect(branch).toBeDefined()
        expect(typeof branch).toBe("string")
      },
    })
  })

  test("branch() returns undefined for non-git directories", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Vcs.init()
        const branch = await Vcs.branch()
        expect(branch).toBeUndefined()
      },
    })
  })

  test("publishes BranchUpdated when .git/HEAD changes", async () => {
    await using tmp = await tmpdir({ git: true })
    const branch = `test-${Math.random().toString(36).slice(2)}`
    await $`git branch ${branch}`.cwd(tmp.path).quiet()

    await withInstance(tmp.path, async () => {
      const pending = nextBranchUpdate(tmp.path)

      // Write .git/HEAD directly to simulate branch switch
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

    await withInstance(tmp.path, async () => {
      const pending = nextBranchUpdate(tmp.path)

      const head = path.join(tmp.path, ".git", "HEAD")
      await fs.writeFile(head, `ref: refs/heads/${branch}\n`)

      await pending
      const current = await Vcs.branch()
      expect(current).toBe(branch)
    })
  })
})
