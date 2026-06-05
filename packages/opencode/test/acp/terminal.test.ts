import { describe, expect, test } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { ACPTerminal } from "../../src/acp/terminal"

describe("acp terminal bridge", () => {
  test("defers release until the terminal has been sent in a tool update", async () => {
    let releases = 0
    const terminal = {
      id: "term_1",
      currentOutput: async () => ({ output: "hello", truncated: false }),
      waitForExit: async () => ({ exitCode: 0 }),
      kill: async () => undefined,
      release: async () => {
        releases += 1
      },
      [Symbol.asyncDispose]: async () => undefined,
    } as unknown as Awaited<ReturnType<AgentSideConnection["createTerminal"]>>

    const terminalService = ACPTerminal.make({
      connection: {
        createTerminal: async () => terminal,
      } as unknown as Pick<AgentSideConnection, "createTerminal">,
    })
    terminalService.configure({ enabled: true })
    terminalService.register("session_1")

    try {
      await terminalService.run({
        sessionId: "session_1",
        command: "bash",
        args: ["-c", "echo hello"],
        cwd: "/tmp",
        env: {},
        timeout: 1000,
        outputByteLimit: 1024,
        signal: new AbortController().signal,
        onStart: async () => undefined,
      })

      expect(releases).toBe(0)
      await terminalService.releaseFromMetadata({ terminalId: "term_1" })
      expect(releases).toBe(1)
    } finally {
      terminalService.unregister("session_1")
    }
  })

  test("marks errors after terminal creation so callers do not rerun the command", async () => {
    let releases = 0
    const terminal = {
      id: "term_started",
      currentOutput: async () => ({ output: "partial", truncated: false }),
      waitForExit: async () => {
        throw new Error("wait failed")
      },
      kill: async () => undefined,
      release: async () => {
        releases += 1
      },
      [Symbol.asyncDispose]: async () => undefined,
    } as unknown as Awaited<ReturnType<AgentSideConnection["createTerminal"]>>

    const terminalService = ACPTerminal.make({
      connection: {
        createTerminal: async () => terminal,
      } as unknown as Pick<AgentSideConnection, "createTerminal">,
    })
    terminalService.configure({ enabled: true })
    terminalService.register("session_1")

    try {
      await terminalService.run({
        sessionId: "session_1",
        command: "bash",
        args: ["-c", "echo hello"],
        cwd: "/tmp",
        env: {},
        timeout: 1000,
        outputByteLimit: 1024,
        signal: new AbortController().signal,
        onStart: async () => undefined,
      })
      throw new Error("expected terminal run to fail")
    } catch (error) {
      expect(ACPTerminal.commandStarted(error)).toBe(true)
    } finally {
      terminalService.unregister("session_1")
    }
    expect(releases).toBe(1)
  })

  test("surfaces kill failures after abort", async () => {
    let releases = 0
    const abort = new AbortController()
    const terminal = {
      id: "term_kill_failed",
      currentOutput: async () => ({ output: "partial", truncated: false }),
      waitForExit: async () => new Promise(() => undefined),
      kill: async () => {
        throw new Error("kill failed")
      },
      release: async () => {
        releases += 1
      },
      [Symbol.asyncDispose]: async () => undefined,
    } as unknown as Awaited<ReturnType<AgentSideConnection["createTerminal"]>>

    const terminalService = ACPTerminal.make({
      connection: {
        createTerminal: async () => terminal,
      } as unknown as Pick<AgentSideConnection, "createTerminal">,
    })
    terminalService.configure({ enabled: true })
    terminalService.register("session_1")
    abort.abort()

    try {
      await terminalService.run({
        sessionId: "session_1",
        command: "bash",
        args: ["-c", "echo hello"],
        cwd: "/tmp",
        env: {},
        timeout: 1000,
        outputByteLimit: 1024,
        signal: abort.signal,
        onStart: async () => undefined,
      })
      throw new Error("expected terminal run to fail")
    } catch (error) {
      expect(ACPTerminal.commandStarted(error)).toBe(true)
      expect(error).toMatchObject({ message: "kill failed" })
    } finally {
      terminalService.unregister("session_1")
    }
    expect(releases).toBe(1)
  })
})
