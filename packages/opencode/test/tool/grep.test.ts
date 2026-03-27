import { describe, expect, test } from "bun:test"
import path from "path"
import { GrepTool } from "../../src/tool/grep"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
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

describe("tool.grep", () => {
  test("basic search", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "export",
            path: path.join(projectRoot, "src/tool"),
            include: "*.ts",
          },
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThan(0)
        expect(result.output).toContain("Found")
      },
    })
  })

  test("no matches returns correct output", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "xyznonexistentpatternxyz123",
            path: tmp.path,
          },
          ctx,
        )
        expect(result.metadata.matches).toBe(0)
        expect(result.output).toBe("No files found")
      },
    })
  })

  test("handles CRLF line endings in output", async () => {
    // This test verifies the regex split handles both \n and \r\n
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create a test file with content
        await Bun.write(path.join(dir, "test.txt"), "line1\nline2\nline3")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "line",
            path: tmp.path,
          },
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThan(0)
      },
    })
  })

  test("searches pptx via MarkItDown and combines with text file matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "slides.pptx"), Buffer.from([0x50, 0x4b, 0x03, 0x04]))
        await Bun.write(path.join(dir, "notes.txt"), "keyword in notes")

        const mockCmd = path.join(dir, "mock-markitdown.mjs")
        await Bun.write(
          mockCmd,
          [
            "const filepath = process.argv[process.argv.length - 1]",
            "if (!filepath.endsWith('.pptx') && !filepath.endsWith('.docx')) process.exit(2)",
            "console.log('slide title')",
            "console.log('keyword in slide')",
          ].join("\n"),
        )
        await Bun.$`chmod +x ${mockCmd}`
      },
    })

    const oldCmd = process.env.OPENCODE_MARKITDOWN_CMD
    process.env.OPENCODE_MARKITDOWN_CMD = `${process.execPath} ${path.join(tmp.path, "mock-markitdown.mjs")}`

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const grep = await GrepTool.init()
          const result = await grep.execute(
            {
              pattern: "keyword",
              path: tmp.path,
            },
            ctx,
          )

          expect(result.output).toContain(path.join(tmp.path, "slides.pptx"))
          expect(result.output).toContain(path.join(tmp.path, "notes.txt"))
          expect(result.metadata.matches).toBeGreaterThanOrEqual(2)
          expect(result.metadata.officeMatches).toBeGreaterThanOrEqual(1)
        },
      })
    } finally {
      if (oldCmd === undefined) {
        delete process.env.OPENCODE_MARKITDOWN_CMD
      } else {
        process.env.OPENCODE_MARKITDOWN_CMD = oldCmd
      }
    }
  })
})

describe("CRLF regex handling", () => {
  test("regex correctly splits Unix line endings", () => {
    const unixOutput = "file1.txt|1|content1\nfile2.txt|2|content2\nfile3.txt|3|content3"
    const lines = unixOutput.trim().split(/\r?\n/)
    expect(lines.length).toBe(3)
    expect(lines[0]).toBe("file1.txt|1|content1")
    expect(lines[2]).toBe("file3.txt|3|content3")
  })

  test("regex correctly splits Windows CRLF line endings", () => {
    const windowsOutput = "file1.txt|1|content1\r\nfile2.txt|2|content2\r\nfile3.txt|3|content3"
    const lines = windowsOutput.trim().split(/\r?\n/)
    expect(lines.length).toBe(3)
    expect(lines[0]).toBe("file1.txt|1|content1")
    expect(lines[2]).toBe("file3.txt|3|content3")
  })

  test("regex handles mixed line endings", () => {
    const mixedOutput = "file1.txt|1|content1\nfile2.txt|2|content2\r\nfile3.txt|3|content3"
    const lines = mixedOutput.trim().split(/\r?\n/)
    expect(lines.length).toBe(3)
  })
})
