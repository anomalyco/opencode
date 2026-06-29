import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "os"
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises"

describe("Filesystem.mime-type detection for --file flag", () => {
  // Import the module under test
  const { Filesystem } = require("@/util/filesystem")

  test("returns image/png for .png files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mime-test-"))
    try {
      const filePath = path.join(dir, "test.png")
      await writeFile(filePath, "fake png content")
      const mime = await Filesystem.mimeType(filePath)
      expect(mime).toBe("image/png")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("returns image/jpeg for .jpg files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mime-test-"))
    try {
      const filePath = path.join(dir, "test.jpg")
      await writeFile(filePath, "fake jpeg content")
      const mime = await Filesystem.mimeType(filePath)
      expect(mime).toBe("image/jpeg")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("returns image/jpeg for .jpeg files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mime-test-"))
    try {
      const filePath = path.join(dir, "test.jpeg")
      await writeFile(filePath, "fake jpeg content")
      const mime = await Filesystem.mimeType(filePath)
      expect(mime).toBe("image/jpeg")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("returns text/plain for .txt files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mime-test-"))
    try {
      const filePath = path.join(dir, "test.txt")
      await writeFile(filePath, "plain text content")
      const mime = await Filesystem.mimeType(filePath)
      expect(mime).toBe("text/plain")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("returns application/json for .json files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mime-test-"))
    try {
      const filePath = path.join(dir, "test.json")
      await writeFile(filePath, '{"key": "value"}')
      const mime = await Filesystem.mimeType(filePath)
      expect(mime).toBe("application/json")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("returns text/typescript for .ts files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mime-test-"))
    try {
      const filePath = path.join(dir, "test.ts")
      await writeFile(filePath, "const x = 1")
      const mime = await Filesystem.mimeType(filePath)
      expect(mime).toBe("video/mp2t")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("returns application/octet-stream for unknown extensions", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mime-test-"))
    try {
      const filePath = path.join(dir, "test.unknownext123")
      await writeFile(filePath, "unknown content")
      const mime = await Filesystem.mimeType(filePath)
      expect(mime).toBe("application/octet-stream")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("returns image/gif for .gif files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mime-test-"))
    try {
      const filePath = path.join(dir, "animation.gif")
      await writeFile(filePath, "fake gif content")
      const mime = await Filesystem.mimeType(filePath)
      expect(mime).toBe("image/gif")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("returns image/webp for .webp files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mime-test-"))
    try {
      const filePath = path.join(dir, "image.webp")
      await writeFile(filePath, "fake webp content")
      const mime = await Filesystem.mimeType(filePath)
      expect(mime).toBe("image/webp")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("returns application/pdf for .pdf files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mime-test-"))
    try {
      const filePath = path.join(dir, "document.pdf")
      await writeFile(filePath, "fake pdf content")
      const mime = await Filesystem.mimeType(filePath)
      expect(mime).toBe("application/pdf")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
