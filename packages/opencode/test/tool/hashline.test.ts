import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import path from "path"
import { HashlineTool } from "../../src/tool/hashline"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

process.env.OPENCODE_EXPERIMENTAL_HASHLINE = "true"
process.env.OPENCODE_DISABLE_FILETIME_CHECK = "true"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build" as const,
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

function extractContent(readOutput: string): string {
  const match = readOutput.match(/<content>([\s\S]*)<\/content>/)
  return match ? match[1] : ""
}

function parseHashlines(content: string): string[] {
  return content.split("\n").filter((l) => l.match(/^\d+:/))
}

describe("hashline computeLineHash", () => {
  test("returns 2-character base16 hash string", async () => {
    const { ReadTool } = await import("../../src/tool/read")
    const read = await ReadTool.init()
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await read.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        expect(result.output).toMatch(/\d+:[0-9a-z]{2}\|hello world/)
      },
    })
  })
})

describe("hashline tool set_line operation", () => {
  test("replaces single line at anchor", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "line one\nline two\nline three")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const hashline = await HashlineTool.init()
        const readTool = await (await import("../../src/tool/read")).ReadTool.init()

        const readResult = await readTool.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        const content = extractContent(readResult.output)
        const lines = parseHashlines(content)

        const line2 = lines[1]
        const match = line2.match(/^(\d+):([0-9a-z]+)\|(.*)$/)
        expect(match).not.toBeNull()

        const anchor = `${match![1]}:${match![2]}`
        const result = await hashline.execute(
          {
            filePath: path.join(tmp.path, "test.txt"),
            operations: [{ op: "set_line", anchor, new_text: "replaced line" }],
          },
          ctx,
        )

        expect(result.output).toContain("applied successfully")

        const verifyRead = await readTool.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        expect(verifyRead.output).toContain("replaced line")
        expect(verifyRead.output).not.toContain("line two")
      },
    })
  })
})

describe("hashline tool replace_lines operation", () => {
  test("replaces range of lines between two anchors", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "line one\nline two\nline three\nline four")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const hashline = await HashlineTool.init()
        const readTool = await (await import("../../src/tool/read")).ReadTool.init()

        const readResult = await readTool.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        const content = extractContent(readResult.output)
        const lines = parseHashlines(content)

        const match2 = lines[1].match(/^(\d+):([0-9a-z]+)\|(.*)$/)
        const match3 = lines[2].match(/^(\d+):([0-9a-z]+)\|(.*)$/)

        const startAnchor = `${match2![1]}:${match2![2]}`
        const endAnchor = `${match3![1]}:${match3![2]}`

        const result = await hashline.execute(
          {
            filePath: path.join(tmp.path, "test.txt"),
            operations: [
              { op: "replace_lines", start_anchor: startAnchor, end_anchor: endAnchor, new_text: "middle replaced" },
            ],
          },
          ctx,
        )

        expect(result.output).toContain("applied successfully")

        const verifyRead = await readTool.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        expect(verifyRead.output).toContain("middle replaced")
        expect(verifyRead.output).not.toContain("line two")
        expect(verifyRead.output).not.toContain("line three")
      },
    })
  })
})

describe("hashline tool insert_after operation", () => {
  test("inserts text after given line anchor", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "line one\nline two\nline three")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const hashline = await HashlineTool.init()
        const readTool = await (await import("../../src/tool/read")).ReadTool.init()

        const readResult = await readTool.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        const content = extractContent(readResult.output)
        const lines = parseHashlines(content)

        const line1 = lines[0]
        const match = line1.match(/^(\d+):([0-9a-z]+)\|(.*)$/)

        const anchor = `${match![1]}:${match![2]}`

        const result = await hashline.execute(
          {
            filePath: path.join(tmp.path, "test.txt"),
            operations: [{ op: "insert_after", anchor, text: "inserted line" }],
          },
          ctx,
        )

        expect(result.output).toContain("applied successfully")

        const verifyRead = await readTool.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        expect(verifyRead.output).toContain("inserted line")
      },
    })
  })
})

