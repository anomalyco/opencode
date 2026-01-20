import { describe, expect, test } from "bun:test"
import path from "path"
import { SelectTextTool } from "../../src/tool/select-text"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
  getConversation: async () => [],
  extra: {},
}

describe("tool.select-text", () => {
  test("selects text with searchStart only", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "test.ts"),
          `function foo() {
  return 42
}

function bar() {
  return 43
}`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const selectText = await SelectTextTool.init()
        const result = await selectText.execute(
          { filePath: path.join(tmp.path, "test.ts"), searchStart: "return 42" },
          ctx,
        )
        expect(result.output).toContain("return 42")
        expect(result.title).toContain("test.ts")
        expect(result.metadata.filePath).toBe(path.join(tmp.path, "test.ts"))
      },
    })
  })

  test("selects text with searchStart and searchEnd", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "test.ts"),
          `function foo() {
  return 42
}

more content here

and even more`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const selectText = await SelectTextTool.init()
        const result = await selectText.execute(
          {
            filePath: path.join(tmp.path, "test.ts"),
            searchStart: "function foo() {",
            searchEnd: "}",
          },
          ctx,
        )
        expect(result.output).toContain("function foo() {")
        expect(result.output).toContain("return 42")
        expect(result.output).toContain("}")
      },
    })
  })

  test("throws error when file not found", async () => {
    await using tmp = await tmpdir({
      init: async () => {},
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const selectText = await SelectTextTool.init()
        const error = await selectText
          .execute({ filePath: path.join(tmp.path, "nonexistent.txt"), searchStart: "test" }, ctx)
          .catch((e) => e)
        expect(error).toBeDefined()
        expect(error.message).toContain("File not found")
      },
    })
  })

  test("throws error for binary files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
        await Bun.write(path.join(dir, "test.exe"), exe)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const selectText = await SelectTextTool.init()
        const error = await selectText
          .execute({ filePath: path.join(tmp.path, "test.exe"), searchStart: "test" }, ctx)
          .catch((e) => e)
        expect(error.message).toContain("Cannot read binary file")
      },
    })
  })

  test("throws error when selection is too large", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const content = "x".repeat(85) + "\n" + "y".repeat(10)
        await Bun.write(path.join(dir, "large.txt"), content)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const selectText = await SelectTextTool.init()
        const error = await selectText
          .execute({ filePath: path.join(tmp.path, "large.txt"), searchStart: "x".repeat(85) }, ctx)
          .catch((e) => e)
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toContain("Selection is too large")
      },
    })
  })

  test("handles files with newlines at end of searchStart", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.ts"), "function foo() {\n  return 42\n}\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const selectText = await SelectTextTool.init()
        const result = await selectText.execute(
          {
            filePath: path.join(tmp.path, "test.ts"),
            searchStart: "function foo() {\n",
          },
          ctx,
        )
        expect(result.output).toContain("function foo() {")
        expect(result.output).not.toContain("WARNING")
      },
    })
  })

  test("warns when leading whitespace does not match", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "test.ts"),
          `function foo() {
  return 42
}`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const selectText = await SelectTextTool.init()
        const result = await selectText.execute(
          {
            filePath: path.join(tmp.path, "test.ts"),
            searchStart: "return 42",
          },
          ctx,
        )
        expect(result.output).toContain("return 42")
        expect(result.output).toContain("WARNING")
        expect(result.output).toContain("whitespace")
      },
    })
  })

  test("allows absolute path inside project directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const selectText = await SelectTextTool.init()
        const result = await selectText.execute(
          { filePath: path.join(tmp.path, "test.txt"), searchStart: "hello" },
          ctx,
        )
        expect(result.output).toContain("hello")
        expect(result.title).toContain("test.txt")
      },
    })
  })
})
