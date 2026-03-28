import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { FileWatcher } from "../../src/file/watcher"
import { Instance } from "../../src/project/instance"
import { GlobalBus } from "../../src/bus/global"
import { Vcs } from "../../src/project/vcs"

const describeVcs = FileWatcher.hasNativeBinding() && !process.env.CI ? describe : describe.skip

async function withVcs(directory: string, body: () => Promise<void>) {
  return Instance.provide({
    directory,
    fn: async () => {
      FileWatcher.init()
      Vcs.init()
      await Bun.sleep(500)
      await body()
    },
  })
}

type BranchEvent = { directory?: string; payload: { type: string; properties: { branch?: string } } }

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

describeVcs("Vcs", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("branch() returns current branch name", async () => {
    await using tmp = await tmpdir({ git: true })

    await withVcs(tmp.path, async () => {
      const branch = await Vcs.branch()
      expect(branch).toBeDefined()
      expect(typeof branch).toBe("string")
    })
  })

  test("branch() returns undefined for non-git directories", async () => {
    await using tmp = await tmpdir()

    await withVcs(tmp.path, async () => {
      const branch = await Vcs.branch()
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
      await fs.writeFile(
        head,
        `ref: refs/heads/${branch}
`,
      )

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
      await fs.writeFile(
        head,
        `ref: refs/heads/${branch}
`,
      )

      await pending
      const current = await Vcs.branch()
      expect(current).toBe(branch)
    })
  })
})
