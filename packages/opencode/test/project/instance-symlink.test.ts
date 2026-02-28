import { describe, test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"
import { existsSync } from "fs"

describe("Instance with symlinks", () => {
  test("should use same instance for symlink and real path", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create a symlink to the temp directory
    const symlinkPath = path.join(path.dirname(tmp.path), "symlink-test")

    // Clean up any existing symlink
    if (existsSync(symlinkPath)) {
      await fs.unlink(symlinkPath)
    }

    await fs.symlink(tmp.path, symlinkPath, "dir")

    try {
      const { Instance } = await import("../../src/project/instance")
      const { InstanceBootstrap } = await import("../../src/project/bootstrap")
      const { Session } = await import("../../src/session")

      // Track which instances were created
      const instanceKeys = new Set<string>()

      // Create session using symlink path
      const session1 = await Instance.provide({
        directory: symlinkPath,
        init: InstanceBootstrap,
        fn: async () => {
          instanceKeys.add(Instance.directory)
          return Session.create({})
        },
      })

      // Create session using real path
      const session2 = await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          instanceKeys.add(Instance.directory)
          return Session.create({})
        },
      })

      // Both operations should use the same instance
      expect(instanceKeys.size).toBe(1)

      // Both sessions should have the same directory (normalized)
      expect(session1.directory).toBe(session2.directory)

      // Cleanup instances
      await Instance.provide({
        directory: symlinkPath,
        fn: async () => {
          await Instance.dispose()
        },
      })
    } finally {
      await fs.unlink(symlinkPath).catch(() => {})
    }
  })

  test("should not create duplicate instances when switching sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    const symlinkPath = path.join(path.dirname(tmp.path), "symlink-session-test")

    if (existsSync(symlinkPath)) {
      await fs.unlink(symlinkPath)
    }

    await fs.symlink(tmp.path, symlinkPath, "dir")

    try {
      const { Instance } = await import("../../src/project/instance")
      const { InstanceBootstrap } = await import("../../src/project/bootstrap")
      const { Session } = await import("../../src/session")

      let firstInstanceDir: string | undefined
      let secondInstanceDir: string | undefined

      // Create a session from symlink
      const session = await Instance.provide({
        directory: symlinkPath,
        init: InstanceBootstrap,
        fn: async () => {
          firstInstanceDir = Instance.directory
          return Session.create({ title: "Test session" })
        },
      })

      // Simulate switching to the session (which has a stored directory)
      // The stored directory might be different from the current path
      await Instance.provide({
        directory: session.directory,
        init: InstanceBootstrap,
        fn: async () => {
          secondInstanceDir = Instance.directory
          // Get the session
          await Session.get(session.id)
        },
      })

      // Both should resolve to the same instance directory
      expect(firstInstanceDir).toBe(secondInstanceDir)

      // Cleanup
      await Instance.disposeAll()
    } finally {
      await fs.unlink(symlinkPath).catch(() => {})
    }
  })
})
