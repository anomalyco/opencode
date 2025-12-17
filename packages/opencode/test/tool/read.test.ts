import { describe, expect, test } from "bun:test"
import path from "path"
import { ReadTool } from "../../src/tool/read"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

// Minimal valid PNG (1x1 transparent pixel)
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)

// Minimal ICO file header (unsupported format)
const VALID_ICO = Buffer.from([
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x18, 0x00, 0x0c, 0x00, 0x00, 0x00, 0x16,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
])

describe("tool.read image format handling", () => {
  test("reads supported image format (PNG)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.png"), VALID_PNG)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "test.png") }, ctx)
        expect(result.output).toBe("Image read successfully")
        expect(result.attachments).toHaveLength(1)
        expect(result.attachments![0].mime).toBe("image/png")
      },
    })
  })

  test("rejects unsupported image format (ICO) with user-friendly error", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "favicon.ico"), VALID_ICO)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(read.execute({ filePath: path.join(tmp.path, "favicon.ico") }, ctx)).rejects.toThrow(
          "Cannot read .ico image: only JPEG, PNG, GIF, and WebP images are supported",
        )
      },
    })
  })

  test("reads SVG as text (not as image)", async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "icon.svg"), svgContent)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "icon.svg") }, ctx)
        expect(result.output).toContain("<file>")
        expect(result.output).toContain("<svg")
        expect(result.attachments).toBeUndefined()
      },
    })
  })
})
