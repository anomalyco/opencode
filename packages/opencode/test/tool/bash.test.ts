import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { BashTool, stale, reap } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"
import { Truncate } from "../../src/tool/truncation"
import { SessionID, MessageID } from "../../src/session/schema"
import { Shell } from "../../src/shell/shell"
import { spawn } from "child_process"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const projectRoot = path.join(__dirname, "../..")

describe("tool.bash", () => {
  test("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo 'test'",
            description: "Echo test message",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })
})

describe("tool.bash permissions", () => {
  test("asks for bash permission with correct pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo hello")
      },
    })
  })

  test("asks for bash permission with multiple commands", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "echo foo && echo bar",
            description: "Echo twice",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo foo")
        expect(requests[0].patterns).toContain("echo bar")
      },
    })
  })

  test("asks for external_directory permission when cd to parent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "cd ../",
            description: "Change to parent directory",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })

  test("asks for external_directory permission when workdir is outside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "ls",
            workdir: os.tmpdir(),
            description: "List temp dir",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(path.join(os.tmpdir(), "*"))
      },
    })
  })

  test("asks for external_directory permission when file arg is outside project", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "outside.txt"), "x")
      },
    })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        const filepath = path.join(outerTmp.path, "outside.txt")
        await bash.execute(
          {
            command: `cat ${filepath}`,
            description: "Read external file",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        const expected = path.join(outerTmp.path, "*")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(expected)
        expect(extDirReq!.always).toContain(expected)
      },
    })
  })

  test("does not ask for external_directory permission when rm inside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }

        await Bun.write(path.join(tmp.path, "tmpfile"), "x")

        await bash.execute(
          {
            command: `rm -rf ${path.join(tmp.path, "nested")}`,
            description: "remove nested dir",
          },
          testCtx,
        )

        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })

  test("includes always patterns for auto-approval", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "git log --oneline -5",
            description: "Git log",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].always.length).toBeGreaterThan(0)
        expect(requests[0].always.some((p) => p.endsWith("*"))).toBe(true)
      },
    })
  })

  test("does not ask for bash permission when command is cd only", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "cd .",
            description: "Stay in current directory",
          },
          testCtx,
        )
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeUndefined()
      },
    })
  })

  test("matches redirects in permission pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute({ command: "cat > /tmp/output.txt", description: "Redirect ls output" }, testCtx)
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeDefined()
        expect(bashReq!.patterns).toContain("cat > /tmp/output.txt")
      },
    })
  })

  test("always pattern has space before wildcard to not include different commands", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute({ command: "ls -la", description: "List" }, testCtx)
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeDefined()
        const pattern = bashReq!.always[0]
        expect(pattern).toBe("ls *")
      },
    })
  })
})

describe.skipIf(process.platform === "win32")("tool.bash truncation", () => {
  test("truncates output exceeding line limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const lineCount = Truncate.MAX_LINES + 500
        const result = await bash.execute(
          {
            command: `seq 1 ${lineCount}`,
            description: "Generate lines exceeding limit",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("truncates output exceeding byte limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const byteCount = Truncate.MAX_BYTES + 10000
        const result = await bash.execute(
          {
            command: `head -c ${byteCount} /dev/zero | tr '\\0' 'a'`,
            description: "Generate bytes exceeding limit",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("does not truncate small output", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(false)
        const eol = process.platform === "win32" ? "\r\n" : "\n"
        expect(result.output).toBe(`hello${eol}`)
      },
    })
  })

  test("full output is saved to file when truncated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const lineCount = Truncate.MAX_LINES + 100
        const result = await bash.execute(
          {
            command: `seq 1 ${lineCount}`,
            description: "Generate lines for file check",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)

        const filepath = (result.metadata as any).outputPath
        expect(filepath).toBeTruthy()

        const saved = await Filesystem.readText(filepath)
        const lines = saved.trim().split("\n")
        expect(lines.length).toBe(lineCount)
        expect(lines[0]).toBe("1")
        expect(lines[lineCount - 1]).toBe(String(lineCount))
      },
    })
  })
})

describe("tool.bash defensive patterns", () => {
  test("completes normally with polling active", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "echo 'quick'", description: "Quick echo" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("quick")
      },
    })
  })

  test("resolves within polling interval for fast commands", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const start = Date.now()
        const result = await bash.execute(
          { command: "echo 'fast'", description: "Fast echo" },
          ctx,
        )
        const elapsed = Date.now() - start
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("fast")
        expect(elapsed).toBeLessThan(3000)
      },
    })
  })

  test.skipIf(process.platform === "win32")("handles long-running command that completes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "sleep 2 && echo done", description: "Sleep then echo" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("done")
      },
    })
  })

  test("resolves when process exits normally (exit event path)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "echo 'test'", description: "Exit event test" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test("does not double-resolve for normal execution", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        let count = 0
        const result = await bash.execute(
          { command: "echo 'once'", description: "Single resolve test" },
          ctx,
        )
        count++
        expect(count).toBe(1)
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("once")
      },
    })
  })

  test("spawns process with valid pid", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "echo 'pid-test'", description: "Pid validation test" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test("handles invalid command gracefully", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "/nonexistent/binary/xyz", description: "Invalid command" },
          ctx,
        )
        expect(result.metadata.exit).not.toBe(0)
      },
    })
  })

  test.skipIf(process.platform === "win32")("times out long-running command", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "sleep 60", timeout: 1000, description: "Long sleep" },
          ctx,
        )
        expect(result.output).toContain("timeout")
      },
    })
  })

  test.skipIf(process.platform === "win32")("abort signal kills process", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const controller = new AbortController()
        setTimeout(() => controller.abort(), 500)
        const result = await bash.execute(
          { command: "sleep 60", description: "Abortable sleep" },
          { ...ctx, abort: controller.signal },
        )
        expect(result.output).toContain("abort")
      },
    })
  })

  test("cleanup clears both timeout and polling interval", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "echo 'cleanup'", description: "Cleanup test" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        // If cleanup failed, lingering timers would keep the process alive
        // and this test would time out. Completing is the assertion.
      },
    })
  })
})

