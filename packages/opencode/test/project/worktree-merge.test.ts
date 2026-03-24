import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

describe("Worktree.merge", () => {
  test("fast-forward merge succeeds", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path

    const sandboxName = `merge-ff-${Date.now().toString(36)}`
    const sandboxBranch = `opencode/${sandboxName}`
    const sandboxDir = path.join(root, "..", sandboxName)

    await $`git worktree add --no-checkout -b ${sandboxBranch} ${sandboxDir}`.cwd(root).quiet()
    await $`git reset --hard`.cwd(sandboxDir).quiet()

    await Bun.write(path.join(sandboxDir, "feature.txt"), "new feature")
    await $`git add feature.txt`.cwd(sandboxDir).quiet()
    await $`git commit -m "add feature"`.cwd(sandboxDir).quiet()

    const ok = await Instance.provide({
      directory: root,
      fn: () => Worktree.merge({ sourceDirectory: sandboxDir, targetDirectory: root }),
    })

    expect(ok).toBe(true)

    const featureExists = await Bun.file(path.join(root, "feature.txt")).exists()
    expect(featureExists).toBe(true)
  })

  test("merge commit succeeds when histories diverge", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path

    const sandboxName = `merge-commit-${Date.now().toString(36)}`
    const sandboxBranch = `opencode/${sandboxName}`
    const sandboxDir = path.join(root, "..", sandboxName)

    await $`git worktree add --no-checkout -b ${sandboxBranch} ${sandboxDir}`.cwd(root).quiet()
    await $`git reset --hard`.cwd(sandboxDir).quiet()

    await Bun.write(path.join(sandboxDir, "sandbox.txt"), "sandbox work")
    await $`git add sandbox.txt`.cwd(sandboxDir).quiet()
    await $`git commit -m "sandbox commit"`.cwd(sandboxDir).quiet()

    await Bun.write(path.join(root, "main.txt"), "main work")
    await $`git add main.txt`.cwd(root).quiet()
    await $`git commit -m "main commit"`.cwd(root).quiet()

    const ok = await Instance.provide({
      directory: root,
      fn: () => Worktree.merge({ sourceDirectory: sandboxDir, targetDirectory: root }),
    })

    expect(ok).toBe(true)

    const sandboxExists = await Bun.file(path.join(root, "sandbox.txt")).exists()
    expect(sandboxExists).toBe(true)
  })

  test("source worktree is deleted after merge", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path

    const sandboxName = `merge-cleanup-${Date.now().toString(36)}`
    const sandboxBranch = `opencode/${sandboxName}`
    const sandboxDir = path.join(root, "..", sandboxName)

    await $`git worktree add --no-checkout -b ${sandboxBranch} ${sandboxDir}`.cwd(root).quiet()
    await $`git reset --hard`.cwd(sandboxDir).quiet()

    await Bun.write(path.join(sandboxDir, "cleanup.txt"), "test cleanup")
    await $`git add cleanup.txt`.cwd(sandboxDir).quiet()
    await $`git commit -m "add cleanup test"`.cwd(sandboxDir).quiet()

    await Instance.provide({
      directory: root,
      fn: () => Worktree.merge({ sourceDirectory: sandboxDir, targetDirectory: root }),
    })

    const sandboxStillExists = await Bun.file(sandboxDir).exists()
    expect(sandboxStillExists).toBe(false)

    const list = await $`git worktree list --porcelain`.cwd(root).quiet().text()
    expect(list).not.toContain(`worktree ${sandboxDir}`)
  })

  test("source branch is deleted after merge", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path

    const sandboxName = `merge-branch-${Date.now().toString(36)}`
    const sandboxBranch = `opencode/${sandboxName}`
    const sandboxDir = path.join(root, "..", sandboxName)

    await $`git worktree add --no-checkout -b ${sandboxBranch} ${sandboxDir}`.cwd(root).quiet()
    await $`git reset --hard`.cwd(sandboxDir).quiet()

    await Bun.write(path.join(sandboxDir, "branch.txt"), "test branch deletion")
    await $`git add branch.txt`.cwd(sandboxDir).quiet()
    await $`git commit -m "add branch test"`.cwd(sandboxDir).quiet()

    await Instance.provide({
      directory: root,
      fn: () => Worktree.merge({ sourceDirectory: sandboxDir, targetDirectory: root }),
    })

    const ref = await $`git show-ref --verify --quiet refs/heads/${sandboxBranch}`.cwd(root).quiet().nothrow()
    expect(ref.exitCode).not.toBe(0)
  })

  test("throws when source worktree does not exist", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const nonExistent = path.join(root, "..", "does-not-exist")

    const err = await Instance.provide({
      directory: root,
      fn: () => Worktree.merge({ sourceDirectory: nonExistent, targetDirectory: root }),
    }).catch((e) => e)

    expect(err).toBeInstanceOf(Worktree.MergeFailedError)
  })

  test("throws when target worktree does not exist", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path

    const sandboxName = `merge-no-target-${Date.now().toString(36)}`
    const sandboxBranch = `opencode/${sandboxName}`
    const sandboxDir = path.join(root, "..", sandboxName)
    await $`git worktree add --no-checkout -b ${sandboxBranch} ${sandboxDir}`.cwd(root).quiet()
    await $`git reset --hard`.cwd(sandboxDir).quiet()

    const nonExistent = path.join(root, "..", "target-does-not-exist")

    const err = await Instance.provide({
      directory: root,
      fn: () => Worktree.merge({ sourceDirectory: sandboxDir, targetDirectory: nonExistent }),
    }).catch((e) => e)

    expect(err).toBeInstanceOf(Worktree.MergeFailedError)
  })

  test("throws when source and target are the same", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path

    const err = await Instance.provide({
      directory: root,
      fn: () => Worktree.merge({ sourceDirectory: root, targetDirectory: root }),
    }).catch((e) => e)

    expect(err).toBeInstanceOf(Worktree.MergeFailedError)
  })

  test("throws when source worktree has uncommitted changes", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path

    const sandboxName = `merge-dirty-${Date.now().toString(36)}`
    const sandboxBranch = `opencode/${sandboxName}`
    const sandboxDir = path.join(root, "..", sandboxName)

    await $`git worktree add --no-checkout -b ${sandboxBranch} ${sandboxDir}`.cwd(root).quiet()
    await $`git reset --hard`.cwd(sandboxDir).quiet()

    await Bun.write(path.join(sandboxDir, "uncommitted.txt"), "not committed")

    const err = await Instance.provide({
      directory: root,
      fn: () => Worktree.merge({ sourceDirectory: sandboxDir, targetDirectory: root }),
    }).catch((e) => e)

    expect(err).toBeInstanceOf(Worktree.MergeFailedError)
    expect((err as InstanceType<typeof Worktree.MergeFailedError>).data.message).toContain("uncommitted")
  })

  test("throws when source has no new commits to merge", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path

    const sandboxName = `merge-no-commits-${Date.now().toString(36)}`
    const sandboxBranch = `opencode/${sandboxName}`
    const sandboxDir = path.join(root, "..", sandboxName)

    await $`git worktree add --no-checkout -b ${sandboxBranch} ${sandboxDir}`.cwd(root).quiet()
    await $`git reset --hard`.cwd(sandboxDir).quiet()

    const err = await Instance.provide({
      directory: root,
      fn: () => Worktree.merge({ sourceDirectory: sandboxDir, targetDirectory: root }),
    }).catch((e) => e)

    expect(err).toBeInstanceOf(Worktree.MergeFailedError)
    expect((err as InstanceType<typeof Worktree.MergeFailedError>).data.message).toContain("no new commits")
  })
})
