import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { PyodideTool } from "../../src/tool/pyodide"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import { withPyodideSdk } from "../fixture/pyodide-sdk"
import type { PermissionNext } from "../../src/permission/next"
import { Truncate } from "../../src/tool/truncation"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.ascending(),
  callID: "call_tool_test",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const projectRoot = path.join(__dirname, "../..")

describe("tool.pyodide", () => {
  test("basic", async () => {
    await withPyodideSdk({
      workspace: projectRoot,
      fn: async () => {
        const t = await PyodideTool.init()
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

describe("tool.pyodide permissions", () => {
  test("asks for pyodide permission with correct pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await withPyodideSdk({
      workspace: tmp.path,
      fn: async () => {
        const t = await PyodideTool.init()
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
        expect(requests[0].permission).toBe("pyodide")
        expect(requests[0].patterns).toContain("print('hello')")
      },
    })
  })

  test("asks for external_directory permission when workdir is outside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await withPyodideSdk({
      workspace: tmp.path,
      fn: async () => {
        const t = await PyodideTool.init()
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
        const tmpResolved = await fs.realpath(os.tmpdir())
        expect(extDirReq!.patterns).toContain(path.join(tmpResolved, "*"))
      },
    })
  })

  test("includes always patterns for auto-approval", async () => {
    await using tmp = await tmpdir({ git: true })
    await withPyodideSdk({
      workspace: tmp.path,
      fn: async () => {
        const t = await PyodideTool.init()
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

describe("tool.pyodide truncation", () => {
  test("truncates output exceeding line limit", async () => {
    await withPyodideSdk({
      workspace: projectRoot,
      fn: async () => {
        const t = await PyodideTool.init()
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
    await withPyodideSdk({
      workspace: projectRoot,
      fn: async () => {
        const t = await PyodideTool.init()
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
    await withPyodideSdk({
      workspace: projectRoot,
      fn: async () => {
        const t = await PyodideTool.init()
        const result = await t.execute(
          {
            code: "print('hello')",
            description: "Print hello",
          },
          ctx,
        )
        expect((result.metadata as { truncated?: boolean }).truncated).toBe(false)
        expect(result.output).toBe("hello\n")
      },
    })
  })

  test("full output is saved to file when truncated", async () => {
    await withPyodideSdk({
      workspace: projectRoot,
      fn: async () => {
        const t = await PyodideTool.init()
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
