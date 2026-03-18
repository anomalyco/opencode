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

async function remote(dir: string, github?: boolean) {
  const root = path.join(dir, "remote")
  const repo = path.join(root, "repo.git")
  await fs.mkdir(root, { recursive: true })
  await $`git init --bare ${repo}`.quiet()
  if (!github) {
    await $`git remote add origin ${repo}`.cwd(dir).quiet()
    return repo
  }

  const url = "git@github.com:test/repo.git"
  await $`git remote add origin ${url}`.cwd(dir).quiet()
  await $`git remote set-url --push origin ${repo}`.cwd(dir).quiet()
  return repo
}

async function seed(dir: string) {
  await Bun.write(path.join(dir, "a.txt"), "old-a\n")
  await Bun.write(path.join(dir, "b.txt"), "old-b\n")
  await $`git add a.txt b.txt`.cwd(dir).quiet()
  await $`git commit -m seed`.cwd(dir).quiet()
}

async function stage(dir: string) {
  await Bun.write(path.join(dir, "a.txt"), "new-a\n")
  await Bun.write(path.join(dir, "b.txt"), "new-b\n")
  await $`git add a.txt`.cwd(dir).quiet()
}

async function withGh(dir: string, body: string, run: () => Promise<void>) {
  const bin = path.join(dir, "bin")
  const js = path.join(bin, "gh.js")
  await fs.mkdir(bin, { recursive: true })
  const win = process.platform === "win32"
  const file = path.join(bin, win ? "gh.cmd" : "gh")
  await Bun.write(js, body)
  const cmd = win
    ? `@echo off\r\n"${process.execPath}" "${js}" %*\r\n`
    : `#!/bin/sh
exec "${process.execPath}" "${js}" "$@"
`
  await Bun.write(file, cmd)
  if (!win) await fs.chmod(file, 0o755)
  const prev = process.env.PATH
  process.env.PATH = `${bin}${path.delimiter}${prev ?? ""}`
  try {
    await run()
  } finally {
    process.env.PATH = prev
  }
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

describe("Vcs.commit", () => {
  afterEach(() => Instance.disposeAll())

  test("commits staged changes without including unstaged files", async () => {
    await using tmp = await tmpdir({ git: true })
    await seed(tmp.path)
    await stage(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: () => Vcs.commit({ message: "staged only", includeUnstaged: false, action: "commit" }),
    })

    expect(await $`git show HEAD:a.txt`.cwd(tmp.path).text()).toBe("new-a\n")
    expect(await $`git show HEAD:b.txt`.cwd(tmp.path).text()).toBe("old-b\n")
    expect(await $`git status --short`.cwd(tmp.path).text()).toContain(" M b.txt")
  })

  test("commits staged and unstaged changes when requested", async () => {
    await using tmp = await tmpdir({ git: true })
    await seed(tmp.path)
    await stage(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: () => Vcs.commit({ message: "all changes", includeUnstaged: true, action: "commit" }),
    })

    expect(await $`git show HEAD:a.txt`.cwd(tmp.path).text()).toBe("new-a\n")
    expect(await $`git show HEAD:b.txt`.cwd(tmp.path).text()).toBe("new-b\n")
    expect(await $`git status --short`.cwd(tmp.path).text()).toBe("")
  })

  test("pushes after commit when action is push", async () => {
    await using tmp = await tmpdir({ git: true })
    await seed(tmp.path)
    await stage(tmp.path)
    const repo = await remote(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: () => Vcs.commit({ message: "push changes", includeUnstaged: true, action: "push" }),
    })

    expect((await $`git --git-dir=${repo} log -1 --format=%s`.text()).trim()).toBe("push changes")
  })

  test("creates a PR after push when action is pr", async () => {
    await using tmp = await tmpdir({ git: true })
    await seed(tmp.path)
    await stage(tmp.path)
    const repo = await remote(tmp.path, true)

    await withGh(
      tmp.path,
      `const args = process.argv.slice(2)
if (args[0] === "auth" && args[1] === "status") process.exit(0)
if (args[0] === "pr" && args[1] === "view") process.exit(1)
if (args[0] === "pr" && args[1] === "create") {
  process.stdout.write("https://github.com/test/repo/pull/1\\n")
  process.exit(0)
}
process.exit(1)
`,
      async () => {
        const result = await Instance.provide({
          directory: tmp.path,
          fn: () => Vcs.commit({ message: "open pr", includeUnstaged: true, action: "pr" }),
        })

        expect(result.url).toBe("https://github.com/test/repo/pull/1")
        expect((await $`git --git-dir=${repo} log -1 --format=%s`.text()).trim()).toBe("open pr")
      },
    )
  })

  test("fails when staged-only commit has no staged changes", async () => {
    await using tmp = await tmpdir({ git: true })
    await seed(tmp.path)
    await Bun.write(path.join(tmp.path, "b.txt"), "new-b\n")

    const err = await Instance.provide({
      directory: tmp.path,
      fn: () => Vcs.commit({ message: "staged only", includeUnstaged: false, action: "commit" }),
    }).catch((err) => err)

    expect(err).toBeInstanceOf(Vcs.CommitFailedError)
    expect(err.data.message).toBe("No staged changes to commit")
  })

  test("fails PR creation when GitHub CLI is not authenticated", async () => {
    await using tmp = await tmpdir({ git: true })
    await seed(tmp.path)
    await stage(tmp.path)
    await remote(tmp.path, true)

    await withGh(
      tmp.path,
      `process.exit(1)
`,
      async () => {
        const err = await Instance.provide({
          directory: tmp.path,
          fn: () => Vcs.commit({ message: "open pr", includeUnstaged: true, action: "pr" }),
        }).catch((err) => err)

        expect(err).toBeInstanceOf(Vcs.CommitFailedError)
        expect(err.data.message).toBe("GitHub CLI is not authenticated")
      },
    )
  })
})
