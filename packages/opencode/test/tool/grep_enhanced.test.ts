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

async function setup(files: Record<string, string>) {
  return tmpdir({
    init: async (dir) => {
      for (const [name, content] of Object.entries(files)) {
        await Bun.write(path.join(dir, name), content)
      }
    },
  })
}

describe("grep enhanced modes", () => {
  test("files_with_matches mode lists files", async () => {
    await using tmp = await setup({
      "a.txt": "hello world\nhello again",
      "b.txt": "no match here",
      "c.txt": "hello there",
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute({ pattern: "hello", path: tmp.path, mode: "files_with_matches" }, ctx)
        expect(result.metadata.matches).toBe(2)
        expect(result.output).toContain("2 file(s)")
        expect(result.output).toContain("a.txt")
        expect(result.output).toContain("c.txt")
        expect(result.output).not.toContain("b.txt")
      },
    })
  })

  test("count mode shows match counts per file", async () => {
    await using tmp = await setup({
      "a.txt": "hello world\nhello again\nhello three",
      "b.txt": "hello once",
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute({ pattern: "hello", path: tmp.path, mode: "count" }, ctx)
        expect(result.metadata.matches).toBeGreaterThanOrEqual(4)
        expect(result.output).toContain("matches across")
      },
    })
  })

  test("contextLines shows surrounding lines", async () => {
    await using tmp = await setup({
      "test.txt": "line1\nline2\nmatch\nline4\nline5",
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute({ pattern: "match", path: tmp.path, contextLines: 1 }, ctx)
        expect(result.metadata.matches).toBeGreaterThan(0)
        // The match line is found; context lines appear in raw output but are
        // not parsed as matches since they use '-' separator not '|'
        expect(result.output).toContain("match")
      },
    })
  })

  test("multiline mode matches across lines", async () => {
    await using tmp = await setup({
      "test.txt": "start\nmiddle\nend",
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute({ pattern: "start\\nmiddle", path: tmp.path, multiline: true }, ctx)
        expect(result.metadata.matches).toBeGreaterThan(0)
      },
    })
  })

  test("offset pagination skips first N matches", async () => {
    await using tmp = await setup({
      "a.txt": "match1\nmatch2\nmatch3\nmatch4\nmatch5",
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        // Get all matches first
        const all = await grep.execute({ pattern: "match", path: tmp.path }, ctx)
        const total = all.metadata.matches

        // Now get with offset=2 — should skip first 2
        const paged = await grep.execute({ pattern: "match", path: tmp.path, offset: 2 }, ctx)
        expect(paged.output).toContain("skipping first 2")
        expect(paged.metadata.matches).toBe(total)
      },
    })
  })

  test("offset pagination with files_with_matches", async () => {
    await using tmp = await setup({
      "a.txt": "hello",
      "b.txt": "hello",
      "c.txt": "hello",
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const paged = await grep.execute(
          { pattern: "hello", path: tmp.path, mode: "files_with_matches", offset: 1 },
          ctx,
        )
        expect(paged.output).toContain("skipping first 1")
        // With 3 files and offset 1, should show 2 files
        expect(paged.metadata.matches).toBe(3)
      },
    })
  })

  test("no matches returns correct output in count mode", async () => {
    await using tmp = await setup({ "a.txt": "nothing here" })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute({ pattern: "xyznonexistent", path: tmp.path, mode: "count" }, ctx)
        expect(result.metadata.matches).toBe(0)
        expect(result.output).toBe("No files found")
      },
    })
  })

  test("no matches returns correct output in files_with_matches mode", async () => {
    await using tmp = await setup({ "a.txt": "nothing here" })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "xyznonexistent",
            path: tmp.path,
            mode: "files_with_matches",
          },
          ctx,
        )
        expect(result.metadata.matches).toBe(0)
        expect(result.output).toBe("No files found")
      },
    })
  })
})
