import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { MicropythonTool } from "../../src/tool/micropython"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"
import { Truncate } from "../../src/tool/truncation"
import { SessionID, MessageID } from "../../src/session/schema"

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
const originalFetch = globalThis.fetch
const originalUrl = process.env.VERITLY_EXECUTOR_URL

function outFor(code: string) {
  if (code.includes("print('test')")) return "test\n"
  if (code.includes("print('hello')")) return "hello\n"
  if (code.includes("print('foo')") && code.includes("print('bar')")) return "foo\nbar\n"

  const m = code.match(/for i in range\((\d+)\)/)
  if (m) {
    const n = Number(m[1])
    return Array.from({ length: n }, (_, i) => String(i + 1)).join("\n") + "\n"
  }

  const bytes = code.match(/print\('a' \* (\d+)\)/)
  if (bytes) return "a".repeat(Number(bytes[1])) + "\n"

  return ""
}

beforeEach(() => {
  process.env.VERITLY_EXECUTOR_URL = "http://executor.test"
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    if (url.endsWith("/readyz")) {
      return Response.json({
        ok: true,
        service: "executor",
        mode: "micropython",
        cached: false,
        activeSessions: 0,
        static: {
          micropythonBin: "micropython",
          micropythonRunnable: true,
          micropythonVersion: "test",
          libPath: "/lib",
          libReadable: true,
          probeExit: 0,
          probeOutput: "__readyz_ok__",
        },
        errors: [],
      })
    }
    if (!url.includes("/exec")) {
      return new Response("not found", { status: 404 })
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { code?: string }
    return Response.json({
      output: outFor(body.code ?? ""),
      exitCode: 0,
      sessionId: "ses_test",
      mode: "micropython",
    })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalUrl) process.env.VERITLY_EXECUTOR_URL = originalUrl
  else delete process.env.VERITLY_EXECUTOR_URL
})

describe("tool.micropython", () => {
  test("basic", async () => {
    await Instance.provide({
      workspace: projectRoot,
      fn: async () => {
        const t = await MicropythonTool.init()
        const result = await t.execute(
          {
            code: "print('test')",
            description: "Print test message",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })
})

describe("tool.micropython permissions", () => {
  test("asks for micropython permission with correct pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      workspace: tmp.path,
      fn: async () => {
        const t = await MicropythonTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await t.execute(
          {
            code: "print('hello')",
            description: "Print hello",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("micropython")
        expect(requests[0].patterns).toContain("print('hello')")
      },
    })
  })

  test("asks for external_directory permission when workdir is outside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      workspace: tmp.path,
      fn: async () => {
        const t = await MicropythonTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await t.execute(
          {
            code: "print(1)",
            workdir: os.tmpdir(),
            description: "Run in temp dir",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(path.join(os.tmpdir(), "*"))
      },
    })
  })

  test("includes always patterns for auto-approval", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      workspace: tmp.path,
      fn: async () => {
        const t = await MicropythonTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await t.execute(
          {
            code: "print('x')",
            description: "Run",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].always.length).toBeGreaterThan(0)
      },
    })
  })
})

describe("tool.micropython truncation", () => {
  test("truncates output exceeding line limit", async () => {
    await Instance.provide({
      workspace: projectRoot,
      fn: async () => {
        const t = await MicropythonTool.init()
        const lineCount = Truncate.MAX_LINES + 500
        const result = await t.execute(
          {
            code: `for i in range(${lineCount}):\n  print(i + 1)`,
            description: "Many lines",
          },
          ctx,
        )
        expect((result.metadata as { truncated?: boolean }).truncated).toBe(true)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("truncates output exceeding byte limit", async () => {
    await Instance.provide({
      workspace: projectRoot,
      fn: async () => {
        const t = await MicropythonTool.init()
        const byteCount = Truncate.MAX_BYTES + 10000
        const result = await t.execute(
          {
            code: `print('a' * ${byteCount})`,
            description: "Many bytes",
          },
          ctx,
        )
        expect((result.metadata as { truncated?: boolean }).truncated).toBe(true)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("does not truncate small output", async () => {
    await Instance.provide({
      workspace: projectRoot,
      fn: async () => {
        const t = await MicropythonTool.init()
        const result = await t.execute(
          {
            code: "print('hello')",
            description: "Print hello",
          },
          ctx,
        )
        expect((result.metadata as { truncated?: boolean }).truncated).toBe(false)
        const eol = process.platform === "win32" ? "\r\n" : "\n"
        expect(result.output).toBe(`hello${eol}`)
      },
    })
  })

  test("full output is saved to file when truncated", async () => {
    await Instance.provide({
      workspace: projectRoot,
      fn: async () => {
        const t = await MicropythonTool.init()
        const lineCount = Truncate.MAX_LINES + 100
        const result = await t.execute(
          {
            code: `for i in range(${lineCount}):\n  print(i + 1)`,
            description: "Many lines for file check",
          },
          ctx,
        )
        expect((result.metadata as { truncated?: boolean }).truncated).toBe(true)

        const filepath = (result.metadata as { outputPath?: string }).outputPath
        expect(filepath).toBeTruthy()

        const saved = await Filesystem.readText(filepath!)
        const lines = saved.trim().split("\n")
        expect(lines.length).toBe(lineCount)
        expect(lines[0]).toBe("1")
        expect(lines[lineCount - 1]).toBe(String(lineCount))
      },
    })
  })
})
