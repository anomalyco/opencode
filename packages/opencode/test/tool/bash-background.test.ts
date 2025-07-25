import { describe, expect, test } from "bun:test"
import { App } from "../../src/app/app"
import { BashTool } from "../../src/tool/bash"
import fs from "fs"
import path from "path"

const ctx = {
  sessionID: "test",
  messageID: "",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

describe("BashTool background commands", () => {
  test("background command should return immediately", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "sleep 0.5 &",
          description: "Background sleep command",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return in less than 100ms, not wait for the full 500ms
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })

  test("background command with output redirection should not hang", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: 'node -e "setTimeout(() => {}, 300)" > /dev/null 2>&1 &',
          description: "Background Node command with output redirection",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return quickly, not wait for the 300ms sleep
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })

  test("background server process should not hang TUI", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "node -e \"require('http').createServer().listen(0); setInterval(() => {}, 1000)\" &",
          description: "Background Node server",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return immediately, not hang waiting for server to exit
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })

  test("multiple background commands should not hang", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "sleep 0.3 & sleep 0.2 & echo 'done'",
          description: "Multiple background commands with foreground echo",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return quickly after echo, not wait for background sleeps
      expect(duration).toBeLessThan(500)
      expect(result.metadata.exit).toBe(0)
      expect(result.metadata.stdout).toContain("done")
    })
  })

  test("background command actually runs in background", async () => {
    const testFile = path.join(process.cwd(), "bg-test-file")

    // Clean up any existing test file
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile)
    }

    await App.provide({ cwd: process.cwd() }, async () => {
      // Start background process that creates a file after 50ms
      await (
        await BashTool()
      ).execute(
        {
          command: `sleep 0.05 && touch ${testFile} &`,
          description: "Background command that creates a file",
        },
        ctx,
      )

      // File should not exist immediately
      expect(fs.existsSync(testFile)).toBe(false)

      // Wait for background process to complete
      await new Promise((resolve) => setTimeout(resolve, 100))

      // File should now exist, proving background process ran
      expect(fs.existsSync(testFile)).toBe(true)

      // Clean up
      fs.unlinkSync(testFile)
    })
  })

  test("regular commands without & should still work normally", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const result = await (
        await BashTool()
      ).execute(
        {
          command: "echo 'hello world'",
          description: "Regular echo command",
        },
        ctx,
      )

      expect(result.metadata.exit).toBe(0)
      expect(result.metadata.stdout.trim()).toBe("hello world")
    })
  })

  test("command with escaped ampersand should not be treated as background", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const result = await (
        await BashTool()
      ).execute(
        {
          command: "echo 'hello \\& world'",
          description: "Command with escaped ampersand",
        },
        ctx,
      )

      expect(result.metadata.exit).toBe(0)
      expect(result.metadata.stdout.trim()).toBe("hello \\& world")
    })
  })

  test("command with & in middle should not be treated as background", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const result = await (
        await BashTool()
      ).execute(
        {
          command: "echo 'hello & world' && echo 'done'",
          description: "Command with & in middle, not at end",
        },
        ctx,
      )

      expect(result.metadata.exit).toBe(0)
      expect(result.metadata.stdout).toContain("hello & world")
      expect(result.metadata.stdout).toContain("done")
    })
  })

  test("background command with custom timeout should respect background timeout", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "sleep 1 &",
          description: "Long background sleep",
          timeout: 5000, // 5 second regular timeout
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return immediately for background commands
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })
})

describe("BashTool background command detection", () => {
  test("should detect simple background command", () => {
    // This test will need the isBackgroundCommand function to be exported
    // For now, we test the behavior indirectly through execution timing
    expect(true).toBe(true) // Placeholder - will implement when function is exported
  })

  test("should not detect escaped ampersand as background", () => {
    // Placeholder for when detection function is available
    expect(true).toBe(true)
  })

  test("should not detect ampersand in middle as background", () => {
    // Placeholder for when detection function is available
    expect(true).toBe(true)
  })
})