describe("hashline tool replace operation", () => {
  test("performs substr-style fuzzy replace without hashes", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world\nfoo bar")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const hashline = await HashlineTool.init()
        const readTool = await (await import("../../src/tool/read")).ReadTool.init()

        await readTool.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)

        const result = await hashline.execute(
          {
            filePath: path.join(tmp.path, "test.txt"),
            operations: [{ op: "replace", old_text: "world", new_text: "universe" }],
          },
          ctx,
        )

        expect(result.output).toContain("applied successfully")

        const file = Bun.file(path.join(tmp.path, "test.txt"))
        const content = await file.text()
        expect(content).toContain("hello universe")
        expect(content).not.toContain("hello world")
      },
    })
  })

  test("replaces all occurrences when all is true", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world\nworld hello\nworld")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const hashline = await HashlineTool.init()
        const readTool = await (await import("../../src/tool/read")).ReadTool.init()
        await readTool.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        const result = await hashline.execute(
          {
            filePath: path.join(tmp.path, "test.txt"),
            operations: [{ op: "replace", old_text: "world", new_text: "universe", all: true }],
          },
          ctx,
        )

        expect(result.output).toContain("applied successfully")

        const file = Bun.file(path.join(tmp.path, "test.txt"))
        const content = await file.text()
        expect(content).toBe("hello universe\nuniverse hello\nuniverse")
      },
    })
  })

  test("rejects replace when old_text and new_text are identical", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const hashline = await HashlineTool.init()
        const readTool = await (await import("../../src/tool/read")).ReadTool.init()
        await readTool.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)

        await expect(
          hashline.execute(
            {
              filePath: path.join(tmp.path, "test.txt"),
              operations: [{ op: "replace", old_text: "world", new_text: "world", all: true }],
            },
            ctx,
          ),
        ).rejects.toThrow("old_text and new_text are identical")
      },
    })
  })
})

describe("hashline tool parseLineRef", () => {
  test("parses valid LINE:HASH reference", async () => {
    const { ReadTool } = await import("../../src/tool/read")
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        const content = extractContent(result.output)
        const lines = parseHashlines(content)
        const match = lines[0].match(/^(\d+):([0-9a-z]+)\|/)
        expect(match).not.toBeNull()
        expect(match![1]).toBe("1")
        expect(match![2].length).toBe(2)
      },
    })
  })

  test("rejects invalid reference format", async () => {
    const { ReadTool } = await import("../../src/tool/read")
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const hashline = await HashlineTool.init()

        await expect(
          hashline.execute(
            {
              filePath: path.join(tmp.path, "test.txt"),
              operations: [{ op: "set_line", anchor: "invalid", new_text: "test" }],
            },
            ctx,
          ),
        ).rejects.toThrow()
      },
    })
  })
})

describe("hashline tool hash mismatch error", () => {
  test("fails on hash mismatch with actionable diagnostic", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "line one\nline two\nline three")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const hashline = await HashlineTool.init()

        await expect(
          hashline.execute(
            {
              filePath: path.join(tmp.path, "test.txt"),
              operations: [{ op: "set_line", anchor: "1:zz", new_text: "modified" }],
            },
            ctx,
          ),
        ).rejects.toThrow()
      },
    })
  })

  test("truncates long mismatch line content in error output", async () => {
    const long = "x".repeat(400)
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), `${long}\nline two\nline three`)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const hashline = await HashlineTool.init()
        const readTool = await (await import("../../src/tool/read")).ReadTool.init()
        await readTool.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        try {
          await hashline.execute(
            {
              filePath: path.join(tmp.path, "test.txt"),
              operations: [{ op: "set_line", anchor: "1:zz", new_text: "modified" }],
            },
            ctx,
          )
          expect.unreachable("expected hash mismatch")
        } catch (error) {
          const message = String(error)
          expect(message).toContain("Quick fix")
          expect(message).toContain("...")
          expect(message).not.toContain("x".repeat(250))
        }
      },
    })
  })
})
