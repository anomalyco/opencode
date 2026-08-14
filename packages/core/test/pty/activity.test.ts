import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rename, rm, symlink } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { InstanceActivity } from "../../src/instance-activity"
import { PtyActivity } from "../../src/pty/activity"

const canonical = "/tmp/opencode-pty-activity/b"
const alias = "/tmp/opencode-pty-activity/a/../b"
const canonicalIdentity = PtyActivity.identify(canonical)

afterEach(() => {
  PtyActivity.stopped(canonicalIdentity)
  InstanceActivity.forget(canonicalIdentity)
})

describe("PtyActivity", () => {
  test("canonicalizes lexical directory aliases", () => {
    const aliasIdentity = PtyActivity.identify(alias)
    const before = InstanceActivity.snapshot(canonicalIdentity).generation
    PtyActivity.started(aliasIdentity)
    expect(PtyActivity.hasRunning(canonical)).toBe(true)
    const running = InstanceActivity.snapshot(canonicalIdentity).generation
    expect(running).toBeGreaterThan(before)

    PtyActivity.stopped(aliasIdentity)
    expect(PtyActivity.hasRunning(alias)).toBe(false)
    expect(InstanceActivity.snapshot(canonicalIdentity).generation).toBeGreaterThan(running)
  })

  test("keeps the owning identity across rename and symlink replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-pty-retarget-"))
    const owner = join(root, "owner")
    const moved = join(root, "moved")
    const replacement = join(root, "replacement")
    await mkdir(owner)
    await mkdir(replacement)
    const identity = PtyActivity.identify(owner)

    try {
      PtyActivity.started(identity)
      const running = InstanceActivity.snapshot(identity)
      expect(running.runningPtys).toBe(1)

      await rename(owner, moved)
      await symlink(replacement, owner, "dir")

      expect(PtyActivity.hasRunning(owner)).toBe(true)
      PtyActivity.stopped(identity)
      expect(PtyActivity.hasRunning(owner)).toBe(false)
      expect(InstanceActivity.snapshot(identity).runningPtys).toBe(0)

      PtyActivity.started(identity)
      PtyActivity.stopped(identity)
      const balanced = InstanceActivity.snapshot(identity)
      expect(balanced.runningPtys).toBe(0)
      expect(balanced.generation).toBeGreaterThan(running.generation)
    } finally {
      PtyActivity.stopped(identity)
      InstanceActivity.forget(identity)
      await rm(root, { recursive: true, force: true })
    }
  })
})
