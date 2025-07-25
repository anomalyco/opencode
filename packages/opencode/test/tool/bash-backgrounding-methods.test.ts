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

describe("BashTool various backgrounding methods", () => {
  test("nohup command should run in foreground but not hang due to file descriptors", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "nohup sleep 0.2 > /dev/null 2>&1",
          description: "nohup foreground command",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should wait for completion (~200ms) but not hang indefinitely
      expect(duration).toBeGreaterThan(150)
      expect(duration).toBeLessThan(500)
      expect(result.metadata.exit).toBe(0)
    })
  })
  test("nohup with & should not hang", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "nohup sleep 0.5 > /dev/null 2>&1 &",
          description: "nohup with & background command",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return immediately
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })

  test("disown command should not hang", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "sleep 0.3 & disown",
          description: "disown background command",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return quickly
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })
  test("setsid command should run in foreground but not hang due to file descriptors", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "setsid sleep 0.2 > /dev/null 2>&1",
          description: "setsid foreground command",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should wait for completion (~200ms) but not hang indefinitely
      expect(duration).toBeGreaterThan(150)
      expect(duration).toBeLessThan(500)
      expect(result.metadata.exit).toBe(0)
    })
  })
  test("daemon-style double fork should not hang", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "(sleep 0.3 &) &",
          description: "daemon-style double fork",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return quickly
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })

  test("subshell with & should not hang", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "(sleep 0.2; echo 'done') &",
          description: "subshell with background",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return quickly
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })

  test("timeout command should work normally", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "timeout 0.2s sleep 1",
          description: "timeout command",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return after ~200ms due to timeout
      expect(duration).toBeLessThan(500)
      expect(duration).toBeGreaterThan(150)
      // timeout command returns 124 when it times out
      expect([0, 124]).toContain(result.metadata.exit)
    })
  })

  test("screen command should not hang", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "screen -dm sleep 0.3",
          description: "screen detached session",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return quickly (screen may not be installed, so we check exit code)
      expect(duration).toBeLessThan(100)
      // Exit code could be 0 (success) or 127 (command not found)
      expect([0, 127]).toContain(result.metadata.exit)
    })
  })

  test("tmux command should not hang", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "tmux new-session -d 'sleep 0.3'",
          description: "tmux detached session",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return quickly (tmux may not be installed)
      expect(duration).toBeLessThan(100)
      // Exit code could be 0 (success) or 127 (command not found)
      expect([0, 127]).toContain(result.metadata.exit)
    })
  })

  test("at command should not hang", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "echo 'sleep 0.1' | at now + 1 minute 2>/dev/null || echo 'at not available'",
          description: "at scheduled command",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return quickly
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })

  test("systemd-run command should work without hanging", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "systemd-run --user --scope sleep 0.2 2>/dev/null || echo 'systemd-run not available'",
          description: "systemd-run service",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should complete reasonably quickly (systemd-run may background the process)
      expect(duration).toBeLessThan(1000)
      expect(result.metadata.exit).toBe(0)
    })
  })
  test("background with explicit redirection should not hang", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "sleep 0.3 </dev/null >/dev/null 2>&1 &",
          description: "background with explicit I/O redirection",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return immediately
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })

  test("background process group should not hang", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "{ sleep 0.2; echo 'done'; } &",
          description: "background process group",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return immediately
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })

  test("background with job control should not hang", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "set -m; sleep 0.3 &",
          description: "background with job control enabled",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return immediately
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })
})

describe("BashTool backgrounding edge cases", () => {
  test("multiple backgrounding methods combined", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: "nohup setsid sleep 0.3 > /dev/null 2>&1 &",
          description: "multiple backgrounding methods",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return immediately
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)
    })
  })

  test("background command that creates background processes", async () => {
    const testFile = path.join(process.cwd(), "nested-bg-test")

    // Clean up any existing test file
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile)
    }

    await App.provide({ cwd: process.cwd() }, async () => {
      const start = Date.now()

      const result = await (
        await BashTool()
      ).execute(
        {
          command: `(sleep 0.05 && touch ${testFile} &) &`,
          description: "nested background processes",
        },
        ctx,
      )

      const duration = Date.now() - start

      // Should return immediately
      expect(duration).toBeLessThan(100)
      expect(result.metadata.exit).toBe(0)

      // File should not exist immediately
      expect(fs.existsSync(testFile)).toBe(false)

      // Wait for nested background process to complete
      await new Promise((resolve) => setTimeout(resolve, 100))

      // File should now exist
      expect(fs.existsSync(testFile)).toBe(true)

      // Clean up
      fs.unlinkSync(testFile)
    })
  })
})
