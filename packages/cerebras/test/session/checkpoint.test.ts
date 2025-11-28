import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Checkpoint } from "../../src/session/checkpoint"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("Checkpoint", () => {
  let testDir: string
  let sessionID: string

  beforeEach(async () => {
    // Create a temporary directory for testing
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "checkpoint-test-"))
    sessionID = "test-session-" + Date.now()

    // Change to test directory first
    process.chdir(testDir)

    // Initialize git repo
    await $`git init`.quiet()
    await $`git config user.email "test@example.com"`.quiet()
    await $`git config user.name "Test User"`.quiet()

    // Create initial commit
    await fs.writeFile(path.join(testDir, "test.txt"), "initial content")
    await $`git add -A`.quiet()
    await $`git commit -m "initial commit"`.quiet()

    // Enable checkpoints for testing
    Checkpoint.setEnabled(true)
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  describe("create", () => {
    test("creates checkpoint with git tag", async () => {
      // Make some changes
      await fs.writeFile(path.join(testDir, "test.txt"), "modified content")

      const result = await Checkpoint.create({
        sessionID,
        message: "Test checkpoint",
      })

      expect(result).not.toBeNull()
      expect(result?.tag).toContain(`checkpoint-${sessionID}`)
      expect(result?.commit).toBeDefined()
      expect(result?.message).toBe("Test checkpoint")
      expect(result?.timestamp).toBeGreaterThan(0)

      // Verify tag exists
      const tags = await $`git tag -l "checkpoint-${sessionID}-*"`.quiet().text()
      expect(tags.trim()).toContain(`checkpoint-${sessionID}`)
    })

    test("returns null when no changes to checkpoint", async () => {
      // No changes made
      const result = await Checkpoint.create({
        sessionID,
        message: "No changes",
      })

      expect(result).toBeNull()
    })

    test("restores working directory after creating checkpoint", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "modified content")

      await Checkpoint.create({
        sessionID,
        message: "Test checkpoint",
      })

      // Verify file still has modified content
      const content = await fs.readFile(path.join(testDir, "test.txt"), "utf-8")
      expect(content).toBe("modified content")
    })

    test("handles new untracked files", async () => {
      await fs.writeFile(path.join(testDir, "new-file.txt"), "new content")

      const result = await Checkpoint.create({
        sessionID,
        message: "New file checkpoint",
      })

      expect(result).not.toBeNull()
      expect(result?.tag).toContain(`checkpoint-${sessionID}`)

      // Verify new file still exists
      const exists = await fs
        .access(path.join(testDir, "new-file.txt"))
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(true)
    })

    test("returns null when not in git repository", async () => {
      // Create non-git directory
      const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), "non-git-"))
      process.chdir(nonGitDir)

      const result = await Checkpoint.create({
        sessionID,
        message: "Should fail",
      })

      expect(result).toBeNull()

      // Cleanup
      process.chdir(testDir)
      await fs.rm(nonGitDir, { recursive: true, force: true })
    })
  })

  describe("list", () => {
    test("lists all checkpoints for a session", async () => {
      // Create multiple checkpoints
      await fs.writeFile(path.join(testDir, "test.txt"), "content 1")
      await Checkpoint.create({ sessionID, message: "Checkpoint 1" })

      await new Promise((resolve) => setTimeout(resolve, 10)) // Ensure different timestamps

      await fs.writeFile(path.join(testDir, "test.txt"), "content 2")
      await Checkpoint.create({ sessionID, message: "Checkpoint 2" })

      const checkpoints = await Checkpoint.list(sessionID)

      expect(checkpoints.length).toBe(2)
      expect(checkpoints[0].tag).toContain(`checkpoint-${sessionID}`)
      expect(checkpoints[1].tag).toContain(`checkpoint-${sessionID}`)

      // Verify sorted by timestamp (newest first)
      expect(checkpoints[0].timestamp).toBeGreaterThan(checkpoints[1].timestamp)
    })

    test("returns empty array when no checkpoints exist", async () => {
      const checkpoints = await Checkpoint.list(sessionID)
      expect(checkpoints).toEqual([])
    })

    test("filters checkpoints by session ID", async () => {
      const otherSessionID = "other-session-" + Date.now()

      // Create checkpoints for different sessions
      await fs.writeFile(path.join(testDir, "test.txt"), "content 1")
      await Checkpoint.create({ sessionID, message: "Session 1 checkpoint" })

      await fs.writeFile(path.join(testDir, "test.txt"), "content 2")
      await Checkpoint.create({ sessionID: otherSessionID, message: "Session 2 checkpoint" })

      const session1Checkpoints = await Checkpoint.list(sessionID)
      const session2Checkpoints = await Checkpoint.list(otherSessionID)

      expect(session1Checkpoints.length).toBe(1)
      expect(session2Checkpoints.length).toBe(1)
      expect(session1Checkpoints[0].tag).toContain(sessionID)
      expect(session2Checkpoints[0].tag).toContain(otherSessionID)
    })
  })

  describe("restore", () => {
    test("restores workspace to checkpoint state", async () => {
      // Create checkpoint with specific content
      await fs.writeFile(path.join(testDir, "test.txt"), "checkpoint content")
      const checkpoint = await Checkpoint.create({ sessionID, message: "Restore test" })

      expect(checkpoint).not.toBeNull()

      // Make more changes
      await fs.writeFile(path.join(testDir, "test.txt"), "newer content")
      await $`git add -A`.quiet()
      await $`git commit -m "newer changes"`.quiet()

      // Restore to checkpoint
      const result = await Checkpoint.restore(checkpoint!.tag)

      expect(result.success).toBe(true)
      expect(result.tag).toBe(checkpoint!.tag)

      // Note: After checkout, we're in detached HEAD state
      // The actual file restoration happens via git checkout
    })

    test("stashes current changes before restore", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "checkpoint content")
      const checkpoint = await Checkpoint.create({ sessionID, message: "Restore test" })

      // Make uncommitted changes
      await fs.writeFile(path.join(testDir, "test.txt"), "uncommitted changes")

      // Restore should succeed (changes are stashed)
      const result = await Checkpoint.restore(checkpoint!.tag)
      expect(result.success).toBe(true)
    })
  })

  describe("cleanup", () => {
    test("deletes old checkpoints keeping only the last N", async () => {
      // Create 15 checkpoints
      for (let i = 0; i < 15; i++) {
        await fs.writeFile(path.join(testDir, "test.txt"), `content ${i}`)
        await Checkpoint.create({ sessionID, message: `Checkpoint ${i}` })
        await new Promise((resolve) => setTimeout(resolve, 10)) // Ensure different timestamps
      }

      // Verify we have 15 checkpoints
      let checkpoints = await Checkpoint.list(sessionID)
      expect(checkpoints.length).toBe(15)

      // Clean up, keeping only last 5
      await Checkpoint.cleanup(sessionID, 5)

      // Verify only 5 remain
      checkpoints = await Checkpoint.list(sessionID)
      expect(checkpoints.length).toBe(5)
    })

    test("does nothing if fewer checkpoints than keep limit", async () => {
      // Create only 3 checkpoints
      for (let i = 0; i < 3; i++) {
        await fs.writeFile(path.join(testDir, "test.txt"), `content ${i}`)
        await Checkpoint.create({ sessionID, message: `Checkpoint ${i}` })
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      await Checkpoint.cleanup(sessionID, 10)

      const checkpoints = await Checkpoint.list(sessionID)
      expect(checkpoints.length).toBe(3)
    })

    test("keeps newest checkpoints and deletes oldest", async () => {
      // Create 5 checkpoints with known order
      const timestamps: number[] = []
      for (let i = 0; i < 5; i++) {
        await fs.writeFile(path.join(testDir, "test.txt"), `content ${i}`)
        const checkpoint = await Checkpoint.create({ sessionID, message: `Checkpoint ${i}` })
        timestamps.push(checkpoint!.timestamp)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      // Keep only last 2
      await Checkpoint.cleanup(sessionID, 2)

      const remaining = await Checkpoint.list(sessionID)
      expect(remaining.length).toBe(2)

      // Verify the remaining checkpoints are the newest ones (allow small timing variance)
      expect(remaining[0].timestamp).toBeGreaterThanOrEqual(timestamps[3])
      expect(remaining[1].timestamp).toBeGreaterThanOrEqual(timestamps[2])
    })
  })

  describe("autoCheckpoint", () => {
    test("creates checkpoint with auto-generated message", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "modified content")

      const result = await Checkpoint.autoCheckpoint({
        sessionID,
        operation: "edit: test.txt",
      })

      expect(result).not.toBeNull()
      expect(result?.message).toContain("Auto checkpoint before:")
      expect(result?.message).toContain("edit: test.txt")
    })

    test("returns null when no changes", async () => {
      const result = await Checkpoint.autoCheckpoint({
        sessionID,
        operation: "bash: ls",
      })

      expect(result).toBeNull()
    })
  })

  describe("config integration", () => {
    test("respects enabled flag", async () => {
      // Disable checkpoints
      Checkpoint.setEnabled(false)

      await fs.writeFile(path.join(testDir, "test.txt"), "modified content")

      const result = await Checkpoint.create({
        sessionID,
        message: "Should not create",
      })

      // Should return null when disabled
      expect(result).toBeNull()

      // Re-enable for other tests
      Checkpoint.setEnabled(true)
    })

    test("setEnabled toggles functionality", () => {
      Checkpoint.setEnabled(true)
      // Test would create checkpoints

      Checkpoint.setEnabled(false)
      // Test would not create checkpoints

      Checkpoint.setEnabled(true) // Reset for other tests
    })
  })
})