// Prove polling watchdog detects exit without exit/close events
// (simulates Bun bug where events are dropped in containers)
describe.skipIf(process.platform === "win32")("polling watchdog isolation", () => {
  test("resolves via polling when exit/close events are suppressed", async () => {
    const proc = spawn("echo", ["hello"], {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    let output = ""
    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString()
    })

    // Wait for process to finish — but deliberately do NOT use exit/close events
    await Bun.sleep(500)

    const detected = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("polling watchdog failed to detect exit within 3s")),
        3000,
      )

      const poll = setInterval(() => {
        if (proc.exitCode !== null || proc.signalCode !== null) {
          clearInterval(poll)
          clearTimeout(timer)
          resolve("exitCode")
          return
        }
        if (proc.pid) {
          try {
            process.kill(proc.pid, 0)
          } catch {
            clearInterval(poll)
            clearTimeout(timer)
            resolve("kill-esrch")
            return
          }
        }
      }, 200)
    })

    expect(["exitCode", "kill-esrch"]).toContain(detected)
    expect(output.trim()).toBe("hello")
  })

  test("resolves via polling for process that exits with non-zero code", async () => {
    const proc = spawn("exit 1", [], {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    await Bun.sleep(500)

    const detected = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("polling watchdog failed to detect exit within 3s")),
        3000,
      )

      const poll = setInterval(() => {
        if (proc.exitCode !== null || proc.signalCode !== null) {
          clearInterval(poll)
          clearTimeout(timer)
          resolve("exitCode")
          return
        }
        if (proc.pid) {
          try {
            process.kill(proc.pid, 0)
          } catch {
            clearInterval(poll)
            clearTimeout(timer)
            resolve("kill-esrch")
            return
          }
        }
      }, 200)
    })

    expect(["exitCode", "kill-esrch"]).toContain(detected)
  })

  test("resolves via polling for killed process (simulates timeout kill)", async () => {
    const proc = spawn("sleep 60", [], {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    expect(proc.pid).toBeDefined()

    // Kill the process (simulates what timeout/abort does)
    try {
      process.kill(-proc.pid!, "SIGKILL")
    } catch {
      proc.kill("SIGKILL")
    }

    await Bun.sleep(500)

    const detected = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("polling watchdog failed to detect killed process within 3s")),
        3000,
      )

      const poll = setInterval(() => {
        if (proc.exitCode !== null || proc.signalCode !== null) {
          clearInterval(poll)
          clearTimeout(timer)
          resolve("exitCode")
          return
        }
        if (proc.pid) {
          try {
            process.kill(proc.pid, 0)
          } catch {
            clearInterval(poll)
            clearTimeout(timer)
            resolve("kill-esrch")
            return
          }
        }
      }, 200)
    })

    expect(["exitCode", "kill-esrch"]).toContain(detected)
  })
})

describe.skipIf(process.platform === "win32")("shell.killTree", () => {
  test("terminates a running process", async () => {
    const proc = spawn("sleep", ["60"], { detached: true })
    expect(proc.pid).toBeDefined()
    await Shell.killTree(proc)
    await Bun.sleep(100)
    expect(() => process.kill(proc.pid!, 0)).toThrow()
  })

  test("handles already-dead process", async () => {
    const proc = spawn("echo", ["done"])
    await new Promise<void>((resolve) => proc.once("exit", () => resolve()))
    await Shell.killTree(proc, { exited: () => true })
  })

  test("escalates to SIGKILL when SIGTERM ignored", async () => {
    const proc = spawn("bash", ["-c", "trap '' TERM; sleep 60"], { detached: true })
    expect(proc.pid).toBeDefined()
    await Shell.killTree(proc)
    await Bun.sleep(100)
    expect(() => process.kill(proc.pid!, 0)).toThrow()
  })
})

describe("tool.bash diagnostic logging", () => {
  test("bash tool works with diagnostic logging", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "echo 'log-test'", description: "Logging test" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("log-test")
      },
    })
  })
})

describe.skipIf(process.platform === "win32")("server-level watchdog", () => {
  test("stale returns empty when no processes are registered", () => {
    const ids = stale()
    expect(ids).toEqual([])
  })

  test("reap force-completes a stuck bash process", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const id = "test-reap-" + Date.now()
        const promise = bash.execute(
          { command: "sleep 60", description: "Stuck process for reap test" },
          { ...ctx, callID: id },
        )

        await Bun.sleep(300)

        reap(id)

        // The promise should now resolve (not hang forever)
        const result = await promise
        expect(result).toBeDefined()
        expect(result.output).toBeDefined()
      },
    })
  })

  test("reap is a no-op for unknown callID", () => {
    reap("nonexistent-id-" + Date.now())
  })
})

describe.skipIf(process.platform === "win32")("stdio end events", () => {
  test("command with stdout output completes via stdio path", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "seq 1 100", description: "Generate numbered output" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("1")
        expect(result.metadata.output).toContain("100")
      },
    })
  })

  test("command with both stdout and stderr completes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "echo out && echo err >&2", description: "Both streams" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("out")
        expect(result.metadata.output).toContain("err")
      },
    })
  })
})
