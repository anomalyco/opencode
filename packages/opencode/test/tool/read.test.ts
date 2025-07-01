import { describe, expect, test } from "bun:test"
import { App } from "../../src/app/app"
import { ReadTool } from "../../src/tool/read"
import * as fs from "fs"
import * as path from "path"

const ctx = {
  sessionID: "test",
  messageID: "",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

describe("tool.read", () => {
  test("read text file", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      const result = await ReadTool.execute(
        {
          filePath: path.join(process.cwd(), "README.md"),
        },
        ctx,
      )
      expect(result.output).toContain("<file>")
      expect(result.output).toContain("</file>")
      expect(result.metadata.title).toBe("README.md")
    })
  })

  test("read PNG file", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      // Create a minimal PNG file for testing
      const testPngPath = path.join(process.cwd(), "test-image.png")
      // 1x1 red pixel PNG
      const pngData = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
        0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
        0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb4, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ])

      fs.writeFileSync(testPngPath, pngData)

      try {
        const result = await ReadTool.execute(
          {
            filePath: testPngPath,
          },
          ctx,
        )

        expect(result.output).toContain("<image>")
        expect(result.output).toContain("data:image/png;base64,")
        expect(result.output).toContain("</image>")
        expect(result.metadata.preview).toContain(
          "Image file: test-image.png (PNG)",
        )
        expect(result.metadata.title).toBe("test-image.png")
      } finally {
        // Clean up test file
        fs.unlinkSync(testPngPath)
      }
    })
  })

  test("read JPEG file", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      // Create a minimal JPEG file for testing
      const testJpegPath = path.join(process.cwd(), "test-image.jpg")
      // Minimal JPEG structure
      const jpegData = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
        0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
        0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
        0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
        0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
        0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
        0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xd9,
      ])

      fs.writeFileSync(testJpegPath, jpegData)

      try {
        const result = await ReadTool.execute(
          {
            filePath: testJpegPath,
          },
          ctx,
        )

        expect(result.output).toContain("<image>")
        expect(result.output).toContain("data:image/jpeg;base64,")
        expect(result.output).toContain("</image>")
        expect(result.metadata.preview).toContain(
          "Image file: test-image.jpg (JPEG)",
        )
        expect(result.metadata.title).toBe("test-image.jpg")
      } finally {
        // Clean up test file
        fs.unlinkSync(testJpegPath)
      }
    })
  })

  test("file not found", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      await expect(
        ReadTool.execute(
          {
            filePath: "/tmp/nonexistent-file-that-does-not-exist.txt",
          },
          ctx,
        ),
      ).rejects.toThrow("File not found")
    })
  })
})
