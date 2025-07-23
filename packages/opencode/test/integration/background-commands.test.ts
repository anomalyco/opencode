import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { App } from "../../src/app/app"
import { BashTool } from "../../src/tool/bash"
import fs from "fs"
import path from "path"

const ctx = {
  sessionID: "test-integration",
  messageID: "",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

describe("Background Commands Integration Tests", () => {
  const testDir = path.join(process.cwd(), "test-integration-bg")

  beforeAll(async () => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }
  })

  afterAll(async () => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("TUI should remain responsive after background command", async () => {
    await App.provide({ cwd: testDir }, async () => {
      const start = Date.now()

      // Execute background command
      const bgResult = await BashTool.execute(
        {
          command: "sleep 0.5 &",
          description: "Long background sleep",
        },
        ctx,
      )

      const bgDuration = Date.now() - start

      // Background command should return quickly
      expect(bgDuration).toBeLessThan(100)
      expect(bgResult.metadata.exit).toBe(0)

      // TUI should still be able to execute other commands immediately
      const followupStart = Date.now()
      const followupResult = await BashTool.execute(
        {
          command: "echo 'TUI is responsive'",
          description: "Test TUI responsiveness",
        },
        ctx,
      )

      const followupDuration = Date.now() - followupStart

      // Follow-up command should execute normally
      expect(followupDuration).toBeLessThan(100)
      expect(followupResult.metadata.exit).toBe(0)
      expect(followupResult.metadata.stdout.trim()).toBe("TUI is responsive")
    })
  })

  test("multiple sequential background commands should not accumulate delays", async () => {
    await App.provide({ cwd: testDir }, async () => {
      const commands = ["sleep 0.3 &", "sleep 0.4 &", "sleep 0.2 &"]

      const start = Date.now()

      for (const command of commands) {
        const result = await BashTool.execute(
          {
            command,
            description: `Background command: ${command}`,
          },
          ctx,
        )

        expect(result.metadata.exit).toBe(0)
      }

      const totalDuration = Date.now() - start

      // All three background commands should complete quickly
      // Not accumulate to 900ms+ (300+400+200)
      expect(totalDuration).toBeLessThan(300)
    })
  })

  test("background server process integration", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      // Start the test Node server in background
      const serverResult = await BashTool.execute(
        {
          command: "node -e \"require('http').createServer().listen(0); setInterval(() => {}, 1000)\" &",
          description: "Start Node server in background",
        },
        ctx,
      )

      const serverStartDuration = Date.now() - start

      // Server start should return immediately
      expect(serverStartDuration).toBeLessThan(100)
      expect(serverResult.metadata.exit).toBe(0)

      // Give server a moment to start
      await new Promise((resolve) => setTimeout(resolve, 100))

      // TUI should still be responsive for other commands
      const testStart = Date.now()
      const testResult = await BashTool.execute(
        {
          command: "ps aux | grep -c node || echo 'grep failed'",
          description: "Check if Node processes are running",
        },
        ctx,
      )

      const testDuration = Date.now() - testStart

      expect(testDuration).toBeLessThan(200)
      expect(testResult.metadata.exit).toBe(0)

      // Clean up any background Node processes
      await BashTool.execute(
        {
          command: "pkill -f 'node -e' || true",
          description: "Clean up test Node processes",
        },
        ctx,
      )
    })
  })

  test("background command with file operations should work correctly", async () => {
    const testFile1 = path.join(testDir, "bg-test-1.txt")
    const testFile2 = path.join(testDir, "bg-test-2.txt")

    await App.provide({ cwd: testDir }, async () => {
      // Start background processes that create files
      await BashTool.execute(
        {
          command: `sleep 0.03 && echo 'background task 1' > ${path.basename(testFile1)} &`,
          description: "Background file creation 1",
        },
        ctx,
      )

      await BashTool.execute(
        {
          command: `sleep 0.05 && echo 'background task 2' > ${path.basename(testFile2)} &`,
          description: "Background file creation 2",
        },
        ctx,
      )

      // Files should not exist immediately
      expect(fs.existsSync(testFile1)).toBe(false)
      expect(fs.existsSync(testFile2)).toBe(false)

      // Execute a foreground command while background tasks run
      const foregroundResult = await BashTool.execute(
        {
          command: "echo 'foreground task completed'",
          description: "Foreground task during background execution",
        },
        ctx,
      )

      expect(foregroundResult.metadata.exit).toBe(0)
      expect(foregroundResult.metadata.stdout.trim()).toBe("foreground task completed")

      // Wait for background tasks to complete
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Background tasks should have completed
      expect(fs.existsSync(testFile1)).toBe(true)
      expect(fs.existsSync(testFile2)).toBe(true)

      const content1 = fs.readFileSync(testFile1, "utf-8").trim()
      const content2 = fs.readFileSync(testFile2, "utf-8").trim()

      expect(content1).toBe("background task 1")
      expect(content2).toBe("background task 2")
    })
  })

  test("background command error handling", async () => {
    await App.provide({ cwd: testDir }, async () => {
      // Test background command with invalid syntax
      const result = await BashTool.execute(
        {
          command: "invalid-command-that-does-not-exist &",
          description: "Invalid background command",
        },
        ctx,
      )

      // Should still return quickly even with invalid command
      // The exact exit code may vary, but it shouldn't hang
      expect(typeof result.metadata.exit).toBe("number")
    })
  })

  test("mixed foreground and background commands", async () => {
    await App.provide({ cwd: testDir }, async () => {
      const start = Date.now()

      // Execute mixed sequence
      const results = []

      // Background command
      results.push(
        await BashTool.execute(
          {
            command: "sleep 0.3 &",
            description: "Background sleep",
          },
          ctx,
        ),
      )

      // Foreground command
      results.push(
        await BashTool.execute(
          {
            command: "echo 'foreground 1'",
            description: "Foreground echo 1",
          },
          ctx,
        ),
      )

      // Another background command
      results.push(
        await BashTool.execute(
          {
            command: "sleep 0.2 &",
            description: "Another background sleep",
          },
          ctx,
        ),
      )

      // Another foreground command
      results.push(
        await BashTool.execute(
          {
            command: "echo 'foreground 2'",
            description: "Foreground echo 2",
          },
          ctx,
        ),
      )

      const totalDuration = Date.now() - start

      // Should complete quickly, not wait for background sleeps
      expect(totalDuration).toBeLessThan(200)

      // All commands should succeed
      results.forEach((result) => {
        expect(result.metadata.exit).toBe(0)
      })

      // Foreground commands should have expected output
      expect(results[1].metadata.stdout.trim()).toBe("foreground 1")
      expect(results[3].metadata.stdout.trim()).toBe("foreground 2")
    })
  })

  test("background command timeout behavior", async () => {
    await App.provide({ cwd: testDir }, async () => {
      const start = Date.now()

      // Background command with very long sleep and custom timeout
      const result = await BashTool.execute(
        {
          command: "sleep 5 &",
          description: "Very long background sleep",
          timeout: 3000, // 3 second timeout
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return much faster than the 3 second timeout
      // because it's a background command
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })
})
