import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { isRichToolResult, normalizeToolContent } from "../../src/tool/content"

describe("tool.content", () => {
  test("isRichToolResult returns true for valid rich content", () => {
    expect(isRichToolResult({ content: [{ type: "text", text: "hello" }] })).toBe(true)
    expect(isRichToolResult({ content: [] })).toBe(true)
  })

  test("isRichToolResult returns false for strings and invalid shapes", () => {
    expect(isRichToolResult("hello")).toBe(false)
    expect(isRichToolResult(null)).toBe(false)
    expect(isRichToolResult(undefined)).toBe(false)
    expect(isRichToolResult({ content: "nope" })).toBe(false)
    expect(isRichToolResult({})).toBe(false)
  })

  test("normalizeToolContent extracts text and creates attachments", () => {
    const content = [
      { type: "text" as const, text: "Hello" },
      { type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgo=" },
      { type: "text" as const, text: "World" },
    ]
    const result = normalizeToolContent(content, "ses_123", "msg_456")

    expect(result.output).toBe("Hello\n\nWorld")
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0].mime).toBe("image/png")
    expect(result.attachments[0].url).toContain("data:image/png;base64,")
  })

  test("normalizeToolContent provides fallback for image-only results", () => {
    const content = [{ type: "image" as const, mimeType: "image/jpeg", data: "abc123" }]
    const result = normalizeToolContent(content, "ses_123", "msg_456")

    expect(result.output).toBe("Returned 1 image.")
    expect(result.attachments).toHaveLength(1)
  })

  test("normalizeToolContent skips unsupported mime types", () => {
    const content = [{ type: "image" as const, mimeType: "image/bmp", data: "abc123" }]
    const result = normalizeToolContent(content, "ses_123", "msg_456")

    expect(result.output).toBe("")
    expect(result.attachments).toHaveLength(0)
  })

  test("normalizeToolContent limits to MAX_IMAGES", () => {
    const content = Array.from({ length: 15 }, (_, i) => ({
      type: "image" as const,
      mimeType: "image/png",
      data: `image${i}`,
    }))
    const result = normalizeToolContent(content, "ses_123", "msg_456")

    expect(result.attachments.length).toBeLessThanOrEqual(10)
    expect(result.attachments.length).toBeGreaterThan(0)
  })

  test("normalizeToolContent skips invalid content items", () => {
    const content = [
      null,
      { type: "text" },
      { type: "image" },
      { type: "text", text: "valid" },
      { type: "unknown", data: "test" },
      { type: "image", mimeType: "image/png", data: "valid" },
    ] as any
    const result = normalizeToolContent(content, "ses_123", "msg_456")

    expect(result.output).toBe("valid")
    expect(result.attachments).toHaveLength(1)
  })

  test("normalizeToolContent handles multiple images fallback", () => {
    const content = [
      { type: "image" as const, mimeType: "image/png", data: "img1" },
      { type: "image" as const, mimeType: "image/jpeg", data: "img2" },
    ]
    const result = normalizeToolContent(content, "ses_123", "msg_456")

    expect(result.output).toBe("Returned 2 images.")
    expect(result.attachments).toHaveLength(2)
  })
})

describe("tool.registry", () => {
  test("loads tools from .opencode/tool (singular)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolDir = path.join(opencodeDir, "tool")
        await fs.mkdir(toolDir, { recursive: true })

        await Bun.write(
          path.join(toolDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("loads tools from .opencode/tools (plural)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolsDir = path.join(opencodeDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(toolsDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("handles tool returning rich content with images", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolsDir = path.join(opencodeDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(toolsDir, "screenshot.ts"),
          [
            "export default {",
            "  description: 'returns an image',",
            "  args: {},",
            "  async execute() {",
            "    return {",
            "      content: [",
            '        { type: "text", text: "Here is the screenshot" },',
            '        { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }',
            "      ]",
            "    }",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools({ modelID: "test", providerID: "test" })
        const tool = tools.find((t) => t.id === "screenshot")
        expect(tool).toBeDefined()

        const mockCtx = {
          sessionID: "ses_test",
          messageID: "msg_test",
          agent: "test",
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
        }

        const result = await tool!.execute({}, mockCtx)
        expect(result.output).toBe("Here is the screenshot")
        expect(result.attachments).toHaveLength(1)
        expect(result.attachments![0].mime).toBe("image/png")
        expect(result.content).toHaveLength(2)
        expect(result.content![0].type).toBe("text")
        expect(result.content![1].type).toBe("image")
      },
    })
  })

  test("handles tool returning plain string (backwards compatible)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolsDir = path.join(opencodeDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(toolsDir, "simple.ts"),
          [
            "export default {",
            "  description: 'returns a string',",
            "  args: {},",
            "  async execute() {",
            "    return 'just a string'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools({ modelID: "test", providerID: "test" })
        const tool = tools.find((t) => t.id === "simple")
        expect(tool).toBeDefined()

        const mockCtx = {
          sessionID: "ses_test",
          messageID: "msg_test",
          agent: "test",
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
        }

        const result = await tool!.execute({}, mockCtx)
        expect(result.output).toBe("just a string")
        expect(result.attachments).toBeUndefined()
        expect(result.content).toBeUndefined()
      },
    })
  })
})
