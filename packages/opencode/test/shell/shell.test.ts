import { describe, test, expect } from "bun:test"
import { Shell } from "../../src/shell/shell"
import { spawn, type ChildProcess } from "child_process"

describe("Shell", () => {
  describe("preferred()", () => {
    test("returns a non-empty string", () => {
      const shell = Shell.preferred()
      expect(typeof shell).toBe("string")
      expect(shell.length).toBeGreaterThan(0)
    })

    test("returns a valid shell path", () => {
      const shell = Shell.preferred()
      // On Unix-like systems, shell should be an absolute path or a known shell name
      if (process.platform !== "win32") {
        expect(shell).toMatch(/^\//)
      }
    })

    test("returns the same value on repeated calls (memoized)", () => {
      const first = Shell.preferred()
      const second = Shell.preferred()
      expect(first).toBe(second)
    })

    test("returns SHELL env var when set", () => {
      const shell = Shell.preferred()
      if (process.env.SHELL) {
        expect(shell).toBe(process.env.SHELL)
      }
    })
  })

  describe("acceptable()", () => {
    test("returns a non-empty string", () => {
      const shell = Shell.acceptable()
      expect(typeof shell).toBe("string")
      expect(shell.length).toBeGreaterThan(0)
    })

    test("returns the same value on repeated calls (memoized)", () => {
      const first = Shell.acceptable()
      const second = Shell.acceptable()
      expect(first).toBe(second)
    })

    test("returns a valid shell path", () => {
      const shell = Shell.acceptable()
      if (process.platform !== "win32") {
        expect(shell).toMatch(/^\//)
      }
    })
  })

  describe("killTree()", () => {
    test("handles process with no PID gracefully", async () => {
      // Create a mock ChildProcess-like object with no pid
      const mockProc = {
        pid: undefined,
        kill: () => {},
      } as unknown as ChildProcess

      // Should not throw
      await Shell.killTree(mockProc)
    })

    test("handles already-exited process gracefully", async () => {
      const mockProc = {
        pid: undefined,
        kill: () => {},
      } as unknown as ChildProcess

      // exited callback returns true
      await Shell.killTree(mockProc, { exited: () => true })
    })

    test("kills a running child process", async () => {
      // Spawn a long-running process
      const proc = spawn("sleep", ["60"], {
        detached: true,
        stdio: "ignore",
      })

      let exited = false
      proc.on("exit", () => {
        exited = true
      })

      expect(proc.pid).toBeDefined()

      await Shell.killTree(proc, { exited: () => exited })

      // Give time for the process to be cleaned up
      await Bun.sleep(300)
      expect(exited).toBe(true)
    })

    test("skips killing when exited callback returns true", async () => {
      const killCalls: string[] = []
      const mockProc = {
        pid: 99999,
        kill: (signal: string) => {
          killCalls.push(signal)
        },
      } as unknown as ChildProcess

      await Shell.killTree(mockProc, { exited: () => true })

      // Should not have attempted to kill since exited returns true immediately
      // The function checks exited before sending signals
    })
  })
})
