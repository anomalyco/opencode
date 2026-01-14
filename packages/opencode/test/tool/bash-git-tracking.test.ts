import { describe, expect, test, beforeEach } from "bun:test"
import { $ } from "bun"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { FileTracking } from "../../src/session/file-tracking"

const sessionID = "test-git-tracking-session"

const ctx = {
  sessionID,
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

async function bootstrapWithRemote() {
  // Create a "remote" repo first
  const remote = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(`${dir}/remote-file.txt`, "remote content")
      await $`git add .`.cwd(dir).quiet()
      await $`git commit --no-gpg-sign -m "remote commit"`.cwd(dir).quiet()
      return {}
    },
  })

  // Create a local repo that clones from the remote
  const local = await tmpdir({
    git: false,
    init: async (dir) => {
      await $`git clone ${remote.path} .`.cwd(dir).quiet()
      return { remotePath: remote.path }
    },
  })

  return { local, remote }
}

describe("bash tool git operation tracking", () => {
  beforeEach(() => {
    FileTracking.clear(sessionID)
  })

  test("tracks files changed by git pull", async () => {
    const { local, remote } = await bootstrapWithRemote()

    try {
      // Add a new commit to the remote
      await Bun.write(`${remote.path}/new-remote-file.txt`, "new remote content")
      await $`git add .`.cwd(remote.path).quiet()
      await $`git commit --no-gpg-sign -m "add new remote file"`.cwd(remote.path).quiet()

      await Instance.provide({
        directory: local.path,
        fn: async () => {
          const bash = await BashTool.init()

          // Run git pull
          await bash.execute(
            {
              command: "git pull",
              description: "Pull from remote",
            },
            ctx,
          )

          // Check that the new file is tracked as git-modified
          const tracked = FileTracking.getGitModified(sessionID)
          expect(tracked.has(path.join(local.path, "new-remote-file.txt"))).toBe(true)
        },
      })
    } finally {
      await local[Symbol.asyncDispose]()
      await remote[Symbol.asyncDispose]()
    }
  })

  test("tracks files changed by git merge", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(`${dir}/main-file.txt`, "main content")
        await $`git add .`.cwd(dir).quiet()
        await $`git commit --no-gpg-sign -m "main commit"`.cwd(dir).quiet()

        // Create feature branch with changes
        await $`git checkout -b feature`.cwd(dir).quiet()
        await Bun.write(`${dir}/feature-file.txt`, "feature content")
        await $`git add .`.cwd(dir).quiet()
        await $`git commit --no-gpg-sign -m "feature commit"`.cwd(dir).quiet()

        // Go back to main
        await $`git checkout master || git checkout main`.cwd(dir).quiet().nothrow()
        return {}
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        // Run git merge
        await bash.execute(
          {
            command: "git merge feature --no-edit",
            description: "Merge feature branch",
          },
          ctx,
        )

        // Check that the merged file is tracked
        const tracked = FileTracking.getGitModified(sessionID)
        expect(tracked.has(path.join(tmp.path, "feature-file.txt"))).toBe(true)
      },
    })
  })

  test("tracks files changed by git checkout", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(`${dir}/main-file.txt`, "main content")
        await $`git add .`.cwd(dir).quiet()
        await $`git commit --no-gpg-sign -m "main commit"`.cwd(dir).quiet()

        // Create feature branch with different content
        await $`git checkout -b feature`.cwd(dir).quiet()
        await Bun.write(`${dir}/main-file.txt`, "feature modified content")
        await Bun.write(`${dir}/feature-only.txt`, "feature only")
        await $`git add .`.cwd(dir).quiet()
        await $`git commit --no-gpg-sign -m "feature changes"`.cwd(dir).quiet()

        // Go back to main
        await $`git checkout master || git checkout main`.cwd(dir).quiet().nothrow()
        return {}
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        // Checkout to feature branch
        await bash.execute(
          {
            command: "git checkout feature",
            description: "Checkout feature branch",
          },
          ctx,
        )

        // Check that changed files are tracked
        const tracked = FileTracking.getGitModified(sessionID)
        expect(tracked.has(path.join(tmp.path, "main-file.txt"))).toBe(true)
        expect(tracked.has(path.join(tmp.path, "feature-only.txt"))).toBe(true)
      },
    })
  })

  test("does not track files for non-git commands", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          ctx,
        )

        const tracked = FileTracking.getGitModified(sessionID)
        expect(tracked.size).toBe(0)
      },
    })
  })

  test("does not track files for git status (read-only)", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        await bash.execute(
          {
            command: "git status",
            description: "Git status",
          },
          ctx,
        )

        const tracked = FileTracking.getGitModified(sessionID)
        expect(tracked.size).toBe(0)
      },
    })
  })

  test("does not track files for git log (read-only)", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        await bash.execute(
          {
            command: "git log --oneline -5",
            description: "Git log",
          },
          ctx,
        )

        const tracked = FileTracking.getGitModified(sessionID)
        expect(tracked.size).toBe(0)
      },
    })
  })

  test("does not track files when git command fails", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        // Try to pull from non-existent remote (will fail)
        await bash.execute(
          {
            command: "git pull origin nonexistent",
            description: "Pull from nonexistent",
          },
          ctx,
        )

        const tracked = FileTracking.getGitModified(sessionID)
        expect(tracked.size).toBe(0)
      },
    })
  })
})
