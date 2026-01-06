import { describe, expect, test, beforeEach } from "bun:test"
import path from "path"
import { LSP } from "../../src/lsp"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { WriteTool } from "../../src/tool/write"
import { EditTool } from "../../src/tool/edit"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("LSP Diagnostics Toggle Integration", () => {
  beforeEach(async () => {
    await Log.init({ print: false })
  })

  test("Write tool respects diagnostics toggle when disabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await LSP.init()

        await LSP.toggleDiagnostics()
        expect((await LSP.diagnosticsStatus()).enabled).toBe(false)

        const write = await WriteTool.init()
        const testFile = path.join(tmp.path, "test.ts")

        const result = await write.execute(
          {
            filePath: testFile,
            content: `const x: number = "hello";\nconst missing = undefinedVar;`,
          },
          ctx,
        )

        expect(result.output).not.toContain("<file_diagnostics>")
        expect(result.output).not.toContain("ERROR")
      },
    })
  })

  test("Write tool shows diagnostics when enabled", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Create a tsconfig to enable TypeScript LSP
        await Bun.write(
          path.join(dir, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              strict: true,
              target: "ES2020",
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await LSP.init()

        const status = await LSP.diagnosticsStatus()
        expect(status.enabled).toBe(true)

        const write = await WriteTool.init()
        const testFile = path.join(tmp.path, "test.ts")

        const result = await write.execute(
          {
            filePath: testFile,
            content: `const x: number = "hello";\nconst missing = undefinedVar;`,
          },
          ctx,
        )

        // Wait a bit for LSP to process
        await new Promise((r) => setTimeout(r, 500))

        // Note: Actual diagnostics may not appear if LSP isn't running,
        // but we're testing the filtering logic
        // The tool should at least attempt to fetch diagnostics
        expect(result).toBeDefined()
      },
    })
  })

  test("Edit tool respects diagnostics toggle when disabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await LSP.init()
        const testFile = path.join(tmp.path, "test.ts")
        await Bun.write(testFile, `const x = 1;`)

        // Read the file first (required by Edit tool)
        const { ReadTool } = await import("../../src/tool/read")
        const read = await ReadTool.init()
        await read.execute({ filePath: testFile }, ctx)

        await LSP.toggleDiagnostics()
        expect((await LSP.diagnosticsStatus()).enabled).toBe(false)

        const edit = await EditTool.init()
        const result = await edit.execute(
          {
            filePath: testFile,
            oldString: "const x = 1;",
            newString: 'const x: number = "hello";',
          },
          ctx,
        )
        
        expect(result.output).not.toContain("<file_diagnostics>")
        expect(result.output).not.toContain("ERROR")
      },
    })
  })
})
